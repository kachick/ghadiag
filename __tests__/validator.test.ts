import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { formatHuman, validateContent, validateFile } from '../src/validator.ts';

describe('validator', () => {
  it('accepts a valid workflow', async () => {
    const yaml = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "Hello world"
`;
    const result = await validateContent('.github/workflows/ci.yml', yaml);
    assert.equal(result.isValid, true);
    assert.equal(result.diagnostics.length, 0);
  });

  it('detects unexpected field names in a workflow', async () => {
    const yaml = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    invalid_job_field: true
    steps:
      - run: echo "Hello"
`;
    const result = await validateContent('.github/workflows/ci.yml', yaml);
    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("Unexpected value 'invalid_job_field'")));
  });

  it('detects invalid expression context', async () => {
    const yaml = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    if: \${{ nonexistent_context.value == 'foo' }}
    steps:
      - run: echo "Hello"
`;
    const result = await validateContent('.github/workflows/ci.yml', yaml);
    assert.equal(result.isValid, false);
    assert.ok(result.diagnostics.length > 0);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("Unrecognized named-value: 'nonexistent_context'")));
  });

  it('detects secrets context used in step if conditional', async () => {
    const yaml = `
name: CI
on: [push]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying"
        if: secrets.MY_SECRET != ''
`;
    const result = await validateContent('.github/workflows/ci.yml', yaml);
    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("Unrecognized named-value: 'secrets'")));
  });

  it('formats diagnostics as human readable text', async () => {
    const yaml = `
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    bad_field: 123
    steps:
      - run: echo "test"
`;
    const result = await validateContent('.github/workflows/test.yml', yaml);
    assert.equal(result.isValid, false);
    const errorDiag = result.diagnostics.find((d) => d.severity === 'error');
    assert.ok(errorDiag);

    const human = formatHuman(errorDiag);
    assert.ok(human.includes('.github/workflows/test.yml:'));
    assert.ok(human.includes('[error]'));
  });

  it('accepts a valid action.yml', async () => {
    const yaml = `
name: My Action
description: A sample composite action
runs:
  using: composite
  steps:
    - run: echo "Running composite action"
      shell: bash
`;
    const result = await validateContent('action.yml', yaml);
    assert.equal(result.isValid, true);
    assert.equal(result.diagnostics.length, 0);
  });

  it('detects missing required shell property in composite action', async () => {
    const yaml = `
name: My Action
description: A sample composite action
runs:
  using: composite
  steps:
    - run: echo "Running composite action"
`;
    const result = await validateContent('action.yml', yaml);
    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes('Required property is missing: shell')));
  });

  it('accepts valid workflow and action fixtures', async () => {
    const workflowPath = resolve(process.cwd(), '__tests__/fixtures/valid.yml');
    const workflowResult = await validateFile(workflowPath);
    assert.equal(workflowResult.isValid, true);
    assert.equal(workflowResult.diagnostics.length, 0);

    const actionPath = resolve(process.cwd(), '__tests__/fixtures/action.yml');
    const actionResult = await validateFile(actionPath);
    assert.equal(actionResult.isValid, true);
    assert.equal(actionResult.diagnostics.length, 0);
  });

  it('validates nested composite action paths and keeps relative filePath', async () => {
    const yaml = `
name: Nested Action
description: A nested composite action
runs:
  using: composite
  steps:
    - run: echo "Hello"
`;
    const result = await validateContent('.github/actions/my-action/action.yml', yaml);
    assert.equal(result.isValid, false);
    assert.equal(result.filePath, '.github/actions/my-action/action.yml');
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes('Required property is missing: shell')));
  });

  it('detects invalid action input when metadata provider returns action definitions', async () => {
    const yaml = `
name: Sample
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: some-owner/some-action@v1
        with:
          valid_arg: 'hello'
          invalid_arg: 'world'
`;

    const mockProvider = {
      async fetchActionMetadata() {
        return {
          name: 'some-action',
          description: 'A mock action',
          inputs: {
            valid_arg: {
              description: 'A valid input',
              required: false,
            },
          },
        };
      },
    };

    const result = await validateContent('.github/workflows/test.yml', yaml, {
      actionsMetadataProvider: mockProvider,
    });
    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("Invalid action input 'invalid_arg'")));
  });

  it('ignores action inputs in offline mode', async () => {
    const yaml = `
name: Sample
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: some-owner/some-action@v1
        with:
          invalid_arg: 'world'
`;

    const result = await validateContent('.github/workflows/test.yml', yaml, {
      offline: true,
    });
    assert.equal(result.isValid, true);
    assert.equal(result.diagnostics.length, 0);
  });

  it('detects invalid and missing inputs on reusable workflow calls via fileProvider', async () => {
    const reusableYaml = `
name: Reusable
on:
  workflow_call:
    inputs:
      required_input:
        required: true
        type: string
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "ok"
`;

    const callerYaml = `
name: Caller
on: [push]
jobs:
  call-reusable:
    uses: some-owner/some-repo/.github/workflows/reusable.yml@main
    with:
      unknown_input: 'foo'
`;

    const result = await validateContent('.github/workflows/caller.yml', callerYaml, {
      fileProvider: {
        async getFileContent() {
          return {
            name: 'reusable.yml',
            content: reusableYaml,
          };
        },
      },
    });

    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes('unknown_input')));
    assert.ok(messages.some((m) => m.includes('required_input')));
  });

  it('detects when a reusable workflow requests higher permissions than the caller job allows', async () => {
    const reusableYaml = `
name: Reusable Cleanup
on:
  workflow_call:
permissions:
  contents: read
jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - run: echo "cleanup"
`;

    const callerYaml = `
name: Caller
on: [push]
permissions:
  contents: read
jobs:
  remove-old-images:
    permissions:
      packages: write
    uses: some-owner/some-repo/.github/workflows/reusable-cleanup.yml@main
`;

    const result = await validateContent('.github/workflows/caller.yml', callerYaml, {
      fileProvider: {
        async getFileContent() {
          return {
            name: 'reusable-cleanup.yml',
            content: reusableYaml,
          };
        },
      },
    });

    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(
      messages.some((m) =>
        m.includes(
          "Error calling workflow 'some-owner/some-repo/.github/workflows/reusable-cleanup.yml@main'. The workflow is requesting 'contents: read', but is only allowed 'contents: none'.",
        )
      ),
    );
  });

  it('detects when a job overrides permissions without contents: read while using actions/checkout', async () => {
    const workflowYaml = `
name: Minimize
on: [pull_request]
permissions:
  contents: read
jobs:
  minimize:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
      - run: echo "minimize"
`;

    const result = await validateContent('.github/workflows/minimize.yml', workflowYaml, {
      offline: true,
    });

    assert.equal(result.isValid, false);
    const messages = result.diagnostics.map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("Step uses 'actions/checkout' without a custom token")));
  });
});
