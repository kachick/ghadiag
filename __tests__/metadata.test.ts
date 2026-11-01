import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createActionsMetadataProvider } from '../src/metadata.ts';

describe('metadata', () => {
  it('fetches and parses action metadata via custom fetch', async () => {
    const yamlContent = `
name: Sample Action
description: A sample action for testing
inputs:
  sample_input:
    description: Sample input description
    required: true
`;

    const customFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.ok(url.includes('https://api.github.com/repos/sample-owner/sample-repo/contents/action.yml?ref=v1'));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers['Authorization'], 'Bearer test-token');
      return new Response(yamlContent, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.github.raw+yaml' },
      });
    };

    const provider = createActionsMetadataProvider({
      token: 'test-token',
      customFetch,
    });

    const metadata = await provider.fetchActionMetadata({
      owner: 'sample-owner',
      name: 'sample-repo',
      ref: 'v1',
    });

    assert.ok(metadata);
    assert.equal(metadata.name, 'Sample Action');
    assert.equal(metadata.description, 'A sample action for testing');
    assert.equal(metadata.inputs?.['sample_input']?.required, true);
  });

  it('falls back to action.yaml when action.yml is 404', async () => {
    const yamlContent = `
name: YAML Action
description: Action defined with action.yaml
`;

    let callCount = 0;
    const customFetch: typeof fetch = async (input) => {
      callCount++;
      const url = String(input);
      if (url.includes('action.yml')) {
        return new Response('Not Found', { status: 404 });
      }
      if (url.includes('action.yaml')) {
        return new Response(yamlContent, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    };

    const provider = createActionsMetadataProvider({ customFetch });
    const metadata = await provider.fetchActionMetadata({
      owner: 'sample-owner',
      name: 'sample-repo',
      ref: 'v2',
    });

    assert.ok(metadata);
    assert.equal(metadata.name, 'YAML Action');
    assert.equal(callCount, 2);
  });

  it('caches identical action metadata across repeated calls', async () => {
    let callCount = 0;
    const customFetch: typeof fetch = async () => {
      callCount++;
      return new Response('name: Cached Action', { status: 200 });
    };

    const provider = createActionsMetadataProvider({ customFetch });
    const ref = {
      owner: 'sample-owner',
      name: 'sample-repo',
      ref: 'v3',
    };

    const first = await provider.fetchActionMetadata(ref);
    const second = await provider.fetchActionMetadata(ref);

    assert.equal(first?.name, 'Cached Action');
    assert.equal(second?.name, 'Cached Action');
    assert.equal(callCount, 1);
  });
});
