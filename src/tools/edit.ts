import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

const HEADER_SEPARATOR = '──────────────────────────────────────────';

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  workspace: Workspace
): Promise<ToolResult> {
  const resolvedPath = resolvePath(filePath, workspace.cwd);

  try {
    const original = await readFile(resolvedPath, 'utf8');
    const matchCount = countOccurrences(original, oldString);
    if (matchCount === 0) {
      return {
        status: 'error',
        output: 'Target string not found in file — no changes made',
        error: 'Target string not found in file — no changes made'
      };
    }

    if (matchCount > 1) {
      return {
        status: 'error',
        output: `Target string found ${matchCount} times — be more specific`,
        error: `Target string found ${matchCount} times — be more specific`
      };
    }

    const matchIndex = original.indexOf(oldString);
    const updated = `${original.slice(0, matchIndex)}${newString}${original.slice(matchIndex + oldString.length)}`;
    await writeFile(resolvedPath, updated, 'utf8');

    const relativePath = toWorkspaceRelativePath(resolvedPath, workspace.cwd);
    const oldLines = splitDiffLines(oldString);
    const newLines = splitDiffLines(newString);
    const red = chalk.level > 0 ? chalk.red : (value: string) => value;
    const green = chalk.level > 0 ? chalk.green : (value: string) => value;

    return {
      status: 'success',
      output: [
        `Edited: ${relativePath}`,
        HEADER_SEPARATOR,
        ...oldLines.map((line) => red(`- ${line}`)),
        ...newLines.map((line) => green(`+ ${line}`)),
        HEADER_SEPARATOR,
        '1 change applied.'
      ].join('\n'),
      data: {path: relativePath, changes: 1}
    };
  } catch (error: unknown) {
    return toToolError(error, filePath);
  }
}

function countOccurrences(content: string, search: string): number {
  if (!search) {
    return 0;
  }

  let count = 0;
  let currentIndex = 0;

  while (currentIndex < content.length) {
    const matchIndex = content.indexOf(search, currentIndex);
    if (matchIndex === -1) {
      break;
    }

    count += 1;
    currentIndex = matchIndex + search.length;
  }

  return count;
}

function splitDiffLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (content.endsWith('\n') && lines.at(-1) === '') {
    lines.pop();
  }

  return lines.length > 0 ? lines : [''];
}

function toWorkspaceRelativePath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath === '.') {
    return path.basename(filePath);
  }

  return relativePath.split(path.sep).join('/');
}

function toToolError(error: unknown, filePath: string): ToolResult {
  if (isErrno(error, 'ENOENT')) {
    return {
      status: 'not-found',
      output: `File not found: ${filePath}`,
      error: `File not found: ${filePath}`
    };
  }

  if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
    return {
      status: 'permission-denied',
      output: `Permission denied: ${filePath}`,
      error: `Permission denied: ${filePath}`
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
