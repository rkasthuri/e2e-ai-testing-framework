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

export const MIGRATION_034_TRIGGER_DEFINITIONS_V1 = Object.freeze({
  diagnostic_evidence_immutable_update: `CREATE TRIGGER diagnostic_evidence_immutable_update
    BEFORE UPDATE ON diagnostic_evidence BEGIN
      SELECT RAISE(ABORT,'Diagnostic evidence is immutable');
    END`,
  diagnostic_evidence_immutable_delete: `CREATE TRIGGER diagnostic_evidence_immutable_delete
    BEFORE DELETE ON diagnostic_evidence BEGIN
      SELECT RAISE(ABORT,'Diagnostic evidence is immutable');
    END`,
  diagnostic_evidence_authority_insert: `CREATE TRIGGER diagnostic_evidence_authority_insert
    BEFORE INSERT ON diagnostic_evidence WHEN
      NOT EXISTS (
        SELECT 1 FROM executions e JOIN runs r ON r.execution_id=e.execution_id
        JOIN execution_items i ON i.execution_id=e.execution_id AND i.item_ordinal=NEW.item_ordinal
        WHERE e.project_id=NEW.project_id AND e.execution_id=NEW.execution_id
          AND r.run_id=NEW.run_id AND r.origin='product' AND r.app_name=NEW.project_id
          AND i.definition_id=NEW.definition_id AND i.executable_plan_hash=NEW.executable_plan_hash
      ) OR (
        NEW.result_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM test_results t WHERE t.result_id=NEW.result_id AND t.run_id=NEW.run_id
            AND t.execution_item_ordinal=NEW.item_ordinal AND t.definition_id=NEW.definition_id
            AND t.executable_plan_hash=NEW.executable_plan_hash
        )
      ) OR (
        NEW.result_id IS NULL AND (
          EXISTS (SELECT 1 FROM test_results t WHERE t.run_id=NEW.run_id AND t.execution_item_ordinal=NEW.item_ordinal)
          OR NOT EXISTS (SELECT 1 FROM execution_events x WHERE x.project_id=NEW.project_id
            AND x.execution_id=NEW.execution_id AND x.event_type='terminal')
        )
      )
    BEGIN SELECT RAISE(ABORT,'Diagnostic evidence authority mismatch'); END`,
} as const)

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 034 is governed for SQLite workspace databases only.')
  }
  await sql.raw(`CREATE TABLE diagnostic_evidence (
    id integer PRIMARY KEY AUTOINCREMENT,
    evidence_schema_version varchar(80) NOT NULL CHECK(evidence_schema_version='forge.m4.diagnostic-evidence/v1'),
    evidence_hash varchar(64) NOT NULL CHECK(length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^a-f0-9]*'),
    project_id varchar(255) NOT NULL,
    execution_id varchar(255) NOT NULL,
    run_id varchar(255) NOT NULL,
    item_ordinal integer NOT NULL CHECK(item_ordinal>0),
    result_id varchar(255),
    definition_id varchar(255) NOT NULL,
    executable_plan_hash varchar(64) NOT NULL CHECK(length(executable_plan_hash)=64 AND executable_plan_hash NOT GLOB '*[^a-f0-9]*'),
    accepted_definition_authority_json text NOT NULL,
    suite_authority_json text,
    evidence_json text NOT NULL,
    UNIQUE(project_id,execution_id,run_id,item_ordinal,evidence_schema_version),
    UNIQUE(evidence_hash),
    FOREIGN KEY(execution_id,item_ordinal) REFERENCES execution_items(execution_id,item_ordinal) ON DELETE RESTRICT,
    FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE RESTRICT
  )`).execute(db)
  await sql`CREATE INDEX idx_diagnostic_evidence_execution ON diagnostic_evidence(project_id,execution_id,run_id,item_ordinal)`.execute(db)
  for (const definition of Object.values(MIGRATION_034_TRIGGER_DEFINITIONS_V1)) {
    await sql.raw(definition).execute(db)
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 034 is intentionally irreversible.')
}
