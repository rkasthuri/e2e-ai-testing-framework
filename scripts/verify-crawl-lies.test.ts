/**
 * FORGE — Autonomous Quality Engineering
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Crawl LIEs milestone — "the Crawl model no longer asserts knowledge it does not
 * possess." Regression suite for the four Baseline-#1 Crawl LIEs:
 *   LIE-A pagesSkipped → null (not 0)         LIE-C aiBudgetStatus both pools (ADR-018)
 *   LIE-B diff six subfields → null (not [])  LIE-D crawled_by 'engine' / null (not 'human')
 * plus migration 015 (crawled_by NULLABLE) and the ModelMigrator null round-trip.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Crawler } from '../src/core/onboarding/Crawler'
import { migrateModelToV2 } from '../src/core/onboarding/ModelMigrator'
import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { sql } from 'kysely'

// Minimal Crawler over a UI app; buildModel/buildStubModel are exercised directly.
function crawler(): any {
  return new Crawler({
    app: { name: 'test-app', baseUrl: 'https://test.example.com', appType: 'spa' },
  } as any)
}
// TD-181: previous runtime truth is injected from SQLite; tests set that seam directly.
function withExisting(c: any, existing: any) { c.previousModel = existing }function buildModel(c: any) { return c.buildModel([], [], [], Date.now(), []) }

// ── LIE-D: crawled_by provenance ───────────────────────────────────────────────

test('C1 real crawl → crawled_by "engine" (NOT "human")', () => {
  const c = crawler(); withExisting(c, null)
  const m = buildModel(c)
  assert.equal(m.app.crawlMetadata.crawledBy, 'engine')
  assert.notEqual(m.app.crawlMetadata.crawledBy, 'human')
})

test('C11 real crawl → generatedBy "engine" (NOT "human") — sibling of LIE-D', () => {
  const c = crawler(); withExisting(c, null)
  const m = buildModel(c)
  assert.equal(m.generatedBy, 'engine')
  assert.notEqual(m.generatedBy, 'human')
})

test('C2 stub model → crawled_by null (NOT "human", NOT "stub")', () => {
  const c = crawler()
  const stub = c.buildStubModel()
  assert.equal(stub.app.crawlMetadata, null)                 // no crawl ran
  const persisted = stub.app.crawlMetadata?.crawledBy ?? null // the DB-write expression
  assert.equal(persisted, null)
  assert.notEqual(persisted, 'human')
  assert.notEqual(persisted, 'stub')
})

test('C12 stub model → the full honest shape: generatedBy "engine", crawlMetadata null, crawled_by null', () => {
  // The engine DID generate the placeholder (generatedBy 'engine'), but NOTHING
  // crawled it (crawlMetadata null → persisted crawled_by null). Stub-ness lives in
  // evidenceState + crawlMetadata:null, not in generatedBy.
  const stub = crawler().buildStubModel()
  assert.equal(stub.generatedBy, 'engine')
  assert.notEqual(stub.generatedBy, 'agent')
  assert.equal(stub.app.crawlMetadata, null)
  assert.equal(stub.app.evidenceState, 'unsupported-platform')
  assert.equal(stub.app.crawlMetadata?.crawledBy ?? null, null)   // persisted crawled_by
})

// ── LIE-A: pagesSkipped → null ─────────────────────────────────────────────────

test('C3 pagesSkipped emitted as null (not 0) on crawl + per-role + api paths', async () => {
  // crawl path (buildModel)
  const c = crawler(); withExisting(c, null)
  assert.equal(buildModel(c).app.crawlMetadata.pagesSkipped, null)
  // per-role literal: the RoleCrawlResult push now emits null (source read)
  const src = fs.readFileSync(path.join(__dirname, '../src/core/onboarding/Crawler.ts'), 'utf-8')
  assert.match(src, /roleId:\s*role\.id,[\s\S]*?pagesSkipped:\s*null/, 'per-role pagesSkipped must be null')
  // api path (ApiSpecCrawler literal)
  const api = fs.readFileSync(path.join(__dirname, '../src/core/onboarding/ApiSpecCrawler.ts'), 'utf-8')
  assert.match(api, /pagesSkipped:\s*null/, 'ApiSpecCrawler pagesSkipped must be null')
  assert.doesNotMatch(api, /pagesSkipped:\s*0\b/, 'ApiSpecCrawler must not emit pagesSkipped: 0')
})

// ── LIE-B: diff subfields nullable ─────────────────────────────────────────────

test('C4 re-crawl diff: pagesAdded/pagesRemoved computed (string[]), the 6 others null (NOT [])', () => {
  const c = crawler()
  withExisting(c, { app: { modelVersion: '1.0.0' }, pages: [{ id: 'p-old' }] })
  const m = c.buildModel([{ id: 'p-new' } as any], [], [], Date.now(), [])
  assert.ok(Array.isArray(m.diff.pagesAdded))
  assert.deepEqual(m.diff.pagesAdded, ['p-new'])              // computed
  assert.deepEqual(m.diff.pagesRemoved, ['p-old'])            // computed
  for (const f of ['pagesModified', 'elementsAdded', 'elementsRemoved', 'strategiesInvalidated', 'flowsAdded', 'flowsRemoved']) {
    assert.equal(m.diff[f], null, `${f} must be null (not diffed), not []`)
  }
})

test('C5 first crawl (no existing): diff is null (unchanged honest behavior)', () => {
  const c = crawler(); withExisting(c, null)
  assert.equal(buildModel(c).diff, null)
})

// ── LIE-C: aiBudgetStatus both pools (ADR-018 weakest-truth) ───────────────────

function aiBudget(c: any, naming: boolean, flow: boolean): string {
  c.namingTracker = { isExhausted: () => naming, remaining: 0 }
  c.flowTracker   = { isExhausted: () => flow,   remaining: 0 }
  withExisting(c, null)
  return buildModel(c).app.crawlMetadata.aiBudgetStatus
}

test('C6 aiBudgetStatus: naming exhausted → degraded', () => {
  assert.equal(aiBudget(crawler(), true, false), 'degraded')
})
test('C7 aiBudgetStatus: flow exhausted (naming within budget) → degraded (the fixed lie)', () => {
  assert.equal(aiBudget(crawler(), false, true), 'degraded')
})
test('C8 aiBudgetStatus: neither exhausted → within-budget', () => {
  assert.equal(aiBudget(crawler(), false, false), 'within-budget')
})

// ── C10: ModelMigrator null round-trip (pagesSkipped stays null, never 0) ──────

// Down-convert a REAL on-disk (schema-valid) model to the v1.0 shape the migrator
// accepts (same helper the 031-migrate suite uses) — so the migrated result passes
// the migrator's full v2 schema validation and only pagesSkipped is under test.
function load(app: string): any { return JSON.parse(fs.readFileSync(path.resolve('models', app, 'app-model.json'), 'utf-8')) }
function toV1(m: any): any {
  const { evidenceState, crawlMetadata, ...identity } = m.app
  const { crawlDiagnostics, ...crawlFields } = crawlMetadata ?? {
    crawlConfigHash: '', crawledAt: '2026-01-01T00:00:00.000Z', crawledBy: 'engine',
    crawlDurationMs: 0, pagesBudget: 0, pagesDiscovered: 0, pagesSkipped: 0, aiBudgetStatus: 'within-budget',
  }
  return { ...m, schemaVersion: '1.0', app: { ...identity, ...crawlFields } }
}

test('C10 null pagesSkipped round-trips through ModelMigrator without becoming 0', () => {
  const v1 = toV1(load('orangehrm'))   // a real crawled model, normalized to v1.0
  v1.app.pagesSkipped = null            // the value under test (also proves the schema now allows null)
  const { model } = migrateModelToV2(v1)
  assert.equal(model.app.crawlMetadata.pagesSkipped, null)   // stays null…
  assert.notEqual(model.app.crawlMetadata.pagesSkipped, 0)   // …never coerced to 0
})

// ── C9: migration 015 — crawled_by NULLABLE (own DB process) ───────────────────

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-lies-'))

test('C9a migration 015 applies cleanly + crawled_by is NULLABLE', async () => {
  initDb(path.join(dir, 'forge.db'))
  await runMigrations()
  const names = (await getDb().selectFrom('kysely_migration' as any).select('name' as any).execute()).map((r: any) => r.name)
  assert.ok(names.includes('015_app_models_crawled_by_nullable'), `015 must be applied — got ${names.join(', ')}`)
  const info = await sql<{ name: string; notnull: number }>`PRAGMA table_info(app_models)`.execute(getDb())
  const cols = new Map(info.rows.map(r => [r.name, r.notnull]))
  assert.equal(cols.get('crawled_by'), 0, 'crawled_by must be NULLABLE (notnull=0)')
})

test('C9b a null crawled_by row inserts + reads back as null (the stub case)', async () => {
  await getDb().insertInto('app_models').values({
    app_name: 'stub-app', version: '1.0.0', base_url: 'https://stub.example.com',
    app_type: 'mobile-android', intake_mode: 'crawl', crawl_config_hash: '',
    page_count: 0, flow_count: 0, role_count: 0, model_json: '{}',
    crawled_at: null, crawled_by: null, status: 'active',
    evidence_state: 'unsupported-platform',
  }).execute()
  const row = await new AppModelRepository().findActive('stub-app')
  assert.equal(row?.crawled_by, null)          // no crawler ran → NULL
  assert.notEqual(row?.crawled_by, 'human')     // specifically NOT the fabricated default
  closeDb()
})
