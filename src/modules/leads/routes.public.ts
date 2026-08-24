import { Router } from 'express'
import type { Request } from 'express'
import { ApiError, ErrorCode } from '../../http/errors.js'
import { clientIp } from '../../http/ip.js'
import { toValidationError } from '../../http/validate.js'
import { resolveIpIntel } from '../../lib/ipIntel.js'
import { logger } from '../../logger.js'
import { verifyTurnstile } from '../../lib/turnstile.js'
import { assessRisk, detectBot, isAllowedOrigin, isSuspect } from './antijunk.js'
import { countAcceptedSince } from './repository.js'
import { CreateLeadSchema } from './schemas.js'
import { notifyNewLead, storeLead } from './service.js'

export const publicLeadRoutes: Router = Router()

/** The one message a successful submit shows, whether or not it was a duplicate. */
const SUCCESS_MESSAGE = "We'll call you within the hour."

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

const trim = (value: string | undefined, max: number): string | null =>
  value ? value.slice(0, max) : null

/**
 * `POST /api/leads` — §5, §7, §8.1.
 *
 * Order matters. Free header checks first, then the cheap silent bot traps,
 * then the network call to Cloudflare, and only then validation. An invalid or
 * bot submission never costs a query it doesn't have to.
 *
 * There is no rate limiting: the origin check, the honeypot, the time-to-submit
 * trap and Turnstile are the only things standing between this endpoint and a
 * flood.
 */
publicLeadRoutes.post('/leads', async (req, res) => {
  const ip = clientIp(req)
  const refererHeader = header(req, 'referer')
  const userAgent = trim(header(req, 'user-agent'), 500)

  // 1. Origin / Referer must be ours when the browser sent one at all.
  if (!isAllowedOrigin({ origin: header(req, 'origin'), referer: refererHeader })) {
    throw new ApiError(ErrorCode.BAD_ORIGIN, 'This form cannot be submitted from here.')
  }

  // 2. Honeypot and time-to-submit — answered with a success-shaped 202 so a
  //    scraper cannot tell it was caught. Nothing is stored.
  const botVerdict = detectBot({
    website: typeof req.body?.website === 'string' ? req.body.website : undefined,
    renderedAt: Number.isFinite(Number(req.body?.renderedAt))
      ? Number(req.body.renderedAt)
      : undefined,
  })
  if (botVerdict.bot) {
    logger.info({ reason: botVerdict.reason }, 'bot submission silently discarded')
    res.status(202).json({ ok: true, message: SUCCESS_MESSAGE })
    return
  }

  // 3. Turnstile.
  const captcha = await verifyTurnstile(
    typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : undefined,
    ip,
  )
  if (!captcha.ok) {
    throw new ApiError(ErrorCode.CAPTCHA_FAILED, 'Please complete the verification and try again.')
  }

  // 4. Field validation (§7). The server is the authority.
  const parsed = CreateLeadSchema.safeParse(req.body)
  if (!parsed.success) {
    throw toValidationError(parsed.error, 'Please check the details you entered.')
  }
  const input = parsed.data

  // 5. Soft flags. Never a rejection; they set is_suspect and explain why.
  const intel = await resolveIpIntel(req, ip)
  const flags = assessRisk({
    mobile: input.mobile,
    amount: input.amount,
    income: input.income,
    ip,
    referer: refererHeader ?? input.referer ?? null,
    recentIpLeadCount: await countAcceptedSince(ip, new Date(Date.now() - 60 * 60 * 1000)),
    ipCountry: intel.country,
    isDatacenterIp: intel.datacenter,
  })

  const { lead, duplicate } = await storeLead({
    fullName: input.fullName,
    mobile: input.mobile,
    loanType: input.loanType,
    amount: input.amount,
    income: input.income,
    employment: input.employment,
    consentAt: new Date(),
    consentText: input.consentText,
    consentVersion: input.consentVersion ?? 'v1',
    ip,
    userAgent,
    referer: trim(refererHeader ?? input.referer ?? undefined, 500),
    pageUrl: trim(input.pageUrl, 500),
    utm: (input.utm as Record<string, string> | undefined) ?? null,
    source: input.source ?? 'hero',
    riskFlags: flags,
    isSuspect: isSuspect(flags),
  })

  // Committed. Respond first — notifications are fire-and-forget by design.
  if (duplicate) {
    res.status(200).json({ ok: true, id: lead.id, duplicate: true, message: SUCCESS_MESSAGE })
  } else {
    res.status(201).json({ ok: true, id: lead.id, message: SUCCESS_MESSAGE })
  }

  if (!duplicate) notifyNewLead(lead)
})
