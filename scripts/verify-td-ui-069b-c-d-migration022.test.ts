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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-d-m022-'))
const TEMPLATE = path.join(ROOT, 'through-021.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')

const migrations: Record<string, ForgeMigration> = Object.fromEntries(
  fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.ts')).sort()
    .map(file => [file.replace(/\.ts$/, ''), require(path.join(MIGRATIONS_DIR, file))]),
)
const through021 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '021_execution_identity_manifest_run_linkage'))
const through022 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '022_product_execution_evidence_guards'))

async function open(file: string): Promise<Kysely<any>> { initDb(file); return getDb() as unknown as Kysely<any> }
function copy(name: string): string { const target = path.join(ROOT, `${name}.db`); fs.copyFileSync(TEMPLATE, target); return target }
async function triggerNames(db: Kysely<any>): Promise<string[]> {
  return (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'product_%' ORDER BY name`.execute(db)).rows.map(row => row.name)
}

before(async () => {
  const db = await open(TEMPLATE)
  await runSqliteMigrationCoordinator(db, through021)
  await closeDb()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-C-D-M1 Migration 022 adds exactly the four Product evidence write guards after 021', async () => {
  const db = await open(copy('exact'))
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through022), ['022_product_execution_evidence_guards'])
  assert.deepEqual(await triggerNames(db), [
    'product_result_identity_immutable',
    'product_result_immutable_delete',
    'product_result_immutable_update',
    'product_run_admission_immutable',
    'product_run_immutable_delete',
  ])
  await closeDb()
})

test('TD069B-C-D-M2 Migration 022 is restart-safe and idempotently recognized', async () => {
  const db = await open(copy('rerun'))
  await runSqliteMigrationCoordinator(db, through022)
  const before = await triggerNames(db)
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through022), [])
  assert.deepEqual(await triggerNames(db), before)
  const history = await db.selectFrom('kysely_migration').select('name').where('name', '=', '022_product_execution_evidence_guards').execute()
  assert.equal(history.length, 1)
  await closeDb()
})

test('TD069B-C-D-M3 a history-write failure rolls back every Migration 022 trigger', async () => {
  const db = await open(copy('rollback'))
  await sql.raw(`CREATE TRIGGER fail_022_history BEFORE INSERT ON kysely_migration WHEN NEW.name = '022_product_execution_evidence_guards' BEGIN SELECT RAISE(ABORT, 'forced 022 history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, through022), /forced 022 history failure/)
  assert.deepEqual((await triggerNames(db)).filter(name => name !== 'product_result_identity_immutable'), [])
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '022_product_execution_evidence_guards').execute()).length, 0)
  await closeDb()
})

test('TD069B-C-D-M4 partial schema-ahead guards are refused without automatic repair', async () => {
  const db = await open(copy('schema-ahead'))
  await sql.raw(`CREATE TRIGGER product_result_immutable_update BEFORE UPDATE ON test_results WHEN OLD.result_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Product Result evidence is immutable'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, through022), /Migration 022|Product evidence guards|022_product_execution_evidence_guards/i)
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '022_product_execution_evidence_guards').execute()).length, 0)
  await closeDb()
})
