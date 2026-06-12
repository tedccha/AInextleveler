import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

/**
 * Projects: User-created project areas for AI infrastructure/upleveling
 * Examples: "Setup a Claw", "Implement self-improvement", "Optimize Memory"
 */
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(), // Required for AI matching
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    nameIdx: index('projects_name_idx').on(t.name),
  }),
)

/**
 * Resources: Links, GitHub repos, pasted text/code to ingest
 * Workflow: inbox -> inReview -> active -> completed -> archived
 *           or: inbox -> inReview -> rejected -> archived
 */
export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id'),
    title: text('title').notNull(),
    url: text('url'), // null for pasted text/code
    content: text('content'), // For pasted text, or summary of URL content
    sourceType: text('source_type', {
      enum: ['link', 'github', 'pastedText', 'upload'],
    }).notNull(),
    status: text('status', {
      enum: ['inbox', 'inReview', 'active', 'completed', 'rejected', 'archived'],
    })
      .notNull()
      .default('inbox'),
    sequenceIndex: integer('sequence_index'), // Order within project
    usefulnessScore: integer('usefulness_score'), // 1-5, set on completion
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index('resources_project_idx').on(t.projectId),
    statusIdx: index('resources_status_idx').on(t.status),
    urlIdx: index('resources_url_idx').on(t.url),
  }),
)

/**
 * Assessments: Audit trail of AI suggestions and user feedback
 * Helps the assessment agent learn what the user values
 */
export const assessments = pgTable(
  'assessments',
  {
    id: serial('id').primaryKey(),
    resourceId: integer('resource_id').notNull(),
    suggestedProjectId: integer('suggested_project_id'),
    suggestedProjectName: text('suggested_project_name'), // If new project suggested
    suggestedSequenceIndex: integer('suggested_sequence_index'),
    qualityScore: integer('quality_score'), // 1-10, AI's assessment
    isDuplicate: text('is_duplicate'), // "no" | "projectId:resourceId"
    rationale: text('rationale').notNull(), // Why AI made this suggestion
    userDecision: text('user_decision', {
      enum: ['accept', 'override', 'reject', 'pending'],
    })
      .notNull()
      .default('pending'),
    userFeedback: text('user_feedback'), // User's reasoning for override/reject
    userProjectId: integer('user_project_id'), // If user overrode
    userSequenceIndex: integer('user_sequence_index'), // If user overrode sequence
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => ({
    resourceIdx: index('assessments_resource_idx').on(t.resourceId),
    userDecisionIdx: index('assessments_user_decision_idx').on(t.userDecision),
  }),
)
