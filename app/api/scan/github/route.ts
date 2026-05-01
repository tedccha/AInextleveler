/**
 * POST /api/scan/github — runs a GitHub capability scan, streams progress via SSE.
 *
 * Per eng review A2: explicit nodejs runtime (this route reads the GitHub
 * API + writes to Postgres + calls Anthropic + Voyage). Edge would break.
 */

import { withSession } from '@/lib/auth'
import { scanGitHub, type ScanEvent } from '@/lib/scan/github'

export const runtime = 'nodejs'
// Long-running stream — disable Next's response timeout for this route.
export const maxDuration = 600

function frame(event: ScanEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const POST = withSession(async () => {
  const token = process.env.GITHUB_TOKEN
  if (!token || token === 'ghp_replace_me') {
    return new Response(
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        message: 'GITHUB_TOKEN not set in .env',
      })}\n\n`,
      {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      try {
        for await (const event of scanGitHub({ token })) {
          controller.enqueue(enc.encode(frame(event)))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        controller.enqueue(
          enc.encode(frame({ type: 'error', message: msg })),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable Next.js response buffering for SSE.
      'x-accel-buffering': 'no',
    },
  })
})
