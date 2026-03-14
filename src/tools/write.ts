import {mkdir, writeFile as writeFileContents} from 'node:fs/promises';
import path from 'node:path';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

export async function writeFile(
  filePath: string,
  content: string,
  workspace: Workspace
): Promise<ToolResult> {
  const resolvedPath = resolvePath(filePath, workspace.cwd);
  const buffer = Buffer.from(content, 'utf8');

  try {
    await mkdir(path.dirname(resolvedPath), {recursive: true});
    await writeFileContents(resolvedPath, content, 'utf8');

    const relativePath = toWorkspaceRelativePath(resolvedPath, workspace.cwd);
    return {
      status: 'success',
      output: `Written: ${relativePath}  (${buffer.byteLength} bytes)`,
      data: {path: relativePath, bytesWritten: buffer.byteLength}
    };
  } catch (error: unknown) {
    return toToolError(error, filePath);
  }
}

function toWorkspaceRelativePath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath === '.') {
    return path.basename(filePath);
  }

  return relativePath.split(path.sep).join('/');
}

function toToolError(error: unknown, filePath: string): ToolResult {
  if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
    return {
      status: 'permission-denied',
      output: `Permission denied: ${filePath}`,
      error: `Permission denied: ${filePath}`
    };
  }

  if (isErrno(error, 'ENOENT')) {
    return {
      status: 'not-found',
      output: `File not found: ${filePath}`,
      error: `File not found: ${filePath}`
    };
  }

  const message = error instanceof Error ? error.message : 'Unexpected error.';
  return {
    status: normalizeStatus(error),
    output: message,
    error: message
  };
}

function normalizeStatus(error: unknown): ToolStatus {
  if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
    return 'permission-denied';
  }

  if (isErrno(error, 'ENOENT')) {
    return 'not-found';
  }

  return 'error';
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
