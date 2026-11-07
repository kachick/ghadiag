import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { FileProvider, FileReference } from './metadata.ts';
import type { FormattedDiagnostic } from './validator.ts';

type PermissionLevel = 'none' | 'read' | 'write';

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
};

interface ResolvedPermissions {
  defaultLevel: PermissionLevel;
  scopes: Map<string, PermissionLevel>;
}

interface RequiredPermissionEntry {
  scope: string;
  level: PermissionLevel;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

function parsePermissionLevel(value: unknown): PermissionLevel | undefined {
  if (value === 'none' || value === 'read' || value === 'write') {
    return value;
  }
  return undefined;
}

function resolvePermissionsNode(node: unknown): ResolvedPermissions | undefined {
  if (node === null) {
    return { defaultLevel: 'none', scopes: new Map() };
  }
  if (isScalar(node)) {
    const val = node.value;
    if (val === null) {
      return { defaultLevel: 'none', scopes: new Map() };
    }
    if (val === 'read-all') {
      return { defaultLevel: 'read', scopes: new Map() };
    }
    if (val === 'write-all') {
      return { defaultLevel: 'write', scopes: new Map() };
    }
    return undefined;
  }
  if (isMap(node)) {
    const scopes = new Map<string, PermissionLevel>();
    for (const item of node.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string' && isScalar(item.value)) {
        const level = parsePermissionLevel(item.value.value);
        if (level) {
          scopes.set(item.key.value, level);
        }
      }
    }
    return { defaultLevel: 'none', scopes };
  }
  return undefined;
}

function getEffectiveLevel(perms: ResolvedPermissions, scope: string): PermissionLevel {
  return perms.scopes.get(scope) ?? perms.defaultLevel;
}

function offsetToPosition(lineCounter: LineCounter, offset: number): { line: number; column: number } {
  const pos = lineCounter.linePos(offset);
  return { line: pos.line, column: pos.col };
}

function extractRange(
  lineCounter: LineCounter,
  range?: [number, number, number] | null,
): { line: number; column: number; endLine: number; endColumn: number } {
  if (!range) {
    return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  }
  const start = offsetToPosition(lineCounter, range[0]);
  const end = offsetToPosition(lineCounter, range[1]);
  return {
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function parseWorkflowFileReference(ref: string): FileReference | undefined {
  if (ref.startsWith('./') || ref.startsWith('$/')) {
    return { path: ref.substring(2) };
  }
  const atIndex = ref.indexOf('@');
  if (atIndex === -1) {
    return undefined;
  }
  const remotePath = ref.substring(0, atIndex);
  const version = ref.substring(atIndex + 1);
  const segments = remotePath.split('/').filter((s) => s.length > 0);
  const owner = segments[0];
  const repository = segments[1];
  const pathSegments = segments.slice(2);
  if (!owner || !repository || pathSegments.length === 0 || !version) {
    return undefined;
  }
  const filePath = pathSegments.join('/');
  if (!filePath.endsWith('.yml') && !filePath.endsWith('.yaml')) {
    return undefined;
  }
  return {
    owner,
    repository,
    path: filePath,
    version,
  };
}

function collectRequiredPermissions(
  node: unknown,
  lineCounter: LineCounter,
): RequiredPermissionEntry[] {
  const entries: RequiredPermissionEntry[] = [];
  if (isScalar(node)) {
    const r = extractRange(lineCounter, node.range);
    if (node.value === 'read-all') {
      entries.push({ scope: '*', level: 'read', ...r });
    } else if (node.value === 'write-all') {
      entries.push({ scope: '*', level: 'write', ...r });
    }
    return entries;
  }
  if (isMap(node)) {
    for (const item of node.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string' && isScalar(item.value)) {
        const level = parsePermissionLevel(item.value.value);
        if (level && level !== 'none') {
          const r = extractRange(lineCounter, item.key.range);
          entries.push({ scope: item.key.value, level, ...r });
        }
      }
    }
  }
  return entries;
}

/**
 * Validates permission rules that are enforced by GitHub Actions at workflow startup
 * but are not yet checked by upstream @actions/languageservice:
 *
 * 1. Reusable workflow job permissions: when a caller job or workflow restricts
 *    `permissions`, the called workflow (top-level and jobs) cannot request higher
 *    permissions than what the caller allows.
 * 2. Self-consistency in a workflow: when a workflow defines top-level `permissions`,
 *    any job inside the same workflow that overrides `permissions` and uses
 *    `actions/checkout` (without a custom `token`) must retain at least `contents: read`.
 */
export async function validatePermissions(
  filePath: string,
  content: string,
  fileProvider?: FileProvider,
): Promise<FormattedDiagnostic[]> {
  const diagnostics: FormattedDiagnostic[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(content, { lineCounter });
  if (!isMap(doc.contents)) {
    return diagnostics;
  }

  let topPermsNode: unknown;
  let jobsNode: unknown;

  for (const item of doc.contents.items) {
    if (!isScalar(item.key) || typeof item.key.value !== 'string') {
      continue;
    }
    if (item.key.value === 'permissions') {
      topPermsNode = item.value;
    } else if (item.key.value === 'jobs') {
      jobsNode = item.value;
    }
  }

  const topPerms = topPermsNode !== undefined ? resolvePermissionsNode(topPermsNode) : undefined;

  if (!isMap(jobsNode)) {
    return diagnostics;
  }

  const reusableChecks: Promise<FormattedDiagnostic[]>[] = [];

  for (const jobPair of jobsNode.items) {
    if (!isScalar(jobPair.key) || !isMap(jobPair.value)) {
      continue;
    }

    let jobPermsNode: unknown;
    let usesNode: unknown;
    let stepsNode: unknown;

    for (const prop of jobPair.value.items) {
      if (!isScalar(prop.key) || typeof prop.key.value !== 'string') {
        continue;
      }
      if (prop.key.value === 'permissions') {
        jobPermsNode = prop.value;
      } else if (prop.key.value === 'uses') {
        usesNode = prop.value;
      } else if (prop.key.value === 'steps') {
        stepsNode = prop.value;
      }
    }

    const jobPerms = jobPermsNode !== undefined ? resolvePermissionsNode(jobPermsNode) : undefined;
    const effectiveCallerPerms = jobPerms ?? topPerms;

    // Check 1: Reusable workflow call permission ceiling
    if (fileProvider && isScalar(usesNode) && typeof usesNode.value === 'string' && effectiveCallerPerms) {
      const usesValue = usesNode.value;
      const ref = parseWorkflowFileReference(usesValue);
      if (ref) {
        const jobKeyRange = extractRange(lineCounter, jobPair.key.range);
        reusableChecks.push(
          (async () => {
            try {
              const calledFile = await fileProvider.getFileContent(ref);
              return checkCalledWorkflowPermissions(
                filePath,
                usesValue,
                jobKeyRange,
                effectiveCallerPerms,
                calledFile.content,
              );
            } catch {
              // Unresolvable workflow is already reported by @actions/languageservice
              return [];
            }
          })(),
        );
      }
    }

    // Check 2: Job overriding permissions to contents: none while using actions/checkout without custom token
    if (jobPerms && getEffectiveLevel(jobPerms, 'contents') === 'none' && isSeq(stepsNode)) {
      for (const step of stepsNode.items) {
        if (!isMap(step)) {
          continue;
        }
        let stepUses: string | undefined;
        let stepUsesRange: [number, number, number] | null | undefined;
        let hasCustomToken = false;

        for (const stepProp of step.items) {
          if (!isScalar(stepProp.key) || typeof stepProp.key.value !== 'string') {
            continue;
          }
          if (stepProp.key.value === 'uses' && isScalar(stepProp.value) && typeof stepProp.value.value === 'string') {
            stepUses = stepProp.value.value;
            stepUsesRange = stepProp.value.range;
          } else if (stepProp.key.value === 'with' && isMap(stepProp.value)) {
            for (const withProp of stepProp.value.items) {
              if (isScalar(withProp.key) && withProp.key.value === 'token') {
                hasCustomToken = true;
              }
            }
          }
        }

        if (stepUses?.startsWith('actions/checkout@') && !hasCustomToken) {
          const r = extractRange(lineCounter, stepUsesRange);
          diagnostics.push({
            filePath,
            message:
              "Step uses 'actions/checkout' without a custom token, but job permissions restrict 'contents' to 'none'. Add 'contents: read' to job permissions.",
            ...r,
            severity: 'error',
            code: 'insufficient-job-permissions',
          });
        }
      }
    }
  }

  const reusableResults = await Promise.all(reusableChecks);
  for (const res of reusableResults) {
    diagnostics.push(...res);
  }

  return diagnostics;
}

function checkCalledWorkflowPermissions(
  callerFilePath: string,
  usesValue: string,
  jobKeyRange: { line: number; column: number; endLine: number; endColumn: number },
  callerPerms: ResolvedPermissions,
  calledContent: string,
): FormattedDiagnostic[] {
  const diagnostics: FormattedDiagnostic[] = [];
  const calledLineCounter = new LineCounter();
  const calledDoc = parseDocument(calledContent, { lineCounter: calledLineCounter });
  if (!isMap(calledDoc.contents)) {
    return diagnostics;
  }

  const requiredEntries: RequiredPermissionEntry[] = [];

  for (const item of calledDoc.contents.items) {
    if (!isScalar(item.key) || typeof item.key.value !== 'string') {
      continue;
    }
    if (item.key.value === 'permissions') {
      requiredEntries.push(...collectRequiredPermissions(item.value, calledLineCounter));
    } else if (item.key.value === 'jobs' && isMap(item.value)) {
      for (const calledJob of item.value.items) {
        if (!isMap(calledJob.value)) {
          continue;
        }
        for (const prop of calledJob.value.items) {
          if (isScalar(prop.key) && prop.key.value === 'permissions') {
            requiredEntries.push(...collectRequiredPermissions(prop.value, calledLineCounter));
          }
        }
      }
    }
  }

  const reportedScopes = new Set<string>();

  for (const req of requiredEntries) {
    if (req.scope === '*') {
      if (LEVEL_RANK[callerPerms.defaultLevel] < LEVEL_RANK[req.level]) {
        const key = `*:${req.level}`;
        if (!reportedScopes.has(key)) {
          reportedScopes.add(key);
          diagnostics.push({
            filePath: callerFilePath,
            message:
              `Error calling workflow '${usesValue}'. The workflow is requesting '${req.level}-all', which exceeds the caller's allowed permissions.`,
            ...jobKeyRange,
            severity: 'error',
            code: 'reusable-workflow-permissions',
          });
        }
      }
      continue;
    }

    const allowedLevel = getEffectiveLevel(callerPerms, req.scope);
    if (LEVEL_RANK[allowedLevel] < LEVEL_RANK[req.level]) {
      const key = `${req.scope}:${req.level}:${allowedLevel}`;
      if (!reportedScopes.has(key)) {
        reportedScopes.add(key);
        diagnostics.push({
          filePath: callerFilePath,
          message:
            `Error calling workflow '${usesValue}'. The workflow is requesting '${req.scope}: ${req.level}', but is only allowed '${req.scope}: ${allowedLevel}'.`,
          ...jobKeyRange,
          severity: 'error',
          code: 'reusable-workflow-permissions',
        });
      }
    }
  }

  return diagnostics;
}
