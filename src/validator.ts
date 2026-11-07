import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActionsMetadataProvider, ValidationConfig } from '@actions/languageservice';
import { validate } from '@actions/languageservice';
import { clearCacheEntry } from '@actions/languageservice/utils/workflow-cache';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createActionsMetadataProvider, createFileProvider } from './metadata.ts';

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface FormattedDiagnostic {
  filePath: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: DiagnosticSeverity;
  code?: string | number | undefined;
}

export interface ValidationResult {
  filePath: string;
  isValid: boolean;
  diagnostics: FormattedDiagnostic[];
}

export interface ValidationOptions {
  offline?: boolean | undefined;
  token?: string | undefined;
  actionsMetadataProvider?: ActionsMetadataProvider | undefined;
  fileProvider?: ValidationConfig['fileProvider'];
}

function mapSeverity(severity?: number): DiagnosticSeverity {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
      return 'hint';
    default:
      return 'error';
  }
}

/**
 * Validates a GitHub Actions workflow or action file.
 */
export async function validateFile(filePath: string, options: ValidationOptions = {}): Promise<ValidationResult> {
  const content = readFileSync(filePath, 'utf8');
  return validateContent(filePath, content, options);
}

/**
 * Validates content for a given file path.
 */
export async function validateContent(
  filePath: string,
  content: string,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const uri = pathToFileURL(resolve(filePath)).toString();
  clearCacheEntry(uri);
  const document = TextDocument.create(uri, 'yaml', 0, content);

  const actionsMetadataProvider = options.offline
    ? undefined
    : (options.actionsMetadataProvider ?? createActionsMetadataProvider({ token: options.token }));

  const fileProvider = options.fileProvider
    ?? (options.offline ? undefined : createFileProvider({ token: options.token }));

  const config: ValidationConfig = {
    ...(fileProvider ? { fileProvider } : {}),
    ...(actionsMetadataProvider ? { actionsMetadataProvider } : {}),
  };

  const rawDiagnostics = await validate(document, config);

  const diagnostics: FormattedDiagnostic[] = rawDiagnostics.map((diag) => {
    const rawMessage = diag.message;
    const message = typeof rawMessage === 'string' ? rawMessage : rawMessage.value;
    return {
      filePath,
      message,
      line: diag.range.start.line + 1,
      column: diag.range.start.character + 1,
      endLine: diag.range.end.line + 1,
      endColumn: diag.range.end.character + 1,
      severity: mapSeverity(diag.severity),
      code: diag.code,
    };
  });

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  return {
    filePath,
    isValid: !hasErrors,
    diagnostics,
  };
}

/**
 * Formats a diagnostic as a human-readable string.
 */
export function formatHuman(diagnostic: FormattedDiagnostic): string {
  const severityTag = diagnostic.severity === 'error' ? 'error' : diagnostic.severity;
  return `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}: [${severityTag}] ${diagnostic.message}`;
}
