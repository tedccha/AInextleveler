import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL not set. Copy .env.example to .env and run `bun run db:up`.',
  )
}

// Single shared connection. Local-first single-user app — no pool tuning needed.
const client = postgres(process.env.DATABASE_URL, {
  max: 5,
  prepare: false, // simpler with vector custom type
})

export const db = drizzle(client, { schema })
export { schema }
