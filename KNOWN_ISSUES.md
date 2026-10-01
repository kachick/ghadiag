# Known Issues

## Upstream ESM and JSON Import in `@actions/languageservice`

- **Issue**:
  - The published `@actions/languageservice` and `@actions/workflow-parser` packages import JSON files without import attributes (e.g., `import workflowSchema from "./workflow-v1.0.min.json"`).
  - Node.js ESM requires `with { type: "json" }` for JSON imports. Running these packages directly with Node.js causes `ERR_IMPORT_ATTRIBUTE_MISSING`.
  - Upstream tracking issue: [actions/languageservices#110](https://github.com/actions/languageservices/issues/110)

- **Impact on testing**:
  - `node --test` cannot run tests that import `@actions/languageservice`.
  - Tests use `tsx --test` because `tsx` automatically handles JSON imports and CommonJS/ESM shims.

- **Impact on npm distribution**:
  - Node.js does not allow TypeScript execution inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
  - Therefore, the CLI cannot point `bin` to a `.ts` file.
  - The CLI bundles dependencies into `dist/cli.js` with `esbuild` and `dependencies/banner.js`. This allows users to run `ghadiag` via `npx` or `node` without errors.
