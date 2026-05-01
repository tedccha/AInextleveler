/**
 * Sonnet infrastructure assessment.
 *
 * Different from sonnet-extract.ts in one key way: this prompt is
 * POSITIVE-EVIDENCE ONLY. The infra scanner can prove a capability
 * exists (file present, content shape, settings pattern) but it can't
 * prove a capability is MISSING just because a file isn't there.
 * (User might have built RAG without ~/.claude/MEMORY.md.)
 *
 * So Sonnet emits ONLY capabilities the infra evidence supports. The
 * upsert logic in lib/scan/infrastructure.ts then upgrades existing
 * rows but never downgrades.
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

export type InfraSignal = {
  /** Short label, e.g. "shared env", "skills library", "memory file". */
  signal: string
  /** Human-readable finding (one sentence). */
  finding: string
  /** Strength of evidence: 'strong' | 'partial' | 'weak'. */
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

function buildSystemPrompt(): string {
  const taxonomy = taxonomyForPrompt()
  return `You assess INFRASTRUCTURE evidence to identify which AGENTIC LIFECYCLE capabilities a user has positive evidence for. You will be given a list of filesystem and config signals from the user's machine. Map each signal to capabilities it provides POSITIVE evidence for.

LIFECYCLE TAXONOMY (the ONLY valid {theme, name} pairs):

${JSON.stringify(taxonomy, null, 2)}

CRITICAL RULES:
- Output ONLY capabilities the signals provide positive evidence for. NEVER emit "missing" — absence of a signal is not proof of missing capability.
- status is 'have' (strong/multiple positive signals) or 'partial' (some evidence, weak or single signal). NEVER 'missing'.
- "capability" must be a {theme, name} object with both fields exactly matching the taxonomy. No abbreviations, no rephrasing.
- "rationale" is one sentence citing the specific signal(s) that support this assessment.
- If signals don't support any capability, output capabilities: [].
- Output ONLY valid JSON. Schema:
    {"capabilities": [{"capability": {"theme": "...", "name": "..."}, "status": "have"|"partial", "rationale": "..."}]}
- No prose, no markdown code fences, no explanation outside the JSON.

Examples of how signals map (NOT exhaustive):
- "~/Code/.env.shared exists with multiple keys" → AgentOps Infrastructure > Distribution & deployment (partial), AgentOps Infrastructure > Latency & cost optimization (weak)
- "~/.claude/MEMORY.md exists with substantial content" → Cognitive Architecture > Memory systems (partial)
- "ollama is installed and recent models pulled" → AgentOps Infrastructure > Local & edge inference (have)
- ".claude/skills/ has 10+ custom skills" → AgentOps Infrastructure > Distribution & deployment (have)
- "~/.claude/settings.json has hooks configured" → Multi-Agent Orchestration > Workflow frameworks (partial)
- "OPENCLAW_SESSION env var present in shell config" → Multi-Agent Orchestration > Communication patterns (have)`
}

function buildUserPrompt(input: InfraAssessmentInput): string {
  const lines = [
    'INFRASTRUCTURE SIGNALS:',
    '',
    ...input.signals.map(
      (s, i) => `${i + 1}. [${s.strength}] ${s.signal}: ${s.finding}`,
    ),
  ]
  return lines.join('\n')
}

type RawSonnetOutput = {
  capabilities?: Array<{
    capability?: { theme: string; name: string }
    status?: string
    rationale?: string
  }>
}

export async function assessInfrastructure(
  input: InfraAssessmentInput,
): Promise<InfraAssessmentOutput> {
  // Edge case: zero signals → no need to call Sonnet, it'd hallucinate.
  if (input.signals.length === 0) {
    return { capabilities: [], rawCount: 0, droppedCount: 0 }
  }

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
    const stripped = block.text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim()
    parsed = JSON.parse(stripped) as RawSonnetOutput
  }

  const raw = parsed.capabilities ?? []
  const out: InfraAssessmentOutput['capabilities'] = []
  let dropped = 0
  for (const item of raw) {
    if (
      !item.capability ||
      !isValidCapability(item.capability) ||
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
