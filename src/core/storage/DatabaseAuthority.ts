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

export const CURRENT_PRODUCT_MIGRATION_CEILING = '035_suite_v2_multi_source_execution_authority'
export const LEGACY_POSTGRES_MIGRATION_CEILING = '020_execution_lifecycle'

export enum DatabaseAuthorityMode {
  PRODUCT_WORKSPACE = 'PRODUCT_WORKSPACE',
  LEGACY_RUNTIME = 'LEGACY_RUNTIME',
  DISPOSABLE_CERTIFICATION = 'DISPOSABLE_CERTIFICATION',
}

export interface ProductWorkspaceDatabaseAuthority {
  readonly mode: DatabaseAuthorityMode.PRODUCT_WORKSPACE
  readonly workspaceRoot: string
  readonly sqlitePath: string
}

export interface LegacyRuntimeDatabaseAuthority {
  readonly mode: DatabaseAuthorityMode.LEGACY_RUNTIME
  readonly sqlitePath: string
  readonly databaseUrl: string | null
  readonly legacyImportRoot: string
}

export interface DisposableCertificationDatabaseAuthority {
  readonly mode: DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION
  readonly sqlitePath: string
}

export type DatabaseAuthority =
  | ProductWorkspaceDatabaseAuthority
  | LegacyRuntimeDatabaseAuthority
  | DisposableCertificationDatabaseAuthority

export type DatabaseDialect = 'sqlite' | 'postgres'

export interface ActiveDatabaseProvenance {
  authorityMode: DatabaseAuthorityMode
  dialect: DatabaseDialect
  sqlitePath: string | null
  workspaceRoot: string | null
  migrationCeiling: string
  legacyImportAllowed: boolean
  legacyImportRoot: string | null
  productSchemaEligible: boolean
  databaseUrlAllowed: boolean
}

export class DatabaseAuthorityError extends Error {
  constructor(readonly code:
    | 'DATABASE_AUTHORITY_REQUIRED'
    | 'INVALID_PRODUCT_WORKSPACE_AUTHORITY'
    | 'DATABASE_AUTHORITY_CONFLICT'
    | 'PRODUCT_DATABASE_AUTHORITY_REQUIRED'
    | 'LEGACY_IMPORT_CONTEXT_CHANGED', message: string) {
    super(message)
    this.name = 'DatabaseAuthorityError'
  }
}

export function normalizeDatabasePath(value: string): string {
  if (value === ':memory:' || value.startsWith('file:')) return value
  return path.resolve(value)
}

export function productWorkspaceDatabaseAuthority(
  workspaceRoot: string,
  sqlitePath?: string,
): ProductWorkspaceDatabaseAuthority {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) {
    throw new DatabaseAuthorityError(
      'INVALID_PRODUCT_WORKSPACE_AUTHORITY',
      'Product database authority requires an explicit workspace root.',
    )
  }
  const root = path.resolve(workspaceRoot)
  const expectedPath = path.join(root, '.forge', 'forge.db')
  const resolvedPath = normalizeDatabasePath(sqlitePath ?? expectedPath)
  if (resolvedPath !== expectedPath) {
    throw new DatabaseAuthorityError(
      'INVALID_PRODUCT_WORKSPACE_AUTHORITY',
      'Product database authority must resolve exactly to the selected workspace .forge/forge.db.',
    )
  }
  return {
    mode: DatabaseAuthorityMode.PRODUCT_WORKSPACE,
    workspaceRoot: root,
    sqlitePath: expectedPath,
  }
}

export function legacyRuntimeDatabaseAuthority(input: {
  sqlitePath: string
  databaseUrl?: string | null
  legacyImportRoot?: string
}): LegacyRuntimeDatabaseAuthority {
  return {
    mode: DatabaseAuthorityMode.LEGACY_RUNTIME,
    sqlitePath: normalizeDatabasePath(input.sqlitePath),
    databaseUrl: input.databaseUrl ?? null,
    legacyImportRoot: path.resolve(input.legacyImportRoot ?? process.cwd()),
  }
}

export function disposableCertificationDatabaseAuthority(
  sqlitePath: string,
): DisposableCertificationDatabaseAuthority {
  if (typeof sqlitePath !== 'string' || sqlitePath.trim().length === 0) {
    throw new DatabaseAuthorityError(
      'DATABASE_AUTHORITY_REQUIRED',
      'Disposable certification database authority requires an explicit SQLite path.',
    )
  }
  return {
    mode: DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION,
    sqlitePath: normalizeDatabasePath(sqlitePath),
  }
}

export function databaseAuthorityKey(authority: DatabaseAuthority): string {
  switch (authority.mode) {
    case DatabaseAuthorityMode.PRODUCT_WORKSPACE:
      return `${authority.mode}:${authority.workspaceRoot}:${authority.sqlitePath}`
    case DatabaseAuthorityMode.LEGACY_RUNTIME:
      return `${authority.mode}:${authority.databaseUrl ?? authority.sqlitePath}:${authority.legacyImportRoot}`
    case DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION:
      return `${authority.mode}:${authority.sqlitePath}`
  }
}

export function databaseProvenance(
  authority: DatabaseAuthority,
  dialect: DatabaseDialect,
): ActiveDatabaseProvenance {
  const legacy = authority.mode === DatabaseAuthorityMode.LEGACY_RUNTIME
  return {
    authorityMode: authority.mode,
    dialect,
    sqlitePath: dialect === 'sqlite' ? authority.sqlitePath : null,
    workspaceRoot: authority.mode === DatabaseAuthorityMode.PRODUCT_WORKSPACE
      ? authority.workspaceRoot
      : null,
    migrationCeiling: dialect === 'postgres'
      ? LEGACY_POSTGRES_MIGRATION_CEILING
      : CURRENT_PRODUCT_MIGRATION_CEILING,
    legacyImportAllowed: legacy,
    legacyImportRoot: legacy ? authority.legacyImportRoot : null,
    productSchemaEligible: !legacy && dialect === 'sqlite',
    databaseUrlAllowed: legacy,
  }
}
