import {Pool} from 'pg';
import {loadConfig} from './config.js';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const config = loadConfig();
  if (!config.DATABASE_URL) {
    throw new Error(
      'Database not configured.\nRun: cvkit config set DATABASE_URL=postgresql://localhost:5432/cvkit'
    );
  }
  _pool = new Pool({connectionString: config.DATABASE_URL});
  return _pool;
}

export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
