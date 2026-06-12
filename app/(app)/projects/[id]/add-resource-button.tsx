'use client'

import { useState } from 'react'
import { addResourceAction } from './actions'
import { toast } from 'sonner'

export function AddResourceButton({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    try {
      await addResourceAction(projectId, url)
      setUrl('')
      setOpen(false)
      toast.success('Resource added to inbox for review')
      window.location.reload()
    } catch (err) {
      toast.error('Failed to add resource')
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))] text-sm"
      >
        Add Resource
      </button>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="w-full max-w-md rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
        <h2 className="mb-4 font-semibold">Add Resource</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">URL or GitHub Repo</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              required
              className="w-full rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none"
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Paste a link or GitHub repo URL. The system will assess it and suggest if it fits this project.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))] text-sm disabled:opacity-50"
            >
              {pending ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-card border border-[hsl(var(--border))] px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
