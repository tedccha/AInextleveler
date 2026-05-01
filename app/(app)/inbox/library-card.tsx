'use client'

/**
 * One library card. Compact by default, expand for lesson_plan
 * (not_yet items) and force-reconsider.
 *
 * keep + not_yet items show "Add to queue" button (unless already queued).
 * Force-reconsider opens a textarea + submit that re-runs classify.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { LibraryItem } from './library'
import type { LessonStep } from '@/lib/db/schema'

const VERDICT_LABEL: Record<LibraryItem['verdict'], string> = {
  keep: 'Keep',
  skip: 'Skip',
  already_have: 'Already have',
  not_yet: 'Not yet',
}
const VERDICT_PILL: Record<LibraryItem['verdict'], string> = {
  keep: 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]',
  skip: 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]',
  already_have:
    'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]',
  not_yet: 'border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
}

export function LibraryCard({ item }: { item: LibraryItem }) {
  const [showLesson, setShowLesson] = useState(item.verdict === 'not_yet')
  const [showReconsider, setShowReconsider] = useState(false)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const canPromote =
    (item.verdict === 'keep' || item.verdict === 'not_yet') && !item.in_queue

  async function reconsider() {
    if (!note.trim()) {
      setError('Add some context first.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/resources/reconsider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource_id: item.id, note }),
      })
      if (!res.ok || !res.body) {
        setError(`request failed: ${res.status}`)
        setBusy(false)
        return
      }
      const reader = res.body.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
      setShowReconsider(false)
      setNote('')
      setBusy(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
      setBusy(false)
    }
  }

  async function promote() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/queue/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource_id: item.id }),
      })
      if (!res.ok || !res.body) {
        setError(`request failed: ${res.status}`)
        setBusy(false)
        return
      }
      // Drain SSE — UI just waits.
      const reader = res.body.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
      startTransition(() => {
        router.refresh()
      })
      setBusy(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
      setBusy(false)
    }
  }

  return (
    <article className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={
                'rounded-card border px-1.5 py-0.5 font-mono text-xs ' +
                VERDICT_PILL[item.verdict]
              }
            >
              {VERDICT_LABEL[item.verdict]}
            </span>
            {item.in_queue ? (
              <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
                in queue
              </span>
            ) : null}
          </div>
          <h3 className="text-sm font-semibold truncate">{item.title}</h3>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
            >
              {item.url.length > 80 ? item.url.slice(0, 77) + '…' : item.url}
            </a>
          ) : null}
          {item.verdict_reason ? (
            <p className="mt-1 text-sm">{item.verdict_reason}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {canPromote ? (
            <button
              type="button"
              onClick={promote}
              disabled={busy || pending}
              className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add to queue'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowReconsider((s) => !s)}
            className="font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {showReconsider ? 'cancel' : 'force reconsider'}
          </button>
        </div>
      </div>

      {/* Lesson plan inline for not_yet items (read-only checklist) */}
      {item.lesson_plan && item.lesson_plan.length > 0 && showLesson ? (
        <div className="rounded bg-[hsl(var(--muted))] p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {item.verdict === 'not_yet'
                ? `${item.lesson_plan.length} lessons to unlock this`
                : `${item.lesson_plan.length} step lesson plan`}
            </span>
            {item.verdict === 'not_yet' ? (
              <button
                type="button"
                onClick={() => setShowLesson(false)}
                className="font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                hide
              </button>
            ) : null}
          </div>
          <ol className="space-y-1 pl-4 text-xs">
            {item.lesson_plan.map((s: LessonStep) => (
              <li key={s.order} className="flex items-start gap-1.5">
                <span className="font-mono text-[hsl(var(--muted-foreground))]">
                  {s.order}.
                </span>
                <span>
                  <span className="font-medium">{s.title}</span>
                  <span className="ml-2 font-mono text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                    [{s.estimatedEffort}]
                  </span>
                  <span className="ml-1 font-mono text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                    {s.type}
                  </span>
                  {s.capability ? (
                    <span className="ml-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      → {s.capability.name}
                    </span>
                  ) : null}
                  {s.description ? (
                    <span className="block text-[hsl(var(--muted-foreground))]">
                      {s.description}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Force reconsider input */}
      {showReconsider ? (
        <div className="space-y-2 pt-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context, then re-classify…"
            rows={3}
            className="block w-full resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={reconsider}
              disabled={busy || !note.trim()}
              className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
            >
              {busy ? 'Re-classifying…' : 'Re-classify'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </article>
  )
}
