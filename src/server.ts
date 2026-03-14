import http, {type IncomingMessage, type ServerResponse} from 'node:http';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {runAILoopSession} from './ai/loop.js';
import {loadEnvFile} from './lib/env.js';
import {PACKAGE_VERSION} from './lib/package.js';
import {detectWorkspace} from './lib/workspace.js';

const DEFAULT_PORT = 8080;

export function createAppServer(): http.Server {
  loadEnvFile();

  return http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response);
    } catch (error: unknown) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unexpected error.'
      });
    }
  });
}

export async function startServer(port = getServerPort()): Promise<http.Server> {
  const server = createAppServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });

  return server;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      version: PACKAGE_VERSION
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/v1/ai/respond') {
    const payload = await readJsonBody(request);
    const input = typeof payload.input === 'string' ? payload.input.trim() : '';

    if (!input) {
      writeJson(response, 400, {
        error: 'Request body must include a non-empty "input" string.'
      });
      return;
    }

    const workspace = await detectWorkspace();
    const chunks: string[] = [];
    const result = await runAILoopSession(input, [], {
      workspace,
      onThinking: () => {
        return;
      },
      onToolCall: () => {
        return;
      },
      onOutput: (text: string) => {
        chunks.push(text);
      }
    });

    if (result.status === 'confirmation_required') {
      writeJson(response, 409, {
        status: result.status,
        message: result.text
      });
      return;
    }

    writeJson(response, 200, {
      status: result.status,
      output: result.text || chunks.join(''),
      responseId: result.responseId
    });
    return;
  }

  writeJson(response, 404, {error: 'Not found'});
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

    if (Buffer.concat(chunks).length > 1_000_000) {
      throw new Error('Request body too large.');
    }
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

function writeJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function getServerPort(): number {
  const parsed = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }

  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  });
}
