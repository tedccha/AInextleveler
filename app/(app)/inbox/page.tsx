import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { InboxItem } from './inbox-item'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  // Get inbox items (not yet reviewed)
  const inboxItems = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.status, 'inbox'))
    .orderBy(schema.resources.addedAt)

  // Get items in review (with assessments)
  const reviewItems = await db
    .select({
      resource: schema.resources,
      assessment: schema.assessments,
    })
    .from(schema.resources)
    .leftJoin(
      schema.assessments,
      eq(schema.resources.id, schema.assessments.resourceId),
    )
    .where(eq(schema.resources.status, 'inReview'))
    .orderBy(schema.assessments.createdAt)

  const allProjects = await db
    .select()
    .from(schema.projects)

  return (
    <div className="space-y-8">
      <h1>Assessment Queue</h1>

      {/* Items pending assessment */}
      {inboxItems.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Waiting for Assessment ({inboxItems.length})</h2>
          <div className="space-y-3">
            {inboxItems.map((item) => (
              <InboxItem
                key={item.id}
                item={item}
                allProjects={allProjects}
                status="pending"
              />
            ))}
          </div>
        </div>
      )}

      {/* Items with assessments (awaiting approval) */}
      {reviewItems.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Ready for Approval ({reviewItems.length})</h2>
          <div className="space-y-4">
            {reviewItems.map(({ resource, assessment }) => (
              assessment ? (
                <InboxItem
                  key={resource.id}
                  item={resource}
                  assessment={assessment}
                  allProjects={allProjects}
                  status="review"
                />
              ) : null
            ))}
          </div>
        </div>
      )}

      {inboxItems.length === 0 && reviewItems.length === 0 && (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No items in queue. Add resources from your projects to assess them.
          </p>
        </div>
      )}
    </div>
  )
}
