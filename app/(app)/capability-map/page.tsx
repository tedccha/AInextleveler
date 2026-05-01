/**
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  /capability-map — locked information architecture per design review   │
 *   │                                                                        │
 *   │  - Top stat band: N/26 capabilities · Have/Partial/Missing breakdown   │
 *   │    + Refresh button + last-scanned timestamp + (if pending>0)          │
 *   │    embed-backfill banner (TODO Step 7)                                 │
 *   │                                                                        │
 *   │  - 3-column 6-card grid, lifecycle order. Each card has:               │
 *   │      number + theme name                                               │
 *   │      progress bar  N/M                                                 │
 *   │      sub-cap list visible inline (no expand)                           │
 *   │  - Biggest-gap card: 2x bolder theme number + thin neutral outline     │
 *   │    (NO colored border per anti-slop ban)                               │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

import { LIFECYCLE_THEMES, CAPABILITIES_BY_THEME, type Theme } from '@/lib/taxonomy'
import { readCapabilityMap } from '@/lib/scan/github'
import { ScanButton } from './scan-button'

export const runtime = 'nodejs'
// Always render fresh — DB-backed, no stale ISR.
export const dynamic = 'force-dynamic'

type StatusMap = Awaited<ReturnType<typeof readCapabilityMap>>['byTheme'][Theme]

function statusFor(
  list: StatusMap | undefined,
  name: string,
): 'have' | 'partial' | 'missing' {
  if (!list) return 'missing'
  const row = list.find((r) => r.name === name)
  return (row?.status ?? 'missing') as 'have' | 'partial' | 'missing'
}

function manualOverrideFor(
  list: StatusMap | undefined,
  name: string,
): boolean {
  if (!list) return false
  return list.find((r) => r.name === name)?.manualOverride ?? false
}

function statusGlyph(s: 'have' | 'partial' | 'missing'): string {
  if (s === 'have') return '✓'
  if (s === 'partial') return '◐'
  return '✗'
}

function statusColor(s: 'have' | 'partial' | 'missing'): string {
  if (s === 'have') return 'text-[hsl(var(--accent))]'
  if (s === 'partial') return 'text-[hsl(var(--muted-foreground))]'
  return 'text-[hsl(var(--muted-foreground))] opacity-60'
}

function findBiggestGap(
  byTheme: Awaited<ReturnType<typeof readCapabilityMap>>['byTheme'],
): Theme | null {
  let best: Theme | null = null
  let bestMissing = -1
  for (const theme of LIFECYCLE_THEMES) {
    const subs = CAPABILITIES_BY_THEME[theme]
    const list = byTheme[theme]
    let missing = 0
    for (const name of subs) {
      if (statusFor(list, name) === 'missing') missing++
    }
    // Tie → first-by-lifecycle-order (LIFECYCLE_THEMES iteration order).
    if (missing > bestMissing) {
      bestMissing = missing
      best = theme
    }
  }
  return bestMissing > 0 ? best : null
}

function lastScannedLabel(byTheme: Awaited<ReturnType<typeof readCapabilityMap>>['byTheme']): string {
  let latest: Date | null = null
  for (const theme of LIFECYCLE_THEMES) {
    for (const r of byTheme[theme] ?? []) {
      if (r.lastVerifiedAt && (!latest || r.lastVerifiedAt > latest)) {
        latest = r.lastVerifiedAt
      }
    }
  }
  if (!latest) return 'Never scanned'
  const ageMs = Date.now() - latest.getTime()
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Last scanned: today'
  if (days === 1) return 'Last scanned: yesterday'
  return `Last scanned: ${days} days ago`
}

export default async function CapabilityMapPage() {
  const { byTheme, totals, pendingEmbeds } = await readCapabilityMap()
  const biggestGap = findBiggestGap(byTheme)
  const totalSubcaps = LIFECYCLE_THEMES.reduce(
    (n, t) => n + CAPABILITIES_BY_THEME[t].length,
    0,
  ) // 26
  const haveCount = totals.have
  const haveBarPct = totals.total > 0 ? Math.round((haveCount / totalSubcaps) * 100) : 0

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1>Capability Map</h1>
          <p className="mt-1 font-mono text-sm text-[hsl(var(--muted-foreground))]">
            {haveCount}/{totalSubcaps} capabilities · Have: {totals.have} · Partial:{' '}
            {totals.partial} · Missing: {totals.missing} ·{' '}
            {lastScannedLabel(byTheme)}
          </p>
        </div>
        <ScanButton />
      </header>

      {pendingEmbeds > 0 ? (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-3 text-sm">
          {pendingEmbeds} {pendingEmbeds === 1 ? 'capability has' : 'capabilities have'} no embedding (Voyage was unavailable). Backfill button lands in Step 7.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {LIFECYCLE_THEMES.map((theme, i) => {
          const subs = CAPABILITIES_BY_THEME[theme]
          const list = byTheme[theme]
          const have = subs.filter((n) => statusFor(list, n) === 'have').length
          const partial = subs.filter((n) => statusFor(list, n) === 'partial').length
          const isGap = biggestGap === theme
          const filled = have + partial * 0.5
          const pct = Math.round((filled / subs.length) * 100)

          return (
            <section
              key={theme}
              className={
                'rounded-card bg-[hsl(var(--card))] p-4 ' +
                (isGap
                  ? 'border border-[hsl(var(--border))] outline outline-1 outline-[hsl(var(--border))]'
                  : 'border border-[hsl(var(--border))]')
              }
            >
              <div className="mb-1 flex items-baseline gap-2">
                <span
                  className={
                    'font-mono text-sm text-[hsl(var(--muted-foreground))] ' +
                    (isGap
                      ? 'text-2xl font-bold text-[hsl(var(--foreground))]'
                      : '')
                  }
                >
                  {i + 1}
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
                  {have}/{subs.length}
                </span>
              </div>
              <ul className="space-y-1.5 text-sm">
                {subs.map((name) => {
                  const s = statusFor(list, name)
                  const overridden = manualOverrideFor(list, name)
                  return (
                    <li key={name} className="flex items-start gap-2">
                      <span
                        className={
                          'font-mono text-base leading-tight ' + statusColor(s)
                        }
                      >
                        {statusGlyph(s)}
                      </span>
                      <span
                        className={
                          s === 'have'
                            ? 'font-medium text-[hsl(var(--foreground))]'
                            : 'text-[hsl(var(--muted-foreground))]'
                        }
                      >
                        {name}
                        {overridden ? (
                          <span className="ml-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                            (manual)
                          </span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {haveBarPct < 0 ? null : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
