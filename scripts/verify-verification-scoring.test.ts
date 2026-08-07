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
 * TD-UI-029 (CRITICAL) — VerificationRunner must not report 1.0 / HIGH / "Model
 * is ready" for a verification that verified nothing. ADR-015: Applicability ≠
 * Evidence ≠ Outcome. This is an honesty-floor fix and ships proven. node:test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { VerificationRunner, computeConfidence } from '../src/core/onboarding/VerificationRunner'
import type { ElementResult, FlowResult, VerificationReport } from '../src/core/onboarding/VerificationRunner'
import { EmptyModelError } from '../src/core/errors/OperatorFacingError'
import type { AppModel } from '../src/core/onboarding/types'

const elem = (status: ElementResult['status']): ElementResult => ({
  elementId: 'e', name: 'e', pageId: 'p', status, strategyUsed: null,
  durationMs: 0, error: null, screenshotPath: null, nearestMatch: null, verificationTier: 'dom-presence',
})
const flow = (status: FlowResult['status']): FlowResult => ({
  flowId: 'f', displayName: 'f', status, stepsTotal: 1, stepsPassed: status === 'passed' ? 1 : 0,
  failedAtStep: null, error: null, screenshotPath: null, durationMs: 0, verificationTier: 'interaction',
})
const arr = (n: number, status: ElementResult['status']) => Array.from({ length: n }, () => elem(status))
const model = (appType: string): AppModel =>
  ({ app: { name: 'x', modelVersion: '1.0.0', appType } } as unknown as AppModel)

// buildReport is private — exercise it directly for the full report behaviour.
function build(appType: string, elems: ElementResult[], flows: FlowResult[]): VerificationReport {
  const vr = new VerificationRunner('x') as unknown as {
    buildReport(m: AppModel, e: ElementResult[], f: FlowResult[], s: unknown[], t: string, es: number, nc: string[]): VerificationReport
  }
  return vr.buildReport(model(appType), elems, flows, [], '2026-01-01T00:00:00.000Z', 0, [])
}

const schemaValidEmpty = (name: string) => ({
  schemaVersion: '2.0', generatedAt: '2026-07-13T18:05:24.200Z', generatedBy: 'human',
  app: {
    name, displayName: name, baseUrl: 'https://the-internet.herokuapp.com', appType: 'web-ui',
    modelVersion: '1.0.0', spaConfig: null,
    evidenceState: 'crawled-empty',
    crawlMetadata: {
      crawlConfigHash: 'sha256:b3', crawledAt: '2026-07-13T18:05:24.200Z', crawledBy: 'human',
      crawlDurationMs: 2855, pagesBudget: 50, pagesDiscovered: 0, pagesSkipped: 0,
      aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
    },
  },
  roles: [], pages: [], flows: [], endpoints: null, api: null, diff: null,
})

// ── computeConfidence — pure arithmetic ─────────────────────────────────────────

test('computeConfidence: API renorm — flows NOT applicable, elements 40/40 → 1.0 (never penalised)', () => {
  // ANTI-REGRESSION: fails the build if anyone re-collapses applicability into
  // evidence and drops an API app below 1.0.
  assert.equal(computeConfidence([
    { applicable: true,  total: 40, passed: 40, weight: 0.6 },
    { applicable: false, total: 0,  passed: 0,  weight: 0.4 },
  ]), 1.0)
})
test('computeConfidence: applicable-but-absent keeps its weight in the denominator → 0.6', () => {
  assert.equal(computeConfidence([
    { applicable: true, total: 40, passed: 40, weight: 0.6 },
    { applicable: true, total: 0,  passed: 0,  weight: 0.4 },
  ]), 0.6)
})
test('computeConfidence: no applicable component gathered evidence → null (never 0, never a sentinel)', () => {
  assert.equal(computeConfidence([
    { applicable: true, total: 0, passed: 0, weight: 0.6 },
    { applicable: true, total: 0, passed: 0, weight: 0.4 },
  ]), null)
})

// ── V1-V7 ───────────────────────────────────────────────────────────────────────

test('V1 zero elements + zero flows (both applicable) → null / insufficient-evidence, not HIGH, not ready', () => {
  const r = build('web-ui', [], [])
  assert.equal(r.confidenceScore, null)
  assert.equal(r.confidenceLevel, 'insufficient-evidence')
  assert.notEqual(r.confidenceLevel, 'HIGH')
  assert.equal(r.recommendation.includes('Model is ready'), false)
})

test('V2 API app: flows NOT APPLICABLE, elements 40/40 → HIGH (API apps not permanently penalised)', () => {
  const r = build('rest-api', arr(40, 'passed'), [])
  assert.equal(r.confidenceScore, 1.0)
  assert.equal(r.confidenceLevel, 'HIGH')
})

test('V3 web app: 40/40 elements, 0 flows applicable-but-absent → 0.6 / LOW', () => {
  // Raj ruling: the pinned value is the SCORE (0.6). The tier follows the
  // existing bands (MEDIUM ≥ 0.65), which are NOT moved to make a number read
  // better — that reflex produced the 0.6 default this whole fix removes. An
  // applicable component never measured IS a weak result; 0.6 → LOW is honest.
  // (Threshold review under the new scoring model is logged as TD-UI-038.)
  const r = build('web-ui', arr(40, 'passed'), [])
  assert.equal(r.confidenceScore, 0.6)
  assert.equal(r.confidenceLevel, 'LOW')
})

test('V4 every page fails to load → could-not-verify COUNTS in total, score NOT 1.0, not ready', () => {
  const r = build('web-ui', arr(30, 'could-not-verify'), [])
  assert.equal(r.elementsTotal, 30)
  assert.equal(r.elementsCouldNotVerify, 30)
  assert.equal(r.elementsPassed, 0)
  assert.notEqual(r.confidenceScore, 1.0)
  assert.equal(r.confidenceScore, 0)   // (0/30)*0.6 / 1.0
  assert.equal(r.recommendation.includes('Model is ready'), false)
})

test('V6 mixed loads → could-not-verify counted, score reflects it, defect vs verification-failure distinguishable', () => {
  const r = build('web-ui', [...arr(20, 'passed'), ...arr(20, 'could-not-verify')], [])
  assert.equal(r.elementsTotal, 40)
  assert.equal(r.elementsPassed, 20)
  assert.equal(r.elementsCouldNotVerify, 20)                 // distinct diagnosis
  assert.equal(r.confidenceScore, 0.3)                       // (20/40)*0.6 / 1.0
  const failed = r.elementsTotal - r.elementsPassed - r.elementsCouldNotVerify
  assert.equal(failed, 0)                                    // could-not-verify (20) ≠ failed (0)
})

test('V5 DB row for a verification is NEVER status:passed (Nova: verification is not a test execution)', () => {
  const src = fs.readFileSync(path.resolve('src/core/onboarding/VerificationRunner.ts'), 'utf-8')
  assert.ok(src.includes("status:           'inconclusive'"), 'verification must write status:inconclusive')
  assert.equal(/confidenceLevel === 'HIGH' \? 'passed'/.test(src), false, 'must not map confidenceLevel HIGH → passed')
})

test('V7 EmptyModelError guard still fires for an empty SQLite snapshot', async () => {
  const appName = 'zzz-vscore-empty-proof'
  const empty = schemaValidEmpty(appName) as unknown as AppModel
  const service = { requireActive: async () => empty } as any
  const workspace = { saveModelProjection: async () => {} } as any
  await assert.rejects(
    () => new VerificationRunner(appName, undefined, workspace, service).run(),
    (e: unknown) => e instanceof EmptyModelError,
  )
})

// ── The earned "Model is ready" gate — Nova's five conditions ─────────────────────

test('Gate: emitted ONLY when all five conditions hold (perfect web app)', () => {
  const r = build('web-ui', arr(40, 'passed'), [flow('passed'), flow('passed')])
  assert.equal(r.confidenceScore, 1.0)
  assert.equal(r.confidenceLevel, 'HIGH')
  assert.equal(r.recommendation.includes('Model is ready'), true)
})
test('Gate: NOT emitted when a could-not-verify is present', () => {
  const r = build('web-ui', [...arr(39, 'passed'), elem('could-not-verify')], [flow('passed')])
  assert.equal(r.recommendation.includes('Model is ready'), false)
})
test('Gate: NOT emitted when an element failed', () => {
  const r = build('web-ui', [...arr(39, 'passed'), elem('failed')], [flow('passed')])
  assert.equal(r.recommendation.includes('Model is ready'), false)
})
test('Gate: NOT emitted when a flow failed', () => {
  const r = build('web-ui', arr(40, 'passed'), [flow('passed'), flow('failed')])
  assert.equal(r.recommendation.includes('Model is ready'), false)
})
test('Gate: NOT emitted when an applicable component was not measured (web app, 0 flows)', () => {
  const r = build('web-ui', arr(40, 'passed'), [])
  assert.equal(r.recommendation.includes('Model is ready'), false)
})
test('Gate: NOT emitted when insufficient-evidence', () => {
  const r = build('web-ui', [], [])
  assert.equal(r.recommendation.includes('Model is ready'), false)
})
