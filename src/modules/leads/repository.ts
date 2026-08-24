import { and, count, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { leads } from '../../db/schema.js'
import { istDayEndExclusive, istDayStart } from '../../lib/ist.js'
import type { LeadFilter } from './schemas.js'

/* ── soft signals ───────────────────────────────────────────────────────── */

/**
 * Leads already stored from this IP inside a rolling window.
 *
 * Feeds the `burst_ip` risk flag only — it flags a lead for an advisor's
 * attention, it never rejects one. Counted straight from `leads`, so there is
 * no separate ledger to keep.
 */
export async function countAcceptedSince(ip: string | null, since: Date): Promise<number> {
  if (!ip) return 0
  const [row] = await db
    .select({ total: count() })
    .from(leads)
    .where(and(eq(leads.ip, ip), gte(leads.createdAt, since)))
  return row?.total ?? 0
}

/* ── filtering (§8.3, reused verbatim by the export in §9) ──────────────── */

export function buildLeadWhere(filter: LeadFilter): SQL | undefined {
  const conditions: SQL[] = []

  /* `inArray`, not a hand-written `= any(...)`: drizzle expands a JS array in a
     sql template into a tuple `($1, $2)`, which `any()` does not accept, and the
     query fails at runtime rather than at compile time. */
  if (filter.loanType?.length) {
    conditions.push(inArray(leads.loanType, filter.loanType))
  }
  if (filter.status?.length) {
    conditions.push(inArray(leads.status, filter.status))
  }
  if (filter.employment?.length) {
    conditions.push(inArray(leads.employment, filter.employment))
  }

  // IST day boundaries, not UTC — see lib/ist.ts.
  if (filter.from) {
    const start = istDayStart(filter.from)
    if (start) conditions.push(gte(leads.createdAt, start))
  }
  if (filter.to) {
    const end = istDayEndExclusive(filter.to)
    if (end) conditions.push(lt(leads.createdAt, end))
  }

  if (filter.q) {
    const digits = filter.q.replace(/\D/g, '')
    const nameMatch = sql`${leads.fullName} ilike ${'%' + filter.q + '%'}`
    const clause = digits
      ? or(nameMatch, sql`${leads.mobile} like ${'%' + digits + '%'}`)
      : nameMatch
    if (clause) conditions.push(clause)
  }

  // §5.4 — suspect leads are excluded by default but always reachable.
  if (!filter.includeSuspect) conditions.push(eq(leads.isSuspect, false))

  return conditions.length > 0 ? and(...conditions) : undefined
}

function orderFor(sort: LeadFilter['sort']) {
  switch (sort) {
    case 'created_at:asc':
      return leads.createdAt
    case 'amount:desc':
      return desc(leads.amount)
    default:
      return desc(leads.createdAt)
  }
}

/** Columns the table view needs — `view=summary`, the default. */
const listColumns = {
  id: leads.id,
  createdAt: leads.createdAt,
  fullName: leads.fullName,
  mobile: leads.mobile,
  loanType: leads.loanType,
  amount: leads.amount,
  income: leads.income,
  employment: leads.employment,
  status: leads.status,
  isSuspect: leads.isSuspect,
  riskFlags: leads.riskFlags,
  source: leads.source,
}

/**
 * Every column — `view=full`.
 *
 * Listed explicitly rather than using a bare `select()` so that adding a column
 * to the table is a deliberate decision to expose it, not an automatic one. A
 * future column holding something sensitive should not start being served to
 * every caller because someone ran a migration.
 */
const fullColumns = {
  ...listColumns,
  updatedAt: leads.updatedAt,

  // DPDP consent audit (§11.7)
  consentAt: leads.consentAt,
  consentText: leads.consentText,
  consentVersion: leads.consentVersion,

  // request context (§5)
  ip: leads.ip,
  userAgent: leads.userAgent,
  referer: leads.referer,
  pageUrl: leads.pageUrl,
  utm: leads.utm,

  // workflow
  notes: leads.notes,
  ownerId: leads.ownerId,
  firstCallAt: leads.firstCallAt,
}

export type LeadListRow = Record<string, unknown>

export async function listLeads(filter: LeadFilter): Promise<{
  rows: LeadListRow[]
  total: number
}> {
  const where = buildLeadWhere(filter)
  const columns = filter.view === 'full' ? fullColumns : listColumns

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(columns)
      .from(leads)
      .where(where)
      .orderBy(orderFor(filter.sort), desc(leads.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(leads).where(where),
  ])

  return { rows, total: totalRow?.total ?? 0 }
}

export async function countLeads(filter: LeadFilter): Promise<number> {
  const [row] = await db.select({ total: count() }).from(leads).where(buildLeadWhere(filter))
  return row?.total ?? 0
}

/** One page of the export stream — never the whole result set in memory (§9). */
export async function selectExportBatch(filter: LeadFilter, offset: number, size: number) {
  return db
    .select({
      createdAt: leads.createdAt,
      fullName: leads.fullName,
      mobile: leads.mobile,
      loanType: leads.loanType,
      amount: leads.amount,
      income: leads.income,
      employment: leads.employment,
      status: leads.status,
      source: leads.source,
      riskFlags: leads.riskFlags,
      notes: leads.notes,
    })
    .from(leads)
    .where(buildLeadWhere(filter))
    .orderBy(orderFor(filter.sort), desc(leads.id))
    .limit(size)
    .offset(offset)
}

export async function findLeadById(id: string) {
  const [row] = await db.select().from(leads).where(eq(leads.id, id)).limit(1)
  return row ?? null
}
