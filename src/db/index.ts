import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { env } from '../env.js'
import { logger } from '../logger.js'
import * as schema from './schema.js'

/* bigint (int8) arrives as a string by default so 2^53 is never silently lost.
   Amount and income are rupees — comfortably inside Number.MAX_SAFE_INTEGER —
   and the schema declares them `mode: 'number'`, so parse them back. */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))

function sslConfig(): pg.PoolConfig['ssl'] {
  switch (env.sslMode) {
    case 'require':
      return { rejectUnauthorized: true }
    case 'no-verify':
      return { rejectUnauthorized: false }
    default:
      return false
  }
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => {
  // An idle client dying is not fatal; the pool replaces it.
  logger.error({ err }, 'postgres pool error')
})

export const db = drizzle(pool, { schema })
export type Database = typeof db

export async function checkDbHealth(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch (err) {
    logger.error({ err }, 'database health check failed')
    return false
  }
}

export async function closeDb(): Promise<void> {
  await pool.end()
}
