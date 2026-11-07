import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ActionsMetadataProvider, ValidationConfig } from '@actions/languageservice';
import type { ActionMetadata, ActionReference } from '@actions/languageservice/action';
import { actionIdentifier } from '@actions/languageservice/action';
import { parse } from 'yaml';
import packageJson from '../package.json' with { type: 'json' };

export type FileProvider = NonNullable<ValidationConfig['fileProvider']>;
export type FileReference = Parameters<FileProvider['getFileContent']>[0];
export type File = Awaited<ReturnType<FileProvider['getFileContent']>>;

export interface ActionMetadataProviderOptions {
  token?: string | undefined;
  customFetch?: typeof fetch;
}

export interface FileProviderOptions {
  cwd?: string | undefined;
  token?: string | undefined;
  customFetch?: typeof fetch;
}

/**
 * Creates a FileProvider that resolves local workflow/action files from disk
 * and fetches remote reusable workflows from the GitHub REST API.
 */
export function createFileProvider(options: FileProviderOptions = {}): FileProvider {
  const { cwd = process.cwd(), token, customFetch = fetch } = options;
  const cache = new Map<string, Promise<File>>();

  return {
    async getFileContent(ref: FileReference): Promise<File> {
      if (!('repository' in ref)) {
        const key = `./${ref.path}`;
        let promise = cache.get(key);
        if (!promise) {
          promise = (async () => {
            const content = await readFile(resolve(cwd, ref.path), 'utf8');
            return { name: ref.path, content };
          })();
          cache.set(key, promise);
        }
        return promise;
      }

      const key = `${ref.owner}/${ref.repository}/${ref.path}@${ref.version}`;
      let promise = cache.get(key);
      if (!promise) {
        promise = fetchRemoteWorkflowFile(ref, token, customFetch);
        cache.set(key, promise);
      }
      return promise;
    },
  };
}

async function fetchRemoteWorkflowFile(
  ref: Extract<FileReference, { repository: string }>,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<File> {
  const encodedPath = ref.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${
    encodeURIComponent(ref.repository)
  }/contents/${encodedPath}?ref=${encodeURIComponent(ref.version)}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+yaml',
    'User-Agent': `ghadiag/${packageJson.version}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetchFn(url, { headers });
  if (response.status !== 200) {
    throw new Error(`Unable to fetch remote workflow (${response.status})`);
  }

  const content = await response.text();
  return {
    name: `${ref.owner}/${ref.repository}/${ref.path}@${ref.version}`,
    content,
  };
}

/**
 * Creates an ActionsMetadataProvider that fetches action.yml (or action.yaml)
 * from the GitHub REST API using the given token and in-memory cache.
 */
export function createActionsMetadataProvider(options: ActionMetadataProviderOptions = {}): ActionsMetadataProvider {
  const { token, customFetch = fetch } = options;
  const cache = new Map<string, Promise<ActionMetadata | undefined>>();

  return {
    async fetchActionMetadata(action: ActionReference): Promise<ActionMetadata | undefined> {
      const key = actionIdentifier(action);
      let promise = cache.get(key);
      if (!promise) {
        promise = fetchMetadataForAction(action, token, customFetch);
        cache.set(key, promise);
      }
      return promise;
    },
  };
}

async function fetchManifest(
  action: ActionReference,
  manifestFilename: string,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ notFound: boolean; metadata?: ActionMetadata }> {
  const manifestPath = action.path ? `${action.path}/${manifestFilename}` : manifestFilename;
  const url = `https://api.github.com/repos/${action.owner}/${action.name}/contents/${manifestPath}?ref=${
    encodeURIComponent(action.ref)
  }`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+yaml',
    'User-Agent': `ghadiag/${packageJson.version}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetchFn(url, { headers });

    if (response.status === 200) {
      const text = await response.text();
      const parsed = parse(text);
      if (parsed && typeof parsed === 'object') {
        return { notFound: false, metadata: parsed as ActionMetadata };
      }
      return { notFound: false };
    }

    if (response.status === 404) {
      return { notFound: true };
    }

    return { notFound: false };
  } catch {
    return { notFound: false };
  }
}

async function fetchMetadataForAction(
  action: ActionReference,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<ActionMetadata | undefined> {
  const ymlResult = await fetchManifest(action, 'action.yml', token, fetchFn);
  if (ymlResult.metadata) {
    return ymlResult.metadata;
  }
  if (!ymlResult.notFound) {
    return undefined;
  }

  const yamlResult = await fetchManifest(action, 'action.yaml', token, fetchFn);
  return yamlResult.metadata;
}
