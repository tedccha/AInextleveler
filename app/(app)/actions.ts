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

export async function addResourceToAnyProjectAction(url: string) {
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

  const result = await db
    .insert(schema.resources)
    .values({
      title,
      url: url.trim(),
      sourceType,
      status: 'inbox',
    })
    .returning({ id: schema.resources.id })

  redirect(`/inbox`)
}
