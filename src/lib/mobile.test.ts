import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasRepeatedDigitPattern, normalizeMobile } from './mobile.js'

describe('normalizeMobile', () => {
  it('strips +91, spaces and dashes down to 10 digits', () => {
    // §7 — all of these are the same person and must collide on dedupe.
    for (const input of [
      '9844493082',
      '+91 98444 93082',
      '+919844493082',
      '098444-93082',
      '0091 9844493082',
      ' 98444 93082 ',
      '(98444) 93082',
    ]) {
      assert.equal(normalizeMobile(input), '9844493082', input)
    }
  })

  it('rejects numbers that are not Indian mobiles', () => {
    for (const input of ['5844493082', '844493082', '98444930821', '', 'abcdefghij', '1234']) {
      assert.equal(normalizeMobile(input), null, input)
    }
  })

  it('accepts every valid leading digit', () => {
    for (const first of ['6', '7', '8', '9']) {
      assert.equal(normalizeMobile(`${first}844493082`), `${first}844493082`)
    }
  })
})

describe('hasRepeatedDigitPattern', () => {
  it('flags the obvious fakes', () => {
    for (const mobile of ['9999999999', '8888888888', '9898989898', '9999988888']) {
      assert.equal(hasRepeatedDigitPattern(mobile), true, mobile)
    }
  })

  it('flags long sequential runs', () => {
    assert.equal(hasRepeatedDigitPattern('9123456789'), true)
    assert.equal(hasRepeatedDigitPattern('9876543210'), true)
  })

  it('leaves ordinary numbers alone', () => {
    for (const mobile of ['9844493082', '7411928365', '6291847503']) {
      assert.equal(hasRepeatedDigitPattern(mobile), false, mobile)
    }
  })
})
