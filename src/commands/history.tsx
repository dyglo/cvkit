import process from 'node:process';
import {Command} from 'commander';
import {clearHistory, hasDatabaseConfig, listRuns, runMigrations, type RunListEntry} from '../lib/history.js';

const DATABASE_HINT = 'Run: cvkit config set DATABASE_URL=...';

export function registerHistory(program: Command): void {
  const history = program.command('history').description('View or clear Postgres-backed run history');

  history
    .command('list')
    .description('List recent command runs')
    .option('--limit <n>', 'Maximum rows to show', '20')
    .option('--command <command>', 'Filter by command')
    .action(async (options: {limit?: string; command?: string}) => {
      if (!hasDatabaseConfig()) {
        process.stdout.write(`${DATABASE_HINT}\n`);
        return;
      }

      const limit = Number(options.limit ?? '20');
      const rows = await listRuns({limit, command: options.command});
      process.stdout.write(formatHistoryOutput(rows, limit));
    });

  history
    .command('clear')
    .description('Clear stored run history')
    .action(async () => {
      if (!hasDatabaseConfig()) {
        process.stdout.write(`${DATABASE_HINT}\n`);
        return;
      }

      await clearHistory();
      process.stdout.write('  Run history cleared.\n');
    });

  const db = program.command('db').description('Database utilities');

  db
    .command('migrate')
    .description('Apply SQL migrations')
    .action(async () => {
      if (!hasDatabaseConfig()) {
        process.stdout.write(`${DATABASE_HINT}\n`);
        return;
      }

      const files = await runMigrations();
      process.stdout.write(formatMigrationOutput(files));
    });
}

export function formatHistoryOutput(rows: RunListEntry[], limit: number): string {
  const lines = [
    `  Run history (last ${limit})`,
    '  ─────────────────────────────────────────',
    '  #   Command     Status    Duration   Date'
  ];

  for (const row of rows) {
    lines.push(
      `  ${String(row.id).padEnd(3)} ${row.command.padEnd(11)} ${row.status.padEnd(9)} ${formatDuration(row.duration_ms).padEnd(
        10
      )} ${formatDateTime(row.created_at)}`
    );
  }

  lines.push('  ─────────────────────────────────────────', '');
  return `${lines.join('\n')}\n`;
}

function formatMigrationOutput(files: string[]): string {
  const lines = ['  Applied migrations', '  ─────────────────────────────────────────'];
  for (const file of files) {
    lines.push(`  ${file}`);
  }
  lines.push('  ─────────────────────────────────────────', '');
  return `${lines.join('\n')}\n`;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs === undefined) {
    return '-';
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
