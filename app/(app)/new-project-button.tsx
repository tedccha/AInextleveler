'use client'

import { useState } from 'react'
import { createProjectAction } from './actions'
import { toast } from 'sonner'

export function NewProjectButton() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    try {
      await createProjectAction(name, description)
      setName('')
      setDescription('')
      setOpen(false)
      toast.success('Project created')
    } catch (err) {
      toast.error('Failed to create project')
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))]"
      >
        New Project
      </button>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6">
        <h2 className="mb-4 font-semibold">Create New Project</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium">Project Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Setup a Claw"
              required
              className="w-full rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the goal of this project? Be specific so the AI can match resources accurately."
              required
              rows={4}
              className="w-full rounded-card border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:border-[hsl(var(--accent))] focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
            >
              Create
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
