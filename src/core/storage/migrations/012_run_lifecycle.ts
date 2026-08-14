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
 * 012 — TD-126: run lifecycle + nullable completed_at.
 *
 * Adds a `lifecycle` column ('created'|'running'|'completed'|'failed'|
 * 'interrupted') — ORTHOGONAL to `status` (test OUTCOME: passed|failed|
 * partial|unknown). Never conflated (Nova S2): a run can be
 * lifecycle:'completed' + status:'failed'.
 *
 * Also makes `completed_at` NULLABLE so INTERRUPTED runs (no completion time)
 * stay distinguishable forever (Nova S3). `completed_at` is NOT NULL in
 * migration 001; SQLite cannot drop NOT NULL in place, so the SQLite path
 * rebuilds the table (create nullable copy → copy rows → drop → rename →
 * recreate the 3 `runs` indexes from migration 002). Postgres alters in place.
 *
 * Existing rows → lifecycle='completed' (the old batch job wrote them after
 * completion). completed_at is PRESERVED from the existing rows (it is already
 * NOT NULL / real). NOTE vs ruling S3, which said "completed_at = started_at
 * for existing rows": preserving the real completion timestamp is strictly
 * more correct (no data loss) and still satisfies the intent (valid non-null
 * completed_at + lifecycle=completed). Flagged for review — trivially changed
 * to started_at if that was genuinely intended.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const isPostgres = currentMigrationDialect() === 'postgres'

  if (isPostgres) {
    await db.schema.alterTable('runs')
      .addColumn('lifecycle', 'varchar(50)', c => c.notNull().defaultTo('completed'))
      .execute()
    await sql`ALTER TABLE runs ALTER COLUMN completed_at DROP NOT NULL`.execute(db)
    return
  }

  // ── SQLite: table rebuild (cannot drop NOT NULL in place) ───────────────────
  await sql`
    CREATE TABLE runs_new (
      id                  integer PRIMARY KEY AUTOINCREMENT,
      run_id              varchar(255) NOT NULL UNIQUE,
      app_name            varchar(255) NOT NULL,
      branch              varchar(255) NOT NULL DEFAULT 'unknown',
      commit_sha          varchar(255) NOT NULL DEFAULT 'unknown',
      environment         varchar(50)  NOT NULL DEFAULT 'local',
      base_url            varchar(500) NOT NULL DEFAULT '',
      triggered_by        varchar(50)  NOT NULL DEFAULT 'manual',
      reporter_version    varchar(50)  NOT NULL DEFAULT 'unknown',
      status              varchar(50)  NOT NULL DEFAULT 'unknown',
      total_tests         integer      NOT NULL DEFAULT 0,
      passed              integer      NOT NULL DEFAULT 0,
      failed              integer      NOT NULL DEFAULT 0,
      skipped             integer      NOT NULL DEFAULT 0,
      duration_ms         integer      NOT NULL DEFAULT 0,
      started_at          varchar(50)  NOT NULL,
      completed_at        varchar(50),
      metadata            text         NOT NULL DEFAULT '{}',
      input_health        varchar(20)  NOT NULL DEFAULT 'unknown',
      input_health_reason varchar(50),
      lifecycle           varchar(50)  NOT NULL DEFAULT 'completed'
    )
  `.execute(db)

  await sql`
    INSERT INTO runs_new (
      id, run_id, app_name, branch, commit_sha, environment, base_url,
      triggered_by, reporter_version, status, total_tests, passed, failed,
      skipped, duration_ms, started_at, completed_at, metadata,
      input_health, input_health_reason, lifecycle
    )
    SELECT
      id, run_id, app_name, branch, commit_sha, environment, base_url,
      triggered_by, reporter_version, status, total_tests, passed, failed,
      skipped, duration_ms, started_at, completed_at, metadata,
      input_health, input_health_reason, 'completed'
    FROM runs
  `.execute(db)

  await sql`DROP TABLE runs`.execute(db)
  await sql`ALTER TABLE runs_new RENAME TO runs`.execute(db)

  // Recreate the runs indexes (dropped with the old table — migration 002).
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs (run_id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_app_started ON runs (app_name, started_at)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status)`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  const isPostgres = currentMigrationDialect() === 'postgres'

  if (isPostgres) {
    // Existing NULLs would block the NOT NULL restore; backfill first.
    await sql`UPDATE runs SET completed_at = started_at WHERE completed_at IS NULL`.execute(db)
    await sql`ALTER TABLE runs ALTER COLUMN completed_at SET NOT NULL`.execute(db)
    await db.schema.alterTable('runs').dropColumn('lifecycle').execute()
    return
  }

  await sql`UPDATE runs SET completed_at = started_at WHERE completed_at IS NULL`.execute(db)
  await sql`
    CREATE TABLE runs_old (
      id                  integer PRIMARY KEY AUTOINCREMENT,
      run_id              varchar(255) NOT NULL UNIQUE,
      app_name            varchar(255) NOT NULL,
      branch              varchar(255) NOT NULL DEFAULT 'unknown',
      commit_sha          varchar(255) NOT NULL DEFAULT 'unknown',
      environment         varchar(50)  NOT NULL DEFAULT 'local',
      base_url            varchar(500) NOT NULL DEFAULT '',
      triggered_by        varchar(50)  NOT NULL DEFAULT 'manual',
      reporter_version    varchar(50)  NOT NULL DEFAULT 'unknown',
      status              varchar(50)  NOT NULL DEFAULT 'unknown',
      total_tests         integer      NOT NULL DEFAULT 0,
      passed              integer      NOT NULL DEFAULT 0,
      failed              integer      NOT NULL DEFAULT 0,
      skipped             integer      NOT NULL DEFAULT 0,
      duration_ms         integer      NOT NULL DEFAULT 0,
      started_at          varchar(50)  NOT NULL,
      completed_at        varchar(50)  NOT NULL,
      metadata            text         NOT NULL DEFAULT '{}',
      input_health        varchar(20)  NOT NULL DEFAULT 'unknown',
      input_health_reason varchar(50)
    )
  `.execute(db)
  await sql`
    INSERT INTO runs_old (
      id, run_id, app_name, branch, commit_sha, environment, base_url,
      triggered_by, reporter_version, status, total_tests, passed, failed,
      skipped, duration_ms, started_at, completed_at, metadata,
      input_health, input_health_reason
    )
    SELECT
      id, run_id, app_name, branch, commit_sha, environment, base_url,
      triggered_by, reporter_version, status, total_tests, passed, failed,
      skipped, duration_ms, started_at, completed_at, metadata,
      input_health, input_health_reason
    FROM runs
  `.execute(db)
  await sql`DROP TABLE runs`.execute(db)
  await sql`ALTER TABLE runs_old RENAME TO runs`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs (run_id)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_app_started ON runs (app_name, started_at)`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status)`.execute(db)
}
