import { sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { leads } from '../db/schema.js'
import { env } from '../env.js'
import { msUntilIstHour } from '../lib/ist.js'
import { logger } from '../logger.js'

/** One arbitrary constant, so two instances cannot run the job at once. */
const JOB_LOCK_KEY = 8_141_990_113_476_611n

function monthsAgo(months: number): Date {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

/**
 * §11.7 — retention. Leads past the window are anonymised rather than deleted:
 * the personal data goes, the row stays so historical volume, conversion and
 * loan-mix reporting do not silently change shape.
 */
export async function anonymiseOldLeads(): Promise<number> {
  const cutoff = monthsAgo(env.LEAD_RETENTION_MONTHS)

  const result = await db
    .update(leads)
    .set({
      fullName: '[erased]',
      mobile: '',
      notes: null,
      ip: null,
      userAgent: null,
      referer: null,
      pageUrl: null,
      utm: null,
      consentText: '[erased — retention limit reached]',
      updatedAt: new Date(),
    })
    .where(sql`${leads.createdAt} < ${cutoff} and ${leads.fullName} <> '[erased]'`)
    .returning({ id: leads.id })

  return result.length
}

export async function runNightlyJobs(): Promise<void> {
  // pg_try_advisory_lock is session-scoped; the same pooled client must release it.
  const client = await (await import('../db/index.js')).pool.connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [JOB_LOCK_KEY.toString()],
    )
    if (!rows[0]?.locked) {
      logger.info('nightly jobs already running on another instance — skipping')
      return
    }

    try {
      const anonymised = await anonymiseOldLeads()
      logger.info({ anonymised }, 'nightly retention jobs complete')
    } finally {
      await client.query('select pg_advisory_unlock($1)', [JOB_LOCK_KEY.toString()])
    }
  } catch (err) {
    logger.error({ err }, 'nightly jobs failed')
  } finally {
    client.release()
  }
}

/**
 * Runs once per day at `NIGHTLY_JOB_HOUR_IST`. Enable on exactly one instance,
 * or leave it off and drive `npm run job:nightly` from cron instead.
 */
export function startNightlyJobs(): () => void {
  let timer: NodeJS.Timeout

  const schedule = () => {
    const delay = msUntilIstHour(env.NIGHTLY_JOB_HOUR_IST)
    logger.info({ inMinutes: Math.round(delay / 60_000) }, 'nightly jobs scheduled')
    timer = setTimeout(() => {
      void runNightlyJobs().finally(schedule)
    }, delay)
    timer.unref()
  }

  schedule()
  return () => clearTimeout(timer)
}
