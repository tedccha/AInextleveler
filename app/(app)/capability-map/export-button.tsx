'use client'

/**
 * Export Markdown — fetch /api/capabilities/export, copy to clipboard.
 * Shows a 2s "Copied" confirmation, then resets.
 */

import { useState } from 'react'

export function ExportButton() {
  const [phase, setPhase] = useState<'idle' | 'copied' | 'error'>('idle')

  async function copyExport() {
    try {
      const res = await fetch('/api/capabilities/export')
      if (!res.ok) {
        setPhase('error')
        setTimeout(() => setPhase('idle'), 2000)
        return
      }
      const md = await res.text()
      await navigator.clipboard.writeText(md)
      setPhase('copied')
      setTimeout(() => setPhase('idle'), 2000)
    } catch {
      setPhase('error')
      setTimeout(() => setPhase('idle'), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={copyExport}
      className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))]"
    >
      {phase === 'copied'
        ? '✓ Copied'
        : phase === 'error'
          ? "Couldn't copy"
          : 'Export Markdown'}
    </button>
  )
}
