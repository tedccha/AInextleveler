'use client'

import { useState } from 'react'
import { renderMarkdown } from '@/lib/render-markdown'
import type { InferSelectModel } from 'drizzle-orm'
import type { resources, assessments } from '@/lib/db/schema'

type Resource = InferSelectModel<typeof resources>
type Assessment = InferSelectModel<typeof assessments>

export function ResourceItem({
  resource,
  assessment,
  index,
}: {
  resource: Resource
  assessment?: Assessment | null
  index: number
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-card border border-[hsl(var(--border))] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-start gap-2 text-left hover:opacity-70 w-full"
          >
            <span className="mt-1 text-[hsl(var(--muted-foreground))]">
              {expanded ? '▼' : '▶'}
            </span>
            <div className="flex-1 min-w-0">
              <a
                href={resource.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:text-[hsl(var(--accent))] break-words"
                onClick={(e) => e.stopPropagation()}
              >
                {resource.title}
              </a>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {index + 1}. {resource.sourceType} • Added{' '}
                {new Date(resource.addedAt).toLocaleDateString()}
              </p>
            </div>
          </button>
        </div>
        <span className="rounded bg-[hsl(var(--muted))] px-2 py-1 text-xs font-medium whitespace-nowrap">
          {resource.status}
        </span>
      </div>

      {expanded && assessment && (
        <div className="mt-3 space-y-3 border-t border-[hsl(var(--border))] pt-3">
          {/* Quality & Confidence */}
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              Quality & Confidence
            </p>
            <p className="mt-1 font-mono text-sm">
              {assessment.qualityScore}/10{assessment.confidence ? ` • ${assessment.confidence}%` : ''}
            </p>
          </div>

          {/* Rationale */}
          <div>
            <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              Assessment
            </p>
            <div className="mt-1 text-xs leading-relaxed text-[hsl(var(--foreground))]">
              {renderMarkdown(assessment.rationale)}
            </div>
          </div>

          {/* Usefulness Score (if completed) */}
          {resource.usefulnessScore && (
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                Your Rating
              </p>
              <p className="mt-1 text-sm">
                {'★'.repeat(resource.usefulnessScore)}{'☆'.repeat(5 - resource.usefulnessScore)}
              </p>
            </div>
          )}
        </div>
      )}

      {expanded && !assessment && (
        <div className="mt-3 border-t border-[hsl(var(--border))] pt-3">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            No assessment data available
          </p>
        </div>
      )}
    </div>
  )
}
