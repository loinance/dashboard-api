import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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

/* Both `src/db/` and the compiled `dist/db/` sit two levels below the package
   root, so this finds ./drizzle whatever the working directory is — a deploy
   that starts the process from somewhere other than the repo root would
   otherwise report "no migrations" and come up against an empty database. */
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle')

/**
 * A freshly provisioned database can still be accepting no connections when
 * the app container starts, so retry briefly before giving up.
 */
export async function runMigrations(attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      logger.info({ migrationsFolder }, 'applying migrations')
      await migrate(db, { migrationsFolder })
      logger.info('migrations up to date')
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      const delay = Math.min(1_000 * 2 ** (attempt - 1), 8_000)
      logger.warn({ err, attempt, retryInMs: delay }, 'migration attempt failed — retrying')
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

export async function closeDb(): Promise<void> {
  await pool.end()
}
