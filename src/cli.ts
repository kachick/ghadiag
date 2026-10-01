import { existsSync, globSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatHuman, validateFile, type ValidationResult } from './validator.ts';

const HELP_TEXT = `ghadiag - Validate GitHub Actions workflows and actions

Usage:
  ghadiag [options] [files...]

Options:
  --format <type>  Output format: human or json (default: human)
  -h, --help       Show this help message
  -v, --version    Show version

If no files are specified, ghadiag checks:
  - .github/workflows/*.{yml,yaml}
  - .github/workflows/**/*.{yml,yaml}
  - action.{yml,yaml}
`;

function findDefaultFiles(): string[] {
  const files: string[] = [];

  const workflowPatterns = [
    '.github/workflows/*.yml',
    '.github/workflows/*.yaml',
    '.github/workflows/**/*.yml',
    '.github/workflows/**/*.yaml',
  ];

  for (const pattern of workflowPatterns) {
    try {
      const matched = globSync(pattern);
      files.push(...matched);
    } catch {
      // Ignore glob errors if directory does not exist
    }
  }

  const actionFiles = ['action.yml', 'action.yaml'];
  for (const actionFile of actionFiles) {
    if (existsSync(actionFile)) {
      files.push(actionFile);
    }
  }

  // De-duplicate paths
  return Array.from(new Set(files.map((f) => resolve(process.cwd(), f))));
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
      version: {
        type: 'boolean',
        short: 'v',
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (values.version) {
    console.log('0.1.0');
    process.exit(0);
  }

  const format = values.format ?? 'human';

  if (format !== 'human' && format !== 'json') {
    console.error(`Invalid format: ${format}. Allowed values: human, json`);
    process.exit(1);
  }

  let targetFiles = positionals;
  if (targetFiles.length === 0) {
    targetFiles = findDefaultFiles();
    if (targetFiles.length === 0) {
      console.log('No workflow or action files found to validate.');
      process.exit(0);
    }
  }

  const results: ValidationResult[] = await Promise.all(
    targetFiles.map(async (file) => {
      try {
        return await validateFile(file);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          filePath: file,
          isValid: false,
          diagnostics: [
            {
              filePath: file,
              message: `Failed to read or parse file: ${message}`,
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 1,
              severity: 'error' as const,
            },
          ],
        };
      }
    }),
  );

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of results) {
    for (const diag of result.diagnostics) {
      if (diag.severity === 'error') {
        totalErrors++;
      } else if (diag.severity === 'warning') {
        totalWarnings++;
      }

      if (format === 'human') {
        console.error(formatHuman(diag));
      }
    }
  }

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else if (format === 'human') {
    console.log(
      `\nValidated ${targetFiles.length} file(s): ${totalErrors} error(s), ${totalWarnings} warning(s)`,
    );
  }

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
