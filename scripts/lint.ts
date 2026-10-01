#!/usr/bin/env -S pnpm exec tsx
import { spawn } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';

const typosTargets = ['.'];
for (const target of ['.github', '.vscode']) {
  try {
    if (statSync(target).isDirectory()) {
      typosTargets.push(target);
    }
  } catch {
    // Directory does not exist
  }
}

rmSync('ghadiag', { force: true });

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

await run('dprint', ['fmt']);

await Promise.all([
  run('dprint', ['check']),
  run('oxlint', ['-c', '.oxlintrc.json', '--deny-warnings']),
  run('typos', typosTargets),
  run('betterleaks', ['dir', '.', '--config', '.betterleaks.toml']),
  run('zizmor', ['--pedantic', '.']),
]);
