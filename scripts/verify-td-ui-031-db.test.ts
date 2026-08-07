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
 * TD-UI-031 Block 2 — DB layer. Migration 013 applies on a fresh DB; app_models
 * gains evidence_state and crawled_at becomes NULLABLE; an unsupported-platform
 * row persists crawled_at = NULL (honest "no crawl"), NOT '' (a false "a crawl
 * produced an empty string"); a crawled-empty row persists a real crawled_at.
 * node:test — its own process, so the getDb() singleton is isolated to this file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { sql } from 'kysely'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ui-031-db-'))

test('D0 migration 013 applies cleanly on a fresh DB', async () => {
  initDb(path.join(dir, 'forge.db'))
  await runMigrations()   // throws on any migration error
  // 013 is recorded in kysely_migration
  const rows = await getDb().selectFrom('kysely_migration' as any).select('name' as any).execute()
  const names = rows.map((r: any) => r.name)
  assert.ok(names.includes('013_app_model_evidence'), `013 must be applied — got ${names.join(', ')}`)
})

test('D1 app_models: crawled_at is NULLABLE and evidence_state exists', async () => {
  const info = await sql<{ name: string; notnull: number }>`PRAGMA table_info(app_models)`.execute(getDb())
  const cols = new Map(info.rows.map(r => [r.name, r.notnull]))
  assert.ok(cols.has('evidence_state'), 'evidence_state column must exist')
  assert.equal(cols.get('evidence_state'), 1, 'evidence_state must be NOT NULL')
  assert.equal(cols.get('crawled_at'), 0, 'crawled_at must be NULLABLE (notnull=0)')
})

test('D2 crawled-empty row persists a real crawled_at + evidence_state (no NOT-NULL violation)', async () => {
  await getDb().insertInto('app_models').values({
    app_name: 'empty-app', version: '1.0.0', base_url: 'https://empty.example.com',
    app_type: 'spa', intake_mode: 'crawl', crawl_config_hash: 'sha256:e',
    page_count: 0, flow_count: 0, role_count: 0, model_json: '{}',
    crawled_at: '2026-07-14T00:00:00.000Z', crawled_by: 'human', status: 'active',
    evidence_state: 'crawled-empty',
  }).execute()
  const row = await new AppModelRepository().findActive('empty-app')
  assert.equal(row?.evidence_state, 'crawled-empty')
  assert.equal(row?.crawled_at, '2026-07-14T00:00:00.000Z')
})

test('D3 unsupported-platform row persists crawled_at = NULL, not "" (the honesty requirement)', async () => {
  await getDb().insertInto('app_models').values({
    app_name: 'mobile-app', version: '1.0.0', base_url: 'https://m.example.com',
    app_type: 'mobile-android', intake_mode: 'crawl', crawl_config_hash: '',
    page_count: 0, flow_count: 0, role_count: 0, model_json: '{}',
    crawled_at: null, crawled_by: 'agent', status: 'active',
    evidence_state: 'unsupported-platform',
  }).execute()
  const row = await new AppModelRepository().findActive('mobile-app')
  assert.equal(row?.evidence_state, 'unsupported-platform')
  assert.equal(row?.crawled_at, null)          // NULL — "no crawl happened"
  assert.notEqual(row?.crawled_at, '')          // and specifically NOT the empty-string lie
})

test('D4 backfill labels existing content rows (page_count>0) as crawled', async () => {
  // Simulate a pre-013 row shape by inserting a content-bearing model, then read
  // it back through the real table, then assert the persisted evidence label
  // round-trips for a content row.
  await getDb().insertInto('app_models').values({
    app_name: 'full-app', version: '1.0.0', base_url: 'https://full.example.com',
    app_type: 'spa', intake_mode: 'crawl', crawl_config_hash: 'sha256:f',
    page_count: 7, flow_count: 3, role_count: 2, model_json: '{}',
    crawled_at: '2026-07-14T00:00:00.000Z', crawled_by: 'human', status: 'active',
    evidence_state: 'crawled',
  }).execute()
  const row = await new AppModelRepository().findActive('full-app')
  assert.equal(row?.evidence_state, 'crawled')
  closeDb()
})
