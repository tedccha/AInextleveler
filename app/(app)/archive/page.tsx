'use client'

import { useEffect, useState } from 'react'
import { Card, Text, Input, Button } from '@fluentui/react-components'

type Resource = {
  id: number
  url: string | null
  title: string
  sourceType: string
  addedAt: Date
  archivedAt: Date | null
  status: string
  projectId: number | null
}

type Project = {
  id: number
  name: string
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ArchivePage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [projectsById, setProjectsById] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [unarchiving, setUnarchiving] = useState<number | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setError(null)
        const res = await fetch('/api/archive-data', { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`API error: ${res.status}`)
        }
        const data = await res.json()
        setResources(data.resources || [])
        setProjectsById(data.projectsById || {})
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch archive data'
        setError(message)
        console.error('Archive fetch error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const filteredResources = resources.filter((resource) => {
    const searchLower = search.toLowerCase()
    return (
      resource.title.toLowerCase().includes(searchLower) ||
      resource.sourceType.toLowerCase().includes(searchLower) ||
      (resource.projectId && projectsById[resource.projectId]?.toLowerCase().includes(searchLower))
    )
  })

  const handleUnarchive = async (resourceId: number) => {
    try {
      setUnarchiving(resourceId)
      const response = await fetch(`/api/unarchive/${resourceId}`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to unarchive')
      }
      setResources((prev) => prev.filter((r) => r.id !== resourceId))
    } catch (err) {
      console.error('Unarchive error:', err)
      alert('Failed to unarchive resource')
    } finally {
      setUnarchiving(null)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: 0 }}>Resource Archive</h1>
        <Text style={{ marginTop: '4px', color: '#616161', fontSize: '14px' }}>
          Loading...
        </Text>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: 0 }}>Resource Archive</h1>
        <Card style={{ padding: '24px', marginTop: '16px', backgroundColor: '#fff4ce', borderLeft: '4px solid #ffb900' }}>
          <Text style={{ color: '#333' }}>Error loading archive: {error}</Text>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: 0 }}>Resource Archive</h1>
        <Text style={{ marginTop: '4px', color: '#616161', fontSize: '14px' }}>
          {resources.length} archived resource{resources.length !== 1 ? 's' : ''}
        </Text>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <Input
          type="text"
          placeholder="Search by title, source, or project..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: '400px' }}
        />
        <Text style={{ marginTop: '4px', fontSize: '12px', color: '#616161' }}>
          {filteredResources.length} of {resources.length} resources
        </Text>
      </div>

      {resources.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ color: '#616161' }}>No archived resources yet.</Text>
        </Card>
      ) : filteredResources.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ color: '#616161' }}>No resources match your search.</Text>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {filteredResources.map((resource) => (
            <Card
              key={resource.id}
              style={{
                padding: '12px',
                backgroundColor: '#f5f5f5',
                borderLeft: '4px solid #999',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    href={resource.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontWeight: 500,
                      color: '#0078d4',
                      textDecoration: 'none',
                      fontSize: '14px',
                      wordBreak: 'break-word',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                  >
                    {resource.title}
                  </a>
                  <Text
                    style={{
                      marginTop: '4px',
                      fontSize: '12px',
                      color: '#616161',
                      display: 'block',
                    }}
                  >
                    {resource.sourceType} • Archived {resource.archivedAt ? formatDateTime(resource.archivedAt) : 'unknown'}
                  </Text>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
                  {resource.projectId && projectsById[resource.projectId] && (
                    <Text style={{ fontSize: '11px', color: '#616161' }}>
                      {projectsById[resource.projectId]}
                    </Text>
                  )}
                  <Button
                    appearance="secondary"
                    size="small"
                    onClick={() => handleUnarchive(resource.id)}
                    disabled={unarchiving === resource.id}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {unarchiving === resource.id ? 'Unarchiving...' : 'Unarchive'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
