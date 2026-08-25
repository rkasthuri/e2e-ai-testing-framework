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

interface TriggerDefinition { name: string; sql: string }

async function suspendTriggers(db: Kysely<any>): Promise<TriggerDefinition[]> {
  const rows = (await sql<TriggerDefinition>`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND sql IS NOT NULL
    ORDER BY name
  `.execute(db)).rows
  for (const row of rows) await sql.raw(`DROP TRIGGER "${row.name.replace(/"/g, '""')}"`).execute(db)
  return rows
}

async function restoreTriggers(db: Kysely<any>, triggers: TriggerDefinition[]): Promise<void> {
  for (const trigger of triggers) await sql.raw(trigger.sql).execute(db)
}

const CREATE_TEST_SETS = `
  CREATE TABLE test_set_revisions_031 (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    test_set_id varchar(255) NOT NULL,
    revision integer NOT NULL,
    project_id varchar(255) NOT NULL,
    generation_id varchar(255) NOT NULL UNIQUE,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version IN (1, 2, 3)),
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
      (schema_version IN (2, 3)
        AND source_observation_id IS NULL
        AND observation_run_id IS NOT NULL
        AND length(support_seal_hash) = 64
        AND support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND characterization_policy_id IS NOT NULL
        AND characterization_policy_version IS NOT NULL)
    )
  )
`

const CREATE_EXECUTIONS = `
  CREATE TABLE executions_031 (
    execution_id varchar(255) NOT NULL PRIMARY KEY,
    project_id varchar(255) NOT NULL,
    accepted_at varchar(50) NOT NULL,
    test_set_id varchar(255) NOT NULL,
    test_set_revision integer NOT NULL CHECK (test_set_revision > 0),
    definition_schema_version integer NOT NULL DEFAULT 1 CHECK (definition_schema_version IN (1, 2, 3)),
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
    execution_intent_key varchar(128) CHECK (execution_intent_key IS NULL OR (
      length(execution_intent_key) BETWEEN 1 AND 128
      AND substr(execution_intent_key, 1, 1) GLOB '[A-Za-z0-9]'
      AND execution_intent_key NOT GLOB '*[^A-Za-z0-9._:-]*'
    )),
    execution_intent_fingerprint varchar(64) CHECK (execution_intent_fingerprint IS NULL OR (
      length(execution_intent_fingerprint) = 64
      AND execution_intent_fingerprint NOT GLOB '*[^a-f0-9]*'
    )),
    CHECK (
      (definition_schema_version = 1 AND source_observation_id IS NOT NULL
        AND support_seal_hash IS NULL AND route_evidence_identity_hash IS NULL
        AND authentication_expectation_identity_hash IS NULL)
      OR
      (definition_schema_version IN (2, 3) AND source_observation_id IS NULL
        AND length(support_seal_hash) = 64 AND support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND length(route_evidence_identity_hash) = 64 AND route_evidence_identity_hash NOT GLOB '*[^a-f0-9]*'
        AND length(authentication_expectation_identity_hash) = 64 AND authentication_expectation_identity_hash NOT GLOB '*[^a-f0-9]*')
    )
  )
`

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 031 is governed for SQLite workspace databases only.')
  }
  await sql`PRAGMA defer_foreign_keys = ON`.execute(db)
  const triggers = await suspendTriggers(db)
  await sql.raw(CREATE_TEST_SETS).execute(db)
  await sql.raw(`INSERT INTO test_set_revisions_031 SELECT * FROM test_set_revisions ORDER BY id`).execute(db)
  await sql`DROP TABLE test_set_revisions`.execute(db)
  await sql`ALTER TABLE test_set_revisions_031 RENAME TO test_set_revisions`.execute(db)
  await sql`CREATE INDEX idx_test_set_project_newest ON test_set_revisions (project_id, revision)`.execute(db)

  await sql.raw(CREATE_EXECUTIONS).execute(db)
  await sql.raw(`INSERT INTO executions_031 SELECT * FROM executions ORDER BY accepted_at, execution_id`).execute(db)
  await sql`DROP TABLE executions`.execute(db)
  await sql`ALTER TABLE executions_031 RENAME TO executions`.execute(db)
  await sql`CREATE INDEX idx_executions_project_accepted ON executions (project_id, accepted_at)`.execute(db)
  await sql.raw(`CREATE UNIQUE INDEX uq_executions_project_intent ON executions (project_id, execution_intent_key) WHERE execution_intent_key IS NOT NULL`).execute(db)
  await restoreTriggers(db, triggers)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 031 is intentionally irreversible because v3 Test Set and Execution authority cannot be safely coerced to v2.')
}
