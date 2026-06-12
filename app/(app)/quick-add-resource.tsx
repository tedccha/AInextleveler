'use client'

import { useState, useEffect } from 'react'
import { addResourceToAnyProjectAction } from './actions'
import { toast } from 'sonner'

type Status = 'idle' | 'assessing' | 'done' | 'error'

export function QuickAddResource({ showOnInbox = false }: { showOnInbox?: boolean }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [qualityScore, setQualityScore] = useState<number | null>(null)

  useEffect(() => {
    if (status === 'done') {
      const timer = setTimeout(() => {
        setStatus('idle')
        setStatusMessage('')
        setQualityScore(null)
        setUrl('')
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [status])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('assessing')
    setStatusMessage('Assessing...')

    try {
      const resource = await addResourceToAnyProjectAction(url)

      // Auto-assess the resource
      const assessRes = await fetch('/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: resource.id }),
      })

      if (!assessRes.ok) {
        throw new Error('Assessment failed')
      }

      const { assessment } = await assessRes.json()
      setQualityScore(assessment.qualityScore)
      setStatusMessage(`In Inbox, quality ${assessment.qualityScore}/10`)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      const message = err instanceof Error ? err.message : 'Failed to add resource'
      setStatusMessage(message)
      toast.error(message)

      // Clear error status after 3 seconds
      setTimeout(() => {
        setStatus('idle')
        setStatusMessage('')
      }, 3000)
    }
  }

  const containerClasses = showOnInbox
    ? 'mb-6 p-4 border border-[hsl(var(--border))] rounded-card bg-[hsl(var(--muted))]/30'
    : 'space-y-3 rounded-card border-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 p-6'

  return (
    <form onSubmit={handleSubmit} className={containerClasses}>
      <div>
        <h2 className="font-semibold">Add Resource</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Paste a link or GitHub repo. It will be assessed automatically.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://... or github.com/owner/repo"
          disabled={status === 'assessing'}
          required
          className="flex-1 rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'assessing'}
          className="rounded-card bg-[hsl(var(--accent))] px-6 py-2 font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50 whitespace-nowrap"
        >
          {status === 'assessing' ? 'Adding...' : 'Add'}
        </button>
      </div>

      {statusMessage && (
        <div className={`text-xs py-1 ${
          status === 'error' ? 'text-red-600' : 'text-[hsl(var(--muted-foreground))]'
        }`}>
          {statusMessage}
        </div>
      )}
    </form>
  )
}
