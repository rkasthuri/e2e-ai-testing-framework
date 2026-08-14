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

/**
 * TD-UI-069B-C-D — Product evidence is append-only. Migration 021 made
 * Product identity immutable; these guards close the remaining mutation and
 * deletion channels while leaving legacy Run/Result behavior unchanged.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    CREATE TRIGGER product_result_immutable_update
    BEFORE UPDATE ON test_results WHEN OLD.result_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'Product Result evidence is immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER product_result_immutable_delete
    BEFORE DELETE ON test_results WHEN OLD.result_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'Product Result evidence is immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER product_run_admission_immutable
    BEFORE UPDATE OF run_id, app_name, branch, commit_sha, environment, base_url,
      triggered_by, reporter_version, total_tests, started_at, metadata,
      input_health, input_health_reason, execution_id, origin, attempt_ordinal
    ON runs WHEN OLD.origin = 'product'
    BEGIN SELECT RAISE(ABORT, 'Product Run admission evidence is immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER product_run_immutable_delete
    BEFORE DELETE ON runs WHEN OLD.origin = 'product'
    BEGIN SELECT RAISE(ABORT, 'Product Run evidence is immutable'); END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS product_run_immutable_delete`.execute(db)
  await sql`DROP TRIGGER IF EXISTS product_run_admission_immutable`.execute(db)
  await sql`DROP TRIGGER IF EXISTS product_result_immutable_delete`.execute(db)
  await sql`DROP TRIGGER IF EXISTS product_result_immutable_update`.execute(db)
}
