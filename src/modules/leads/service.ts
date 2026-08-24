import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { leads } from '../../db/schema.js'
import type { LeadRow } from '../../db/schema.js'
import { env } from '../../env.js'
import type { RiskFlag } from './antijunk.js'

export interface StoreLeadInput {
  fullName: string
  mobile: string
  loanType: string
  amount: number
  income: number
  employment: string
  consentAt: Date
  consentText: string
  consentVersion: string
  ip: string | null
  userAgent: string | null
  referer: string | null
  pageUrl: string | null
  utm: Record<string, string> | null
  source: string
  riskFlags: RiskFlag[]
  isSuspect: boolean
}

export interface StoreLeadResult {
  lead: LeadRow
  duplicate: boolean
}

/**
 * 63-bit advisory lock key from the mobile. Two identical submissions arriving
 * at the same moment would otherwise both miss the dedupe read and both insert.
 */
function mobileLockKey(mobile: string): bigint {
  let hash = 0n
  for (const char of mobile) {
    hash = (hash * 131n + BigInt(char.charCodeAt(0))) % 9_223_372_036_854_775_783n
  }
  return hash
}

/**
 * §5.3 — a repeat submission of the same mobile inside the dedupe window
 * updates the existing lead rather than queueing a second callback. People
 * resubmit because they weren't sure it worked; that is not abuse.
 *
 * The workflow columns (`status`, `notes`, `owner_id`, `first_call_at`) and the
 * original `created_at` are deliberately preserved — an advisor's work on the
 * lead must survive the customer pressing the button again.
 */
export async function storeLead(input: StoreLeadInput): Promise<StoreLeadResult> {
  const windowStart = new Date(Date.now() - env.LEAD_DEDUPE_WINDOW_HOURS * 60 * 60 * 1000)

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${mobileLockKey(input.mobile)})`)

    const [existing] = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.mobile, input.mobile), gte(leads.createdAt, windowStart)))
      .orderBy(desc(leads.createdAt))
      .limit(1)

    if (existing) {
      const [updated] = await tx
        .update(leads)
        .set({
          fullName: input.fullName,
          loanType: input.loanType,
          amount: input.amount,
          income: input.income,
          employment: input.employment,
          // The latest consent is the one to keep proving; the audit trail is
          // the pair (text, timestamp), and this is the most recent pair shown.
          consentAt: input.consentAt,
          consentText: input.consentText,
          consentVersion: input.consentVersion,
          ip: input.ip,
          userAgent: input.userAgent,
          referer: input.referer,
          pageUrl: input.pageUrl,
          utm: input.utm,
          riskFlags: input.riskFlags,
          isSuspect: input.isSuspect,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, existing.id))
        .returning()

      return { lead: updated as LeadRow, duplicate: true }
    }

    const [inserted] = await tx
      .insert(leads)
      .values({
        fullName: input.fullName,
        mobile: input.mobile,
        loanType: input.loanType,
        amount: input.amount,
        income: input.income,
        employment: input.employment,
        consentAt: input.consentAt,
        consentText: input.consentText,
        consentVersion: input.consentVersion,
        ip: input.ip,
        userAgent: input.userAgent,
        referer: input.referer,
        pageUrl: input.pageUrl,
        utm: input.utm,
        source: input.source,
        riskFlags: input.riskFlags,
        isSuspect: input.isSuspect,
      })
      .returning()

    return { lead: inserted as LeadRow, duplicate: false }
  })
}

/**
 * §8.1 — the response must not wait on notifications. Store, commit, return,
 * then fire the alert. A failing Telegram or WhatsApp call must never turn a
 * captured lead into an error for the customer.
 *
 * Phase 2 wires the real transport here; the seam exists now so the call site
 * never has to learn to await it.
 */
export function notifyNewLead(lead: LeadRow): void {
  void lead
}
