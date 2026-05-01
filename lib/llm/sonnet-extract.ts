/**
 * Sonnet capability extraction from a GitHub repo.
 *
 *   Pipeline:
 *
 *     repo files ──┐
 *                  │
 *                  ▼
 *     [system prompt: lifecycle taxonomy as JSON map]
 *     [user prompt: README + package.json + commit dates]
 *                  │
 *                  ▼ Anthropic claude-sonnet-4-6
 *                  ▼
 *     {capabilities: Capability[], lastCommitDate, stack[]}
 *                  │
 *                  ▼
 *     filter via isValidCapability() — drop hallucinations
 *
 * Per CEO plan critical item #1: prompt MUST instruct Sonnet to use exact
 * names from the taxonomy. The validator is the safety net.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  type Capability,
  type Theme,
  isValidCapability,
  taxonomyForPrompt,
} from '@/lib/taxonomy'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048

export type SonnetExtractInput = {
  repoName: string
  readme: string // first 8000 chars
  manifest?: string // package.json or requirements.txt content (truncated)
  recentCommits?: string[] // up to 10 commit messages
  lastCommitDate: string | null // ISO
}

export type SonnetExtractOutput = {
  capabilities: Capability[]
  stack: string[]
  patterns: string[]
  lastCommitDate: string | null
  rawCount: number // how many capabilities Sonnet returned BEFORE validation
  droppedCount: number // how many were dropped because they didn't match the taxonomy
}

let _client: Anthropic | null = null
function client(): Anthropic {
  if (_client) return _client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set in ~/Code/.env.shared')
  _client = new Anthropic({ apiKey: key })
  return _client
}

function buildSystemPrompt(): string {
  const taxonomy = taxonomyForPrompt()
  return `You analyze a GitHub repository and extract which AGENTIC LIFECYCLE capabilities the repository demonstrates.

You will be given the repo name, README, manifest (package.json or similar), and recent commit messages. Your job: identify which sub-capabilities from the lifecycle taxonomy below this repo demonstrates evidence of.

LIFECYCLE TAXONOMY (the ONLY valid {theme, name} pairs):

${JSON.stringify(taxonomy, null, 2)}

Rules:
- Output a JSON object with these exact keys: capabilities, stack, patterns.
- "capabilities" is an array of {theme, name} objects. Both fields MUST be exact strings from the taxonomy above. No abbreviations, no rephrasing, no other strings.
- Only include a capability when there is concrete evidence in the README, manifest, or commit messages. No guessing.
- "stack" is an array of technology strings (free-form, e.g. "Next.js 15", "FastAPI", "Postgres").
- "patterns" is an array of design pattern strings (free-form, e.g. "RAG over markdown", "ReAct loop").
- If nothing matches, output capabilities: [].
- Output ONLY valid JSON, nothing else. No prose, no markdown code fences.`
}

function buildUserPrompt(input: SonnetExtractInput): string {
  const parts = [
    `REPO: ${input.repoName}`,
    `LAST COMMIT: ${input.lastCommitDate ?? 'unknown'}`,
    '',
    '---README (truncated to 8000 chars)---',
    input.readme.slice(0, 8000),
  ]
  if (input.manifest) {
    parts.push('', '---MANIFEST---', input.manifest.slice(0, 4000))
  }
  if (input.recentCommits && input.recentCommits.length > 0) {
    parts.push('', '---RECENT COMMITS---', input.recentCommits.slice(0, 10).join('\n'))
  }
  return parts.join('\n')
}

type RawSonnetOutput = {
  capabilities?: Array<{ theme: string; name: string }>
  stack?: string[]
  patterns?: string[]
}

/**
 * Extracts capabilities from a single repo. Throws on Anthropic API errors
 * (caller should catch and continue with the next repo). Returns dropCount
 * so we can log when Sonnet hallucinates strings outside the taxonomy.
 */
export async function extractCapabilities(
  input: SonnetExtractInput,
): Promise<SonnetExtractOutput> {
  const c = client()
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  })

  const block = res.content[0]
  if (!block || block.type !== 'text') {
    throw new Error('Sonnet returned no text block')
  }

  let parsed: RawSonnetOutput
  try {
    parsed = JSON.parse(block.text) as RawSonnetOutput
  } catch {
    // Retry once: strip markdown fences if any.
    const stripped = block.text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim()
    parsed = JSON.parse(stripped) as RawSonnetOutput
  }

  const rawCaps = parsed.capabilities ?? []
  const valid: Capability[] = []
  let dropped = 0
  for (const c of rawCaps) {
    if (isValidCapability(c)) {
      valid.push({ theme: c.theme as Theme, name: c.name })
    } else {
      dropped++
      console.warn(
        `[sonnet-extract] dropped invalid capability: ${JSON.stringify(c)}`,
      )
    }
  }

  return {
    capabilities: valid,
    stack: parsed.stack ?? [],
    patterns: parsed.patterns ?? [],
    lastCommitDate: input.lastCommitDate,
    rawCount: rawCaps.length,
    droppedCount: dropped,
  }
}
