import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatIstDateTime,
  istDateKey,
  istDayEndExclusive,
  istDayStart,
  istStartOfMonth,
  istStartOfWeek,
  msUntilIstHour,
} from './ist.js'

describe('IST day boundaries', () => {
  it('starts the day at 18:30 UTC the previous day', () => {
    // The whole point of §8.3: 00:00 IST on the 12th is 18:30 UTC on the 11th.
    assert.equal(istDayStart('2026-08-12')?.toISOString(), '2026-08-11T18:30:00.000Z')
  })

  it('ends exclusive at the next IST midnight', () => {
    assert.equal(istDayEndExclusive('2026-08-12')?.toISOString(), '2026-08-12T18:30:00.000Z')
  })

  it('keeps the 00:00–05:30 IST window in the right day', () => {
    // A lead at 01:00 IST on the 12th is 19:30 UTC on the 11th. Filtering the
    // 12th in UTC would lose it; filtering in IST must not.
    const lead = new Date('2026-08-11T19:30:00.000Z')
    const start = istDayStart('2026-08-12') as Date
    const end = istDayEndExclusive('2026-08-12') as Date

    assert.ok(lead >= start && lead < end)
    assert.equal(istDateKey(lead), '2026-08-12')
  })

  it('rejects malformed and impossible dates', () => {
    for (const input of ['12-08-2026', '2026-8-12', '', '2026-13-01', 'yesterday']) {
      assert.equal(istDayStart(input), null, input)
    }
  })
})

describe('IST formatting', () => {
  it('renders dd-mm-yyyy hh:mm in IST', () => {
    assert.equal(formatIstDateTime(new Date('2026-08-12T03:44:22.000Z')), '12-08-2026 09:14')
  })

  it('rolls a late-evening UTC timestamp into the next IST day', () => {
    assert.equal(formatIstDateTime(new Date('2026-08-11T19:30:00.000Z')), '12-08-2026 01:00')
  })
})

describe('IST period starts', () => {
  it('starts the week on Monday', () => {
    // 2026-08-12 is a Wednesday.
    const week = istStartOfWeek(new Date('2026-08-12T06:00:00.000Z'))
    assert.equal(istDateKey(week), '2026-08-10')
  })

  it('starts the month on the 1st', () => {
    const month = istStartOfMonth(new Date('2026-08-12T06:00:00.000Z'))
    assert.equal(month.toISOString(), '2026-07-31T18:30:00.000Z')
  })
})

describe('msUntilIstHour', () => {
  it('waits until later today when the hour is still ahead', () => {
    // 00:30 IST → 02:00 IST is 90 minutes away.
    const ms = msUntilIstHour(2, new Date('2026-08-11T19:00:00.000Z'))
    assert.equal(Math.round(ms / 60_000), 90)
  })

  it('wraps to tomorrow when the hour has passed', () => {
    // 09:14 IST → 02:00 IST tomorrow.
    const ms = msUntilIstHour(2, new Date('2026-08-12T03:44:00.000Z'))
    assert.equal(Math.round(ms / 60_000), 16 * 60 + 46)
  })
})
