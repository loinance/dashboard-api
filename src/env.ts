import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

/* A deployed process gets its configuration from the platform, not a file —
   there is no .env there and dotenv is a no-op. `quiet` keeps it from printing
   its banner into the deploy log on every boot. */
loadDotenv({ quiet: true })

/** `true`/`1`/`yes` in any case; everything else false. */
const booleanish = z
  .string()
  .optional()
  .transform((v) => /^(1|true|yes|on)$/i.test(v ?? ''))

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  /* Railway's private network is IPv6-only, so the socket must be bound to
     `::` (which also accepts IPv4 on a dual-stack host) and not 0.0.0.0. */
  HOST: z.string().min(1).default('::'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z.enum(['require', 'no-verify', 'disable']).optional(),
  /* Apply pending migrations at boot. Railway has no release phase, so this
     is the only hook that runs before the first request on a fresh deploy. */
  RUN_MIGRATIONS_ON_BOOT: booleanish,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_DOMAIN: z.string().optional(),
  /* The API and the dashboard are on different registrable domains once this
     is deployed (railway.app vs the site's domain), which makes every admin
     XHR cross-site — `lax` would drop the session cookie. Overridable so a
     same-domain setup can keep the stricter value. */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),
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

/**
 * Postgres TLS on a managed host is not one setting.
 *
 *  - Railway's in-cluster hostname (`*.railway.internal`) does not terminate
 *    TLS at all, so `require` fails the connection outright.
 *  - Its public proxy (`*.proxy.rlwy.net`, `*.railway.app`) presents a
 *    self-signed certificate, so `require` with `rejectUnauthorized: true`
 *    fails verification.
 *
 * Both are the common way to reach a Railway database, and both crash under
 * the old `isProd ? 'require' : 'disable'` default. `DATABASE_SSL` still wins
 * whenever it is set explicitly.
 */
function defaultSslMode(databaseUrl: string, isProd: boolean): 'require' | 'no-verify' | 'disable' {
  let host = ''
  let urlSslMode: string | null = null
  try {
    const url = new URL(databaseUrl)
    host = url.hostname.toLowerCase()
    urlSslMode = url.searchParams.get('sslmode')
  } catch {
    // Not a parseable URL — fall through to the NODE_ENV-based default and let
    // the driver report the real problem.
  }

  if (urlSslMode === 'disable') return 'disable'
  if (host.endsWith('.railway.internal') || host.endsWith('.internal')) return 'disable'
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'disable'
  if (host.endsWith('.rlwy.net') || host.endsWith('.railway.app')) return 'no-verify'

  return isProd ? 'require' : 'disable'
}

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

  const sslMode = env.DATABASE_SSL ?? defaultSslMode(env.DATABASE_URL, isProd)

  const cookieSameSite = env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax')
  if (cookieSameSite === 'none' && !isProd) {
    // Chrome drops `SameSite=None` without `Secure`, and `Secure` is only set
    // in production — the cookie would silently never be stored.
    throw new Error('COOKIE_SAMESITE=none requires NODE_ENV=production (the cookie must be Secure)')
  }

  return {
    ...env,
    isProd,
    isTest: env.NODE_ENV === 'test',
    corsOrigins,
    sslMode,
    cookieSameSite,
    /** Name of the session cookie. */
    cookieName: 'loinance_session',
  }
}

/**
 * A bad variable is a configuration mistake, not a bug — print the list and
 * stop, rather than burying it under a module-load stack trace in the deploy log.
 */
function loadEnv(): ReturnType<typeof parseEnv> {
  try {
    return parseEnv()
  } catch (err) {
    console.error(`
[dashboard-api] ${err instanceof Error ? err.message : String(err)}
`)
    process.exit(1)
  }
}

export const env = loadEnv()
export type Env = typeof env
