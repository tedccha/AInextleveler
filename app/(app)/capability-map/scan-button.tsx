'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Refresh button — runs GitHub scan, then infrastructure scan,    │
 *   │  in sequence. Each is a separate SSE endpoint. UI shows status   │
 *   │  line under the button with phase prefix.                        │
 *   │                                                                  │
 *   │   idle ──click──▶ running:github ──▶ running:infra ──▶ done    │
 *   │     ▲                                                  │         │
 *   │     └──────────────error/done─────────────────────────┘         │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Phase = 'idle' | 'running:github' | 'running:infra' | 'done' | 'error'

export function ScanButton() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const router = useRouter()

  async function start() {
    setError('')
    setStatus('')

    // Phase 1: GitHub scan.
    setPhase('running:github')
    const ghOk = await runStream(
      '/api/scan/github',
      (s) => setStatus(`GitHub: ${s}`),
      (e) => setError(`GitHub: ${e}`),
      handleGithubFrame,
    )
    if (!ghOk) {
      setPhase('error')
      return
    }

    // Phase 2: Infrastructure scan.
    setPhase('running:infra')
    const infraOk = await runStream(
      '/api/scan/infrastructure',
      (s) => setStatus(`Infra: ${s}`),
      (e) => setError(`Infra: ${e}`),
      handleInfraFrame,
    )
    if (!infraOk) {
      setPhase('error')
      return
    }

    setPhase('done')
    router.refresh()
  }

  const label =
    phase === 'running:github'
      ? 'Scanning GitHub…'
      : phase === 'running:infra'
        ? 'Scanning infrastructure…'
        : 'Refresh'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={phase === 'running:github' || phase === 'running:infra'}
        className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        {label}
      </button>
      {(phase === 'running:github' ||
        phase === 'running:infra' ||
        phase === 'done') &&
      status ? (
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

/**
 * Generic SSE consumer. Calls onFrame for each parsed event. Returns
 * true on clean completion, false on error.
 */
async function runStream(
  url: string,
  onStatus: (s: string) => void,
  onError: (s: string) => void,
  handler: (
    event: string,
    data: { type?: string; [k: string]: unknown },
    onStatus: (s: string) => void,
    onError: (s: string) => void,
  ) => void,
): Promise<boolean> {
  let hadError = false
  try {
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok || !res.body) {
      onError(`request failed: ${res.status}`)
      return false
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
        const isError = (event || data.type) === 'error'
        if (isError) hadError = true
        handler(event || (data.type ?? ''), data, onStatus, onError)
      }
    }
  } catch (e) {
    onError(e instanceof Error ? e.message : 'unknown error')
    return false
  }
  return !hadError
}

function handleGithubFrame(
  event: string,
  data: { type?: string; [k: string]: unknown },
  onStatus: (s: string) => void,
  onError: (s: string) => void,
) {
  switch (event) {
    case 'started':
      onStatus(
        `Scanning ${data.total_repos} repos${
          (data.skipped_forks as number) > 0
            ? ` (skipped ${data.skipped_forks} forks)`
            : ''
        }…`,
      )
      return
    case 'token_invalid':
      onError('GitHub token invalid or expired — update GITHUB_TOKEN in .env')
      return
    case 'rate_limited':
      onError('GitHub rate limited — try again in 1 hour')
      return
    case 'scanning_repo':
      onStatus(`Scanning repo ${data.index}/${data.total}: ${data.repo as string}`)
      return
    case 'extracted_repo': {
      const caps = (data.capabilities as unknown[]) ?? []
      onStatus(
        `Extracted ${caps.length} capabilities from ${data.repo as string}`,
      )
      return
    }
    case 'embedding':
      onStatus(`Embedding ${data.index}/${data.total}: ${data.key as string}`)
      return
    case 'completed':
      onStatus(
        `done. Have ${data.have} · Partial ${data.partial} · Missing ${data.missing}`,
      )
      return
    case 'error':
      onError((data.message as string) ?? 'unknown error')
      return
  }
}

function handleInfraFrame(
  event: string,
  data: { type?: string; [k: string]: unknown },
  onStatus: (s: string) => void,
  onError: (s: string) => void,
) {
  switch (event) {
    case 'started':
      onStatus('collecting filesystem signals…')
      return
    case 'collecting_signals':
      onStatus(`${data.collected} signals collected`)
      return
    case 'sending_to_sonnet':
      onStatus(`assessing ${data.signal_count} signals via Sonnet…`)
      return
    case 'assessed':
      onStatus(
        `assessed ${data.kept} capabilities (raw ${data.raw}, dropped ${data.dropped})`,
      )
      return
    case 'embedding':
      onStatus(`embedding ${data.index}/${data.total}: ${data.key as string}`)
      return
    case 'completed':
      onStatus(
        `done. Upgraded ${data.upgraded} · Preserved ${data.preserved}`,
      )
      return
    case 'error':
      onError((data.message as string) ?? 'unknown error')
      return
  }
}
