/** Vocabularies shared by validation, filtering and the Excel export. */

export const LOAN_TYPES = [
  'personal',
  'home',
  'mortgage',
  'car',
  'business',
  'credit-card',
] as const
export type LoanType = (typeof LOAN_TYPES)[number]

export const EMPLOYMENT_TYPES = ['salaried', 'self-employed', 'business-owner'] as const
export type Employment = (typeof EMPLOYMENT_TYPES)[number]

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'sent_to_bank',
  'disbursed',
  'rejected',
  'junk',
] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_SOURCES = ['hero', 'contact-cta', 'manual'] as const

/** §9 — the export shows display labels, not the stored slugs. */
export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  personal: 'Personal loan',
  home: 'Home loan',
  mortgage: 'Mortgage loan',
  car: 'Car loan',
  business: 'Business loan',
  'credit-card': 'Credit card',
}

export const EMPLOYMENT_LABELS: Record<Employment, string> = {
  salaried: 'Salaried',
  'self-employed': 'Self-employed',
  'business-owner': 'Business owner',
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  sent_to_bank: 'Sent to bank',
  disbursed: 'Disbursed',
  rejected: 'Rejected',
  junk: 'Junk',
}

/** Falls back to the raw value so an unknown slug is visible, not blank. */
export function labelFor(map: Record<string, string>, value: string | null): string {
  if (!value) return ''
  return map[value] ?? value
}

/* §7 field bounds. */
export const AMOUNT_MIN = 10_000
export const AMOUNT_MAX = 100_000_000 // ₹10,00,00,000
export const INCOME_MIN = 5_000
export const INCOME_MAX = 10_000_000 // ₹1,00,00,000

/* §5.4 income_implausible thresholds. */
export const IMPLAUSIBLE_MONTHLY_INCOME = 5_000_000 // ₹50L / month
export const IMPLAUSIBLE_AMOUNT_TO_INCOME_RATIO = 100
