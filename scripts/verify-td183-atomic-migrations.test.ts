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
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Kysely, sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import {
  runMigrations,
  runSqliteMigrationCoordinator,
} from '../src/core/storage/migrate'

interface ForgeMigration {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td183-'))
const PRE_016_TEMPLATE = path.join(ROOT, 'pre-016-template.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')

function loadMigrations(): Record<string, ForgeMigration> {
  const migrations: Record<string, ForgeMigration> = {}
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.ts')).sort()) {
    migrations[file.replace(/\.ts$/, '')] = require(path.join(MIGRATIONS_DIR, file))
  }
  return migrations
}

const allMigrations = loadMigrations()
const through = (last: string): Record<string, ForgeMigration> => Object.fromEntries(
  Object.entries(allMigrations).filter(([name]) => name <= last),
)

async function openDatabase(dbPath: string): Promise<Kysely<any>> {
  initDb(dbPath)
  return getDb() as unknown as Kysely<any>
}

async function history(db: Kysely<any>): Promise<string[]> {
  return (await db.selectFrom('kysely_migration').select('name').orderBy('name').execute()).map((row: any) => row.name)
}

async function columns(db: Kysely<any>): Promise<string[]> {
  return (await sql<{ name: string }>`PRAGMA table_info(app_models)`.execute(db)).rows.map(row => row.name)
}

async function indexes(db: Kysely<any>): Promise<string[]> {
  return (await sql<{ name: string }>`PRAGMA index_list(app_models)`.execute(db)).rows.map(row => row.name)
}

function copyTemplate(name: string): string {
  const target = path.join(ROOT, `${name}.db`)
  fs.copyFileSync(PRE_016_TEMPLATE, target)
  return target
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

before(async () => {
  const db = await openDatabase(PRE_016_TEMPLATE)
  await runSqliteMigrationCoordinator(db, through('015_app_models_crawled_by_nullable'))
  await closeDb()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD183-1 migration body and history insert commit together', async () => {
  const db = await openDatabase(path.join(ROOT, 'atomic-commit.db'))
  await runSqliteMigrationCoordinator(db, {
    '001_atomic_commit': { up: async connection => { await sql`CREATE TABLE atomic_commit (id INTEGER)`.execute(connection) } },
  })
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'atomic_commit'`.execute(db)).rows.length, 1)
  assert.deepEqual(await history(db), ['001_atomic_commit'])
  await closeDb()
})

test('TD183-2 migration-body failure rolls back schema', async () => {
  const db = await openDatabase(path.join(ROOT, 'body-failure.db'))
  await assert.rejects(runSqliteMigrationCoordinator(db, {
    '001_body_failure': { up: async connection => {
      await sql`CREATE TABLE body_failure (id INTEGER)`.execute(connection)
      throw new Error('forced body failure')
    } },
  }), (error: unknown) => error instanceof Error
    && error.name === 'AtomicMigrationError'
    && error.message.includes('forced body failure'))
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'body_failure'`.execute(db)).rows.length, 0)
  assert.deepEqual(await history(db), [])
  await closeDb()
})

test('TD183-3 history-insert failure rolls back schema', async () => {
  const db = await openDatabase(path.join(ROOT, 'history-failure.db'))
  await runSqliteMigrationCoordinator(db, {})
  await sql.raw(`CREATE TRIGGER fail_history BEFORE INSERT ON kysely_migration BEGIN SELECT RAISE(ABORT, 'forced history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, {
    '001_history_failure': { up: async connection => { await sql`CREATE TABLE history_failure (id INTEGER)`.execute(connection) } },
  }), /forced history failure/)
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'history_failure'`.execute(db)).rows.length, 0)
  assert.deepEqual(await history(db), [])
  await closeDb()
})

test('TD183-4 Migration 016 cannot leave only its index behind', async () => {
  const db = await openDatabase(copyTemplate('migration-016-history-failure'))
  await sql.raw(`CREATE TRIGGER fail_016_history BEFORE INSERT ON kysely_migration WHEN NEW.name = '016_app_models_single_active' BEGIN SELECT RAISE(ABORT, 'forced 016 history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, allMigrations), /forced 016 history failure/)
  assert.equal((await indexes(db)).includes('idx_models_one_active'), false)
  assert.equal((await history(db)).includes('016_app_models_single_active'), false)
  await closeDb()
})

test('TD183-5 Migration 017 cannot leave one column behind', async () => {
  const db = await openDatabase(copyTemplate('migration-017-one-column'))
  await runSqliteMigrationCoordinator(db, through('016_app_models_single_active'))
  const migrations = { ...through('016_app_models_single_active'), '017_app_models_operation_identity': { up: async (connection: Kysely<any>) => {
    await sql`ALTER TABLE app_models ADD COLUMN operation_id TEXT`.execute(connection)
    throw new Error('forced after first 017 column')
  } } }
  await assert.rejects(runSqliteMigrationCoordinator(db, migrations), /forced after first 017 column/)
  assert.equal((await columns(db)).includes('operation_id'), false)
  assert.equal((await history(db)).includes('017_app_models_operation_identity'), false)
  await closeDb()
})

test('TD183-6 Migration 017 cannot leave columns without its index', async () => {
  const db = await openDatabase(copyTemplate('migration-017-columns'))
  await runSqliteMigrationCoordinator(db, through('016_app_models_single_active'))
  const migrations = { ...through('016_app_models_single_active'), '017_app_models_operation_identity': { up: async (connection: Kysely<any>) => {
    await sql`ALTER TABLE app_models ADD COLUMN operation_id TEXT`.execute(connection)
    await sql`ALTER TABLE app_models ADD COLUMN candidate_hash TEXT`.execute(connection)
    throw new Error('forced before 017 index')
  } } }
  await assert.rejects(runSqliteMigrationCoordinator(db, migrations), /forced before 017 index/)
  assert.equal((await columns(db)).includes('operation_id'), false)
  assert.equal((await columns(db)).includes('candidate_hash'), false)
  assert.equal((await indexes(db)).includes('idx_models_operation_identity'), false)
  await closeDb()
})

test('TD183-7 schema ahead of history is refused without repair', async () => {
  const db = await openDatabase(copyTemplate('schema-ahead'))
  await sql`CREATE UNIQUE INDEX idx_models_one_active ON app_models (app_name) WHERE status = 'active'`.execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, allMigrations), (error: unknown) => error instanceof Error
    && error.name === 'MigrationStateMismatchError'
    && error.message.includes('history says 016_app_models_single_active is pending') && error.message.includes('verified backup'))
  assert.equal((await history(db)).includes('016_app_models_single_active'), false)
  await closeDb()
})

test('TD183-8 history ahead of schema is refused without inference', async () => {
  const db = await openDatabase(copyTemplate('history-ahead'))
  await db.insertInto('kysely_migration').values({ name: '016_app_models_single_active', timestamp: new Date().toISOString() }).execute()
  await assert.rejects(runSqliteMigrationCoordinator(db, allMigrations), (error: unknown) => error instanceof Error
    && error.name === 'MigrationStateMismatchError'
    && error.message.includes('history says 016_app_models_single_active is applied') && error.message.includes('idx_models_one_active is absent'))
  assert.equal((await indexes(db)).includes('idx_models_one_active'), false)
  await closeDb()
})

test('TD183-9 exact valid pre-016 state migrates successfully', async () => {
  const db = await openDatabase(copyTemplate('valid-pre-016'))
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through('016_app_models_single_active')), ['016_app_models_single_active'])
  assert.equal((await indexes(db)).includes('idx_models_one_active'), true)
  assert.equal((await history(db)).includes('016_app_models_single_active'), true)
  await closeDb()
})

test('TD183-10 Migration 016 followed by 017 succeeds in order', async () => {
  const db = await openDatabase(copyTemplate('016-then-017'))
  assert.deepEqual(
    await runSqliteMigrationCoordinator(db, through('017_app_models_operation_identity')),
    ['016_app_models_single_active', '017_app_models_operation_identity'],
  )
  assert.equal((await columns(db)).includes('operation_id'), true)
  assert.equal((await columns(db)).includes('candidate_hash'), true)
  assert.equal((await indexes(db)).includes('idx_models_one_active'), true)
  assert.equal((await indexes(db)).includes('idx_models_operation_identity'), true)
  assert.deepEqual((await history(db)).slice(-2), ['016_app_models_single_active', '017_app_models_operation_identity'])
  await closeDb()
})

test('TD183-11 retry after rolled-back failure is deterministic', async () => {
  const db = await openDatabase(path.join(ROOT, 'deterministic-retry.db'))
  let attempts = 0
  const migrations = { '001_retry': { up: async (connection: Kysely<any>) => {
    attempts++
    await sql`CREATE TABLE retry_target (id INTEGER)`.execute(connection)
    if (attempts === 1) throw new Error('retry once')
  } } }
  await assert.rejects(runSqliteMigrationCoordinator(db, migrations), /retry once/)
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'retry_target'`.execute(db)).rows.length, 0)
  assert.deepEqual(await runSqliteMigrationCoordinator(db, migrations), ['001_retry'])
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = 'retry_target'`.execute(db)).rows.length, 1)
  assert.deepEqual(await history(db), ['001_retry'])
  await closeDb()
})

test('TD183-12 later migrations do not execute after failure', async () => {
  const db = await openDatabase(path.join(ROOT, 'stop-after-failure.db'))
  let laterRan = false
  await assert.rejects(runSqliteMigrationCoordinator(db, {
    '001_fails': { up: async connection => { await sql`CREATE TABLE first_target (id INTEGER)`.execute(connection); throw new Error('stop here') } },
    '002_must_not_run': { up: async connection => { laterRan = true; await sql`CREATE TABLE later_target (id INTEGER)`.execute(connection) } },
  }), /stop here/)
  assert.equal(laterRan, false)
  assert.equal((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name IN ('first_target', 'later_target')`.execute(db)).rows.length, 0)
  assert.deepEqual(await history(db), [])
  await closeDb()
})

test('TD183-13 existing fully migrated databases remain byte-for-byte unchanged', async () => {
  const dbPath = copyTemplate('fully-migrated')
  let db = await openDatabase(dbPath)
  await runSqliteMigrationCoordinator(db, allMigrations)
  await closeDb()
  const before = hashFile(dbPath)
  db = await openDatabase(dbPath)
  assert.deepEqual(await runSqliteMigrationCoordinator(db, allMigrations), [])
  await closeDb()
  assert.equal(hashFile(dbPath), before)
})

test('TD183-14 verified pre-016 backup behavior remains intact', async () => {
  const dbPath = copyTemplate('backup-policy')
  await openDatabase(dbPath)
  await runMigrations()
  await closeDb()
  const backups = fs.readdirSync(ROOT).filter(file => file.startsWith('backup-policy.db.pre-016-') && file.endsWith('.bak'))
  assert.equal(backups.length, 1)
  const backup = require('better-sqlite3')(path.join(ROOT, backups[0]), { readonly: true, fileMustExist: true })
  try {
    assert.equal(backup.pragma('quick_check', { simple: true }), 'ok')
    const names = backup.prepare('SELECT name FROM kysely_migration ORDER BY name').all().map((row: any) => row.name)
    assert.equal(names.includes('016_app_models_single_active'), false)
    assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_models_one_active'").get(), undefined)
  } finally { backup.close() }
})
