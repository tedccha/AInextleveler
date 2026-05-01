import { defineConfig } from 'drizzle-kit'
import { config as loadDotenv } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const sharedEnv = join(homedir(), 'Code', '.env.shared')
if (existsSync(sharedEnv)) loadDotenv({ path: sharedEnv })
loadDotenv()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set. Copy .env.example to .env and run docker compose up -d.')
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
})
