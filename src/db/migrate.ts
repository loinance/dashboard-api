import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, closeDb } from './index.js'
import { logger } from '../logger.js'

/** `npm run db:migrate` — applies everything in ./drizzle that has not run. */
async function main(): Promise<void> {
  logger.info('applying migrations')
  await migrate(db, { migrationsFolder: './drizzle' })
  logger.info('migrations up to date')
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'migration failed')
    await closeDb().catch(() => {})
    process.exit(1)
  })
