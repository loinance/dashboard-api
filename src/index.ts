import { createApp } from './app.js'
import { closeDb, checkDbHealth, runMigrations } from './db/index.js'
import { env } from './env.js'
import { startNightlyJobs } from './jobs/nightly.js'
import { logger } from './logger.js'

/* A managed host gives no release phase, so this is the only hook that runs
   before the first request of a new deploy. Off by default: enabling it on a
   multi-replica service means several processes racing the same migration,
   which Postgres serialises but which is still worth opting into knowingly. */
if (env.RUN_MIGRATIONS_ON_BOOT) {
  try {
    await runMigrations()
  } catch (err) {
    logger.error({ err }, 'migrations failed — refusing to start')
    process.exit(1)
  }
}

const app = createApp()

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    {
      host: env.HOST,
      port: env.PORT,
      env: env.NODE_ENV,
      trustProxy: env.TRUST_PROXY,
      sslMode: env.sslMode,
      origins: env.corsOrigins,
    },
    'dashboard-api listening',
  )
})

server.on('error', (err) => {
  // EADDRINUSE / EACCES here would otherwise surface as a bare crash with no
  // hint that it was the socket and not the app.
  logger.fatal({ err, host: env.HOST, port: env.PORT }, 'failed to bind the listen socket')
  process.exit(1)
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

/* Node's default is to print to stderr and exit non-zero, which a platform
   reads as a crash-loop with no log line explaining it. Log it through pino
   first so the reason survives, then let the process die and be restarted. */
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting')
  process.exit(1)
})
