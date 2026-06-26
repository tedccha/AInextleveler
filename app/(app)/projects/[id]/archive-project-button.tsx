'use client'

import { useState } from 'react'
import { Button } from '@fluentui/react-components'
import { archiveProjectResourcesAction } from './actions'

export function ArchiveProjectButton({ projectId }: { projectId: number }) {
  const [isArchiving, setIsArchiving] = useState(false)

  const handleArchiveProject = async () => {
    if (!confirm('Archive all resources in this project?')) return

    try {
      setIsArchiving(true)
      await archiveProjectResourcesAction(projectId)
      window.location.reload()
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <Button
      appearance="secondary"
      onClick={handleArchiveProject}
      disabled={isArchiving}
    >
      {isArchiving ? 'Archiving...' : 'Archive All'}
    </Button>
  )
}
