import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const bannerText = readFileSync(join(process.cwd(), 'dependencies', 'banner.js'), 'utf8');

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  format: 'esm',
  target: 'node26',
  platform: 'node',
  banner: {
    js: `#!/usr/bin/env node\n${bannerText}`,
  },
});
