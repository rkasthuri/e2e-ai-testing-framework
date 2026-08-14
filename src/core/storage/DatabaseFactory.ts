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

/**
 * TD-114 — DatabaseFactory: opens/initializes the per-app project database.
 *
 * Governed Product seam (Kysely-based, dialect-preserving, NO repository DI):
 *   Workspace       → owns location   (workspace.dbPath() → .forge/forge.db)
 *   DatabaseFactory → owns path-scoping + initialization (this file)
 *   authority       → PRODUCT_WORKSPACE, selected before the handle opens
 *
 * Lazy migrations: run on first open (idempotent — Kysely Migrator tracks the
 * kysely_migration table), NOT on workspace creation.
 *
 * Legacy flows never come through here; their separate initializer contains
 * DB_PATH, DB_URL, and Migration 004 behavior as LEGACY_RUNTIME.
 */
import * as fs from 'fs'
import * as path from 'path'
import { Kysely } from 'kysely'
import { initProductWorkspaceDatabase, getProductDb } from './db'
import { runMigrations } from './migrate'
import { Workspace } from '../workspace/WorkspaceManager'

/**
 * Scope the DB singleton to this workspace's .forge/forge.db and run lazy
 * migrations. Returns void — repositories keep using getDb() directly.
 * Throws if another database authority is already selected in this process.
 */
export async function openProjectDatabase(workspace: Workspace): Promise<void> {
  const dbPath = workspace.dbPath()
  // WorkspaceManager.ensureDirs() covers this on writes, but the DB may be the
  // FIRST artifact a fresh workspace creates — be defensive.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  initProductWorkspaceDatabase(workspace.root, dbPath)
  await runMigrations()   // lazy + idempotent (kysely_migration table)
}

/**
 * Completed-migration count for ProjectManifest.databaseVersion.
 * Reads Kysely's own migration table; a DB that has never migrated has no
 * table yet — 0 completed migrations is the true answer, not an error.
 */
export async function getMigrationCount(): Promise<number> {
  const db = getProductDb() as unknown as Kysely<any>
  try {
    const rows = await db.selectFrom('kysely_migration').select('name').execute()
    return rows.length
  } catch {
    return 0   // table absent → nothing migrated yet
  }
}
