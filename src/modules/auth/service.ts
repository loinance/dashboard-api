import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import type { UserRow } from '../../db/schema.js'
import { env } from '../../env.js'

/** §2 — Argon2id. Not bcrypt, not SHA-anything. */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP's minimum for argon2id
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS)
}

/**
 * A hash of a value nobody can supply. Verifying against it when the email is
 * unknown keeps the failure path the same shape and roughly the same duration
 * as a wrong password, so login cannot be used to enumerate accounts (§6).
 */
let decoyHash: string | null = null
async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword(`decoy:${env.JWT_SECRET}`)
  return decoyHash
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return row ?? null
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return row ?? null
}

/**
 * Returns the user only when the account exists, is active, and the password
 * verifies. Every other outcome is indistinguishable from the caller's side.
 */
export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const user = await findUserByEmail(email)

  if (!user || !user.isActive) {
    await argon2.verify(await decoy(), password).catch(() => false)
    return null
  }

  let ok = false
  try {
    ok = await argon2.verify(user.passwordHash, password)
  } catch {
    ok = false
  }

  return ok ? user : null
}

export async function markLoggedIn(userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
}

export interface PublicUser {
  id: string
  name: string
  email: string
  role: string
}

export const toPublicUser = (user: UserRow): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
})
