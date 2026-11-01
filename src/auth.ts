import { execFileSync } from 'node:child_process';

/**
 * Resolves a GitHub access token from the environment or GitHub CLI.
 *
 * 1. Checks GITHUB_TOKEN or GH_TOKEN environment variables.
 * 2. Runs `gh auth token` if available and authenticated.
 * 3. Returns undefined if unauthenticated or not found (permitting unauthenticated API calls).
 */
export function resolveGitHubToken(): string | undefined {
  const envToken = process.env['GITHUB_TOKEN']?.trim() || process.env['GH_TOKEN']?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    const stdout = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return stdout || undefined;
  } catch {
    return undefined;
  }
}
