'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  ScanButton — kicks off POST /api/scan/github, streams SSE       │
 *   │  events into a status line under the button.                     │
 *   │                                                                  │
 *   │   idle ──click──▶ running                                       │
 *   │     ▲              │                                             │
 *   │     │              ├─ scanning_repo i/N: <repo>                 │
 *   │     │              ├─ extracted_repo: caps shown                │
 *   │     │              ├─ embedding i/N: <key>                       │
 *   │     │              ▼                                             │
 *   │     └──completed/error──▶ refresh page                          │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Phase = 'idle' | 'running' | 'done' | 'error'

export function ScanButton() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const router = useRouter()

  async function start() {
    setPhase('running')
    setStatus('Starting…')
    setError('')

    try {
      const res = await fetch('/api/scan/github', { method: 'POST' })
      if (!res.ok || !res.body) {
        throw new Error(`scan request failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // SSE frames are terminated by \n\n.
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          handleFrame(frame, setStatus, setError)
        }
      }
      setPhase('done')
      // Pull fresh DB state.
      router.refresh()
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'unknown error')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={phase === 'running'}
        className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        {phase === 'running' ? 'Scanning…' : 'Refresh from GitHub'}
      </button>
      {phase === 'running' && status ? (
        <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {status}
        </p>
      ) : null}
      {phase === 'error' && error ? (
        <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
      ) : null}
    </div>
  )
}

function handleFrame(
  frame: string,
  setStatus: (s: string) => void,
  setError: (s: string) => void,
) {
  // Parse `event:` and `data:` lines from one SSE frame.
  let event = ''
  let dataLine = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLine = line.slice(5).trim()
  }
  if (!dataLine) return
  let data: { type?: string; [k: string]: unknown }
  try {
    data = JSON.parse(dataLine) as { type?: string; [k: string]: unknown }
  } catch {
    return
  }
  switch (event || data.type) {
    case 'started': {
      setStatus(
        `Scanning ${data.total_repos} repos${
          (data.skipped_forks as number) > 0
            ? ` (skipped ${data.skipped_forks} forks)`
            : ''
        }…`,
      )
      return
    }
    case 'token_invalid':
      setError('GitHub token invalid or expired — update GITHUB_TOKEN in .env')
      return
    case 'rate_limited':
      setError('GitHub rate limited — try again in 1 hour')
      return
    case 'scanning_repo':
      setStatus(
        `Scanning repo ${data.index}/${data.total}: ${data.repo as string}`,
      )
      return
    case 'extracted_repo': {
      const caps = (data.capabilities as unknown[]) ?? []
      setStatus(
        `Extracted ${caps.length} capabilities from ${data.repo as string}`,
      )
      return
    }
    case 'embedding':
      setStatus(`Embedding ${data.index}/${data.total}: ${data.key as string}`)
      return
    case 'completed':
      setStatus(
        `Done. Have: ${data.have}, Partial: ${data.partial}, Missing: ${data.missing}.`,
      )
      return
    case 'error':
      setError((data.message as string) ?? 'unknown error')
      return
  }
}
