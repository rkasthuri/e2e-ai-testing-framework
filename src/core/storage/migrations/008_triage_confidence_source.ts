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
 * 008 — TD-066: persist triage confidence provenance.
 *
 * Adds `ai_triage.confidence_source` (varchar(20), default 'fallback') so a
 * confidence value stored in `ai_triage.confidence` records whether the model
 * actually produced it ('model') or it was a default we supplied ('fallback' —
 * model omitted it, or an API/parse error path). Default 'fallback' is the
 * honest default: absent a source marker, assume the value was not model-derived.
 *
 * Idempotent: SQLite has no `ADD COLUMN IF NOT EXISTS`, so we attempt the add
 * and treat a duplicate-column error as already-applied. Cross-dialect — the
 * same swallow also covers Postgres' "column already exists".
 */
export async function up(db: Kysely<any>): Promise<void> {
  try {
    await db.schema
      .alterTable('ai_triage')
      .addColumn('confidence_source', 'varchar(20)', c => c.notNull().defaultTo('fallback'))
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes('duplicate column') || msg.includes('already exists')) return;
    throw err;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.alterTable('ai_triage').dropColumn('confidence_source').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes('no such column') || msg.includes('does not exist')) return;
    throw err;
  }
}
