import Link from 'next/link'
import { db, schema } from '@/lib/db/client'
import { isNull } from 'drizzle-orm'
import { NewProjectButton } from './new-project-button'
import { QuickAddResource } from './quick-add-resource'
import { EditProjectButton } from './edit-project-button'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const projects = await db
    .select()
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(schema.projects.createdAt)

  return (
    <div className="space-y-8">
      {/* Quick Add Resource - TOP PRIORITY */}
      <QuickAddResource />

      {/* Projects Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1>Projects</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Organize your AI infrastructure upleveling
          </p>
        </div>
        <NewProjectButton />
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-6 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No projects yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group rounded-card border border-[hsl(var(--border))] p-6 transition-all hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--muted))]"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-semibold">
                  <Link
                    href={`/projects/${project.id}`}
                    className="group-hover:text-[hsl(var(--accent))]"
                  >
                    {project.name}
                  </Link>
                </h2>
                <EditProjectButton project={project} />
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {project.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
