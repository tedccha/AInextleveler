/**
 * PATCH /api/queue/[id]
 *
 *   State-machine transitions on a single queue_items row:
 *
 *     queued ──start──▶ in_progress ──done──▶ completed
 *       ▲                  │                      │
 *       │                  └──abandon──┐          │
 *       │                              │          │
 *       └──────────────────────────────┘          │
 *                                                 ▼
 *                                              reopen
 *                                                 │
 *                                                 ▼
 *                                            in_progress
 *
 *   Body: { action: 'start' | 'done' | 'reopen' | 'abandon' }
 *
 *   - start: set status=in_progress, started_at=NOW. Idempotent (no-op
 *     if already in_progress). Errors if status=completed (use reopen).
 *   - done: set status=completed, completed_at=NOW. Marks all lesson_plan
 *     steps as done. Errors if status=completed (no-op anyway, but
 *     surface the error for clarity).
 *   - reopen: set status=in_progress. Un-checks the LAST step so user
 *     can pick up mid-work. Errors if status != completed.
 *   - abandon: set status=queued, started_at=NULL, all steps un-checked.
 *     Confirmation lives in UI; this just executes.
 *
 *   DELETE /api/queue/[id]: remove from queue entirely (no transition).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import type { LessonStep } from '@/lib/db/schema'

export const runtime = 'nodejs'

const Body = z.object({
  action: z.enum(['start', 'done', 'reopen', 'abandon']),
})

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withSession(async (req: NextRequest, _session, ctx: RouteContext) => {
  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const json = await req.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const rows = await db
    .select()
    .from(schema.queueItems)
    .where(eq(schema.queueItems.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const lessonPlan = (row.lessonPlan as LessonStep[]) ?? []
  const now = new Date()

  switch (parsed.data.action) {
    case 'start': {
      if (row.status === 'completed') {
        return NextResponse.json(
          { error: "can't start a completed item — use reopen" },
          { status: 400 },
        )
      }
      await db
        .update(schema.queueItems)
        .set({
          status: 'in_progress',
          startedAt: row.startedAt ?? now,
        })
        .where(eq(schema.queueItems.id, id))
      return NextResponse.json({ ok: true, status: 'in_progress' })
    }

    case 'done': {
      const allDone = lessonPlan.map((s) => ({ ...s, done: true }))
      await db
        .update(schema.queueItems)
        .set({
          status: 'completed',
          completedAt: now,
          lessonPlan: allDone,
        })
        .where(eq(schema.queueItems.id, id))
      return NextResponse.json({ ok: true, status: 'completed' })
    }

    case 'reopen': {
      if (row.status !== 'completed') {
        return NextResponse.json(
          { error: "can only reopen a completed item" },
          { status: 400 },
        )
      }
      // Un-check last step so user can pick up mid-work.
      const reopened = [...lessonPlan]
      if (reopened.length > 0) {
        reopened[reopened.length - 1] = {
          ...reopened[reopened.length - 1],
          done: false,
        }
      }
      await db
        .update(schema.queueItems)
        .set({
          status: 'in_progress',
          completedAt: null,
          lessonPlan: reopened,
        })
        .where(eq(schema.queueItems.id, id))
      return NextResponse.json({ ok: true, status: 'in_progress' })
    }

    case 'abandon': {
      const reset = lessonPlan.map((s) => ({ ...s, done: false }))
      await db
        .update(schema.queueItems)
        .set({
          status: 'queued',
          startedAt: null,
          completedAt: null,
          lessonPlan: reset,
        })
        .where(eq(schema.queueItems.id, id))
      return NextResponse.json({ ok: true, status: 'queued' })
    }
  }
})

export const DELETE = withSession(async (_req, _session, ctx: RouteContext) => {
  const { id: idParam } = await ctx.params
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }
  const result = await db
    .delete(schema.queueItems)
    .where(eq(schema.queueItems.id, id))
    .returning({ id: schema.queueItems.id })
  if (result.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
})
