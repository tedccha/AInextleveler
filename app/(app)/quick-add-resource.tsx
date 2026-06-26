'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { addResourceToAnyProjectAction } from './actions'
import { toast } from 'sonner'

type Status = 'idle' | 'assessing' | 'done' | 'error'

export function QuickAddResource() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    if (status === 'done') {
      const timer = setTimeout(() => {
        setStatus('idle')
        setStatusMessage('')
        setUrl('')
        // Refresh page data after done state to show new item
        router.refresh()
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [status, router])

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (url.trim() && status !== 'assessing') {
        handleSubmit(e as unknown as React.FormEvent)
      }
    }
  }

  return (
    <div className="mb-6">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add Resource — paste a URL (https://..., github.com/owner/repo) or text content"
            disabled={status === 'assessing'}
            rows={3}
            className="w-full rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none disabled:opacity-50 resize-none font-mono text-xs"
          />
          <div className="flex justify-between items-center mt-2">
            {url.trim() && (
              <button
                type="submit"
                disabled={status === 'assessing'}
                className="text-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]/80 disabled:opacity-50 font-medium text-sm px-3 py-1 rounded hover:bg-[hsl(var(--accent))]/10"
              >
                {status === 'assessing' ? 'Assessing...' : 'Add Resource'}
              </button>
            )}
          </div>
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
