import 'dotenv/config'
import { z } from 'zod'

/** `true`/`1`/`yes` in any case; everything else false. */
const booleanish = z
  .string()
  .optional()
  .transform((v) => /^(1|true|yes|on)$/i.test(v ?? ''))

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z.enum(['require', 'no-verify', 'disable']).optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

  /* §5.1 — the exact number of proxy hops. Never `true`. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  TRUST_CLOUDFLARE: booleanish,

  TURNSTILE_SECRET: z.string().optional(),

  LEAD_DEDUPE_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  BOT_MIN_FORM_SECONDS: z.coerce.number().int().min(0).default(3),

  SESSION_HOURS: z.coerce.number().int().positive().default(8),

  EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(10_000),

  RUN_NIGHTLY_JOBS: booleanish,
  NIGHTLY_JOB_HOUR_IST: z.coerce.number().int().min(0).max(23).default(2),
  LEAD_RETENTION_MONTHS: z.coerce.number().int().positive().default(24),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env)

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    // Fail loudly at boot rather than at the first request that needs the value.
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }

  const env = parsed.data
  const isProd = env.NODE_ENV === 'production'

  const corsOrigins = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)

  if (corsOrigins.length === 0) throw new Error('CORS_ORIGIN resolved to no origins')
  if (corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGIN must not be "*" — cookies cannot be sent to a wildcard origin')
  }
  if (isProd && !env.TURNSTILE_SECRET) {
    throw new Error('TURNSTILE_SECRET is required when NODE_ENV=production')
  }
  if (isProd && corsOrigins.some((o) => o.startsWith('http://'))) {
    throw new Error('CORS_ORIGIN must be https:// in production')
  }

  const sslMode = env.DATABASE_SSL ?? (isProd ? 'require' : 'disable')

  return {
    ...env,
    isProd,
    isTest: env.NODE_ENV === 'test',
    corsOrigins,
    sslMode,
    /** Name of the session cookie. */
    cookieName: 'loinance_session',
  }
}

export const env = parseEnv()
export type Env = typeof env
