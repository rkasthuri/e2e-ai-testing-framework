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
 * experiments/td-063-taxonomy/eval.ts
 *
 * ISOLATED TD-063 eval harness. Reads the 39 raw failures + a ground-truth CSV,
 * classifies each with the trial taxonomy prompt, and scores precision —
 * especially the false-app-bug rate (the TD-063 failure mode).
 *
 * Run from repo root:  npx tsx experiments/td-063-taxonomy/eval.ts
 *
 * Does NOT touch production code. Reads reports/eval-39-failures.json (a Playwright
 * report) and experiments/td-063-taxonomy/ground-truth.csv.
 */
import 'dotenv/config';   // load ANTHROPIC_API_KEY from .env (same mechanism the scripts use)
import * as fs from 'fs';
import * as path from 'path';
import { classifyFailure, ClassifyResult, TaxonomyCategory, CATEGORIES } from './taxonomy-prompt';
import { makeResultKey } from '../../src/core/identity/resultKey';

const REPO = path.resolve(__dirname, '../..');
const EVAL_JSON = path.join(REPO, 'reports', 'eval-39-failures.json');
const GROUND_TRUTH = path.join(__dirname, 'ground-truth.csv');

const PASS_CORRECT_MIN = 80;     // correct% must exceed this
const PASS_FALSE_APPBUG_MAX = 5; // false-app-bug% must be below this

interface Failure { title: string; file: string; errorMessage: string; }

// Remove ANSI escape sequences without embedding a literal ESC byte in source.
function stripAnsi(s: string): string {
  return s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
}

// A test result is identified by file::title (TD-080 — TC-GEN ids reset per app,
// so title alone is not unique across apps). Key extracted failures by that key.
function extractFailures(reportPath: string): Failure[] {
  const j = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const byKey = new Map<string, Failure>();
  function walk(s: any): void {
    for (const sp of (s.specs || [])) {
      const key = makeResultKey(sp.file, sp.title);
      for (const t of (sp.tests || [])) {
        const failed = (t.results || []).some((r: any) => r.status === 'failed' || r.status === 'timedOut')
          || t.status === 'unexpected';
        if (failed && !byKey.has(key)) {
          const err = (t.results || []).map((r: any) => r.error && r.error.message).find(Boolean) || '';
          byKey.set(key, { title: sp.title, file: sp.file, errorMessage: stripAnsi(String(err)) });
        }
      }
    }
    (s.suites || []).forEach(walk);
  }
  (j.suites || []).forEach(walk);
  return [...byKey.values()];
}

// Handles  "quoted id, may contain commas",label   and   plainId,label
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
  for (let i = 1; i < lines.length; i++) { // skip header
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
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  if (!fs.existsSync(EVAL_JSON)) { console.error(`Missing input: ${EVAL_JSON}`); process.exit(1); }
  if (!fs.existsSync(GROUND_TRUTH)) {
    console.error(`Missing ground-truth.csv at ${GROUND_TRUTH} — STOP (place it and re-run).`);
    process.exit(1);
  }

  const failures = extractFailures(EVAL_JSON);
  const truth = loadGroundTruth(GROUND_TRUTH);
  console.log(`Extracted ${failures.length} failures; loaded ${truth.size} ground-truth rows.\n`);
  console.log('Classifying (one Claude API call per failure, concurrency 5)...');

  const preds: ClassifyResult[] = await mapLimit(failures, 5, async (f, i) => {
    const r = await classifyFailure(f.title, f.errorMessage);
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${failures.length}] ${pad(r.category, 22)}${r.overridden ? ' (override)' : ''}\n`);
    return r;
  });

  interface Row { testId: string; truth: string; pred: TaxonomyCategory; correct: boolean; evidence: string; inTruth: boolean; }
  const rows: Row[] = failures.map((f, i) => {
    const t = truth.get(makeResultKey(f.file, f.title));
    return {
      testId: f.title, truth: t ?? '(MISSING)', pred: preds[i].category,
      correct: t === preds[i].category, evidence: preds[i].evidence, inTruth: t !== undefined,
    };
  });

  const scored = rows.filter(r => r.inTruth);
  const missing = rows.filter(r => !r.inTruth);
  const total = scored.length;
  const correct = scored.filter(r => r.correct).length;
  const correctPct = total ? (correct / total) * 100 : 0;
  const falseAppBug = scored.filter(r => r.pred === 'app-bug' && r.truth !== 'app-bug').length;
  const falseAppBugPct = total ? (falseAppBug / total) * 100 : 0;
  const overrides = preds.filter(p => p.overridden).length;

  console.log('\n' + '='.repeat(72));
  console.log('TD-063 TAXONOMY EVAL SCORECARD');
  console.log('='.repeat(72));
  console.log(`Total evaluated:        ${total}${missing.length ? ` (+${missing.length} not in ground truth, excluded)` : ''}`);
  console.log(`Correct:                ${correct}/${total}  (${correctPct.toFixed(1)}%)`);
  console.log(`False app-bug:          ${falseAppBug}/${total}  (${falseAppBugPct.toFixed(1)}%)  [predicted app-bug where truth != app-bug]`);
  console.log(`Code-invariant overrides (app-bug -> insufficient-evidence): ${overrides}`);

  // Confusion summary: per truth label -> predicted breakdown
  console.log('\nConfusion (truth -> predicted counts):');
  const truthLabels = [...new Set(scored.map(r => r.truth))].sort();
  for (const tl of truthLabels) {
    const subset = scored.filter(r => r.truth === tl);
    const breakdown = CATEGORIES
      .map(c => ({ c, n: subset.filter(r => r.pred === c).length }))
      .filter(x => x.n > 0)
      .map(x => `${x.c}=${x.n}`)
      .join(', ');
    console.log(`  ${pad(tl, 22)} (${subset.length}) -> ${breakdown}`);
  }

  // Predicted totals
  console.log('\nPredicted totals:');
  for (const c of CATEGORIES) {
    const n = scored.filter(r => r.pred === c).length;
    if (n > 0) console.log(`  ${pad(c, 22)} ${n}`);
  }

  // Per-failure list
  console.log('\nPer-failure:');
  console.log(`  ${pad('truth', 22)} ${pad('predicted', 22)}  OK  test_id | evidence`);
  for (const r of rows) {
    const mark = !r.inTruth ? '??' : (r.correct ? ' ✓' : ' ✗');
    const ev = (r.evidence || '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(`  ${pad(r.truth, 22)} ${pad(r.pred, 22)} ${mark}  ${r.testId.slice(0, 48)} | ${ev}`);
  }
  if (missing.length) {
    console.log(`\nNOTE: ${missing.length} failure(s) had no ground-truth row (excluded from scoring).`);
  }

  // Verdict
  const pass = falseAppBugPct < PASS_FALSE_APPBUG_MAX && correctPct > PASS_CORRECT_MIN;
  console.log('\n' + '='.repeat(72));
  console.log(`CRITERIA: false-app-bug < ${PASS_FALSE_APPBUG_MAX}%  AND  correct > ${PASS_CORRECT_MIN}%`);
  console.log(`  false-app-bug = ${falseAppBugPct.toFixed(1)}%  ${falseAppBugPct < PASS_FALSE_APPBUG_MAX ? 'OK' : 'FAIL'}`);
  console.log(`  correct       = ${correctPct.toFixed(1)}%  ${correctPct > PASS_CORRECT_MIN ? 'OK' : 'FAIL'}`);
  console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(72));
}

main().catch(e => { console.error(e); process.exit(1); });
