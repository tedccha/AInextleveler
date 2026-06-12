/**
 * POST /api/resources/reconsider — re-classify an existing resource with
 * an additional user-provided note appended to the content.
 *
 *   Body: { resource_id: number, note: string }
 *
 * Same SSE pipeline as /api/classify, just rooted at an existing row
 * (which gets updated in place) rather than creating a new one.
 *
 * The note is passed as `userNote` to the Haiku prompt — Haiku knows
 * to weight it for the verdict shift.
 */

import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { embedSingle } from '@/lib/embed'
import { classifyContent } from '@/lib/llm/haiku-classify'
import {
  type Capability,
  type Theme,
} from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const maxDuration = 120

type ReconsiderEvent =
  | { type: 'started'; resource_id: number }
  | { type: 'embedding' }
  | { type: 'classifying' }
  | {
      type: 'verdict'
      resource_id: number
      verdict:
        | 'keep'
        | 'skip'
        | 'already_have'
        | 'not_yet'
        | 'needs_review'
      verdict_reason: string
      review_prompt: string | null
      previous_verdict: string
    }
  | { type: 'error'; message: string }

function frame(e: ReconsiderEvent): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`
}

type Body = { resource_id?: number; note?: string }

export const POST = withSession(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Body

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (e: ReconsiderEvent) => controller.enqueue(enc.encode(frame(e)))

      try {
        const { resource_id, note } = body
        if (typeof resource_id !== 'number') {
          send({ type: 'error', message: 'resource_id required' })
          return
        }
        if (!note || typeof note !== 'string' || !note.trim()) {
          send({ type: 'error', message: 'note required' })
          return
        }
        const rows = await db
          .select()
          .from(schema.resources)
          .where(eq(schema.resources.id, resource_id))
          .limit(1)
        const existing = rows[0]
        if (!existing) {
          send({ type: 'error', message: 'resource not found' })
          return
        }
        send({ type: 'started', resource_id })

        // Re-embed (note may shift cosine similarity).
        send({ type: 'embedding' })
        const combined = `${existing.contentText}\n\n[USER NOTE]: ${note}`
        const embedding = await embedSingle(combined)

        send({ type: 'classifying' })
        const userCaps = await loadUserCapabilities()
        const result = await classifyContent({
          contentText: existing.contentText,
          userNote: note,
          userCapabilities: userCaps,
          sourceUrl: existing.url ?? undefined,
        })

        await db
          .update(schema.resources)
          .set({
            verdict: result.verdict,
            verdictReason: result.verdictReason,
            reviewPrompt: result.reviewPrompt,
            capabilitiesTaught: result.capabilitiesTaught,
            prerequisites: result.prerequisites,
            lessonPlan: result.lessonPlan,
            contentEmbedding: embedding ?? existing.contentEmbedding,
          })
          .where(eq(schema.resources.id, resource_id))

        send({
          type: 'verdict',
          resource_id,
          verdict: result.verdict,
          verdict_reason: result.verdictReason,
          review_prompt: result.reviewPrompt,
          previous_verdict: existing.verdict,
        })
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'unknown error',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})

async function loadUserCapabilities(): Promise<Capability[]> {
  const rows = await db
    .select({
      theme: schema.capabilities.theme,
      name: schema.capabilities.name,
      status: schema.capabilities.status,
    })
    .from(schema.capabilities)
  return rows
    .filter((r) => r.status === 'have' || r.status === 'partial')
    .map((r) => ({ theme: r.theme as Theme, name: r.name }))
}
