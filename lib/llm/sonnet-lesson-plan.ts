/**
 * Sonnet — generate {why_now, lesson_plan} for a `keep` resource on
 * Add-to-queue. Different from Haiku's `not_yet` lesson_plan in two ways:
 *
 *   - Audience: user is READY to consume this resource. Lesson plan is the
 *     path THROUGH the resource, not the lead-up to it.
 *   - Step types: prefer `doing` (build, run, modify) and `resource` (link
 *     to other library items the user has). Avoid `capability` here unless
 *     a specific Have/Partial threshold matters before a step.
 *
 *   Implementation note: tool_use guarantees structured output. System
 *   prompt is cached (taxonomy + rules are identical across promotes).
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  type Capability,
  type Theme,
  isValidCapability,
  taxonomyForPrompt,
} from '@/lib/taxonomy'
import type { LessonStep } from '@/lib/db/schema'
import { extractToolInput, ToolUseExtractError } from './tool-use'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 2048
const TOOL_NAME = 'record_lesson_plan'

export type LessonPlanInput = {
  resource: {
    id: number
    title: string
    url: string | null
    contentText: string
    capabilitiesTaught: Capability[]
  }
  userCapabilities: Capability[]
  availableLibrary: Array<{ id: number; title: string }>
}

export type LessonPlanOutput = {
  whyNow: string
  lessonPlan: LessonStep[]
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
  return `You generate a lesson plan for a developer who has chosen a piece of content to work through. They have already decided to keep it. Your job: design the path they should take THROUGH this resource given their current capability profile.

LIFECYCLE TAXONOMY (the ONLY valid {theme, name} pairs):

${JSON.stringify(taxonomy, null, 2)}

STEP TYPE RULES:
- Prefer "doing" for most steps (the user is consuming THIS content actively).
- Use "resource" when the user has another keep/already_have item in their library that should be read first. The resource_id MUST be from the AVAILABLE LIBRARY list provided in the user message.
- Use "capability" sparingly — only when a specific Have/Partial threshold should be reached before this step. capability.theme and capability.name MUST be exact taxonomy strings.

OTHER RULES:
- 2-5 steps total. More than 5 dilutes; fewer than 2 isn't a plan.
- "estimated_effort": S=under 30 min, M=30 min-2 hr, L=2+ hr.
- Order steps from earliest to latest in dependency.
- "why_now" is 1-2 sentences explaining why this is the right thing for the user to tackle now.`
})()

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Record the why_now rationale and ordered lesson plan for the user to work through this resource.',
  input_schema: {
    type: 'object',
    properties: {
      why_now: {
        type: 'string',
        description:
          '1-2 sentences explaining why this is the right thing for the user to tackle now, given what they are missing.',
      },
      lesson_plan: {
        type: 'array',
        description: '2-5 ordered steps for the user to work through.',
        items: {
          type: 'object',
          properties: {
            order: { type: 'integer', description: 'Starting at 1.' },
            title: {
              type: 'string',
              description: 'Imperative verb phrase ("Set up the dev env", "Build the example").',
            },
            type: {
              type: 'string',
              enum: ['doing', 'resource', 'capability'],
            },
            capability: {
              type: ['object', 'null'],
              description: 'Required when type="capability"; otherwise null.',
              properties: {
                theme: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['theme', 'name'],
            },
            resource_id: {
              type: ['integer', 'null'],
              description:
                'Required when type="resource"; MUST be an id from the AVAILABLE LIBRARY list. Otherwise null.',
            },
            description: {
              type: 'string',
              description: '1-2 sentences — what to do AND why.',
            },
            estimated_effort: { type: 'string', enum: ['S', 'M', 'L'] },
          },
          required: [
            'order',
            'title',
            'type',
            'capability',
            'resource_id',
            'description',
            'estimated_effort',
          ],
        },
      },
    },
    required: ['why_now', 'lesson_plan'],
  },
}

type ToolInput = {
  why_now?: string
  lesson_plan?: Array<{
    order?: number
    title?: string
    type?: string
    capability?: { theme?: string; name?: string } | null
    resource_id?: number | null
    description?: string
    estimated_effort?: string
  }>
}

function buildUserPrompt(input: LessonPlanInput): string {
  const userCapStrings =
    input.userCapabilities.length > 0
      ? input.userCapabilities
          .map((c) => `${c.theme} > ${c.name}`)
          .join('\n  - ')
      : '(none)'

  const libStrings =
    input.availableLibrary.length > 0
      ? input.availableLibrary
          .map((r) => `id=${r.id}: ${r.title}`)
          .join('\n  - ')
      : '(none)'

  const taughtStrings =
    input.resource.capabilitiesTaught.length > 0
      ? input.resource.capabilitiesTaught
          .map((c) => `${c.theme} > ${c.name}`)
          .join(', ')
      : '(none extracted)'

  return [
    `RESOURCE TITLE: ${input.resource.title}`,
    `RESOURCE URL: ${input.resource.url ?? '(plain text paste)'}`,
    `CAPABILITIES THIS RESOURCE TEACHES: ${taughtStrings}`,
    '',
    'USER CURRENT CAPABILITIES (Have or Partial):',
    `  - ${userCapStrings}`,
    '',
    'AVAILABLE LIBRARY (resources user already has, usable as `resource` step type):',
    `  - ${libStrings}`,
    '',
    '<resource-content>',
    input.resource.contentText.slice(0, 4000),
    '</resource-content>',
  ].join('\n')
}

export async function generateLessonPlan(
  input: LessonPlanInput,
): Promise<LessonPlanOutput> {
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
      throw new Error(`Sonnet did not invoke ${TOOL_NAME}: ${err.message}`)
    }
    throw err
  }

  const validResourceIds = new Set(input.availableLibrary.map((r) => r.id))
  const rawSteps = parsed.lesson_plan ?? []
  const out: LessonStep[] = []
  let dropped = 0
  for (let idx = 0; idx < rawSteps.length; idx++) {
    const s = rawSteps[idx]
    const stepType =
      s.type === 'capability' || s.type === 'resource' || s.type === 'doing'
        ? s.type
        : 'doing'

    let cap: Capability | undefined
    let resourceId: number | undefined

    if (stepType === 'capability') {
      if (
        !s.capability?.theme ||
        !s.capability?.name ||
        !isValidCapability({
          theme: s.capability.theme,
          name: s.capability.name,
        })
      ) {
        dropped++
        continue
      }
      cap = {
        theme: s.capability.theme as Theme,
        name: s.capability.name,
      }
    } else if (stepType === 'resource') {
      if (
        typeof s.resource_id !== 'number' ||
        !validResourceIds.has(s.resource_id)
      ) {
        dropped++
        continue
      }
      resourceId = s.resource_id
    }

    const effort =
      s.estimated_effort === 'S' ||
      s.estimated_effort === 'M' ||
      s.estimated_effort === 'L'
        ? s.estimated_effort
        : 'M'
    const order = typeof s.order === 'number' ? s.order : idx + 1
    const title =
      typeof s.title === 'string' && s.title.trim() ? s.title : `Step ${order}`
    const description = typeof s.description === 'string' ? s.description : ''

    out.push({
      order,
      title,
      type: stepType,
      capability: cap,
      resourceId,
      description,
      estimatedEffort: effort,
      done: false,
    })
  }

  out.sort((a, b) => a.order - b.order)
  for (let i = 0; i < out.length; i++) out[i].order = i + 1

  return {
    whyNow:
      typeof parsed.why_now === 'string' && parsed.why_now.trim()
        ? parsed.why_now
        : 'Closes a gap in your capability map.',
    lessonPlan: out,
    rawCount: rawSteps.length,
    droppedCount: dropped,
  }
}
