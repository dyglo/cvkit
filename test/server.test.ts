import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAppServer} from '../src/server.js';
import {setOpenAIClientFactoryForTests} from '../src/lib/openai.js';
import {resetWorkspaceCacheForTests} from '../src/lib/workspace.js';
import {MockResponsesController, createMessageResponse} from './helpers/fake-openai.js';

test.afterEach(() => {
  setOpenAIClientFactoryForTests(null);
});

test('GET /health returns status and version', async () => {
  const server = createAppServer();
  server.listen(0);
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);

    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.status, 'ok');
    assert.equal(typeof payload.version, 'string');
  } finally {
    await closeServer(server);
  }
});

test('POST /v1/ai/respond returns AI output', async (t) => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-server-workspace-'));
  const originalCwd = process.cwd();
  process.chdir(workspaceDir);
  resetWorkspaceCacheForTests();
  await mkdir(path.join(workspaceDir, 'images'), {recursive: true});

  const controller = new MockResponsesController([
    createMessageResponse('resp-1', 'Server response.', ['Server ', 'response.'])
  ]);

  setOpenAIClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    process.chdir(originalCwd);
    resetWorkspaceCacheForTests();
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const server = createAppServer();
  server.listen(0);
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/ai/respond`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({input: 'describe the workspace'})
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.status, 'completed');
    assert.equal(payload.output, 'Server response.');
    assert.equal(payload.responseId, 'resp-1');

    const requestBody = controller.requests[0] as {tools?: Array<{name?: string}>};
    const toolNames = (requestBody.tools ?? []).map((tool) => tool.name);
    assert.deepEqual(toolNames, [
      'read_file',
      'glob_files',
      'grep_files',
      'inspect_image',
      'list_dir'
    ]);
  } finally {
    await closeServer(server);
  }
});

test('POST /v1/ai/respond rejects missing input', async () => {
  const server = createAppServer();
  server.listen(0);
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/ai/respond`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 400);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.match(String(payload.error), /non-empty "input" string/);
  } finally {
    await closeServer(server);
  }
});

async function closeServer(server: ReturnType<typeof createAppServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
