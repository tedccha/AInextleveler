/**
 * POST /api/resources/needs-review — resolve a needs_review item.
 *
 *   Body: { resource_id, action: 'keep' | 'skip' }
 *
 * Sets verdict to keep or skip without re-running Haiku. Use this for
 * the Needs Review section's quick-promote buttons. For a richer
 * re-classification with new user context, use /api/resources/reconsider.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

const Body = z.object({
  resource_id: z.number().int().positive(),
  action: z.enum(['keep', 'skip']),
})

export const POST = withSession(async (req: NextRequest) => {
  const json = await req.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { resource_id, action } = parsed.data
  const rows = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.id, resource_id))
    .limit(1)
  if (!rows[0]) {
    return NextResponse.json({ error: 'resource not found' }, { status: 404 })
  }
  if (rows[0].verdict !== 'needs_review') {
    return NextResponse.json(
      { error: `cannot resolve a ${rows[0].verdict} item via this endpoint` },
      { status: 400 },
    )
  }
  await db
    .update(schema.resources)
    .set({
      verdict: action,
      reviewPrompt: null,
    })
    .where(eq(schema.resources.id, resource_id))
  return NextResponse.json({ ok: true, verdict: action })
})
