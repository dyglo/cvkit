import {spawn} from 'node:child_process';
import path from 'node:path';

const PYTHON_CANDIDATES: Array<{command: string; prefixArgs: string[]}> = [
  {command: 'python3', prefixArgs: []},
  {command: 'python', prefixArgs: []},
  {command: 'py', prefixArgs: ['-3']}
];

export async function runPythonWorker<T>(workerFile: string, args: string[]): Promise<T> {
  const workerPath = path.join(process.cwd(), 'workers', workerFile);
  let lastError: Error | null = null;

  for (const candidate of PYTHON_CANDIDATES) {
    try {
      return await spawnWorker<T>(candidate.command, [...candidate.prefixArgs, workerPath, ...args]);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === '__PYTHON_NOT_FOUND__') {
        lastError = error;
        continue;
      }

      throw remapPythonError(error);
    }
  }

  throw remapPythonError(lastError);
}

function spawnWorker<T>(command: string, args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(new Error('__PYTHON_NOT_FOUND__'));
        return;
      }

      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Worker ${workerFileName(args[0])} exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error(`Worker output is not valid JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

function workerFileName(value?: string): string {
  return value ? path.basename(value) : 'worker';
}

function remapPythonError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.message === '__PYTHON_NOT_FOUND__') {
      return new Error('Python 3.8+ required. Install from https://python.org');
    }

    if (/No module named|ModuleNotFoundError/i.test(error.message)) {
      return new Error('Missing dependencies. Run: pip install -r workers/requirements.txt');
    }

    return error;
  }

  return new Error('Python worker failed.');
}
