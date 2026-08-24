import pino from 'pino'
import { env } from './env.js'

/**
 * §11.6 — logs are not a lawful place to keep PII. Name, mobile, IP and
 * password are censored wherever they can plausibly appear, including inside
 * request/response bodies that a well-meaning `log.info({ body })` might pick up.
 */
const redactPaths = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.headers["cf-connecting-ip"]',
  'req.headers["x-forwarded-for"]',
  'req.remoteAddress',
  'req.remotePort',
  'ip',
  '*.ip',
  'mobile',
  '*.mobile',
  'fullName',
  '*.fullName',
  'full_name',
  '*.full_name',
  'password',
  '*.password',
  'body.mobile',
  'body.fullName',
  'body.password',
  'email',
  '*.email',
]

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'dashboard-api' },
  ...(env.isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }),
})

export type Logger = typeof logger
