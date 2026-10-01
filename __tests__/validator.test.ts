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
});
