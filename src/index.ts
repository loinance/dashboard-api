import { createApp } from './app.js'
import { closeDb, checkDbHealth } from './db/index.js'
import { env } from './env.js'
import { startNightlyJobs } from './jobs/nightly.js'
import { logger } from './logger.js'

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      trustProxy: env.TRUST_PROXY,
      origins: env.corsOrigins,
    },
    'dashboard-api listening',
  )
})

// Warn once at boot rather than failing the first request in the dark.
void checkDbHealth().then((up) => {
  if (!up) logger.error('database is unreachable — /api/health will report db: down')
})

const stopNightly = env.RUN_NIGHTLY_JOBS ? startNightlyJobs() : null
if (!env.RUN_NIGHTLY_JOBS) {
  logger.info('nightly retention jobs disabled (RUN_NIGHTLY_JOBS=false)')
}

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')

  stopNightly?.()

  // Stop accepting connections, let in-flight requests finish, then drop the pool.
  server.close(async () => {
    try {
      await closeDb()
    } catch (err) {
      logger.error({ err }, 'error while closing the database pool')
    }
    process.exit(0)
  })

  setTimeout(() => {
    logger.error('graceful shutdown timed out — forcing exit')
    process.exit(1)
  }, 15_000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled promise rejection')
})
