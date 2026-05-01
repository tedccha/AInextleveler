'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  BackfillBanner — only renders when pendingEmbeds > 0.            │
 *   │  Click [Backfill] → POST /api/embed-backfill, stream SSE events. │
 *   │  On completion, router.refresh() to drop the banner.             │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Phase = 'idle' | 'running' | 'done' | 'error'

export function BackfillBanner({ pending }: { pending: number }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const router = useRouter()

  async function start() {
    setPhase('running')
    setStatus('Starting backfill…')
    setError('')

    try {
      const res = await fetch('/api/embed-backfill', { method: 'POST' })
      if (!res.ok || !res.body) {
        setError(`request failed: ${res.status}`)
        setPhase('error')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          let event = ''
          let dataLine = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
          }
          if (!dataLine) continue
          let data: { type?: string; [k: string]: unknown }
          try {
            data = JSON.parse(dataLine) as { type?: string; [k: string]: unknown }
          } catch {
            continue
          }
          handle(event || (data.type ?? ''), data, setStatus, setError)
          if ((event || data.type) === 'completed') setPhase('done')
        }
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
      setPhase('error')
    }
  }

  return (
    <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span>
          {pending}{' '}
          {pending === 1 ? 'capability has' : 'capabilities have'} no embedding
          (Voyage was unavailable). pgvector similarity skips these rows until
          they're filled.
        </span>
        <button
          type="button"
          onClick={start}
          disabled={phase === 'running'}
          className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1 text-xs font-medium hover:bg-[hsl(var(--card))] disabled:opacity-50"
        >
          {phase === 'running' ? 'Backfilling…' : 'Backfill'}
        </button>
      </div>
      {phase === 'running' && status ? (
        <p className="mt-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {status}
        </p>
      ) : null}
      {phase === 'error' && error ? (
        <p className="mt-2 text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </div>
  )
}

function handle(
  event: string,
  data: { type?: string; [k: string]: unknown },
  setStatus: (s: string) => void,
  setError: (s: string) => void,
) {
  switch (event) {
    case 'started':
      setStatus(
        `${data.capabilities_pending} capabilities + ${data.resources_pending} resources to backfill`,
      )
      return
    case 'embedding':
      setStatus(
        `${data.table}: ${data.index}/${data.total} — ${data.label as string}`,
      )
      return
    case 'embed_failed':
      setStatus(`failed: ${data.label as string}`)
      return
    case 'completed':
      setStatus(
        `done. capabilities ${data.capabilities_done} ok / ${data.capabilities_failed} failed · resources ${data.resources_done} ok / ${data.resources_failed} failed`,
      )
      return
    case 'error':
      setError((data.message as string) ?? 'unknown error')
      return
  }
}
