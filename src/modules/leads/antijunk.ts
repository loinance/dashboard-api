import { env } from '../../env.js'
import { isPrivateIp } from '../../http/ip.js'
import { hasRepeatedDigitPattern } from '../../lib/mobile.js'
import {
  IMPLAUSIBLE_AMOUNT_TO_INCOME_RATIO,
  IMPLAUSIBLE_MONTHLY_INCOME,
} from './constants.js'

/**
 * §5 — filter bots hard, flag suspicious humans softly. A false rejection costs
 * a real customer; a false flag costs a second of an advisor's attention.
 */

export const RISK_FLAGS = [
  'repeated_digits',
  'datacenter_ip',
  'foreign_ip',
  'income_implausible',
  'burst_ip',
  'no_referer',
] as const
export type RiskFlag = (typeof RISK_FLAGS)[number]

/* ── hard bot checks (§5.2) ─────────────────────────────────────────────── */

export type BotVerdict = { bot: false } | { bot: true; reason: 'honeypot' | 'too_fast' }

/**
 * Bots are answered with a 202 and a success-shaped body, never an error. A
 * scraper that gets a clear rejection tunes itself around the check; one that
 * appears to succeed usually doesn't come back.
 */
export function detectBot(input: {
  website?: string | undefined
  renderedAt?: number | undefined
  now?: number
}): BotVerdict {
  if (input.website && input.website.trim() !== '') return { bot: true, reason: 'honeypot' }

  if (input.renderedAt !== undefined) {
    const now = input.now ?? Date.now()
    const elapsedSeconds = (now - input.renderedAt) / 1000
    // A negative elapsed time means a forged or clock-skewed timestamp; treat
    // it the same as too fast rather than trusting it.
    if (elapsedSeconds < env.BOT_MIN_FORM_SECONDS) return { bot: true, reason: 'too_fast' }
  }

  return { bot: false }
}

/* ── origin check (§5.2) ────────────────────────────────────────────────── */

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * `Origin` wins when present; otherwise the `Referer`'s origin is checked.
 *
 * When *neither* header is present the request is allowed and picks up the
 * `no_referer` soft flag instead — §5.4 lists a missing referer as a flag, not
 * a rejection, and stripping headers is something privacy tools do to real
 * people as well as scripts.
 */
export function isAllowedOrigin(headers: {
  origin?: string | undefined
  referer?: string | undefined
}): boolean {
  const allowed = env.corsOrigins

  if (headers.origin && headers.origin !== 'null') {
    const origin = originOf(headers.origin) ?? headers.origin.replace(/\/$/, '')
    return allowed.includes(origin)
  }

  if (headers.referer) {
    const origin = originOf(headers.referer)
    return origin !== null && allowed.includes(origin)
  }

  return true
}

/* ── soft flags (§5.4) ──────────────────────────────────────────────────── */

export interface RiskContext {
  mobile: string
  amount: number
  income: number
  ip: string | null
  referer: string | null
  /** Accepted leads already stored for this IP in the last hour. */
  recentIpLeadCount: number
  /** Two-letter country from Cloudflare's `CF-IPCountry`, when trusted. */
  ipCountry: string | null
  /** Result of an ASN lookup, when a provider is configured. See ipIntel.ts. */
  isDatacenterIp: boolean
}

/**
 * Soft signals only. Every one of these still stores the lead — they set
 * `is_suspect` so the dashboard can show *why* and ops can overrule it.
 */
export function assessRisk(context: RiskContext): RiskFlag[] {
  const flags: RiskFlag[] = []

  if (hasRepeatedDigitPattern(context.mobile)) flags.push('repeated_digits')

  if (context.isDatacenterIp) flags.push('datacenter_ip')

  // Flag only, never block: NRIs and VPN users are real customers.
  if (context.ipCountry && context.ipCountry.toUpperCase() !== 'IN') flags.push('foreign_ip')

  if (
    context.income > IMPLAUSIBLE_MONTHLY_INCOME ||
    context.amount > context.income * IMPLAUSIBLE_AMOUNT_TO_INCOME_RATIO
  ) {
    flags.push('income_implausible')
  }

  // This submission makes 2+ from the IP inside the hour, still under the hard cap.
  if (context.recentIpLeadCount >= 1) flags.push('burst_ip')

  if (!context.referer) flags.push('no_referer')

  return flags
}

/** Suspect leads are hidden from the default dashboard view, never deleted. */
export function isSuspect(flags: RiskFlag[]): boolean {
  return flags.length > 0
}

export { isPrivateIp }
