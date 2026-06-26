'use server'

import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'

export async function addResourceAction(projectId: number, url: string) {
  if (!url.trim()) {
    throw new Error('URL is required')
  }

  let title = url
  try {
    const urlObj = new URL(url)
    title = urlObj.hostname
  } catch {
    title = url.slice(0, 50)
  }

  let sourceType: 'link' | 'github' = 'link'
  if (url.includes('github.com')) {
    sourceType = 'github'
  }

  await db.insert(schema.resources).values({
    title,
    url: url.trim(),
    sourceType,
    status: 'inbox',
  })
}

export async function archiveResourceAction(resourceId: number) {
  await db
    .update(schema.resources)
    .set({
      status: 'archived',
      archivedAt: new Date(),
    })
    .where(eq(schema.resources.id, resourceId))
}

export async function unarchiveResourceAction(resourceId: number) {
  await db
    .update(schema.resources)
    .set({
      status: 'inbox',
      archivedAt: null,
    })
    .where(eq(schema.resources.id, resourceId))
}

export async function archiveProjectResourcesAction(projectId: number) {
  await db
    .update(schema.resources)
    .set({
      status: 'archived',
      archivedAt: new Date(),
    })
    .where(eq(schema.resources.projectId, projectId))
}
