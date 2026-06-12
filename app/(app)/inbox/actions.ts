'use server'

import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'

export async function rejectResourceAction(resourceId: number) {
  await db
    .update(schema.resources)
    .set({
      status: 'rejected',
      archivedAt: new Date(),
    })
    .where(eq(schema.resources.id, resourceId))
}

export async function assessAndApproveAction(
  resourceId: number,
  assessmentId: number,
  projectId: number | null,
  sequenceIndex: number,
) {
  // If no projectId, create a new project from the suggestion
  let finalProjectId = projectId

  const assessment = await db
    .select()
    .from(schema.assessments)
    .where(eq(schema.assessments.id, assessmentId))
    .limit(1)

  if (!finalProjectId && assessment[0]?.suggestedProjectName) {
    const newProject = await db
      .insert(schema.projects)
      .values({
        name: assessment[0].suggestedProjectName,
        description: `Auto-created project for ${assessment[0].suggestedProjectName}`,
      })
      .returning({ id: schema.projects.id })

    finalProjectId = newProject[0].id
  }

  // Update resource to active and assign to project
  await db
    .update(schema.resources)
    .set({
      status: 'active',
      projectId: finalProjectId,
      sequenceIndex,
    })
    .where(eq(schema.resources.id, resourceId))

  // Update assessment with user decision
  await db
    .update(schema.assessments)
    .set({
      userDecision: 'accept',
      userProjectId: finalProjectId,
      userSequenceIndex: sequenceIndex,
      reviewedAt: new Date(),
    })
    .where(eq(schema.assessments.id, assessmentId))
}
