import {formatBytes, inspectImage} from '../lib/image.js';
import {
  getConfigPath,
  isSecretKey,
  maskConfigValue,
  readConfig,
  setConfigValue
} from '../lib/config.js';
import type {CommandResult} from './types.js';

const HELP_TEXT = [
  'Available commands',
  '──────────────────────────────────',
  'inspect <path>           Inspect image metadata',
  'config set <KEY=VALUE>   Save a config value',
  'config list              List all config values',
  'help                     Show this help',
  'exit / quit / ctrl+c     Exit cvkit',
  '──────────────────────────────────'
].join('\n');

export async function routeCommand(input: string): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {type: 'empty'};
  }

  if (trimmed === '?') {
    return {type: 'output', message: HELP_TEXT};
  }

  const [command, ...args] = trimmed.split(/\s+/);

  switch (command.toLowerCase()) {
    case 'inspect':
      return handleInspect(args.join(' '));
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

async function handleInspect(imagePath: string): Promise<CommandResult> {
  if (!imagePath.trim()) {
    return {type: 'error', message: 'Usage: inspect <path>'};
  }

  try {
    const metadata = await inspectImage(imagePath);
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}
