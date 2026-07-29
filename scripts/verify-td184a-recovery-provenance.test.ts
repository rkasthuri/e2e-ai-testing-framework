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

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Kysely, sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'

interface ForgeMigration {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td184a-'))
const migrationsDir = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')

function loadMigrations(): Record<string, ForgeMigration> {
  return Object.fromEntries(
    fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.ts'))
      .sort()
      .map(file => [file.replace(/\.ts$/, ''), require(path.join(migrationsDir, file))]),
  )
}

const migrations = loadMigrations()
const through = (last: string): Record<string, ForgeMigration> => Object.fromEntries(
  Object.entries(migrations).filter(([name]) => name <= last),
)

function candidate(appName: string): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-07-29T12:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: appName,
      baseUrl: `https://${appName}.example.com`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:td184a',
        crawledAt: '2026-07-29T12:00:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 1,
        pagesBudget: 1,
        pagesDiscovered: 1,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [],
    flows: [],
    endpoints: null,
    api: null,
    diff: null,
  }
}

after(async () => {
  await closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

test('TD184A-1 rehearses 015 -> 016 -> 017 -> 018 without reconstruction, triggers, data loss, or history loss', async () => {
  const dbPath = path.join(root, 'rehearsal.db')
  initDb(dbPath)
  const db = getDb() as unknown as Kysely<any>
  await runSqliteMigrationCoordinator(db, through('015_app_models_crawled_by_nullable'))
  await sql`
    INSERT INTO app_models (
      app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
      page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
      status, evidence_state
    ) VALUES (
      'existing-app', '1.0.0', 'https://existing.example.com', 'web-ui', 'crawl',
      'sha256:existing', 1, 2, 3, '{"existing":true}',
      '2026-07-29T11:00:00.000Z', 'engine', 'active', 'crawled'
    )
  `.execute(db)

  const beforeTable = (await sql<{ rootpage: number }>`
    SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = 'app_models'
  `.execute(db)).rows[0]
  const beforeRow = (await sql<any>`SELECT * FROM app_models WHERE app_name = 'existing-app'`.execute(db)).rows[0]
  const historyThrough015 = (await sql<{ name: string }>`
    SELECT name FROM kysely_migration ORDER BY name
  `.execute(db)).rows.map(row => row.name)

  assert.deepEqual(
    await runSqliteMigrationCoordinator(db, migrations),
    [
      '016_app_models_single_active',
      '017_app_models_operation_identity',
      '018_app_models_recovery_provenance',
    ],
  )

  const afterTable = (await sql<{ rootpage: number; definition: string }>`
    SELECT rootpage, sql AS definition
    FROM sqlite_master
    WHERE type = 'table' AND name = 'app_models'
  `.execute(db)).rows[0]
  assert.equal(afterTable.rootpage, beforeTable.rootpage, 'app_models root page changed: table was reconstructed')
  assert.match(afterTable.definition, /recovery_source_row_id INTEGER/i)
  assert.match(afterTable.definition, /recovery_source_fingerprint TEXT/i)
  assert.match(
    afterTable.definition.replace(/\s+/g, ' '),
    /CHECK \( \(recovery_source_row_id IS NULL AND recovery_source_fingerprint IS NULL\) OR \(recovery_source_row_id IS NOT NULL AND recovery_source_fingerprint IS NOT NULL\) \)/i,
  )
  assert.equal(
    (await sql`SELECT name FROM sqlite_master WHERE type = 'trigger'`.execute(db)).rows.length,
    0,
  )

  const afterRow = (await sql<any>`SELECT * FROM app_models WHERE app_name = 'existing-app'`.execute(db)).rows[0]
  assert.deepEqual(
    Object.fromEntries(Object.entries(afterRow).filter(([key]) => !key.startsWith('recovery_source_') && key !== 'operation_id' && key !== 'candidate_hash')),
    beforeRow,
  )
  assert.equal(afterRow.recovery_source_row_id, null)
  assert.equal(afterRow.recovery_source_fingerprint, null)

  const finalHistory = (await sql<{ name: string }>`
    SELECT name FROM kysely_migration ORDER BY name
  `.execute(db)).rows.map(row => row.name)
  assert.deepEqual(finalHistory.slice(0, historyThrough015.length), historyThrough015)
  assert.deepEqual(finalHistory.slice(-4), [
    '015_app_models_crawled_by_nullable',
    '016_app_models_single_active',
    '017_app_models_operation_identity',
    '018_app_models_recovery_provenance',
  ])
})

test('TD184A-2 native CHECK accepts NULL/NULL and populated/populated, and rejects mismatched pairs', async () => {
  const db = getDb() as unknown as Kysely<any>
  const insert = async (
    appName: string,
    rowId: number | null,
    fingerprint: string | null,
  ): Promise<void> => {
    await sql`
      INSERT INTO app_models (
        app_name, version, base_url, model_json, status, evidence_state,
        recovery_source_row_id, recovery_source_fingerprint
      ) VALUES (
        ${appName}, '1.0.0', 'https://check.example.com', '{}', 'superseded',
        'crawled', ${rowId}, ${fingerprint}
      )
    `.execute(db)
  }
  await insert('null-pair', null, null)
  await insert('populated-pair', 42, 'sha256:source')
  await assert.rejects(insert('row-only', 42, null), /CHECK constraint failed/i)
  await assert.rejects(insert('fingerprint-only', null, 'sha256:source'), /CHECK constraint failed/i)
})

test('TD184A-3 normal App Model persistence naturally stores NULL/NULL', async () => {
  const committed = await new AppModelRepository().commitCandidate(
    candidate('normal-write'),
    'crawl-normal-write',
  )
  const row = (await sql<{
    recovery_source_row_id: number | null
    recovery_source_fingerprint: string | null
  }>`
    SELECT recovery_source_row_id, recovery_source_fingerprint
    FROM app_models
    WHERE id = ${committed.committed.rowId}
  `.execute(getDb())).rows[0]
  assert.deepEqual(row, {
    recovery_source_row_id: null,
    recovery_source_fingerprint: null,
  })
})
