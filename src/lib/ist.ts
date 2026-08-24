/**
 * §8.3 — date filtering is in IST, not UTC. "Leads from 12 August" means
 * midnight to midnight Indian time; comparing raw UTC timestamps silently drops
 * the 00:00–05:30 window into the previous day.
 *
 * India has a single fixed offset (UTC+05:30) and has never observed DST, so
 * the arithmetic is a constant — no timezone database needed.
 */

export const IST_OFFSET_MINUTES = 330
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` (IST) → the UTC instant at which that IST day starts. */
export function istDayStart(isoDate: string): Date | null {
  const match = ISO_DATE.exec(isoDate)
  if (!match) return null

  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const utcMidnight = Date.UTC(year, month - 1, day)
  const candidate = new Date(utcMidnight - IST_OFFSET_MS)

  // Rejects 2026-02-30 and friends, which Date.UTC would happily roll over.
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    const rolled = new Date(utcMidnight)
    if (
      rolled.getUTCFullYear() !== year ||
      rolled.getUTCMonth() + 1 !== month ||
      rolled.getUTCDate() !== day
    ) {
      return null
    }
  }

  return candidate
}

/**
 * `YYYY-MM-DD` (IST) → the UTC instant at which the *next* IST day starts.
 * The `to` filter is inclusive of the whole day, so the query uses `< end`
 * rather than `<= 23:59:59` and cannot drop the final second.
 */
export function istDayEndExclusive(isoDate: string): Date | null {
  const start = istDayStart(isoDate)
  return start ? new Date(start.getTime() + DAY_MS) : null
}

/** Wall-clock IST parts of an instant. */
function istParts(at: Date) {
  const shifted = new Date(at.getTime() + IST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` for the IST day an instant falls in. */
export function istDateKey(at: Date): string {
  const { year, month, day } = istParts(at)
  return `${year}-${pad(month)}-${pad(day)}`
}

/** `dd-mm-yyyy hh:mm` IST — the Excel export's date column (§9). */
export function formatIstDateTime(at: Date): string {
  const { year, month, day, hours, minutes } = istParts(at)
  return `${pad(day)}-${pad(month)}-${year} ${pad(hours)}:${pad(minutes)}`
}

/** Start of the IST day containing `now`. */
export function istStartOfToday(now = new Date()): Date {
  return istDayStart(istDateKey(now)) as Date
}

/** Start of the IST week (Monday) containing `now`. */
export function istStartOfWeek(now = new Date()): Date {
  const { weekday } = istParts(now)
  const daysSinceMonday = (weekday + 6) % 7
  return new Date(istStartOfToday(now).getTime() - daysSinceMonday * DAY_MS)
}

/** Start of the IST month containing `now`. */
export function istStartOfMonth(now = new Date()): Date {
  const { year, month } = istParts(now)
  return istDayStart(`${year}-${pad(month)}-01`) as Date
}

/** `YYYY-MM-DD` in IST, for the export filename. */
export function istTodayKey(now = new Date()): string {
  return istDateKey(now)
}

/** Milliseconds until the next occurrence of `hour`:00 IST. */
export function msUntilIstHour(hour: number, now = new Date()): number {
  const { hours, minutes } = istParts(now)
  const secondsIntoDay = hours * 3600 + minutes * 60 + Math.floor((now.getTime() % 60_000) / 1000)
  const target = hour * 3600
  const delta = target - secondsIntoDay
  return (delta > 0 ? delta : delta + 86_400) * 1000
}
