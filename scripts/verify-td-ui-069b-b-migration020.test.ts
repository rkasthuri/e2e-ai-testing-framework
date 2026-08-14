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

interface ForgeMigration { up: (db: Kysely<any>) => Promise<void>; down?: (db: Kysely<any>) => Promise<void> }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-b-m020-'))
const TEMPLATE = path.join(ROOT, 'through-019.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')

function loadMigrations(): Record<string, ForgeMigration> {
  return Object.fromEntries(fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.ts')).sort()
    .map(file => [file.replace(/\.ts$/, ''), require(path.join(MIGRATIONS_DIR, file))]))
}

const migrations = loadMigrations()
const through019 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '019_test_set_revisions'))
const through020 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '020_execution_lifecycle'))

async function open(file: string): Promise<Kysely<any>> {
  initDb(file)
  return getDb() as unknown as Kysely<any>
}

function copy(name: string): string {
  const target = path.join(ROOT, `${name}.db`)
  fs.copyFileSync(TEMPLATE, target)
  return target
}

before(async () => {
  const db = await open(TEMPLATE)
  await runSqliteMigrationCoordinator(db, through019)
  await closeDb()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-B-M1 Migration 020 creates exactly the governed coordination schema after 019', async () => {
  const db = await open(copy('exact-schema'))
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through020), ['020_execution_lifecycle'])
  const eventInfo = (await sql<{ name: string; notnull: number; pk: number }>`PRAGMA table_info(execution_events)`.execute(db)).rows
  const lockInfo = (await sql<{ name: string; notnull: number; pk: number }>`PRAGMA table_info(execution_locks)`.execute(db)).rows
  const eventColumns = eventInfo.map(row => row.name)
  const lockColumns = lockInfo.map(row => row.name)
  assert.deepEqual(eventColumns, [
    'id', 'execution_id', 'project_id', 'event_type', 'outcome', 'occurred_at',
    'process_instance_id', 'safe_code', 'safe_message', 'execution_plan_hash',
  ])
  assert.deepEqual(lockColumns, [
    'project_id', 'execution_id', 'process_instance_id', 'acquired_at', 'last_heartbeat_at',
  ])
  assert.deepEqual(lockInfo.map(row => [row.name, Number(row.notnull), Number(row.pk)]), [
    ['project_id', 1, 1], ['execution_id', 1, 0], ['process_instance_id', 1, 0],
    ['acquired_at', 1, 0], ['last_heartbeat_at', 1, 0],
  ])
  const history = await db.selectFrom('kysely_migration').select('name').orderBy('name').execute()
  assert.equal(history.at(-1)?.name, '020_execution_lifecycle')
  await closeDb()
})

test('TD069B-B-M2 Migration 020 is restart-safe and adds no duplicate schema/history', async () => {
  const db = await open(copy('restart-safe'))
  await runSqliteMigrationCoordinator(db, through020)
  const before = (await sql<{ type: string; name: string; sql: string | null }>`SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'execution_%' OR name = 'idx_execution_project_identity' ORDER BY type, name`.execute(db)).rows
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through020), [])
  const afterRestart = (await sql<{ type: string; name: string; sql: string | null }>`SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'execution_%' OR name = 'idx_execution_project_identity' ORDER BY type, name`.execute(db)).rows
  assert.deepEqual(afterRestart, before)
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '020_execution_lifecycle').execute()).length, 1)
  await closeDb()
})

test('TD069B-B-M3 a Migration 020 history-write failure rolls back both lifecycle tables', async () => {
  const db = await open(copy('atomic-rollback'))
  await sql.raw(`CREATE TRIGGER fail_020_history BEFORE INSERT ON kysely_migration WHEN NEW.name = '020_execution_lifecycle' BEGIN SELECT RAISE(ABORT, 'forced 020 history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, through020), /forced 020 history failure/)
  const tables = (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('execution_events', 'execution_locks')`.execute(db)).rows
  assert.deepEqual(tables, [])
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '020_execution_lifecycle').execute()).length, 0)
  await closeDb()
})

test('TD069B-B-M4 schema-ahead state is refused rather than inferred or repaired', async () => {
  const db = await open(copy('schema-ahead'))
  await migrations['020_execution_lifecycle'].up(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, through020), (error: unknown) => (
    error instanceof Error
    && error.name === 'MigrationStateMismatchError'
    && error.message.includes('020_execution_lifecycle is pending')
  ))
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '020_execution_lifecycle').execute()).length, 0)
  await closeDb()
})
