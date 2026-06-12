CREATE TABLE "assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"resource_id" integer NOT NULL,
	"suggested_project_id" integer,
	"suggested_project_name" text,
	"suggested_sequence_index" integer,
	"quality_score" integer,
	"is_duplicate" text,
	"rationale" text NOT NULL,
	"user_decision" text DEFAULT 'pending' NOT NULL,
	"user_feedback" text,
	"user_project_id" integer,
	"user_sequence_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"url" text,
	"content" text,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'inbox' NOT NULL,
	"sequence_index" integer,
	"usefulness_score" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "assessments_resource_idx" ON "assessments" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "assessments_user_decision_idx" ON "assessments" USING btree ("user_decision");--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "resources_project_idx" ON "resources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "resources_status_idx" ON "resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "resources_url_idx" ON "resources" USING btree ("url");