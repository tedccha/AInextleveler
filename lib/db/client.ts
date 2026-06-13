import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let cachedDb: ReturnType<typeof drizzle> | null = null

function getDb() {
  if (cachedDb) return cachedDb

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL not set. Copy .env.example to .env and run `bun run db:up`.',
    )
  }

  const client = postgres(process.env.DATABASE_URL, {
    max: 5,
    prepare: false,
  })

  cachedDb = drizzle(client, { schema })
  return cachedDb
}

// Lazy-loaded database connection
export const db = new Proxy(
  {},
  {
    get: (target, prop) => {
      const instance = getDb()
      return (instance as any)[prop]
    },
  },
) as ReturnType<typeof drizzle>

export { schema }
