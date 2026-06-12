'use client'

import { useEffect, useState } from 'react'
import { Card, Text } from '@fluentui/react-components'

type Resource = {
  id: number
  url: string | null
  title: string
  sourceType: string
  addedAt: Date
  status: 'pending' | 'review' | 'active' | 'rejected'
  projectId: number | null
}

type Project = {
  id: number
  name: string
}

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending':
      return '#fff4ce'
    case 'review':
      return '#e7f5ff'
    case 'active':
      return '#f0fdf4'
    case 'rejected':
      return '#ffe7e0'
    default:
      return '#f5f5f5'
  }
}

function getStatusBorder(status: string): string {
  switch (status) {
    case 'pending':
      return '#ffb900'
    case 'review':
      return '#0078d4'
    case 'active':
      return '#107c10'
    case 'rejected':
      return '#da3b01'
    default:
      return '#e0e0e0'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending Assessment'
    case 'review':
      return 'Pending Approval'
    case 'active':
      return 'In Project'
    case 'rejected':
      return 'Rejected'
    default:
      return status
  }
}

export default function ArchivePage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [projectsById, setProjectsById] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        // We need to create an API route to fetch this data
        const res = await fetch('/api/archive-data')
        if (res.ok) {
          const data = await res.json()
          setResources(data.resources)
          setProjectsById(data.projectsById)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

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

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, margin: 0 }}>Resource Archive</h1>
        <Text style={{ marginTop: '4px', color: '#616161', fontSize: '14px' }}>
          All {resources.length} resources and their assessment status
        </Text>
      </div>

      {resources.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', backgroundColor: '#f5f5f5' }}>
          <Text style={{ color: '#616161' }}>No resources yet. Add resources from the inbox.</Text>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {resources.map((resource) => (
            <Card
              key={resource.id}
              style={{
                padding: '12px',
                backgroundColor: getStatusColor(resource.status),
                borderLeft: `4px solid ${getStatusBorder(resource.status)}`,
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
                    {resource.sourceType} • Added {formatDateTime(new Date(resource.addedAt))}
                  </Text>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: getStatusBorder(resource.status),
                      marginBottom: '4px',
                    }}
                  >
                    {getStatusLabel(resource.status)}
                  </div>
                  {resource.projectId && projectsById[resource.projectId] && (
                    <Text style={{ fontSize: '11px', color: '#616161' }}>
                      → {projectsById[resource.projectId]}
                    </Text>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
