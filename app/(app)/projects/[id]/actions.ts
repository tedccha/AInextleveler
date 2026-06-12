'use server'

import { db, schema } from '@/lib/db/client'

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
