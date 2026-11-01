import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveGitHubToken } from '../src/auth.ts';

describe('auth', () => {
  it('resolves token from GITHUB_TOKEN', () => {
    const originalGitHub = process.env['GITHUB_TOKEN'];
    const originalGh = process.env['GH_TOKEN'];
    try {
      delete process.env['GH_TOKEN'];
      process.env['GITHUB_TOKEN'] = 'ghp_dummy_token_123';
      assert.equal(resolveGitHubToken(), 'ghp_dummy_token_123');
    } finally {
      if (originalGitHub !== undefined) {
        process.env['GITHUB_TOKEN'] = originalGitHub;
      } else {
        delete process.env['GITHUB_TOKEN'];
      }
      if (originalGh !== undefined) {
        process.env['GH_TOKEN'] = originalGh;
      } else {
        delete process.env['GH_TOKEN'];
      }
    }
  });

  it('resolves token from GH_TOKEN when GITHUB_TOKEN is not set', () => {
    const originalGitHub = process.env['GITHUB_TOKEN'];
    const originalGh = process.env['GH_TOKEN'];
    try {
      delete process.env['GITHUB_TOKEN'];
      process.env['GH_TOKEN'] = 'ghp_dummy_gh_token_456';
      assert.equal(resolveGitHubToken(), 'ghp_dummy_gh_token_456');
    } finally {
      if (originalGitHub !== undefined) {
        process.env['GITHUB_TOKEN'] = originalGitHub;
      } else {
        delete process.env['GITHUB_TOKEN'];
      }
      if (originalGh !== undefined) {
        process.env['GH_TOKEN'] = originalGh;
      } else {
        delete process.env['GH_TOKEN'];
      }
    }
  });
});
