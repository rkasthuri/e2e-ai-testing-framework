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

import * as path from 'path'
import * as fs from 'fs'
import { Kysely, SqliteDialect, PostgresDialect } from 'kysely'
import { Database } from './types'
import {
  DatabaseAuthorityMode,
  DatabaseAuthorityError,
  type ActiveDatabaseProvenance,
  type DatabaseAuthority,
  databaseAuthorityKey,
  databaseProvenance,
  disposableCertificationDatabaseAuthority,
  legacyRuntimeDatabaseAuthority,
  normalizeDatabasePath,
  productWorkspaceDatabaseAuthority,
} from './DatabaseAuthority'

let _db: Kysely<Database> | null = null
let _dbPath: string | null = null
let _authority: DatabaseAuthority | null = null
let _provenance: ActiveDatabaseProvenance | null = null

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..')

/**
 * Compatibility-only path resolver. It does not establish database authority.
 * Governed Product and legacy entry points use their named initializers.
 */
export function resolveSqlitePath(explicitPath?: string, startDir: string = process.cwd()): string {
  const configured = explicitPath || process.env.DB_PATH
  if (configured) return normalizeDatabasePath(configured)

  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.forge', 'forge.db')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(path.resolve(startDir), '.forge', 'forge.db')
}

/**
 * Legacy CLI/CI defaults to the repository authority, never to the caller's
 * nearest Product workspace. DB_PATH remains an explicit legacy override.
 */
export function resolveLegacyRuntimeSqlitePath(explicitPath?: string): string {
  const configured = explicitPath || process.env.DB_PATH
  return normalizeDatabasePath(configured ?? path.join(REPOSITORY_ROOT, '.forge', 'forge.db'))
}

export function getOpenSqlitePath(): string | null {
  return _dbPath
}

export function getDatabaseProvenance(): ActiveDatabaseProvenance {
  if (_provenance) return { ..._provenance }
  if (!_authority) {
    throw new DatabaseAuthorityError(
      'DATABASE_AUTHORITY_REQUIRED',
      'Database authority has not been established for this operation.',
    )
  }
  const dialect = _authority.mode === DatabaseAuthorityMode.LEGACY_RUNTIME
    && _authority.databaseUrl
    ? 'postgres'
    : 'sqlite'
  return databaseProvenance(_authority, dialect)
}

export function assertProductDatabaseAuthority(): ActiveDatabaseProvenance {
  const provenance = getDatabaseProvenance()
  if (!provenance.productSchemaEligible) {
    throw new DatabaseAuthorityError(
      'PRODUCT_DATABASE_AUTHORITY_REQUIRED',
      'Product persistence requires an explicitly governed Product workspace or disposable certification database.',
    )
  }
  return provenance
}

export function initDatabaseAuthority(authority: DatabaseAuthority): void {
  if (_authority) {
    if (databaseAuthorityKey(_authority) === databaseAuthorityKey(authority)) return
    throw new DatabaseAuthorityError(
      'DATABASE_AUTHORITY_CONFLICT',
      `Database authority ${_authority.mode} is already selected. Close it before selecting ${authority.mode}.`,
    )
  }
  _authority = Object.freeze({ ...authority }) as DatabaseAuthority
}

export function initProductWorkspaceDatabase(workspaceRoot: string, dbPath?: string): void {
  initDatabaseAuthority(productWorkspaceDatabaseAuthority(workspaceRoot, dbPath))
}

export function initLegacyRuntimeDatabase(input: {
  dbPath?: string
  databaseUrl?: string | null
  legacyImportRoot?: string
} = {}): void {
  initDatabaseAuthority(legacyRuntimeDatabaseAuthority({
    sqlitePath: resolveLegacyRuntimeSqlitePath(input.dbPath),
    databaseUrl: input.databaseUrl === undefined ? process.env.DB_URL ?? null : input.databaseUrl,
    legacyImportRoot: input.legacyImportRoot ?? process.cwd(),
  }))
}

export function initDisposableDatabase(dbPath: string): void {
  initDatabaseAuthority(disposableCertificationDatabaseAuthority(dbPath))
}

/**
 * Compatibility seam for existing certification tests. A path-only call means
 * DISPOSABLE_CERTIFICATION. Product and legacy callers must use their named
 * initializers so a location can never imply authority.
 *
 * @deprecated Use a named authority initializer.
 */
export function initDb(dbPath: string): void {
  initDisposableDatabase(dbPath)
}

/**
 * Return the process-local Kysely handle for the selected authority.
 *
 * An unscoped compatibility caller is contained as LEGACY_RUNTIME at the
 * repository authority. Product-specific repositories reject that mode.
 */
export function getDb(): Kysely<Database> {
  if (_db) return _db

  if (!_authority) initLegacyRuntimeDatabase()
  const authority = _authority!
  const dbUrl = authority.mode === DatabaseAuthorityMode.LEGACY_RUNTIME
    ? authority.databaseUrl
    : null
  const dbPath = authority.sqlitePath

  if (dbUrl) {
    const { Pool } = require('pg')
    _db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: dbUrl }),
      }),
    })
    _provenance = databaseProvenance(authority, 'postgres')
    console.log(`[storage] Using PostgreSQL [${authority.mode}]:`, dbUrl.replace(/:\/\/[^@]+@/, '://***@'))
  } else {
    if (dbPath !== ':memory:' && !dbPath.startsWith('file:')) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    try {
      const BetterSqlite3 = require('better-sqlite3')
      const sqlite = new BetterSqlite3(dbPath)
      try { sqlite.pragma('journal_mode = WAL') } catch { /* in-memory / unsupported */ }
      _db = new Kysely<Database>({
        dialect: new SqliteDialect({ database: sqlite }),
      })
      _dbPath = dbPath
      _provenance = databaseProvenance(authority, 'sqlite')
      console.log(`[storage] Using SQLite (better-sqlite3) [${authority.mode}]:`, dbPath)
    } catch {
      const { NodeWasmDialect } = require('kysely-wasm')
      const { Database: WasmDatabase } = require('node-sqlite3-wasm')
      const wasmDb = new WasmDatabase(dbPath)
      try { wasmDb.exec('PRAGMA journal_mode=WAL') } catch { /* best-effort */ }
      _db = new Kysely<Database>({
        dialect: new NodeWasmDialect({ database: wasmDb }),
      } as any)
      _dbPath = dbPath
      _provenance = databaseProvenance(authority, 'sqlite')
      console.log(`[storage] Using SQLite (node-sqlite3-wasm fallback) [${authority.mode}]:`, dbPath)
    }
  }

  return _db!
}

export function getProductDb(): Kysely<Database> {
  assertProductDatabaseAuthority()
  return getDb()
}

export async function closeDb(): Promise<void> {
  if (_db) await _db.destroy()
  _db = null
  _dbPath = null
  _authority = null
  _provenance = null
}
