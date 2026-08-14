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
 * TD-UI-069B-C-F — lifecycle and outcome are orthogonal. Existing rows remain
 * readable through the pre-023 compatibility mapping; every newly appended
 * event must carry an explicit lifecycle. Cancellation intent is append-only
 * and unique per Execution.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    ALTER TABLE execution_events ADD COLUMN lifecycle varchar(30)
      CHECK (lifecycle IS NULL OR lifecycle IN (
        'accepted', 'cancellation_requested', 'completed', 'cancelled', 'interrupted'
      ))
  `).execute(db)
  await sql.raw(`
    CREATE UNIQUE INDEX uq_execution_cancellation_requested
      ON execution_events (execution_id) WHERE event_type = 'cancellation_requested'
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_execution_event_lifecycle_insert
    BEFORE INSERT ON execution_events
    BEGIN
      SELECT CASE WHEN COALESCE(NOT (
        (NEW.event_type = 'started' AND NEW.lifecycle = 'accepted'
          AND NEW.outcome IS NULL AND NEW.safe_code IS NULL)
        OR
        (NEW.event_type = 'cancellation_requested'
          AND NEW.lifecycle = 'cancellation_requested'
          AND NEW.outcome IS NULL AND NEW.safe_code = 'cancellation_requested')
        OR
        (NEW.event_type = 'terminal'
          AND NEW.lifecycle IN ('completed', 'cancelled', 'interrupted')
          AND NEW.outcome IN ('completed', 'passed', 'failed', 'could_not_verify',
            'authentication_failed', 'navigation_failed', 'oracle_failed',
            'unsupported_plan', 'executor_failure', 'interrupted')
          AND NEW.safe_code IS NOT NULL)
      ), 1) THEN RAISE(ABORT, 'Execution event lifecycle is invalid') END;
    END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS validate_execution_event_lifecycle_insert`.execute(db)
  await sql`DROP INDEX IF EXISTS uq_execution_cancellation_requested`.execute(db)
  await sql`ALTER TABLE execution_events DROP COLUMN lifecycle`.execute(db)
}
