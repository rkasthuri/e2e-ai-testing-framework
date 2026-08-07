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
 * TD-163 / ADR-021 — detectRenderingModel emits the OBSERVED rendering (framework/static),
 * never a navigation claim; the retired appType 'spa'/'mpa' vocabulary is legacy-mapped by
 * ModelMigrator (with a log) and fails legibly for an unrecognised value.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectRenderingModel } from '../src/core/onboarding/Bootstrap'
import { mapLegacyAppType, migrateModelToV2, UnmigratableModelError } from '../src/core/onboarding/ModelMigrator'

const SEL = {
  spaDom: '#root, #app, [ng-version], [data-reactroot]',
  spaScript: 'script[src*="react"], script[src*="vue"], script[src*="angular"]',
  links: 'a[href]', forms: 'form',
}
const mockPage = (c: Record<string, number>) => ({ locator: (s: string) => ({ count: async () => c[s] ?? 0 }), url: () => 'https://x', waitForTimeout: async (_ms: number) => {} }) as any

// ── ADR-021: emit RENDERING, not a navigation architecture claim ──
test('R1 framework marker → framework-rendered, medium, evidence-matched', async () => {
  const r = await detectRenderingModel(mockPage({ [SEL.spaDom]: 1 }))
  assert.equal(r.value, 'framework-rendered')
  assert.equal(r.confidence, 'medium')
  assert.equal(r.source, 'evidence-matched')
  assert.match(r.reason ?? '', /rendering, not navigation/i)
})

test('R2 no framework marker after the delay → unknown at the FLOOR (TD-173: unhydrated framework indistinguishable from static)', async () => {
  const r = await detectRenderingModel(mockPage({ [SEL.links]: 9, [SEL.forms]: 1 }))   // nav+form, no framework marker
  assert.equal(r.value, 'unknown')
  assert.equal(r.confidence, 'unknown')             // rendering could not be determined — never a false 'static' claim
  assert.equal(r.source, 'default-fallback')
  assert.match(r.reason ?? '', /does NOT prove static rendering/i)
})

test('R3 no code path emits a RETIRED value (spa/mpa navigation OR static-rendered)', async () => {
  for (const c of [{ [SEL.spaDom]: 1 }, { [SEL.spaScript]: 1 }, { [SEL.links]: 9, [SEL.forms]: 1 }, {}]) {
    const v = (await detectRenderingModel(mockPage(c))).value
    assert.ok(v === 'framework-rendered' || v === 'unknown', `unexpected value ${v}`)
    assert.notEqual(v, 'spa'); assert.notEqual(v, 'mpa'); assert.notEqual(v, 'static-rendered')
  }
})

// ── ModelMigrator: the ADR-021 legacy appType-vocab map ──
test('R4 mapLegacyAppType: spa AND mpa → web-ui+unknown (Raj 2026-07-21: never manufacture rendering from an unattributable claim), else null', () => {
  assert.deepEqual(mapLegacyAppType('spa'), { from: 'spa', to: 'web-ui', renderingModel: 'unknown' })
  assert.deepEqual(mapLegacyAppType('mpa'), { from: 'mpa', to: 'web-ui', renderingModel: 'unknown' })
  assert.equal(mapLegacyAppType('web-ui'), null)
  assert.equal(mapLegacyAppType('rest-api'), null)
})

test('R5 migrateModelToV2 upgrades a legacy-spa (even already-v2) model + reports the migration', () => {
  const legacy = { schemaVersion: '2.0', app: { name: 'x', displayName: 'X', baseUrl: 'https://x',
    appType: 'spa', modelVersion: '1.0.0', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null } } as any
  const { model, changed, appTypeMigration } = migrateModelToV2(legacy)
  assert.equal(model.app.appType, 'web-ui')                    // NEVER left as 'spa'
  assert.equal(model.app.renderingModel, 'unknown')            // never manufactured — a fresh crawl observes it
  assert.equal(changed, true)
  assert.deepEqual(appTypeMigration, { from: 'spa', to: 'web-ui', renderingModel: 'unknown' })
})

test('R5b migrateModelToV2 normalizes a retired renderingModel static-rendered → unknown (TD-173)', () => {
  const stale = { schemaVersion: '2.0', app: { name: 'x', displayName: 'X', baseUrl: 'https://x',
    appType: 'web-ui', modelVersion: '1.0.0', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null,
    renderingModel: 'static-rendered' } } as any
  const { model, changed } = migrateModelToV2(stale)
  assert.equal(model.app.renderingModel, 'unknown')            // the retired false-floor value normalized — no evidence behind it
  assert.equal(changed, true)
})

test('R6 a v2 model with a valid platform appType is a no-op (no false migration)', () => {
  const ok = { schemaVersion: '2.0', app: { name: 'x', appType: 'web-ui', evidenceState: 'crawled', crawlMetadata: null } } as any
  const { changed, appTypeMigration } = migrateModelToV2(ok)
  assert.equal(changed, false)
  assert.equal(appTypeMigration, undefined)
})

const v1 = (appType: string) => ({
  schemaVersion: '1.0', generatedAt: '2026-07-21T00:00:00.000Z', generatedBy: 'human',
  app: { name: 'x', displayName: 'X', baseUrl: 'https://x.example.com', appType,
    crawlConfigHash: 'sha256:x', crawledAt: '2026-07-21T00:00:00.000Z', crawledBy: 'human',
    crawlDurationMs: 1, pagesBudget: 50, pagesDiscovered: 0, pagesSkipped: 0,
    modelVersion: '1.0.0', spaConfig: null, aiBudgetStatus: 'within-budget' },
  roles: [], pages: [], flows: [], endpoints: null, api: null, diff: null,
})

test('R7 an UNRECOGNISED appType fails LEGIBLY (the same shape with web-ui migrates clean)', () => {
  assert.equal(migrateModelToV2(v1('web-ui')).changed, true)   // valid platform value migrates
  assert.throws(() => migrateModelToV2(v1('totally-bogus'), 'test'),
    (e: any) => e instanceof UnmigratableModelError)           // only appType differs → schema-mismatch throw, never a silent misread
})
