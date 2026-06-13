/**
 * PATCH /api/resources/{id} — archive or delete a resource
 * Body: { action: 'archive' | 'delete' }
 */

import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

type Body = {
  action: 'archive' | 'delete'
}

export const PATCH = withSession(async (req, session, { params }) => {
  try {
    const id = parseInt((await params).id as string)
    if (isNaN(id)) {
      return Response.json({ message: 'Invalid resource ID' }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as Body
    if (!body.action || !['archive', 'delete'].includes(body.action)) {
      return Response.json(
        { message: 'Invalid action' },
        { status: 400 },
      )
    }

    if (body.action === 'archive') {
      await db
        .update(schema.resources)
        .set({ archivedAt: new Date() })
        .where(eq(schema.resources.id, id))
    } else if (body.action === 'delete') {
      await db.delete(schema.resources).where(eq(schema.resources.id, id))
    }

    return Response.json({ success: true })
  } catch (err) {
    console.error('Resource action error:', err)
    return Response.json(
      { message: 'Action failed' },
      { status: 500 },
    )
  }
})
