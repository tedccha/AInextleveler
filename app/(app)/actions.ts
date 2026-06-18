'use server'

import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

export async function createProjectAction(name: string, description: string) {
  if (!name.trim() || !description.trim()) {
    throw new Error('Name and description are required')
  }

  const result = await db
    .insert(schema.projects)
    .values({
      name: name.trim(),
      description: description.trim(),
    })
    .returning({ id: schema.projects.id })

  redirect(`/projects/${result[0].id}`)
}

export async function updateProjectAction(
  projectId: number,
  name: string,
  description: string,
) {
  if (!name.trim() || !description.trim()) {
    throw new Error('Name and description are required')
  }

  await db
    .update(schema.projects)
    .set({
      name: name.trim(),
      description: description.trim(),
    })
    .where(eq(schema.projects.id, projectId))
}

export async function addResourceToAnyProjectAction(
  input: string,
  sourceType?: 'link' | 'github' | 'pastedText',
) {
  if (!input.trim()) {
    throw new Error('Input required')
  }

  // Auto-detect sourceType if not provided
  let detectedSourceType = sourceType
  let title = input
  let url: string | null = null

  if (!detectedSourceType) {
    try {
      const urlObj = new URL(input)
      url = input.trim()
      title = urlObj.hostname
      detectedSourceType = input.includes('github.com') ? 'github' : 'link'
    } catch {
      // Not a valid URL, treat as pasted text
      detectedSourceType = 'pastedText'
      title = input.slice(0, 100)
    }
  } else if (detectedSourceType === 'pastedText') {
    title = input.slice(0, 100)
  } else {
    url = input.trim()
    try {
      const urlObj = new URL(url)
      title = urlObj.hostname
    } catch {
      title = url.slice(0, 50)
    }
  }

  // Check for exact URL duplicates (only for URLs, not pasted text)
  if (url) {
    const existing = await db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.url, url))

    if (existing.length > 0) {
      const dup = existing[0]
      let location = 'in queue'

      if (dup.status === 'active' && dup.projectId) {
        const project = await db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, dup.projectId))
          .limit(1)
        if (project.length > 0) {
          location = `in ${project[0].name}`
        }
      } else if (dup.status === 'archived') {
        location = 'in Archive'
      } else if (dup.status === 'rejected') {
        location = 'in Rejected'
      } else if (dup.status === 'inReview') {
        location = 'pending approval'
      }

      throw new Error(`Duplicate: this item is already ${location}`)
    }
  }

  const result = await db
    .insert(schema.resources)
    .values({
      title,
      url,
      content: detectedSourceType === 'pastedText' ? input.trim() : undefined,
      sourceType: detectedSourceType,
      status: 'inbox',
    })
    .returning({ id: schema.resources.id })

  return { id: result[0].id }
}
