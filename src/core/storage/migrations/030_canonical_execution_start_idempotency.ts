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

/**
 * A Start intent and its accepted Execution are one immutable authority row.
 * Existing rows remain NULL/NULL historical evidence; every new Execution must
 * carry a bounded project-scoped intent key and canonical SHA-256 fingerprint.
 */
export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 030 is governed for SQLite workspace databases only.')
  }
  await sql.raw(`
    ALTER TABLE executions ADD COLUMN execution_intent_key varchar(128)
      CHECK (execution_intent_key IS NULL OR (
        length(execution_intent_key) BETWEEN 1 AND 128
        AND substr(execution_intent_key, 1, 1) GLOB '[A-Za-z0-9]'
        AND execution_intent_key NOT GLOB '*[^A-Za-z0-9._:-]*'
      ))
  `).execute(db)
  await sql.raw(`
    ALTER TABLE executions ADD COLUMN execution_intent_fingerprint varchar(64)
      CHECK (execution_intent_fingerprint IS NULL OR (
        length(execution_intent_fingerprint) = 64
        AND execution_intent_fingerprint NOT GLOB '*[^a-f0-9]*'
      ))
  `).execute(db)
  await sql.raw(`
    CREATE UNIQUE INDEX uq_executions_project_intent
      ON executions (project_id, execution_intent_key)
      WHERE execution_intent_key IS NOT NULL
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_intent_authority_required_insert
    BEFORE INSERT ON executions
    WHEN NEW.execution_intent_key IS NULL OR NEW.execution_intent_fingerprint IS NULL
    BEGIN SELECT RAISE(ABORT, 'Canonical Execution requires Start intent authority'); END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 030 is intentionally irreversible because accepted Start intent authority cannot be safely forgotten.')
}
