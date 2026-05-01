'use client'

/**
 * Library — filterable + sortable list of all classified items
 * (excluding needs_review which lives in its own section).
 *
 * Filter and sort use ?verdict and ?sort URL params so server-side
 * fetch can paginate cleanly. Client component just builds the
 * navigation links.
 */

import Link from 'next/link'
import type { LessonStep } from '@/lib/db/schema'
import { LibraryCard } from './library-card'

export type LibraryItem = {
  id: number
  url: string | null
  title: string
  verdict: 'keep' | 'skip' | 'already_have' | 'not_yet'
  verdict_reason: string
  added_at: string
  lesson_plan: LessonStep[]
  in_queue: boolean
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'keep', label: 'Keep' },
  { key: 'not_yet', label: 'Not yet' },
  { key: 'already_have', label: 'Already have' },
  { key: 'skip', label: 'Skip' },
] as const

const SORTS = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
] as const

export function Library({
  items,
  filtered,
  verdictFilter,
  sort,
}: {
  items: LibraryItem[]
  filtered: number[] // ids that pass the current filter (server-computed)
  verdictFilter: string
  sort: string
}) {
  const visible = items.filter((i) => filtered.includes(i.id))

  const counts: Record<string, number> = { all: items.length }
  for (const i of items) counts[i.verdict] = (counts[i.verdict] ?? 0) + 1

  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-xl font-semibold">Library</h2>
        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          ({items.length})
        </span>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Nothing classified yet. Paste your first item above.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => {
                const active = verdictFilter === f.key
                return (
                  <Link
                    key={f.key}
                    href={`/inbox?${new URLSearchParams({ verdict: f.key, sort }).toString()}`}
                    className={
                      'rounded-card border px-2 py-0.5 font-mono text-xs ' +
                      (active
                        ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]')
                    }
                  >
                    {f.label}
                    {counts[f.key] !== undefined ? (
                      <span className="ml-1 opacity-70">{counts[f.key]}</span>
                    ) : null}
                  </Link>
                )
              })}
            </div>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              ·
            </span>
            <div className="flex gap-1">
              {SORTS.map((s) => {
                const active = sort === s.key
                return (
                  <Link
                    key={s.key}
                    href={`/inbox?${new URLSearchParams({
                      verdict: verdictFilter,
                      sort: s.key,
                    }).toString()}`}
                    className={
                      'rounded-card border px-2 py-0.5 font-mono text-xs ' +
                      (active
                        ? 'border-[hsl(var(--foreground))] bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]')
                    }
                  >
                    {s.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No items match this filter.
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((i) => (
                <LibraryCard key={i.id} item={i} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
