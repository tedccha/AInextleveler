import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const resourceId = parseInt(id)

    if (isNaN(resourceId)) {
      return NextResponse.json({ error: 'Invalid resource ID' }, { status: 400 })
    }

    await db
      .update(schema.resources)
      .set({
        status: 'inbox',
        archivedAt: null,
      })
      .where(eq(schema.resources.id, resourceId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error unarchiving resource:', error)
    return NextResponse.json({ error: 'Failed to unarchive' }, { status: 500 })
  }
}
