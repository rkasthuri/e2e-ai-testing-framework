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

/**
 * TD-112 + TD-122 — proof tests (ModelEnrichmentPipeline, stages, ownership-
 * pure persistence, read-only GeneratorRunner).
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 *
 * HERMETIC AI NOTE (T6): AiResidueStage's adapter calls the real aiCall(),
 * which reads process.env.ANTHROPIC_API_KEY at call time. T6 deletes the key
 * (restored in finally) so the call fails fast and locally — the test proves
 * WHICH pages were attempted via the budget tracker's consume() count
 * (consume fires once per attempted page, before the call), never via a live
 * API hit. T8's never-retry proof uses classifyWithAi directly with a fake.
 *
 * T11 uses the STUB app type (Placeholder Model) — the one crawl() path that
 * needs no browser — to prove crawl() no longer saves internally.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ModelEnrichmentPipeline, EnrichmentStage, EnrichmentContext } from '../src/core/pipeline/ModelEnrichmentPipeline'
import { ModuleClassifierStage } from '../src/core/pipeline/stages/ModuleClassifierStage'
import { AiResidueStage } from '../src/core/pipeline/stages/AiResidueStage'
import { ModuleClassifier } from '../src/core/crawler/ModuleClassifier'
import { Crawler } from '../src/core/onboarding/Crawler'
import { GeneratorRunner } from '../src/core/onboarding/GeneratorRunner'
import { createWorkspace, Workspace } from '../src/core/workspace/WorkspaceManager'
import { AppModel, AiBudgetTracker, PageDefinition, OnboardingConfig } from '../src/core/onboarding/types'
import { closeDb } from '../src/core/storage/db'
import type { AppModelService } from '../src/core/storage/AppModelService'
const previousDbPath = process.env.DB_PATH
process.env.DB_PATH = ':memory:'
after(async () => {
  await closeDb()
  if (previousDbPath === undefined) delete process.env.DB_PATH
  else process.env.DB_PATH = previousDbPath
})

// ── helpers ───────────────────────────────────────────────────────────────────

function page(id: string, urlPattern: string): PageDefinition {
  return {
    id, urlPattern, displayName: id, urlPatternType: 'exact',
    fingerprint: 'f', fingerprintBasis: 'url-only', appType: 'web-ui',
    accessibleByRoles: [], isAuthPage: false, elements: [],
  }
}

function model(pages: PageDefinition[]): AppModel {
  return {
    schemaVersion: '2.0', generatedAt: new Date().toISOString(), generatedBy: 'agent',
    app: {
      name: 'testapp', displayName: 'testapp', baseUrl: 'https://example.com',
      appType: 'web-ui', modelVersion: '1.0.0', spaConfig: null,
      evidenceState: pages.length > 0 ? 'crawled' : 'crawled-empty',
      crawlMetadata: {
        crawlConfigHash: 'h', crawledAt: new Date().toISOString(), crawledBy: 'agent',
        crawlDurationMs: 0, pagesBudget: 50, pagesDiscovered: pages.length, pagesSkipped: 0,
        aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [], pages, flows: [], endpoints: null, api: null, diff: null,
  } as unknown as AppModel
}

function budget(limit: number): AiBudgetTracker & { consumed: number } {
  const state = { remaining: limit, consumed: 0 }
  return {
    get remaining() { return state.remaining },
    get consumed() { return state.consumed },
    consume(n: number) {
      if (state.remaining <= 0) return false
      state.remaining -= n; state.consumed += n
      return true
    },
    isExhausted() { return state.remaining <= 0 },
  }
}

const ctx = (tracker: AiBudgetTracker): EnrichmentContext =>
  ({ runId: 'run-test-1', appName: 'testapp', budgetTracker: tracker })

// ── T1-T3: pipeline mechanics ─────────────────────────────────────────────────

test('T1 pipeline runs stages in declared order', async () => {
  const order: string[] = []
  const mk = (name: string): EnrichmentStage => ({ name, run: async () => { order.push(name) } })
  await new ModelEnrichmentPipeline().addStage(mk('one')).addStage(mk('two')).addStage(mk('three'))
    .run(model([]), ctx(budget(0)))
  assert.deepEqual(order, ['one', 'two', 'three'])
})

test('T2 a throwing stage does not abort the pipeline (stage 2 still runs)', async () => {
  const order: string[] = []
  const boom: EnrichmentStage = { name: 'boom', run: async () => { throw new Error('stage exploded') } }
  const after: EnrichmentStage = { name: 'after', run: async () => { order.push('after') } }
  await new ModelEnrichmentPipeline().addStage(boom).addStage(after).run(model([]), ctx(budget(0)))
  assert.deepEqual(order, ['after'])
})

test('T3 classificationRunId is stamped on the model after run()', async () => {
  const m = model([])
  await new ModelEnrichmentPipeline().run(m, ctx(budget(0)))
  assert.equal(m.classificationRunId, 'run-test-1')
})

// ── T4-T5: ModuleClassifierStage ──────────────────────────────────────────────

test('T4 every page carries a module assignment after the rule stage', async () => {
  const m = model([page('p1', '/login'), page('p2', '/cart.html'), page('p3', '/xyz')])
  await new ModuleClassifierStage().run(m, ctx(budget(0)))
  for (const p of m.pages!) assert.ok(p.module, `${p.id} missing module`)
})

test('T5 /login → Login, derived MEDIUM (single keyword token), rule via the stage (ADR-020)', async () => {
  const m = model([page('p-login', '/login')])
  await new ModuleClassifierStage().run(m, ctx(budget(0)))
  const mod = m.pages![0].module!
  assert.equal(mod.name, 'Login')
  assert.equal(mod.confidence, 'medium')          // ADR-020: single '/login' token → medium (was hardcoded 'high')
  assert.equal(mod.method, 'rule')
  assert.equal(mod.source, 'evidence-matched')
  assert.deepEqual(mod.evidenceIds, ['p-login'])
})

// ── T6-T8: AiResidueStage ─────────────────────────────────────────────────────

test('T6 only unknown-confidence pages are attempted by the AI stage (consume count)', async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY
  const savedToken = process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  try {
    const m = model([page('p1', '/login'), page('p2', '/mystery'), page('p3', '/enigma')])
    await new ModuleClassifierStage().run(m, ctx(budget(0)))   // p1 Login; p2,p3 unknown
    const tracker = budget(10)
    await new AiResidueStage().run(m, ctx(tracker))            // aiCall fails fast (no key) → caught per page
    assert.equal(tracker.consumed, 2, 'exactly the 2 unknown pages attempted — known page never sent')
    assert.equal(m.pages![0].module?.name, 'Login')            // rule result untouched
    assert.equal(m.pages![1].module?.confidence, 'unknown')    // failure → stays unknown (honest)
    assert.equal(m.pages![2].module?.confidence, 'unknown')
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
    if (savedToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = savedToken
  }
})

test('T7 exhausted budget → remaining pages stay unknown, no crash, zero AI attempts', async () => {
  const m = model([page('p2', '/mystery'), page('p3', '/enigma')])
  await new ModuleClassifierStage().run(m, ctx(budget(0)))
  const tracker = budget(0)                                    // exhausted from the start
  await new AiResidueStage().run(m, ctx(tracker))              // must break before any aiCall
  assert.equal(tracker.consumed, 0)
  assert.equal(m.pages![0].module?.confidence, 'unknown')
  assert.equal(m.pages![1].module?.confidence, 'unknown')
})

test('T8 AI answering unknown is accepted as-is — exactly one call, no retry (Nova Q2c)', async () => {
  let calls = 0
  const fakeAi = async (_prompt: string): Promise<string> => {
    calls++
    return '{"module": "", "confidence": "unknown"}'
  }
  const result = await new ModuleClassifier().classifyWithAi(page('p-x', '/mystery'), fakeAi)
  assert.equal(calls, 1, 'never retried')
  assert.equal(result.confidence, 'unknown')
  assert.equal(result.method, 'unknown')
})

// ── T9-T10: workspace.saveModel ───────────────────────────────────────────────

test('T9 saveModel() writes app-model.json with modules + classificationRunId populated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'td112-'))
  try {
    const m = model([page('p-login', '/login')])
    await new ModelEnrichmentPipeline().addStage(new ModuleClassifierStage()).run(m, ctx(budget(0)))
    await createWorkspace(root).saveModelProjection('testapp', m)
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'models', 'testapp', 'app-model.json'), 'utf-8'))
    assert.equal(onDisk.classificationRunId, 'run-test-1')
    assert.equal(onDisk.pages[0].module.name, 'Login')
    assert.equal(onDisk.pages[0].module.method, 'rule')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T10 compatibility projection is byte-faithful but exposes no runtime reader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'td112-'))
  try {
    const ws = createWorkspace(root)
    const m = model([page('p1', '/cart')])
    m.classificationRunId = 'run-rt'
    await ws.saveModelProjection('testapp', m)
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'models', 'testapp', 'app-model.json'), 'utf-8'))
    assert.deepEqual(raw, JSON.parse(JSON.stringify(m)))
    assert.equal((ws as any).loadModel, undefined)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── T11: crawl() no longer saves internally (behavioral, browser-free) ────────

test('T11 crawl() returns an unversioned candidate and has no persistence method', async () => {
  const config: OnboardingConfig = {
    app: { name: 'stubapp', baseUrl: 'https://example.com', appType: 'web-ui' },
    appType: 'iot',
    roles: [],
  }
  const crawler = new Crawler(config)
  const candidate = await crawler.crawl()
  assert.equal((crawler as any).saveModel, undefined)
  assert.equal('modelVersion' in candidate.app, false)
  assert.equal(candidate.app.name, 'stubapp')
})
test('T12 missing page.module → "general" fallback + warning, and NO re-classification', async () => {
  const warns: string[] = []
  const origWarn = console.warn
  console.warn = (...args: any[]) => { warns.push(args.join(' ')) }
  try {
    const m = model([page('p-login', '/login')])   // NO module set — pre-TD-112 model shape
    const written: Array<[string, string]> = []
    const fake = {
      root: 'C:/fake', forgeDir: 'C:/fake/.forge', testsDir: 'C:/fake/tests', reportsDir: 'C:/fake/reports',
      dbPath: () => 'C:/fake/.forge/forge.db',
      loadProjectManifest: async () => null, saveProjectManifest: async () => {},
      loadConfig: async () => null, saveConfig: async () => {},
      saveBootstrapManifest: async () => {}, saveBootstrapEvidence: async () => {},
      saveGenerationManifest: async () => {},
      loadMemory: async () => null, saveMemory: async () => {},
      writeTests: async (module: string, filename: string) => { written.push([module, filename]) },
      writeTestsFile: async (filename: string) => { written.push(['<root>', filename]) },
      saveModelProjection: async () => {},

      saveReport: async () => {},
    } as unknown as Workspace

    const service = { requireActive: async () => m } as unknown as AppModelService
    await new GeneratorRunner(service).generate('testapp', fake)
    assert.ok(
      warns.some(w => w.includes('has no module assignment')),
      `missing-module warning not emitted — warns: ${JSON.stringify(warns)}`,
    )
    // READ-ONLY proof: the page was NOT re-classified (its /login pattern would
    // have produced module 'Login' if the old re-classify still ran).
    assert.equal(m.pages![0].module, undefined)
  } finally {
    console.warn = origWarn
  }
})
