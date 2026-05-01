/**
 * POST /api/capabilities/override
 *
 * Body: { theme, name, status: 'have' | 'partial' | 'missing' | null }
 *   - status === null  → clear the override (re-enable scan-driven status)
 *   - otherwise        → set status + manual_override=true
 *
 * If the row doesn't exist, this insert-or-updates so a user can mark a
 * capability Have before any scan has populated it.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { and, eq } from 'drizzle-orm'
import { LIFECYCLE_THEMES, isValidCapability, type Theme } from '@/lib/taxonomy'

export const runtime = 'nodejs'

const Body = z.object({
  theme: z.enum(LIFECYCLE_THEMES),
  name: z.string().min(1),
  status: z.enum(['have', 'partial', 'missing']).nullable(),
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
  const { theme, name, status } = parsed.data

  // Belt + suspenders: validate that (theme, name) is a real taxonomy pair.
  if (!isValidCapability({ theme, name })) {
    return NextResponse.json(
      { error: `${theme} > ${name} is not in the taxonomy` },
      { status: 400 },
    )
  }

  const existing = await db
    .select()
    .from(schema.capabilities)
    .where(
      and(
        eq(schema.capabilities.theme, theme),
        eq(schema.capabilities.name, name),
      ),
    )
    .limit(1)

  if (status === null) {
    // Clear override. If row exists, reset manual_override; status falls back
    // to whatever scans say next time. For now, leave status as-is.
    if (existing[0]) {
      await db
        .update(schema.capabilities)
        .set({
          manualOverride: false,
          lastVerifiedAt: new Date(),
        })
        .where(eq(schema.capabilities.id, existing[0].id))
    }
    return NextResponse.json({ ok: true, cleared: true })
  }

  const weight = status === 'have' ? 1.0 : status === 'partial' ? 0.5 : 0
  if (existing[0]) {
    await db
      .update(schema.capabilities)
      .set({
        status,
        effectiveWeight: weight,
        manualOverride: true,
        lastVerifiedAt: new Date(),
      })
      .where(eq(schema.capabilities.id, existing[0].id))
  } else {
    await db.insert(schema.capabilities).values({
      theme: theme as Theme,
      name,
      status,
      effectiveWeight: weight,
      manualOverride: true,
      lastVerifiedAt: new Date(),
      embedding: null,
    })
  }
  return NextResponse.json({ ok: true, status, manual_override: true })
})
