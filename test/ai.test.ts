import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAILoopSession, type ConversationMessage} from '../src/ai/loop.js';
import {READ_ONLY_AI_TOOL_NAMES} from '../src/ai/tools.js';
import {getClient, setClientFactoryForTests} from '../src/lib/ai-client.js';
import {routeCommand} from '../src/repl/router.js';
import type {Workspace} from '../src/lib/workspace.js';
import {
  MockResponsesController,
  createFunctionCallResponse,
  createMessageResponse
} from './helpers/fake-ai-client.js';

test.afterEach(() => {
  setClientFactoryForTests(null);
});

test('natural language input is routed to the AI loop', async () => {
  const workspace = createWorkspace(process.cwd());
  const result = await routeCommand('find all jpg files', workspace);

  assert.deepEqual(result, {
    type: 'ai',
    input: 'find all jpg files'
  });
});

test('direct commands still route to existing handlers', async () => {
  const workspace = createWorkspace(process.cwd());
  const result = await routeCommand('help', workspace);

  assert.equal(result.type, 'output');
  assert.match(result.message, /Available commands/);
});

test('AI loop calls glob_files for jpg discovery requests', async (t) => {
  const workspaceDir = await createWorkspaceDir({
    'images/a.jpg': 'binary',
    'images/b.jpg': 'binary'
  });
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController([
    createFunctionCallResponse('call-1', 'glob_files', {pattern: '**/*.jpg'}),
    createMessageResponse('Found 2 JPG files.')
  ]);
  const toolCalls: Array<{tool: string; args: unknown}> = [];

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const result = await runAILoopSession('find all jpg files', [], {
    workspace,
    onThinking: () => {
      return;
    },
    onToolCall: (tool, args) => {
      toolCalls.push({tool, args});
    },
    onOutput: () => {
      return;
    }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Found 2 JPG files.');
  assert.equal(toolCalls[0]?.tool, 'glob_files');
  assert.deepEqual(toolCalls[0]?.args, {pattern: '**/*.jpg', path: undefined});
});

test('AI loop handles tool errors and continues to a final response', async (t) => {
  const workspaceDir = await createWorkspaceDir();
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController((body, index) => {
    if (index === 0) {
      return createFunctionCallResponse('call-1', 'read_file', {path: 'missing.txt'});
    }

    const contents = body.contents as Array<{parts?: Array<{functionResponse?: {response?: {output?: string}}}>}>;
    const functionResponse = contents.at(-1)?.parts?.[0]?.functionResponse?.response;
    assert.match(String(functionResponse?.output ?? ''), /Tool status: not-found/);
    return createMessageResponse('I could not read missing.txt because it does not exist.');
  });

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const result = await runAILoopSession('read missing.txt', [], {
    workspace,
    onThinking: () => {
      return;
    },
    onToolCall: () => {
      return;
    },
    onOutput: () => {
      return;
    }
  });

  assert.equal(result.status, 'completed');
  assert.match(result.text, /does not exist/);
});

test('AI loop stops after 10 iterations', async (t) => {
  const workspaceDir = await createWorkspaceDir();
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController((_, index) =>
    createFunctionCallResponse(`call-${index + 1}`, 'list_dir', {path: '.'})
  );

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const result = await runAILoopSession('keep listing', [], {
    workspace,
    onThinking: () => {
      return;
    },
    onToolCall: () => {
      return;
    },
    onOutput: () => {
      return;
    }
  });

  assert.equal(result.status, 'completed');
  assert.match(result.text, /stopped after 10 tool iterations/i);
});

test('conversation history is replayed into Gemini contents across turns', async (t) => {
  const workspaceDir = await createWorkspaceDir();
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController((body, index) => {
    if (index === 0) {
      const contents = body.contents as Array<{role?: string; parts?: Array<{text?: string}>}>;
      assert.equal(contents.length, 1);
      assert.equal(contents[0]?.parts?.[0]?.text, 'first question');
      return createMessageResponse('First answer.');
    }

    const contents = body.contents as Array<{role?: string; parts?: Array<{text?: string}>}>;
    assert.equal(contents.length, 3);
    assert.equal(contents[0]?.role, 'user');
    assert.equal(contents[1]?.role, 'model');
    assert.equal(contents[2]?.parts?.[0]?.text, 'second question');
    return createMessageResponse('Second answer.');
  });

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const firstResult = await runAILoopSession('first question', [], {
    workspace,
    onThinking: () => {
      return;
    },
    onToolCall: () => {
      return;
    },
    onOutput: () => {
      return;
    }
  });

  assert.equal(firstResult.status, 'completed');

  const history: ConversationMessage[] = [
    {role: 'user', content: 'first question'},
    {
      role: 'assistant',
      content: firstResult.text,
      responseId: firstResult.responseId ?? undefined
    }
  ];

  const secondResult = await runAILoopSession('second question', history, {
    workspace,
    onThinking: () => {
      return;
    },
    onToolCall: () => {
      return;
    },
    onOutput: () => {
      return;
    }
  });

  assert.equal(secondResult.status, 'completed');
  assert.equal(secondResult.text, 'Second answer.');
});

test('thinking updates include the tool name being executed', async (t) => {
  const workspaceDir = await createWorkspaceDir({
    'images/a.jpg': 'binary'
  });
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController([
    createFunctionCallResponse('call-1', 'glob_files', {pattern: '**/*.jpg'}),
    createMessageResponse('Done.')
  ]);
  const statuses: string[] = [];

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  await runAILoopSession('find jpg files', [], {
    workspace,
    onThinking: (message) => {
      statuses.push(message);
    },
    onToolCall: () => {
      return;
    },
    onOutput: () => {
      return;
    }
  });

  assert.ok(statuses.includes('Thinking...'));
  assert.ok(statuses.includes('Calling glob_files for pattern "**/*.jpg"...'));
});

test('read-only AI sessions reject unavailable mutating tools', async (t) => {
  const workspaceDir = await createWorkspaceDir();
  const workspace = createWorkspace(workspaceDir);
  const controller = new MockResponsesController([
    createFunctionCallResponse('call-1', 'write_file', {
      path: 'labels/new.txt',
      content: 'hello'
    })
  ]);
  const output: string[] = [];

  setClientFactoryForTests(() => controller.createClient());
  t.after(async () => {
    await rm(workspaceDir, {recursive: true, force: true});
  });

  const result = await runAILoopSession('write a file', [], {
    workspace,
    toolNames: READ_ONLY_AI_TOOL_NAMES,
    onThinking: () => {
      return;
    },
    onToolCall: () => {
      return;
    },
    onOutput: (text) => {
      output.push(text);
    }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Model requested unavailable tool: write_file.');
  assert.deepEqual(output, ['Model requested unavailable tool: write_file.']);
});

test('getClient uses CVKIT_GEMINI_KEY when no user key is configured', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-ai-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalEnvKey = process.env.CVKIT_GEMINI_KEY;

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CVKIT_GEMINI_KEY = 'gemini-env-fallback';
  setClientFactoryForTests(null);

  try {
    const client = await getClient();
    assert.ok(client);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalEnvKey === undefined) {
      delete process.env.CVKIT_GEMINI_KEY;
    } else {
      process.env.CVKIT_GEMINI_KEY = originalEnvKey;
    }

    await rm(home, {recursive: true, force: true});
  }
});

function createWorkspace(cwd: string): Workspace {
  return {
    cwd,
    name: path.basename(cwd),
    allFiles: [],
    imageFiles: [],
    labelFiles: [],
    totalImages: 0
  };
}

async function createWorkspaceDir(files: Record<string, string> = {}): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-ai-workspace-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(workspaceDir, relativePath);
    await mkdir(path.dirname(absolutePath), {recursive: true});
    await writeFile(absolutePath, content, 'utf8');
  }

  return workspaceDir;
}
