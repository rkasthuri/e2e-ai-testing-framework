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
 * TD-120 — proof tests (AnalysisPipeline, flakyScoring, FlakyPredictorStage,
 * test-result extraction, transaction atomicity).
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 *
 * SINGLETON NOTE: the DB tests (T8-T10, T12) share one temp project DB via the
 * initDb seam (TD-114 pattern — the file runs in its own process under the
 * runner). A final cleanup test closes it and removes the temp root.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AnalysisPipeline, AnalysisStage, AnalysisContext } from '../src/core/pipeline/AnalysisPipeline'
import { FlakyPredictorStage } from '../src/core/pipeline/stages/FlakyPredictorStage'
import { calcRisk, computeFlakyScore } from '../src/core/pipeline/stages/scoring/flakyScoring'
import { normalizeStatus, extractTestResults } from '../src/core/pipeline/testResultExtraction'
import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { RunRepository } from '../src/core/storage/repositories/RunRepository'
import { TestResultRepository } from '../src/core/storage/repositories/TestResultRepository'
import { NewRun, NewTestResult } from '../src/core/storage/types'

const REPO_ROOT = path.resolve(__dirname, '..')

// ── shared temp DB (initDb seam — TD-114 pattern) ─────────────────────────────

const dbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td120-'))
initDb(path.join(dbRoot, 'forge.db'))

function makeRun(runId: string, appName = 'td120app'): NewRun {
  return {
    run_id: runId, app_name: appName, branch: 'test', commit_sha: 'test',
    environment: 'test', base_url: 'https://example.com', triggered_by: 'test',
    reporter_version: 'test', status: 'passed', total_tests: 1, passed: 1,
    failed: 0, skipped: 0, duration_ms: 1, started_at: '2026-07-07T00:00:00Z',
    completed_at: '2026-07-07T00:00:01Z', metadata: '{}',
  }
}

function makeRow(runId: string, testId: string, status: string, startedAt: string): NewTestResult {
  return {
    run_id: runId, test_id: testId, title: 't', suite: 's', status,
    duration_ms: 100, retry_count: 0, browser: 'chromium', started_at: startedAt,
    worker_index: 0, tier: 'ui', tags: '[]', flaky_history: 0, metadata: '{}',
    error_msg: null,
  }
}

/** Seed N history rows for one test (descending timestamps = most-recent-first). */
async function seedHistory(testId: string, statuses: string[], appName = 'td120app'): Promise<void> {
  const runRepo = new RunRepository()
  const trRepo  = new TestResultRepository()
  const rows: NewTestResult[] = []
  for (let i = 0; i < statuses.length; i++) {
    const runId = `${testId}-run-${i}`
    await runRepo.insert(makeRun(runId, appName))
    // i=0 is most recent — timestamps descend as i grows
    rows.push(makeRow(runId, testId, statuses[i], `2026-07-06T${String(23 - Math.floor(i / 4)).padStart(2, '0')}:${String(59 - (i % 4) * 10).padStart(2, '0')}:00Z`))
  }
  await trRepo.insertBatch(rows)
}

const ctx = (appName = 'td120app'): AnalysisContext =>
  ({ runId: 'analysis-run', appName, db: getDb() })

// ── T1-T2: AnalysisPipeline mechanics ─────────────────────────────────────────

test('T1 stages run in declared order', async () => {
  const order: string[] = []
  const mk = (name: string): AnalysisStage => ({ name, run: async () => { order.push(name) } })
  await new AnalysisPipeline().addStage(mk('a')).addStage(mk('b')).addStage(mk('c')).run(ctx())
  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('T2 a throwing stage does not abort the pipeline', async () => {
  const order: string[] = []
  const boom: AnalysisStage = { name: 'boom', run: async () => { throw new Error('kaput') } }
  const after: AnalysisStage = { name: 'after', run: async () => { order.push('after') } }
  await new AnalysisPipeline().addStage(boom).addStage(after).run(ctx())
  assert.deepEqual(order, ['after'])
})

// ── T3: status normalization ──────────────────────────────────────────────────

test('T3 normalizeStatus maps Playwright expectation vocabulary', () => {
  assert.equal(normalizeStatus('expected'), 'passed')
  assert.equal(normalizeStatus('unexpected'), 'failed')
  assert.equal(normalizeStatus('flaky'), 'flaky')
  assert.equal(normalizeStatus('skipped'), 'skipped')
  // ADR-018 RED-SIDE (2026-07-16): the default was REVERSED from 'failed' to
  // 'could-not-verify'. An unrecognized status is "I don't recognize this"
  // (could-not-verify), NOT a demonstrated failure — closing the phantom-red at
  // the ingestion vocabulary. See scripts/verify-adr018-redside.test.ts R4/R5.
  assert.equal(normalizeStatus('something-new'), 'could-not-verify')   // unknown: never a silent pass, never a false fail
})

// ── T4-T7: pure scoring ───────────────────────────────────────────────────────

test('T4 calcRisk: 3 consecutive failures → High', () => {
  assert.equal(calcRisk({ executedRuns: 20, failureCount: 3, flakyCount: 0, consecutiveFails: 3 }), 'High')
})

test('T5 calcRisk: 0 consecutive, 3 flaky → Medium', () => {
  assert.equal(calcRisk({ executedRuns: 20, failureCount: 0, flakyCount: 3, consecutiveFails: 0 }), 'Medium')
})

test('T6 computeFlakyScore: all-passing → score 0, trend stable', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ status: 'passed', started_at: `t${i}` }))
  const s = computeFlakyScore({ executedRuns: 20, failureCount: 0, flakyCount: 0, consecutiveFails: 0 }, history)
  assert.equal(s.score, 0)
  assert.equal(s.trend, 'stable')
})

test('T7 computeFlakyScore: 3 consecutive failures → score > 40, quarantine recommendation', () => {
  const history = [
    { status: 'failed', started_at: 't0' }, { status: 'failed', started_at: 't1' },
    { status: 'failed', started_at: 't2' },
    ...Array.from({ length: 17 }, (_, i) => ({ status: 'passed', started_at: `t${i + 3}` })),
  ]
  const s = computeFlakyScore({ executedRuns: 20, failureCount: 3, flakyCount: 0, consecutiveFails: 3 }, history)
  assert.ok(s.score > 40, `score ${s.score} not > 40`)
  assert.match(s.recommendation, /Quarantine/)
})

// ── T8-T10: FlakyPredictorStage against the real temp DB ─────────────────────

test('T8+T9 skipped rows excluded from denominator; below minSample persists insufficient-evidence', async () => {
  await runMigrations()   // idempotent — first DB touch in this file
  // 12 rows, 3 skipped → executed 9 < minSample 10
  const statuses = ['passed', 'skipped', 'passed', 'failed', 'skipped', 'passed', 'passed', 'skipped', 'passed', 'passed', 'passed', 'failed']
  await seedHistory('app.spec.ts::t8::chromium', statuses)
  await new FlakyPredictorStage({ minSample: 10 }).run(ctx())
  const row = await (getDb() as any).selectFrom('flaky_analysis')
    .selectAll().where('test_id', '=', 'app.spec.ts::t8::chromium').executeTakeFirst()
  assert.ok(row, 'insufficient-evidence row was NOT persisted (suppressed?)')
  assert.equal(row.confidence, 'insufficient-evidence')
  assert.equal(row.sample_size, 9)                     // 12 - 3 skipped: the denominator proof
  assert.match(row.recommendation, /9\/10 runs/)
  assert.equal(row.trend, 'unknown')
})

test('T10 sufficient history → real score persisted (not insufficient-evidence)', async () => {
  const statuses = ['failed', 'failed', 'failed', ...Array(9).fill('passed')]   // 12 executed ≥ 10
  await seedHistory('app.spec.ts::t10::chromium', statuses)
  await new FlakyPredictorStage({ minSample: 10 }).run(ctx())
  const row = await (getDb() as any).selectFrom('flaky_analysis')
    .selectAll().where('test_id', '=', 'app.spec.ts::t10::chromium').executeTakeFirst()
  assert.ok(row)
  assert.notEqual(row.confidence, 'insufficient-evidence')
  assert.ok(row.flaky_score > 40, `expected a high score for 3 consecutive fails, got ${row.flaky_score}`)
  assert.equal(row.sample_size, 12)
  assert.match(row.recommendation, /Quarantine/)
})

// ── T11: extraction captures EVERY status ─────────────────────────────────────

test('T11 extractTestResults captures passing/failed/flaky/skipped (not only flaky)', () => {
  const suites = [{
    title: 'suite',
    specs: [
      { title: 'p', file: 'f.spec.ts', tests: [{ projectName: 'chromium', status: 'expected',   results: [{ status: 'passed', duration: 5, startTime: '2026-07-07T00:00:00Z', workerIndex: 2 }] }] },
      { title: 'x', file: 'f.spec.ts', tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 5, error: { message: 'boom' } }] }] },
      { title: 'k', file: 'f.spec.ts', tests: [{ projectName: 'chromium', status: 'flaky',      results: [{ status: 'failed', duration: 5 }, { status: 'passed', duration: 5 }] }] },
      { title: 's', file: 'f.spec.ts', tests: [{ projectName: 'chromium', status: 'skipped',    results: [] }] },
    ],
  }]
  const rows = extractTestResults(suites, 'run-x')
  assert.equal(rows.length, 4)                                        // ALL tests, not 1
  assert.deepEqual(rows.map(r => r.status), ['passed', 'failed', 'flaky', 'skipped'])
  assert.equal(rows[0].test_id, 'f.spec.ts::p::chromium')             // makeResultKey format
  assert.equal(rows[0].worker_index, 2)
  assert.equal(rows[1].error_msg, 'boom')
  assert.equal(rows[2].retry_count, 1)
})

// ── T12: transaction atomicity via the new trx params ────────────────────────

test('T12 transaction: insertBatch failure rolls back the run row (atomicity)', async () => {
  const db = getDb()
  const badRow = { ...makeRow('atomic-run', 'app.spec.ts::t12::chromium', 'passed', '2026-07-07T00:00:00Z'), title: null } as any
  await assert.rejects(() =>
    db.transaction().execute(async trx => {
      await new RunRepository().insert(makeRun('atomic-run'), trx)
      await new TestResultRepository().insertBatch([badRow], trx)   // NOT NULL violation → throws
    }),
  )
  const run = await (db as any).selectFrom('runs').selectAll()
    .where('run_id', '=', 'atomic-run').executeTakeFirst()
  assert.equal(run, undefined, 'run row survived a failed transaction — atomicity broken')
})

// ── T13: injected-db pattern — no singleton reach-ins in analysis code ────────

test('T13 no getDb() inside AnalysisPipeline / stages / scoring (injected-db proof)', () => {
  for (const f of [
    'src/core/pipeline/AnalysisPipeline.ts',
    'src/core/pipeline/stages/FlakyPredictorStage.ts',
    'src/core/pipeline/stages/scoring/flakyScoring.ts',
  ]) {
    // Strip comment lines first — the docs legitimately DISCUSS getDb()
    // ("stages never call getDb() themselves"); only live code counts.
    const live = fs.readFileSync(path.join(REPO_ROOT, f), 'utf-8')
      .split('\n')
      .filter(l => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
      .join('\n')
    assert.ok(!/\bgetDb\s*\(/.test(live), `${f} calls getDb() — must use the injected ctx.db`)
  }
})

// ── cleanup ───────────────────────────────────────────────────────────────────

test('T-cleanup close temp DB and remove root', async () => {
  await closeDb()
  fs.rmSync(dbRoot, { recursive: true, force: true })
  assert.equal(fs.existsSync(dbRoot), false)
})
