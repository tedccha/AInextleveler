/**
 * POST /api/embed-backfill
 *
 *   Embeds rows where the embedding column is null.
 *   Hits both tables: capabilities + resources.
 *   100ms delay between Voyage calls (per CEO #6).
 *   SSE stream so the user sees progress on potentially long backfills.
 *
 *   Per eng review A3: this is the manual escape hatch for Voyage
 *   outages. Null embedding IS the flag — no extra column needed.
 */

import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq, isNull } from 'drizzle-orm'
import { embedSingle } from '@/lib/embed'
import { capabilityEmbedString, type Theme } from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const maxDuration = 600

type BackfillEvent =
  | { type: 'started'; capabilities_pending: number; resources_pending: number }
  | {
      type: 'embedding'
      table: 'capabilities' | 'resources'
      index: number
      total: number
      label: string
    }
  | { type: 'embed_failed'; table: 'capabilities' | 'resources'; label: string }
  | {
      type: 'completed'
      capabilities_done: number
      capabilities_failed: number
      resources_done: number
      resources_failed: number
    }
  | { type: 'error'; message: string }

function frame(event: BackfillEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const POST = withSession(async () => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (e: BackfillEvent) => controller.enqueue(enc.encode(frame(e)))
      try {
        const capRows = await db
          .select()
          .from(schema.capabilities)
          .where(isNull(schema.capabilities.embedding))
        const resRows = await db
          .select()
          .from(schema.resources)
          .where(isNull(schema.resources.contentEmbedding))

        send({
          type: 'started',
          capabilities_pending: capRows.length,
          resources_pending: resRows.length,
        })

        let capsDone = 0
        let capsFailed = 0
        for (let i = 0; i < capRows.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 100))
          const row = capRows[i]
          const label = `${row.theme} > ${row.name}`
          send({
            type: 'embedding',
            table: 'capabilities',
            index: i + 1,
            total: capRows.length,
            label,
          })
          const vec = await embedSingle(
            capabilityEmbedString({
              theme: row.theme as Theme,
              name: row.name,
            }),
          )
          if (vec === null) {
            capsFailed++
            send({ type: 'embed_failed', table: 'capabilities', label })
            continue
          }
          await db
            .update(schema.capabilities)
            .set({ embedding: vec })
            .where(eq(schema.capabilities.id, row.id))
          capsDone++
        }

        let resDone = 0
        let resFailed = 0
        for (let i = 0; i < resRows.length; i++) {
          if (i > 0 || capRows.length > 0)
            await new Promise((r) => setTimeout(r, 100))
          const row = resRows[i]
          const label =
            row.url ?? `resource #${row.id}`
          send({
            type: 'embedding',
            table: 'resources',
            index: i + 1,
            total: resRows.length,
            label,
          })
          const vec = await embedSingle(row.contentText.slice(0, 4000))
          if (vec === null) {
            resFailed++
            send({ type: 'embed_failed', table: 'resources', label })
            continue
          }
          await db
            .update(schema.resources)
            .set({ contentEmbedding: vec })
            .where(eq(schema.resources.id, row.id))
          resDone++
        }

        send({
          type: 'completed',
          capabilities_done: capsDone,
          capabilities_failed: capsFailed,
          resources_done: resDone,
          resources_failed: resFailed,
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
