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
 * ADR-018 RED-SIDE — by-construction proof test (R1–R15).
 *
 * The milestone identity: "uncertainty cannot disappear anywhere between
 * SmartLocator and trend reporting." Each R makes one collapse-point impossible
 * by assertion:
 *   SITE 1 (Heal)      R1–R3   typed error + annotation guard + failure persistence
 *   SITE 2 (Ingestion) R4–R7   vocab widen + re-grade at both readers (failed dominates)
 *   SITE 3 (Run)       R8–R9,R13–R15  authoritative + partial routing, reconcile gap
 *   3b   (Pass-rate)   R10–R11 could-not-verify excluded from numerator, kept in denominator
 *   e2e                R12     the full pipe — no uncertainty lost
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 * HEAL_STORE_PATH / CURRENT_RUN_ID set BEFORE any heal-store import; DB via the
 * initDb seam (TD-114/TD-120 pattern). Env-sensitive modules loaded dynamically.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'adr018-'))
process.env.HEAL_STORE_PATH = path.join(TMP, 'heal-store.json')   // MUST precede heal-store load
process.env.CURRENT_RUN_ID  = 'adr018-run'

import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { RunRepository } from '../src/core/storage/repositories/RunRepository'
import { TrendRepository } from '../src/core/storage/repositories/TrendRepository'
import { NewRun } from '../src/core/storage/types'
import {
  normalizeStatus, regradeStatus, deriveRunOutcome, extractTestResults,
  ExtractableSuite,
} from '../src/core/pipeline/testResultExtraction'
import { FORGE_COULD_NOT_VERIFY, hasCouldNotVerify, HealUnresolvedError } from '../src/core/healing/couldNotVerify'

initDb(path.join(TMP, 'forge.db'))

const CNV = [{ type: FORGE_COULD_NOT_VERIFY, description: 'heal exhausted' }]

function makeRun(runId: string, app: string, status: string, startedAt: string, inputHealth = 'healthy'): NewRun {
  return {
    run_id: runId, app_name: app, branch: 'test', commit_sha: 'test',
    environment: 'test', base_url: 'https://example.com', triggered_by: 'test',
    reporter_version: 'test', status, total_tests: 1, passed: 1, failed: 0,
    skipped: 0, duration_ms: 1, started_at: startedAt, completed_at: startedAt,
    metadata: '{}', input_health: inputHealth,
  }
}

function suiteWith(status: string, annotations?: { type: string; description?: string }[]): ExtractableSuite[] {
  return [{
    title: 'S', specs: [{
      title: 'a test', file: 'x.spec.ts',
      tests: [{ projectName: 'chromium', status, results: [{ status, duration: 1 }], annotations }],
    }],
  }]
}

after(() => {
  try { closeDb() } catch {}
  // Best-effort: on Windows the SQLite handle may not release synchronously, so a
  // temp-dir rm can EPERM. Leftover files under the OS temp dir are harmless.
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
})

test('setup — migrate temp DB', async () => { await runMigrations() })

// ═══ SITE 1 — HEAL ════════════════════════════════════════════════════════════

test('R1 HealUnresolvedError is a distinct typed error (not a plain Error)', () => {
  const e = new HealUnresolvedError('exhausted', 'LoginPage::user')
  assert.ok(e instanceof HealUnresolvedError)
  assert.ok(e instanceof Error)
  assert.equal(e.forgeCouldNotVerify, true)        // brand distinct from browser/network errors
  assert.equal(e.name, 'HealUnresolvedError')
  assert.equal(e.key, 'LoginPage::user')
  assert.ok(!(new Error('x') instanceof HealUnresolvedError))   // (b) env error stays distinct from (c)
})

test('R2 attachCouldNotVerify is a no-op OUTSIDE a running test (guarded, never crashes)', async () => {
  const { attachCouldNotVerify } = await import('../src/core/healing/SmartLocator')
  // test.info() throws outside a Playwright test; the guard must swallow it.
  assert.doesNotThrow(() => attachCouldNotVerify('no test context here'))
})

test('R3 recordUnresolved writes a heal_events FAILURE row and does NOT touch the promotion store', async () => {
  const { healStore } = await import('../src/core/healing/HealStore')
  const before = Object.keys(healStore.getAll()).length
  const beforeCandidates = healStore.getPomUpdateCandidates().length

  await healStore.recordUnresolved('LoginPage::username', 'id', 'failed')

  const rows = await getDb().selectFrom('heal_events')
    .selectAll().where('heal_type', '=', 'unresolved').execute()
  assert.equal(rows.length, 1, 'exactly one unresolved evidence row')
  const r = rows[0]
  assert.equal(r.heal_type, 'unresolved')
  assert.equal(r.heal_confidence, 'failed')        // deriveHealConfidence(false,'')
  assert.equal(r.confidence, -1)                   // UNVERIFIED_HEAL_CONFIDENCE sentinel
  assert.equal(r.healed_strategy, '')              // NO working selector stored
  assert.equal(r.consecutive_count, 0)             // NO success-counter bump
  assert.equal(r.promoted, 0)
  assert.equal(r.original_strategy, 'id')
  assert.equal(r.page, 'LoginPage')
  assert.equal(r.element, 'username')
  // promotion store untouched — a failed heal is not a POM-promotion signal
  assert.equal(Object.keys(healStore.getAll()).length, before, 'JSON promotion store unchanged')
  assert.equal(healStore.getPomUpdateCandidates().length, beforeCandidates, 'no new promotion candidate')
})

// ═══ SITE 2 — INGESTION ═══════════════════════════════════════════════════════

test('R4 normalizeStatus: timedOut / interrupted / unknown-default → could-not-verify (reversed phantom-red)', () => {
  assert.equal(normalizeStatus('timedOut'),    'could-not-verify')
  assert.equal(normalizeStatus('interrupted'), 'could-not-verify')
  assert.equal(normalizeStatus('who-knows'),   'could-not-verify')   // was 'failed' before this milestone
})

test('R5 normalizeStatus/regradeStatus: a real failure still holds (failed dominates)', () => {
  assert.equal(normalizeStatus('unexpected'), 'failed')
  assert.equal(normalizeStatus('expected'),   'passed')
  assert.equal(regradeStatus('failed', undefined), 'failed')          // no annotation → stays failed
  assert.equal(regradeStatus('failed', [{ type: 'other' }]), 'failed')// unrelated annotation → stays failed
})

test('R6 streaming re-grade rule: failed + forge:could-not-verify → could-not-verify; without → failed', () => {
  // The streaming reader (ForgeStreamingReporter.onTestEnd) applies exactly this
  // predicate: base==='failed' && hasCouldNotVerify(result.annotations).
  assert.equal(hasCouldNotVerify(CNV), true)
  assert.equal(regradeStatus('failed', CNV), 'could-not-verify')
  assert.equal(regradeStatus('passed', CNV), 'passed')   // never re-grade a pass
})

test('R7 batch re-grade via ExtractableTest annotations', () => {
  const withAnn = extractTestResults(suiteWith('unexpected', CNV), 'r')
  assert.equal(withAnn[0].status, 'could-not-verify')
  const withoutAnn = extractTestResults(suiteWith('unexpected'), 'r')
  assert.equal(withoutAnn[0].status, 'failed')           // real failure dominates
})

// ═══ SITE 3 — RUN OUTCOME ═════════════════════════════════════════════════════

test('R8 run outcome: unhealthy input + 0 failures → unknown (could-not-verify), NOT passed', () => {
  const o = deriveRunOutcome({ realFailed: 0, realExecuted: 5, couldNotVerify: 0, unhealthy: true, interrupted: false })
  assert.equal(o, 'unknown')   // the authoritative-writer phantom-GREEN fix
})

test('R9 run outcome: a real failure + unhealthy input → failed (failed dominates could-not-verify)', () => {
  const o = deriveRunOutcome({ realFailed: 1, realExecuted: 5, couldNotVerify: 0, unhealthy: true, interrupted: false })
  assert.equal(o, 'failed')
})

test('R14 reporter-only path: interrupted / zero-test → unknown (reporter routes what it HAS)', () => {
  assert.equal(deriveRunOutcome({ realFailed: 0, realExecuted: 3, couldNotVerify: 0, unhealthy: false, interrupted: true }), 'unknown')
  assert.equal(deriveRunOutcome({ realFailed: 0, realExecuted: 0, couldNotVerify: 0, unhealthy: false, interrupted: false }), 'unknown')
  // a heal-caused could-not-verify test drags a mixed run to unknown even with passes
  assert.equal(deriveRunOutcome({ realFailed: 0, realExecuted: 5, couldNotVerify: 1, unhealthy: false, interrupted: false }), 'unknown')
  // clean run still passes (no false could-not-verify)
  assert.equal(deriveRunOutcome({ realFailed: 0, realExecuted: 5, couldNotVerify: 0, unhealthy: false, interrupted: false }), 'passed')
})

test('R15 results-store authoritative: input_health invalid + 0 failures → unknown', () => {
  // mirrors the results-store call: unhealthy = inputHealth !== 'healthy'
  const unhealthy = ('invalid' as string) !== 'healthy'
  assert.equal(deriveRunOutcome({ realFailed: 0, realExecuted: 5, couldNotVerify: 0, unhealthy, interrupted: false }), 'unknown')
})

test('R13 reconcile gap: updateInputHealth lands the honest assessment on the reporter-default row', async () => {
  const repo = new RunRepository()
  // reporter creates the row with the migration-009 default 'unknown'
  await repo.insert(makeRun('r13', 'adr018-r13', 'unknown', '2026-07-16T00:00:00Z', 'unknown'))
  await repo.updateInputHealth('r13', 'invalid', 'no-run')
  const row = await repo.findById('r13')
  assert.equal(row?.input_health, 'invalid')             // not left at reporter default
  assert.equal(row?.input_health_reason, 'no-run')
})

// ═══ 3b — PASS-RATE (mirror Verify Corollary-2) ═══════════════════════════════

test('R10 TrendRepository: could-not-verify run excluded from numerator, kept in denominator', async () => {
  const app = 'adr018-trend'
  const today = new Date().toISOString().slice(0, 10)
  const repo = new RunRepository()
  await repo.insert(makeRun('t1', app, 'passed',  `${today}T01:00:00.000Z`))
  await repo.insert(makeRun('t2', app, 'unknown', `${today}T02:00:00.000Z`))  // could-not-verify
  await repo.insert(makeRun('t3', app, 'failed',  `${today}T03:00:00.000Z`))
  await repo.insert(makeRun('t4', app, 'passed',  `${today}T04:00:00.000Z`))
  await new TrendRepository().computeAndUpsertForRun(app, 't4')
  const trend = await new TrendRepository().getLatest(app)
  // passedRuns=2 (t1,t4), totalRuns=4 → 0.5. 'unknown' NOT in numerator, still in denominator.
  assert.equal(trend?.pass_rate, 0.5)
})

test('R11 getPassRateSince (dead twin) uses the identical honest formula', async () => {
  const app = 'adr018-pr'
  const repo = new RunRepository()
  await repo.insert(makeRun('p1', app, 'passed',  '2026-05-01T01:00:00Z'))
  await repo.insert(makeRun('p2', app, 'unknown', '2026-05-01T02:00:00Z'))  // could-not-verify
  await repo.insert(makeRun('p3', app, 'failed',  '2026-05-01T03:00:00Z'))
  const rate = await repo.getPassRateSince(app, '2026-01-01')
  // 1 passed / 3 total = 0.333… ('unknown' excluded from numerator, kept in denominator)
  assert.ok(Math.abs(rate - 1 / 3) < 1e-9, `expected ~0.333, got ${rate}`)
})

// ═══ e2e — THE FULL PIPE ══════════════════════════════════════════════════════

test('R12 end-to-end lattice: heal-unresolved → could-not-verify test → run unknown → NOT a pass in trend', async () => {
  // (1) ingestion re-grades the heal-caused failure
  const testStatus = regradeStatus('failed', CNV)
  assert.equal(testStatus, 'could-not-verify')
  // (2) run rollup routes to unknown (a could-not-verify constituent, 0 real fails)
  const runOutcome = deriveRunOutcome({ realFailed: 0, realExecuted: 0, couldNotVerify: 1, unhealthy: false, interrupted: false })
  assert.equal(runOutcome, 'unknown')
  // (3) pass-rate: the run lands as status='unknown' and is NOT counted as a pass
  const app = 'adr018-e2e'
  const repo = new RunRepository()
  await repo.insert(makeRun('e1', app, runOutcome, '2026-06-01T01:00:00Z'))
  const rate = await repo.getPassRateSince(app, '2026-01-01')
  assert.equal(rate, 0)   // 0 passed / 1 total — the heal-unresolution did not vanish into a green
})
