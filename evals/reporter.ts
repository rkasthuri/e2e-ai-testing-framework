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
 * TD-085 — eval reporter: human-readable output + persistence for an
 * EvalRunSummary. `saveReport` writes the JSON that future runs compare against
 * for regression tracking.
 */
import * as fs from 'fs';
import { EvalRunSummary, EvalRecord } from './contract';

/** Print an aligned scorecard table (one row per capability) + run totals. */
export function printSummary(summary: EvalRunSummary): void {
  const rows = summary.capabilities;
  const wCap = Math.max(11, ...rows.map(r => r.capability.length));
  const wMet = Math.max(20, ...rows.map(r => r.canonicalMetric.length));

  console.log(`\nEval Run ${summary.runId}  (${summary.generatedAt})`);
  console.log(`| ${'Capability'.padEnd(wCap)} | ${'Metric'.padEnd(wMet)} | Score | Pass Rate | Records |`);
  console.log(`|${'-'.repeat(wCap + 2)}|${'-'.repeat(wMet + 2)}|-------|-----------|---------|`);
  for (const r of rows) {
    console.log(
      `| ${r.capability.padEnd(wCap)} | ${r.canonicalMetric.padEnd(wMet)} | ` +
      `${r.score.toFixed(2).padEnd(5)} | ${`${Math.round(r.passRate * 100)}%`.padEnd(9)} | ` +
      `${String(r.totalRecords).padEnd(7)} |`,
    );
  }
  console.log(`\nTotal: ${summary.totalPass} pass / ${summary.totalFail} fail`);
}

/** Print the failing records (pass === false) for debugging an eval run. */
export function printFailures(records: EvalRecord[]): void {
  const failures = records.filter(r => !r.pass);
  if (failures.length === 0) {
    console.log('No failures.');
    return;
  }
  console.log(`\n${failures.length} failure(s):`);
  for (const r of failures) {
    console.log(`  [${r.capability}] ${r.id}`);
    console.log(`    expected: ${JSON.stringify(r.expected)}`);
    console.log(`    actual:   ${JSON.stringify(r.actual)}`);
    if (r.notes) console.log(`    notes:    ${r.notes}`);
  }
}

/** Persist the run summary as JSON (for regression comparison across runs). */
export function saveReport(summary: EvalRunSummary, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf-8');
}
