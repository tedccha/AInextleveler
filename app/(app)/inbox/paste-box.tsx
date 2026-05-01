'use client'

/**
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  PasteBox — the hero affordance.                                 │
 *   │                                                                  │
 *   │   idle ──submit URL──▶ fetching → embedding → classifying →      │
 *   │                       checking_library → verdict (card appears)  │
 *   │                                                                  │
 *   │   On 'needs_paste' event: show inline textarea, ask for content  │
 *   │   text, re-submit with pastedAfterPrompt=true.                   │
 *   │                                                                  │
 *   │   Truncation banner appears when input >4000 chars.              │
 *   │   Already-evaluated banner with link to existing entry.          │
 *   └──────────────────────────────────────────────────────────────────┘
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { looksLikeUrl } from '@/lib/fetch-url'

type Stage =
  | 'idle'
  | 'fetching'
  | 'embedding'
  | 'classifying'
  | 'checking_library'
  | 'done'
  | 'error'
  | 'needs_paste'

const CONTENT_CAP = 4000

export function PasteBox() {
  const [input, setInput] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [stageHistory, setStageHistory] = useState<string[]>([])
  const [error, setError] = useState<string>('')
  const [verdict, setVerdict] = useState<{
    title: string
    verdict: string
    verdict_reason: string
    review_prompt: string | null
    resource_id: number
    similarity_top: { key: string; score: number } | null
    already_have_via?: string
    embedding_failed: boolean
    overridden_by_confidence: boolean
  } | null>(null)
  const [alreadyEvaluated, setAlreadyEvaluated] = useState<{
    resource_id: number
    verdict: string
    url: string
  } | null>(null)
  const [needsPasteState, setNeedsPasteState] = useState<{
    url: string
    reason: string
    pastedText: string
  } | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const truncated = input.length > CONTENT_CAP

  async function submit() {
    setError('')
    setVerdict(null)
    setAlreadyEvaluated(null)
    setStageHistory([])

    const trimmed = input.trim()
    if (!trimmed) {
      setError('Paste a URL or content.')
      return
    }

    const isUrl = looksLikeUrl(trimmed)
    const body: Record<string, unknown> = isUrl
      ? { url: trimmed }
      : { contentText: trimmed.slice(0, CONTENT_CAP) }

    await runClassify(body)
  }

  async function submitPaste() {
    if (!needsPasteState) return
    if (!needsPasteState.pastedText.trim()) {
      setError('Paste the content text.')
      return
    }
    setError('')
    setStageHistory([])
    await runClassify({
      url: needsPasteState.url,
      contentText: needsPasteState.pastedText.slice(0, CONTENT_CAP),
      pastedAfterPrompt: true,
    })
  }

  async function runClassify(body: Record<string, unknown>) {
    setStage('fetching') // optimistic; backend may skip if no URL
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        setStage('error')
        setError(`request failed: ${res.status}`)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const armTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          setStage('error')
          setError('Stuck — check your connection. Retry?')
          reader.cancel().catch(() => {})
        }, 30_000)
      }
      armTimeout()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        armTimeout()
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
          handleEvent(event || (data.type ?? ''), data)
        }
      }
      if (timeoutId) clearTimeout(timeoutId)
    } catch (e) {
      setStage('error')
      setError(e instanceof Error ? e.message : 'unknown error')
    }
  }

  function handleEvent(
    event: string,
    data: { type?: string; [k: string]: unknown },
  ) {
    switch (event) {
      case 'fetching':
        setStage('fetching')
        setStageHistory((h) => [...h, `fetching ${data.source as string}`])
        return
      case 'fetched':
        setStageHistory((h) => [
          ...h,
          `fetched ${data.chars as number} chars${(data.truncated as boolean) ? ' (truncated)' : ''}`,
        ])
        return
      case 'needs_paste': {
        setStage('needs_paste')
        const reason = data.reason as string
        const message =
          reason === 'x_or_twitter'
            ? "Can't read X/Twitter. Paste the post text below."
            : reason === 'fetch_failed'
              ? `Fetch failed (${data.status as number}). Paste the content below.`
              : reason === 'not_text'
                ? "That URL isn't text. Paste the content below."
                : "Got an empty response. Paste the content below."
        setError(message)
        setNeedsPasteState({
          url: input.trim(),
          reason,
          pastedText: '',
        })
        return
      }
      case 'embedding':
        setStage('embedding')
        setStageHistory((h) => [...h, 'embedding'])
        return
      case 'embedding_failed':
        setStageHistory((h) => [...h, 'embedding failed (will use Haiku-only)'])
        return
      case 'classifying':
        setStage('classifying')
        setStageHistory((h) => [...h, 'classifying'])
        return
      case 'checking_library':
        setStage('checking_library')
        setStageHistory((h) => [
          ...h,
          (data.vector_search as boolean)
            ? 'checking library via pgvector'
            : 'skipping library check',
        ])
        return
      case 'already_evaluated':
        setStage('done')
        setAlreadyEvaluated({
          resource_id: data.resource_id as number,
          verdict: data.verdict as string,
          url: data.url as string,
        })
        return
      case 'verdict':
        setStage('done')
        setVerdict({
          title: data.title as string,
          verdict: data.verdict as string,
          verdict_reason: data.verdict_reason as string,
          review_prompt: (data.review_prompt as string | null) ?? null,
          resource_id: data.resource_id as number,
          similarity_top:
            (data.similarity_top as { key: string; score: number } | null) ?? null,
          already_have_via: data.already_have_via as string | undefined,
          embedding_failed: !!data.embedding_failed,
          overridden_by_confidence: !!data.overridden_by_confidence,
        })
        // Refresh /inbox library section once stream ends.
        startTransition(() => {
          router.refresh()
        })
        return
      case 'error':
        setStage('error')
        setError((data.message as string) ?? 'unknown error')
        return
    }
  }

  const busy =
    stage === 'fetching' ||
    stage === 'embedding' ||
    stage === 'classifying' ||
    stage === 'checking_library'

  const stageLabel =
    stage === 'fetching'
      ? 'Fetching…'
      : stage === 'embedding'
        ? 'Embedding…'
        : stage === 'classifying'
          ? 'Classifying…'
          : stage === 'checking_library'
            ? 'Checking your library…'
            : ''

  return (
    <section className="space-y-3">
      {alreadyEvaluated ? (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-3 text-sm">
          You&apos;ve already evaluated this URL — verdict was{' '}
          <strong>{alreadyEvaluated.verdict}</strong>. See it in the library
          below.
        </div>
      ) : null}

      <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a URL (X, GitHub, blog) or content text…"
          rows={5}
          disabled={busy}
          className="block w-full resize-y bg-transparent p-4 font-sans text-base outline-none placeholder:text-[hsl(var(--muted-foreground))]"
        />
        {truncated ? (
          <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
            Truncated to 4000 chars. Haiku evaluates the first 2000.
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t border-[hsl(var(--border))] px-4 py-2">
          <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {input.length} / {CONTENT_CAP} chars
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !input.trim()}
            className="rounded-card bg-[hsl(var(--accent))] px-4 py-1.5 text-sm font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
          >
            {busy ? stageLabel : 'Classify'}
          </button>
        </div>
      </div>

      {/* Stage-history breadcrumb when busy or done */}
      {(busy || stage === 'done') && stageHistory.length > 0 ? (
        <ul className="flex flex-wrap gap-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {stageHistory.map((s, i) => (
            <li
              key={i}
              className={
                'rounded border border-[hsl(var(--border))] px-2 py-0.5 ' +
                (i === stageHistory.length - 1 && busy
                  ? 'bg-[hsl(var(--muted))]'
                  : '')
              }
            >
              {i === stageHistory.length - 1 && busy ? '· ' : '✓ '}
              {s}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Inline paste prompt for unfetchable URLs */}
      {stage === 'needs_paste' && needsPasteState ? (
        <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-2">
          <p className="text-sm font-medium">{error}</p>
          <textarea
            value={needsPasteState.pastedText}
            onChange={(e) =>
              setNeedsPasteState({
                ...needsPasteState,
                pastedText: e.target.value,
              })
            }
            placeholder="Paste the content text here…"
            rows={4}
            className="block w-full resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 font-sans text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setStage('idle')
                setNeedsPasteState(null)
                setError('')
              }}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={submitPaste}
              disabled={!needsPasteState.pastedText.trim()}
              className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
            >
              Classify pasted text
            </button>
          </div>
        </div>
      ) : null}

      {/* Verdict card */}
      {verdict ? (
        <VerdictCard
          v={verdict}
          onDismiss={() => {
            setVerdict(null)
            setInput('')
            setStage('idle')
            setStageHistory([])
            setNeedsPasteState(null)
          }}
        />
      ) : null}

      {stage === 'error' && !needsPasteState ? (
        <div className="rounded-card border border-[hsl(var(--destructive))] bg-[hsl(var(--card))] px-4 py-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      ) : null}
    </section>
  )
}

type VerdictData = {
  title: string
  verdict: string
  verdict_reason: string
  review_prompt: string | null
  resource_id: number
  similarity_top: { key: string; score: number } | null
  already_have_via?: string
  embedding_failed: boolean
  overridden_by_confidence: boolean
}

function VerdictCard({
  v,
  onDismiss,
}: {
  v: VerdictData
  onDismiss: () => void
}) {
  return (
    <div className="rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase text-[hsl(var(--muted-foreground))]">
            verdict
          </span>{' '}
          <strong>{v.verdict}</strong>
          {v.already_have_via === 'pgvector' && v.similarity_top ? (
            <span className="ml-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
              (pgvector hit: {v.similarity_top.key} @ {v.similarity_top.score.toFixed(2)})
            </span>
          ) : null}
          {v.overridden_by_confidence ? (
            <span className="ml-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
              (low confidence → needs_review)
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          dismiss
        </button>
      </div>
      <h3 className="text-base font-semibold">{v.title}</h3>
      <p className="text-sm">{v.verdict_reason}</p>
      {v.review_prompt ? (
        <p className="rounded bg-[hsl(var(--muted))] p-2 text-sm italic">
          {v.review_prompt}
        </p>
      ) : null}
      {v.embedding_failed ? (
        <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          Voyage was unavailable — embedding null. Use Backfill on /capability-map later.
        </p>
      ) : null}
      <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
        Saved as resource #{v.resource_id}. See it below in your library.
      </p>
    </div>
  )
}
