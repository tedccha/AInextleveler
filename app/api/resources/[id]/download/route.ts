/**
 * GET /api/resources/{id}/download — download resource content as markdown
 */

import { withSession } from '@/lib/auth'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

export const GET = withSession(async (req, session, { params }) => {
  try {
    const id = parseInt((await params).id as string)
    if (isNaN(id)) {
      return new Response('Invalid resource ID', { status: 400 })
    }

    const resource = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.id, id))
      .limit(1)

    if (!resource[0]) {
      return new Response('Resource not found', { status: 404 })
    }

    const filename = `resource-${id}.md`
    return new Response(resource[0].contentText, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (err) {
    console.error('Download error:', err)
    return new Response('Download failed', { status: 500 })
  }
})
