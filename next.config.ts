import type { NextConfig } from 'next'
import { config as loadDotenv } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// Per global CLAUDE.md: shared API keys live at ~/Code/.env.shared.
// Load it BEFORE local .env so local takes precedence.
const sharedEnv = join(homedir(), 'Code', '.env.shared')
if (existsSync(sharedEnv)) {
  loadDotenv({ path: sharedEnv })
}
loadDotenv() // local .env wins

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No edge runtime anywhere — local-first app needs Node for filesystem scan + iron-session.
  // Per eng review A1: layout-based auth gate, Node runtime only.
}

export default nextConfig
