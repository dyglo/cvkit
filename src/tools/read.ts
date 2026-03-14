import {readFile as readFileContents, stat} from 'node:fs/promises';
import path from 'node:path';
import {formatBytes, inspectImage, isSupportedImagePath} from '../lib/image.js';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

const MAX_LINES = 200;
const HEADER_SEPARATOR = '──────────────────────────────────────────';

export async function readFile(filePath: string, workspace: Workspace): Promise<ToolResult> {
  const resolvedPath = resolvePath(filePath, workspace.cwd);

  try {
    const fileInfo = await stat(resolvedPath);
    if (!fileInfo.isFile()) {
      return notFoundResult(filePath);
    }

    if (isSupportedImagePath(resolvedPath)) {
      const metadata = await inspectImage(resolvedPath);
      const relativePath = toWorkspaceRelativePath(resolvedPath, workspace.cwd);
      const lines = [
        `File: ${relativePath}`,
        `Size: ${formatBytes(fileInfo.size)}  |  Modified: ${formatDate(fileInfo.mtime)}`,
        HEADER_SEPARATOR,
        `Format: ${metadata.format}`,
        `Dimensions: ${metadata.width} × ${metadata.height}`,
        `Channels: ${metadata.channels} (${metadata.channelLabel})`,
        `Color mode: ${metadata.colorMode}`,
        `Has alpha: ${metadata.hasAlpha ? 'Yes' : 'No'}`,
        `Bit depth: ${metadata.bitDepth}`
      ];

      return {
        status: 'success',
        output: lines.join('\n'),
        data: metadata
      };
    }

    const buffer = await readFileContents(resolvedPath);
    const relativePath = toWorkspaceRelativePath(resolvedPath, workspace.cwd);

    if (!isLikelyText(buffer)) {
      return {
        status: 'success',
        output: [
          `File: ${relativePath}`,
          `Size: ${formatBytes(fileInfo.size)}  |  Modified: ${formatDate(fileInfo.mtime)}`,
          HEADER_SEPARATOR,
          'Binary file (contents not shown).'
        ].join('\n'),
        data: {path: relativePath, binary: true, size: fileInfo.size}
      };
    }

    const content = buffer.toString('utf8');
    const lines = splitLines(content);
    const visibleLines = lines.slice(0, MAX_LINES);
    const lineWidth = String(Math.max(lines.length, visibleLines.length, 1)).length;
    const numberedLines = visibleLines.map(
      (line, index) => `${String(index + 1).padStart(lineWidth, ' ')}  ${line}`
    );

    if (lines.length > MAX_LINES) {
      numberedLines.push(`... (${lines.length - MAX_LINES} more lines)`);
    }

    return {
      status: 'success',
      output: [
        `File: ${relativePath}`,
        `Size: ${formatBytes(fileInfo.size)}  |  Modified: ${formatDate(fileInfo.mtime)}`,
        HEADER_SEPARATOR,
        ...numberedLines
      ].join('\n'),
      data: {path: relativePath, content}
    };
  } catch (error: unknown) {
    return toToolError(error, filePath);
  }
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

function toWorkspaceRelativePath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath === '.') {
    return path.basename(filePath);
  }

  return relativePath.split(path.sep).join('/');
}

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function notFoundResult(filePath: string): ToolResult {
  return {
    status: 'not-found',
    output: `File not found: ${filePath}`,
    error: `File not found: ${filePath}`
  };
}

function toToolError(error: unknown, filePath: string): ToolResult {
  if (isErrno(error, 'ENOENT')) {
    return notFoundResult(filePath);
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
