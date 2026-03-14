import {readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import {formatBytes, inspectImage, isSupportedImagePath} from '../lib/image.js';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import type {ToolResult, ToolStatus} from './types.js';

const HEADER_SEPARATOR = '──────────────────────────────────────────';
const LABEL_EXTENSIONS = new Set(['.txt', '.json', '.xml']);

export async function listDir(dirPath: string, workspace: Workspace): Promise<ToolResult> {
  const targetPath = dirPath.trim() ? resolvePath(dirPath, workspace.cwd) : workspace.cwd;

  try {
    const directoryStat = await stat(targetPath);
    if (!directoryStat.isDirectory()) {
      return {
        status: 'error',
        output: `Not a directory: ${dirPath || '.'}`,
        error: `Not a directory: ${dirPath || '.'}`
      };
    }

    const entries = await readdir(targetPath, {withFileTypes: true});
    const renderedEntries = await Promise.all(
      entries
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, {numeric: true, sensitivity: 'base'})
        )
        .map(async (entry) => renderEntry(entry.name, targetPath))
    );

    const counts = summarizeEntries(renderedEntries);
    const directoryLabel = toDisplayDirectory(targetPath, workspace.cwd);

    return {
      status: 'success',
      output: [
        `Directory: ${directoryLabel}`,
        HEADER_SEPARATOR,
        ...(renderedEntries.length > 0 ? renderedEntries.map((entry) => entry.line) : ['(empty directory)']),
        HEADER_SEPARATOR,
        formatSummary(counts)
      ].join('\n'),
      data: renderedEntries.map((entry) => entry.name)
    };
  } catch (error: unknown) {
    return toToolError(error, dirPath || '.');
  }
}

async function renderEntry(
  entryName: string,
  directoryPath: string
): Promise<{kind: 'image' | 'label' | 'directory' | 'other'; line: string; name: string}> {
  const fullPath = path.join(directoryPath, entryName);
  const fileInfo = await stat(fullPath);

  if (fileInfo.isDirectory()) {
    const childEntries = await readdir(fullPath);
    return {
      kind: 'directory',
      name: entryName,
      line: `${styleDirectory(`${entryName}/`).padEnd(20)}dir    ${childEntries.length} item${childEntries.length === 1 ? '' : 's'}`
    };
  }

  const extension = path.extname(entryName).toLowerCase();
  if (isSupportedImagePath(fullPath)) {
    const metadata = await inspectImage(fullPath);
    return {
      kind: 'image',
      name: entryName,
      line: `${styleImage(entryName).padEnd(20)}${metadata.format.padEnd(6)}${`${metadata.width}×${metadata.height}`.padEnd(12)}${formatBytes(fileInfo.size)}`
    };
  }

  if (LABEL_EXTENSIONS.has(extension)) {
    return {
      kind: 'label',
      name: entryName,
      line: `${styleLabel(entryName).padEnd(20)}${extension.slice(1).toUpperCase().padEnd(6)}${formatBytes(fileInfo.size)}`
    };
  }

  return {
    kind: 'other',
    name: entryName,
    line: `${styleOther(entryName).padEnd(20)}${extension.replace(/^\./, '').toUpperCase().padEnd(6)}${formatBytes(fileInfo.size)}`
  };
}

function summarizeEntries(entries: Array<{kind: 'image' | 'label' | 'directory' | 'other'}>): {
  images: number;
  labels: number;
  directories: number;
  other: number;
} {
  return entries.reduce(
    (summary, entry) => {
      switch (entry.kind) {
        case 'image':
          summary.images += 1;
          break;
        case 'label':
          summary.labels += 1;
          break;
        case 'directory':
          summary.directories += 1;
          break;
        case 'other':
          summary.other += 1;
          break;
      }
      return summary;
    },
    {images: 0, labels: 0, directories: 0, other: 0}
  );
}

function formatSummary(counts: {images: number; labels: number; directories: number; other: number}): string {
  const parts: string[] = [];
  if (counts.images > 0) {
    parts.push(`${counts.images} image${counts.images === 1 ? '' : 's'}`);
  }
  if (counts.labels > 0) {
    parts.push(`${counts.labels} label file${counts.labels === 1 ? '' : 's'}`);
  }
  if (counts.directories > 0) {
    parts.push(`${counts.directories} director${counts.directories === 1 ? 'y' : 'ies'}`);
  }
  if (counts.other > 0 || parts.length === 0) {
    parts.push(`${counts.other} other file${counts.other === 1 ? '' : 's'}`);
  }

  return parts.join(', ');
}

function toDisplayDirectory(dirPath: string, cwd: string): string {
  const relativePath = path.relative(cwd, dirPath);
  if (!relativePath || relativePath === '.') {
    return './';
  }

  return `./${relativePath.split(path.sep).join('/')}/`;
}

function styleImage(value: string): string {
  return chalk.level > 0 ? chalk.hex('#4ecdc4')(value) : value;
}

function styleLabel(value: string): string {
  return chalk.level > 0 ? chalk.white(value) : value;
}

function styleDirectory(value: string): string {
  return chalk.level > 0 ? chalk.cyan(value) : value;
}

function styleOther(value: string): string {
  return chalk.level > 0 ? chalk.gray(value) : value;
}

function toToolError(error: unknown, target: string): ToolResult {
  if (isErrno(error, 'ENOENT')) {
    return {
      status: 'not-found',
      output: `Directory not found: ${target}`,
      error: `Directory not found: ${target}`
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
