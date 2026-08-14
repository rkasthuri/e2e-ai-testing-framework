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

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import {
  closeDb,
  getDatabaseProvenance,
  getDb,
  getProductDb,
  initDisposableDatabase,
  initLegacyRuntimeDatabase,
  initProductWorkspaceDatabase,
} from '../src/core/storage/db'
import {
  CURRENT_PRODUCT_MIGRATION_CEILING,
  DatabaseAuthorityError,
  DatabaseAuthorityMode,
  LEGACY_POSTGRES_MIGRATION_CEILING,
  databaseProvenance,
  legacyRuntimeDatabaseAuthority,
} from '../src/core/storage/DatabaseAuthority'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { runMigrations, runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-001-'))
const ORIGINAL_CWD = process.cwd()
const ORIGINAL_DB_URL = process.env.DB_URL

async function inDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true })
  const previous = process.cwd()
  process.chdir(directory)
  try {
    return await action()
  } finally {
    process.chdir(previous)
  }
}

function restoreDbUrl(): void {
  if (ORIGINAL_DB_URL === undefined) delete process.env.DB_URL
  else process.env.DB_URL = ORIGINAL_DB_URL
}

async function tableCount(table: 'runs' | 'heal_events'): Promise<number> {
  const result = await sql<{ count: number }>`SELECT COUNT(*) AS count FROM ${sql.table(table)}`.execute(getDb())
  return Number(result.rows[0].count)
}

async function migrationNames(): Promise<string[]> {
  return (await getDb().selectFrom('kysely_migration').select('name').orderBy('name').execute())
    .map(row => row.name)
}

interface LogicalSnapshot {
  schema: Array<{ type: string; name: string; tableName: string; definition: string | null }>
  migrations: string[]
  seeds: Array<{ key: string; value: string; valueType: string }>
  authorityTables: Record<string, number>
}

function logicalSnapshot(dbPath: string): LogicalSnapshot {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3')
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    const schema = sqlite.prepare(`
      SELECT type, name, tbl_name AS tableName, sql AS definition
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as LogicalSnapshot['schema']
    const migrations = (sqlite.prepare('SELECT name FROM kysely_migration ORDER BY name').all() as Array<{ name: string }>)
      .map(row => row.name)
    const seeds = sqlite.prepare(`
      SELECT key, value, value_type AS valueType
      FROM framework_config
      ORDER BY key
    `).all() as LogicalSnapshot['seeds']
    const authorityTables: Record<string, number> = {}
    for (const table of ['runs', 'heal_events', 'executions', 'execution_items', 'execution_events', 'execution_locks']) {
      authorityTables[table] = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
    }
    return { schema, migrations, seeds, authorityTables }
  } finally {
    sqlite.close()
  }
}

function writeLegacyFixture(root: string, runId: string): void {
  const reports = path.join(root, 'reports')
  fs.mkdirSync(reports, { recursive: true })
  fs.writeFileSync(path.join(reports, 'run-history.json'), JSON.stringify({
    created: '2026-01-01T00:00:00.000Z',
    runs: [{
      runId,
      appName: 'legacy-fixture',
      timestamp: '2026-01-01T00:00:00.000Z',
      durationMs: 12,
      status: 'passed',
      stats: { total: 1, passed: 1, failed: 0, skipped: 0 },
    }],
  }), 'utf8')
  fs.writeFileSync(path.join(reports, 'heal-store.json'), JSON.stringify({
    fixture: {
      runId,
      page: 'inventory',
      element: 'legacy-button',
      originalStrategy: '#old',
      healedSelector: '#new',
      source: 'smart-locator',
      confidence: 0.9,
      consecutiveSuccesses: 1,
      promoted: false,
      firstHealed: '2026-01-01T00:00:00.000Z',
    },
  }), 'utf8')
}

after(async () => {
  await closeDb()
  process.chdir(ORIGINAL_CWD)
  restoreDbUrl()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD-ARCH-001-1 Product persistence refuses an absent or invalid explicit authority', async () => {
  await closeDb()
  assert.throws(
    () => getProductDb(),
    (error: unknown) => error instanceof DatabaseAuthorityError
      && error.code === 'DATABASE_AUTHORITY_REQUIRED',
  )
  const workspaceRoot = path.join(ROOT, 'invalid-product')
  assert.throws(
    () => initProductWorkspaceDatabase(workspaceRoot, path.join(workspaceRoot, 'wrong.db')),
    (error: unknown) => error instanceof DatabaseAuthorityError
      && error.code === 'INVALID_PRODUCT_WORKSPACE_AUTHORITY',
  )
  assert.equal(fs.existsSync(workspaceRoot), false)
})

test('TD-ARCH-001-2 a clean Product workspace reaches the current ceiling without legacy import', async () => {
  const dirtyCwd = path.join(ROOT, 'dirty-product-cwd')
  writeLegacyFixture(dirtyCwd, 'must-not-import-product')
  const workspace = createWorkspace(path.join(ROOT, 'product-clean'))
  process.env.DB_URL = 'postgresql://invalid:invalid@127.0.0.1:1/must-not-be-used'
  await inDirectory(dirtyCwd, async () => {
    await openProjectDatabase(workspace)
    const provenance = getDatabaseProvenance()
    assert.equal(provenance.authorityMode, DatabaseAuthorityMode.PRODUCT_WORKSPACE)
    assert.equal(provenance.sqlitePath, workspace.dbPath())
    assert.equal(provenance.workspaceRoot, workspace.root)
    assert.equal(provenance.migrationCeiling, CURRENT_PRODUCT_MIGRATION_CEILING)
    assert.equal(provenance.legacyImportAllowed, false)
    assert.equal(provenance.databaseUrlAllowed, false)
    assert.equal(await tableCount('runs'), 0)
    assert.equal(await tableCount('heal_events'), 0)
    const migrations = await migrationNames()
    assert.equal(migrations.at(-1), CURRENT_PRODUCT_MIGRATION_CEILING)
    assert.equal(migrations.includes('004_json_import'), true)
  })
  await closeDb()
  restoreDbUrl()
})

test('TD-ARCH-001-3 disposable certification is hermetic and ignores cwd plus DB_URL', async () => {
  const dirtyCwd = path.join(ROOT, 'dirty-disposable-cwd')
  writeLegacyFixture(dirtyCwd, 'must-not-import-disposable')
  const dbPath = path.join(ROOT, 'disposable', 'certification.db')
  process.env.DB_URL = 'postgresql://invalid:invalid@127.0.0.1:1/must-not-be-used'
  await inDirectory(dirtyCwd, async () => {
    initDisposableDatabase(dbPath)
    await runMigrations()
    const provenance = getDatabaseProvenance()
    assert.equal(provenance.authorityMode, DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION)
    assert.equal(provenance.migrationCeiling, CURRENT_PRODUCT_MIGRATION_CEILING)
    assert.equal(provenance.legacyImportAllowed, false)
    assert.equal(await tableCount('runs'), 0)
    assert.equal(await tableCount('heal_events'), 0)
    assert.equal((await migrationNames()).at(-1), CURRENT_PRODUCT_MIGRATION_CEILING)
  })
  await closeDb()
  restoreDbUrl()
})

test('TD-ARCH-001-4 governed legacy runtime retains Migration 004 import without Product eligibility', async () => {
  const legacyRoot = path.join(ROOT, 'legacy-runtime')
  const dbPath = path.join(legacyRoot, 'legacy.db')
  writeLegacyFixture(legacyRoot, 'legacy-imported-run')
  await inDirectory(legacyRoot, async () => {
    initLegacyRuntimeDatabase({ dbPath, databaseUrl: null, legacyImportRoot: legacyRoot })
    await runMigrations()
    const provenance = getDatabaseProvenance()
    assert.equal(provenance.authorityMode, DatabaseAuthorityMode.LEGACY_RUNTIME)
    assert.equal(provenance.legacyImportAllowed, true)
    assert.equal(provenance.productSchemaEligible, false)
    assert.equal(await tableCount('runs'), 1)
    assert.equal(await tableCount('heal_events'), 1)
    const run = await getDb().selectFrom('runs').select(['run_id', 'origin']).executeTakeFirstOrThrow()
    assert.deepEqual(run, { run_id: 'legacy-imported-run', origin: 'legacy' })
    assert.throws(
      () => getProductDb(),
      (error: unknown) => error instanceof DatabaseAuthorityError
        && error.code === 'PRODUCT_DATABASE_AUTHORITY_REQUIRED',
    )
  })
  await closeDb()
})

test('TD-ARCH-001-5 a changed legacy import root refuses before opening or migrating', async () => {
  const selectedRoot = path.join(ROOT, 'legacy-selected-root')
  const changedRoot = path.join(ROOT, 'legacy-changed-root')
  const dbPath = path.join(ROOT, 'legacy-context-refusal.db')
  fs.mkdirSync(selectedRoot, { recursive: true })
  fs.mkdirSync(changedRoot, { recursive: true })
  initLegacyRuntimeDatabase({ dbPath, databaseUrl: null, legacyImportRoot: selectedRoot })
  await assert.rejects(
    inDirectory(changedRoot, () => runMigrations()),
    (error: unknown) => error instanceof DatabaseAuthorityError
      && error.code === 'LEGACY_IMPORT_CONTEXT_CHANGED',
  )
  assert.equal(fs.existsSync(dbPath), false)
  await closeDb()
})

test('TD-ARCH-001-6 authority provenance fixes mode, location, ceiling, and import policy', async () => {
  const legacyPostgres = databaseProvenance(legacyRuntimeDatabaseAuthority({
    sqlitePath: path.join(ROOT, 'unused-legacy.db'),
    databaseUrl: 'postgresql://authority-only.invalid/forge',
    legacyImportRoot: ROOT,
  }), 'postgres')
  assert.equal(legacyPostgres.authorityMode, DatabaseAuthorityMode.LEGACY_RUNTIME)
  assert.equal(legacyPostgres.migrationCeiling, LEGACY_POSTGRES_MIGRATION_CEILING)
  assert.equal(legacyPostgres.productSchemaEligible, false)
  assert.equal(legacyPostgres.databaseUrlAllowed, true)

  const first = path.join(ROOT, 'authority-one.db')
  const second = path.join(ROOT, 'authority-two.db')
  initDisposableDatabase(first)
  assert.throws(
    () => initDisposableDatabase(second),
    (error: unknown) => error instanceof DatabaseAuthorityError
      && error.code === 'DATABASE_AUTHORITY_CONFLICT',
  )
  assert.equal(fs.existsSync(first), false)
  assert.equal(fs.existsSync(second), false)
  await closeDb()
})

test('TD-ARCH-001-7 two Product workspaces cannot cross-contaminate', async () => {
  const workspaceA = createWorkspace(path.join(ROOT, 'workspace-a'))
  const workspaceB = createWorkspace(path.join(ROOT, 'workspace-b'))
  await openProjectDatabase(workspaceA)
  await getDb().insertInto('framework_config').values({
    key: 'td.arch001.workspace.marker',
    value: 'workspace-a',
    value_type: 'string',
    category: 'certification',
    description: 'Disposable cross-workspace isolation marker.',
    allowed_values: null,
    default_value: 'workspace-a',
    updated_by: 'certification',
    updated_at: '2026-08-11T00:00:00.000Z',
  }).execute()
  await closeDb()

  await openProjectDatabase(workspaceB)
  const absent = await getDb().selectFrom('framework_config').select('value')
    .where('key', '=', 'td.arch001.workspace.marker').executeTakeFirst()
  assert.equal(absent, undefined)
  await closeDb()

  await openProjectDatabase(workspaceA)
  const preserved = await getDb().selectFrom('framework_config').select('value')
    .where('key', '=', 'td.arch001.workspace.marker').executeTakeFirstOrThrow()
  assert.equal(preserved.value, 'workspace-a')
  await closeDb()
})

test('TD-ARCH-001-8 Product initialization is invariant across cwd, legacy content, DB_URL, and unrelated DBs', async () => {
  const dirtyA = path.join(ROOT, 'invariant-cwd-a')
  const dirtyB = path.join(ROOT, 'invariant-cwd-b')
  writeLegacyFixture(dirtyA, 'invariant-run-a')
  writeLegacyFixture(dirtyB, 'invariant-run-b')
  fs.writeFileSync(path.join(dirtyB, 'unrelated-legacy.db'), 'unrelated legacy bytes', 'utf8')

  const workspaceA = createWorkspace(path.join(ROOT, 'invariant-product-a'))
  process.env.DB_URL = 'postgresql://first.invalid/ignored'
  await inDirectory(dirtyA, () => openProjectDatabase(workspaceA))
  await closeDb()
  const snapshotA = logicalSnapshot(workspaceA.dbPath())

  const workspaceB = createWorkspace(path.join(ROOT, 'invariant-product-b'))
  process.env.DB_URL = 'postgresql://second.invalid/also-ignored'
  await inDirectory(dirtyB, () => openProjectDatabase(workspaceB))
  await closeDb()
  const snapshotB = logicalSnapshot(workspaceB.dbPath())
  restoreDbUrl()

  assert.deepEqual(snapshotB, snapshotA)
  assert.equal(snapshotA.authorityTables.runs, 0)
  assert.equal(snapshotA.authorityTables.heal_events, 0)

  // Restart/idempotency: the same Product authority reopens without logical drift.
  await openProjectDatabase(workspaceA)
  await closeDb()
  assert.deepEqual(logicalSnapshot(workspaceA.dbPath()), snapshotA)
})

test('TD-ARCH-001-9 migration failure remains transaction-atomic under disposable authority', async () => {
  const dbPath = path.join(ROOT, 'atomic-rollback.db')
  initDisposableDatabase(dbPath)
  const db = getDb()
  await assert.rejects(runSqliteMigrationCoordinator(db, {
    '001_forced_failure': {
      up: async connection => {
        await sql`CREATE TABLE must_rollback (id INTEGER)`.execute(connection)
        throw new Error('forced authority migration failure')
      },
    },
  }), /forced authority migration failure/)
  const table = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'must_rollback'
  `.execute(db)
  const history = await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)
  assert.equal(table.rows.length, 0)
  assert.equal(history.rows.length, 0)
  await closeDb()
})
