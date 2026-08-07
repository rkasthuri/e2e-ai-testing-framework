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
 * 013 — TD-UI-031 Block 2: app_models provenance honesty (ADR-015).
 *
 * TOUCHES ONE TABLE — app_models. (The `runs` table has NO crawled_at column;
 * evidence_state is an app-model concept, so it is NOT added to runs.)
 *
 *  1. crawled_at NOT NULL → NULLABLE. A never-crawled model (evidenceState
 *     'unsupported-platform', crawlMetadata: null) must persist crawled_at = NULL
 *     — "no crawl happened". The pre-Block-2 compile-bridge wrote '' there, which
 *     is a DIFFERENT, false claim ("a crawl happened and produced an empty
 *     string"). NULL is the honest value.
 *  2. add evidence_state ('crawled' | 'crawled-empty' | 'unsupported-platform'),
 *     NOT NULL, no column default — every writer must assert it (derive, don't
 *     default). Existing rows are backfilled from observable content:
 *       page_count > 0 OR flow_count > 0  → 'crawled'   else 'crawled-empty'.
 *     (SQL cannot see a stub's null model; no unsupported-platform rows exist on
 *     disk today — the 4 reference apps are all web/api. Block 3's model_json
 *     rewrite is the authoritative source if that ever changes.)
 *
 * SQLite cannot DROP NOT NULL in place, so the SQLite path rebuilds the table
 * (nullable-crawled_at copy → backfill evidence_state → drop → rename → recreate
 * the idx_models_app_status index from migration 002). Postgres alters in place.
 * Mirrors migration 012's completed_at pattern.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const isPostgres = !!process.env.DB_URL
  const backfill = `CASE WHEN page_count > 0 OR flow_count > 0 THEN 'crawled' ELSE 'crawled-empty' END`

  if (isPostgres) {
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_at DROP NOT NULL`.execute(db)
    await db.schema.alterTable('app_models')
      .addColumn('evidence_state', 'varchar(50)')
      .execute()
    await sql.raw(`UPDATE app_models SET evidence_state = ${backfill}`).execute(db)
    await sql`ALTER TABLE app_models ALTER COLUMN evidence_state SET NOT NULL`.execute(db)
    return
  }

  // ── SQLite: table rebuild (cannot drop NOT NULL in place) ───────────────────
  await sql`
    CREATE TABLE app_models_new (
      id                integer PRIMARY KEY AUTOINCREMENT,
      app_name          varchar(255) NOT NULL,
      version           varchar(50)  NOT NULL,
      base_url          varchar(500) NOT NULL,
      app_type          varchar(20)  NOT NULL DEFAULT 'mpa',
      intake_mode       varchar(50)  NOT NULL DEFAULT 'crawl',
      crawl_config_hash varchar(255) NOT NULL DEFAULT '',
      page_count        integer      NOT NULL DEFAULT 0,
      flow_count        integer      NOT NULL DEFAULT 0,
      role_count        integer      NOT NULL DEFAULT 0,
      model_json        text         NOT NULL DEFAULT '{}',
      crawled_at        varchar(50),
      crawled_by        varchar(50)  NOT NULL DEFAULT 'human',
      status            varchar(50)  NOT NULL DEFAULT 'active',
      evidence_state    varchar(50)  NOT NULL
    )
  `.execute(db)

  await sql`
    INSERT INTO app_models_new (
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    )
    SELECT
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, CASE WHEN page_count > 0 OR flow_count > 0 THEN 'crawled' ELSE 'crawled-empty' END
    FROM app_models
  `.execute(db)

  await sql`DROP TABLE app_models`.execute(db)
  await sql`ALTER TABLE app_models_new RENAME TO app_models`.execute(db)

  // Recreate the index dropped with the old table (migration 002).
  await sql`CREATE INDEX IF NOT EXISTS idx_models_app_status ON app_models (app_name, status)`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  const isPostgres = !!process.env.DB_URL

  if (isPostgres) {
    // NULLs would block the NOT NULL restore; backfill first (sentinel epoch).
    await sql`UPDATE app_models SET crawled_at = '1970-01-01T00:00:00.000Z' WHERE crawled_at IS NULL`.execute(db)
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_at SET NOT NULL`.execute(db)
    await db.schema.alterTable('app_models').dropColumn('evidence_state').execute()
    return
  }

  await sql`UPDATE app_models SET crawled_at = '1970-01-01T00:00:00.000Z' WHERE crawled_at IS NULL`.execute(db)
  await sql`
    CREATE TABLE app_models_old (
      id                integer PRIMARY KEY AUTOINCREMENT,
      app_name          varchar(255) NOT NULL,
      version           varchar(50)  NOT NULL,
      base_url          varchar(500) NOT NULL,
      app_type          varchar(20)  NOT NULL DEFAULT 'mpa',
      intake_mode       varchar(50)  NOT NULL DEFAULT 'crawl',
      crawl_config_hash varchar(255) NOT NULL DEFAULT '',
      page_count        integer      NOT NULL DEFAULT 0,
      flow_count        integer      NOT NULL DEFAULT 0,
      role_count        integer      NOT NULL DEFAULT 0,
      model_json        text         NOT NULL DEFAULT '{}',
      crawled_at        varchar(50)  NOT NULL,
      crawled_by        varchar(50)  NOT NULL DEFAULT 'human',
      status            varchar(50)  NOT NULL DEFAULT 'active'
    )
  `.execute(db)
  await sql`
    INSERT INTO app_models_old (
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by, status
    )
    SELECT
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by, status
    FROM app_models
  `.execute(db)
  await sql`DROP TABLE app_models`.execute(db)
  await sql`ALTER TABLE app_models_old RENAME TO app_models`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_models_app_status ON app_models (app_name, status)`.execute(db)
}
