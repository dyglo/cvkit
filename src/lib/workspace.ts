import {readdir} from 'node:fs/promises';
import path from 'node:path';

export interface Workspace {
  cwd: string;
  name: string;
  allFiles: string[];
  imageFiles: string[];
  labelFiles: string[];
  totalImages: number;
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.gif', '.avif']);
const LABEL_EXTENSIONS = new Set(['.txt', '.json', '.xml']);
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '.git', 'dist']);

let workspacePromise: Promise<Workspace> | null = null;
let workspaceCache: Workspace | null = null;

export async function detectWorkspace(): Promise<Workspace> {
  if (workspacePromise) {
    return workspacePromise;
  }

  workspacePromise = createWorkspace(process.cwd())
    .then((workspace) => {
      workspaceCache = workspace;
      return workspace;
    })
    .catch((error) => {
      workspacePromise = null;
      throw error;
    });

  return workspacePromise;
}

export function getWorkspaceSnapshot(): Workspace | null {
  return workspaceCache;
}

export function resetWorkspaceCacheForTests(): void {
  workspacePromise = null;
  workspaceCache = null;
}

async function createWorkspace(cwd: string): Promise<Workspace> {
  const allFiles: string[] = [];
  const imageFiles: string[] = [];
  const labelFiles: string[] = [];

  await walkDirectory(cwd, cwd, allFiles, imageFiles, labelFiles);

  allFiles.sort(compareWorkspacePaths);
  imageFiles.sort(compareWorkspacePaths);
  labelFiles.sort(compareWorkspacePaths);

  return {
    cwd,
    name: path.basename(cwd) || cwd,
    allFiles,
    imageFiles,
    labelFiles,
    totalImages: imageFiles.length
  };
}

async function walkDirectory(
  directory: string,
  root: string,
  allFiles: string[],
  imageFiles: string[],
  labelFiles: string[]
): Promise<void> {
  const entries = await readdir(directory, {withFileTypes: true});

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await walkDirectory(fullPath, root, allFiles, imageFiles, labelFiles);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const relativePath = toWorkspacePath(path.relative(root, fullPath));
    allFiles.push(relativePath);

    if (IMAGE_EXTENSIONS.has(extension)) {
      imageFiles.push(relativePath);
      continue;
    }

    if (LABEL_EXTENSIONS.has(extension)) {
      labelFiles.push(relativePath);
    }
  }
}

function toWorkspacePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function compareWorkspacePaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, {numeric: true, sensitivity: 'base'});
}
