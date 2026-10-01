# ghadiag

GitHub Actions validator powered by [@actions/languageservice](https://github.com/actions/languageservices).

## Installation

Run directly:

```bash
npx github:kachick/ghadiag
# or with pnpm
pnpm dlx github:kachick/ghadiag
```

## Usage

```bash
# Validate default files (.github/workflows/**/*.{yml,yaml} and action.{yml,yaml})
ghadiag

# Output JSON (useful for LLMs and scripts), for specific files
ghadiag --format=json .github/workflows/ci.yml
```

## Why ghadiag?

`ghadiag` wraps GitHub's official `@actions/languageservice` into a simple standalone CLI.

You do not need this tool if you already use the official VS Code extension and inspect all your workflow and action files by hand.

However, if you let LLM agents write most of your code, you will likely want this tool.

### Filling the gap

Existing tools in the ecosystem are great:

- `actionlint` serves as both a strong validator and linter, including deep shell script checks.
- `zizmor` catches security risks.

Because `actionlint` uses its own custom parser, some patterns that the official VS Code extension catches are not supported yet (though they might be added in the future).

For example, `actionlint` cannot directly validate `action.yml` for composite actions. Running `actionlint action.yml` treats the file as a regular workflow and reports false syntax errors.

In contrast, `ghadiag` validates `action.yml` directly using GitHub's official language service:

```yaml
# action.yml
name: Sample
description: A composite action
runs:
  using: composite
  steps:
    - run: echo "Hello" # ❌ Missing required 'shell' property
```

`ghadiag` catches this mistake right away:

```console
$ ghadiag action.yml
action.yml:6:7: [error] Required property is missing: shell
```

### Catching errors before push

Invalid workflows and actions get rejected by GitHub before starting any checks. You only notice the failure after pushing, and no CI jobs even start. This delays feedback and makes debugging frustrating compared to regular CI failures.

`ghadiag` brings the official language service directly to your terminal. LLM agents and developers can run it locally, catch validation errors early, and fix them before pushing code.
