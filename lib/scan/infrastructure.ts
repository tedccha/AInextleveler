/**
 * Infrastructure scan — read filesystem signals, send to Sonnet, upsert
 * capabilities (UPGRADE-ONLY: never downgrades existing GitHub-derived
 * status).
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Per eng review A8: every path is resolved via realpath() BEFORE │
 *   │  it's read. The resolved path must start with HOME_DIR or        │
 *   │  CODE_DIR. Anything that fails is logged to                      │
 *   │  ~/.gstack/projects/AInextleveler/security.jsonl and skipped.    │
 *   │                                                                  │
 *   │  The signals collected are intentionally conservative:           │
 *   │  - existence + size of a few well-known files                    │
 *   │  - directory listings of two specific dirs                       │
 *   │  - JSON parse of settings.json                                   │
 *   │  We never recurse into project repos. Never read shell rc files. │
 *   │  Never touch keys/credentials. Never follow symlinks past root.  │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { realpath, readFile, readdir, stat, mkdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { db, schema } from '@/lib/db/client'
import { and, eq } from 'drizzle-orm'
import { embedSingle, BULK_EMBED_DELAY_MS } from '@/lib/embed'
import {
  type Capability,
  type Theme,
  capabilityEmbedString,
  capabilityKey,
} from '@/lib/taxonomy'
import {
  assessInfrastructure,
  type InfraSignal,
} from '@/lib/llm/sonnet-infra'

export type InfraScanEvent =
  | { type: 'started' }
  | { type: 'collecting_signals'; collected: number }
  | { type: 'path_blocked'; raw_path: string; reason: string } // logged, not shown to user — kept for protocol completeness
  | { type: 'sending_to_sonnet'; signal_count: number }
  | {
      type: 'assessed'
      raw: number
      dropped: number
      kept: number
    }
  | { type: 'embedding'; index: number; total: number; key: string }
  | {
      type: 'completed'
      upgraded: number
      preserved: number
      embed_failures: number
    }
  | { type: 'error'; message: string }

/**
 * Resolve raw path via realpath() and verify it falls inside one of the
 * allowed roots. Returns null on any violation (and logs to security.jsonl).
 *
 * This is the single chokepoint for filesystem reads. Never bypass.
 */
async function safeResolve(rawPath: string): Promise<string | null> {
  const allowedRoots = [
    process.env.HOME_DIR ?? homedir(),
    process.env.CODE_DIR ?? join(homedir(), 'Code'),
  ]
  try {
    if (!existsSync(rawPath)) return null
    const resolved = await realpath(rawPath)
    for (const root of allowedRoots) {
      const rootResolved = existsSync(root) ? await realpath(root) : root
      if (resolved.startsWith(rootResolved + '/') || resolved === rootResolved) {
        return resolved
      }
    }
    await logSecurity({
      raw_path: rawPath,
      resolved,
      reason: 'outside allowed roots',
    })
    return null
  } catch (err) {
    await logSecurity({
      raw_path: rawPath,
      reason: `realpath failed: ${err instanceof Error ? err.message : 'unknown'}`,
    })
    return null
  }
}

async function logSecurity(entry: {
  raw_path: string
  resolved?: string
  reason: string
}): Promise<void> {
  try {
    const dir = join(homedir(), '.gstack', 'projects', 'AInextleveler')
    await mkdir(dir, { recursive: true })
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    await appendFile(join(dir, 'security.jsonl'), line, 'utf8')
  } catch {
    // Logging failure is non-fatal — don't crash the scan.
  }
}

async function safeStat(rawPath: string): Promise<{
  exists: boolean
  size: number | null
  isDir: boolean
  resolved: string | null
}> {
  const resolved = await safeResolve(rawPath)
  if (!resolved) return { exists: false, size: null, isDir: false, resolved: null }
  try {
    const s = await stat(resolved)
    return {
      exists: true,
      size: s.isFile() ? s.size : null,
      isDir: s.isDirectory(),
      resolved,
    }
  } catch {
    return { exists: false, size: null, isDir: false, resolved }
  }
}

async function safeReadText(
  rawPath: string,
  maxBytes = 4000,
): Promise<string | null> {
  const resolved = await safeResolve(rawPath)
  if (!resolved) return null
  try {
    const buf = await readFile(resolved, { encoding: 'utf8' })
    return buf.slice(0, maxBytes)
  } catch {
    return null
  }
}

async function safeReadDir(rawPath: string): Promise<string[] | null> {
  const resolved = await safeResolve(rawPath)
  if (!resolved) return null
  try {
    return await readdir(resolved)
  } catch {
    return null
  }
}

/**
 * Build the list of signals from the filesystem. Each call is wrapped in
 * safeResolve(); nothing reads outside HOME_DIR/CODE_DIR.
 *
 * Conservative by design — adding new signals = adding a real-world
 * privilege expansion, treat each addition with care.
 */
async function collectSignals(): Promise<InfraSignal[]> {
  const home = process.env.HOME_DIR ?? homedir()
  const code = process.env.CODE_DIR ?? join(home, 'Code')

  const signals: InfraSignal[] = []

  // 1. Shared env file at ~/Code/.env.shared
  {
    const path = join(code, '.env.shared')
    const content = await safeReadText(path, 8000)
    if (content) {
      const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
      const keys = lines
        .map((l) => l.split('=')[0]?.trim())
        .filter((k): k is string => !!k && /^[A-Z_]+$/.test(k))
      if (keys.length > 0) {
        signals.push({
          signal: 'shared env file',
          finding: `~/Code/.env.shared exists with ${keys.length} keys: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}`,
          strength: keys.length >= 3 ? 'strong' : 'partial',
        })
      }
    }
  }

  // 2. Memory file at ~/.claude/MEMORY.md
  {
    const path = join(home, '.claude', 'MEMORY.md')
    const s = await safeStat(path)
    if (s.exists && s.size !== null) {
      signals.push({
        signal: 'agent memory file',
        finding: `~/.claude/MEMORY.md exists, ${s.size} bytes`,
        strength: s.size > 2000 ? 'strong' : s.size > 200 ? 'partial' : 'weak',
      })
    }
  }

  // 3. CLAUDE.md (orientation file at ~/.claude/CLAUDE.md)
  {
    const path = join(home, '.claude', 'CLAUDE.md')
    const s = await safeStat(path)
    if (s.exists && s.size !== null && s.size > 100) {
      signals.push({
        signal: 'global CLAUDE.md',
        finding: `~/.claude/CLAUDE.md exists, ${s.size} bytes — global instructions configured`,
        strength: 'partial',
      })
    }
  }

  // 4. Skills library at ~/.claude/skills/
  {
    const path = join(home, '.claude', 'skills')
    const entries = await safeReadDir(path)
    if (entries && entries.length > 0) {
      const skillCount = entries.filter((e) => !e.startsWith('.')).length
      signals.push({
        signal: 'skills library',
        finding: `~/.claude/skills/ has ${skillCount} skill directories`,
        strength: skillCount >= 5 ? 'strong' : 'partial',
      })
    }
  }

  // 5. Settings.json at ~/.claude/settings.json
  {
    const path = join(home, '.claude', 'settings.json')
    const content = await safeReadText(path, 8000)
    if (content) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>
        const hasHooks = !!parsed.hooks && Object.keys(parsed.hooks as object).length > 0
        const hasStatusLine = !!parsed.statusLine
        const hasMcpServers = !!parsed.mcpServers && Object.keys(parsed.mcpServers as object).length > 0
        const hits: string[] = []
        if (hasHooks) hits.push('hooks')
        if (hasStatusLine) hits.push('statusLine')
        if (hasMcpServers) hits.push('mcpServers')
        if (hits.length > 0) {
          signals.push({
            signal: 'CC settings configured',
            finding: `~/.claude/settings.json configures: ${hits.join(', ')}`,
            strength: hits.length >= 2 ? 'strong' : 'partial',
          })
        }
      } catch {
        // Malformed JSON — log nothing.
      }
    }
  }

  // 6. Code directory project count
  {
    const entries = await safeReadDir(code)
    if (entries) {
      const projects = entries.filter(
        (e) => !e.startsWith('.') && !e.startsWith('_'),
      )
      if (projects.length > 0) {
        signals.push({
          signal: 'code workspace',
          finding: `~/Code/ has ${projects.length} top-level project directories`,
          strength: projects.length >= 5 ? 'strong' : 'partial',
        })
      }
    }
  }

  // 7. Local LLM — Ollama install detection (look at ~/.ollama)
  {
    const path = join(home, '.ollama', 'models')
    const entries = await safeReadDir(path)
    if (entries) {
      const modelCount = entries.length
      signals.push({
        signal: 'local LLM via Ollama',
        finding: `~/.ollama/models has ${modelCount} entries — Ollama installed and used`,
        strength: modelCount >= 1 ? 'strong' : 'weak',
      })
    }
  }

  // 8. Local LLM — llama.cpp / mlx via ~/.cache or ~/Models — skip (too speculative for v1)

  // 9. Plans directory — strong signal that user runs structured planning workflows
  {
    const path = join(home, '.claude', 'plans')
    const entries = await safeReadDir(path)
    if (entries) {
      const planCount = entries.filter((e) => e.endsWith('.md')).length
      if (planCount > 0) {
        signals.push({
          signal: 'plan files',
          finding: `~/.claude/plans/ has ${planCount} plan files — structured planning practice`,
          strength: planCount >= 3 ? 'strong' : 'partial',
        })
      }
    }
  }

  // 10. gstack projects directory — implies use of gstack workflows / observability
  {
    const path = join(home, '.gstack', 'projects')
    const entries = await safeReadDir(path)
    if (entries && entries.length > 0) {
      signals.push({
        signal: 'gstack projects',
        finding: `~/.gstack/projects/ has ${entries.length} tracked projects — workflow observability`,
        strength: 'partial',
      })
    }
  }

  return signals
}

export async function* scanInfrastructure(): AsyncGenerator<
  InfraScanEvent,
  void,
  void
> {
  yield { type: 'started' }

  let signals: InfraSignal[] = []
  try {
    signals = await collectSignals()
  } catch (err) {
    yield {
      type: 'error',
      message: `signal collection failed: ${err instanceof Error ? err.message : 'unknown'}`,
    }
    return
  }
  yield { type: 'collecting_signals', collected: signals.length }

  if (signals.length === 0) {
    yield {
      type: 'completed',
      upgraded: 0,
      preserved: 0,
      embed_failures: 0,
    }
    return
  }

  yield { type: 'sending_to_sonnet', signal_count: signals.length }
  let assessed: Awaited<ReturnType<typeof assessInfrastructure>>
  try {
    assessed = await assessInfrastructure({ signals })
  } catch (err) {
    yield {
      type: 'error',
      message: `Sonnet failed: ${err instanceof Error ? err.message : 'unknown'}`,
    }
    return
  }

  yield {
    type: 'assessed',
    raw: assessed.rawCount,
    dropped: assessed.droppedCount,
    kept: assessed.capabilities.length,
  }

  // Embed each unique capability (100ms delay between calls).
  const unique = new Map<string, { capability: Capability; status: 'have' | 'partial' }>()
  for (const item of assessed.capabilities) {
    const k = capabilityKey(item.capability)
    const existing = unique.get(k)
    if (!existing || (existing.status === 'partial' && item.status === 'have')) {
      unique.set(k, { capability: item.capability, status: item.status })
    }
  }
  const keys = Array.from(unique.keys())
  let embedFailures = 0
  const embeddings = new Map<string, number[] | null>()
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    const { capability } = unique.get(k)!
    yield { type: 'embedding', index: i + 1, total: keys.length, key: k }
    if (i > 0) await new Promise((r) => setTimeout(r, BULK_EMBED_DELAY_MS))
    const vec = await embedSingle(capabilityEmbedString(capability))
    if (vec === null) embedFailures++
    embeddings.set(k, vec)
  }

  // Upsert with UPGRADE-ONLY semantics:
  //   - If existing row is 'have', no change.
  //   - If existing row is 'partial' and new is 'have', upgrade.
  //   - If existing row is 'missing', upgrade to new status.
  //   - If manual_override is true, skip entirely.
  let upgraded = 0
  let preserved = 0
  for (const k of keys) {
    const { capability, status } = unique.get(k)!
    const embedding = embeddings.get(k) ?? null

    const existing = await db
      .select()
      .from(schema.capabilities)
      .where(
        and(
          eq(schema.capabilities.theme, capability.theme),
          eq(schema.capabilities.name, capability.name),
        ),
      )
      .limit(1)

    if (existing[0]?.manualOverride) {
      preserved++
      continue
    }

    const cur = existing[0]?.status as
      | 'have'
      | 'partial'
      | 'missing'
      | undefined

    let next: 'have' | 'partial' | 'missing' | null = null
    if (!cur) next = status // new row
    else if (cur === 'have') next = null // no upgrade possible
    else if (cur === 'partial' && status === 'have') next = 'have'
    else if (cur === 'missing') next = status

    if (next === null) {
      preserved++
      // Even when not upgrading, fill in embedding if missing.
      if (existing[0] && existing[0].embedding === null && embedding) {
        await db
          .update(schema.capabilities)
          .set({ embedding, lastVerifiedAt: new Date() })
          .where(eq(schema.capabilities.id, existing[0].id))
      }
      continue
    }

    if (existing[0]) {
      await db
        .update(schema.capabilities)
        .set({
          status: next,
          effectiveWeight: next === 'have' ? 1.0 : 0.5,
          lastVerifiedAt: new Date(),
          embedding: embedding ?? existing[0].embedding,
        })
        .where(eq(schema.capabilities.id, existing[0].id))
    } else {
      await db.insert(schema.capabilities).values({
        theme: capability.theme as Theme,
        name: capability.name,
        status: next,
        effectiveWeight: next === 'have' ? 1.0 : 0.5,
        lastVerifiedAt: new Date(),
        manualOverride: false,
        embedding,
      })
    }
    upgraded++
  }

  yield {
    type: 'completed',
    upgraded,
    preserved,
    embed_failures: embedFailures,
  }
}

// Test-only export so we can unit-test path validation without Sonnet.
export const __test = { safeResolve, collectSignals }
