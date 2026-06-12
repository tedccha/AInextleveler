import { db, schema } from '@/lib/db/client'
import { desc } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const resources = await db
      .select()
      .from(schema.resources)
      .orderBy(desc(schema.resources.addedAt))

    const projects = await db.select().from(schema.projects)
    const projectsById = Object.fromEntries(projects.map((p) => [p.id, p.name]))

    return NextResponse.json({
      resources,
      projectsById,
    })
  } catch (error) {
    console.error('Error fetching archive data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
