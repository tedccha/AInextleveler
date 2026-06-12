/**
 * POST /api/extract-pdf — extract PDF to markdown
 *
 * Body: multipart/form-data with 'file' field containing PDF
 * Returns: { markdown: string }
 */

import { withSession } from '@/lib/auth'
import { extractPdfToMarkdown } from '@/lib/extract-pdf'

export const runtime = 'nodejs'
export const maxDuration = 120

export const POST = withSession(async (req) => {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json(
        { message: 'No file provided' },
        { status: 400 },
      )
    }

    if (!file.type.includes('pdf')) {
      return Response.json(
        { message: 'File must be a PDF' },
        { status: 400 },
      )
    }

    const buffer = await file.arrayBuffer()
    const markdown = await extractPdfToMarkdown(Buffer.from(buffer))

    return Response.json({
      markdown,
    })
  } catch (err) {
    console.error('PDF extraction error:', err)
    return Response.json(
      {
        message:
          err instanceof Error
            ? err.message
            : 'PDF extraction failed',
      },
      { status: 500 },
    )
  }
})
