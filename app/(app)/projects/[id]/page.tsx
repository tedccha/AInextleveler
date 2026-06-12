import { db, schema } from '@/lib/db/client'
import { eq, inArray } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AddResourceButton } from './add-resource-button'
import { EditProjectButton } from '../../edit-project-button'
import { ResourceItem } from './resource-item'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function ProjectPage({
  params: paramsPromise,
}: {
  params: Promise<{ id: string }>
}) {
  const params = await paramsPromise
  const projectId = parseInt(params.id)
  if (isNaN(projectId)) notFound()

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1)

  if (!project.length) notFound()

  const proj = project[0]

  const resources = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.projectId, projectId))
    .orderBy(schema.resources.sequenceIndex)

  // Fetch assessments for all resources in this project
  let assessments: typeof schema.assessments.$inferSelect[] = []
  if (resources.length > 0) {
    const resourceIds = resources.map((r) => r.id)
    assessments = await db
      .select()
      .from(schema.assessments)
      .where(inArray(schema.assessments.resourceId, resourceIds))
  }

  const assessmentMap = new Map(
    assessments.map((a) => [a.resourceId, a])
  )

  const inboxCount = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.status, 'inbox'))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1>{proj.name}</h1>
            <EditProjectButton project={proj} />
          </div>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            {proj.description}
          </p>
        </div>
        <AddResourceButton projectId={projectId} />
      </div>

      {resources.length === 0 ? (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No resources in this project yet. Add one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {resources.map((resource, idx) => (
            <ResourceItem
              key={resource.id}
              resource={resource}
              assessment={assessmentMap.get(resource.id)}
              index={idx}
            />
          ))}
        </div>
      )}

      {inboxCount.length > 0 && (
        <div className="mt-8 rounded-card border border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 p-4">
          <p className="text-sm">
            You have{' '}
            <Link
              href="/inbox"
              className="font-semibold text-[hsl(var(--accent))] hover:underline"
            >
              {inboxCount.length} resource{inboxCount.length !== 1 ? 's' : ''} in your
              inbox
            </Link>{' '}
            waiting for assessment.
          </p>
        </div>
      )}
    </div>
  )
}
