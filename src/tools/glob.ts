import {stat} from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

const IGNORED_PATTERNS = ['node_modules/**', '.git/**', 'dist/**'];
const HEADER_SEPARATOR = '──────────────────────────────────────────';

export async function globFiles(
  pattern: string,
  workspace: Workspace,
  searchPath?: string
): Promise<ToolResult> {
  const scopePath = searchPath?.trim() ? resolvePath(searchPath, workspace.cwd) : workspace.cwd;
  const normalizedPattern = normalizePattern(pattern);

  try {
    const absoluteMatches = await fg(normalizedPattern, {
      cwd: scopePath,
      onlyFiles: true,
      absolute: true,
      dot: true,
      ignore: IGNORED_PATTERNS
    });

    const matchesWithStats = await Promise.all(
      absoluteMatches.map(async (absolutePath) => ({
        absolutePath,
        stats: await stat(absolutePath)
      }))
    );

    matchesWithStats.sort((left, right) => {
      const modifiedDelta = right.stats.mtimeMs - left.stats.mtimeMs;
      if (modifiedDelta !== 0) {
        return modifiedDelta;
      }

      return left.absolutePath.localeCompare(right.absolutePath, undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });

    const relativeMatches = matchesWithStats.map(({absolutePath}) =>
      toWorkspaceRelativePath(absolutePath, workspace.cwd)
    );
    const scopeLabel = toDisplayScope(scopePath, workspace.cwd);

    return {
      status: 'success',
      output: [
        `Pattern: ${pattern}`,
        `Path:    ${scopeLabel}`,
        HEADER_SEPARATOR,
        ...(relativeMatches.length > 0 ? relativeMatches : ['No files matched.']),
        HEADER_SEPARATOR,
        `${relativeMatches.length} file${relativeMatches.length === 1 ? '' : 's'} matched`
      ].join('\n'),
      data: relativeMatches
    };
  } catch (error: unknown) {
    return toToolError(searchPath ?? workspace.cwd, error);
  }
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

function toWorkspaceRelativePath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  return relativePath.split(path.sep).join('/');
}

function toDisplayScope(scopePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, scopePath);
  if (!relativePath || relativePath === '.') {
    return './';
  }

  return `./${relativePath.split(path.sep).join('/').replace(/\/?$/, '/')}`;
}

function toToolError(target: string, errorTarget: unknown): ToolResult {
  if (isErrno(errorTarget, 'EACCES') || isErrno(errorTarget, 'EPERM')) {
    return {
      status: 'permission-denied',
      output: `Permission denied: ${target}`,
      error: `Permission denied: ${target}`
    };
  }

  const message = errorTarget instanceof Error ? errorTarget.message : 'Unexpected error.';
  return {
    status: normalizeStatus(errorTarget),
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
