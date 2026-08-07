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

/**
 * 017 - durable operation identity for canonical App Model runtime commits.
 *
 * Legacy rows deliberately retain NULL operation identity. Runtime writers
 * added by TD-181 provide both columns; the partial index makes replay
 * uniqueness exact and case-sensitive for each app_name.
 */
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE app_models ADD COLUMN operation_id TEXT`.execute(db)
  await sql`ALTER TABLE app_models ADD COLUMN candidate_hash TEXT`.execute(db)
  await sql`
    CREATE UNIQUE INDEX idx_models_operation_identity
    ON app_models (app_name, operation_id)
    WHERE operation_id IS NOT NULL
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_models_operation_identity`.execute(db)
  await sql`ALTER TABLE app_models DROP COLUMN candidate_hash`.execute(db)
  await sql`ALTER TABLE app_models DROP COLUMN operation_id`.execute(db)
}
