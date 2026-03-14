import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getPool, query} from './db.js';
import {loadConfig} from './config.js';

export type SqlRunner = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export type SqlStatementRunner = (sql: string, params?: unknown[]) => Promise<void>;

export type RunStatus = 'running' | 'success' | 'error';

export type RunListEntry = {
  id: number;
  command: string;
  status: string;
  duration_ms: number | null;
  created_at: string | Date;
};

export type CreateRunInput = {
  command: string;
  status?: RunStatus;
};

export type AnomalyHistoryInput = {
  runId: number | null;
  dirPath: string;
  imagePath: string;
  isAnomaly: boolean;
  reason: string | null;
  confidence: string;
  tokensUsed: number;
};

export type LabelAssistHistoryInput = {
  runId: number | null;
  imagePath: string;
  classes: string[];
  savePath?: string;
  annotations: string[];
  notes: string[];
  tokensUsed: number;
};

type IdRow = {id: number};

export function hasDatabaseConfig(): boolean {
  return Boolean(loadConfig().DATABASE_URL);
}

export async function createRun(
  input: CreateRunInput,
  runner: SqlRunner = query
): Promise<number | null> {
  if (!hasDatabaseConfig()) {
    return null;
  }

  const rows = await runner<IdRow>(
    'INSERT INTO runs (command, status) VALUES ($1, $2) RETURNING id',
    [input.command, input.status ?? 'running']
  );
  return rows[0]?.id ?? null;
}

export async function finishRun(
  runId: number | null,
  status: Exclude<RunStatus, 'running'>,
  durationMs: number,
  runner: SqlRunner = query
): Promise<void> {
  if (!runId || !hasDatabaseConfig()) {
    return;
  }

  await runner(
    'UPDATE runs SET status = $2, duration_ms = $3 WHERE id = $1',
    [runId, status, Math.round(durationMs)]
  );
}

export async function recordAnomalyRun(
  input: AnomalyHistoryInput,
  runner: SqlRunner = query
): Promise<void> {
  if (!input.runId || !hasDatabaseConfig()) {
    return;
  }

  await runner(
    [
      'INSERT INTO anomaly_runs (run_id, dir_path, image_path, is_anomaly, reason, confidence, tokens_used)',
      'VALUES ($1, $2, $3, $4, $5, $6, $7)'
    ].join(' '),
    [input.runId, input.dirPath, input.imagePath, input.isAnomaly, input.reason, input.confidence, input.tokensUsed]
  );
}

export async function recordLabelAssistRun(
  input: LabelAssistHistoryInput,
  runner: SqlRunner = query
): Promise<void> {
  if (!input.runId || !hasDatabaseConfig()) {
    return;
  }

  await runner(
    [
      'INSERT INTO label_assist_runs (run_id, image_path, classes, save_path, annotations, notes, tokens_used)',
      'VALUES ($1, $2, $3, $4, $5, $6, $7)'
    ].join(' '),
    [
      input.runId,
      input.imagePath,
      input.classes.join(','),
      input.savePath ?? null,
      input.annotations.join('\n'),
      input.notes.join('\n'),
      input.tokensUsed
    ]
  );
}

export async function listRuns(
  input: {limit: number; command?: string},
  runner: SqlRunner = query
): Promise<RunListEntry[]> {
  return runner<RunListEntry>(
    [
      'SELECT id, command, status, duration_ms, created_at',
      'FROM runs',
      'WHERE ($1::text IS NULL OR command = $1)',
      'ORDER BY id DESC',
      'LIMIT $2'
    ].join(' '),
    [input.command ?? null, input.limit]
  );
}

export async function clearHistory(runner: SqlRunner = query): Promise<void> {
  await runner('DELETE FROM label_assist_runs');
  await runner('DELETE FROM anomaly_runs');
  await runner('DELETE FROM describe_runs');
  await runner('DELETE FROM runs');
}

export async function runMigrations(
  migrationsDir = resolveMigrationsDir(),
  runner: SqlStatementRunner = executeStatement
): Promise<string[]> {
  const entries = await readdir(migrationsDir, {withFileTypes: true});
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await runner(sql);
  }

  return files;
}

export function resolveMigrationsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  if (path.basename(currentDir) === 'dist') {
    return path.resolve(currentDir, '..', 'migrations');
  }

  return path.resolve(currentDir, '..', '..', 'migrations');
}

async function executeStatement(sql: string, params?: unknown[]): Promise<void> {
  const pool = getPool();
  await pool.query(sql, params);
}
