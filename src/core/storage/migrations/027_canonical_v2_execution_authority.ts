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

const CREATE_EXECUTIONS = `
  CREATE TABLE executions_027 (
    execution_id varchar(255) NOT NULL PRIMARY KEY,
    project_id varchar(255) NOT NULL,
    accepted_at varchar(50) NOT NULL,
    test_set_id varchar(255) NOT NULL,
    test_set_revision integer NOT NULL CHECK (test_set_revision > 0),
    definition_schema_version integer NOT NULL DEFAULT 1 CHECK (definition_schema_version IN (1, 2)),
    model_row_id integer NOT NULL CHECK (model_row_id > 0),
    model_version varchar(50) NOT NULL,
    source_observation_id varchar(255),
    support_seal_hash varchar(64),
    route_evidence_identity_hash varchar(64),
    authentication_expectation_identity_hash varchar(64),
    manifest_hash varchar(64) NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
    max_run_attempts integer NOT NULL CHECK (max_run_attempts > 0),
    dispatch_mode varchar(20) NOT NULL CHECK (dispatch_mode = 'serial'),
    stop_rule varchar(50) NOT NULL CHECK (stop_rule = 'stop_on_first_non_completed'),
    CHECK (
      (definition_schema_version = 1 AND source_observation_id IS NOT NULL
        AND support_seal_hash IS NULL AND route_evidence_identity_hash IS NULL
        AND authentication_expectation_identity_hash IS NULL)
      OR
      (definition_schema_version = 2 AND source_observation_id IS NULL
        AND length(support_seal_hash) = 64 AND support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND length(route_evidence_identity_hash) = 64 AND route_evidence_identity_hash NOT GLOB '*[^a-f0-9]*'
        AND length(authentication_expectation_identity_hash) = 64 AND authentication_expectation_identity_hash NOT GLOB '*[^a-f0-9]*')
    )
  )
`

interface TriggerDefinition { name: string; sql: string }

async function suspendTriggers(db: Kysely<any>): Promise<TriggerDefinition[]> {
  const rows = (await sql<TriggerDefinition>`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name`.execute(db)).rows
  for (const row of rows) await sql.raw(`DROP TRIGGER "${row.name.replace(/"/g, '""')}"`).execute(db)
  return rows
}

async function restoreTriggers(db: Kysely<any>, triggers: TriggerDefinition[]): Promise<void> {
  for (const trigger of triggers) await sql.raw(trigger.sql).execute(db)
}

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') throw new Error('Migration 027 is governed for SQLite workspace databases only.')
  await sql`PRAGMA defer_foreign_keys = ON`.execute(db)
  const triggers = await suspendTriggers(db)
  await sql.raw(CREATE_EXECUTIONS).execute(db)
  await sql.raw(`
    INSERT INTO executions_027 (
      execution_id, project_id, accepted_at, test_set_id, test_set_revision,
      definition_schema_version, model_row_id, model_version, source_observation_id,
      support_seal_hash, route_evidence_identity_hash, authentication_expectation_identity_hash,
      manifest_hash, max_run_attempts, dispatch_mode, stop_rule
    ) SELECT execution_id, project_id, accepted_at, test_set_id, test_set_revision,
      1, model_row_id, model_version, source_observation_id, NULL, NULL, NULL,
      manifest_hash, max_run_attempts, dispatch_mode, stop_rule FROM executions
  `).execute(db)
  await sql`DROP TABLE executions`.execute(db)
  await sql`ALTER TABLE executions_027 RENAME TO executions`.execute(db)
  await sql`CREATE INDEX idx_executions_project_accepted ON executions (project_id, accepted_at)`.execute(db)
  await restoreTriggers(db, triggers)
}

export async function down(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') throw new Error('Migration 027 rollback is governed for SQLite workspace databases only.')
  const v2 = await sql<{ count: number }>`SELECT COUNT(*) AS count FROM executions WHERE definition_schema_version = 2`.execute(db)
  if (Number(v2.rows[0]?.count ?? 0) !== 0) throw new Error('Migration 027 cannot roll back while v2 Execution roots exist.')
  await sql`PRAGMA defer_foreign_keys = ON`.execute(db)
  const triggers = await suspendTriggers(db)
  await sql.raw(`
    CREATE TABLE executions_026 (
      execution_id varchar(255) NOT NULL PRIMARY KEY, project_id varchar(255) NOT NULL,
      accepted_at varchar(50) NOT NULL, test_set_id varchar(255) NOT NULL,
      test_set_revision integer NOT NULL CHECK (test_set_revision > 0),
      model_row_id integer NOT NULL CHECK (model_row_id > 0), model_version varchar(50) NOT NULL,
      source_observation_id varchar(255) NOT NULL,
      manifest_hash varchar(64) NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
      max_run_attempts integer NOT NULL CHECK (max_run_attempts > 0),
      dispatch_mode varchar(20) NOT NULL CHECK (dispatch_mode = 'serial'),
      stop_rule varchar(50) NOT NULL CHECK (stop_rule = 'stop_on_first_non_completed')
    )
  `).execute(db)
  await sql.raw(`INSERT INTO executions_026 SELECT execution_id, project_id, accepted_at, test_set_id, test_set_revision, model_row_id, model_version, source_observation_id, manifest_hash, max_run_attempts, dispatch_mode, stop_rule FROM executions`).execute(db)
  await sql`DROP TABLE executions`.execute(db)
  await sql`ALTER TABLE executions_026 RENAME TO executions`.execute(db)
  await sql`CREATE INDEX idx_executions_project_accepted ON executions (project_id, accepted_at)`.execute(db)
  await restoreTriggers(db, triggers)
}
