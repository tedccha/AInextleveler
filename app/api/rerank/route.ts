/**
 * POST /api/rerank — recompute rank_score for every queued/in-progress
 * queue_items row using the current capability map. Per locked plan:
 * does NOT re-fetch from GitHub or re-embed. Pure DB → compute → DB write.
 *
 * Returns JSON `{ updated, unchanged }` for the toast on /next.
 */

import { NextResponse } from 'next/server'
import { withSession } from '@/lib/auth'
import { rerankAll } from '@/lib/rank-queue'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = withSession(async () => {
  try {
    const result = await rerankAll()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'rerank failed',
      },
      { status: 500 },
    )
  }
})
