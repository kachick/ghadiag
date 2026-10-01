import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { before, describe, it } from 'node:test';

const DIST_CLI_PATH = resolve(process.cwd(), 'dist/cli.js');
const VALID_FIXTURE = resolve(process.cwd(), '__tests__/fixtures/valid.yml');
const INVALID_FIXTURE = resolve(process.cwd(), '__tests__/fixtures/invalid.yml');

describe('Packaged distribution', () => {
  before(() => {
    execFileSync('pnpm', ['run', 'build'], { stdio: 'pipe' });
  });

  it('contains only expected distribution files in npm pack', () => {
    const stdout = execFileSync('pnpm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
    const jsonStart = stdout.indexOf('{');
    assert.ok(jsonStart !== -1, 'pnpm pack did not return JSON');
    const packInfo = JSON.parse(stdout.slice(jsonStart));

    assert.equal(packInfo.files.length, 4);
    const filePaths = packInfo.files.map((file: { path: string }) => file.path).toSorted();
    assert.deepEqual(filePaths, ['LICENSE', 'README.md', 'dist/cli.js', 'package.json']);
  });

  it('runs successfully with node without tsx wrapper', () => {
    const stdout = execFileSync('node', [DIST_CLI_PATH, VALID_FIXTURE], { encoding: 'utf8' });
    assert.ok(stdout.includes('0 error(s), 0 warning(s)'));
  });

  it('exits with error on invalid fixture using node', () => {
    assert.throws(
      () => {
        execFileSync('node', [DIST_CLI_PATH, INVALID_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
      },
      (err: unknown) => {
        const error = err as { status: number; stderr: string };
        assert.equal(error.status, 1);
        assert.ok(error.stderr.includes("Unrecognized named-value: 'secrets'"));
        return true;
      },
    );
  });
});
