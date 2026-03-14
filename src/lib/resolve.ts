import {existsSync} from 'node:fs';
import path from 'node:path';
import {getWorkspaceSnapshot} from './workspace.js';

export function resolvePath(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return input;
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  if (isExplicitRelativePath(trimmed) || hasDirectorySegments(trimmed)) {
    return path.resolve(cwd, trimmed);
  }

  const directMatch = path.resolve(cwd, trimmed);
  if (existsSync(directMatch)) {
    return directMatch;
  }

  const workspace = getWorkspaceSnapshot();
  if (!workspace) {
    return input;
  }

  const matches = workspace.allFiles
    .filter((filePath) => path.posix.basename(filePath) === trimmed)
    .sort(compareWorkspaceMatches);

  if (matches.length === 0) {
    return input;
  }

  return path.resolve(workspace.cwd, ...matches[0].split('/'));
}

function isExplicitRelativePath(input: string): boolean {
  return (
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.startsWith('.\\') ||
    input.startsWith('..\\')
  );
}

function hasDirectorySegments(input: string): boolean {
  return input.includes('/') || input.includes('\\');
}

function compareWorkspaceMatches(left: string, right: string): number {
  const leftDepth = depth(left);
  const rightDepth = depth(right);

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'});
}

function depth(filePath: string): number {
  return filePath.split('/').length;
}
