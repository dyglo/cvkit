import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PYTHON_CANDIDATES: Array<{command: string; prefixArgs: string[]}> = [
  {command: 'python3', prefixArgs: []},
  {command: 'python', prefixArgs: []},
  {command: 'py', prefixArgs: ['-3']}
];

export class PythonWorkerError extends Error {
  stderr: string;
  stdout: string;
  exitCode?: number;

  constructor(message: string, options: {stderr?: string; stdout?: string; exitCode?: number} = {}) {
    super(message);
    this.name = 'PythonWorkerError';
    this.stderr = options.stderr ?? '';
    this.stdout = options.stdout ?? '';
    this.exitCode = options.exitCode;
  }
}

export async function runPythonWorker<T>(workerFile: string, args: string[]): Promise<T> {
  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'workers', workerFile);
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
        reject(
          new PythonWorkerError(stderr.trim() || `Worker ${workerFileName(args)} exited with code ${code}`, {
            stderr,
            stdout,
            exitCode: code ?? undefined
          })
        );
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

function workerFileName(args: string[]): string {
  const candidate = [...args].reverse().find((value) => value.endsWith('.py'));
  return candidate ? path.basename(candidate) : 'worker';
}

function remapPythonError(error: unknown): Error {
  if (error instanceof PythonWorkerError) {
    if (/No module named|ModuleNotFoundError/i.test(error.message) || /No module named|ModuleNotFoundError/i.test(error.stderr)) {
      return new Error('Missing dependencies. Run: pip install -r workers/requirements.txt');
    }

    return error;
  }

  if (error instanceof Error) {
    if (error.message === '__PYTHON_NOT_FOUND__') {
      return new Error('Python 3.9+ required. Install from https://python.org');
    }

    if (/No module named|ModuleNotFoundError/i.test(error.message)) {
      return new Error('Missing dependencies. Run: pip install -r workers/requirements.txt');
    }

    return error;
  }

  return new Error('Python worker failed.');
}
