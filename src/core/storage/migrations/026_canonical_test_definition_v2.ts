/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

import { Kysely, sql } from 'kysely'
import { currentMigrationDialect } from '../MigrationContext'

const CREATE_V2_TABLE = `
  CREATE TABLE test_set_revisions_026 (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    test_set_id varchar(255) NOT NULL,
    revision integer NOT NULL,
    project_id varchar(255) NOT NULL,
    generation_id varchar(255) NOT NULL UNIQUE,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version IN (1, 2)),
    source_observation_id varchar(255),
    model_row_id integer NOT NULL,
    model_version varchar(50) NOT NULL,
    observation_run_id varchar(255),
    support_seal_hash varchar(64),
    characterization_policy_id varchar(255),
    characterization_policy_version varchar(100),
    generated_at varchar(50) NOT NULL,
    outcome varchar(50) NOT NULL,
    definition_count integer NOT NULL,
    payload_json text NOT NULL,
    content_hash varchar(64) NOT NULL,
    CONSTRAINT uq_test_set_project_revision UNIQUE (project_id, revision),
    CHECK (
      (schema_version = 1
        AND source_observation_id IS NOT NULL
        AND observation_run_id IS NULL
        AND support_seal_hash IS NULL
        AND characterization_policy_id IS NULL
        AND characterization_policy_version IS NULL)
      OR
      (schema_version = 2
        AND source_observation_id IS NULL
        AND observation_run_id IS NOT NULL
        AND length(support_seal_hash) = 64
        AND support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND characterization_policy_id IS NOT NULL
        AND characterization_policy_version IS NOT NULL)
    )
  )
`

const CREATE_V1_TABLE = `
  CREATE TABLE test_set_revisions_025 (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    test_set_id varchar(255) NOT NULL,
    revision integer NOT NULL,
    project_id varchar(255) NOT NULL,
    generation_id varchar(255) NOT NULL UNIQUE,
    source_observation_id varchar(255) NOT NULL,
    model_row_id integer NOT NULL,
    model_version varchar(50) NOT NULL,
    generated_at varchar(50) NOT NULL,
    outcome varchar(50) NOT NULL,
    definition_count integer NOT NULL,
    payload_json text NOT NULL,
    content_hash varchar(64) NOT NULL,
    CONSTRAINT uq_test_set_project_revision UNIQUE (project_id, revision)
  )
`

async function createImmutabilityGuards(db: Kysely<any>): Promise<void> {
  await sql.raw(`CREATE TRIGGER test_set_revisions_immutable_update BEFORE UPDATE ON test_set_revisions BEGIN SELECT RAISE(ABORT, 'Test Set revision is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER test_set_revisions_immutable_delete BEFORE DELETE ON test_set_revisions BEGIN SELECT RAISE(ABORT, 'Test Set revision is immutable'); END`).execute(db)
}

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 026 is governed for SQLite workspace databases only.')
  }
  await sql.raw(CREATE_V2_TABLE).execute(db)
  await sql.raw(`
    INSERT INTO test_set_revisions_026 (
      id, test_set_id, revision, project_id, generation_id, schema_version,
      source_observation_id, model_row_id, model_version,
      observation_run_id, support_seal_hash, characterization_policy_id,
      characterization_policy_version, generated_at, outcome, definition_count,
      payload_json, content_hash
    )
    SELECT id, test_set_id, revision, project_id, generation_id, 1,
      source_observation_id, model_row_id, model_version,
      NULL, NULL, NULL, NULL, generated_at, outcome, definition_count,
      payload_json, content_hash
    FROM test_set_revisions
    ORDER BY id
  `).execute(db)
  await sql`DROP TABLE test_set_revisions`.execute(db)
  await sql`ALTER TABLE test_set_revisions_026 RENAME TO test_set_revisions`.execute(db)
  await sql`CREATE INDEX idx_test_set_project_newest ON test_set_revisions (project_id, revision)`.execute(db)
  await createImmutabilityGuards(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 026 rollback is governed for SQLite workspace databases only.')
  }
  const v2 = await sql<{ count: number }>`SELECT COUNT(*) AS count FROM test_set_revisions WHERE schema_version = 2`.execute(db)
  if (Number(v2.rows[0]?.count ?? 0) !== 0) {
    throw new Error('Migration 026 cannot roll back while v2 Test Set revisions exist.')
  }
  await sql`DROP TRIGGER IF EXISTS test_set_revisions_immutable_update`.execute(db)
  await sql`DROP TRIGGER IF EXISTS test_set_revisions_immutable_delete`.execute(db)
  await sql.raw(CREATE_V1_TABLE).execute(db)
  await sql.raw(`
    INSERT INTO test_set_revisions_025 (
      id, test_set_id, revision, project_id, generation_id,
      source_observation_id, model_row_id, model_version, generated_at,
      outcome, definition_count, payload_json, content_hash
    )
    SELECT id, test_set_id, revision, project_id, generation_id,
      source_observation_id, model_row_id, model_version, generated_at,
      outcome, definition_count, payload_json, content_hash
    FROM test_set_revisions
    ORDER BY id
  `).execute(db)
  await sql`DROP TABLE test_set_revisions`.execute(db)
  await sql`ALTER TABLE test_set_revisions_025 RENAME TO test_set_revisions`.execute(db)
  await sql`CREATE INDEX idx_test_set_project_newest ON test_set_revisions (project_id, revision)`.execute(db)
}
