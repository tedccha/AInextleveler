import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  real,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/pg-core'
import type { Capability, Theme } from '@/lib/taxonomy'

/**
 * pgvector custom column. drizzle-orm's vector helper varies across
 * versions — using customType keeps this stable and explicit.
 *
 * 1024 dims to match Voyage-3 output. HNSW index on each vector column
 * is created via raw SQL after `db:push` (see lib/db/setup.sql).
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)'
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .map((s) => Number(s))
  },
})

/**
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  capabilities                                                │
 *   │  ────────────                                                │
 *   │  One row per (theme, name) pair from lib/taxonomy.ts.        │
 *   │  status reflects the user's current level — derived from    │
 *   │  GitHub repo evidence + manual override.                     │
 *   │                                                              │
 *   │  effective_weight = base_weight * recency_decay              │
 *   │  (>6mo old repos halve, infra never decays)                  │
 *   │                                                              │
 *   │  embedding = Voyage-3(capabilityEmbedString(...))            │
 *   │  null when Voyage was down at scan time — backfill button.  │
 *   └──────────────────────────────────────────────────────────────┘
 */
export const capabilities = pgTable(
  'capabilities',
  {
    id: serial('id').primaryKey(),
    theme: text('theme').notNull().$type<Theme>(),
    name: text('name').notNull(),
    status: text('status', { enum: ['have', 'partial', 'missing'] })
      .notNull()
      .default('missing'),
    effectiveWeight: real('effective_weight').notNull().default(0),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    manualOverride: boolean('manual_override').notNull().default(false),
    embedding: vector('embedding'),
  },
  (t) => ({
    // (theme, name) is the natural key. Prevents duplicates across re-scans.
    uniqThemeName: uniqueIndex('capabilities_theme_name_uq').on(
      t.theme,
      t.name,
    ),
  }),
)

/**
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  repos                                                       │
 *   │  ─────                                                       │
 *   │  One row per scanned GitHub repo. Forks excluded at scan     │
 *   │  time (eng review — simple version). capabilities_json is    │
 *   │  Sonnet's raw extraction output, kept as audit trail.        │
 *   └──────────────────────────────────────────────────────────────┘
 */
export const repos = pgTable(
  'repos',
  {
    id: serial('id').primaryKey(),
    githubUrl: text('github_url').notNull(),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    capabilitiesJson: jsonb('capabilities_json').$type<{
      capabilities: Capability[]
      lastCommitDate: string | null
      stack: string[]
    }>(),
  },
  (t) => ({
    uniqUrl: uniqueIndex('repos_github_url_uq').on(t.githubUrl),
  }),
)

/**
 * LessonStep — a single ordered step in a lesson plan. Stored as JSONB
 * arrays on resources.lesson_plan (Haiku's not_yet plan) and
 * queue_items.lesson_plan (Sonnet's keep-on-promote plan, or inherited
 * from resources for not_yet promotes). Per design review:
 *   - 'capability': "first reach Have/Partial on Theme > Sub-cap"
 *   - 'resource':   "consume an existing library item first" (Sonnet only)
 *   - 'doing':      "build/read/practice X yourself"
 */
export type LessonStep = {
  order: number
  title: string
  type: 'capability' | 'resource' | 'doing'
  capability?: Capability
  resourceId?: number
  description: string
  estimatedEffort: 'S' | 'M' | 'L'
  done: boolean
}

/**
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  resources                                                   │
 *   │  ─────────                                                   │
 *   │  One row per pasted item (URL or text). UNIQUE(url) prevents │
 *   │  re-evaluating the same URL — UI surfaces "already evaluated"│
 *   │  banner.                                                     │
 *   │                                                              │
 *   │  capabilities_taught + prerequisites: JSONB arrays of        │
 *   │  {theme, name} objects per the lifecycle taxonomy.           │
 *   │                                                              │
 *   │  content_embedding = null when Voyage was down — backfill    │
 *   │  button covers both this and capabilities.embedding.        │
 *   └──────────────────────────────────────────────────────────────┘
 */
export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    url: text('url'),
    contentText: text('content_text').notNull(), // capped to 4000 chars at write time
    verdict: text('verdict', {
      enum: ['keep', 'skip', 'already_have', 'not_yet', 'needs_review'],
    }).notNull(),
    capabilitiesTaught: jsonb('capabilities_taught')
      .$type<Capability[]>()
      .notNull()
      .default([]),
    prerequisites: jsonb('prerequisites')
      .$type<Capability[]>()
      .notNull()
      .default([]),
    verdictReason: text('verdict_reason'),
    reviewPrompt: text('review_prompt'), // populated when verdict='needs_review'
    /**
     * Haiku-emitted lesson plan for verdict='not_yet'. null otherwise.
     * Inherited by queue_items on promote (overwritten by Sonnet's
     * keep-on-promote plan if verdict was keep at promote time).
     */
    lessonPlan: jsonb('lesson_plan').$type<LessonStep[]>().default([]).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    contentEmbedding: vector('content_embedding'),
  },
  (t) => ({
    // url is nullable (plain-text pastes have none), but when present must be unique.
    // Postgres treats NULLs as distinct in unique indexes by default — that's the behavior we want.
    uniqUrl: uniqueIndex('resources_url_uq').on(t.url),
    verdictIdx: index('resources_verdict_idx').on(t.verdict),
  }),
)

/**
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  queue_items                                                 │
 *   │  ───────────                                                 │
 *   │  User-promoted resources. lesson_plan is the killer feature: │
 *   │  ordered checklist that gets the user from current state to  │
 *   │  ready-to-tackle-this-resource.                              │
 *   │                                                              │
 *   │  status state machine:                                       │
 *   │    queued ──Start──▶ in_progress ──all-checked──▶ completed │
 *   │                          │                            │      │
 *   │                          └──Abandon (>7d)──────▶ queued     │
 *   │                                                              │
 *   │    in_progress ──any-step-checked──▶ stays in_progress      │
 *   │    completed ──Reopen──▶ in_progress (un-checks last step)  │
 *   └──────────────────────────────────────────────────────────────┘
 */
export const queueItems = pgTable(
  'queue_items',
  {
    id: serial('id').primaryKey(),
    resourceId: serial('resource_id').notNull(),
    rankScore: real('rank_score').notNull().default(0),
    status: text('status', {
      enum: ['queued', 'in_progress', 'completed'],
    })
      .notNull()
      .default('queued'),
    primaryTheme: text('primary_theme').$type<Theme>(),
    whyNow: text('why_now'),
    lessonPlan: jsonb('lesson_plan').$type<LessonStep[]>().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('queue_items_status_idx').on(t.status),
    rankIdx: index('queue_items_rank_idx').on(t.rankScore),
  }),
)

export type Capability_ = Capability // re-export for callers that import schema only
export type DBResource = typeof resources.$inferSelect
export type DBCapability = typeof capabilities.$inferSelect
export type DBQueueItem = typeof queueItems.$inferSelect
export type DBRepo = typeof repos.$inferSelect
