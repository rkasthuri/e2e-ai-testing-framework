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

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 028 is governed for SQLite workspace databases only.')
  }

  await sql`ALTER TABLE observation_gaps ADD COLUMN artifact_links_sealed integer NOT NULL DEFAULT 0 CHECK (artifact_links_sealed IN (0, 1))`.execute(db)

  // Every pre-028 Gap is already externally committed. Preserve its evidence
  // without rewriting the integrity hash, then close its current membership.
  await sql`DROP TRIGGER observation_gaps_immutable_update`.execute(db)
  await sql`UPDATE observation_gaps SET artifact_links_sealed = 1`.execute(db)

  await sql.raw(`
    CREATE TRIGGER observation_gaps_immutable_update
    BEFORE UPDATE ON observation_gaps
    BEGIN
      SELECT CASE WHEN NOT (
        OLD.artifact_links_sealed = 0 AND NEW.artifact_links_sealed = 1
        AND NEW.gap_id IS OLD.gap_id
        AND NEW.observation_run_id IS OLD.observation_run_id
        AND NEW.project_id IS OLD.project_id
        AND NEW.producer IS OLD.producer
        AND NEW.producer_version IS OLD.producer_version
        AND NEW.intended_method IS OLD.intended_method
        AND NEW.intended_method_version IS OLD.intended_method_version
        AND NEW.intended_subject_id IS OLD.intended_subject_id
        AND NEW.intended_predicate IS OLD.intended_predicate
        AND NEW.boundary_json IS OLD.boundary_json
        AND NEW.reason IS OLD.reason
        AND NEW.occurred_at IS OLD.occurred_at
        AND NEW.idempotency_key IS OLD.idempotency_key
        AND NEW.integrity_hash IS OLD.integrity_hash
        AND NEW.safe_message IS OLD.safe_message
      ) THEN RAISE(ABORT, 'ObservationGap is immutable') END;
    END
  `).execute(db)

  await sql`DROP TRIGGER observation_artifact_links_closed_insert`.execute(db)
  await sql.raw(`
    CREATE TRIGGER observation_artifact_links_closed_insert
    BEFORE INSERT ON observation_artifact_links
    BEGIN
      SELECT CASE WHEN NEW.observation_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM observations o
        WHERE o.observation_id = NEW.observation_id
          AND o.project_id = NEW.project_id
          AND o.artifact_links_sealed = 1
      ) THEN RAISE(ABORT, 'Observation artifact set is sealed') END;
      SELECT CASE WHEN NEW.gap_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM observation_gaps g
        WHERE g.gap_id = NEW.gap_id
          AND g.project_id = NEW.project_id
      ) THEN RAISE(ABORT, 'ObservationGap artifact membership crosses project authority or references a missing Gap') END;
      SELECT CASE WHEN NEW.gap_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM observation_artifacts a
        WHERE a.artifact_id = NEW.artifact_id
          AND a.project_id = NEW.project_id
      ) THEN RAISE(ABORT, 'ObservationGap artifact membership crosses project authority or references a missing artifact') END;
      SELECT CASE WHEN NEW.gap_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM observation_gaps g
        JOIN observation_artifacts a
          ON a.artifact_id = NEW.artifact_id
          AND a.project_id = NEW.project_id
          AND a.observation_run_id = g.observation_run_id
        WHERE g.gap_id = NEW.gap_id
          AND g.project_id = NEW.project_id
      ) THEN RAISE(ABORT, 'ObservationGap artifact membership crosses ObservationRun authority') END;
      SELECT CASE WHEN NEW.gap_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM observation_gaps g
        WHERE g.gap_id = NEW.gap_id
          AND g.project_id = NEW.project_id
          AND g.artifact_links_sealed = 1
      ) THEN RAISE(ABORT, 'ObservationGap artifact set is sealed') END;
    END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 028 is intentionally irreversible because reopening committed ObservationGap artifact sets would weaken historical provenance.')
}
