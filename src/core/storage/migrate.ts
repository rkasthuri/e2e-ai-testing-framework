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
import { sql } from 'kysely';
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
export async function runMigrations(): Promise<void> {
  const db = getDb();
  await createVerifiedBackupBefore016(db);
  const migrationsDir = path.resolve(__dirname, 'migrations');

  const migrator = new Migrator({
    db,
    provider: new TsxMigrationProvider(migrationsDir),
  });

  const { error, results } = (await migrator.migrateToLatest()) as {
    error: unknown;
    results: Array<{ migrationName: string; status: 'Success' | 'Error' | 'NotMigrated' }>;
  };

  if (results && results.length > 0) {
    for (const r of results) {
      if (r.status === 'Success') {
        console.log(`[migration] ✓ ${r.migrationName}`);
      } else if (r.status === 'Error') {
        console.error(`[migration] ✗ ${r.migrationName}`);
      }
    }
  } else {
    console.log('[migration] Already up to date.');
  }

  if (error) {
    console.error('[migration] Fatal error:', error);
    throw error;
  }
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
