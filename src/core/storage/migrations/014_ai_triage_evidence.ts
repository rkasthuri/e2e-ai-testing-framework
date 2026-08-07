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

import { Kysely } from 'kysely'

/**
 * 014 — TD-UI-043: ai_triage gains an `evidence` column (ADR-017 archetype 2).
 *
 * The AI's positive evidence — REQUIRED by the TD-063 evidence-gate for an
 * app-bug verdict (ai-triage.ts:454) — was computed, gated on, carried on
 * TriageResult, and then DISCARDED on the DB write, leaving the persisted verdict
 * unable to substantiate itself. This adds the column so the proof survives.
 *
 * NULLABLE by design (Nova/Aiden): a non-app-bug verdict has no evidence
 * requirement, so NULL honestly means "none was required", not "we lost it".
 * (Distinct from evidence: root_cause is the AI's reasoning NARRATIVE — the gate
 * downgrades an app-bug that has reasoning but no evidence, so the two are not
 * interchangeable.)
 *
 * Idempotent duplicate-swallow mirrors migration 008.
 */
export async function up(db: Kysely<any>): Promise<void> {
  try {
    await db.schema
      .alterTable('ai_triage')
      .addColumn('evidence', 'text')   // nullable, no default
      .execute()
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase()
    if (msg.includes('duplicate column') || msg.includes('already exists')) return
    throw err
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  try {
    await db.schema.alterTable('ai_triage').dropColumn('evidence').execute()
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).toLowerCase()
    if (msg.includes('no such column') || msg.includes('does not exist')) return
    throw err
  }
}
