import type { ActionsMetadataProvider } from '@actions/languageservice';
import type { ActionMetadata, ActionReference } from '@actions/languageservice/action';
import { actionIdentifier } from '@actions/languageservice/action';
import { parse } from 'yaml';
import packageJson from '../package.json' with { type: 'json' };

export interface ActionMetadataProviderOptions {
  token?: string | undefined;
  customFetch?: typeof fetch;
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
