import { parseArgs } from 'node:util'
import { randomBytes } from 'node:crypto'
import { closeDb, db } from '../db/index.js'
import { users } from '../db/schema.js'
import { hashPassword } from '../modules/auth/service.js'

/**
 * §6 — there is no public signup, so staff accounts are created here.
 *
 *   npm run seed:user -- --email ops@loinance.com --name "Ops" --role admin
 *
 * Omit --password and one is generated and printed once. Prefer that: a
 * password typed on the command line ends up in the shell history.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
      role: { type: 'string', default: 'agent' },
    },
  })

  const email = values.email?.trim().toLowerCase()
  const name = values.name?.trim()
  const role = values.role === 'admin' ? 'admin' : 'agent'

  if (!email || !name) {
    console.error('Usage: npm run seed:user -- --email <email> --name <name> [--role admin] [--password <pw>]')
    process.exit(1)
  }

  const password = values.password ?? randomBytes(12).toString('base64url')
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.')
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)

  const [row] = await db
    .insert(users)
    .values({ email, name, role, passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: { name, role, passwordHash, isActive: true },
    })
    .returning({ id: users.id, email: users.email, role: users.role })

  console.log(`\n  user:     ${row?.email}`)
  console.log(`  role:     ${row?.role}`)
  if (!values.password) {
    console.log(`  password: ${password}`)
    console.log('\n  Shown once. Store it in your password manager now.\n')
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err)
    await closeDb().catch(() => {})
    process.exit(1)
  })
