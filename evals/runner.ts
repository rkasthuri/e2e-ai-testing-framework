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
 * TD-085 — eval runner: turns the flat EvalRecord[] a harness produces into
 * per-capability aggregate metrics (CapabilityMetrics) and a whole-run summary
 * (EvalRunSummary). Pure computation — no I/O.
 */
import { EvalRecord, CapabilityMetrics, EvalRunSummary, CANONICAL_METRICS } from './contract';

/** Timestamp run id, same shape as CURRENT_RUN_ID (run.ts) — e.g. 2026-07-04T15-43-13. */
export function generateRunId(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/** Aggregate all records for one capability into its CapabilityMetrics. */
export function computeCapabilityMetrics(
  records: EvalRecord[],
  capability: EvalRecord['capability'],
): CapabilityMetrics {
  const relevant = records.filter(r => r.capability === capability);
  if (relevant.length === 0) {
    return {
      capability,
      canonicalMetric: CANONICAL_METRICS[capability],
      score: 0,
      passRate: 0,
      totalRecords: 0,
      timestamp: new Date().toISOString(),
    };
  }
  const passed = relevant.filter(r => r.pass).length;
  const passRate = passed / relevant.length;
  const score = relevant.reduce((sum, r) => sum + r.metrics.primaryScore, 0) / relevant.length;
  return {
    capability,
    canonicalMetric: CANONICAL_METRICS[capability],
    score,
    passRate,
    totalRecords: relevant.length,
    timestamp: new Date().toISOString(),
  };
}

/** Compute one CapabilityMetrics per distinct capability present, plus run totals. */
export function runEval(records: EvalRecord[]): EvalRunSummary {
  const present = [...new Set(records.map(r => r.capability))];
  const capabilities = present.map(cap => computeCapabilityMetrics(records, cap));
  const totalPass = records.filter(r => r.pass).length;
  return {
    runId: generateRunId(),
    capabilities,
    totalPass,
    totalFail: records.length - totalPass,
    generatedAt: new Date().toISOString(),
  };
}
