/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import * as path from 'path';
import * as fs from 'fs';
import { Kysely, sql } from 'kysely';
import { getDb, closeDb, getOpenSqlitePath } from './db';

// Kysely's Migrator and migration types live in a subpath export (kysely/migration)
// that is not declared as a types path in kysely's package.json exports map under
// "moduleResolution": "node". We load it at runtime via require() and type it with
// `any` so that this file compiles cleanly without tsconfig changes.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Migrator } = require('kysely/migration') as { Migrator: new (args: any) => any };

/**
 * CJS-safe migration provider.
 *
 * Kysely's built-in FileMigrationProvider uses dynamic import() which can
 * fail in ts-node / tsx CJS mode. This provider uses require() instead,
 * which works correctly when executed via `tsx src/storage/migrate.ts`.
 */
class TsxMigrationProvider {
  constructor(private readonly migrationsDir: string) {}

  async getMigrations(): Promise<Record<string, { up: (db: any) => Promise<void>; down?: (db: any) => Promise<void> }>> {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .sort();

    const migrations: Record<string, any> = {};
    for (const file of files) {
      const name = file.replace(/\.(ts|js)$/, '');
      const fullPath = path.join(this.migrationsDir, file);
      migrations[name] = require(fullPath);
    }
    return migrations;
  }
}

const SINGLE_ACTIVE_MIGRATION = '016_app_models_single_active'
const OPERATION_IDENTITY_MIGRATION = '017_app_models_operation_identity'
const MIGRATION_TABLE = 'kysely_migration'
const MIGRATION_LOCK_TABLE = 'kysely_migration_lock'
const MIGRATION_LOCK_ID = 'migration_lock'

interface ForgeMigration {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

class MigrationStateMismatchError extends Error {
  constructor(readonly discrepancies: string[]) {
    super(`[migration] Refusing SQLite migration because schema and migration history disagree: ${discrepancies.join('; ')}. Do not repair or mark migrations applied automatically; restore the database from a verified backup before retrying.`)
    this.name = 'MigrationStateMismatchError'
  }
}

class AtomicMigrationError extends Error {
  constructor(readonly migrationName: string, message: string, options?: { cause?: unknown }) {
    super(`[migration] Atomic migration '${migrationName}' failed: ${message}`, options)
    this.name = 'AtomicMigrationError'
  }
}

interface IndexContract { present: boolean; valid: boolean; detail: string }

function stripOuterSqlParentheses(value: string): string {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let quote: string | null = null
    let enclosesWholeExpression = true
    for (let index = 0; index < result.length; index++) {
      const character = result[index]
      if (quote) {
        if (character === quote) {
          if (index + 1 < result.length && result[index + 1] === quote) index++
          else quote = null
        }
        continue
      }
      if (character === "'" || character === '"' || character === '`') quote = character
      else if (character === '[') quote = ']'
      else if (character === '(') depth++
      else if (character === ')') {
        depth--
        if (depth === 0 && index < result.length - 1) { enclosesWholeExpression = false; break }
      }
    }
    if (!enclosesWholeExpression || depth !== 0 || quote !== null) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function unquoteSqlIdentifier(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/""/g, '"')
  if (value.startsWith('`') && value.endsWith('`')) return value.slice(1, -1).replace(/``/g, '`')
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replace(/\]\]/g, ']')
  return value
}

function predicateFromIndexSql(indexSql: string | null): string | null {
  if (!indexSql) return null
  const where = indexSql.match(/\bWHERE\b([\s\S]*)$/i)
  return where ? stripOuterSqlParentheses(where[1].trim().replace(/;\s*$/, '')) : null
}

function isExactActivePredicate(indexSql: string | null): boolean {
  const predicate = predicateFromIndexSql(indexSql)
  if (!predicate) return false
  const equality = predicate.match(/^([A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])\s*=\s*('(?:[^']|'')*')$/)
  if (!equality) return false
  return unquoteSqlIdentifier(equality[1]).toLowerCase() === 'status'
    && equality[2].slice(1, -1).replace(/''/g, "'") === 'active'
}

function isExactOperationPredicate(indexSql: string | null): boolean {
  const predicate = predicateFromIndexSql(indexSql)
  if (!predicate) return false
  const match = predicate.match(/^([A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])\s+IS\s+NOT\s+NULL$/i)
  return Boolean(match && unquoteSqlIdentifier(match[1]).toLowerCase() === 'operation_id')
}

async function tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
  return (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}`.execute(db)).rows.length === 1
}

async function appModelColumns(db: Kysely<any>): Promise<Set<string>> {
  if (!await tableExists(db, 'app_models')) return new Set()
  return new Set((await sql<{ name: string }>`PRAGMA table_info(app_models)`.execute(db)).rows.map(row => row.name))
}

async function inspectIndex(
  db: Kysely<any>,
  indexName: 'idx_models_one_active' | 'idx_models_operation_identity',
  expectedColumns: string[],
  predicateValid: (definition: string | null) => boolean,
): Promise<IndexContract> {
  const definition = await sql<{ tbl_name: string; sql: string | null }>`SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ${indexName}`.execute(db)
  if (definition.rows.length === 0) return { present: false, valid: false, detail: `${indexName} is absent` }
  const list = await sql<{ name: string; unique: number; partial: number }>`PRAGMA index_list(app_models)`.execute(db)
  const listed = list.rows.find(row => row.name === indexName)
  const xinfo = indexName === 'idx_models_one_active'
    ? await sql<{ cid: number; name: string | null; coll: string | null; key: number }>`PRAGMA index_xinfo(idx_models_one_active)`.execute(db)
    : await sql<{ cid: number; name: string | null; coll: string | null; key: number }>`PRAGMA index_xinfo(idx_models_operation_identity)`.execute(db)
  const keyColumns = xinfo.rows.filter(row => Number(row.key) === 1)
  const names = keyColumns.map(row => row.name)
  const exactColumns = names.length === expectedColumns.length && names.every((name, index) => name === expectedColumns[index]) && keyColumns.every(row => Number(row.cid) >= 0)
  const valid = definition.rows[0].tbl_name === 'app_models' && Boolean(listed)
    && Number(listed?.unique) === 1 && Number(listed?.partial) === 1 && exactColumns
    && keyColumns.every(row => row.coll?.toUpperCase() === 'BINARY') && predicateValid(definition.rows[0].sql)
  return { present: true, valid, detail: valid ? `${indexName} matches its exact contract` : `${indexName} exists but does not match its exact table/unique/partial/column/collation/predicate contract` }
}

async function readAppliedMigrations(db: Kysely<any>): Promise<Array<{ name: string; timestamp: string }>> {
  if (!await tableExists(db, MIGRATION_TABLE)) return []
  const rows = await db.selectFrom(MIGRATION_TABLE).select(['name', 'timestamp']).execute() as Array<{ name: string; timestamp: string }>
  return rows.sort((left, right) => {
    const difference = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    return difference === 0 ? left.name.localeCompare(right.name) : difference
  })
}

async function ensureMigrationBookkeeping(db: Kysely<any>): Promise<void> {
  if (!await tableExists(db, MIGRATION_TABLE)) {
    await db.schema.createTable(MIGRATION_TABLE).addColumn('name', 'varchar(255)', column => column.notNull().primaryKey()).addColumn('timestamp', 'varchar(255)', column => column.notNull()).execute()
  }
  if (!await tableExists(db, MIGRATION_LOCK_TABLE)) {
    await db.schema.createTable(MIGRATION_LOCK_TABLE).addColumn('id', 'varchar(255)', column => column.notNull().primaryKey()).addColumn('is_locked', 'integer', column => column.notNull().defaultTo(0)).execute()
  }
  const lockRow = await db.selectFrom(MIGRATION_LOCK_TABLE).select('id').where('id', '=', MIGRATION_LOCK_ID).executeTakeFirst()
  if (!lockRow) await db.insertInto(MIGRATION_LOCK_TABLE).values({ id: MIGRATION_LOCK_ID, is_locked: 0 }).execute()
}

function assertMigrationOrder(migrationNames: string[], applied: Array<{ name: string; timestamp: string }>): void {
  for (let index = 0; index < applied.length; index++) {
    if (!migrationNames.includes(applied[index].name)) throw new MigrationStateMismatchError([`history contains '${applied[index].name}', but no matching migration file exists`])
    if (migrationNames[index] !== applied[index].name) throw new MigrationStateMismatchError([`history is not an ordered prefix: expected '${migrationNames[index] ?? '(none)'}' at position ${index + 1}, found '${applied[index].name}'`])
  }
}

async function assertManagedSchemaHistoryConsistency(db: Kysely<any>, appliedNames: Set<string>): Promise<void> {
  const migration016Applied = appliedNames.has(SINGLE_ACTIVE_MIGRATION)
  const migration017Applied = appliedNames.has(OPERATION_IDENTITY_MIGRATION)
  const columns = await appModelColumns(db)
  const activeIndex = await inspectIndex(db, 'idx_models_one_active', ['app_name'], isExactActivePredicate)
  const operationIndex = await inspectIndex(db, 'idx_models_operation_identity', ['app_name', 'operation_id'], isExactOperationPredicate)
  const discrepancies: string[] = []
  if (migration016Applied && !activeIndex.valid) discrepancies.push(`history says ${SINGLE_ACTIVE_MIGRATION} is applied, but ${activeIndex.detail}`)
  else if (!migration016Applied && activeIndex.present) discrepancies.push(`history says ${SINGLE_ACTIVE_MIGRATION} is pending, but ${activeIndex.detail}`)
  if (migration017Applied) {
    if (!columns.has('operation_id')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but operation_id is absent`)
    if (!columns.has('candidate_hash')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but candidate_hash is absent`)
    if (!operationIndex.valid) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but ${operationIndex.detail}`)
  } else {
    if (columns.has('operation_id')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but operation_id exists`)
    if (columns.has('candidate_hash')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but candidate_hash exists`)
    if (operationIndex.present) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but ${operationIndex.detail}`)
  }
  if (discrepancies.length > 0) throw new MigrationStateMismatchError(discrepancies)
}

async function assertMigrationPostconditions(db: Kysely<any>, migrationName: string): Promise<void> {
  const history = new Set((await readAppliedMigrations(db)).map(row => row.name))
  if (!history.has(migrationName)) throw new Error(`migration-history record '${migrationName}' is absent inside the transaction`)
  if (migrationName === SINGLE_ACTIVE_MIGRATION) {
    const duplicates = await sql<{ app_name: string }>`SELECT app_name FROM app_models WHERE status = 'active' GROUP BY app_name HAVING COUNT(*) > 1 ORDER BY app_name`.execute(db)
    if (duplicates.rows.length > 0) throw new Error(`duplicate-active postcondition failed for ${duplicates.rows.map(row => row.app_name).join(', ')}`)
    const index = await inspectIndex(db, 'idx_models_one_active', ['app_name'], isExactActivePredicate)
    if (!index.valid) throw new Error(index.detail)
  }
  if (migrationName === OPERATION_IDENTITY_MIGRATION) {
    const columns = await appModelColumns(db)
    if (!columns.has('operation_id') || !columns.has('candidate_hash')) throw new Error('operation_id and candidate_hash columns are not both present')
    const index = await inspectIndex(db, 'idx_models_operation_identity', ['app_name', 'operation_id'], isExactOperationPredicate)
    if (!index.valid) throw new Error(index.detail)
  }
}

export async function runSqliteMigrationCoordinator(db: Kysely<any>, migrations: Record<string, ForgeMigration>, beforePending?: () => Promise<unknown>): Promise<string[]> {
  await ensureMigrationBookkeeping(db)
  const migrationNames = Object.keys(migrations).sort()
  let applied = await readAppliedMigrations(db)
  assertMigrationOrder(migrationNames, applied)
  await assertManagedSchemaHistoryConsistency(db, new Set(applied.map(row => row.name)))
  const pending = migrationNames.slice(applied.length)
  if (pending.length === 0) return []
  if (beforePending) await beforePending()
  const completed: string[] = []
  for (const migrationName of pending) {
    await db.connection().execute(async connection => {
      let transactionOpen = false
      try {
        await sql.raw('BEGIN IMMEDIATE').execute(connection)
        transactionOpen = true
        const currentApplied = await readAppliedMigrations(connection)
        assertMigrationOrder(migrationNames, currentApplied)
        await assertManagedSchemaHistoryConsistency(connection, new Set(currentApplied.map(row => row.name)))
        if (currentApplied.length !== applied.length) throw new MigrationStateMismatchError([`migration history changed after coordinator preflight; expected ${applied.length} rows, found ${currentApplied.length}`])
        await migrations[migrationName].up(connection)
        await connection.insertInto(MIGRATION_TABLE).values({ name: migrationName, timestamp: new Date().toISOString() }).execute()
        await assertMigrationPostconditions(connection, migrationName)
        await sql.raw('COMMIT').execute(connection)
        transactionOpen = false
      } catch (cause) {
        let rollbackFailure: unknown
        if (transactionOpen) try { await sql.raw('ROLLBACK').execute(connection) } catch (error) { rollbackFailure = error }
        const message = cause instanceof Error ? cause.message : String(cause)
        const rollback = rollbackFailure ? ` Rollback also failed: ${rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)}.` : ''
        throw new AtomicMigrationError(migrationName, `${message}${rollback}`, { cause })
      }
    })
    completed.push(migrationName)
    applied = [...applied, { name: migrationName, timestamp: new Date().toISOString() }]
  }
  return completed
}

interface SqliteBackupSummary {
  quickCheck: string
  schema: Array<{ name: string; sql: string | null }>
  rowCounts: Array<{ name: string; count: number }>
  migrations: string[]
}

function inspectSqliteBackup(dbPath: string): SqliteBackupSummary {
  const BetterSqlite3 = require('better-sqlite3')
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    const quickCheck = String(sqlite.pragma('quick_check', { simple: true }))
    const schema = sqlite.prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all() as Array<{ name: string; sql: string | null }>
    const rowCounts = schema.map(({ name }) => {
      const quoted = `"${name.replace(/"/g, '""')}"`
      const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get() as { count: number }
      return { name, count: Number(row.count) }
    })
    const migrations = schema.some(table => table.name === 'kysely_migration')
      ? (sqlite.prepare('SELECT name FROM kysely_migration ORDER BY name').all() as Array<{ name: string }>).map(row => row.name)
      : []
    return { quickCheck, schema, rowCounts, migrations }
  } finally {
    sqlite.close()
  }
}

async function createVerifiedBackupBefore016(db: any): Promise<string | null> {
  if (process.env.DB_URL) return null

  let applied: string[]
  try {
    const rows = await db.selectFrom('kysely_migration').select('name').orderBy('name').execute()
    applied = rows.map((row: { name: string }) => row.name)
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table: kysely_migration')) return null
    throw new Error('[migration] Could not inspect migration history before backup.', { cause })
  }

  if (!applied.includes('015_app_models_crawled_by_nullable') || applied.includes(SINGLE_ACTIVE_MIGRATION)) {
    return null
  }

  const dbPath = getOpenSqlitePath()
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith('file:')) return null

  const sourceBefore = inspectSqliteBackup(dbPath)
  if (sourceBefore.quickCheck !== 'ok') {
    throw new Error(`[migration] Refusing migration 016: source SQLite quick_check returned '${sourceBefore.quickCheck}'.`)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${dbPath}.pre-016-${stamp}.bak`
  if (fs.existsSync(backupPath)) {
    throw new Error(`[migration] Refusing to overwrite existing backup: ${backupPath}`)
  }

  await sql`VACUUM INTO ${backupPath}`.execute(db)

  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`[migration] Backup was not created correctly: ${backupPath}`)
  }

  const backup = inspectSqliteBackup(backupPath)
  const sourceSignature = JSON.stringify({ schema: sourceBefore.schema, rowCounts: sourceBefore.rowCounts, migrations: sourceBefore.migrations })
  const backupSignature = JSON.stringify({ schema: backup.schema, rowCounts: backup.rowCounts, migrations: backup.migrations })
  if (backup.quickCheck !== 'ok' || backupSignature !== sourceSignature) {
    throw new Error(`[migration] Backup verification failed; original database was not migrated. Backup: ${backupPath}`)
  }

  console.log(`[migration] Verified pre-016 backup: ${backupPath}`)
  return backupPath
}
async function runKyselyMigrations(db: any, migrationsDir: string): Promise<void> {
  const migrator = new Migrator({ db, provider: new TsxMigrationProvider(migrationsDir) });
  const { error, results } = (await migrator.migrateToLatest()) as { error: unknown; results: Array<{ migrationName: string; status: 'Success' | 'Error' | 'NotMigrated' }> };
  if (results && results.length > 0) for (const result of results) {
    if (result.status === 'Success') console.log(`[migration] SUCCESS ${result.migrationName}`);
    else if (result.status === 'Error') console.error(`[migration] ERROR ${result.migrationName}`);
  }
  else console.log('[migration] Already up to date.');
  if (error) { console.error('[migration] Fatal error:', error); throw error; }
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (process.env.DB_URL) { await runKyselyMigrations(db, migrationsDir); return }
  const migrations = await new TsxMigrationProvider(migrationsDir).getMigrations()
  const completed = await runSqliteMigrationCoordinator(db, migrations, () => createVerifiedBackupBefore016(db))
  if (completed.length === 0) console.log('[migration] Already up to date.');
  else for (const migrationName of completed) console.log(`[migration] SUCCESS ${migrationName}`)
}

// ── CLI entry-point ───────────────────────────────────────────────────────────
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[migration] Done.');
      return closeDb();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[migration] Unhandled error:', err);
      process.exit(1);
    });
}
