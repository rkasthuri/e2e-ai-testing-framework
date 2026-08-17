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

/** Adds only bounded oracle identity; raw executor material is excluded. */
export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 029 is governed for SQLite workspace databases only.')
  }
  await sql`ALTER TABLE execution_items ADD COLUMN oracle_kind text CHECK (oracle_kind IS NULL OR oracle_kind = 'subject_observable')`.execute(db)
  await sql`ALTER TABLE execution_items ADD COLUMN oracle_subject_id varchar(255)`.execute(db)
  await sql`ALTER TABLE test_results ADD COLUMN oracle_kind text CHECK (oracle_kind IS NULL OR oracle_kind = 'subject_observable')`.execute(db)
  await sql`ALTER TABLE test_results ADD COLUMN observed_subject_id varchar(255)`.execute(db)

  await sql.raw(`
    CREATE TRIGGER canonical_execution_item_oracle_insert
    BEFORE INSERT ON execution_items
    BEGIN
      SELECT CASE WHEN (NEW.oracle_kind IS NULL) <> (NEW.oracle_subject_id IS NULL)
      THEN RAISE(ABORT, 'Execution item oracle authority is incomplete') END;
      SELECT CASE WHEN NEW.oracle_kind IS NOT NULL
        AND (NEW.oracle_kind IS NOT 'subject_observable'
          OR length(NEW.oracle_subject_id) < 1 OR length(NEW.oracle_subject_id) > 255
          OR substr(NEW.oracle_subject_id, 1, 1) NOT GLOB '[A-Za-z0-9]'
          OR NEW.oracle_subject_id GLOB '*[^A-Za-z0-9._:-]*')
      THEN RAISE(ABORT, 'Execution item oracle authority is malformed') END;
    END
  `).execute(db)

  await sql.raw(`
    CREATE TRIGGER canonical_result_detail_insert
    BEFORE INSERT ON test_results
    BEGIN
      SELECT CASE WHEN NEW.result_id IS NULL
        AND (NEW.oracle_kind IS NOT NULL OR NEW.observed_subject_id IS NOT NULL)
      THEN RAISE(ABORT, 'Legacy Result cannot claim canonical detail') END;
      SELECT CASE WHEN NEW.result_id IS NOT NULL
        AND ((NEW.oracle_kind IS NULL) <> (NEW.observed_subject_id IS NULL))
      THEN RAISE(ABORT, 'Canonical Result detail is incomplete') END;
      SELECT CASE WHEN NEW.result_id IS NOT NULL AND NEW.oracle_kind IS NOT NULL
        AND (NEW.oracle_kind IS NOT 'subject_observable'
          OR length(NEW.observed_subject_id) < 1 OR length(NEW.observed_subject_id) > 255
          OR substr(NEW.observed_subject_id, 1, 1) NOT GLOB '[A-Za-z0-9]'
          OR NEW.observed_subject_id GLOB '*[^A-Za-z0-9._:-]*')
      THEN RAISE(ABORT, 'Canonical Result detail is malformed or lacks Product Run authority') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER canonical_result_detail_performed_insert
    BEFORE INSERT ON test_results
    WHEN NEW.result_id IS NOT NULL AND NEW.oracle_kind IS NOT NULL AND NEW.observed_subject_id IS NOT NULL
      AND NOT ((NEW.status IS 'passed' AND NEW.error_msg IS 'completed')
        OR (NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed'))
    BEGIN SELECT RAISE(ABORT, 'Canonical Result oracle was not performed'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER canonical_result_detail_subject_insert
    BEFORE INSERT ON test_results
    WHEN NEW.result_id IS NOT NULL AND NEW.oracle_kind IS NOT NULL AND NEW.observed_subject_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM runs r
        JOIN execution_items i
          ON i.execution_id = r.execution_id
         AND i.item_ordinal = NEW.execution_item_ordinal
        WHERE r.run_id = NEW.run_id
          AND r.origin = 'product'
          AND i.definition_id = NEW.definition_id
          AND i.executable_plan_hash = NEW.executable_plan_hash
          AND i.oracle_kind = NEW.oracle_kind
          AND i.oracle_subject_id = NEW.observed_subject_id
      )
    BEGIN SELECT RAISE(ABORT, 'Canonical Result oracle detail disagrees with immutable execution authority'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER canonical_result_detail_legacy_update
    BEFORE UPDATE OF oracle_kind, observed_subject_id ON test_results
    WHEN OLD.result_id IS NULL AND (NEW.oracle_kind IS NOT NULL OR NEW.observed_subject_id IS NOT NULL)
    BEGIN SELECT RAISE(ABORT, 'Legacy Result cannot claim canonical detail'); END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 029 is intentionally irreversible because canonical Result evidence cannot be safely forgotten.')
}
