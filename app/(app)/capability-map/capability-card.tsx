'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  CapabilityCard — one card per lifecycle theme. Each sub-cap row │
 *   │  is click-to-edit: opens a 4-button row picker (Have/Partial/    │
 *   │  Missing/Clear). Override request goes to /api/capabilities/      │
 *   │  override; on success router.refresh() pulls fresh data.         │
 *   │                                                                  │
 *   │   ┌─ row idle (status icon + name)                               │
 *   │   │       │ click                                                │
 *   │   │       ▼                                                      │
 *   │   ├─ row editing (4 buttons + cancel)                            │
 *   │   │       │ pick                                                 │
 *   │   │       ▼                                                      │
 *   │   └─ row saving (spinner) ──▶ refresh ──▶ row idle              │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Theme } from '@/lib/taxonomy'

export type RowState = {
  name: string
  status: 'have' | 'partial' | 'missing'
  manualOverride: boolean
}

type Props = {
  theme: Theme
  index: number
  isBiggestGap: boolean
  rows: RowState[]
}

const GLYPH = { have: '✓', partial: '◐', missing: '✗' } as const
const GLYPH_COLOR = {
  have: 'text-[hsl(var(--accent))]',
  partial: 'text-[hsl(var(--muted-foreground))]',
  missing: 'text-[hsl(var(--muted-foreground))] opacity-60',
} as const

export function CapabilityCard({ theme, index, isBiggestGap, rows }: Props) {
  const have = rows.filter((r) => r.status === 'have').length
  const partial = rows.filter((r) => r.status === 'partial').length
  const total = rows.length
  const filled = have + partial * 0.5
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0

  return (
    <section
      className={
        'rounded-card bg-[hsl(var(--card))] p-4 border border-[hsl(var(--border))] ' +
        (isBiggestGap ? 'outline outline-1 outline-[hsl(var(--border))]' : '')
      }
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span
          className={
            'font-mono text-sm text-[hsl(var(--muted-foreground))] ' +
            (isBiggestGap
              ? 'text-2xl font-bold text-[hsl(var(--foreground))]'
              : '')
          }
        >
          {index + 1}
        </span>
        <h3 className="text-base font-semibold">{theme}</h3>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
          <div
            className="h-full bg-[hsl(var(--accent))]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {have}/{total}
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <CapabilityRow key={row.name} theme={theme} row={row} />
        ))}
      </ul>
    </section>
  )
}

function CapabilityRow({ theme, row }: { theme: Theme; row: RowState }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function setStatus(next: 'have' | 'partial' | 'missing' | null) {
    startTransition(async () => {
      setError(null)
      try {
        const res = await fetch('/api/capabilities/override', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ theme, name: row.name, status: next }),
        })
        if (!res.ok) {
          setError("Couldn't save. Retry.")
          return
        }
        setEditing(false)
        router.refresh()
      } catch {
        setError("Couldn't save. Retry.")
      }
    })
  }

  if (!editing) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-[hsl(var(--muted))]"
        >
          <span
            className={
              'font-mono text-base leading-tight ' + GLYPH_COLOR[row.status]
            }
          >
            {GLYPH[row.status]}
          </span>
          <span
            className={
              row.status === 'have'
                ? 'font-medium text-[hsl(var(--foreground))]'
                : 'text-[hsl(var(--muted-foreground))]'
            }
          >
            {row.name}
            {row.manualOverride ? (
              <span className="ml-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                (manual)
              </span>
            ) : null}
          </span>
        </button>
        {error ? (
          <p className="mt-0.5 pl-6 text-xs text-[hsl(var(--destructive))]">
            {error}
          </p>
        ) : null}
      </li>
    )
  }

  return (
    <li className="rounded bg-[hsl(var(--muted))] px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{row.name}</div>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          cancel
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PickerButton
          label="✓ Have"
          onClick={() => setStatus('have')}
          active={row.status === 'have'}
          disabled={pending}
        />
        <PickerButton
          label="◐ Partial"
          onClick={() => setStatus('partial')}
          active={row.status === 'partial'}
          disabled={pending}
        />
        <PickerButton
          label="✗ Missing"
          onClick={() => setStatus('missing')}
          active={row.status === 'missing'}
          disabled={pending}
        />
        {row.manualOverride ? (
          <PickerButton
            label="Clear override"
            onClick={() => setStatus(null)}
            disabled={pending}
            muted
          />
        ) : null}
      </div>
    </li>
  )
}

function PickerButton({
  label,
  onClick,
  active = false,
  disabled,
  muted = false,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'rounded-card border px-2 py-1 font-mono text-xs disabled:opacity-50 ' +
        (active
          ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
          : muted
            ? 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))]'
            : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--background))]')
      }
    >
      {label}
    </button>
  )
}
