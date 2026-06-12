'use client'

import { useState } from 'react'
import { assessAndApproveAction, rejectResourceAction } from './actions'
import { toast } from 'sonner'
import type { InferSelectModel } from 'drizzle-orm'
import type { projects, resources, assessments } from '@/lib/db/schema'

type Resource = InferSelectModel<typeof resources>
type Assessment = InferSelectModel<typeof assessments>
type Project = InferSelectModel<typeof projects>

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function InboxItem({
  item,
  assessment,
  allProjects,
  status,
}: {
  item: Resource
  assessment?: Assessment | null
  allProjects: Project[]
  status: 'pending' | 'review'
}) {
  const [assessing, setAssessing] = useState(false)
  const [showOverride, setShowOverride] = useState(false)

  const handleAssess = async () => {
    setAssessing(true)
    try {
      const res = await fetch('/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: item.id }),
      })

      if (!res.ok) throw new Error('Assessment failed')

      const data = await res.json()
      toast.success('Resource assessed')
      setTimeout(() => window.location.reload(), 1000)
    } catch (err) {
      toast.error('Assessment failed')
    } finally {
      setAssessing(false)
    }
  }

  const handleReject = async () => {
    try {
      await rejectResourceAction(item.id)
      toast.success('Resource rejected')
      window.location.reload()
    } catch (err) {
      toast.error('Failed to reject')
    }
  }

  const handleApprove = async (projectId: number | null) => {
    try {
      await assessAndApproveAction(
        item.id,
        assessment?.id || 0,
        projectId,
        assessment?.suggestedSequenceIndex || 0,
      )
      toast.success('Resource approved and added to project')
      window.location.reload()
    } catch (err) {
      toast.error('Failed to approve')
    }
  }

  return (
    <div className="rounded-card border border-[hsl(var(--border))] p-4">
      <a
        href={item.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium hover:text-[hsl(var(--accent))]"
      >
        {item.title}
      </a>

      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
        {item.sourceType} • Added {formatDateTime(item.addedAt)}
      </p>

      {status === 'pending' ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleAssess}
            disabled={assessing}
            className="rounded-card bg-[hsl(var(--accent))] px-3 py-1 text-sm font-medium text-[hsl(var(--accent-foreground))] disabled:opacity-50"
          >
            {assessing ? 'Assessing...' : 'Assess'}
          </button>
          <button
            onClick={handleReject}
            className="rounded-card border border-[hsl(var(--border))] px-3 py-1 text-sm"
          >
            Skip
          </button>
        </div>
      ) : assessment ? (
        <div className="mt-4 space-y-4">
          {/* Quality & Confidence */}
          <div className="rounded-card bg-[hsl(var(--muted))] p-3">
            <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              Quality: {assessment.qualityScore}/10 • Confidence: {assessment.confidence}%
            </p>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">
              {assessment.rationale}
            </p>
          </div>

          {/* Warnings */}
          {assessment.isDuplicate && assessment.isDuplicate !== 'no' && (
            <div className="rounded border border-orange-500 bg-orange-500/10 p-2">
              <p className="text-xs font-medium text-orange-700">
                ⚠️ Similar to existing resource
              </p>
            </div>
          )}

          {assessment.qualityScore < 4 && (
            <div className="rounded border border-red-500 bg-red-500/10 p-2">
              <p className="text-xs font-medium text-red-700">
                Quality below threshold
              </p>
            </div>
          )}

          {/* Project Fit & Assignment */}
          <div className="space-y-3 rounded-card border border-[hsl(var(--border))] bg-[hsl(var(--accent))]/5 p-3">
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                Project Fit
              </p>
              <p className="mt-1 text-sm">
                {assessment.suggestedProjectId
                  ? allProjects.find((p) => p.id === assessment.suggestedProjectId)?.name
                  : assessment.suggestedProjectName || 'No project match'}
              </p>
            </div>

            {/* Assignment Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              {assessment.suggestedProjectId ? (
                <>
                  <button
                    onClick={() => handleApprove(assessment.suggestedProjectId)}
                    className="flex-1 rounded-card bg-green-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    ✓ Assign to {allProjects.find((p) => p.id === assessment.suggestedProjectId)?.name}
                  </button>
                  <button
                    onClick={() => setShowOverride(true)}
                    className="rounded-card border border-[hsl(var(--border))] px-3 py-2 text-sm"
                  >
                    Change Project
                  </button>
                </>
              ) : assessment.suggestedProjectName ? (
                <>
                  <button
                    onClick={() => handleApprove(null)}
                    className="flex-1 rounded-card bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    ➕ Create & Assign "{assessment.suggestedProjectName}"
                  </button>
                  <button
                    onClick={() => setShowOverride(true)}
                    className="rounded-card border border-[hsl(var(--border))] px-3 py-2 text-sm"
                  >
                    Choose Different
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowOverride(true)}
                    className="flex-1 rounded-card bg-gray-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    Choose Project
                  </button>
                </>
              )}

              <button
                onClick={handleReject}
                className="rounded-card border border-[hsl(var(--border))] px-3 py-2 text-sm"
              >
                Reject
              </button>
            </div>

            {/* Project Override */}
            {showOverride && (
              <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
                <p className="text-xs font-medium">Choose project:</p>
                <div className="space-y-1">
                  {allProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        handleApprove(p.id)
                        setShowOverride(false)
                      }}
                      className="block w-full rounded border border-[hsl(var(--border))] px-3 py-2 text-left text-xs hover:bg-[hsl(var(--muted))]"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
