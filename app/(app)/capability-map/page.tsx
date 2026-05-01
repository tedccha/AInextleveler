/**
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │  /capability-map — locked information architecture (design review)     │
 *   │                                                                        │
 *   │  Server component fetches DB rows, renders header + 6-card grid.       │
 *   │  Each card is a client component (CapabilityCard) for inline override  │
 *   │  edits. Refresh button + Export button + Backfill banner are clients.  │
 *   │                                                                        │
 *   │  Biggest-gap card: 2x bolder theme number + thin neutral outline.      │
 *   │  NO colored border (anti-slop ban).                                    │
 *   └────────────────────────────────────────────────────────────────────────┘
 */

import {
  LIFECYCLE_THEMES,
  CAPABILITIES_BY_THEME,
  type Theme,
} from '@/lib/taxonomy'
import { readCapabilityMap } from '@/lib/scan/github'
import { ScanButton } from './scan-button'
import { ExportButton } from './export-button'
import { BackfillBanner } from './backfill-banner'
import { CapabilityCard, type RowState } from './capability-card'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      const status = list?.find((r) => r.name === name)?.status ?? 'missing'
      if (status === 'missing') missing++
    }
    if (missing > bestMissing) {
      bestMissing = missing
      best = theme
    }
  }
  return bestMissing > 0 ? best : null
}

function lastScannedLabel(
  byTheme: Awaited<ReturnType<typeof readCapabilityMap>>['byTheme'],
): string {
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

function buildRows(
  list:
    | Awaited<ReturnType<typeof readCapabilityMap>>['byTheme'][Theme]
    | undefined,
  subs: readonly string[],
): RowState[] {
  return subs.map((name) => {
    const row = list?.find((r) => r.name === name)
    return {
      name,
      status: (row?.status ?? 'missing') as 'have' | 'partial' | 'missing',
      manualOverride: row?.manualOverride ?? false,
    }
  })
}

export default async function CapabilityMapPage() {
  const { byTheme, totals, pendingEmbeds } = await readCapabilityMap()
  const biggestGap = findBiggestGap(byTheme)
  const totalSubcaps = LIFECYCLE_THEMES.reduce(
    (n, t) => n + CAPABILITIES_BY_THEME[t].length,
    0,
  )

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1>Capability Map</h1>
          <p className="mt-1 font-mono text-sm text-[hsl(var(--muted-foreground))]">
            {totals.have}/{totalSubcaps} capabilities · Have: {totals.have} ·
            Partial: {totals.partial} · Missing:{' '}
            {totalSubcaps - totals.have - totals.partial} ·{' '}
            {lastScannedLabel(byTheme)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <ExportButton />
            <ScanButton />
          </div>
        </div>
      </header>

      {pendingEmbeds > 0 ? <BackfillBanner pending={pendingEmbeds} /> : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {LIFECYCLE_THEMES.map((theme, i) => (
          <CapabilityCard
            key={theme}
            theme={theme}
            index={i}
            isBiggestGap={biggestGap === theme}
            rows={buildRows(byTheme[theme], CAPABILITIES_BY_THEME[theme])}
          />
        ))}
      </div>
    </div>
  )
}
