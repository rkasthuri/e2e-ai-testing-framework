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
 * 010 — TD-065: heal correctness signal.
 *
 * Adds two columns to `heal_events`:
 *   - `correctness_signal` (varchar(30), nullable) — HOW a heal's correctness was
 *     established: 'assertion-verified' (a real assertion re-ran and passed on the
 *     healed target) | 'resolvability-only' (the healed selector matched a visible
 *     element, but correctness was never checked — today's behavior) | 'unverified'
 *     (no signal available). NULL on existing rows (pre-TD-065 heals carry no
 *     correctness data — NULL is the honest default, not an invented value).
 *   - `heal_confidence` (varchar(20), nullable) — the DERIVED correctness-based
 *     confidence tier: 'observed' | 'partial' | 'unknown' | 'failed'. Replaces the
 *     -1 numeric sentinel going forward. NULL on existing rows.
 *
 * The existing numeric `confidence` column STAYS untouched — the vision path still
 * stores the model-returned confidence there; `heal_confidence` is the new,
 * separate, correctness-derived tier.
 *
 * Two separate addColumn calls, each idempotent: SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we attempt each add and treat a duplicate-column
 * error as already-applied. The same swallow also covers Postgres'
 * "column already exists".
 */
export async function up(db: Kysely<any>): Promise<void> {
  try {
    await db.schema
      .alterTable('heal_events')
      .addColumn('correctness_signal', 'varchar(30)')
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('duplicate column') || msg.includes('already exists'))) throw err;
  }

  try {
    await db.schema
      .alterTable('heal_events')
      .addColumn('heal_confidence', 'varchar(20)')
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('duplicate column') || msg.includes('already exists'))) throw err;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.alterTable('heal_events').dropColumn('correctness_signal').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('no such column') || msg.includes('does not exist'))) throw err;
  }

  try {
    await db.schema.alterTable('heal_events').dropColumn('heal_confidence').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (!(msg.includes('no such column') || msg.includes('does not exist'))) throw err;
  }
}
