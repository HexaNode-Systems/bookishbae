/** Backend-only SQL boundary. Never log SQL, bind values, or driver errors. */
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { ApiError } from '../api/errors';
import { logger } from '../logger';
if (typeof window !== 'undefined')
  throw new Error('PostgreSQL is backend-only.');
export function poolConfig(source: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (!source.DATABASE_URL)
    throw new Error('DATABASE_URL is required on the backend.');
  let url: URL;
  try {
    url = new URL(source.DATABASE_URL);
  }
  catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  const mode = source.DATABASE_SSL_MODE || 'verify-full';
  if (!['verify-full', 'disable'].includes(mode))
    throw new Error('DATABASE_SSL_MODE must be verify-full or disable.');
  if (mode === 'disable' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('DATABASE_SSL_MODE=disable is allowed only for local PostgreSQL.');
  }
  // pg connection-string SSL parameters override ssl options; reject insecure
  // overrides and remove the remainder so certificate validation stays enabled.
  if (url.searchParams.get('sslmode') === 'disable' && mode !== 'disable')
    throw new Error('Configure local TLS with DATABASE_SSL_MODE, not URL overrides.');
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat'])
    url.searchParams.delete(key);
  const max = Number(source.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(max) || max < 1 || max > 50)
    throw new Error('DATABASE_POOL_MAX must be between 1 and 50.');
  return {
    connectionString: url.toString(), max,
    ssl: mode === 'disable' ? false : { rejectUnauthorized: true, ...(source.DATABASE_SSL_CA ? { ca: source.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}) },
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, idle_in_transaction_session_timeout: 30000,
    application_name: 'bookishbae-backend',
  };
}
let pool: Pool | undefined;
export function getPool(): Pool {
  pool ??= new Pool(poolConfig());
  // An idle socket error otherwise becomes an unhandled process exception.
  if (pool.listenerCount('error') === 0)
    pool.on('error', () => logger.error('PostgreSQL idle connection failed'));
  return pool;
}
export function databaseFailure(error: unknown): never {
  if (error instanceof ApiError)
    throw error;
  const code = (error as {
    code?: string;
  })?.code;
  logger.error('PostgreSQL operation failed', { code: /^[A-Z0-9_]{2,32}$/.test(code || '') ? code : 'DATABASE_ERROR' });
  if (code === '23505')
    throw new ApiError('conflict', 'That record already exists.');
  if (code === '23503')
    throw new ApiError('conflict', 'This record is still in use or references an unavailable item.');
  if (code === 'P0002')
    throw new ApiError('not_found', 'The requested record no longer exists.');
  if (['22023', '22P02', '23514', '23502'].includes(code || ''))
    throw new ApiError('bad_request', 'The database could not accept those details. Check the book, coupon and required fields.');
  throw new ApiError('upstream_error', 'The database is unavailable or could not complete this operation. Please try again shortly.');
}
export interface Sql {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]>;
}
// Match the JSON shape previously returned by PostgREST (dates and numerics).
function normalize(value: unknown): unknown {
  if (value instanceof Date)
    return value.toISOString();
  if (Array.isArray(value))
    return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}
function connection(client: Pool | PoolClient): Sql {
  return {
    async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
      const result = await client.query<T>(sql, values);
      return normalize(result.rows) as T[];
    }
  };
}
export const db: Sql = {
  async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    try {
      return await connection(getPool()).query<T>(sql, values);
    }
    catch (error) {
      databaseFailure(error);
    }
  },
};
export async function transaction<T>(work: (sql: Sql) => Promise<T>, onFailure?: (error: unknown) => void): Promise<T> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    const result = await work(connection(client));
    await client.query('COMMIT');
    return result;
  }
  catch (error) {
    if (client)
      try {
        await client.query('ROLLBACK');
      }
      catch {
        discard = true;
      }
    // Optional operator diagnostics run before errors are reduced to API-safe
    // messages. Observers must not alter transaction or seed behavior.
    try { onFailure?.(error); } catch { /* Diagnostic failures cannot replace the original error. */ }
    return databaseFailure(error);
  }
  finally {
    client?.release(discard);
  }
}
export async function closeDatabase(): Promise<void> {
  const existing = pool;
  pool = undefined;
  await existing?.end();
}
