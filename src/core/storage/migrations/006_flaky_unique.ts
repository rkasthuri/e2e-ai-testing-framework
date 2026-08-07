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

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_flaky_test_app_date_unique
    ON flaky_analysis (test_id, app_name, analysis_date)`.execute(db)
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_coverage_gaps_app_gap_unique
    ON coverage_gaps (app_name, gap_id)`.execute(db)
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_baselines_app_flow_metric_unique
    ON perf_baselines (app_name, flow_id, metric)`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_flaky_test_app_date_unique`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_coverage_gaps_app_gap_unique`.execute(db)
  await sql`DROP INDEX IF EXISTS idx_perf_baselines_app_flow_metric_unique`.execute(db)
}
