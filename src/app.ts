import express from 'express'
import type { Express } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { checkDbHealth } from './db/index.js'
import { env } from './env.js'
import { logger } from './logger.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { loadSession, requireAuth } from './middleware/auth.js'
import { authRoutes } from './modules/auth/routes.js'
import { adminLeadRoutes } from './modules/leads/routes.admin.js'
import { publicLeadRoutes } from './modules/leads/routes.public.js'

export function createApp(): Express {
  const app = express()

  /* §5.1 — the EXACT hop count. `true` would let any caller forge
     X-Forwarded-For and walk straight through every IP rule below. */
  app.set('trust proxy', env.TRUST_PROXY)
  app.disable('x-powered-by')

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req: { url?: string }) =>
          req.url === '/api/health' || req.url === '/healthz',
      },
    }),
  )

  app.use(
    helmet({
      // No browser-rendered HTML is served from this origin.
      contentSecurityPolicy: false,
      /* The dashboard is on a different site once this is deployed (the API
         gets a *.up.railway.app host), so `same-site` would block the export
         download. CORS still decides who may actually read a response. */
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: env.isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  )

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      // So the browser can read the export's filename.
      exposedHeaders: ['Content-Disposition', 'Retry-After'],
      maxAge: 600,
    }),
  )

  app.use(express.json({ limit: '32kb' }))
  app.use(cookieParser())
  app.use(loadSession)

  /* Liveness. Deliberately touches nothing: a platform health check pointed at
     a probe that fails when the database blips will kill a process that is
     perfectly capable of serving, and turn one outage into a restart loop.
     `/api/health` below is the readiness probe that does check the database. */
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.get('/api/health', async (_req, res) => {
    const up = await checkDbHealth()
    res.status(up ? 200 : 503).json({ ok: up, db: up ? 'up' : 'down' })
  })

  app.use('/api', publicLeadRoutes)
  app.use('/api', authRoutes)

  /* §6 — everything under /api/admin needs a valid cookie. */
  app.use('/api/admin', requireAuth, adminLeadRoutes)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
