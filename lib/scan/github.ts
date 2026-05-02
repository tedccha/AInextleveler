/**
 * GitHub repo scan + capability extraction pipeline.
 *
 *   ┌─ GET /user/repos?sort=pushed&per_page=20
 *   │
 *   ├─ filter: repo.fork === true → drop (eng review simple version)
 *   │
 *   ├─ for each surviving repo:
 *   │     ├─ GET /repos/{full_name}/readme   → README content
 *   │     ├─ GET /repos/{full_name}/contents → look for package.json|requirements.txt|pyproject.toml|Cargo.toml|go.mod
 *   │     ├─ GET /repos/{full_name}/commits?per_page=10  → recent commit messages + dates
 *   │     ├─ Sonnet extract → {capabilities, stack, patterns}
 *   │     └─ recency decay applied: lastCommit > 6mo ago ⇒ effective_weight 0.5
 *   │
 *   ├─ aggregate across repos: build per-capability {evidence_repos[], max_weight}
 *   │
 *   ├─ embed each unique capability via Voyage (100ms delay between calls)
 *   │
 *   └─ upsert into capabilities table:
 *         status: 'have' if any repo at full weight, 'partial' if only 0.5x, 'missing' otherwise
 *         skip rows where manual_override = true (preserve user corrections)
 *
 * Async generator: yields ScanEvent objects for SSE streaming. Caller in
 * app/api/scan/github/route.ts converts these to text/event-stream format.
 */

import { db, schema } from '@/lib/db/client'
import { and, eq, sql } from 'drizzle-orm'
import { embedSingle, BULK_EMBED_DELAY_MS } from '@/lib/embed'
import {
  type Capability,
  type Theme,
  capabilityEmbedString,
  capabilityKey,
  ALL_CAPABILITIES,
} from '@/lib/taxonomy'
import {
  extractCapabilities,
  type SonnetExtractOutput,
} from '@/lib/llm/sonnet-extract'

const GH = 'https://api.github.com'
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6

/**
 * Events emitted during a scan. The route handler renders each as one SSE
 * `data:` frame. Keep these payloads small — they show up in UI labels.
 */
export type ScanEvent =
  | { type: 'started'; total_repos: number; skipped_forks: number }
  | { type: 'token_invalid' }
  | { type: 'rate_limited'; reset_at: string | null }
  | {
      type: 'scanning_repo'
      index: number
      total: number
      repo: string
    }
  | {
      type: 'extracted_repo'
      repo: string
      capabilities: Capability[]
      dropped: number
      last_commit_at: string | null
      weight: number
    }
  | { type: 'embedding'; index: number; total: number; key: string }
  | {
      type: 'completed'
      have: number
      partial: number
      missing: number
      skipped_overrides: number
      embed_failures: number
    }
  | { type: 'error'; message: string }

type GitHubRepo = {
  id: number
  name: string
  full_name: string
  fork: boolean
  pushed_at: string
  default_branch: string
  html_url: string
}

type GitHubReadme = { content: string; encoding: string }
type GitHubCommit = {
  sha: string
  commit: { author: { date: string }; message: string }
}

async function ghFetch<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; ratelimit: boolean }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'ainextleveler/0.1',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (res.ok) {
    return { ok: true, data: (await res.json()) as T }
  }
  const ratelimit = res.status === 403 || res.status === 429
  return { ok: false, status: res.status, ratelimit }
}

function decodeBase64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8')
}

/**
 * Look for a recognized manifest file in repo root. Returns first hit.
 */
async function findManifest(
  fullName: string,
  token: string,
): Promise<string | undefined> {
  const candidates = [
    'package.json',
    'requirements.txt',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
  ]
  for (const file of candidates) {
    const r = await ghFetch<{ content: string; encoding: string }>(
      `${GH}/repos/${fullName}/contents/${file}`,
      token,
    )
    if (r.ok && r.data.content && r.data.encoding === 'base64') {
      return decodeBase64(r.data.content).slice(0, 4000)
    }
  }
  return undefined
}

async function fetchReadme(
  fullName: string,
  token: string,
): Promise<string> {
  const r = await ghFetch<GitHubReadme>(`${GH}/repos/${fullName}/readme`, token)
  if (!r.ok) return ''
  if (r.data.encoding !== 'base64') return ''
  return decodeBase64(r.data.content)
}

async function fetchRecentCommits(
  fullName: string,
  token: string,
): Promise<{ messages: string[]; lastDate: string | null }> {
  const r = await ghFetch<GitHubCommit[]>(
    `${GH}/repos/${fullName}/commits?per_page=10`,
    token,
  )
  if (!r.ok) return { messages: [], lastDate: null }
  const messages = r.data.map((c) => c.commit.message.split('\n')[0])
  const lastDate = r.data[0]?.commit.author.date ?? null
  return { messages, lastDate }
}

function recencyWeight(lastCommitDate: string | null): number {
  if (!lastCommitDate) return 0.5
  const age = Date.now() - new Date(lastCommitDate).getTime()
  return age > SIX_MONTHS_MS ? 0.5 : 1.0
}

/**
 * Aggregate per-capability results across multiple repos.
 * Tracks max weight (best evidence wins) and how many repos backed it.
 */
type CapAggregate = {
  capability: Capability
  maxWeight: number
  repoCount: number
}

function aggregate(
  perRepo: Array<{ repo: string; output: SonnetExtractOutput; weight: number }>,
): Map<string, CapAggregate> {
  const out = new Map<string, CapAggregate>()
  for (const { output, weight } of perRepo) {
    for (const cap of output.capabilities) {
      const key = capabilityKey(cap)
      const cur = out.get(key)
      if (!cur) {
        out.set(key, { capability: cap, maxWeight: weight, repoCount: 1 })
      } else {
        cur.maxWeight = Math.max(cur.maxWeight, weight)
        cur.repoCount += 1
      }
    }
  }
  return out
}

function statusFromWeight(weight: number): 'have' | 'partial' | 'missing' {
  if (weight >= 1.0) return 'have'
  if (weight > 0) return 'partial'
  return 'missing'
}

export type ScanGitHubOptions = {
  token: string
  /** Override max repos for testing. Default 20 per design doc. */
  maxRepos?: number
}

/**
 * Async generator over the full scan. Caller awaits .next() to drive
 * the SSE stream. Wrapped in try/catch — emits `error` event then ends.
 */
export async function* scanGitHub(
  opts: ScanGitHubOptions,
): AsyncGenerator<ScanEvent, void, void> {
  const { token, maxRepos = 20 } = opts

  // 1. Fetch repos.
  const reposRes = await ghFetch<GitHubRepo[]>(
    `${GH}/user/repos?sort=pushed&per_page=${maxRepos * 2}&affiliation=owner`,
    token,
  )
  if (!reposRes.ok) {
    if (reposRes.status === 401) {
      yield { type: 'token_invalid' }
      return
    }
    if (reposRes.ratelimit) {
      yield { type: 'rate_limited', reset_at: null }
      return
    }
    yield {
      type: 'error',
      message: `GitHub /user/repos returned ${reposRes.status}`,
    }
    return
  }
  const allRepos = reposRes.data
  const nonForks = allRepos.filter((r) => !r.fork).slice(0, maxRepos)
  const skippedForks = allRepos.length - nonForks.length

  yield {
    type: 'started',
    total_repos: nonForks.length,
    skipped_forks: skippedForks < 0 ? 0 : skippedForks,
  }

  // 2. Per-repo extraction.
  const perRepo: Array<{
    repo: string
    output: SonnetExtractOutput
    weight: number
  }> = []
  for (let i = 0; i < nonForks.length; i++) {
    const repo = nonForks[i]
    yield {
      type: 'scanning_repo',
      index: i + 1,
      total: nonForks.length,
      repo: repo.full_name,
    }

    const [readme, manifest, commits] = await Promise.all([
      fetchReadme(repo.full_name, token),
      findManifest(repo.full_name, token),
      fetchRecentCommits(repo.full_name, token),
    ])

    let output: SonnetExtractOutput
    try {
      output = await extractCapabilities({
        repoName: repo.full_name,
        readme,
        manifest,
        recentCommits: commits.messages,
        lastCommitDate: commits.lastDate ?? repo.pushed_at ?? null,
      })
    } catch (err) {
      console.warn(`[scan] Sonnet failed for ${repo.full_name}:`, err)
      yield {
        type: 'error',
        message: `Sonnet failed for ${repo.full_name} — continuing`,
      }
      continue
    }

    const weight = recencyWeight(output.lastCommitDate)
    perRepo.push({ repo: repo.full_name, output, weight })

    yield {
      type: 'extracted_repo',
      repo: repo.full_name,
      capabilities: output.capabilities,
      dropped: output.droppedCount,
      last_commit_at: output.lastCommitDate,
      weight,
    }

    // Persist the repo audit record.
    await db
      .insert(schema.repos)
      .values({
        githubUrl: repo.html_url,
        lastScannedAt: new Date(),
        capabilitiesJson: {
          capabilities: output.capabilities,
          lastCommitDate: output.lastCommitDate,
          stack: output.stack,
        },
      })
      .onConflictDoUpdate({
        target: schema.repos.githubUrl,
        set: {
          lastScannedAt: new Date(),
          capabilitiesJson: {
            capabilities: output.capabilities,
            lastCommitDate: output.lastCommitDate,
            stack: output.stack,
          },
        },
      })
  }

  // 3. Aggregate.
  const agg = aggregate(perRepo)

  // 4. Embed each unique capability mentioned (100ms delay between calls).
  const aggKeys = Array.from(agg.keys())
  let embedFailures = 0
  const embeddings = new Map<string, number[] | null>()
  for (let i = 0; i < aggKeys.length; i++) {
    const key = aggKeys[i]
    const cap = agg.get(key)!.capability
    yield { type: 'embedding', index: i + 1, total: aggKeys.length, key }
    if (i > 0) await new Promise((r) => setTimeout(r, BULK_EMBED_DELAY_MS))
    const vec = await embedSingle(capabilityEmbedString(cap))
    if (vec === null) embedFailures++
    embeddings.set(key, vec)
  }

  // 5. Upsert into capabilities table. We process every capability in the
  //    full taxonomy so missing ones get explicitly set to status='missing'
  //    (handles the case where a previously-Have capability lost its repo).
  let have = 0
  let partial = 0
  let missing = 0
  let skippedOverrides = 0

  for (const cap of ALL_CAPABILITIES) {
    const key = capabilityKey(cap)
    const found = agg.get(key)
    const weight = found?.maxWeight ?? 0
    const status = statusFromWeight(weight)
    const embedding = embeddings.get(key) ?? null

    if (status === 'have') have++
    else if (status === 'partial') partial++
    else missing++

    // Check for manual_override — preserve user corrections.
    const existing = await db
      .select()
      .from(schema.capabilities)
      .where(
        and(
          eq(schema.capabilities.theme, cap.theme),
          eq(schema.capabilities.name, cap.name),
        ),
      )
      .limit(1)

    if (existing[0]?.manualOverride) {
      // Keep user's status. Update embedding if we got one — that's harmless.
      skippedOverrides++
      if (embedding) {
        await db
          .update(schema.capabilities)
          .set({
            embedding,
            lastVerifiedAt: new Date(),
          })
          .where(eq(schema.capabilities.id, existing[0].id))
      }
      continue
    }

    if (existing[0]) {
      await db
        .update(schema.capabilities)
        .set({
          status,
          effectiveWeight: weight,
          lastVerifiedAt: new Date(),
          embedding: embedding ?? existing[0].embedding,
        })
        .where(eq(schema.capabilities.id, existing[0].id))
    } else {
      await db.insert(schema.capabilities).values({
        theme: cap.theme as Theme,
        name: cap.name,
        status,
        effectiveWeight: weight,
        lastVerifiedAt: new Date(),
        manualOverride: false,
        embedding,
      })
    }
  }

  yield {
    type: 'completed',
    have,
    partial,
    missing,
    skipped_overrides: skippedOverrides,
    embed_failures: embedFailures,
  }
}

/**
 * Convenience: read aggregate counts directly from DB. Used by the
 * /capability-map page to render without re-scanning.
 */
export async function readCapabilityMap(): Promise<{
  byTheme: Record<Theme, Array<{ name: string; status: 'have' | 'partial' | 'missing'; manualOverride: boolean; lastVerifiedAt: Date | null }>>
  totals: { have: number; partial: number; missing: number; total: number }
  pendingEmbeds: number
}> {
  const rows = await db.select().from(schema.capabilities)
  const byTheme = {} as Record<Theme, Array<{ name: string; status: 'have' | 'partial' | 'missing'; manualOverride: boolean; lastVerifiedAt: Date | null }>>
  let have = 0
  let partial = 0
  let missing = 0
  let pendingEmbeds = 0

  for (const r of rows) {
    const theme = r.theme as Theme
    if (!byTheme[theme]) byTheme[theme] = []
    byTheme[theme].push({
      name: r.name,
      status: r.status as 'have' | 'partial' | 'missing',
      manualOverride: r.manualOverride,
      lastVerifiedAt: r.lastVerifiedAt,
    })
    if (r.status === 'have') have++
    else if (r.status === 'partial') partial++
    else missing++
    if (r.embedding === null) pendingEmbeds++
  }

  return {
    byTheme,
    totals: {
      have,
      partial,
      missing,
      total: rows.length,
    },
    pendingEmbeds,
  }
}

// (Unused but exported for potential test wiring.)
export const __test = { recencyWeight, statusFromWeight, aggregate }

// Suppress unused-import lint; sql is used by future LATERAL re-rank work.
void sql
