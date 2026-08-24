import { Router } from 'express'
import { and, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/index.js'
import { leads } from '../../db/schema.js'
import { env } from '../../env.js'
import { ApiError, ErrorCode, notFound } from '../../http/errors.js'
import { clientIp } from '../../http/ip.js'
import { parseOrThrow, parseQueryOrThrow } from '../../http/validate.js'
import { istStartOfMonth, istStartOfToday, istStartOfWeek } from '../../lib/ist.js'
import { requireAdmin } from '../../middleware/auth.js'
import { exportFilename, streamLeadsWorkbook } from './export.js'
import { buildLeadWhere, countLeads, findLeadById, listLeads } from './repository.js'
import { LeadFilterSchema, UpdateLeadSchema } from './schemas.js'

export const adminLeadRoutes: Router = Router()

const IdParam = z.object({ id: z.uuid('Not a valid lead id.') })

/* `export` and `stats` are declared before `:id` — Express matches in order and
   would otherwise read them as lead ids. */

/**
 * §9 — accepts every filter from §8.3, because the export has to return exactly
 * the rows on screen or the numbers will not reconcile and nobody will trust
 * the file.
 */
adminLeadRoutes.get('/leads/export', async (req, res) => {
  const filter = parseQueryOrThrow(LeadFilterSchema, req.query)
  const total = await countLeads(filter)

  if (total > env.EXPORT_MAX_ROWS) {
    throw new ApiError(
      ErrorCode.EXPORT_TOO_LARGE,
      `That is ${total.toLocaleString('en-IN')} rows. Narrow the date range to ${env.EXPORT_MAX_ROWS.toLocaleString('en-IN')} or fewer.`,
    )
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename()}"`)
  res.setHeader('Cache-Control', 'no-store')

  const written = await streamLeadsWorkbook(res, filter, env.EXPORT_MAX_ROWS)

  // Bulk PII has left the system. With no audit table this is the only record.
  req.log?.info(
    { rows: written, userId: req.user?.sub ?? null, ip: clientIp(req) },
    'leads exported',
  )
})

/** §8.3 — counts for the dashboard header. Same filters, IST windows. */
adminLeadRoutes.get('/leads/stats', async (req, res) => {
  const filter = parseQueryOrThrow(LeadFilterSchema, req.query)
  const where = buildLeadWhere(filter)
  const now = new Date()

  const [totals] = await db
    .select({
      total: count(),
      today: sql<number>`count(*) filter (where ${leads.createdAt} >= ${istStartOfToday(now)})`.mapWith(
        Number,
      ),
      week: sql<number>`count(*) filter (where ${leads.createdAt} >= ${istStartOfWeek(now)})`.mapWith(
        Number,
      ),
      month: sql<number>`count(*) filter (where ${leads.createdAt} >= ${istStartOfMonth(now)})`.mapWith(
        Number,
      ),
      suspect: sql<number>`count(*) filter (where ${leads.isSuspect})`.mapWith(Number),
    })
    .from(leads)
    .where(where)

  const [byStatus, byLoanType] = await Promise.all([
    db
      .select({ key: leads.status, total: count() })
      .from(leads)
      .where(where)
      .groupBy(leads.status),
    db
      .select({ key: leads.loanType, total: count() })
      .from(leads)
      .where(where)
      .groupBy(leads.loanType),
  ])

  const tally = (rows: { key: string; total: number }[]) =>
    Object.fromEntries(rows.map((row) => [row.key, row.total]))

  res.json({
    total: totals?.total ?? 0,
    today: totals?.today ?? 0,
    thisWeek: totals?.week ?? 0,
    thisMonth: totals?.month ?? 0,
    suspect: totals?.suspect ?? 0,
    byStatus: tally(byStatus),
    byLoanType: tally(byLoanType),
  })
})

/** Dates go out as ISO 8601 with an offset, never as a raw Date. */
function serializeLead(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value
  }
  return out
}

/**
 * §8.3 — the lead list, and the one endpoint for reading leads in bulk.
 *
 *   GET /api/admin/leads?from=2026-08-01&to=2026-08-25&view=full
 *
 * `from` / `to` are inclusive IST calendar days (`YYYY-MM-DD`), not UTC
 * timestamps — a lead created at 00:30 IST belongs to that IST day, which is
 * what anyone reading a date filter means by it.
 *
 * `view=full` returns every column; the default `summary` returns the columns
 * the table needs. Two things are deliberately NOT changed by `view=full`:
 * suspect leads are still excluded unless `includeSuspect=1`, and the result is
 * still paginated. Read `total` / `totalPages` and walk `page` to drain it.
 */
adminLeadRoutes.get('/leads', async (req, res) => {
  const filter = parseQueryOrThrow(LeadFilterSchema, req.query)
  const { rows, total } = await listLeads(filter)

  if (filter.view === 'full') {
    // Consent text, IP and user-agent for every row in one response. Same
    // reasoning as the export (§9): worth a line in the log.
    req.log?.info(
      { rows: rows.length, userId: req.user?.sub ?? null },
      'leads read in full view',
    )
  }

  res.json({
    data: rows.map(serializeLead),
    page: filter.page,
    pageSize: filter.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
  })
})

/** §8.3 — the full record, including the consent audit and request context. */
adminLeadRoutes.get('/leads/:id', async (req, res) => {
  const { id } = parseOrThrow(IdParam, req.params)
  const lead = await findLeadById(id)
  if (!lead) throw notFound('That lead no longer exists.')
  res.json({ data: lead })
})

adminLeadRoutes.patch('/leads/:id', async (req, res) => {
  const { id } = parseOrThrow(IdParam, req.params)
  const input = parseOrThrow(UpdateLeadSchema, req.body)

  const existing = await findLeadById(id)
  if (!existing) throw notFound('That lead no longer exists.')

  const [updated] = await db
    .update(leads)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.firstCallAt !== undefined
        ? { firstCallAt: input.firstCallAt ? new Date(input.firstCallAt) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, id))
    .returning()

  req.log?.info(
    { leadId: id, userId: req.user?.sub ?? null, changed: Object.keys(input) },
    'lead updated',
  )

  res.json({ data: updated })
})

/**
 * §11.7 — DPDP erasure on request. Admin only, audit logged. The audit row
 * deliberately keeps no copy of the erased personal data.
 */
adminLeadRoutes.delete('/leads/:id', requireAdmin, async (req, res) => {
  const { id } = parseOrThrow(IdParam, req.params)

  const [deleted] = await db
    .delete(leads)
    .where(and(eq(leads.id, id)))
    .returning({ id: leads.id })

  if (!deleted) throw notFound('That lead no longer exists.')

  req.log?.warn({ leadId: id, userId: req.user?.sub ?? null }, 'lead deleted (erasure request)')

  res.status(204).end()
})
