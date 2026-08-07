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
 * TD-140 — a generated test whose every step is honestly omitted (FC-004a/TD-081) must NOT
 * emit a vacuous green. Proof of the generation-time enforcement + the ADR-018 §3 aggregate
 * propagation:
 *   V1  a fully-omitted flow → the full-flow test is emitted as test.skip (not a bare pass)
 *   V2  the skip carries a forge:could-not-verify annotation + the Nova refusal wording + reasons
 *   V3  a partial test (≥1 executable + omissions) is NOT caught — emitted unchanged, no skip
 *   V4  the generator's structural tally classifies vacuous vs partial (never by parsing source)
 *   V5  #5 bridge — regradeStatus re-grades an ANNOTATED skip to could-not-verify; an ordinary
 *       developer skip (no annotation) stays skipped
 *   V6  #5 aggregate — a run with one vacuous (could-not-verify) test does NOT read as passed
 * Run: npx tsx --test scripts/verify-td140-vacuous-refusal.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SpecGenerator } from '../src/core/onboarding/generators/SpecGenerator'
import { regradeStatus, deriveRunOutcome } from '../src/core/pipeline/testResultExtraction'
import { FORGE_COULD_NOT_VERIFY } from '../src/core/healing/couldNotVerify'

// Ungrounded click → determineClickCapability = 'omit-ungrounded' (grounding neither
// observed nor inferred) → an omission with reason 'interaction-never-observed'.
const ungroundedClick = (i: number) => ({ stepIndex: i, pageId: `p${i}`, action: 'click', elementId: `p${i}:btn`, targetPageId: null, value: null }) as any
// A navigate step → an executable statement (await role.goto).
const navigate = (i: number) => ({ stepIndex: i, pageId: `p${i}`, action: 'navigate', elementId: null, targetPageId: null, value: '/' }) as any

const model = (flows: any[]) => ({
  modelVersion: '1.0.0',
  app: { name: 'td140', baseUrl: 'https://example.com', appType: 'web-ui' },
  roles: [],
  pages: [],
  flows,
}) as any

function generate(flows: any[]): { specText: string; gen: SpecGenerator } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td140-'))
  fs.mkdirSync(path.join(dir, 'specs'), { recursive: true })
  const gen = new SpecGenerator(model(flows))
  gen.generate(dir)
  const specFile = fs.readdirSync(path.join(dir, 'specs')).find(f => f.endsWith('.generated.spec.ts'))!
  const specText = fs.readFileSync(path.join(dir, 'specs', specFile), 'utf-8')
  fs.rmSync(dir, { recursive: true, force: true })
  return { specText, gen }
}

const vacuousFlow = [{ id: 'vac-flow', displayName: 'Vacuous', roleId: 'standardUser',
  confidence: 'unknown', source: 'inferred', steps: [ungroundedClick(1), ungroundedClick(2), ungroundedClick(3)] }]
const partialFlow = [{ id: 'part-flow', displayName: 'Partial', roleId: 'standardUser',
  confidence: 'partial', source: 'inferred', steps: [navigate(1), ungroundedClick(2)] }]

// ── V1/V2 — a fully-omitted flow is refused as an annotated skip ─────────────────
test('V1 fully-omitted flow → full-flow test emitted as test.skip, NOT a vacuous pass', () => {
  const { specText } = generate(vacuousFlow)
  assert.match(specText, /test\.skip\(true,/, 'vacuous test must be a skip')
  // A vacuous body has no executable statement — no awaited assertion/goto survives.
  assert.doesNotMatch(specText, /await expect\(/, 'a refused test must carry no assertion')
  assert.doesNotMatch(specText, /\.goto\(/, 'a refused test must carry no executable step')
})

test('V2 the skip is an evidence-based FORGE refusal (annotation + reason + omission reasons)', () => {
  const { specText } = generate(vacuousFlow)
  assert.match(specText, new RegExp(`type: '${FORGE_COULD_NOT_VERIFY}'`), 'must carry the could-not-verify annotation')
  assert.match(specText, /FORGE did not execute this test because every requested step lacked sufficient grounded evidence/,
    'reason must be the evidence-based refusal wording, not a disabled-test note')
  assert.match(specText, /interaction-never-observed/, 'reason must name the omission reasons')
})

// ── V3 — the partials must NOT be caught (ruling #3) ─────────────────────────────
test('V3 a partial test (≥1 executable + omissions) is a REAL test — never skipped', () => {
  const { specText } = generate(partialFlow)
  assert.match(specText, /await standardUser\.goto\('\/'\)/, 'the executable step survives')
  assert.match(specText, /FORGE\[omissionReason=interaction-never-observed\]/, 'the honest omission comment survives')
  assert.doesNotMatch(specText, /test\.skip\(/, 'a test with ≥1 executable statement must NOT be skipped')
})

// ── V4 — structural tally (never text-parsing) ───────────────────────────────────
test('V4 the generator tally classifies vacuous vs partial structurally', () => {
  const vac = generate(vacuousFlow).gen.getTestTally()
  const vacFull = vac.find(t => t.kind === 'full-flow')!
  assert.equal(vacFull.executableCount, 0, 'fully-omitted full-flow test has zero executable statements')
  assert.equal(vacFull.omissionCount, 3)
  assert.deepEqual(vacFull.omissionReasons, ['interaction-never-observed', 'interaction-never-observed', 'interaction-never-observed'])

  const part = generate(partialFlow).gen.getTestTally()
  const partFull = part.find(t => t.kind === 'full-flow')!
  assert.equal(partFull.executableCount, 1, 'partial keeps its executable statement — not vacuous')
  assert.equal(partFull.omissionCount, 1)
})

// ── V5 — the #5 bridge: regradeStatus (one law, shared by reporter + batch) ───────
test('V5 regradeStatus: an ANNOTATED skip → could-not-verify; an ordinary skip stays skipped', () => {
  const cnv = [{ type: FORGE_COULD_NOT_VERIFY, description: 'vacuous-refusal' }]
  assert.equal(regradeStatus('skipped', cnv), 'could-not-verify', 'FORGE-refusal skip re-grades')
  assert.equal(regradeStatus('skipped', undefined), 'skipped', 'ordinary developer skip is untouched')
  assert.equal(regradeStatus('skipped', [{ type: 'skip' }]), 'skipped', 'a bare skip annotation is not a FORGE refusal')
  assert.equal(regradeStatus('passed', cnv), 'passed', 'a pass is never re-graded')
})

// ── V6 — the #5 aggregate: a run with a vacuous refusal is not fully passed ───────
test('V6 deriveRunOutcome: a run with a could-not-verify (vacuous) test → unknown, NOT passed', () => {
  // 53 real passes + 1 vacuous refusal (counted as could-not-verify).
  assert.equal(
    deriveRunOutcome({ realFailed: 0, realExecuted: 53, couldNotVerify: 1, unhealthy: false, interrupted: false }),
    'unknown',
    'a no-evidence refusal must drop the run off a full pass (ADR-018 §3)',
  )
  // Control: no refusal → a clean run still passes.
  assert.equal(
    deriveRunOutcome({ realFailed: 0, realExecuted: 53, couldNotVerify: 0, unhealthy: false, interrupted: false }),
    'passed',
  )
})
