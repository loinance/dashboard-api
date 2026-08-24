import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // Generated SQL is reviewed and edited by hand before it is applied — the
  // citext extension and the partial index in 0000_init are not things
  // drizzle-kit can infer. Never `push` at a database that holds real leads.
  strict: true,
  verbose: true,
})
