import process from 'node:process';
import chalk from 'chalk';
import type {ConfigValues} from './config-store.js';
import type {ImageInspectionReport} from './inspect-image.js';

export function formatInspectionReport(report: ImageInspectionReport): string {
  const rows: Array<[string, string]> = [
    ['Path', report.path],
    ['File', report.fileName],
    ['Format', report.format],
    ['Size', formatBytes(report.fileSizeBytes)],
    ['Dimensions', `${report.width} x ${report.height}`],
    ['Channels', String(report.channels)],
    ['Color mode', report.colorMode]
  ];

  return formatRows(rows);
}

export function formatConfigList(values: ConfigValues): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return 'No config values stored yet.';
  }

  return formatRows(entries);
}

export function formatConfigPath(filePath: string): string {
  return chalk.cyan(filePath);
}

export function printErrorAndExit(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`${chalk.red('Error:')} ${message}\n`);
  process.exit(1);
}

function formatRows(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${chalk.bold(label.padEnd(width))}  ${value}`).join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

