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
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <label className="text-sm font-medium whitespace-nowrap">Add Resource</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://... or github.com/owner/repo"
          disabled={status === 'assessing'}
          required
          className="flex-1 rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'assessing'}
          className="rounded-card bg-[hsl(var(--accent))] px-4 py-2 text-sm font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50 whitespace-nowrap"
        >
          {status === 'assessing' ? 'Adding...' : 'Add'}
        </button>
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
