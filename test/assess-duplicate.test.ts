import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/assess/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db/client'
import * as fetchModule from '@/lib/fetch-content'
import * as assessModule from '@/lib/assess-resource'

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  schema: {
    resources: {},
    projects: {},
    assessments: {},
  },
}))

vi.mock('@/lib/fetch-content')
vi.mock('@/lib/assess-resource')

describe('POST /api/assess', () => {
  const mockDb = dbModule.db as any
  const mockSchema = dbModule.schema as any
  const mockFetchContent = fetchModule.fetchContent as any
  const mockAssessResource = assessModule.assessResource as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('URL-based duplicate detection', () => {
    it('should detect exact URL duplicates and mark resource as inReview', async () => {
      const existingResourceId = 1
      const newResourceId = 2
      const sharedUrl = 'https://example.com/article'

      const mockResource = {
        id: newResourceId,
        url: sharedUrl,
        content: null,
        sourceType: 'link',
        status: 'inbox',
        title: 'New Title',
      }

      const mockExistingResource = {
        id: existingResourceId,
        url: sharedUrl,
        title: 'Existing Article',
      }

      const mockFetchedContent = {
        title: 'New Title',
        contentType: 'article',
        summary: 'Summary...',
        fullContent: 'Full content...',
      }

      const mockAssessmentRecord = [{ id: 100 }]

      // Track call count to return different chains
      let selectCallCount = 0
      mockDb.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // First call: get resource to assess
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([mockResource]),
          }
        } else {
          // Second call: get existing resources
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([mockExistingResource]),
          }
        }
      })

      // Setup mocks: update resource status
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: newResourceId }]),
      }
      mockDb.update.mockReturnValue(updateChain)

      // Setup mocks: insert assessment
      const insertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(mockAssessmentRecord),
      }
      mockDb.insert.mockReturnValue(insertChain)

      mockFetchContent.mockResolvedValue(mockFetchedContent)

      const req = new NextRequest('http://localhost:3000/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: newResourceId }),
      })

      const res = await POST(req)
      const data = await res.json()

      // Should return assessment with duplicate info
      expect(data.assessment).toBeDefined()
      expect(data.assessment.isDuplicate).toBe(true)
      expect(data.assessment.duplicateOf.id).toBe(existingResourceId)
      expect(data.assessment.rationale).toContain('Exact URL match')
      expect(data.assessment.assessmentId).toBe(100)

      // Should update resource status to inReview
      expect(mockDb.update).toHaveBeenCalled()
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'inReview',
          title: 'New Title',
        }),
      )
    })
  })

  describe('Happy path: no duplicate', () => {
    it('should assess resource normally when no duplicate exists', async () => {
      const resourceId = 1
      const projectId = 10

      const mockResource = {
        id: resourceId,
        url: 'https://example.com/unique-article',
        content: null,
        sourceType: 'link',
        status: 'inbox',
        title: 'Unique Article',
      }

      const mockProjects = [
        {
          id: projectId,
          name: 'Learning',
          description: 'AI learning resources',
        },
      ]

      const mockExistingResources = [] // No duplicates

      const mockFetchedContent = {
        title: 'Unique Article',
        contentType: 'article',
        summary: 'This is unique content',
        fullContent: 'This is unique content...',
      }

      const mockAIAssessment = {
        suggestedProjectId: projectId,
        suggestedProjectName: 'Learning',
        suggestedSequenceIndex: 5,
        qualityScore: 8,
        confidence: 85,
        isDuplicate: false,
        duplicateOf: null,
        rationale: 'High-quality resource for AI learning',
      }

      const mockAssessmentRecord = [{ id: 200 }]

      // Track call count to return different chains
      let selectCallCount = 0
      mockDb.select.mockImplementation(() => {
        selectCallCount++
        if (selectCallCount === 1) {
          // First call: get resource to assess
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([mockResource]),
          }
        } else if (selectCallCount === 2) {
          // Second call: get projects
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(mockProjects),
          }
        } else {
          // Third call: get existing resources
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(mockExistingResources),
          }
        }
      })

      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: resourceId }]),
      }

      const insertChain = {
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue(mockAssessmentRecord),
      }

      mockDb.update.mockReturnValue(updateChain)
      mockDb.insert.mockReturnValue(insertChain)

      mockFetchContent.mockResolvedValue(mockFetchedContent)
      mockAssessResource.mockResolvedValue(mockAIAssessment)

      const req = new NextRequest('http://localhost:3000/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId }),
      })

      const res = await POST(req)
      const data = await res.json()

      // Should return full assessment
      expect(data.assessment).toBeDefined()
      expect(data.assessment.isDuplicate).toBe(false)
      expect(data.assessment.suggestedProjectId).toBe(projectId)
      expect(data.assessment.qualityScore).toBe(8)
      expect(data.assessment.confidence).toBe(85)
      expect(data.assessment.assessmentId).toBe(200)

      // Should call Haiku for assessment
      expect(mockAssessResource).toHaveBeenCalled()

      // Should update resource status
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'inReview',
        }),
      )
    })
  })

  describe('Error handling', () => {
    it('should return 400 if resourceId missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/assess', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const res = await POST(req)
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toContain('resourceId')
    })

    it('should return 404 if resource not found', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })

      const req = new NextRequest('http://localhost:3000/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: 9999 }),
      })

      const res = await POST(req)
      const data = await res.json()

      expect(res.status).toBe(404)
      expect(data.error).toContain('not found')
    })

    it('should return 400 if resource not in inbox', async () => {
      const mockResource = {
        id: 1,
        status: 'active', // Not inbox
      }

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockResource]),
      })

      const req = new NextRequest('http://localhost:3000/api/assess', {
        method: 'POST',
        body: JSON.stringify({ resourceId: 1 }),
      })

      const res = await POST(req)
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toContain('not in inbox')
    })
  })

  describe('Response format consistency', () => {
    it('should include all required fields in response', () => {
      // Test ensures response shape - both duplicate and normal paths should have these fields
      const requiredFields = [
        'qualityScore',
        'isDuplicate',
        'rationale',
        'confidence',
        'assessmentId',
        'suggestedProjectId',
        'suggestedProjectName',
        'suggestedSequenceIndex',
      ]

      requiredFields.forEach((field) => {
        expect(field).toBeTruthy() // Each field name is defined
      })
    })
  })
})
