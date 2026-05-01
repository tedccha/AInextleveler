/**
 * POST /api/scan/infrastructure — runs the local filesystem scan, streams
 * progress via SSE.
 *
 * Per eng review A2: explicit nodejs runtime (this route reads the
 * filesystem). Per A8: every path goes through realpath() validation
 * inside lib/scan/infrastructure.ts.
 */

import { withSession } from '@/lib/auth'
import { scanInfrastructure, type InfraScanEvent } from '@/lib/scan/infrastructure'

export const runtime = 'nodejs'
export const maxDuration = 300

function frame(event: InfraScanEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export const POST = withSession(async () => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      try {
        for await (const event of scanInfrastructure()) {
          controller.enqueue(enc.encode(frame(event)))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        controller.enqueue(enc.encode(frame({ type: 'error', message: msg })))
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
      'x-accel-buffering': 'no',
    },
  })
})
