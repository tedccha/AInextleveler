/**
 * Sonnet infrastructure assessment.
 *
 *   Different from sonnet-extract.ts in one key way: this prompt is
 *   POSITIVE-EVIDENCE ONLY. The infra scanner can prove a capability
 *   exists (file present, content shape, settings pattern) but it can't
 *   prove a capability is MISSING just because a file isn't there.
 *   So Sonnet emits ONLY capabilities the infra evidence supports. The
 *   upsert logic in lib/scan/infrastructure.ts upgrades but never
 *   downgrades existing rows.
 *
 *   Implementation note: uses tool_use (not JSON.parse-on-text) so the
 *   API guarantees a structured object back. Adds prompt caching to the
 *   taxonomy block (it's identical across every infra scan call).
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
const TOOL_NAME = 'record_infrastructure_assessment'

export type InfraSignal = {
  signal: string
  finding: string
  strength: 'strong' | 'partial' | 'weak'
}

export type InfraAssessmentInput = {
  signals: InfraSignal[]
}

export type InfraAssessmentOutput = {
  capabilities: Array<{
    capability: Capability
    /**
     * 'have' or 'partial'. Sonnet must NEVER emit 'missing' — that's not
     * something positive evidence can establish.
     */
    status: 'have' | 'partial'
    rationale: string
  }>
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
  return `You assess INFRASTRUCTURE evidence to identify which AGENTIC LIFECYCLE capabilities a user has positive evidence for. You will be given a list of filesystem and config signals from the user's machine. Map each signal to capabilities it provides POSITIVE evidence for.

LIFECYCLE TAXONOMY (the ONLY valid {theme, name} pairs):

${JSON.stringify(taxonomy, null, 2)}

CRITICAL RULES:
- Output ONLY capabilities the signals provide positive evidence for. NEVER emit "missing" — absence of a signal is not proof of missing capability.
- status is 'have' (strong/multiple positive signals) or 'partial' (some evidence, weak or single signal). NEVER 'missing'.
- "capability" must be a {theme, name} object with both fields exactly matching the taxonomy. No abbreviations, no rephrasing.
- "rationale" is one sentence citing the specific signal(s) that support this assessment.
- If signals don't support any capability, return capabilities: [].

Examples of how signals map (NOT exhaustive):
- "~/Code/.env.shared exists with multiple keys" → AgentOps Infrastructure > Distribution & deployment (partial), AgentOps Infrastructure > Latency & cost optimization (weak)
- "~/.claude/MEMORY.md exists with substantial content" → Cognitive Architecture > Memory systems (partial)
- "ollama is installed and recent models pulled" → AgentOps Infrastructure > Local & edge inference (have)
- ".claude/skills/ has 10+ custom skills" → AgentOps Infrastructure > Distribution & deployment (have)
- "~/.claude/settings.json has hooks configured" → Multi-Agent Orchestration > Workflow frameworks (partial)
- "OPENCLAW_SESSION env var present in shell config" → Multi-Agent Orchestration > Communication patterns (have)`
})()

/**
 * Tool schema. Captures the same {capabilities[]} shape Sonnet was
 * previously emitting as raw JSON, but now constructed via the API's
 * tool-use machinery — no string-escape failure mode.
 */
const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Record the capabilities the infrastructure signals support, with a rationale for each.',
  input_schema: {
    type: 'object',
    properties: {
      capabilities: {
        type: 'array',
        description:
          'Capabilities the signals positively support. Empty if signals support nothing in the taxonomy.',
        items: {
          type: 'object',
          properties: {
            capability: {
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
            status: {
              type: 'string',
              enum: ['have', 'partial'],
              description:
                "'have' for strong/multiple positive signals; 'partial' for weak/single signal. NEVER 'missing'.",
            },
            rationale: {
              type: 'string',
              description:
                'One sentence citing the specific signal(s) that support this assessment.',
            },
          },
          required: ['capability', 'status', 'rationale'],
        },
      },
    },
    required: ['capabilities'],
  },
}

type ToolInput = {
  capabilities?: Array<{
    capability?: { theme?: string; name?: string }
    status?: string
    rationale?: string
  }>
}

export async function assessInfrastructure(
  input: InfraAssessmentInput,
): Promise<InfraAssessmentOutput> {
  // Edge case: zero signals → no need to call Sonnet.
  if (input.signals.length === 0) {
    return { capabilities: [], rawCount: 0, droppedCount: 0 }
  }

  const userPrompt = [
    'INFRASTRUCTURE SIGNALS:',
    '',
    ...input.signals.map(
      (s, i) => `${i + 1}. [${s.strength}] ${s.signal}: ${s.finding}`,
    ),
  ].join('\n')

  const c = client()
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // System as an array with a cache_control'd block so the (large,
    // identical-across-calls) taxonomy embedding caches across all
    // infra-scan calls. Reads ~0.1x cost after the first.
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userPrompt }],
  })

  let parsed: ToolInput
  try {
    parsed = extractToolInput<ToolInput>(res, TOOL_NAME)
  } catch (err) {
    if (err instanceof ToolUseExtractError) {
      console.warn(`[sonnet-infra] tool not invoked: ${err.message}`)
      return { capabilities: [], rawCount: 0, droppedCount: 0 }
    }
    throw err
  }

  const raw = parsed.capabilities ?? []
  const out: InfraAssessmentOutput['capabilities'] = []
  let dropped = 0
  for (const item of raw) {
    if (
      !item.capability ||
      !item.capability.theme ||
      !item.capability.name ||
      !isValidCapability({
        theme: item.capability.theme,
        name: item.capability.name,
      }) ||
      (item.status !== 'have' && item.status !== 'partial')
    ) {
      dropped++
      console.warn(
        `[sonnet-infra] dropped invalid item: ${JSON.stringify(item)}`,
      )
      continue
    }
    out.push({
      capability: {
        theme: item.capability.theme as Theme,
        name: item.capability.name,
      },
      status: item.status,
      rationale: item.rationale ?? '',
    })
  }

  return { capabilities: out, rawCount: raw.length, droppedCount: dropped }
}
