import path from 'node:path';
import {formatBytes, inspectImage} from '../lib/image.js';
import {resolvePath} from '../lib/resolve.js';
import type {Workspace} from '../lib/workspace.js';
import {editFile, globFiles, grepFiles, listDir, readFile, writeFile} from '../tools/index.js';
import type {ToolResult} from '../tools/index.js';

export type AIToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'glob_files'
  | 'grep_files'
  | 'inspect_image'
  | 'list_dir';

export const ALL_AI_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'glob_files',
  'grep_files',
  'inspect_image',
  'list_dir'
] as const satisfies readonly AIToolName[];

export const READ_ONLY_AI_TOOL_NAMES = [
  'read_file',
  'glob_files',
  'grep_files',
  'inspect_image',
  'list_dir'
] as const satisfies readonly AIToolName[];

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to workspace'
        }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'write_file',
    description: 'Create or overwrite a file with given content',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string'},
        content: {type: 'string'}
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'edit_file',
    description: 'Make a targeted string replacement in an existing file',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {type: 'string'},
        old_string: {
          type: 'string',
          description: 'Exact string to replace'
        },
        new_string: {
          type: 'string',
          description: 'Replacement string'
        }
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'glob_files',
    description: 'Find files matching a glob pattern in the workspace',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern such as **/*.jpg'
        },
        path: {
          type: ['string', 'null'],
          description: 'Optional subdirectory to search in'
        }
      },
      required: ['pattern', 'path'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'grep_files',
    description: 'Search file contents for a pattern across the workspace',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern or regular expression'
        },
        file_pattern: {
          type: ['string', 'null'],
          description: 'Filter files such as *.txt'
        },
        context_lines: {
          type: ['number', 'null'],
          description: 'Lines of context around each match'
        }
      },
      required: ['pattern', 'file_pattern', 'context_lines'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'inspect_image',
    description: 'Inspect metadata of an image file',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Image file path relative to workspace'
        }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'list_dir',
    description: 'List contents of a directory in the workspace',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: ['string', 'null'],
          description: 'Directory path relative to workspace. Defaults to the workspace root.'
        }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
] as const;

type ReadFileArgs = {path: string};
type WriteFileArgs = {path: string; content: string};
type EditFileArgs = {path: string; old_string: string; new_string: string};
type GlobFilesArgs = {pattern: string; path?: string};
type GrepFilesArgs = {pattern: string; file_pattern?: string; context_lines?: number};
type InspectImageArgs = {path: string};
type ListDirArgs = {path?: string};

export type AIToolArguments =
  | ReadFileArgs
  | WriteFileArgs
  | EditFileArgs
  | GlobFilesArgs
  | GrepFilesArgs
  | InspectImageArgs
  | ListDirArgs;

export interface ParsedAIToolCall {
  name: AIToolName;
  arguments: AIToolArguments;
}

export function getToolSchemas(
  toolNames: readonly AIToolName[] = ALL_AI_TOOL_NAMES
): Array<(typeof TOOL_SCHEMAS)[number]> {
  const allowed = new Set<AIToolName>(toolNames);
  return TOOL_SCHEMAS.filter((schema) => allowed.has(schema.name as AIToolName));
}

export function isAIToolName(value: string): value is AIToolName {
  return (ALL_AI_TOOL_NAMES as readonly string[]).includes(value);
}

export async function executeAITool(
  toolName: AIToolName,
  args: AIToolArguments,
  workspace: Workspace
): Promise<ToolResult> {
  switch (toolName) {
    case 'read_file':
      return readFile((args as ReadFileArgs).path, workspace);
    case 'write_file': {
      const castArgs = args as WriteFileArgs;
      return writeFile(castArgs.path, castArgs.content, workspace);
    }
    case 'edit_file': {
      const castArgs = args as EditFileArgs;
      return editFile(castArgs.path, castArgs.old_string, castArgs.new_string, workspace);
    }
    case 'glob_files': {
      const castArgs = args as GlobFilesArgs;
      return globFiles(castArgs.pattern, workspace, castArgs.path);
    }
    case 'grep_files': {
      const castArgs = args as GrepFilesArgs;
      return grepFiles(castArgs.pattern, workspace, {
        filePattern: castArgs.file_pattern,
        contextLines: normalizeContextLines(castArgs.context_lines)
      });
    }
    case 'inspect_image':
      return inspectImageTool((args as InspectImageArgs).path, workspace);
    case 'list_dir':
      return listDir((args as ListDirArgs).path ?? '', workspace);
  }
}

export function parseAIToolArguments(name: AIToolName, rawArguments: string): AIToolArguments {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawArguments);
  } catch (error: unknown) {
    throw new Error(
      `Invalid arguments for ${name}: ${error instanceof Error ? error.message : 'Expected JSON'}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid arguments for ${name}: expected an object`);
  }

  const value = parsed as Record<string, unknown>;

  switch (name) {
    case 'read_file':
      return {path: requireString(value, 'path', name)};
    case 'write_file':
      return {
        path: requireString(value, 'path', name),
        content: requireString(value, 'content', name)
      };
    case 'edit_file':
      return {
        path: requireString(value, 'path', name),
        old_string: requireString(value, 'old_string', name),
        new_string: requireString(value, 'new_string', name)
      };
    case 'glob_files':
      return {
        pattern: requireString(value, 'pattern', name),
        path: optionalString(value, 'path')
      };
    case 'grep_files':
      return {
        pattern: requireString(value, 'pattern', name),
        file_pattern: optionalString(value, 'file_pattern'),
        context_lines: optionalNumber(value, 'context_lines')
      };
    case 'inspect_image':
      return {path: requireString(value, 'path', name)};
    case 'list_dir':
      return {path: optionalString(value, 'path')};
  }
}

export function isMutatingAITool(toolName: AIToolName): boolean {
  return toolName === 'write_file' || toolName === 'edit_file';
}

export function describeAIToolCall(toolName: AIToolName, args: AIToolArguments): string {
  switch (toolName) {
    case 'read_file':
      return `Calling read_file on ${(args as ReadFileArgs).path}...`;
    case 'write_file':
      return `Calling write_file on ${(args as WriteFileArgs).path}...`;
    case 'edit_file':
      return `Calling edit_file on ${(args as EditFileArgs).path}...`;
    case 'glob_files':
      return `Calling glob_files for pattern "${(args as GlobFilesArgs).pattern}"...`;
    case 'grep_files':
      return `Calling grep_files for pattern "${(args as GrepFilesArgs).pattern}"...`;
    case 'inspect_image':
      return `Calling inspect_image on ${(args as InspectImageArgs).path}...`;
    case 'list_dir': {
      const dirPath = (args as ListDirArgs).path ?? '.';
      return `Calling list_dir on ${dirPath}...`;
    }
  }
}

export function formatAIToolConfirmation(toolName: AIToolName, args: AIToolArguments): string {
  switch (toolName) {
    case 'write_file':
      return `Allow AI to call write_file on ${(args as WriteFileArgs).path}? (y/n)`;
    case 'edit_file':
      return `Allow AI to call edit_file on ${(args as EditFileArgs).path}? (y/n)`;
    default:
      return `Allow AI to call ${toolName}? (y/n)`;
  }
}

async function inspectImageTool(imagePath: string, workspace: Workspace): Promise<ToolResult> {
  try {
    const resolvedPath = resolvePath(imagePath, workspace.cwd);
    const metadata = await inspectImage(resolvedPath);
    const relativePath = toWorkspaceRelativePath(resolvedPath, workspace.cwd);

    return {
      status: 'success',
      output: formatRows([
        ['File', relativePath],
        ['Format', metadata.format],
        ['Dimensions', `${metadata.width} × ${metadata.height}`],
        ['Channels', `${metadata.channels} (${metadata.channelLabel})`],
        ['Color mode', metadata.colorMode],
        ['File size', formatBytes(metadata.fileSizeBytes)],
        ['Has alpha', metadata.hasAlpha ? 'Yes' : 'No'],
        ['Bit depth', metadata.bitDepth]
      ]),
      data: metadata
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return {
      status: 'error',
      output: message,
      error: message
    };
  }
}

function formatRows(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width + 2)}${value}`).join('\n');
}

function toWorkspaceRelativePath(filePath: string, cwd: string): string {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath === '.') {
    return path.basename(filePath);
  }

  return relativePath.split(path.sep).join('/');
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  toolName: AIToolName
): string {
  const raw = value[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Invalid arguments for ${toolName}: "${key}" must be a non-empty string`);
  }

  return raw;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Invalid arguments: "${key}" must be a non-empty string when provided`);
  }

  return raw;
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`Invalid arguments: "${key}" must be a finite number when provided`);
  }

  return raw;
}

function normalizeContextLines(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}
