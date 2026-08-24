import { z } from 'zod'
import { normalizeMobile } from '../../lib/mobile.js'
import {
  AMOUNT_MAX,
  AMOUNT_MIN,
  EMPLOYMENT_TYPES,
  INCOME_MAX,
  INCOME_MIN,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOAN_TYPES,
} from './constants.js'

/* §7. The frontend mirrors these for UX, but this is the authority — client
   checks are bypassed with one curl. Messages are written to be shown to the
   person filling in the form. */

const NAME_PATTERN = /^[\p{L}\p{M} .'-]+$/u

const capped = (max: number) => z.string().trim().max(max).optional()

export const CreateLeadSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Enter your full name.')
    .max(80, 'Name is too long.')
    .refine((v) => NAME_PATTERN.test(v), 'Use letters, spaces, apostrophes and hyphens only.'),

  mobile: z
    .string()
    .min(1, 'Enter your mobile number.')
    .transform((v) => normalizeMobile(v))
    .refine((v): v is string => v !== null, 'Must be a 10-digit number starting with 6, 7, 8 or 9.'),

  loanType: z.enum(LOAN_TYPES, 'Choose a loan type.'),

  amount: z.coerce
    .number()
    .int('Enter the amount in whole rupees.')
    .min(AMOUNT_MIN, 'Minimum loan amount is ₹10,000.')
    .max(AMOUNT_MAX, 'Maximum loan amount is ₹10,00,00,000.'),

  income: z.coerce
    .number()
    .int('Enter your income in whole rupees.')
    .min(INCOME_MIN, 'Minimum monthly income is ₹5,000.')
    .max(INCOME_MAX, 'Maximum monthly income is ₹1,00,00,000.'),

  employment: z.enum(EMPLOYMENT_TYPES, 'Choose your employment type.'),

  // Must be exactly true. Absent or false → 422, nothing stored.
  consent: z.literal(true, 'Please agree to the terms before submitting.'),
  consentText: z
    .string()
    .trim()
    .min(1, 'Consent wording missing.')
    .max(2000)
    .describe('The exact string rendered to the user, stored verbatim for DPDP.'),
  consentVersion: z.string().trim().max(20).optional(),

  turnstileToken: z.string().max(4000).optional(),
  /** Honeypot — a real browser leaves this empty because it is not visible. */
  website: z.string().max(200).optional(),
  /** Epoch ms at which the form was rendered, for the §5.2 time check. */
  renderedAt: z.coerce.number().int().positive().optional(),

  pageUrl: capped(500),
  referer: capped(500),
  source: z.enum(LEAD_SOURCES).optional(),
  utm: z
    .object({
      source: capped(200),
      medium: capped(200),
      campaign: capped(200),
      term: capped(200),
      content: capped(200),
    })
    .partial()
    .optional(),
})

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>

/* ── admin ─────────────────────────────────────────────────────────────── */

/** `personal,home` → ['personal','home']; unknown values are rejected. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1))
    .optional()

const booleanish = z
  .string()
  .optional()
  .transform((v) => /^(1|true|yes|on)$/i.test(v ?? ''))

export const LeadFilterSchema = z.object({
  loanType: csvEnum(LOAN_TYPES),
  status: csvEnum(LEAD_STATUSES),
  employment: csvEnum(EMPLOYMENT_TYPES),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  q: z.string().trim().max(120).optional(),
  includeSuspect: booleanish,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['created_at:desc', 'created_at:asc', 'amount:desc']).default('created_at:desc'),

  /**
   * `summary` (default) returns the columns the table needs. `full` returns the
   * whole record — consent audit, request context, UTM, notes and workflow.
   *
   * Defaulting to `summary` keeps the list view from dragging `consent_text`
   * (up to 2 KB a row) across the wire on every page load, and means adding
   * this parameter did not change any existing caller's response.
   */
  view: z.enum(['summary', 'full']).default('summary'),
})

export type LeadFilter = z.infer<typeof LeadFilterSchema>

export const UpdateLeadSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    notes: z.string().max(5000).nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    firstCallAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.')

export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>
