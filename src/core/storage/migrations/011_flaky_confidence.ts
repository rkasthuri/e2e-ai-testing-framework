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
 * TD-120 — add a first-class `confidence` column to flaky_analysis.
 *
 * Nova ruling: "Persist insufficient-evidence — never suppress. Unknown is
 * data. Missing is not." A prediction's evidential standing needs a home in
 * the schema, not a string smuggled into recommendation/trend.
 *
 * Allowed values (application-enforced, not a DB CHECK — matches the
 * codebase's existing varchar-vocabulary convention):
 *   'high' | 'medium' | 'low' | 'insufficient-evidence' | 'unknown'
 *
 * Default 'unknown' — honest for any pre-TD-120 rows (none exist in practice:
 * the table was never populated before this TD) and for writers that predate
 * the column.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('flaky_analysis')
    .addColumn('confidence', 'text', c => c.notNull().defaultTo('unknown'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('flaky_analysis')
    .dropColumn('confidence')
    .execute();
}
