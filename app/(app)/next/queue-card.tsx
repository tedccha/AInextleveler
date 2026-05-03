'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  QueueCard — one row in /next.                                    │
 *   │                                                                  │
 *   │  Active state (queued | in_progress, default-EXPANDED):          │
 *   │    [theme] · title · why_now · source                            │
 *   │    [Start] [Done]   (Start hides once status=in_progress)        │
 *   │    Lesson plan checklist (each step toggleable)                   │
 *   │                                                                  │
 *   │  Abandoned (in_progress AND started_at < NOW()-7d):              │
 *   │    Shows ⚠️ + [Abandon?] confirmation dialog at top              │
 *   │                                                                  │
 *   │  Completed (auto-collapsed):                                      │
 *   │    ✓ [theme] title · 3/3 lessons · 2h ago [Reopen]               │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Optimistic UI: step toggles update local state immediately; server
 * call is fire-and-forget with error rollback. Other actions
 * (Start/Done/Reopen/Abandon) wait for server then router.refresh().
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Theme } from '@/lib/taxonomy'
import type { LessonStep } from '@/lib/db/schema'

export type QueueCardData = {
  id: number
  resourceId: number
  title: string
  url: string | null
  verdictReason: string | null
  whyNow: string | null
  primaryTheme: Theme | null
  lessonPlan: LessonStep[]
  status: 'queued' | 'in_progress' | 'completed'
  startedAt: string | null
  completedAt: string | null
  rankScore: number
  isAbandoned: boolean
}

export function QueueCard({ data }: { data: QueueCardData }) {
  // Optimistic local state for step toggles.
  const [steps, setSteps] = useState<LessonStep[]>(data.lessonPlan)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const router = useRouter()

  const allDone = steps.length > 0 && steps.every((s) => s.done)
  const checkedCount = steps.filter((s) => s.done).length

  // Completed → render collapsed summary
  if (data.status === 'completed') {
    return (
      <article className="flex items-center gap-3 rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm">
        <span className="text-[hsl(var(--accent))]">✓</span>
        <ThemeBadge theme={data.primaryTheme} />
        <span className="flex-1 truncate font-medium">{data.title}</span>
        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {checkedCount}/{steps.length} lessons · {relativeTime(data.completedAt)}
        </span>
        <CardAction
          label="Reopen"
          onClick={() => callPatch(data.id, 'reopen')}
          disabled={pending}
          variant="ghost"
        />
      </article>
    )
  }

  async function callPatch(id: number, action: 'start' | 'done' | 'reopen' | 'abandon') {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/queue/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? `request failed: ${res.status}`)
          return
        }
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'unknown error')
      }
    })
  }

  async function toggleStep(order: number, nextDone: boolean) {
    // Optimistic update.
    const prev = steps
    setSteps((s) => s.map((st) => (st.order === order ? { ...st, done: nextDone } : st)))
    setError(null)

    try {
      const res = await fetch(`/api/queue/${data.id}/step`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order, done: nextDone }),
      })
      if (!res.ok) {
        setSteps(prev) // rollback
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `couldn't save: ${res.status}`)
        return
      }
      // The server may have flipped status (auto-Start, auto-Done) — refresh.
      router.refresh()
    } catch (e) {
      setSteps(prev) // rollback
      setError(e instanceof Error ? e.message : "couldn't save")
    }
  }

  return (
    <article
      className={
        'rounded-card border bg-[hsl(var(--card))] p-4 space-y-3 ' +
        (data.isAbandoned
          ? 'border-[hsl(var(--destructive))]'
          : 'border-[hsl(var(--border))]')
      }
    >
      {data.isAbandoned ? (
        <div className="flex items-center justify-between rounded bg-[hsl(var(--muted))] px-3 py-2 text-sm">
          <span>
            ⚠️ Started over 7 days ago — abandon and put back in queue?
          </span>
          {confirmAbandon ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => callPatch(data.id, 'abandon')}
                disabled={pending}
                className="rounded-card bg-[hsl(var(--destructive))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--destructive-foreground))] disabled:opacity-50"
              >
                Yes, abandon
              </button>
              <button
                type="button"
                onClick={() => setConfirmAbandon(false)}
                className="rounded-card border border-[hsl(var(--border))] px-2 py-0.5 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAbandon(true)}
              className="rounded-card border border-[hsl(var(--border))] px-2 py-0.5 text-xs font-medium hover:bg-[hsl(var(--background))]"
            >
              Abandon?
            </button>
          )}
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <ThemeBadge theme={data.primaryTheme} />
            {data.status === 'in_progress' ? (
              <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
                in progress
              </span>
            ) : null}
          </div>
          <h3 className="text-base font-semibold leading-tight">{data.title}</h3>
          {data.whyNow ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {data.whyNow}
            </p>
          ) : null}
          {data.url ? (
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
            >
              {data.url.length > 80 ? data.url.slice(0, 77) + '…' : data.url}
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {data.status === 'queued' ? (
            <CardAction
              label={pending ? 'Starting…' : 'Start'}
              onClick={() => callPatch(data.id, 'start')}
              disabled={pending}
              variant="primary"
            />
          ) : null}
          <CardAction
            label={pending ? 'Saving…' : 'Done'}
            onClick={() => callPatch(data.id, 'done')}
            disabled={pending || allDone}
            variant={allDone ? 'ghost' : 'primary'}
          />
        </div>
      </header>

      {steps.length > 0 ? (
        <div className="space-y-1">
          <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
            Lesson plan ({checkedCount}/{steps.length})
          </p>
          <ol className="space-y-1.5">
            {steps.map((step) => (
              <li
                key={step.order}
                className="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={(e) => toggleStep(step.order, e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--accent))]"
                />
                <span className="flex-1">
                  <span
                    className={
                      'font-medium ' +
                      (step.done
                        ? 'line-through text-[hsl(var(--muted-foreground))]'
                        : '')
                    }
                  >
                    {step.order}. {step.title}
                  </span>{' '}
                  <span className="font-mono text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
                    [{step.estimatedEffort}] {step.type}
                  </span>
                  {step.capability ? (
                    <span className="ml-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      → {step.capability.name}
                    </span>
                  ) : null}
                  {step.description ? (
                    <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                      {step.description}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          No lesson plan generated.{' '}
          <button
            type="button"
            onClick={() => router.push(`/inbox`)}
            className="underline"
          >
            Promote again to retry
          </button>
        </p>
      )}

      {error ? (
        <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </article>
  )
}

function ThemeBadge({ theme }: { theme: Theme | null }) {
  if (!theme) return null
  return (
    <span className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
      {theme}
    </span>
  )
}

function CardAction({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant: 'primary' | 'ghost'
}) {
  const base =
    'rounded-card px-3 py-1 text-xs font-medium disabled:opacity-50'
  const styles =
    variant === 'primary'
      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
      : 'border border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles}`}
    >
      {label}
    </button>
  )
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  return `${wk}w ago`
}
