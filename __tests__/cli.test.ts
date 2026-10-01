import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const CLI_PATH = resolve(process.cwd(), 'src/cli.ts');
const VALID_FIXTURE = resolve(process.cwd(), '__tests__/fixtures/valid.yml');
const INVALID_FIXTURE = resolve(process.cwd(), '__tests__/fixtures/invalid.yml');
const ACTION_FIXTURE = resolve(process.cwd(), '__tests__/fixtures/action.yml');

function runCli(args: string[], options: { stdio?: ('ignore' | 'pipe')[] } = {}) {
  return execFileSync('pnpm', ['exec', 'tsx', CLI_PATH, ...args], {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

describe('CLI executable', () => {
  it('exits with 0 on valid workflow', () => {
    const stdout = runCli([VALID_FIXTURE]);
    assert.ok(stdout.includes('0 error(s), 0 warning(s)'));
  });

  it('exits with 0 on valid action fixture', () => {
    const stdout = runCli([ACTION_FIXTURE]);
    assert.ok(stdout.includes('0 error(s), 0 warning(s)'));
  });

  it('exits with 1 on invalid workflow', () => {
    assert.throws(
      () => {
        runCli([INVALID_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
      },
      (err: unknown) => {
        const error = err as { status: number; stderr: string };
        assert.equal(error.status, 1);
        assert.ok(error.stderr.includes("Unrecognized named-value: 'secrets'"));
        return true;
      },
    );
  });

  it('rejects unsupported format with exit status 1', () => {
    assert.throws(
      () => {
        runCli(['--format=gha', VALID_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
      },
      (err: unknown) => {
        const error = err as { status: number; stderr: string };
        assert.equal(error.status, 1);
        assert.ok(error.stderr.includes('Invalid format: gha. Allowed values: human, json'));
        return true;
      },
    );
  });

  it('outputs JSON format with --format=json', () => {
    assert.throws(
      () => {
        runCli(['--format=json', INVALID_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
      },
      (err: unknown) => {
        const error = err as { status: number; stdout: string };
        assert.equal(error.status, 1);
        const parsed = JSON.parse(error.stdout);
        assert.equal(Array.isArray(parsed), true);
        assert.equal(parsed[0].isValid, false);
        assert.ok(parsed[0].diagnostics.length > 0);
        return true;
      },
    );
  });
});
