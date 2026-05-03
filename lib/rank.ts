/**
 * Queue ranking — pure function, no I/O.
 *
 *   Formula (locked in eng review F1):
 *
 *     rank_score = gap_overlap * 0.5 + prereqs_met * 0.3 + recency * 0.2
 *
 *     gap_overlap = max cosine sim between content_embedding and any
 *                   capability embedding where status IN ('missing','partial')
 *                   AND embedding IS NOT NULL.
 *                   Returns 0 (NOT NaN) when:
 *                     - content_embedding is null (Voyage was down at paste)
 *                     - candidate set is empty (no Missing/Partial caps with embeddings)
 *
 *     prereqs_met = 1 if every {theme, name} in resource.prerequisites
 *                   exact-matches a user capability with status IN
 *                   ('have','partial'); else 0. Empty prerequisites → 1.
 *
 *     recency     = clamp(1 - days_since_added/90, 0, 1)
 *                   Newer items rank higher. After 90 days, contribution = 0.
 *
 *   F1 fix (eng review critical gap): never return NaN. An empty
 *   capability map or null content embedding means gap_overlap = 0,
 *   which lets the rest of the score still rank items reasonably (by
 *   prereqs_met and recency). With NaN, the entire sort breaks silently.
 */

import type { Capability } from '@/lib/taxonomy'

export type GapCandidate = {
  capability: Capability
  embedding: number[] | null
}

export type RankInputs = {
  /** Resource's content embedding. null when Voyage was unavailable on paste. */
  contentEmbedding: number[] | null
  /** From resource.prerequisites — what user must already Have/Partial. */
  prerequisites: Capability[]
  /** User capabilities with status IN ('have','partial'). */
  haveOrPartial: Capability[]
  /**
   * Capabilities with status IN ('missing','partial') — these are gaps
   * the resource might fill. Filter null embeddings out before passing
   * (or pass them; we filter again defensively).
   */
  missingOrPartial: GapCandidate[]
  /** Days since the resource was added. Used for recency decay. */
  daysSinceAdded: number
}

export type RankBreakdown = {
  rankScore: number
  gapOverlap: number
  prereqsMet: 0 | 1
  recency: number
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Returns NaN if either is empty or lengths mismatch — caller must
 * filter such cases. We never let NaN escape this module via the
 * public computeRankScore() which guards against null inputs.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return NaN
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return NaN
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * gap_overlap: how well does this resource's content cover the user's
 * Missing/Partial capabilities? Max cosine sim across the candidate set.
 *
 * Returns 0 (not NaN) for the F1 cases:
 *   - null content embedding
 *   - empty candidate set
 *   - all candidates have null embeddings
 */
function computeGapOverlap(
  content: number[] | null,
  gaps: GapCandidate[],
): number {
  if (!content || content.length === 0) return 0
  let max = 0
  for (const g of gaps) {
    if (!g.embedding || g.embedding.length === 0) continue
    const sim = cosineSimilarity(content, g.embedding)
    if (Number.isFinite(sim) && sim > max) max = sim
  }
  return max
}

/**
 * prereqs_met: does the user already have every prerequisite capability
 * the resource lists? Exact match on {theme, name}. Empty prereqs → met.
 */
function computePrereqsMet(
  prerequisites: Capability[],
  haveOrPartial: Capability[],
): 0 | 1 {
  if (prerequisites.length === 0) return 1
  const have = new Set(haveOrPartial.map((c) => `${c.theme}|${c.name}`))
  for (const p of prerequisites) {
    if (!have.has(`${p.theme}|${p.name}`)) return 0
  }
  return 1
}

/**
 * recency: linear decay from 1 (just added) to 0 (90+ days old).
 */
function computeRecency(daysSinceAdded: number): number {
  if (daysSinceAdded <= 0) return 1
  if (daysSinceAdded >= 90) return 0
  return 1 - daysSinceAdded / 90
}

/**
 * Public entry point. Always returns a finite number in [0, 1].
 */
export function computeRankScore(inputs: RankInputs): RankBreakdown {
  const gapOverlap = computeGapOverlap(
    inputs.contentEmbedding,
    inputs.missingOrPartial,
  )
  const prereqsMet = computePrereqsMet(inputs.prerequisites, inputs.haveOrPartial)
  const recency = computeRecency(inputs.daysSinceAdded)
  const rankScore = gapOverlap * 0.5 + prereqsMet * 0.3 + recency * 0.2
  // Defensive — final guard so callers never see NaN even on bad inputs.
  return {
    rankScore: Number.isFinite(rankScore) ? rankScore : 0,
    gapOverlap: Number.isFinite(gapOverlap) ? gapOverlap : 0,
    prereqsMet,
    recency: Number.isFinite(recency) ? recency : 0,
  }
}

/**
 * Helper for callers who just want the score and don't care about the
 * breakdown. Same guarantees as computeRankScore().
 */
export function rankScore(inputs: RankInputs): number {
  return computeRankScore(inputs).rankScore
}

// Test-only export for unit tests.
export const __test = {
  cosineSimilarity,
  computeGapOverlap,
  computePrereqsMet,
  computeRecency,
}
