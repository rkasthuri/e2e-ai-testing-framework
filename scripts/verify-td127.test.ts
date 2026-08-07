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
 * TD-127 — proof tests (knowledge-query + flaky-predictor as pure
 * flaky_analysis consumers).
 *
 * node:test + node:assert/strict under tsx. T1/T2/T4 run against a real
 * scratch SQLite DB via the initDb seam (TD-114/TD-120 pattern); the
 * behavioral flaky-predictor test executes the actual script as a child
 * process against that DB. T5-T8 are source-level invariants.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { FlakyAnalysisRepository } from '../src/core/storage/repositories/FlakyAnalysisRepository'
import { NewFlakyAnalysis } from '../src/core/storage/types'

const REPO_ROOT = path.resolve(__dirname, '..')

// ── shared temp DB (initDb seam — TD-114 pattern) ─────────────────────────────

const dbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td127-'))
const dbPath = path.join(dbRoot, 'forge.db')
initDb(dbPath)

const APP = 'td127app'

function row(testId: string, score: number, confidence: string, trend = 'stable'): NewFlakyAnalysis {
  return {
    test_id: testId, app_name: APP, analysis_date: '2026-07-08',
    flaky_score: score, signal_timing: 0, signal_selector: 0, signal_data: 0,
    signal_env: 0, signal_concurrency: 0, signal_network: 0,
    sample_size: confidence === 'insufficient-evidence' ? 1 : 12,
    recommendation: 'r', trend, confidence,
  } as NewFlakyAnalysis
}

async function seed(): Promise<void> {
  await runMigrations()   // idempotent — first DB touch in this file
  const repo = new FlakyAnalysisRepository()
  await repo.upsert(row('a.spec.ts::low::chromium', 10, 'high'))
  await repo.upsert(row('b.spec.ts::high::chromium', 80, 'high', 'degrading'))
  await repo.upsert(row('c.spec.ts::mid::chromium', 45, 'medium'))
  await repo.upsert(row('d.spec.ts::new::chromium', 0, 'insufficient-evidence', 'unknown'))
  await repo.upsert(row('e.spec.ts::new2::chromium', 0, 'insufficient-evidence', 'unknown'))
}
const seeded = seed()

function src(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8')
}
function liveLines(content: string, needle: string): string[] {
  return content.split('\n').filter(l => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
    return t.includes(needle)
  })
}

// ── T1-T2: FlakyAnalysisRepository.findByApp ──────────────────────────────────

test('T1 findByApp returns rows ordered by flaky_score desc', async () => {
  await seeded
  const rows = await new FlakyAnalysisRepository().findByApp(APP)
  assert.equal(rows.length, 5)
  const scores = rows.map(r => r.flaky_score)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), `not desc: ${scores}`)
  assert.equal(rows[0].test_id, 'b.spec.ts::high::chromium')
})

test('T2 findByApp includes insufficient-evidence rows (never filtered)', async () => {
  await seeded
  const rows = await new FlakyAnalysisRepository().findByApp(APP)
  const insufficient = rows.filter(r => r.confidence === 'insufficient-evidence')
  assert.equal(insufficient.length, 2, 'insufficient-evidence rows were filtered out')
})

// ── T3-T4: flaky-predictor behavioral (real script, scratch DB) ───────────────

let predictions: any = null
async function runPredictor(): Promise<any> {
  if (predictions) return predictions
  await seeded
  // Run the real script against the scratch DB from a scratch cwd (so
  // reports/ writes land there, not in the repo).
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'td127-out-'))
  fs.mkdirSync(path.join(cwd, 'reports'), { recursive: true })
  execFileSync(process.execPath, [
    path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(REPO_ROOT, 'src', 'pipeline', 'flaky-predictor.ts'),
  ], {
    cwd,
    env: { ...process.env, APP_NAME: APP, DB_PATH: dbPath, DB_URL: '' },
    stdio: 'pipe',
  })
  predictions = JSON.parse(fs.readFileSync(path.join(cwd, 'reports', 'flaky-predictions.json'), 'utf-8'))
  return predictions
}

test('T3 flaky-predictions.json shape: schemaVersion + predictions + insufficientEvidence', async () => {
  const out = await runPredictor()
  assert.equal(out.schemaVersion, 1)
  assert.ok(typeof out.generatedAt === 'string' && out.generatedAt.length > 0)
  assert.ok('sourceRun' in out)
  assert.ok(Array.isArray(out.predictions), 'predictions missing')
  assert.ok(out.insufficientEvidence && typeof out.insufficientEvidence.count === 'number', 'insufficientEvidence section missing')
  // predictions are scored-only
  assert.equal(out.predictions.some((r: any) => r.confidence === 'insufficient-evidence'), false)
})

test('T4 insufficient-evidence count matches the actual insufficient rows', async () => {
  const out = await runPredictor()
  assert.equal(out.insufficientEvidence.count, 2)
  assert.deepEqual(out.insufficientEvidence.testIds.sort(),
    ['d.spec.ts::new::chromium', 'e.spec.ts::new2::chromium'])
  assert.match(out.insufficientEvidence.message, /2 test\(s\) need more run history/)
  assert.equal(out.summary.scoredTests, 3)
  assert.equal(out.summary.highRisk, 1)      // score 80 > 60
  assert.equal(out.summary.degrading, 1)
})

// ── T5-T8: source-level invariants ────────────────────────────────────────────

test('T5 flaky-predictor: writer path deleted — no upsert, no aiCall (pure consumer)', () => {
  const content = src('src/pipeline/flaky-predictor.ts')
  assert.deepEqual(liveLines(content, '.upsert('), [], 'flaky-predictor still writes flaky_analysis')
  assert.deepEqual(liveLines(content, 'aiCall'), [], 'flaky-predictor still calls AI')
  assert.deepEqual(liveLines(content, 'trends.tests'), [], 'hollow trends.tests survives')
})

test('T6 knowledge-query: crash fix — no legacy cast of DB rows; stats built from real columns', () => {
  const content = src('src/pipeline/knowledge-query.ts')
  // The crash: raw DB rows cast into the legacy .stats shape.
  assert.deepEqual(liveLines(content, 'as any as RunHistory'), [], 'legacy RunHistory cast survives')
  assert.deepEqual(liveLines(content, 'TrendStore'), [], 'hollow TrendStore survives')
  // The fix: RunRecord.stats constructed from real snake_case columns.
  assert.ok(content.includes('run.total_tests'), 'stats not built from run.total_tests')
  assert.ok(content.includes('run.started_at'), 'timestamp not from started_at')
})

test('T7 knowledge-query: riskLevel reads from flaky_analysis, not trends.tests', () => {
  const content = src('src/pipeline/knowledge-query.ts')
  assert.deepEqual(liveLines(content, 'trends.tests'), [], 'riskLevel still reads trends.tests')
  assert.ok(content.includes('FlakyAnalysisRepository'), 'flaky_analysis not consulted')
  assert.ok(/insufficient-evidence.*'Unknown'|'Unknown'.*insufficient-evidence/s.test(content),
    'insufficient-evidence → Unknown mapping missing')
})

test('T8 T11-guard parity: no live trends.json line in either file', () => {
  for (const f of ['src/pipeline/flaky-predictor.ts', 'src/pipeline/knowledge-query.ts']) {
    assert.deepEqual(liveLines(src(f), 'trends.json'), [], `${f} references trends.json outside comments`)
  }
})
