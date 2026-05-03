/**
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  /next — locked information architecture per design review              │
 *   │                                                                        │
 *   │   Active items (status=queued|in_progress) sorted by rank_score DESC.  │
 *   │   Default-EXPANDED with lesson checklist visible.                      │
 *   │                                                                        │
 *   │   Completed items (status=completed) auto-collapse to one-line summary │
 *   │   with [Reopen]. Sorted by completed_at DESC. Older than 7 days        │
 *   │   hidden behind a "Show N completed" toggle.                           │
 *   │                                                                        │
 *   │   Abandoned state: status=in_progress AND started_at < NOW()-7d        │
 *   │   shows ⚠️ + Abandon button at top of card.                            │
 *   │                                                                        │
 *   │   Empty state: F1 fix — link to /capability-map to run a scan first.   │
 *   │                                                                        │
 *   │   [Re-rank] button at top right.                                       │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

import Link from 'next/link'
import { db, schema } from '@/lib/db/client'
import { desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { type Theme } from '@/lib/taxonomy'
import type { LessonStep } from '@/lib/db/schema'
import { QueueCard, type QueueCardData } from './queue-card'
import { RerankButton } from './rerank-button'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

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

export default async function NextPage(props: {
  searchParams: Promise<{ show_old?: string }>
}) {
  const sp = await props.searchParams
  const showOldCompleted = sp.show_old === '1'

  // Empty-state check: F1 fix needs to know if any capabilities exist.
  const capCount = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.capabilities)
  const totalCapabilities = Number(capCount[0]?.n ?? 0)

  // Pull queue items + their resources in two queries (no joins needed
  // for this dataset size; keeps drizzle code simple).
  const queueRows = await db
    .select()
    .from(schema.queueItems)
    .orderBy(desc(schema.queueItems.rankScore))

  if (queueRows.length === 0) {
    return <EmptyState totalCapabilities={totalCapabilities} />
  }

  const resourceIds = queueRows.map((r) => r.resourceId)
  const resourceRows = await db
    .select({
      id: schema.resources.id,
      url: schema.resources.url,
      contentText: schema.resources.contentText,
      verdictReason: schema.resources.verdictReason,
    })
    .from(schema.resources)
    .where(inArray(schema.resources.id, resourceIds))
  const resourceMap = new Map(resourceRows.map((r) => [r.id, r]))

  // Build card data + bucket by status.
  const active: QueueCardData[] = []
  const completed: QueueCardData[] = []
  const now = Date.now()

  for (const q of queueRows) {
    const r = resourceMap.get(q.resourceId)
    if (!r) continue // orphan — resource was deleted; skip
    const isAbandoned =
      q.status === 'in_progress' &&
      q.startedAt !== null &&
      now - q.startedAt.getTime() > SEVEN_DAYS_MS

    const card: QueueCardData = {
      id: q.id,
      resourceId: q.resourceId,
      title: deriveTitle(r.url, r.contentText),
      url: r.url,
      verdictReason: r.verdictReason,
      whyNow: q.whyNow,
      primaryTheme: (q.primaryTheme as Theme | null) ?? null,
      lessonPlan: (q.lessonPlan as LessonStep[]) ?? [],
      status: q.status as 'queued' | 'in_progress' | 'completed',
      startedAt: q.startedAt?.toISOString() ?? null,
      completedAt: q.completedAt?.toISOString() ?? null,
      rankScore: q.rankScore,
      isAbandoned,
    }

    if (q.status === 'completed') completed.push(card)
    else active.push(card)
  }

  // Sort active by rank_score DESC (already ordered from query, but
  // we re-bucket the abandoned ones to top).
  active.sort((a, b) => {
    if (a.isAbandoned !== b.isAbandoned) return a.isAbandoned ? -1 : 1
    return (b.rankScore ?? 0) - (a.rankScore ?? 0)
  })

  // Sort completed by completed_at DESC.
  completed.sort((a, b) => {
    const aT = a.completedAt ? new Date(a.completedAt).getTime() : 0
    const bT = b.completedAt ? new Date(b.completedAt).getTime() : 0
    return bT - aT
  })

  // Hide completed older than 7 days unless toggle is on.
  const recentCompleted = showOldCompleted
    ? completed
    : completed.filter((c) => {
        if (!c.completedAt) return true
        return now - new Date(c.completedAt).getTime() <= SEVEN_DAYS_MS
      })
  const hiddenOldCount = completed.length - recentCompleted.length

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1>Next</h1>
          <p className="mt-1 font-mono text-sm text-[hsl(var(--muted-foreground))]">
            {active.length} active · {completed.length} completed
          </p>
        </div>
        <RerankButton activeCount={active.length} />
      </header>

      {active.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Nothing active. Promote items from{' '}
          <Link href="/inbox" className="underline">
            /inbox
          </Link>
          .
        </p>
      ) : (
        <section className="space-y-3">
          {active.map((card) => (
            <QueueCard key={card.id} data={card} />
          ))}
        </section>
      )}

      {recentCompleted.length > 0 ? (
        <section className="space-y-2 pt-4 border-t border-[hsl(var(--border))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">
            Completed
          </h2>
          {recentCompleted.map((card) => (
            <QueueCard key={card.id} data={card} />
          ))}
        </section>
      ) : null}

      {hiddenOldCount > 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          <Link href="/next?show_old=1" className="underline">
            Show {hiddenOldCount} older completed
          </Link>
        </p>
      ) : null}
    </div>
  )
}

function EmptyState({ totalCapabilities }: { totalCapabilities: number }) {
  return (
    <div className="space-y-6">
      <header>
        <h1>Next</h1>
      </header>
      <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-3">
        <h2 className="text-lg font-semibold">No items in your queue</h2>
        {totalCapabilities === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Run a capability scan first to discover what to learn. Without it,
            the ranking can&apos;t target your gaps.{' '}
            <Link
              href="/capability-map"
              className="font-medium underline-offset-2 hover:underline text-[hsl(var(--foreground))]"
            >
              → /capability-map
            </Link>
          </p>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Paste content on{' '}
            <Link
              href="/inbox"
              className="font-medium underline-offset-2 hover:underline text-[hsl(var(--foreground))]"
            >
              /inbox
            </Link>{' '}
            and click <strong>Add to queue</strong> on items you want to work
            through.
          </p>
        )}
      </div>
    </div>
  )
}
