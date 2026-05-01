-- Run after `bun run db:push`.
-- Drizzle Kit doesn't (yet) emit pgvector extension or HNSW index DDL,
-- so this file fills the gap. Idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS capabilities_embedding_hnsw_idx
  ON capabilities USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS resources_content_embedding_hnsw_idx
  ON resources USING hnsw (content_embedding vector_cosine_ops);
