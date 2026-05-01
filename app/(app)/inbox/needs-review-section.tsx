'use client'

/**
 * Needs Review section — surfaces verdict='needs_review' items so the
 * user can resolve them quickly. Each item shows the AI's review_prompt
 * + Keep / Skip / Add Context buttons.
 *
 *  - Keep / Skip → POST /api/resources/needs-review (no Haiku call)
 *  - Add Context → POST /api/resources/reconsider (re-classify with note)
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export type NeedsReviewItem = {
  id: number
  url: string | null
  title: string
  review_prompt: string | null
  verdict_reason: string | null
}

export function NeedsReviewSection({ items }: { items: NeedsReviewItem[] }) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-xl font-semibold">Needs Review</h2>
        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          ({items.length})
        </span>
      </header>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        These need your judgment. Keep, skip, or add context to re-classify.
      </p>
      <div className="space-y-3">
        {items.map((item) => (
          <NeedsReviewCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

function NeedsReviewCard({ item }: { item: NeedsReviewItem }) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const router = useRouter()

  async function resolve(action: 'keep' | 'skip') {
    setError('')
    startTransition(async () => {
      const res = await fetch('/api/resources/needs-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource_id: item.id, action }),
      })
      if (!res.ok) {
        setError("Couldn't save. Retry.")
        return
      }
      router.refresh()
    })
  }

  async function reconsider() {
    if (!note.trim()) {
      setError('Add some context first.')
      return
    }
    setError('')
    try {
      const res = await fetch('/api/resources/reconsider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resource_id: item.id, note }),
      })
      if (!res.ok || !res.body) {
        setError(`request failed: ${res.status}`)
        return
      }
      // Drain the SSE stream — UI just waits for completion.
      const reader = res.body.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    }
  }

  return (
    <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold truncate">{item.title}</h3>
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
        </div>
      </div>
      {item.review_prompt ? (
        <p className="rounded bg-[hsl(var(--muted))] p-2 text-sm italic">
          {item.review_prompt}
        </p>
      ) : item.verdict_reason ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {item.verdict_reason}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => resolve('keep')}
          disabled={pending}
          className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={() => resolve('skip')}
          disabled={pending}
          className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => setShowNote((s) => !s)}
          className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1 text-xs font-medium hover:bg-[hsl(var(--muted))]"
        >
          {showNote ? 'Cancel' : 'Add context'}
        </button>
      </div>
      {showNote ? (
        <div className="space-y-2 pt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What does this content cover that wasn't obvious from the page?"
            rows={3}
            className="block w-full resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm outline-none"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={reconsider}
              disabled={!note.trim()}
              className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
            >
              Re-classify with this note
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </div>
  )
}
