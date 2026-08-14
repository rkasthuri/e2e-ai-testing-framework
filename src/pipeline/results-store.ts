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
 * results-store.ts
 * ─────────────────────────────────────────────────────────────
 * Step 2 — Results Store
 * Personal AI-Augmented Testing Framework
 *
 * Reads:   reports/test-results.json   (Playwright output)
 *          reports/triage-report.json  (Step 1 RCA output)
 * Writes:  reports/run-history.json    (append-only store)
 *          DB: runs row + trend upsert (TrendRepository) — trends.json is
 *          gone (TD-117: it was a fossil frozen at totalRuns:1 since 2026-06-04)
 *
 * Run:     automatically chained after triage (see package.json)
 *          or manually: npx tsx src/results-store.ts
 * ─────────────────────────────────────────────────────────────
 */

import * as fs   from 'fs';
import * as path from 'path';
import { runMigrations, getDb, initLegacyRuntimeDatabase } from '../core/storage'
import { RunRepository }        from '../core/storage/repositories/RunRepository'
import { TestResultRepository } from '../core/storage/repositories/TestResultRepository'
import { TrendRepository }      from '../core/storage/repositories/TrendRepository'
import { NewTestResult }        from '../core/storage/types'
import { AnalysisPipeline }     from '../core/pipeline/AnalysisPipeline'
import { FlakyPredictorStage }  from '../core/pipeline/stages/FlakyPredictorStage'
import { extractTestResults, deriveRunOutcome } from '../core/pipeline/testResultExtraction'
import { AiUsageRepository }    from '../core/storage/repositories/AiUsageRepository'
import { assessInputHealth, InputHealth, InputHealthReason } from '../core/identity/inputHealth'
import { getAppName, getBaseUrl, getTriggeredBy, getEnvironment } from '../core/config/appConfig'
import { TriageCategory }       from '../core/triage/taxonomy'


// ── Types ────────────────────────────────────────────────────

type RCAVerdict = TriageCategory;

interface RunRecord {
  runId:      string;
  timestamp:  string;
  durationMs: number;
  stats: {
    total:    number;
    passed:   number;
    failed:   number;
    flaky:    number;
    skipped:  number;
    passRate: string;
  };
  failures:   FailureRecord[];
  flakyTests: FlakyRecord[];
  // TD-067 — freshness/self-health verdict for the results this run consumed.
  inputHealth:       InputHealth;
  inputHealthReason: InputHealthReason;
}

interface FailureRecord {
  testTitle:       string;
  suiteName:       string;
  file:            string;
  browser:         string;
  priority:        string;
  verdict:         RCAVerdict;
  confidence:      string;
  reasoning:       string;
  suggestedAction: string;
  errorMessage:    string;
}

interface FlakyRecord {
  testTitle:  string;
  file:       string;
  browser:    string;
  retries:    number;
  durationMs: number;
}

// TrendEntry/TrendStore removed (TD-117) — they modeled the fossil trends.json.
// The per-test tracking algorithm they backed (risk levels, consecutive-fail
// counting) lives in this file's git history; TD-120 tracks rebuilding it on
// the DB.

interface RunHistory {
  created:    string;
  runs:       RunRecord[];
}

// ── Playwright JSON types (only what we need) ─────────────────

interface PWResult {
  status:   string;
  duration: number;
  retry:    number;
  error?:   { message: string };
  // TD-120 (finding E): present in Playwright's real JSON output, previously
  // undeclared here — needed for test_results.started_at / worker_index.
  startTime?:   string;
  workerIndex?: number;
}

interface PWTest {
  projectName: string;
  results:     PWResult[];
  status:      string;
}

interface PWSpec {
  title: string;
  file:  string;
  ok:    boolean;
  tests: PWTest[];
}

interface PWSuite {
  title:   string;
  suites?: PWSuite[];
  specs?:  PWSpec[];
}

interface PWStats {
  startTime:  string;
  duration:   number;
  expected:   number;
  unexpected: number;
  flaky:      number;
  skipped:    number;
}

interface PWReport {
  stats:  PWStats;
  suites: PWSuite[];
  // TD-067 — Playwright's top-level errors (config/globalSetup failures land here).
  errors?: unknown[];
}

// ── Triage report types ───────────────────────────────────────

interface TriageResult {
  verdict:         RCAVerdict;
  confidence:      string;
  reasoning:       string;
  suggestedAction: string;
  test: {
    testTitle:    string;
    suiteName:    string;
    file:         string;
    browserName:  string;
    priority:     string;
    errorMessage: string;
  };
}

interface TriageReport {
  runTimestamp: string;
  results:      TriageResult[];
}

// ── Config ───────────────────────────────────────────────────

const PATHS = {
  testResults:  'reports/test-results.json',
  triageReport: 'reports/triage-report.json',
  runHistory:   'reports/run-history.json',
  // trends path removed (TD-117) — trends live in the DB via TrendRepository
};

// ── Entry point ───────────────────────────────────────────────

async function main() {
  // This pipeline is the legacy CLI/CI result writer. Establish that authority
  // explicitly so cwd or a Product workspace can never reclassify its writes.
  initLegacyRuntimeDatabase()
  await runMigrations()
  console.log('\n📦 Results Store — persisting run...\n');

  if (!fs.existsSync(PATHS.testResults)) {
    console.error(`❌ No test results at ${PATHS.testResults}. Run tests first.`);
    process.exit(1);
  }

  const pw: PWReport = JSON.parse(fs.readFileSync(PATHS.testResults, 'utf-8'));

  // Triage report is optional — store still works without it
  let triage: TriageReport | null = null;
  if (fs.existsSync(PATHS.triageReport)) {
    triage = JSON.parse(fs.readFileSync(PATHS.triageReport, 'utf-8'));
  } else {
    console.log('  ⚠️  No triage report found — storing results without RCA data.');
  }

  const { record, testResults } = await buildRunRecord(pw, triage);
  await appendToHistory(record, testResults);
  // updateTrends() removed (TD-117/TD-119): it read the fossil trends.json,
  // mutated it in memory, wrote nothing, and logged a count from the dead
  // structure. The REAL trend write is TrendRepository.computeAndUpsertForRun()
  // inside appendToHistory above.

  // TD-120: Evidence Analysis runs AFTER the persistence transaction commits —
  // stages read committed test_results; a stage failure costs insight, never
  // run data (AnalysisPipeline isolates per-stage failures internally).
  // minSample: this CI-pipeline tool has no workspace/AppConfig access, so the
  // configurable knob is the FLAKY_MIN_SAMPLE env var (results-store's native
  // config idiom — APP_NAME, CURRENT_RUN_ID, ...). Standalone-path callers
  // read AppConfig.analysis.minSample instead. Default: 10 (Nova Q3).
  const envMinSample = Number(process.env.FLAKY_MIN_SAMPLE);
  const minSample = Number.isFinite(envMinSample) && envMinSample > 0 ? envMinSample : 10;
  await new AnalysisPipeline()
    .addStage(new FlakyPredictorStage({ minSample }))
    .run({ runId: record.runId, appName: getAppName(), db: getDb() });

  printSummary(record);
}

// ── Build run record ──────────────────────────────────────────

// normalizeStatus + the per-test row builder live in
// src/core/pipeline/testResultExtraction.ts (TD-120) — extracted for
// testability: this file auto-runs main() at import, so tests can't reach in.

async function buildRunRecord(pw: PWReport, triage: TriageReport | null): Promise<{ record: RunRecord; testResults: NewTestResult[] }> {
  const { stats } = pw;

  // TD-070: consume the canonical run id established once at run-start
  // (src/run.ts locally; the CI Job-1 `run_id` job output otherwise). Never
  // re-derive a key here — minting a fresh id would recreate the split-brain
  // TD-070 exists to kill. Unset = setup failure, fail loudly (not a fallback).
  const runId = process.env.CURRENT_RUN_ID;
  if (!runId) {
    throw new Error(
      'results-store: CURRENT_RUN_ID is not set. The canonical run id must be ' +
      'established once at run-start and inherited — src/run.ts sets it before ' +
      'spawning stages; CI carries it via the Job-1 `run_id` job output. ' +
      'Refusing to mint a fresh id (TD-070).',
    );
  }
  // TS narrowing doesn't cross into the nested walkSuite() closure below —
  // capture the guard-narrowed value as a definite string.
  const canonicalRunId: string = runId;

  // TD-067 — assess whether these results are verifiably from the current run
  // before we persist a verdict about them (provenance sidecar + stats).
  const { health, reason } = await assessInputHealth(stats, pw.errors ?? [], runId);

  const total   = stats.expected + stats.unexpected + stats.flaky + stats.skipped;
  const passed  = stats.expected;
  const failed  = stats.unexpected;
  const flaky   = stats.flaky;
  const skipped = stats.skipped;
  const passRate = total > 0
    ? (((passed + flaky) / total) * 100).toFixed(1) + '%'
    : '0%';

  // Build failure records from triage (or empty if no triage)
  const failures: FailureRecord[] = (triage?.results ?? []).map(r => ({
    testTitle:       r.test.testTitle,
    suiteName:       r.test.suiteName,
    file:            r.test.file,
    browser:         r.test.browserName,
    priority:        r.test.priority,
    verdict:         r.verdict,
    confidence:      r.confidence,
    reasoning:       r.reasoning,
    suggestedAction: r.suggestedAction,
    errorMessage:    r.test.errorMessage.slice(0, 200),
  }));

  // Extract flaky tests (existing) + (TD-120) EVERY test's per-run row for
  // test_results via the shared extractor — before TD-120, passing tests were
  // walked and discarded, which is why test_results was never populated and
  // the flaky predictor had no denominator.
  const flakyTests: FlakyRecord[] = [];
  function walkSuite(suite: PWSuite) {
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          if (test.status === 'flaky') {
            flakyTests.push({
              testTitle:  spec.title,
              file:       spec.file,
              browser:    test.projectName,
              retries:    test.results.length - 1,
              durationMs: test.results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
            });
          }
        }
      }
    }
    if (suite.suites) suite.suites.forEach(walkSuite);
  }
  pw.suites.forEach(walkSuite);
  const testResults = extractTestResults(pw.suites, canonicalRunId);

  const record: RunRecord = {
    runId,
    timestamp:  stats.startTime,
    durationMs: Math.round(stats.duration),
    stats:      { total, passed, failed, flaky, skipped, passRate },
    failures,
    flakyTests,
    inputHealth:       health,
    inputHealthReason: reason,
  };
  return { record, testResults };
}

// ── Append to run history ─────────────────────────────────────

async function appendToHistory(record: RunRecord, testResults: NewTestResult[]) {
  let history: RunHistory;

  if (fs.existsSync(PATHS.runHistory)) {
    history = JSON.parse(fs.readFileSync(PATHS.runHistory, 'utf-8'));
  } else {
    history = { created: new Date().toISOString(), runs: [] };
  }

  // Avoid duplicate runs (same runId)
const force = process.argv.includes('--force');
const exists = history.runs.some(r => r.runId === record.runId);
if (exists && !force) {
  console.log(`  ℹ️  Run ${record.runId} already stored — skipping duplicate.`);
  return;
} else if (exists && force) {
  // Remove old entry and replace with fresh data
  history.runs = history.runs.filter((r: any) => r.runId !== record.runId);
  console.log(`  🔄 Force replacing run ${record.runId}`);
}

  history.runs.push(record);

  // Keep last 100 runs max
  if (history.runs.length > 100) {
    history.runs = history.runs.slice(-100);
  }

  // DB write (primary system-of-record) — TD-120: ONE Kysely transaction
  // (FORGE's first) wrapping all three writes atomically, in ruling-D order:
  // run → test_results batch → trend. The trend computation reads test_results
  // on the same handle, so it finally sees THIS run's per-test rows (the
  // pre-TD-120 flaky_count was always 0 because the table was empty).
  try {
    const db = getDb()
    const runRepo    = new RunRepository()
    const resultRepo = new TestResultRepository()
    const trendRepo  = new TrendRepository()

    // TD-126: verifier/reconciler. The streaming reporter may already have
    // created the run row and written test_results during execution. Detect
    // that (reads see committed streamed rows) and reconcile instead of
    // double-writing.
    const runExists    = !!(await runRepo.findById(record.runId))
    const existingRows = await resultRepo.countByRun(record.runId)
    const expected     = testResults.length
    // ── ADR-018 RED-SIDE (Writer 1 — AUTHORITATIVE full routing; Option A) ──────
    // results-store reconciles LAST (it overwrites the reporter's transient
    // outcome via updateStatus), so it owns the complete verdict: a real test
    // failure dominates; else could-not-verify ('unknown') when the input was
    // unhealthy, zero real tests ran, OR any test could-not-verify; else passed.
    // Heal-caused failures were re-graded to 'could-not-verify' in the testResults
    // rows (regradeStatus), so they are excluded from realFailed and never read as
    // a failed run — and, being present, they force the run to could-not-verify.
    const couldNotVerifyCount = testResults.filter(r => r.status === 'could-not-verify').length
    const realFailed = Math.max(0, record.stats.failed - couldNotVerifyCount)
    const outcome: 'passed' | 'failed' | 'unknown' = deriveRunOutcome({
      realFailed,
      realExecuted:  record.stats.passed + realFailed + record.stats.flaky,
      couldNotVerify: couldNotVerifyCount,
      unhealthy:     record.inputHealth !== 'healthy',  // stale|degraded|invalid|unknown → could-not-verify
      interrupted:   false,                              // results-store runs post-completion (lifecycle 'completed')
    })
    const completedAt  = new Date().toISOString()

    // Which test_results rows still need writing?
    let toInsert: NewTestResult[] = []
    if (existingRows === 0) {
      toInsert = testResults                               // no streaming → full batch
    } else if (existingRows < expected) {
      const present = new Set(
        (await resultRepo.findByRun(record.runId)).map(r => r.test_id),
      )
      toInsert = testResults.filter(r => !present.has(r.test_id))   // partial → gap-fill
      console.log(`  🔧 Partial streaming (${existingRows}/${expected}) — filling ${toInsert.length} gap row(s).`)
    } else {
      console.log(`  ✅ Streaming complete — ${existingRows} row(s) verified. Skipping test_results insert.`)
    }

    await db.transaction().execute(async (trx) => {
      if (runExists) {
        // Reporter (or a prior write) created the run — reconcile, don't re-insert.
        await runRepo.updateStats(record.runId, {
          total_tests: record.stats.total, passed: record.stats.passed,
          failed:      record.stats.failed, skipped: record.stats.skipped,
          duration_ms: record.durationMs,
        }, trx)
        await runRepo.updateStatus(record.runId, outcome, undefined, trx)         // outcome axis
        await runRepo.updateLifecycle(record.runId, 'completed', completedAt, trx) // lifecycle axis
        // ADR-018 red-side (the reconcile gap): the streaming reporter created this
        // row with input_health at the migration-009 default ('unknown') — it never
        // assesses input health. Land results-store's HONEST assessment now, so the
        // could-not-verify routing signal isn't lost on the reconciled row (R13).
        await runRepo.updateInputHealth(record.runId, record.inputHealth, record.inputHealthReason, trx)
      } else {
        await runRepo.insert({
          run_id:           record.runId,
          app_name:         getAppName(),
          branch:           process.env.GITHUB_REF_NAME || 'local',
          commit_sha:       process.env.GITHUB_SHA       || 'local',
          environment:      getEnvironment(),
          base_url:         getBaseUrl(),
          triggered_by:     getTriggeredBy(),
          reporter_version: '4.8.4',
          status:           outcome,
          lifecycle:        'completed',           // batch runs after completion
          total_tests:      record.stats.total,
          passed:           record.stats.passed,
          failed:           record.stats.failed,
          skipped:          record.stats.skipped,
          duration_ms:      record.durationMs,
          started_at:       record.timestamp,
          completed_at:     completedAt,
          // TD-067 — persist the input-health verdict onto the run row.
          input_health:        record.inputHealth,
          input_health_reason: record.inputHealthReason,
          metadata:         JSON.stringify({
            browser:     process.env.BROWSER || 'chromium',
            nodeVersion: process.version,
          }),
        }, trx)
      }

      if (toInsert.length > 0) await resultRepo.insertBatch(toInsert, trx)

      await trendRepo.computeAndUpsertForRun(getAppName(), record.runId, trx)
    })
    console.log(
      `  ✅ DB transaction committed: run ${runExists ? 'reconciled' : 'inserted'} + ` +
      `${toInsert.length} test result(s) written (${existingRows} pre-existing) + trend`,
    )
  } catch (dbErr: any) {
    if (dbErr?.message?.includes('UNIQUE constraint failed')) {
      // Pre-existing tolerated case (re-run of the same runId, e.g. --force on
      // the file store): the run row already exists — NOT a data-integrity
      // failure; the transaction rolled back leaving the earlier data intact.
      console.log(`  ℹ️  Run ${record.runId} already in DB — skipping DB insert.`)
    } else {
      // TD-120: any OTHER transaction failure is a data-integrity failure —
      // loud, non-silent, non-zero exit. (Pre-TD-120 this was a warn-and-
      // continue; that silence is exactly what let test_results stay empty
      // for the project's entire history.)
      console.error('[results-store] TRANSACTION FAILED — run history not persisted:', dbErr)
      process.exit(1)
    }
  }

  fs.writeFileSync(PATHS.runHistory, JSON.stringify(history, null, 2), 'utf-8');
  console.log(`  ✅ Run stored: ${record.runId} (${history.runs.length} total runs in history)`);
}

// ── Update trends ─────────────────────────────────────────────
// updateTrends()/newTrendEntry()/calcRisk() removed (TD-117/TD-119): the whole
// block read the fossil trends.json, mutated it in memory, never wrote it back
// (the write was removed earlier), and logged "Trends updated — N test(s)
// tracked" from that dead structure — a claim about DB state sourced from a
// file frozen at totalRuns:1. TrendRepository.computeAndUpsertForRun() in
// appendToHistory() is the single live trend write.

// ── Console summary ───────────────────────────────────────────

function printSummary(record: RunRecord) {
  const { stats } = record;
  console.log('\n──────────────────────────────────');
  console.log('  RESULTS STORED');
  console.log('──────────────────────────────────');
  console.log(`  Run ID:    ${record.runId}`);
  console.log(`  Total:     ${stats.total} tests`);
  console.log(`  ✅ Passed:  ${stats.passed}`);
  console.log(`  🟡 Flaky:   ${stats.flaky}`);
  console.log(`  ❌ Failed:  ${stats.failed}`);
  console.log(`  Pass rate: ${stats.passRate}`);
  console.log(`  Duration:  ${(record.durationMs / 1000).toFixed(1)}s`);
  console.log('──────────────────────────────────');
  console.log(`  📚 ${PATHS.runHistory}`);
  console.log('  📈 trends: DB (TrendRepository — per-app trend row upserted)');
  console.log('──────────────────────────────────\n');
}

main();
