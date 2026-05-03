'use client'

/**
 * Rerank button — POSTs to /api/rerank, shows a 1s-minimum-visible
 * status under the button, then router.refresh() to pull fresh order.
 *
 * Disabled when there's nothing to rerank (active queue empty).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function RerankButton({ activeCount }: { activeCount: number }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')
  const [, startTransition] = useTransition()
  const router = useRouter()

  async function rerank() {
    setPhase('running')
    setMessage('Re-ranking…')
    const startedAt = Date.now()
    try {
      const res = await fetch('/api/rerank', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        updated?: number
        unchanged?: number
        error?: string
      }
      if (!res.ok || !body.ok) {
        setPhase('error')
        setMessage(body.error ?? `request failed: ${res.status}`)
        return
      }
      // Enforce 1s minimum so the toast is readable per locked design.
      const elapsed = Date.now() - startedAt
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed))
      }
      const updated = body.updated ?? 0
      setPhase('done')
      setMessage(
        updated === 0
          ? 'Already up to date.'
          : `Updated. ${updated} card${updated === 1 ? '' : 's'} moved.`,
      )
      startTransition(() => {
        router.refresh()
      })
      // Auto-clear the message after 3s.
      setTimeout(() => {
        setPhase('idle')
        setMessage('')
      }, 3000)
    } catch (e) {
      setPhase('error')
      setMessage(e instanceof Error ? e.message : 'unknown error')
    }
  }

  const disabled = phase === 'running' || activeCount === 0

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={rerank}
        disabled={disabled}
        className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        {phase === 'running' ? 'Re-ranking…' : 'Re-rank'}
      </button>
      {message ? (
        <p
          className={
            'font-mono text-xs ' +
            (phase === 'error'
              ? 'text-[hsl(var(--destructive))]'
              : 'text-[hsl(var(--muted-foreground))]')
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
