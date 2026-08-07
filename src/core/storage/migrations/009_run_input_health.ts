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

import { Kysely } from 'kysely';

/**
 * 009 — TD-067: record whether triage's input was verifiably from the current run.
 *
 * Adds two columns to `runs`:
 *   - `input_health` (varchar(20), default 'unknown') — the freshness/self-health
 *     verdict for the results the triage/pipeline consumed for this run
 *     (e.g. 'ok' | 'stale' | 'unverified' | 'no-run'). Default 'unknown' is the
 *     honest default: absent a computed verdict, we do not claim the input was
 *     current. Populated by the triage-side gate in a later commit (Commit 3).
 *   - `input_health_reason` (varchar(50), nullable) — short machine-readable
 *     reason when non-ok (e.g. 'startTime-mismatch', 'no-provenance'); NULL when
 *     ok or not yet evaluated.
 *
 * Two separate addColumn calls, each idempotent: SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we attempt each add and treat a duplicate-column
 * error as already-applied. The same swallow also covers Postgres'
 * "column already exists".
 */
export async function up(db: Kysely<any>): Promise<void> {
  try {
    await db.schema
      .alterTable('runs')
      .addColumn('input_health', 'varchar(20)', c => c.notNull().defaultTo('unknown'))
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('duplicate column') || msg.includes('already exists'))) throw err;
  }

  try {
    await db.schema
      .alterTable('runs')
      .addColumn('input_health_reason', 'varchar(50)')
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('duplicate column') || msg.includes('already exists'))) throw err;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.alterTable('runs').dropColumn('input_health').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('no such column') || msg.includes('does not exist'))) throw err;
  }

  try {
    await db.schema.alterTable('runs').dropColumn('input_health_reason').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('no such column') || msg.includes('does not exist'))) throw err;
  }
}
