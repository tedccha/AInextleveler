/**
 * Higher-level helper: load capability map + queue items from DB,
 * compute rank_scores via lib/rank.ts, and write them back. Used by
 * /api/rerank (bulk) and /api/queue/promote (single-item, on insert).
 *
 * Lives here rather than inline in routes because it's the same data
 * pull both routes need.
 */

import { db, schema } from '@/lib/db/client'
import { eq, inArray, sql, type SQL } from 'drizzle-orm'
import { type Capability, type Theme } from '@/lib/taxonomy'
import { computeRankScore, type GapCandidate } from '@/lib/rank'

export type RankContext = {
  haveOrPartial: Capability[]
  missingOrPartial: GapCandidate[]
}

/**
 * Single DB roundtrip; all callers get the same snapshot.
 */
export async function loadRankContext(): Promise<RankContext> {
  const rows = await db.select().from(schema.capabilities)
  const haveOrPartial: Capability[] = []
  const missingOrPartial: GapCandidate[] = []
  for (const r of rows) {
    const cap: Capability = { theme: r.theme as Theme, name: r.name }
    if (r.status === 'have' || r.status === 'partial') {
      haveOrPartial.push(cap)
    }
    if (r.status === 'missing' || r.status === 'partial') {
      missingOrPartial.push({ capability: cap, embedding: r.embedding })
    }
  }
  return { haveOrPartial, missingOrPartial }
}

/**
 * Days since a date. Used for recency decay. Returns 0 for future dates
 * (defensive — shouldn't happen, but won't break math if it does).
 */
export function daysSince(date: Date): number {
  const ms = Date.now() - date.getTime()
  return Math.max(0, ms / (1000 * 60 * 60 * 24))
}

export type SingleRankInput = {
  resourceId: number
  contentEmbedding: number[] | null
  prerequisites: Capability[]
  addedAt: Date
}

/**
 * Compute rank for one resource. Used by promote on insert.
 */
export function rankSingle(
  ctx: RankContext,
  input: SingleRankInput,
): number {
  const { rankScore } = computeRankScore({
    contentEmbedding: input.contentEmbedding,
    prerequisites: input.prerequisites,
    haveOrPartial: ctx.haveOrPartial,
    missingOrPartial: ctx.missingOrPartial,
    daysSinceAdded: daysSince(input.addedAt),
  })
  return rankScore
}

/**
 * Bulk re-rank: recompute rank_score for every queue_items row whose
 * status is in_progress or queued (completed items keep their last
 * rank — they're sorted separately on /next).
 *
 * Returns { updated, unchanged } so the route can show the user how
 * many cards moved.
 */
export async function rerankAll(): Promise<{
  updated: number
  unchanged: number
}> {
  const ctx = await loadRankContext()

  // Pull active queue items with their resource data (single join via two queries).
  const queueRows = await db
    .select()
    .from(schema.queueItems)
    .where(
      sql`${schema.queueItems.status} IN ('queued', 'in_progress')` as SQL,
    )
  if (queueRows.length === 0) return { updated: 0, unchanged: 0 }

  const resourceIds = queueRows.map((r) => r.resourceId)
  const resourceRows = await db
    .select({
      id: schema.resources.id,
      contentEmbedding: schema.resources.contentEmbedding,
      prerequisites: schema.resources.prerequisites,
      addedAt: schema.resources.addedAt,
    })
    .from(schema.resources)
    .where(inArray(schema.resources.id, resourceIds))
  const resourceMap = new Map(resourceRows.map((r) => [r.id, r]))

  let updated = 0
  let unchanged = 0
  for (const q of queueRows) {
    const resource = resourceMap.get(q.resourceId)
    if (!resource) {
      // Orphaned queue item (resource deleted) — skip, leave rank as-is.
      unchanged++
      continue
    }
    const newScore = rankSingle(ctx, {
      resourceId: q.resourceId,
      contentEmbedding: resource.contentEmbedding,
      prerequisites: (resource.prerequisites as Capability[]) ?? [],
      addedAt: resource.addedAt,
    })
    // Compare with small epsilon — Voyage embeddings produce floats.
    if (Math.abs((q.rankScore ?? 0) - newScore) < 1e-6) {
      unchanged++
      continue
    }
    await db
      .update(schema.queueItems)
      .set({ rankScore: newScore })
      .where(eq(schema.queueItems.id, q.id))
    updated++
  }
  return { updated, unchanged }
}
