/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * 018 - durable provenance for guarded App Model recovery.
 *
 * Existing and normal-write rows retain NULL/NULL. Recovery writes introduced
 * later by TD-184B must provide both the source row and its fingerprint.
 */
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE app_models
    ADD COLUMN recovery_source_row_id INTEGER
  `.execute(db)
  await sql`
    ALTER TABLE app_models
    ADD COLUMN recovery_source_fingerprint TEXT
    CHECK (
      (recovery_source_row_id IS NULL AND recovery_source_fingerprint IS NULL)
      OR
      (recovery_source_row_id IS NOT NULL AND recovery_source_fingerprint IS NOT NULL)
    )
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE app_models DROP COLUMN recovery_source_fingerprint`.execute(db)
  await sql`ALTER TABLE app_models DROP COLUMN recovery_source_row_id`.execute(db)
}
