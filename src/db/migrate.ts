import { closeDb, runMigrations } from './index.js'
import { logger } from '../logger.js'

/**
 * `npm run db:migrate` (tsx, local) and `npm run db:migrate:prod`
 * (`node dist/db/migrate.js`, on a host with no dev dependencies installed) —
 * both apply everything in ./drizzle that has not run yet.
 */
runMigrations()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'migration failed')
    await closeDb().catch(() => {})
    process.exit(1)
  })
