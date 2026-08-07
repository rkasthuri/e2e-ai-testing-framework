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
 * TD-UI-031 Block 3 — `forge migrate` (schema 1.0 → 2.0). Transform correctness
 * per state, IDEMPOTENCY, REFUSAL on unexpected shape, output validates against
 * the v2 schema, file backup, and DB-blob migration. Uses the REAL on-disk v1.0
 * reference models (orangehrm = crawled, restful-booker = API) so the transform
 * is proven on genuine content, not a synthetic stand-in. node:test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  migrateModelToV2, migrateModelFile, migrateDbBlobs, UnmigratableModelError,
} from '../src/core/onboarding/ModelMigrator'
import { validateAppModelObject } from '../src/core/onboarding/ModelValidator'
import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { sql } from 'kysely'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ui-031-mig-'))
const load = (app: string) => JSON.parse(fs.readFileSync(path.resolve('models', app, 'app-model.json'), 'utf-8'))

// Normalize a model back to the v1.0 shape so this test is robust regardless of
// whether the on-disk reference models have already been migrated to v2.0
// (Block 3 migrates them in place). Uses REAL page/endpoint content so the
// migrated output is genuinely schema-valid.
function toV1(m: any): any {
  const { evidenceState, crawlMetadata, ...identity } = m.app
  const { crawlDiagnostics, ...crawlFields } = crawlMetadata ?? {
    crawlConfigHash: 'sha256:x', crawledAt: '2026-01-01T00:00:00.000Z', crawledBy: 'agent',
    crawlDurationMs: 0, pagesBudget: 0, pagesDiscovered: 0, pagesSkipped: 0, aiBudgetStatus: 'within-budget',
  }
  return { ...m, schemaVersion: '1.0', app: { ...identity, ...crawlFields } }
}

// Real reference models, normalized to v1.0 (read-only; migrateModelToV2 is pure).
const ORANGEHRM = toV1(load('orangehrm'))          // crawled: 30 pages
const BOOKER    = toV1(load('restful-booker'))      // crawled: API, 8 endpoints, pages null

// Synthetic empties/stubs (no rich page objects needed → schema-valid as-is).
const v1empty = (appOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0', generatedAt: '2026-07-10T00:00:00.000Z', generatedBy: 'human',
  app: {
    name: 'x', displayName: 'X', baseUrl: 'https://x.example.com', appType: 'web-ui',
    crawlConfigHash: 'sha256:x', crawledAt: '2026-07-10T00:00:00.000Z', crawledBy: 'human',
    crawlDurationMs: 1234, pagesBudget: 50, pagesDiscovered: 0, pagesSkipped: 0,
    modelVersion: '1.0.0', spaConfig: null, aiBudgetStatus: 'within-budget', ...appOver,
  },
  roles: [], pages: [], flows: [], endpoints: null, api: null, diff: null, ...over,
})
const v1stub = (appType: string) => v1empty({ appType }, { pages: null })

test('M1 real crawled model (orangehrm) → crawled; 8 fields wrapped into crawlMetadata; v2', () => {
  const { model, changed } = migrateModelToV2(ORANGEHRM)
  assert.equal(changed, true)
  assert.equal(model.schemaVersion, '2.0')
  assert.equal(model.app.evidenceState, 'crawled')
  assert.equal(model.app.crawlMetadata.crawledAt, ORANGEHRM.app.crawledAt)   // value preserved, relocated
  assert.equal(model.app.crawlMetadata.crawlConfigHash, ORANGEHRM.app.crawlConfigHash)
  assert.equal(model.app.crawlMetadata.crawlDiagnostics, null)
  assert.equal('crawledAt' in model.app, false)          // removed from app (identity only)
  assert.equal('crawlConfigHash' in model.app, false)
})

test('M2 v1 empty (0 pages / 0 flows) → crawled-empty (crawlMetadata still present)', () => {
  const { model } = migrateModelToV2(v1empty())
  assert.equal(model.app.evidenceState, 'crawled-empty')
  assert.notEqual(model.app.crawlMetadata, null)
})

test('M3 real API model (restful-booker) → crawled (endpoints are content; pages null)', () => {
  const { model } = migrateModelToV2(BOOKER)
  assert.equal(model.app.evidenceState, 'crawled')
  assert.equal(model.pages, null)
})

test('M4 v1 stub (mobile-android) → unsupported-platform, crawlMetadata null (fabricated crawledAt dropped)', () => {
  const { model } = migrateModelToV2(v1stub('mobile-android'))
  assert.equal(model.app.evidenceState, 'unsupported-platform')
  assert.equal(model.app.crawlMetadata, null)
})

test('M5 idempotent: already-v2 → changed:false, untouched', () => {
  const { model: once } = migrateModelToV2(ORANGEHRM)
  const { model: twice, changed } = migrateModelToV2(once)
  assert.equal(changed, false)
  assert.deepEqual(twice, once)
})

test('M6 REFUSES unknown schemaVersion', () => {
  assert.throws(() => migrateModelToV2({ schemaVersion: '3.7', app: {} }), UnmigratableModelError)
})

test('M7 REFUSES v1 missing the old crawl fields (unexpected shape, not a guess)', () => {
  const bad = v1empty(); delete (bad.app as any).crawledAt
  assert.throws(() => migrateModelToV2(bad), UnmigratableModelError)
})

test('M8 migrated output validates against the v2 schema (all four states)', () => {
  for (const m of [ORANGEHRM, BOOKER, v1empty(), v1stub('iot')]) {
    const { model } = migrateModelToV2(m)
    const { valid, errors } = validateAppModelObject(model)
    assert.equal(valid, true, `must validate — ${errors.join('; ')}`)
  }
})

test('M9 migrateModelFile: backs up, migrates in place, idempotent on second run', () => {
  const p = path.join(dir, 'app-model.json')
  fs.writeFileSync(p, JSON.stringify(v1empty()))
  const r1 = migrateModelFile(p)
  assert.equal(r1.changed, true)
  assert.ok(fs.existsSync(`${p}.pre-v2.bak`), 'backup must exist')
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf-8')).schemaVersion, '2.0')
  const r2 = migrateModelFile(p)
  assert.equal(r2.changed, false)   // idempotent
})

test('M10 migrateDbBlobs: 1.0 blob → 2.0 + evidence_state set; idempotent', async () => {
  initDb(path.join(dir, 'forge.db'))
  await runMigrations()
  await sql`
    INSERT INTO app_models (app_name, version, base_url, app_type, intake_mode,
      crawl_config_hash, page_count, flow_count, role_count, model_json,
      crawled_at, crawled_by, status, evidence_state)
    VALUES ('seed', '1.0.0', 'https://s.example.com', 'web-ui', 'crawl',
      'sha256:x', 0, 0, 0, ${JSON.stringify(v1empty())},
      '2026-07-10T00:00:00.000Z', 'human', 'active', 'crawled')
  `.execute(getDb())

  const first = await migrateDbBlobs(getDb())
  assert.equal(first.migrated, 1)
  const row: any = await getDb().selectFrom('app_models').select(['model_json', 'evidence_state'])
    .where('app_name', '=', 'seed').executeTakeFirstOrThrow()
  assert.equal(JSON.parse(row.model_json).schemaVersion, '2.0')
  assert.equal(row.evidence_state, 'crawled-empty')   // derived from content (0 pages/flows)

  const second = await migrateDbBlobs(getDb())
  assert.equal(second.migrated, 0)   // idempotent
  assert.equal(second.skipped, 1)
  closeDb()
})
