/**
 * Agentic Lifecycle Taxonomy — locked v1
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  6 themes ordered by build dependency (each layer assumes above) │
 *   │                                                                  │
 *   │  1. Cognitive Architecture     (how the agent thinks)            │
 *   │  2. Tooling & Interoperability (how the agent acts)              │
 *   │  3. Multi-Agent Orchestration  (the workforce)                   │
 *   │  4. AgentOps Infrastructure    (where agents live)               │
 *   │  5. Evaluation & Reliability   (does it work)                    │
 *   │  6. Safety & Governance        (production discipline)           │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Both LLM prompts (Haiku classify + Sonnet extract/lesson-plan) inject
 * this map and MUST emit `{theme, name}` pairs from the lists below — any
 * other string is rejected by the eval suite.
 */

export const LIFECYCLE_THEMES = [
  'Cognitive Architecture',
  'Tooling & Interoperability',
  'Multi-Agent Orchestration',
  'AgentOps Infrastructure',
  'Evaluation & Reliability',
  'Safety & Governance',
] as const

export type Theme = (typeof LIFECYCLE_THEMES)[number]

export const CAPABILITIES_BY_THEME = {
  'Cognitive Architecture': [
    'Reasoning loops (CoT, ReAct, Plan-and-Execute)',
    'Memory systems (short-term, long-term/RAG, entity/graph)',
    'State management',
    'Task decomposition',
  ],
  'Tooling & Interoperability': [
    'MCP development',
    'API synthesis',
    'Tool authoring',
    'Human-in-the-loop',
  ],
  'Multi-Agent Orchestration': [
    'Communication patterns',
    'Agent specialization',
    'Conflict resolution',
    'Workflow frameworks',
  ],
  'AgentOps Infrastructure': [
    'Sandboxing & isolated execution',
    'Latency & cost optimization',
    'Streaming & async execution',
    'Local & edge inference',
    'Distribution & deployment',
  ],
  'Evaluation & Reliability': [
    'LLM-as-judge evals',
    'Trace observability',
    'Regression suites & golden datasets',
    'Prompt versioning & A/B testing',
  ],
  'Safety & Governance': [
    'Prompt injection defense',
    'PII scrubbing & data privacy',
    'Rate limiting & cost guardrails',
    'Output validation',
    'Authorization & access control',
  ],
} as const satisfies Record<Theme, readonly string[]>

export type Capability = {
  theme: Theme
  name: string
}

/**
 * Flat list of all valid {theme, name} pairs. 26 total.
 * Generated from CAPABILITIES_BY_THEME — single source of truth.
 */
export const ALL_CAPABILITIES: readonly Capability[] = LIFECYCLE_THEMES.flatMap(
  (theme) =>
    CAPABILITIES_BY_THEME[theme].map((name) => ({ theme, name }) as Capability),
)

export const CAPABILITY_COUNT = ALL_CAPABILITIES.length // 26

/**
 * Validates a {theme, name} pair against the taxonomy.
 * Returns true iff theme is in LIFECYCLE_THEMES AND name is in
 * CAPABILITIES_BY_THEME[theme]. Used by classify pipeline + eval suite.
 */
export function isValidCapability(
  c: { theme: string; name: string },
): c is Capability {
  if (!LIFECYCLE_THEMES.includes(c.theme as Theme)) return false
  const list = CAPABILITIES_BY_THEME[c.theme as Theme]
  return list.includes(c.name as never)
}

/**
 * Canonical embedding string format — used for ALL capability embeddings
 * (Voyage-3, 1024 dims). Theme is part of the string so similar-named
 * sub-caps in different themes embed distinctly. Per eng review A6.
 */
export function capabilityEmbedString(c: Capability): string {
  return `${c.theme} > ${c.name}`
}

/**
 * Stable display key, useful as a React key prop or DB unique constraint.
 */
export type CapabilityKey = `${Theme} > ${string}`
export function capabilityKey(c: Capability): CapabilityKey {
  return `${c.theme} > ${c.name}`
}

/**
 * Returns the JSON-serializable map injected into LLM system prompts.
 * Both Haiku and Sonnet receive this verbatim and are instructed:
 *   "Output {theme, name} pairs. Both MUST be exact strings from this map.
 *    No other strings are valid."
 */
export function taxonomyForPrompt(): Record<Theme, readonly string[]> {
  return CAPABILITIES_BY_THEME
}
