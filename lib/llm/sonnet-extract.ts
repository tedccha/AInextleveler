/**
 * Sonnet capability extraction from a GitHub repo.
 *
 *   Pipeline:
 *
 *     repo files ──┐
 *                  │
 *                  ▼
 *     [system: lifecycle taxonomy as JSON map, prompt-cached]
 *     [user: README + manifest + commit dates]
 *                  │
 *                  ▼ Anthropic claude-sonnet-4-6 (tool_use)
 *                  ▼
 *     {capabilities: Capability[], stack[], patterns[]}
 *                  │
 *                  ▼
 *     filter via isValidCapability() — drop hallucinations
 *
 *   Per CEO plan critical item #1: prompt MUST instruct Sonnet to use
 *   exact taxonomy strings. The validator is the safety net.
 *
 *   Implementation note: tool_use eliminates the "unescaped quote in JSON
 *   string" failure mode that JSON.parse-on-text was hitting. The system
 *   prompt is cached (taxonomy is identical across all repo scans).
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  type Capability,
  type Theme,
  isValidCapability,
  taxonomyForPrompt,
} from '@/lib/taxonomy'
import { extractToolInput, ToolUseExtractError } from './tool-use'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048
const TOOL_NAME = 'record_repo_capabilities'

export type SonnetExtractInput = {
  repoName: string
  readme: string
  manifest?: string
  recentCommits?: string[]
  lastCommitDate: string | null
}

export type SonnetExtractOutput = {
  capabilities: Capability[]
  stack: string[]
  patterns: string[]
  lastCommitDate: string | null
  rawCount: number
  droppedCount: number
}

let _client: Anthropic | null = null
function client(): Anthropic {
  if (_client) return _client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set in ~/Code/.env.shared')
  _client = new Anthropic({ apiKey: key })
  return _client
}

const SYSTEM_PROMPT = (() => {
  const taxonomy = taxonomyForPrompt()
  return `You analyze a GitHub repository and extract which AGENTIC LIFECYCLE capabilities the repository demonstrates.

You will be given the repo name, README, manifest (package.json or similar), and recent commit messages. Your job: identify which sub-capabilities from the lifecycle taxonomy below this repo demonstrates evidence of.

LIFECYCLE TAXONOMY (the ONLY valid {theme, name} pairs):

${JSON.stringify(taxonomy, null, 2)}

Rules:
- "capabilities" is an array of {theme, name} objects. Both fields MUST be exact strings from the taxonomy above. No abbreviations, no rephrasing, no other strings.
- Only include a capability when there is concrete evidence in the README, manifest, or commit messages. No guessing.
- "stack" is an array of technology strings (free-form, e.g. "Next.js 15", "FastAPI", "Postgres").
- "patterns" is an array of design pattern strings (free-form, e.g. "RAG over markdown", "ReAct loop").
- If nothing matches, return capabilities: [].`
})()

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Record the capabilities, stack, and patterns demonstrated by the repo.',
  input_schema: {
    type: 'object',
    properties: {
      capabilities: {
        type: 'array',
        description:
          'Lifecycle capabilities this repo demonstrates evidence of. Empty if nothing matches.',
        items: {
          type: 'object',
          properties: {
            theme: {
              type: 'string',
              description: 'Exact lifecycle theme name from the taxonomy.',
            },
            name: {
              type: 'string',
              description:
                'Exact sub-capability name from CAPABILITIES_BY_THEME[theme].',
            },
          },
          required: ['theme', 'name'],
        },
      },
      stack: {
        type: 'array',
        description: 'Free-form technology strings (e.g. "Next.js 15", "Postgres").',
        items: { type: 'string' },
      },
      patterns: {
        type: 'array',
        description: 'Free-form design pattern strings (e.g. "RAG over markdown").',
        items: { type: 'string' },
      },
    },
    required: ['capabilities', 'stack', 'patterns'],
  },
}

type ToolInput = {
  capabilities?: Array<{ theme?: string; name?: string }>
  stack?: string[]
  patterns?: string[]
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
    parts.push(
      '',
      '---RECENT COMMITS---',
      input.recentCommits.slice(0, 10).join('\n'),
    )
  }
  return parts.join('\n')
}

export async function extractCapabilities(
  input: SonnetExtractInput,
): Promise<SonnetExtractOutput> {
  const c = client()
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  })

  let parsed: ToolInput
  try {
    parsed = extractToolInput<ToolInput>(res, TOOL_NAME)
  } catch (err) {
    if (err instanceof ToolUseExtractError) {
      console.warn(`[sonnet-extract] tool not invoked: ${err.message}`)
      return {
        capabilities: [],
        stack: [],
        patterns: [],
        lastCommitDate: input.lastCommitDate,
        rawCount: 0,
        droppedCount: 0,
      }
    }
    throw err
  }

  const rawCaps = parsed.capabilities ?? []
  const valid: Capability[] = []
  let dropped = 0
  for (const c of rawCaps) {
    if (
      c.theme &&
      c.name &&
      isValidCapability({ theme: c.theme, name: c.name })
    ) {
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
