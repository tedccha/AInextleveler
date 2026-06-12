'use client'

import { useState } from 'react'
import { addResourceToAnyProjectAction } from './actions'
import { toast } from 'sonner'
import Link from 'next/link'

export function QuickAddResource() {
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    try {
      await addResourceToAnyProjectAction(url)
    } catch (err) {
      setPending(false)
      toast.error('Failed to add resource')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-card border-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">Add Resource</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Paste a link or GitHub repo. The AI will assess and suggest which project it belongs to.
          </p>
        </div>
        <Link
          href="/inbox"
          className="whitespace-nowrap rounded-card border border-[hsl(var(--border))] px-3 py-1 text-xs hover:bg-[hsl(var(--muted))]"
        >
          View Queue
        </Link>
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://... or github.com/owner/repo"
          required
          className="flex-1 rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-card bg-[hsl(var(--accent))] px-6 py-2 font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
        >
          {pending ? 'Adding...' : 'Add'}
        </button>
      </div>
    </form>
  )
}
