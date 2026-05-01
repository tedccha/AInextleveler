/**
 * POST /api/classify — paste pipeline.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Body: { url?, contentText? }                                    │
 *   │                                                                  │
 *   │   1. fetching         (skipped for plain text or pre-pasted URL) │
 *   │      ↓ if needs_paste → emits { type:'needs_paste', reason }     │
 *   │   2. embedding        Voyage. null on failure (banner appears).  │
 *   │   3. classifying      Haiku. retry once on malformed JSON.       │
 *   │   4. checking_library pgvector cosine sim ≥ 0.85 → already_have │
 *   │   ↓                                                              │
 *   │   verdict             full classification result + db row id     │
 *   │                                                                  │
 *   │  Per design A1: Node runtime. Per design Q3: prompt-injection    │
 *   │  wrap (in lib/llm/haiku-classify.ts).                            │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm'
import { fetchUrlContent, looksLikeUrl } from '@/lib/fetch-url'
import { embedSingle } from '@/lib/embed'
import { classifyContent } from '@/lib/llm/haiku-classify'
import {
  type Capability,
  type Theme,
  capabilityKey,
} from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const maxDuration = 120

const CONTENT_CAP = 4000
const SIMILARITY_THRESHOLD = 0.85

type ClassifyEvent =
  | { type: 'fetching'; source: string }
  | { type: 'fetched'; chars: number; truncated: boolean }
  | {
      type: 'needs_paste'
      reason: 'x_or_twitter' | 'fetch_failed' | 'not_text' | 'empty'
      status?: number
    }
  | { type: 'embedding' }
  | { type: 'embedding_failed' }
  | { type: 'classifying' }
  | { type: 'checking_library'; vector_search: boolean }
  | {
      type: 'already_evaluated'
      resource_id: number
      verdict: string
      url: string
    }
  | {
      type: 'verdict'
      resource_id: number
      verdict:
        | 'keep'
        | 'skip'
        | 'already_have'
        | 'not_yet'
        | 'needs_review'
      title: string
      verdict_reason: string
      review_prompt: string | null
      capabilities_taught: Capability[]
      prerequisites: Capability[]
      lesson_plan_count: number
      already_have_via?: 'haiku' | 'pgvector'
      similarity_top?: { key: string; score: number } | null
      embedding_failed: boolean
      overridden_by_confidence: boolean
      dropped_capabilities: number
    }
  | { type: 'error'; stage: string; message: string }

function frame(event: ClassifyEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

type Body = {
  url?: string
  contentText?: string
  /** When user already saw a needs_paste prompt and supplied content, set true. */
  pastedAfterPrompt?: boolean
}

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

/**
 * pgvector cosine similarity check. Returns the closest capability among
 * the user's Have/Partial set (so we don't say "already_have" against a
 * Missing capability).
 */
async function topSimilarCapability(
  embedding: number[],
): Promise<{ key: string; score: number } | null> {
  // Build the parameterized vector literal once.
  const vecLiteral = `[${embedding.join(',')}]`
  // Use `<=>` (cosine distance). similarity = 1 - distance.
  // Filter on user-have-or-partial capabilities only, with non-null embedding.
  const rows = await db
    .select({
      theme: schema.capabilities.theme,
      name: schema.capabilities.name,
      distance: sql<number>`${schema.capabilities.embedding} <=> ${vecLiteral}::vector`,
    })
    .from(schema.capabilities)
    .where(
      and(
        isNotNull(schema.capabilities.embedding),
        // 'have' OR 'partial'
        sql`${schema.capabilities.status} IN ('have', 'partial')` as SQL,
      ),
    )
    .orderBy(
      sql<number>`${schema.capabilities.embedding} <=> ${vecLiteral}::vector`,
    )
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    key: capabilityKey({ theme: r.theme as Theme, name: r.name }),
    score: 1 - Number(r.distance),
  }
}

export const POST = withSession(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Body
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (e: ClassifyEvent) =>
        controller.enqueue(enc.encode(frame(e)))

      try {
        let url = body.url?.trim() ?? null
        let contentText = body.contentText?.trim() ?? null

        // Defensive: a single field with a URL on its own should be treated as URL.
        if (!url && contentText && looksLikeUrl(contentText)) {
          url = contentText
          contentText = null
        }

        if (!url && !contentText) {
          send({
            type: 'error',
            stage: 'input',
            message: 'Provide a URL or content text.',
          })
          return
        }

        // De-dup check — UNIQUE(url) at the DB level + this UX hint.
        if (url) {
          const existing = await db
            .select()
            .from(schema.resources)
            .where(eq(schema.resources.url, url))
            .limit(1)
          if (existing[0] && !body.pastedAfterPrompt) {
            send({
              type: 'already_evaluated',
              resource_id: existing[0].id,
              verdict: existing[0].verdict,
              url,
            })
            return
          }
        }

        // ── Stage 1: fetch (only when URL given without contentText)
        if (url && !contentText) {
          send({ type: 'fetching', source: url })
          const result = await fetchUrlContent(url)
          if (result.kind === 'error') {
            send({ type: 'error', stage: 'fetch', message: result.message })
            return
          }
          if (result.kind === 'needs_paste') {
            send({
              type: 'needs_paste',
              reason: result.reason,
              status: result.status,
            })
            return
          }
          contentText = result.content
        }

        if (!contentText) {
          send({
            type: 'error',
            stage: 'input',
            message: 'No content to classify.',
          })
          return
        }

        // Truncate (per CEO #3 + UI also enforces).
        const original = contentText.length
        contentText = contentText.slice(0, CONTENT_CAP)
        send({
          type: 'fetched',
          chars: contentText.length,
          truncated: original > CONTENT_CAP,
        })

        // ── Stage 2: embed
        send({ type: 'embedding' })
        const embedding = await embedSingle(contentText)
        if (embedding === null) {
          send({ type: 'embedding_failed' })
        }

        // ── Stage 3: classify
        send({ type: 'classifying' })
        const userCaps = await loadUserCapabilities()
        const classified = await classifyContent({
          contentText,
          userCapabilities: userCaps,
          sourceUrl: url ?? undefined,
        })

        // ── Stage 4: pgvector check (only when verdict !== already_have AND we have an embedding)
        let alreadyHaveVia: 'haiku' | 'pgvector' | undefined
        let similarityTop: { key: string; score: number } | null = null
        let finalVerdict = classified.verdict

        if (finalVerdict === 'already_have') {
          alreadyHaveVia = 'haiku'
          send({ type: 'checking_library', vector_search: false })
        } else if (embedding) {
          send({ type: 'checking_library', vector_search: true })
          similarityTop = await topSimilarCapability(embedding)
          if (similarityTop && similarityTop.score >= SIMILARITY_THRESHOLD) {
            finalVerdict = 'already_have'
            alreadyHaveVia = 'pgvector'
          }
        } else {
          send({ type: 'checking_library', vector_search: false })
        }

        // ── Persist
        // If url was provided and an existing row matches and pastedAfterPrompt
        // is true, update in place. Otherwise insert.
        let resourceId: number
        if (url && body.pastedAfterPrompt) {
          const existing = await db
            .select()
            .from(schema.resources)
            .where(eq(schema.resources.url, url))
            .limit(1)
          if (existing[0]) {
            await db
              .update(schema.resources)
              .set({
                contentText,
                verdict: finalVerdict,
                capabilitiesTaught: classified.capabilitiesTaught,
                prerequisites: classified.prerequisites,
                verdictReason: classified.verdictReason,
                reviewPrompt: classified.reviewPrompt,
                lessonPlan: classified.lessonPlan,
                contentEmbedding: embedding ?? existing[0].contentEmbedding,
              })
              .where(eq(schema.resources.id, existing[0].id))
            resourceId = existing[0].id
          } else {
            const inserted = await db
              .insert(schema.resources)
              .values({
                url,
                contentText,
                verdict: finalVerdict,
                capabilitiesTaught: classified.capabilitiesTaught,
                prerequisites: classified.prerequisites,
                verdictReason: classified.verdictReason,
                reviewPrompt: classified.reviewPrompt,
                lessonPlan: classified.lessonPlan,
                contentEmbedding: embedding,
              })
              .returning({ id: schema.resources.id })
            resourceId = inserted[0].id
          }
        } else {
          const inserted = await db
            .insert(schema.resources)
            .values({
              url,
              contentText,
              verdict: finalVerdict,
              capabilitiesTaught: classified.capabilitiesTaught,
              prerequisites: classified.prerequisites,
              verdictReason: classified.verdictReason,
              reviewPrompt: classified.reviewPrompt,
              lessonPlan: classified.lessonPlan,
              contentEmbedding: embedding,
            })
            .returning({ id: schema.resources.id })
          resourceId = inserted[0].id
        }

        send({
          type: 'verdict',
          resource_id: resourceId,
          verdict: finalVerdict,
          title: classified.title,
          verdict_reason: classified.verdictReason,
          review_prompt: classified.reviewPrompt,
          capabilities_taught: classified.capabilitiesTaught,
          prerequisites: classified.prerequisites,
          lesson_plan_count: classified.lessonPlan.length,
          already_have_via: alreadyHaveVia,
          similarity_top: similarityTop,
          embedding_failed: embedding === null,
          overridden_by_confidence: classified.overriddenByConfidence,
          dropped_capabilities: classified.droppedCapabilities,
        })
      } catch (err) {
        send({
          type: 'error',
          stage: 'unknown',
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
