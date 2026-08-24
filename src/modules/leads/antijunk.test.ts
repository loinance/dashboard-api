import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assessRisk, detectBot, isAllowedOrigin, isSuspect } from './antijunk.js'
import type { RiskContext } from './antijunk.js'

const baseContext: RiskContext = {
  mobile: '9844493082',
  amount: 600_000,
  income: 85_000,
  ip: '203.0.113.5',
  referer: 'https://www.loinance.com/',
  recentIpLeadCount: 0,
  ipCountry: 'IN',
  isDatacenterIp: false,
}

describe('detectBot', () => {
  it('catches a filled honeypot', () => {
    assert.deepEqual(detectBot({ website: 'http://spam.example' }), {
      bot: true,
      reason: 'honeypot',
    })
  })

  it('ignores an empty honeypot', () => {
    assert.equal(detectBot({ website: '' }).bot, false)
    assert.equal(detectBot({ website: '   ' }).bot, false)
  })

  it('catches a submit faster than a human could type', () => {
    const now = Date.now()
    assert.equal(detectBot({ renderedAt: now - 500, now }).bot, true)
  })

  it('allows a submit after the minimum think time', () => {
    const now = Date.now()
    assert.equal(detectBot({ renderedAt: now - 30_000, now }).bot, false)
  })

  it('treats a future renderedAt as forged', () => {
    const now = Date.now()
    assert.equal(detectBot({ renderedAt: now + 60_000, now }).bot, true)
  })

  it('lets a submission with no timestamp through', () => {
    // An older cached bundle would not send renderedAt; that must not cost a lead.
    assert.equal(detectBot({}).bot, false)
  })
})

describe('isAllowedOrigin', () => {
  it('accepts the configured origin', () => {
    assert.equal(isAllowedOrigin({ origin: 'http://localhost:5173' }), true)
  })

  it('rejects a foreign origin', () => {
    assert.equal(isAllowedOrigin({ origin: 'https://phishing.example' }), false)
  })

  it('falls back to the referer when there is no origin header', () => {
    assert.equal(isAllowedOrigin({ referer: 'http://localhost:5173/#apply' }), true)
    assert.equal(isAllowedOrigin({ referer: 'https://phishing.example/x' }), false)
  })

  it('allows a request with neither header — that is a soft flag, not a block', () => {
    assert.equal(isAllowedOrigin({}), true)
  })
})

describe('assessRisk', () => {
  it('returns nothing for an ordinary submission', () => {
    assert.deepEqual(assessRisk(baseContext), [])
    assert.equal(isSuspect([]), false)
  })

  it('flags a fake-looking mobile', () => {
    assert.deepEqual(assessRisk({ ...baseContext, mobile: '9999999999' }), ['repeated_digits'])
  })

  it('flags implausible money', () => {
    assert.deepEqual(assessRisk({ ...baseContext, income: 6_000_000 }), ['income_implausible'])
    // ₹1cr against ₹20k a month is 500× — nobody underwrites that.
    assert.deepEqual(assessRisk({ ...baseContext, amount: 10_000_000, income: 20_000 }), [
      'income_implausible',
    ])
  })

  it('flags a second submission from the same IP inside the hour', () => {
    assert.deepEqual(assessRisk({ ...baseContext, recentIpLeadCount: 1 }), ['burst_ip'])
  })

  it('flags a missing referer', () => {
    assert.deepEqual(assessRisk({ ...baseContext, referer: null }), ['no_referer'])
  })

  it('flags a foreign IP without blocking it', () => {
    const flags = assessRisk({ ...baseContext, ipCountry: 'AE' })
    assert.deepEqual(flags, ['foreign_ip'])
    assert.equal(isSuspect(flags), true) // stored, badged, never rejected
  })

  it('accumulates flags', () => {
    const flags = assessRisk({
      ...baseContext,
      mobile: '1234567890',
      referer: null,
      isDatacenterIp: true,
    })
    assert.deepEqual(flags, ['repeated_digits', 'datacenter_ip', 'no_referer'])
  })
})
