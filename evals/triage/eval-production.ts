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
 * evals/triage/eval-production.ts
 *
 * Commit-2 VERIFICATION (Nova's gate before consumers): re-runs the 39-failure eval
 * using the REAL production classifier from src/pipeline/ai-triage.ts — not the
 * experiment copy — and scores it against ground truth.
 *
 * TD-085: also emits the shared EvalRecord[] contract (evals/contract.ts) so the
 * cross-capability runner/reporter score this the same way as every other harness.
 * The domain-specific PASS/FAIL block (false-app-bug + correct thresholds) is kept
 * BELOW the shared summary — it is triage-specific criteria beyond the shared score.
 *
 * Run from repo root:  npx tsx evals/triage/eval-production.ts
 *
 * Production change required to import the classifier: ai-triage.ts now `export`s
 * triageWithClaude, and its top-level main() is guarded with `require.main === module`
 * so importing the module does not auto-run a full triage. Both additive / behavior-
 * preserving; no classification logic changed.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { triageWithClaude } from '../../src/pipeline/ai-triage';
import { makeResultKey } from '../../src/core/identity/resultKey';
import { EvalRecord, EvalMetrics } from '../contract';
import { runEval } from '../runner';
import { printSummary, printFailures, saveReport } from '../reporter';

const REPO = path.resolve(__dirname, '../..');
const EVAL_JSON = path.join(REPO, 'reports', 'eval-39-failures.json');
const GROUND_TRUTH = path.join(__dirname, 'ground-truth.csv');

const PASS_CORRECT_MIN = 80;
const PASS_FALSE_APPBUG_MAX = 5;

type Priority = 'P0' | 'P1' | 'P2' | 'Unknown';

// Mirrors production's FailedTest shape so objects are assignable to triageWithClaude.
interface FailedTestLike {
  suiteName: string; priority: Priority; testTitle: string;
  errorMessage: string; errorStack: string; duration: number; retries: number;
  isTaggedFlaky: boolean; isTaggedSlow: boolean; browserName: string; file: string;
}

function detectPriority(s: string): Priority {
  if (s.includes('P0')) return 'P0';
  if (s.includes('P1')) return 'P1';
  if (s.includes('P2')) return 'P2';
  return 'Unknown';
}

// Replicates production's extractFailedTests walk (suite -> spec -> tests).
function extractFailedTests(report: any): FailedTestLike[] {
  const failed: FailedTestLike[] = [];
  function walk(suite: any, suitePath: string[] = []): void {
    const current = suite.title ? [...suitePath, suite.title] : suitePath;
    for (const spec of (suite.specs || [])) {
      if (spec.ok) continue;
      const suiteStr = current.join(' > ');
      const priority = detectPriority(suiteStr);
      const titleLower = (spec.title ?? '').toLowerCase();
      const isTaggedFlaky = titleLower.includes('@flaky') || titleLower.includes('flaky');
      const isTaggedSlow = titleLower.includes('@slow') || titleLower.includes('slow');
      for (const test of (spec.tests || [])) {
        const lastResult = test.results?.[test.results.length - 1];
        if (!lastResult) continue;
        if (lastResult.status === 'expected' || lastResult.status === 'skipped') continue;
        failed.push({
          suiteName: suiteStr || 'Root', priority, testTitle: spec.title,
          errorMessage: lastResult.error?.message ?? 'No error captured',
          errorStack: lastResult.error?.stack ?? '',
          duration: lastResult.duration ?? 0,
          retries: (test.results?.length ?? 1) - 1,
          isTaggedFlaky, isTaggedSlow,
          browserName: test.projectName ?? 'unknown', file: spec.file,
        });
      }
    }
    for (const child of (suite.suites || [])) walk(child, current);
  }
  for (const suite of (report.suites || [])) walk(suite);
  return failed;
}

function parseCsvRow(line: string): { id: string; label: string } {
  if (line.startsWith('"')) {
    const end = line.indexOf('"', 1);
    return { id: line.slice(1, end), label: line.slice(end + 1).replace(/^,/, '').trim() };
  }
  const idx = line.lastIndexOf(',');
  return { id: line.slice(0, idx).trim(), label: line.slice(idx + 1).trim() };
}

// Ground-truth schema (TD-080): file,"title",label — keyed by file::title so the
// join disambiguates cross-app id collisions. The leading file column is unquoted
// (paths carry no commas); the title is quoted (may contain commas); label last.
function loadGroundTruth(csvPath: string): Map<string, string> {
  const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(l => l.trim().length);
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const firstComma = lines[i].indexOf(',');
    const file = lines[i].slice(0, firstComma).trim();
    const { id: title, label } = parseCsvRow(lines[i].slice(firstComma + 1));
    if (title) map.set(makeResultKey(file, title), label);
  }
  return map;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  // Dummy run id so any run-id guard downstream passes (triageWithClaude itself does
  // not require it, but we set it per the verification spec).
  process.env.CURRENT_RUN_ID = 'eval-' + Date.now();

  if (!fs.existsSync(EVAL_JSON)) { console.error(`Missing input: ${EVAL_JSON}`); process.exit(1); }
  if (!fs.existsSync(GROUND_TRUTH)) { console.error(`Missing ground-truth.csv at ${GROUND_TRUTH}`); process.exit(1); }

  const report = JSON.parse(fs.readFileSync(EVAL_JSON, 'utf-8'));
  const failures = extractFailedTests(report);
  const truth = loadGroundTruth(GROUND_TRUTH);
  console.log(`Extracted ${failures.length} failures; loaded ${truth.size} ground-truth rows.\n`);
  console.log('Classifying with PRODUCTION triageWithClaude (one Claude call per failure, concurrency 5)...');

  const preds = await mapLimit(failures, 5, async (f, i) => {
    const r = await triageWithClaude(f);
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${failures.length}] ${r.verdict}\n`);
    return r;
  });

  // Score (categories are the production verdict strings == ground-truth labels).
  const ALL = ['app-bug', 'test-defect', 'infra-defect', 'flaky', 'insufficient-evidence'];
  interface Row { testId: string; file: string; key: string; truth: string; pred: string; correct: boolean; evidence: string; inTruth: boolean; }
  const rows: Row[] = failures.map((f, i) => {
    const key = makeResultKey(f.file, f.testTitle);
    const t = truth.get(key);
    return {
      testId: f.testTitle, file: f.file, key, truth: t ?? '(MISSING)', pred: preds[i].verdict,
      correct: t === preds[i].verdict, evidence: preds[i].evidence ?? '', inTruth: t !== undefined,
    };
  });

  const scored = rows.filter(r => r.inTruth);
  const missing = rows.filter(r => !r.inTruth);
  const total = scored.length;
  const correct = scored.filter(r => r.correct).length;
  const correctPct = total ? (correct / total) * 100 : 0;
  const falseAppBug = scored.filter(r => r.pred === 'app-bug' && r.truth !== 'app-bug').length;
  const falseAppBugPct = total ? (falseAppBug / total) * 100 : 0;

  console.log('\n' + '='.repeat(72));
  console.log('TD-063 COMMIT-2 VERIFICATION — PRODUCTION TRIAGE vs 39');
  console.log('='.repeat(72));
  console.log(`Total evaluated:        ${total}${missing.length ? ` (+${missing.length} not in ground truth, excluded)` : ''}`);
  console.log(`Correct:                ${correct}/${total}  (${correctPct.toFixed(1)}%)`);
  console.log(`False app-bug:          ${falseAppBug}/${total}  (${falseAppBugPct.toFixed(1)}%)  [predicted app-bug where truth != app-bug]`);

  console.log('\nConfusion (truth -> predicted counts):');
  for (const tl of [...new Set(scored.map(r => r.truth))].sort()) {
    const subset = scored.filter(r => r.truth === tl);
    const breakdown = ALL.map(c => ({ c, n: subset.filter(r => r.pred === c).length }))
      .filter(x => x.n > 0).map(x => `${x.c}=${x.n}`).join(', ');
    console.log(`  ${pad(tl, 22)} (${subset.length}) -> ${breakdown}`);
  }

  console.log('\nPredicted totals:');
  for (const c of ALL) {
    const n = scored.filter(r => r.pred === c).length;
    if (n > 0) console.log(`  ${pad(c, 22)} ${n}`);
  }

  console.log('\nPer-failure:');
  console.log(`  ${pad('truth', 22)} ${pad('predicted', 22)}  OK  test_id | evidence`);
  for (const r of rows) {
    const mark = !r.inTruth ? '??' : (r.correct ? ' ✓' : ' ✗');
    const ev = (r.evidence || '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  ${pad(r.truth, 22)} ${pad(r.pred, 22)} ${mark}  ${r.testId.slice(0, 46)} | ${ev}`);
  }
  if (missing.length) console.log(`\nNOTE: ${missing.length} failure(s) had no ground-truth row (excluded).`);

  // ── TD-085 — emit the shared EvalRecord[] contract + cross-capability summary ──
  // Only scored rows (inTruth) become records, so the shared score/passRate match
  // the domain `correctPct`; MISSING rows have no expected label to score against.
  const records: EvalRecord[] = rows.filter(r => r.inTruth).map(r => {
    const metrics: EvalMetrics = {
      primaryScore: r.correct ? 1 : 0,
      falseAppBug: r.pred === 'app-bug' && r.truth !== 'app-bug' ? 1 : 0,
    };
    return {
      capability: 'triage' as const,
      id: r.key,
      input: { file: r.file, title: r.testId },
      expected: r.truth,
      actual: r.pred,
      pass: r.correct,
      metrics,
      timestamp: new Date().toISOString(),
      notes: r.evidence,
    };
  });
  const summary = runEval(records);
  printSummary(summary);
  printFailures(records);
  saveReport(summary, path.join(REPO, 'evals', 'triage', 'report.json'));

  const pass = falseAppBugPct < PASS_FALSE_APPBUG_MAX && correctPct > PASS_CORRECT_MIN;
  console.log('\n' + '='.repeat(72));
  console.log(`CRITERIA: false-app-bug < ${PASS_FALSE_APPBUG_MAX}%  AND  correct > ${PASS_CORRECT_MIN}%`);
  console.log(`  false-app-bug = ${falseAppBugPct.toFixed(1)}%  ${falseAppBugPct < PASS_FALSE_APPBUG_MAX ? 'OK' : 'FAIL'}`);
  console.log(`  correct       = ${correctPct.toFixed(1)}%  ${correctPct > PASS_CORRECT_MIN ? 'OK' : 'FAIL'}`);
  console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(72));
}

main().catch(e => { console.error(e); process.exit(1); });
