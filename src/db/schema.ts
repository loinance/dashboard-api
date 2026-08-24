import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/* Postgres types drizzle has no first-class helper for. Both are plain strings
   on the wire; the database does the comparison semantics we want — citext for
   case-insensitive email uniqueness, inet for a real address type. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' })
const inet = customType<{ data: string }>({ dataType: () => 'inet' })
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  /** 'admin' | 'agent' */
  role: text('role').notNull().default('agent'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /* Submitted values — mirrors ApplicationValues in the frontend. */
    fullName: text('full_name').notNull(),
    /** Normalized: 10 digits, no +91, no spaces. See lib/mobile.ts. */
    mobile: text('mobile').notNull(),
    /** personal|home|mortgage|car|business|credit-card */
    loanType: text('loan_type').notNull(),
    /** Rupees, integer. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** Rupees per month, integer. */
    income: bigint('income', { mode: 'number' }).notNull(),
    /** salaried|self-employed|business-owner */
    employment: text('employment').notNull(),
    /* DPDP consent audit: prove what they agreed to, and when. */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    consentText: text('consent_text').notNull(),
    consentVersion: text('consent_version').notNull().default('v1'),
    /* Request context, used for the anti-junk rules in §5. */
    ip: inet('ip'),
    userAgent: text('user_agent'),
    referer: text('referer'),
    pageUrl: text('page_url'),
    utm: jsonb('utm').$type<Record<string, string>>(),
    /** 'hero' | 'contact-cta' | 'manual' */
    source: text('source').default('hero'),
    /* Junk detection outcome (§5.4) — soft signals, not hard rejections. */
    riskFlags: text('risk_flags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    isSuspect: boolean('is_suspect').notNull().default(false),
    /* Workflow. */
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    ownerId: uuid('owner_id').references(() => users.id),
    firstCallAt: timestamp('first_call_at', { withTimezone: true }),
  },
  (table) => [
    index('leads_created_at_idx').on(table.createdAt.desc()),
    index('leads_loan_type_idx').on(table.loanType),
    index('leads_status_idx').on(table.status),
    index('leads_mobile_idx').on(table.mobile),
    index('leads_ip_created_idx').on(table.ip, table.createdAt.desc()),
    index('leads_suspect_idx')
      .on(table.isSuspect)
      .where(sql`is_suspect = true`),
  ],
)
export type UserRow = typeof users.$inferSelect
export type LeadRow = typeof leads.$inferSelect
export type NewLeadRow = typeof leads.$inferInsert
