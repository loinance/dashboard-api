import { env } from '../env.js'
import { logger } from '../logger.js'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileResult = { ok: true } | { ok: false; reason: string }

/**
 * §5.2 — a missing or invalid Turnstile token is a 400 CAPTCHA_FAILED.
 *
 * With no `TURNSTILE_SECRET` configured the check is skipped, which `env.ts`
 * only permits outside production. If Cloudflare itself is unreachable the
 * request is allowed through: a captcha outage must not close the lead pipe,
 * and the IP rate limits still apply.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | null,
): Promise<TurnstileResult> {
  if (!env.TURNSTILE_SECRET) {
    logger.warn('TURNSTILE_SECRET is not set — captcha verification skipped')
    return { ok: true }
  }

  if (!token) return { ok: false, reason: 'missing-input-response' }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
  if (ip) body.set('remoteip', ip)

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      logger.warn({ status: response.status }, 'turnstile verify returned a non-2xx status')
      return { ok: true }
    }

    const result = (await response.json()) as {
      success?: boolean
      'error-codes'?: string[]
    }

    if (result.success) return { ok: true }
    return { ok: false, reason: result['error-codes']?.join(',') ?? 'invalid-input-response' }
  } catch (err) {
    logger.error({ err }, 'turnstile verification failed to reach Cloudflare')
    return { ok: true }
  }
}
