import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { fetchContent } from '@/lib/fetch-content'
import { assessResource } from '@/lib/assess-resource'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { resourceId } = await req.json()

    if (!resourceId) {
      return NextResponse.json(
        { error: 'resourceId required' },
        { status: 400 },
      )
    }

    // Get resource
    const resource = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.id, resourceId))
      .limit(1)

    if (!resource.length) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    const res = resource[0]

    // Fetch content with updated fetcher
    const content = await fetchContent(res.url || res.content || '', res.sourceType)

    // Get all projects for matching
    const projects = await db
      .select()
      .from(schema.projects)

    // Get existing resources for dedup
    const existing = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.status, 'active'))

    // Reassess
    const assessment = await assessResource(
      content,
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      existing.map((e) => ({
        id: e.id,
        title: e.title,
        url: e.url,
        summary: content.summary,
      })),
    )

    const suggestedProjectId =
      typeof assessment.suggestedProjectId === 'number'
        ? assessment.suggestedProjectId
        : null

    // Delete old assessment
    await db
      .delete(schema.assessments)
      .where(eq(schema.assessments.resourceId, resourceId))

    // Store new assessment
    const assessmentRecord = await db
      .insert(schema.assessments)
      .values({
        resourceId,
        suggestedProjectId,
        suggestedProjectName: assessment.suggestedProjectName,
        suggestedSequenceIndex: assessment.suggestedSequenceIndex || 0,
        qualityScore: assessment.qualityScore,
        confidence: assessment.confidence,
        isDuplicate: assessment.isDuplicate ? 'yes' : 'no',
        rationale: assessment.rationale,
        userDecision: 'pending',
      })
      .returning()

    return NextResponse.json({
      assessment: {
        ...assessment,
        assessmentId: assessmentRecord[0].id,
      },
    })
  } catch (err) {
    console.error('[reassess] error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    )
  }
}
