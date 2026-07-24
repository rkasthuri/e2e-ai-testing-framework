/**
 * 016 — enforce one active App Model snapshot per exact, case-sensitive app_name.
 *
 * Duplicate detection deliberately precedes schema mutation. Existing rows are
 * never selected, merged, superseded, or deleted by this migration.
 */
import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  const duplicates = await sql<{ app_name: string; active_count: number }>`
    SELECT app_name, COUNT(*) AS active_count
    FROM app_models
    WHERE status = 'active'
    GROUP BY app_name
    HAVING COUNT(*) > 1
    ORDER BY app_name
  `.execute(db)

  if (duplicates.rows.length > 0) {
    const detail = duplicates.rows
      .map(row => `${row.app_name} (${Number(row.active_count)} active)`)
      .join(', ')
    throw new Error(
      `[migration 016] Duplicate active App Models detected: ${detail}. ` +
      'No records were changed; resolve the invalid state explicitly before retrying.',
    )
  }

  await sql`
    CREATE UNIQUE INDEX idx_models_one_active
    ON app_models (app_name)
    WHERE status = 'active'
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_models_one_active`.execute(db)
}