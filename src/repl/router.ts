import {stat} from 'node:fs/promises';
import path from 'node:path';
import {formatBytes, inspectImage} from '../lib/image.js';
import {resolvePath} from '../lib/resolve.js';
import {
  getConfigPath,
  isSecretKey,
  maskConfigValue,
  readConfig,
  setConfigValue
} from '../lib/config.js';
import type {Workspace} from '../lib/workspace.js';
import {editFile, globFiles, grepFiles, listDir, readFile, writeFile} from '../tools/index.js';
import type {ToolResult} from '../tools/index.js';
import type {CommandResult, ConfirmationRequest, ImageListItem} from './types.js';

const HELP_TEXT = [
  'Available commands',
  '──────────────────────────────────────────────',
  '/                        Show slash tool menu',
  'inspect <path>           Inspect image metadata',
  'ls [subdir]              List images and labels',
  'pwd                      Show working directory',
  'config set <KEY=VALUE>   Save a config value',
  'config list              List all config values',
  'help / ?                 Show this help',
  'exit / quit / ctrl+c     Exit cvkit',
  '──────────────────────────────────────────────',
  'Type / to access the tool layer.'
].join('\n');

const SLASH_MENU_TEXT = [
  'Available tools  (prefix with /)',
  '──────────────────────────────────────────────',
  '/read   <path>              Read a file',
  '/write  <path> <content>    Write a file',
  '/edit   <path> <old> <new>  Edit a file',
  '/glob   <pattern> [path]    Find files by pattern',
  '/grep   <pattern> [opts]    Search file contents',
  '/ls     [path]              List directory',
  '',
  '──────────────────────────────────────────────',
  'These tools are also used by the AI loop.',
  'Type a natural language prompt to use them automatically.'
].join('\n');

export async function routeCommand(
  input: string,
  workspace: Workspace,
  pendingConfirmation: ConfirmationRequest | null = null
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {type: 'empty'};
  }

  if (pendingConfirmation) {
    return handleConfirmationResponse(trimmed, pendingConfirmation, workspace);
  }

  if (trimmed === '?') {
    return {type: 'output', message: HELP_TEXT};
  }

  if (trimmed.startsWith('/')) {
    return handleSlashCommand(trimmed, workspace);
  }

  const [command, ...args] = trimmed.split(/\s+/);

  switch (command.toLowerCase()) {
    case 'inspect':
      return handleInspect(args.join(' '), workspace);
    case 'ls':
      return handleList(args.join(' '), workspace);
    case 'pwd':
      return handlePrintWorkingDirectory(workspace);
    case 'config':
      return handleConfig(args);
    case 'help':
      return {type: 'output', message: HELP_TEXT};
    case 'exit':
    case 'quit':
      return {type: 'exit', message: 'Goodbye.'};
    default:
      return {
        type: 'error',
        message: `Unknown command: ${command}\nType help to see available commands.`
      };
  }
}

async function handleSlashCommand(input: string, workspace: Workspace): Promise<CommandResult> {
  const raw = input.slice(1);

  let tokens: string[];
  try {
    tokens = parseQuotedTokens(raw);
  } catch (error: unknown) {
    return {type: 'error', message: toErrorMessage(error)};
  }

  if (tokens.length === 0) {
    return {type: 'output', message: SLASH_MENU_TEXT};
  }

  const [command, ...args] = tokens;
  switch (command.toLowerCase()) {
    case 'read':
      return handleSlashRead(args, workspace);
    case 'write':
      return handleSlashWrite(args, workspace);
    case 'edit':
      return handleSlashEdit(args, workspace);
    case 'glob':
      return handleSlashGlob(args, workspace);
    case 'grep':
      return handleSlashGrep(args, workspace);
    case 'ls':
      return handleSlashList(args, workspace);
    default:
      return {type: 'error', message: `Unknown tool: /${command}`};
  }
}

async function handleSlashRead(args: string[], workspace: Workspace): Promise<CommandResult> {
  if (args.length === 0) {
    return {type: 'error', message: 'Usage: /read <path>'};
  }

  return toCommandResult(await readFile(args.join(' '), workspace));
}

async function handleSlashWrite(args: string[], workspace: Workspace): Promise<CommandResult> {
  if (args.length < 2) {
    return {type: 'error', message: 'Usage: /write <path> <content>'};
  }

  const [filePath, ...contentParts] = args;
  const content = contentParts.join(' ');
  const resolvedPath = resolvePath(filePath, workspace.cwd);

  try {
    const fileInfo = await stat(resolvedPath);
    if (fileInfo.isFile()) {
      return {
        type: 'confirm',
        message: 'File exists. Overwrite? (y/n)',
        request: {
          type: 'write-overwrite',
          filePath,
          content
        }
      };
    }
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT')) {
      return {type: 'error', message: toErrorMessage(error)};
    }
  }

  return executeWrite(filePath, content, workspace);
}

async function handleSlashEdit(args: string[], workspace: Workspace): Promise<CommandResult> {
  if (args.length < 3) {
    return {type: 'error', message: 'Usage: /edit <path> <old> <new>'};
  }

  const [filePath, oldString, ...newStringParts] = args;
  const newString = newStringParts.join(' ');
  return toCommandResult(await editFile(filePath, oldString, newString, workspace));
}

async function handleSlashGlob(args: string[], workspace: Workspace): Promise<CommandResult> {
  if (args.length === 0) {
    return {type: 'error', message: 'Usage: /glob <pattern> [path]'};
  }

  const [pattern, searchPath] = args;
  return toCommandResult(await globFiles(pattern, workspace, searchPath));
}

async function handleSlashGrep(args: string[], workspace: Workspace): Promise<CommandResult> {
  if (args.length === 0) {
    return {type: 'error', message: 'Usage: /grep <pattern> [--files <pattern>] [--context <n>]'};
  }

  const pattern = args[0];
  let filePattern: string | undefined;
  let contextLines = 0;
  let searchPath: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];

    switch (token) {
      case '--files':
        if (!args[index + 1]) {
          return {type: 'error', message: 'Expected a value after --files.'};
        }

        filePattern = args[index + 1];
        index += 1;
        break;
      case '--context': {
        const value = Number(args[index + 1]);
        if (!Number.isInteger(value) || value < 0) {
          return {type: 'error', message: 'Expected a non-negative integer after --context.'};
        }

        contextLines = value;
        index += 1;
        break;
      }
      case '--path':
        if (!args[index + 1]) {
          return {type: 'error', message: 'Expected a value after --path.'};
        }

        searchPath = args[index + 1];
        index += 1;
        break;
      default:
        if (!searchPath) {
          searchPath = token;
          break;
        }

        return {type: 'error', message: `Unknown option: ${token}`};
    }
  }

  return toCommandResult(
    await grepFiles(pattern, workspace, {
      path: searchPath,
      filePattern,
      contextLines
    })
  );
}

async function handleSlashList(args: string[], workspace: Workspace): Promise<CommandResult> {
  return toCommandResult(await listDir(args.join(' '), workspace));
}

async function handleConfirmationResponse(
  input: string,
  request: ConfirmationRequest,
  workspace: Workspace
): Promise<CommandResult> {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes') {
    switch (request.type) {
      case 'write-overwrite':
        return executeWrite(request.filePath, request.content, workspace);
    }
  }

  if (normalized === 'n' || normalized === 'no') {
    return {type: 'output', message: 'Write cancelled.'};
  }

  return {
    type: 'confirm',
    message: 'Please answer y or n.\nFile exists. Overwrite? (y/n)',
    request
  };
}

async function executeWrite(
  filePath: string,
  content: string,
  workspace: Workspace
): Promise<CommandResult> {
  return toCommandResult(await writeFile(filePath, content, workspace));
}

async function handleInspect(imagePath: string, workspace: Workspace): Promise<CommandResult> {
  if (!imagePath.trim()) {
    return {type: 'error', message: 'Usage: inspect <path>'};
  }

  try {
    const metadata = await inspectImage(resolvePath(imagePath, workspace.cwd));
    return {
      type: 'output',
      message: formatRows([
        ['File', metadata.fileName],
        ['Format', metadata.format],
        ['Dimensions', `${metadata.width} × ${metadata.height}`],
        ['Channels', `${metadata.channels} (${metadata.channelLabel})`],
        ['Color mode', metadata.colorMode],
        ['File size', formatBytes(metadata.fileSizeBytes)],
        ['Has alpha', metadata.hasAlpha ? 'Yes' : 'No'],
        ['Bit depth', metadata.bitDepth]
      ])
    };
  } catch (error: unknown) {
    return {type: 'error', message: toErrorMessage(error)};
  }
}

async function handleList(subdirectory: string, workspace: Workspace): Promise<CommandResult> {
  try {
    const scope = normalizeScope(subdirectory);
    const imageFiles = workspace.imageFiles.filter((filePath) => matchesScope(filePath, scope));
    const labelFiles = workspace.labelFiles.filter((filePath) => matchesScope(filePath, scope));

    if (imageFiles.length === 0 && labelFiles.length === 0) {
      return {
        type: 'output',
        message: ['No images or labels found in this directory.', '', '0 images, 0 labels'].join('\n')
      };
    }

    const imageRows = await Promise.all(
      imageFiles.map(async (filePath) => {
        const metadata = await inspectImage(path.join(workspace.cwd, ...filePath.split('/')));
        return {
          path: filePath,
          format: metadata.format,
          dimensions: `${metadata.width}×${metadata.height}`
        } satisfies ImageListItem;
      })
    );

    return {
      type: 'output',
      message: formatListOutput(imageRows, labelFiles)
    };
  } catch (error: unknown) {
    return {type: 'error', message: toErrorMessage(error)};
  }
}

function handlePrintWorkingDirectory(workspace: Workspace): CommandResult {
  return {type: 'output', message: workspace.cwd};
}

async function handleConfig(args: string[]): Promise<CommandResult> {
  const [subcommand, ...rest] = args;

  switch (subcommand?.toLowerCase()) {
    case 'set':
      return handleConfigSet(rest.join(' '));
    case 'list':
      return handleConfigList();
    default:
      return {type: 'error', message: 'Usage: config <set KEY=VALUE | list>'};
  }
}

async function handleConfigSet(keyValue: string): Promise<CommandResult> {
  const separatorIndex = keyValue.indexOf('=');
  if (separatorIndex <= 0) {
    return {type: 'error', message: 'Expected KEY=VALUE.'};
  }

  const key = keyValue.slice(0, separatorIndex).trim();
  const value = keyValue.slice(separatorIndex + 1).trim();
  if (!key || !value) {
    return {type: 'error', message: 'Expected KEY=VALUE.'};
  }

  try {
    await setConfigValue(key, value);
    const preview = isSecretKey(key) ? maskConfigValue(key, value) : value;
    return {
      type: 'output',
      message: `✓ ${key} saved to ${getConfigPath()} (${preview})`
    };
  } catch (error: unknown) {
    return {type: 'error', message: toErrorMessage(error)};
  }
}

async function handleConfigList(): Promise<CommandResult> {
  try {
    const values = await readConfig();
    const rows = Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, maskConfigValue(key, value)] as const);

    return {
      type: 'output',
      message: rows.length > 0 ? formatRows(rows) : 'No config values set.'
    };
  } catch (error: unknown) {
    return {type: 'error', message: toErrorMessage(error)};
  }
}

function formatRows(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width + 2)}${value}`).join('\n');
}

function formatListOutput(imageRows: ImageListItem[], labelFiles: string[]): string {
  const sections: string[] = [];

  if (imageRows.length > 0) {
    const pathWidth = imageRows.reduce((max, row) => Math.max(max, row.path.length), 0);
    const formatWidth = imageRows.reduce((max, row) => Math.max(max, row.format.length), 0);
    sections.push('images/');
    sections.push(
      ...imageRows.map(
        (row) =>
          `  ${row.path.padEnd(pathWidth + 2)}${row.format.padEnd(formatWidth + 2)}${row.dimensions}`
      )
    );
  }

  if (labelFiles.length > 0) {
    if (sections.length > 0) {
      sections.push('');
    }

    sections.push('labels/');
    sections.push(...labelFiles.map((filePath) => `  ${filePath}`));
  }

  if (sections.length > 0) {
    sections.push('');
  }

  sections.push(
    `${imageRows.length} image${imageRows.length === 1 ? '' : 's'}, ${labelFiles.length} label${labelFiles.length === 1 ? '' : 's'}`
  );
  return sections.join('\n');
}

function normalizeScope(subdirectory: string): string | null {
  const trimmed = subdirectory.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  return normalized || null;
}

function matchesScope(filePath: string, scope: string | null): boolean {
  if (!scope) {
    return true;
  }

  return filePath === scope || filePath.startsWith(`${scope}/`);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function toCommandResult(result: ToolResult): CommandResult {
  if (result.status === 'success') {
    return {type: 'output', message: result.output};
  }

  return {type: 'error', message: result.error ?? result.output};
}

function parseQuotedTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const character of input.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    throw new Error('Unterminated quoted string.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
