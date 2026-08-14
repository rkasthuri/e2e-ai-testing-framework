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
 * 015 — Crawl-LIEs (ADR-015): crawled_by provenance honesty.
 *
 * crawled_by was `NOT NULL DEFAULT 'human'` (migrations 001 + 013). Two problems:
 *   - every REAL crawl recorded 'human' though the algorithmic engine did it
 *     (now 'engine' at the source — Crawler.buildModel);
 *   - a STUB row (unsupported-platform, crawlMetadata: null — NO crawl ran) fell
 *     through `?? 'human'` and asserted a human crawler for a crawl that never
 *     happened. The honest value there is NULL ("who crawled this? nobody did"),
 *     exactly as crawled_at is NULL for the same rows (migration 013).
 *
 * This migration makes crawled_by NULLABLE and drops the DEFAULT 'human' — so a
 * writer must ASSERT the actor (derive, don't default), and a stub persists NULL.
 *
 * NO BACKFILL (deliberate): existing rows keep their legacy 'human'. Those are
 * known-wrong-but-unverifiable — we do NOT know which historic rows were real
 * engine crawls vs stubs, so UPDATE-ing them to 'engine' (or NULL) would FABRICATE
 * provenance we cannot substantiate — the exact ADR-015 violation this fixes.
 * Honest history (a legacy 'human' we can see is legacy) beats rewritten history.
 * Fix is going-forward only.
 *
 * SQLite cannot DROP NOT NULL / DROP DEFAULT in place, so the SQLite path rebuilds
 * the table (crawled_by nullable, no default) and copies rows verbatim. Postgres
 * alters in place. Mirrors migration 013's crawled_at pattern.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const isPostgres = currentMigrationDialect() === 'postgres'

  if (isPostgres) {
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_by DROP NOT NULL`.execute(db)
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_by DROP DEFAULT`.execute(db)
    return
  }

  // ── SQLite: table rebuild (cannot drop NOT NULL / DEFAULT in place) ──────────
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
      crawled_by        varchar(50),
      status            varchar(50)  NOT NULL DEFAULT 'active',
      evidence_state    varchar(50)  NOT NULL
    )
  `.execute(db)

  // Copy rows verbatim — NO backfill (legacy crawled_by preserved as-is).
  await sql`
    INSERT INTO app_models_new (
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    )
    SELECT
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    FROM app_models
  `.execute(db)

  await sql`DROP TABLE app_models`.execute(db)
  await sql`ALTER TABLE app_models_new RENAME TO app_models`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_models_app_status ON app_models (app_name, status)`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  const isPostgres = currentMigrationDialect() === 'postgres'

  // Restoring NOT NULL requires a non-null value: backfill NULLs to 'human' (the
  // OLD default). This is a REVERSAL fabrication — acceptable only because down()
  // restores the pre-015 (lying) schema, which defaulted to 'human' anyway.
  if (isPostgres) {
    await sql`UPDATE app_models SET crawled_by = 'human' WHERE crawled_by IS NULL`.execute(db)
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_by SET DEFAULT 'human'`.execute(db)
    await sql`ALTER TABLE app_models ALTER COLUMN crawled_by SET NOT NULL`.execute(db)
    return
  }

  await sql`UPDATE app_models SET crawled_by = 'human' WHERE crawled_by IS NULL`.execute(db)
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
      crawled_at        varchar(50),
      crawled_by        varchar(50)  NOT NULL DEFAULT 'human',
      status            varchar(50)  NOT NULL DEFAULT 'active',
      evidence_state    varchar(50)  NOT NULL
    )
  `.execute(db)
  await sql`
    INSERT INTO app_models_old (
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    )
    SELECT
      id, app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    FROM app_models
  `.execute(db)
  await sql`DROP TABLE app_models`.execute(db)
  await sql`ALTER TABLE app_models_old RENAME TO app_models`.execute(db)
  await sql`CREATE INDEX IF NOT EXISTS idx_models_app_status ON app_models (app_name, status)`.execute(db)
}
