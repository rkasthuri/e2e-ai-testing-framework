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
 * 007 — TD-053: per-attempt AI-usage tracking.
 *
 * Adds `ai_usage.retry_attempt` (integer, default 0) so each app-level retry
 * inside `aiCall()` records its own row (0 = first attempt, 1 = first retry, …).
 *
 * Idempotent: SQLite has no `ADD COLUMN IF NOT EXISTS`, so we attempt the add
 * and treat a duplicate-column error as already-applied. Cross-dialect — the
 * same swallow also covers Postgres' "column already exists".
 */
export async function up(db: Kysely<any>): Promise<void> {
  try {
    await db.schema
      .alterTable('ai_usage')
      .addColumn('retry_attempt', 'integer', c => c.notNull().defaultTo(0))
      .execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes('duplicate column') || msg.includes('already exists')) return;
    throw err;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.alterTable('ai_usage').dropColumn('retry_attempt').execute();
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    if (msg.includes('no such column') || msg.includes('does not exist')) return;
    throw err;
  }
}
