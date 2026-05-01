/**
 * GET /api/capabilities/export
 *
 * Returns the capability map as markdown text. Used by the Export
 * button on /capability-map (paste into Claude prompts, CLAUDE.md, etc.)
 *
 * Format mirrors the visual hierarchy of the page: numbered themes,
 * sub-cap rows with status glyph + (manual) badge.
 */

import { withSession } from '@/lib/auth'
import { LIFECYCLE_THEMES, CAPABILITIES_BY_THEME } from '@/lib/taxonomy'
import { readCapabilityMap } from '@/lib/scan/github'

export const runtime = 'nodejs'

function glyph(s: 'have' | 'partial' | 'missing'): string {
  if (s === 'have') return '✓'
  if (s === 'partial') return '◐'
  return '✗'
}

export const GET = withSession(async () => {
  const { byTheme, totals } = await readCapabilityMap()
  const total = LIFECYCLE_THEMES.reduce(
    (n, t) => n + CAPABILITIES_BY_THEME[t].length,
    0,
  )
  const haveBar = '▓'.repeat(Math.round((totals.have / total) * 20))
  const restBar = '░'.repeat(20 - haveBar.length)

  const lines: string[] = []
  lines.push('# AInextleveler Capability Map')
  lines.push('')
  lines.push(
    `**${totals.have}/${total} capabilities** \`${haveBar}${restBar}\``,
  )
  lines.push(
    `Have: ${totals.have} · Partial: ${totals.partial} · Missing: ${totals.missing}`,
  )
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  for (let i = 0; i < LIFECYCLE_THEMES.length; i++) {
    const theme = LIFECYCLE_THEMES[i]
    const subs = CAPABILITIES_BY_THEME[theme]
    const list = byTheme[theme] ?? []
    const have = subs.filter(
      (n) => list.find((r) => r.name === n)?.status === 'have',
    ).length
    lines.push(`## ${i + 1}. ${theme}  (${have}/${subs.length})`)
    lines.push('')
    for (const name of subs) {
      const row = list.find((r) => r.name === name)
      const s = (row?.status ?? 'missing') as 'have' | 'partial' | 'missing'
      const manual = row?.manualOverride ? ' _(manual)_' : ''
      lines.push(`- ${glyph(s)} ${name}${manual}`)
    }
    lines.push('')
  }

  const md = lines.join('\n')
  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition':
        'inline; filename="ainextleveler-capability-map.md"',
    },
  })
})
