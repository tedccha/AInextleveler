import { db, schema } from '@/lib/db/client'
import { eq, isNull, sql } from 'drizzle-orm'
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

    // Get resource from inbox
    const resource = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.id, resourceId))
      .limit(1)

    if (!resource.length) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    }

    const res = resource[0]
    if (res.status !== 'inbox') {
      return NextResponse.json(
        { error: 'Resource not in inbox' },
        { status: 400 },
      )
    }

    // Fetch content
    const content = await fetchContent(res.url || res.content || '', res.sourceType)

    // Get all projects for matching
    const projects = await db
      .select()
      .from(schema.projects)
      .where(isNull(schema.projects.archivedAt))

    // Get existing resources for dedup (active + inReview)
    const existing = await db
      .select()
      .from(schema.resources)
      .where(
        // Include both active and inReview for duplicate detection
        sql`${schema.resources.status} IN ('active', 'inReview')`
      )

    // Check for URL-based duplicates first
    let urlDuplicate: (typeof existing)[0] | undefined
    const resUrl = res.url?.trim()
    if (resUrl) {
      urlDuplicate = existing.find((e) => e.url?.trim() === resUrl)
    }

    // If URL match found, mark as duplicate immediately
    if (urlDuplicate) {
      const assessmentRecord = await db
        .insert(schema.assessments)
        .values({
          resourceId,
          suggestedProjectId: null,
          suggestedProjectName: null,
          suggestedSequenceIndex: 0,
          qualityScore: 10,
          confidence: 100,
          isDuplicate: `${urlDuplicate.id}`,
          rationale: `Exact URL match: "${urlDuplicate.title}"`,
          userDecision: 'pending',
        })
        .returning()

      return NextResponse.json({
        assessment: {
          qualityScore: 10,
          isDuplicate: true,
          duplicateOf: urlDuplicate,
          suggestedProjectId: null,
          suggestedProjectName: null,
          suggestedSequenceIndex: 0,
          rationale: `Exact URL match: "${urlDuplicate.title}"`,
          confidence: 100,
          assessmentId: assessmentRecord[0].id,
        },
      })
    }

    // Assess with Haiku for semantic duplicate detection
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
        summary: e.content || '',
      })),
    )

    // Validate suggestedProjectId is an integer
    const suggestedProjectId =
      typeof assessment.suggestedProjectId === 'number'
        ? assessment.suggestedProjectId
        : null

    // If Haiku detected duplicate, store the duplicate ID
    let isDuplicateValue = 'no'
    if (assessment.isDuplicate && assessment.duplicateOf) {
      isDuplicateValue = `${assessment.duplicateOf.id}`
    }

    // Store assessment
    const assessmentRecord = await db
      .insert(schema.assessments)
      .values({
        resourceId,
        suggestedProjectId,
        suggestedProjectName: assessment.suggestedProjectName,
        suggestedSequenceIndex: assessment.suggestedSequenceIndex || 0,
        qualityScore: assessment.qualityScore,
        confidence: assessment.confidence,
        isDuplicate: isDuplicateValue,
        rationale: assessment.rationale,
        userDecision: 'pending',
      })
      .returning()

    // Update resource status to inReview
    await db
      .update(schema.resources)
      .set({
        status: 'inReview',
        title: content.title,
      })
      .where(eq(schema.resources.id, resourceId))

    return NextResponse.json({
      assessment: {
        ...assessment,
        assessmentId: assessmentRecord[0].id,
      },
    })
  } catch (err) {
    console.error('[assess] error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    )
  }
}
