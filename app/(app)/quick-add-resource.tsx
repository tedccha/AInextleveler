'use client'

import { useState, useEffect } from 'react'
import { addResourceToAnyProjectAction } from './actions'
import { toast } from 'sonner'

type Status = 'idle' | 'assessing' | 'done' | 'error'

export function QuickAddResource() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    if (status === 'done') {
      const timer = setTimeout(() => {
        setStatus('idle')
        setStatusMessage('')
        setUrl('')
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [status])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    setStatus('assessing')
    setStatusMessage('Assessing...')

    try {
      const resource = await addResourceToAnyProjectAction(url)

      const assessRes = await fetch('/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: resource.id }),
      })

      if (!assessRes.ok) {
        throw new Error('Assessment failed')
      }

      const { assessment } = await assessRes.json()
      setStatusMessage(`In Inbox, quality ${assessment.qualityScore}/10`)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      const message = err instanceof Error ? err.message : 'Failed to add resource'
      setStatusMessage(message)
      toast.error(message)

      setTimeout(() => {
        setStatus('idle')
        setStatusMessage('')
      }, 3000)
    }
  }

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Add Resource — https://... or github.com/owner/repo"
            disabled={status === 'assessing'}
            className="w-full rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 pr-10 text-sm focus:border-[hsl(var(--accent))] focus:outline-none disabled:opacity-50"
          />
          {url.trim() && (
            <button
              type="submit"
              disabled={status === 'assessing'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]/80 disabled:opacity-50 font-medium text-sm"
            >
              {status === 'assessing' ? '↳' : '↵'}
            </button>
          )}
        </div>
      </form>
      {statusMessage && (
        <div className={`text-xs mt-1 ${
          status === 'error' ? 'text-red-600' : 'text-[hsl(var(--muted-foreground))]'
        }`}>
          {statusMessage}
        </div>
      )}
    </div>
  )
}
