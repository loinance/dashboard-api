/**
 * §7 — the mobile is normalized to 10 bare digits *before* the dedupe check, so
 * `+91 98444 93082` and `9844493082` collide correctly.
 */

const INDIAN_MOBILE = /^[6-9]\d{9}$/

/**
 * Strips `+91` / leading `0` / spaces / dashes / brackets.
 * Returns null when what remains is not a valid Indian mobile.
 */
export function normalizeMobile(input: string): string | null {
  let digits = String(input).replace(/\D/g, '')

  // 0091…, 91…, 0… — peel one country/trunk prefix off a 10-digit tail.
  if (digits.length > 10 && digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)

  return INDIAN_MOBILE.test(digits) ? digits : null
}

/**
 * §5.4 `repeated_digits` — `9999999999`, `1234567890` and friends. A soft flag
 * only: the lead is still stored, because a typo looks the same as a fake.
 */
export function hasRepeatedDigitPattern(mobile: string): boolean {
  if (mobile.length !== 10) return false

  const distinct = new Set(mobile).size
  if (distinct <= 3) return true

  // Straight ascending or descending run of at least 6 digits: 1234567890.
  let ascending = 1
  let descending = 1
  let longestAscending = 1
  let longestDescending = 1
  for (let i = 1; i < mobile.length; i += 1) {
    const previous = Number(mobile[i - 1])
    const current = Number(mobile[i])
    ascending = current === (previous + 1) % 10 ? ascending + 1 : 1
    descending = current === (previous + 9) % 10 ? descending + 1 : 1
    longestAscending = Math.max(longestAscending, ascending)
    longestDescending = Math.max(longestDescending, descending)
  }
  if (longestAscending >= 6 || longestDescending >= 6) return true

  // A short block repeated to fill the number: 9898989898, 9876987698.
  for (const size of [2, 3, 4, 5]) {
    if (mobile.length % size !== 0) continue
    const block = mobile.slice(0, size)
    if (block.repeat(mobile.length / size) === mobile) return true
  }

  return false
}
