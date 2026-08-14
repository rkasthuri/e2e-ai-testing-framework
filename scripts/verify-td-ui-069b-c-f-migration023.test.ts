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

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Kysely, sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runSqliteMigrationCoordinator } from '../src/core/storage/migrate'

interface ForgeMigration { up: (db: Kysely<any>) => Promise<void> }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-f-m023-'))
const TEMPLATE = path.join(ROOT, 'through-022.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
const migrations: Record<string, ForgeMigration> = Object.fromEntries(
  fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.ts'))
    .filter(file => file.replace(/\.ts$/, '') <= '023_product_execution_cancellation').sort()
    .map(file => [file.replace(/\.ts$/, ''), require(path.join(MIGRATIONS_DIR, file))]),
)
const through022 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '022_product_execution_evidence_guards'))

async function open(file: string): Promise<Kysely<any>> { initDb(file); return getDb() as unknown as Kysely<any> }
function copy(name: string): string { const target = path.join(ROOT, `${name}.db`); fs.copyFileSync(TEMPLATE, target); return target }

async function insertRoot(db: Kysely<any>, suffix: string): Promise<{ executionId: string; projectId: string; hash: string }> {
  const executionId = `execution-${suffix}`
  const projectId = `project-${suffix}`
  const hash = suffix.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/g, 'a')
  await db.insertInto('executions').values({
    execution_id: executionId, project_id: projectId, accepted_at: '2026-08-10T12:00:00.000Z',
    test_set_id: `test-set-${suffix}`, test_set_revision: 1, model_row_id: 1, model_version: '1.0.0',
    source_observation_id: `observation-${suffix}`, manifest_hash: hash, max_run_attempts: 1,
    dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
  }).execute()
  return { executionId, projectId, hash }
}

before(async () => {
  const db = await open(TEMPLATE)
  await runSqliteMigrationCoordinator(db, through022)
  await closeDb()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-C-F-M1 Migration 023 preserves pre-023 events and adds exact lifecycle/uniqueness authority', async () => {
  const db = await open(copy('exact'))
  const fixture = await insertRoot(db, 'exact')
  await db.insertInto('execution_events').values({
    execution_id: fixture.executionId, project_id: fixture.projectId, event_type: 'started', outcome: null,
    occurred_at: '2026-08-10T12:00:00.000Z', process_instance_id: 'process-owner', safe_code: null,
    safe_message: 'Existing accepted event.', execution_plan_hash: fixture.hash,
  }).execute()
  assert.deepEqual(await runSqliteMigrationCoordinator(db, migrations), ['023_product_execution_cancellation'])
  const columns = (await sql<{ name: string }>`PRAGMA table_info(execution_events)`.execute(db)).rows.map(row => row.name)
  assert.equal(columns.at(-1), 'lifecycle')
  const existing = await db.selectFrom('execution_events').selectAll().where('execution_id', '=', fixture.executionId).executeTakeFirstOrThrow()
  assert.equal(existing.lifecycle, null)
  const index = await sql<{ unique: number; partial: number }>`SELECT "unique", partial FROM pragma_index_list('execution_events') WHERE name = 'uq_execution_cancellation_requested'`.execute(db)
  assert.deepEqual(index.rows, [{ unique: 1, partial: 1 }])
  const trigger = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'validate_execution_event_lifecycle_insert'`.execute(db)
  assert.equal(trigger.rows.length, 1)
  await closeDb()
})

test('TD069B-C-F-M2 new events require explicit lifecycle and cancellation intent is unique', async () => {
  const db = await open(copy('guard'))
  await runSqliteMigrationCoordinator(db, migrations)
  const fixture = await insertRoot(db, 'guard')
  await assert.rejects(db.insertInto('execution_events').values({
    execution_id: fixture.executionId, project_id: fixture.projectId, event_type: 'started', outcome: null,
    occurred_at: '2026-08-10T12:00:00.000Z', process_instance_id: 'process-owner', safe_code: null,
    safe_message: 'Missing lifecycle.', execution_plan_hash: fixture.hash,
  }).execute(), /lifecycle is invalid/i)
  await db.insertInto('execution_events').values({
    execution_id: fixture.executionId, project_id: fixture.projectId, event_type: 'started', outcome: null,
    occurred_at: '2026-08-10T12:00:00.000Z', process_instance_id: 'process-owner', safe_code: null,
    safe_message: 'Accepted.', execution_plan_hash: fixture.hash, lifecycle: 'accepted',
  }).execute()
  const request = {
    execution_id: fixture.executionId, project_id: fixture.projectId, event_type: 'cancellation_requested', outcome: null,
    occurred_at: '2026-08-10T12:00:01.000Z', process_instance_id: 'process-requester', safe_code: 'cancellation_requested',
    safe_message: 'Requested.', execution_plan_hash: fixture.hash, lifecycle: 'cancellation_requested',
  }
  await db.insertInto('execution_events').values(request).execute()
  await assert.rejects(db.insertInto('execution_events').values({ ...request, occurred_at: '2026-08-10T12:00:02.000Z' }).execute(), /UNIQUE constraint failed/i)
  await closeDb()
})

test('TD069B-C-F-M3 Migration 023 is transaction-rollback-safe', async () => {
  const db = await open(copy('rollback'))
  await sql.raw(`CREATE TRIGGER fail_023_history BEFORE INSERT ON kysely_migration WHEN NEW.name = '023_product_execution_cancellation' BEGIN SELECT RAISE(ABORT, 'forced 023 history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, migrations), /forced 023 history failure/)
  const columns = (await sql<{ name: string }>`PRAGMA table_info(execution_events)`.execute(db)).rows.map(row => row.name)
  assert.equal(columns.includes('lifecycle'), false)
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name IN ('uq_execution_cancellation_requested', 'validate_execution_event_lifecycle_insert')`.execute(db)).rows.length, 0)
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '023_product_execution_cancellation').execute()).length, 0)
  await closeDb()
})

test('TD069B-C-F-M4 Migration 023 is restart-safe and schema-ahead state is refused', async () => {
  const db = await open(copy('rerun'))
  await runSqliteMigrationCoordinator(db, migrations)
  assert.deepEqual(await runSqliteMigrationCoordinator(db, migrations), [])
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '023_product_execution_cancellation').execute()).length, 1)
  await closeDb()

  const ahead = await open(copy('ahead'))
  await sql`ALTER TABLE execution_events ADD COLUMN lifecycle varchar(30)`.execute(ahead)
  await assert.rejects(runSqliteMigrationCoordinator(ahead, migrations), /023_product_execution_cancellation|cancellation event lifecycle/i)
  await closeDb()
})
