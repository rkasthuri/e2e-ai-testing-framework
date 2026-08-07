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
 * TD-UI-031 Block 1 — atomic shape cutover proof. Producers author the v2 shape;
 * evidenceState is derived AT THE SOURCE; crawlMetadata is null ONLY for
 * unsupported-platform; a fresh producer output validates against the new Ajv
 * schema; and the @generated header still carries the SAME crawlConfigHash value
 * (the hash moved into crawlMetadata, its value did not change). node:test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Crawler } from '../src/core/onboarding/Crawler'
import { ApiSpecCrawler } from '../src/core/onboarding/ApiSpecCrawler'
import { PomGenerator } from '../src/core/onboarding/generators/PomGenerator'
import { validateAppModelObject } from '../src/core/onboarding/ModelValidator'
import type { AppModel, AppModelCandidate, OnboardingConfig } from '../src/core/onboarding/types'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ui-031-'))
const cfg = (appType: string): OnboardingConfig => ({
  app: { name: 'shapeapp', baseUrl: 'https://shape.example.com', appType: appType as any },
  roles: [], flows: [], pagePrerequisites: [],
  budgets: { maxPages: 50, maxDepth: 5, aiCalls: 100 },
  crawlMode: 'bfs',
} as unknown as OnboardingConfig)

// buildModel / buildStubModel are private — exercise them directly (same pattern
// as verify-verification-scoring's buildReport access).
type CrawlerPriv = {
  buildModel(p: unknown[], r: unknown[], f: unknown[], t: number): AppModelCandidate
  buildStubModel(): AppModelCandidate
}
type ApiPriv = { buildModel(e: unknown[], f: unknown[], t: number): AppModelCandidate }

function uiCrawler(appType = 'web-ui'): CrawlerPriv {
  return new Crawler(cfg(appType)) as unknown as CrawlerPriv
}
function apiCrawler(): ApiPriv {
  return new ApiSpecCrawler(cfg('rest-api')) as unknown as ApiPriv
}

function validates(candidate: AppModelCandidate, label: string): void {
  const model: AppModel = {
    ...candidate,
    app: { ...candidate.app, modelVersion: '1.0.0' },
  }
  const { valid, errors } = validateAppModelObject(model)
  assert.equal(valid, true, `${label} must validate against v2 schema — errors: ${errors.join('; ')}`)
}

// ── evidenceState derived at the source ──────────────────────────────────────────

test('S1 buildModel with pages → evidenceState "crawled", crawlMetadata non-null, diagnostics null', () => {
  const m = uiCrawler().buildModel([{ id: 'home', urlPattern: '/', elements: [] }], [], [], Date.now())
  assert.equal(m.schemaVersion, '2.0')
  assert.equal(m.app.evidenceState, 'crawled')
  assert.notEqual(m.app.crawlMetadata, null)
  assert.equal(m.app.crawlMetadata!.crawlDiagnostics, null)
})

test('S2 buildModel with ZERO pages → "crawled-empty" (a crawl ran; crawlMetadata still non-null)', () => {
  const m = uiCrawler().buildModel([], [], [], Date.now())
  assert.equal(m.app.evidenceState, 'crawled-empty')
  assert.notEqual(m.app.crawlMetadata, null)
  assert.equal(m.app.crawlMetadata!.pagesDiscovered, 0)
})

test('S3 buildStubModel → "unsupported-platform", crawlMetadata === null (no crawl ran)', () => {
  const m = uiCrawler('iot').buildStubModel()
  assert.equal(m.app.evidenceState, 'unsupported-platform')
  assert.equal(m.app.crawlMetadata, null)
})

test('S4 API buildModel with endpoints → "crawled"; with none → "crawled-empty"', () => {
  const withEp = apiCrawler().buildModel([{ method: 'GET', path: '/ping', summary: 'p', auth: false }], [], Date.now())
  assert.equal(withEp.app.evidenceState, 'crawled')
  assert.notEqual(withEp.app.crawlMetadata, null)
  const noEp = apiCrawler().buildModel([], [], Date.now())
  assert.equal(noEp.app.evidenceState, 'crawled-empty')
})

// ── fresh producer output validates against the NEW schema ───────────────────────

test('S5 crawled-empty output validates against v2 schema', () => {
  validates(uiCrawler().buildModel([], [], [], Date.now()), 'crawled-empty')
})
test('S6 unsupported-platform output validates (crawlMetadata null, pages null)', () => {
  validates(uiCrawler('iot').buildStubModel(), 'unsupported-platform')
})
test('S7 API crawled-empty output validates (pages null, endpoints null)', () => {
  validates(apiCrawler().buildModel([], [], Date.now()), 'api-empty')
})

// ── the invariant bites: a hand-built impossible state is REJECTED ────────────────

test('S8 impossible state (crawled + crawlMetadata null) is rejected by the schema', () => {
  const good = uiCrawler().buildModel([], [], [], Date.now())
  const bad: AppModel = {
    ...good,
    app: { ...good.app, modelVersion: '1.0.0', crawlMetadata: null },
  }
  assert.equal(validateAppModelObject(bad).valid, false)
})

// ── @generated header VALUE unchanged (hash moved, value did not) ─────────────────

test('S9 PomGenerator header carries model.app.crawlMetadata.crawlConfigHash verbatim', () => {
  const model = {
    schemaVersion: '2.0', generatedAt: '2026-07-14T00:00:00.000Z', generatedBy: 'human',
    app: {
      name: 'hdr', displayName: 'Hdr', baseUrl: 'https://hdr.example.com', appType: 'web-ui',
      modelVersion: '1.0.0', spaConfig: null, evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:HDRTEST', crawledAt: '2026-07-14T00:00:00.000Z', crawledBy: 'human',
        crawlDurationMs: 1, pagesBudget: 50, pagesDiscovered: 1, pagesSkipped: 0,
        aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [], pages: [{ id: 'home', urlPattern: '/', elements: [], accessibleByRoles: [], isAuthPage: false }],
    flows: [], endpoints: null, api: null, diff: null,
  } as unknown as AppModel

  const outDir = path.join(tmp, 'pom-out')
  fs.mkdirSync(outDir, { recursive: true })
  new PomGenerator(model).generate(outDir)
  const pagesDir = path.join(outDir, 'pages')   // UI branch writes to outDir/pages/
  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.generated.ts'))
  assert.ok(files.length > 0, 'PomGenerator must emit at least one file')
  const content = fs.readFileSync(path.join(pagesDir, files[0]), 'utf-8')
  assert.ok(content.includes('sha256:HDRTEST'), 'header must carry the crawlConfigHash value unchanged')
  assert.ok(content.includes('v1.0.0'), 'header must carry the modelVersion')
})
