import type { Request } from 'express'
import { isIP } from 'node:net'
import { env } from '../env.js'

/**
 * §5.1 — every IP rule in §5 is worthless if this is wrong.
 *
 * `trust proxy` is set to the exact hop count in `app.ts`, so Express already
 * discards the forgeable part of `X-Forwarded-For`. Cloudflare's
 * `CF-Connecting-IP` is preferred only when `TRUST_CLOUDFLARE` says every
 * request genuinely arrives through Cloudflare — otherwise the header is just
 * attacker-supplied text.
 */
export function clientIp(req: Request): string | null {
  if (env.TRUST_CLOUDFLARE) {
    const cf = req.headers['cf-connecting-ip']
    const value = Array.isArray(cf) ? cf[0] : cf
    if (value && isIP(value.trim())) return value.trim()
  }

  const ip = req.ip ?? req.socket.remoteAddress ?? null
  if (!ip) return null

  // ::ffff:203.0.113.5 → 203.0.113.5, so v4 and v6 forms of one address do not
  // count as two different clients against the rate limits.
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  return isIP(unmapped) ? unmapped : null
}

/** Private, loopback, link-local or CGNAT — never a real internet client. */
export function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '127.0.0.1') return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  if (/^169\.254\./.test(ip)) return true
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true
  if (/^f[cd]/i.test(ip)) return true
  return false
}
