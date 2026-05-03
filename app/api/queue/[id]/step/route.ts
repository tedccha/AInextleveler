/**
 * POST /api/queue/[id]/step
 *
 *   Body: { order: number, done: boolean }
 *
 *   Toggle the `done` flag on a single lesson_plan step. Persists to
 *   queue_items.lesson_plan JSONB.
 *
 *   Side effects on status:
 *   - If toggling a step to done causes ALL steps to be done → status='completed',
 *     completed_at=NOW.
 *   - If toggling a step from done to not-done while status='completed' → status='in_progress',
 *     completed_at=NULL.
 *   - If status='queued' and any step gets checked → status='in_progress',
 *     started_at=NOW (auto-Start when user starts checking off lessons).
 *
 *   This keeps the card UI honest: status is derived from step state,
 *   not just from the explicit Start/Done buttons.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import type { LessonStep } from '@/lib/db/schema'

export const runtime = 'nodejs'

const Body = z.object({
  order: z.number().int().positive(),
  done: z.boolean(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withSession(async (req: NextRequest, _session, ctx: RouteContext) => {
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
  const { order, done } = parsed.data

  const rows = await db
    .select()
    .from(schema.queueItems)
    .where(eq(schema.queueItems.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const lessonPlan = (row.lessonPlan as LessonStep[]) ?? []
  const idx = lessonPlan.findIndex((s) => s.order === order)
  if (idx < 0) {
    return NextResponse.json(
      { error: `no step with order=${order}` },
      { status: 400 },
    )
  }

  // No-op if already at desired state.
  if (lessonPlan[idx].done === done) {
    return NextResponse.json({ ok: true, status: row.status, noop: true })
  }

  const updated = lessonPlan.map((s, i) =>
    i === idx ? { ...s, done } : s,
  )
  const allDone = updated.length > 0 && updated.every((s) => s.done)
  const anyDone = updated.some((s) => s.done)

  // Status transitions driven by step state:
  let newStatus: 'queued' | 'in_progress' | 'completed' = row.status
  let startedAt: Date | null = row.startedAt
  let completedAt: Date | null = row.completedAt
  const now = new Date()

  if (allDone) {
    newStatus = 'completed'
    completedAt = now
    if (!startedAt) startedAt = now
  } else if (row.status === 'completed' && !allDone) {
    // Un-checked a step while completed → back to in_progress
    newStatus = 'in_progress'
    completedAt = null
  } else if (row.status === 'queued' && anyDone) {
    // Auto-start: queued → in_progress on first check
    newStatus = 'in_progress'
    if (!startedAt) startedAt = now
  }

  await db
    .update(schema.queueItems)
    .set({
      lessonPlan: updated,
      status: newStatus,
      startedAt,
      completedAt,
    })
    .where(eq(schema.queueItems.id, id))

  return NextResponse.json({ ok: true, status: newStatus })
})
