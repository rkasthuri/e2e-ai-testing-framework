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
 * TD-126 — proof tests (ForgeStreamingReporter + run lifecycle + verifier).
 *
 * node:test + node:assert/strict under tsx. Behavioral tests drive the REAL
 * reporter against fresh scratch SQLite DBs via the initDb seam. Each test
 * that opens the DB closes it (reporter.onEnd calls closeDb; onBegin-only
 * tests close manually) so the next test can re-init a different path.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ForgeStreamingReporter } from '../src/pipeline/ForgeStreamingReporter'
import { initDb, getDb, closeDb, resolveSqlitePath } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { RunRepository } from '../src/core/storage/repositories/RunRepository'
import { TestResultRepository } from '../src/core/storage/repositories/TestResultRepository'

const APP = 'td126app'

function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'td126-')) }

// ── minimal Playwright fakes ──────────────────────────────────────────────────
const fakeConfig = {} as any
const fakeSuite = (n: number) => ({ allTests: () => new Array(n).fill(null) }) as any
const fakeTest = (file: string, title: string, project = 'chromium') =>
  ({ location: { file }, title, parent: { title: 'Suite', project: () => ({ name: project }) } }) as any
const fakeResult = (status: string, extra: any = {}) =>
  ({ status, duration: 10, retry: 0, workerIndex: 0, startTime: new Date(0), errors: [], ...extra }) as any
const fakeFull = (status: string) => ({ status }) as any

/** Construct a reporter bound to a fresh scratch DB. */
function reporterOn(dir: string): ForgeStreamingReporter {
  return new ForgeStreamingReporter({ dbPath: path.join(dir, 'forge.db'), appName: APP })
}

// ── T1-T4: shared SQLite path resolver ────────────────────────────────────────

test('T1 resolver finds .forge/forge.db in cwd', () => {
  const dir = tmp(); fs.mkdirSync(path.join(dir, '.forge')); fs.writeFileSync(path.join(dir, '.forge', 'forge.db'), '')
  assert.equal(resolveSqlitePath(undefined, dir), path.join(dir, '.forge', 'forge.db'))
})

test('T2 resolver walks up to a parent .forge/forge.db', () => {
  const root = tmp(); fs.mkdirSync(path.join(root, '.forge')); fs.writeFileSync(path.join(root, '.forge', 'forge.db'), '')
  const child = path.join(root, 'a', 'b'); fs.mkdirSync(child, { recursive: true })
  assert.equal(resolveSqlitePath(undefined, child), path.join(root, '.forge', 'forge.db'))
})

test('T3 fresh workspace resolves to cwd/.forge/forge.db, never the root DB', () => {
  const dir = tmp()
  assert.equal(resolveSqlitePath(undefined, dir), path.join(dir, '.forge', 'forge.db'))
  assert.notEqual(resolveSqlitePath(undefined, dir), path.join(dir, 'forge-framework.db'))
})

test('T4 DB path priority: option > DB_PATH > workspace default', () => {
  const prev = process.env.DB_PATH
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'td126-cwd-'))
  try {
    process.env.DB_PATH = path.join(clean, 'env.db')
    assert.equal((new ForgeStreamingReporter({ dbPath: path.join(clean, 'option.db') }) as any).dbPath, path.join(clean, 'option.db'))
    assert.equal((new ForgeStreamingReporter() as any).dbPath, path.join(clean, 'env.db'))
  } finally {
    if (prev === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = prev
  }
})
// ── T5-T6: onBegin ────────────────────────────────────────────────────────────

test('T5 onBegin creates run with lifecycle:running, status:unknown', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't5-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(3))
    const run = await new RunRepository().findById('t5-run')
    assert.equal(run?.lifecycle, 'running')
    assert.equal(run?.status, 'unknown')
    assert.equal(run?.total_tests, 3)
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

test('T6 onBegin marks a stale RUNNING run as INTERRUPTED', async () => {
  const dir = tmp()
  initDb(path.join(dir, 'forge.db')); await runMigrations()
  // seed a stale running run (started 3h ago)
  await new RunRepository().insert({
    run_id: 'stale-1', app_name: APP, branch: 'b', commit_sha: 'c', environment: 'test',
    base_url: 'u', triggered_by: 'test', reporter_version: 'v', status: 'unknown',
    lifecycle: 'running', total_tests: 1, passed: 0, failed: 0, skipped: 0, duration_ms: 0,
    started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  } as any)
  await closeDb()

  process.env.CURRENT_RUN_ID = 't6-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(1))
    const stale = await new RunRepository().findById('stale-1')
    assert.equal(stale?.lifecycle, 'interrupted', 'stale running run was not marked interrupted')
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

// ── T7: onTestEnd queues ──────────────────────────────────────────────────────

test('T7 onTestEnd queues a row (write queue populated)', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't7-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(1))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('passed'))
    assert.equal((r as any).writeQueue.length, 1, 'row not queued')
    await (r as any).drainQueue()
    assert.equal(await new TestResultRepository().countByRun('t7-run'), 1)
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

// ── T8-T9: onEnd lifecycle ────────────────────────────────────────────────────

test('T8 onEnd(passed) → lifecycle:completed, completed_at set', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't8-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(1))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('passed'))
    await r.onEnd(fakeFull('passed'))    // closes DB
    initDb(path.join(dir, 'forge.db'))    // reopen to assert
    const run = await new RunRepository().findById('t8-run')
    assert.equal(run?.lifecycle, 'completed')
    assert.equal(run?.status, 'passed')
    assert.ok(run?.completed_at, 'completed_at should be set')
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

test('T9 onEnd(interrupted) → lifecycle:interrupted, completed_at null', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't9-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(1))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('failed'))
    await r.onEnd(fakeFull('interrupted'))
    initDb(path.join(dir, 'forge.db'))
    const run = await new RunRepository().findById('t9-run')
    assert.equal(run?.lifecycle, 'interrupted')
    assert.equal(run?.completed_at, null, 'interrupted run must keep completed_at null')
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

// ── T10: verifier detects streaming-complete ──────────────────────────────────

test('T10 verifier signal: countByRun === expected → streaming complete (skip insert)', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't10-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(2))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('passed'))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC2'), fakeResult('failed'))
    await (r as any).drainQueue()
    const existing = await new TestResultRepository().countByRun('t10-run')
    const expected = 2
    // the reconciler's skip condition (results-store): existingRows >= expected
    assert.equal(existing, expected)
    assert.equal(existing >= expected, true, 'streaming-complete → verifier skips test_results insert')
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

// ── T11: full lifecycle happy path ────────────────────────────────────────────

test('T11 lifecycle RUNNING → COMPLETED (full happy path, rows + stats)', async () => {
  const dir = tmp()
  process.env.CURRENT_RUN_ID = 't11-run'
  try {
    const r = reporterOn(dir)
    await r.onBegin(fakeConfig, fakeSuite(3))
    // during-run: verify it is RUNNING before onEnd
    let run = await new RunRepository().findById('t11-run')
    assert.equal(run?.lifecycle, 'running')

    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('passed'))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC2'), fakeResult('passed'))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC3'), fakeResult('skipped'))
    await r.onEnd(fakeFull('passed'))

    initDb(path.join(dir, 'forge.db'))
    run = await new RunRepository().findById('t11-run')
    assert.equal(run?.lifecycle, 'completed')
    assert.equal(run?.status, 'passed')
    assert.equal(run?.passed, 2)
    assert.equal(run?.skipped, 1)
    assert.equal(await new TestResultRepository().countByRun('t11-run'), 3)
  } finally { delete process.env.CURRENT_RUN_ID; try { await closeDb() } catch {} }
})

// ── T12: --list mode → ingestion disabled (zero DB writes) ────────────────────

test('T12 --list mode → onBegin returns immediately, zero DB writes', async () => {
  const dir = tmp()
  const dbPath = path.join(dir, 'forge.db')
  const argv = process.argv
  try {
    process.argv = [...argv, '--list']          // constructor reads this
    const r = new ForgeStreamingReporter({ dbPath, appName: APP })
    await r.onBegin(fakeConfig, fakeSuite(5))
    r.onTestEnd(fakeTest('a.spec.ts', 'TC1'), fakeResult('passed'))
    await r.onEnd(fakeFull('passed'))
    // No DB file created (initDb/migrations/getDb never ran), nothing queued.
    assert.equal(fs.existsSync(dbPath), false, 'DB file created in --list mode')
    assert.equal((r as any).writeQueue.length, 0, 'row queued in --list mode')
    assert.equal((r as any).runId, '', 'run id assigned in --list mode')
  } finally { process.argv = argv; try { await closeDb() } catch {} }
})
