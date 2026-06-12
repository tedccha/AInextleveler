'use client'

import { useState } from 'react'
import { assessAndApproveAction, rejectResourceAction, createProjectWithoutRedirect } from './actions'
import {
  Button,
  Card,
  Text,
  Input,
  Textarea,
  Badge,
} from '@fluentui/react-components'
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

function renderMarkdown(text: string) {
  const parts: (string | React.ReactNode)[] = []
  let lastIndex = 0

  // Match **bold**, *italic*, and line breaks
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|(\n+)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <strong key={`bold-${parts.length}`} style={{ fontWeight: 600 }}>
          {match[1]}
        </strong>,
      )
    } else if (match[2]) {
      // *italic*
      parts.push(
        <em key={`italic-${parts.length}`} style={{ fontStyle: 'italic' }}>
          {match[2]}
        </em>,
      )
    } else if (match[3]) {
      // Line breaks
      parts.push(<br key={`br-${parts.length}`} />)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
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
  const [showSelect, setShowSelect] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState(assessment?.suggestedProjectName || '')
  const [createDescription, setCreateDescription] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)

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

  const handleCreateAndApprove = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingProject(true)
    try {
      const result = await createProjectWithoutRedirect(createName, createDescription)
      await assessAndApproveAction(
        item.id,
        assessment?.id || 0,
        result.id,
        assessment?.suggestedSequenceIndex || 0,
      )
      toast.success('Project created and resource added')
      window.location.reload()
    } catch (err) {
      toast.error('Failed to create project or approve')
    } finally {
      setCreatingProject(false)
    }
  }

  return (
    <Card style={{ padding: '16px', marginBottom: '16px' }}>
      <a
        href={item.url || '#'}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontWeight: 500,
          color: '#0078d4',
          textDecoration: 'none',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
      >
        {item.title}
      </a>

      <Text
        style={{ marginTop: '8px', fontSize: '12px', color: '#616161' }}
      >
        {item.sourceType} • Added {formatDateTime(item.addedAt)}
      </Text>

      {status === 'pending' ? (
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
          <Button
            onClick={handleAssess}
            disabled={assessing}
            appearance="primary"
          >
            {assessing ? 'Assessing...' : 'Assess'}
          </Button>
          <Button onClick={handleReject} appearance="secondary">
            Skip
          </Button>
        </div>
      ) : assessment ? (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Quality & Confidence */}
          <Card style={{ padding: '12px', backgroundColor: '#f5f5f5' }}>
            <Text style={{ fontSize: '12px', fontFamily: 'monospace', color: '#616161' }}>
              Quality: {assessment.qualityScore}/10 • Confidence: {assessment.confidence}%
            </Text>
            <div
              style={{
                marginTop: '8px',
                fontSize: '12px',
                lineHeight: 1.6,
                color: '#333',
              }}
            >
              {renderMarkdown(assessment.rationale)}
            </div>
          </Card>

          {/* Warnings */}
          {assessment.isDuplicate && assessment.isDuplicate !== 'no' && (
            <Card style={{ padding: '8px', backgroundColor: '#fff4ce', borderLeft: '4px solid #ffb900' }}>
              <Text style={{ fontSize: '12px', fontWeight: 500, color: '#7f3800' }}>
                ⚠️ Similar to existing resource
              </Text>
            </Card>
          )}

          {/* Project Fit & Assignment */}
          <Card style={{ padding: '12px', backgroundColor: '#f0f8ff', borderLeft: '4px solid #0078d4' }}>
            {!showCreate && !showSelect && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Button
                  onClick={() => setShowCreate(true)}
                  appearance="secondary"
                  style={{ fontSize: '13px', padding: '6px 12px' }}
                >
                  Create
                </Button>

                <Button
                  onClick={() => setShowSelect(true)}
                  appearance="secondary"
                  style={{ fontSize: '13px', padding: '6px 12px' }}
                >
                  Select
                </Button>

                <Button
                  onClick={handleReject}
                  appearance="secondary"
                  style={{ fontSize: '13px', padding: '6px 12px', color: '#da3b01' }}
                >
                  Reject
                </Button>
              </div>
            )}

            {/* Create Project Form */}
            {showCreate && (
              <div>
                <Text style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>Create new project:</Text>
                <form onSubmit={handleCreateAndApprove} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Project name"
                    required
                  />
                  <Textarea
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="Project description"
                    required
                    rows={2}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      type="submit"
                      disabled={creatingProject}
                      appearance="primary"
                      style={{ flex: 1 }}
                    >
                      {creatingProject ? 'Creating...' : 'Create & Assign'}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      appearance="secondary"
                      style={{ flex: 1 }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* Select Project List */}
            {showSelect && (
              <div>
                <Text style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px' }}>Assign to project:</Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px' }}>
                  {allProjects.map((p) => (
                    <Button
                      key={p.id}
                      onClick={() => {
                        handleApprove(p.id)
                        setShowSelect(false)
                      }}
                      appearance="secondary"
                      style={{ fontSize: '13px', padding: '8px 10px', textAlign: 'center', whiteSpace: 'normal' }}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => setShowSelect(false)}
                  appearance="secondary"
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </Card>
  )
}
