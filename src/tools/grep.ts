import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import {isSupportedImagePath} from '../lib/image.js';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

const IGNORED_PATTERNS = ['node_modules/**', '.git/**', 'dist/**'];
const HEADER_SEPARATOR = '──────────────────────────────────────────';
const MAX_MATCHES = 50;

export async function grepFiles(
  pattern: string,
  workspace: Workspace,
  options: {
    path?: string;
    filePattern?: string;
    contextLines?: number;
  } = {}
): Promise<ToolResult> {
  const scopePath = options.path?.trim() ? resolvePath(options.path, workspace.cwd) : workspace.cwd;
  const filePattern = options.filePattern?.trim()
    ? normalizeFilePattern(options.filePattern)
    : '**/*';
  const contextLines = Math.max(options.contextLines ?? 0, 0);

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (error: unknown) {
    const message = error instanceof Error ? `Invalid regular expression: ${error.message}` : 'Invalid regular expression.';
    return {
      status: 'error',
      output: message,
      error: message
    };
  }

  try {
    const files = await fg(filePattern, {
      cwd: scopePath,
      onlyFiles: true,
      absolute: true,
      dot: true,
      ignore: IGNORED_PATTERNS
    });

    const renderedMatches: string[] = [];
    let matchCount = 0;
    const matchedFiles = new Set<string>();
    let truncated = false;

    for (const filePath of files) {
      if (isSupportedImagePath(filePath)) {
        continue;
      }

      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) {
        continue;
      }

      const buffer = await readFile(filePath);
      if (!isLikelyText(buffer)) {
        continue;
      }

      const content = buffer.toString('utf8');
      const lines = splitLines(content);

      for (let index = 0; index < lines.length; index += 1) {
        regex.lastIndex = 0;
        if (!regex.test(lines[index])) {
          continue;
        }

        matchCount += 1;
        matchedFiles.add(filePath);
        renderedMatches.push(formatMatchLine(filePath, workspace.cwd, index + 1, lines[index]));

        if (contextLines > 0) {
          const start = Math.max(0, index - contextLines);
          const end = Math.min(lines.length - 1, index + contextLines);

          for (let contextIndex = start; contextIndex <= end; contextIndex += 1) {
            if (contextIndex === index) {
              continue;
            }

            renderedMatches.push(
              `  ${contextIndex + 1}  ${lines[contextIndex]}`
            );
          }
        }

        if (matchCount >= MAX_MATCHES) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        break;
      }
    }

    const filePatternLabel = options.filePattern?.trim() ? options.filePattern : 'all files';
    const footer =
      matchCount === 0
        ? '0 matches in 0 files'
        : `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${matchedFiles.size} file${matchedFiles.size === 1 ? '' : 's'}`;

    const suffix = truncated ? `\nStopped after ${MAX_MATCHES} matches. Narrow your pattern to see more.` : '';

    return {
      status: 'success',
      output: [
        `Pattern: "${pattern}"`,
        `Files:   ${filePatternLabel}`,
        HEADER_SEPARATOR,
        ...(renderedMatches.length > 0 ? renderedMatches : ['No matches found.']),
        HEADER_SEPARATOR,
        `${footer}${suffix}`
      ].join('\n'),
      data: {matches: matchCount, files: matchedFiles.size}
    };
  } catch (error: unknown) {
    return toToolError(error, options.path ?? workspace.cwd);
  }
}

function formatMatchLine(filePath: string, cwd: string, lineNumber: number, line: string): string {
  const relativePath = path.relative(cwd, filePath).split(path.sep).join('/');
  return `${relativePath}:${lineNumber}    ${line}`;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

function normalizeFilePattern(pattern: string): string {
  const normalized = normalizePattern(pattern);
  if (normalized.includes('/')) {
    return normalized;
  }

  return `**/${normalized}`;
}

function splitLines(content: string): string[] {
  if (!content) {
    return [''];
  }

  const lines = content.split(/\r?\n/);
  if (content.endsWith('\n') && lines.at(-1) === '') {
    lines.pop();
  }

  return lines.length > 0 ? lines : [''];
}

function isLikelyText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  let controlBytes = 0;
  const sampleSize = Math.min(buffer.length, 1024);

  for (let index = 0; index < sampleSize; index += 1) {
    const value = buffer[index];
    if (value === 0) {
      return false;
    }

    if (value < 7 || (value > 14 && value < 32)) {
      controlBytes += 1;
    }
  }

  return controlBytes / sampleSize < 0.1;
}

function toToolError(error: unknown, target: string): ToolResult {
  if (isErrno(error, 'ENOENT')) {
    return {
      status: 'not-found',
      output: `File not found: ${target}`,
      error: `File not found: ${target}`
    };
  }

  if (isErrno(error, 'EACCES') || isErrno(error, 'EPERM')) {
    return {
      status: 'permission-denied',
      output: `Permission denied: ${target}`,
      error: `Permission denied: ${target}`
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
