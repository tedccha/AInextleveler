/**
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  /inbox — three zones (locked information architecture)                │
 *   │                                                                        │
 *   │   1. Paste box (hero, full-width textarea + Submit)                    │
 *   │   2. Needs Review (only when count>0) — review_prompt + keep/skip      │
 *   │   3. Library — all classified items, filterable + sortable             │
 *   │                                                                        │
 *   │  Queue does NOT appear here. /next is the queue's home.                │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

import { db, schema } from '@/lib/db/client'
import { desc, eq } from 'drizzle-orm'
import { PasteBox } from './paste-box'
import { NeedsReviewSection } from './needs-review-section'
import { Library } from './library'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SearchParams = { verdict?: string; sort?: string }

export default async function InboxPage(props: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await props.searchParams
  const verdictFilter = sp.verdict
  const sort = sp.sort ?? 'newest'

  // Load resources. Needs-review goes in its own section; everything else
  // lives in Library.
  const allResources = await db
    .select()
    .from(schema.resources)
    .orderBy(
      sort === 'oldest'
        ? schema.resources.addedAt
        : desc(schema.resources.addedAt),
    )

  // Identify queue membership so library cards can hide the Add-to-queue
  // button when the resource is already queued.
  const queueResourceIds = new Set(
    (
      await db
        .select({ resourceId: schema.queueItems.resourceId })
        .from(schema.queueItems)
    ).map((r) => r.resourceId),
  )

  const needsReview = allResources.filter((r) => r.verdict === 'needs_review')
  const libraryAll = allResources.filter((r) => r.verdict !== 'needs_review')
  const library =
    verdictFilter && verdictFilter !== 'all'
      ? libraryAll.filter((r) => r.verdict === verdictFilter)
      : libraryAll

  return (
    <div className="space-y-8">
      <header>
        <h1>Inbox</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Paste a URL or content. AI evaluates against your capability map.
        </p>
      </header>

      <PasteBox />

      {needsReview.length > 0 ? (
        <NeedsReviewSection
          items={needsReview.map((r) => ({
            id: r.id,
            url: r.url,
            title: deriveTitle(r.url, r.contentText),
            review_prompt: r.reviewPrompt,
            verdict_reason: r.verdictReason,
          }))}
        />
      ) : null}

      <Library
        items={libraryAll.map((r) => ({
          id: r.id,
          url: r.url,
          title: deriveTitle(r.url, r.contentText),
          verdict: r.verdict as
            | 'keep'
            | 'skip'
            | 'already_have'
            | 'not_yet',
          verdict_reason: r.verdictReason ?? '',
          added_at: r.addedAt.toISOString(),
          lesson_plan: r.lessonPlan,
          in_queue: queueResourceIds.has(r.id),
        }))}
        filtered={library.map((r) => r.id)}
        verdictFilter={verdictFilter ?? 'all'}
        sort={sort}
      />
    </div>
  )
}

function deriveTitle(url: string | null, contentText: string): string {
  if (url) {
    try {
      const u = new URL(url)
      return `${u.hostname}${u.pathname}`.replace(/\/$/, '').slice(0, 100)
    } catch {
      return url.slice(0, 100)
    }
  }
  return contentText.split('\n')[0]?.slice(0, 100) || 'Untitled'
}
