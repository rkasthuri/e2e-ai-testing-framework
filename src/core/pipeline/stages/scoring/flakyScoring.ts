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
 * TD-120 — pure, deterministic flaky scoring. No AI, no randomness, no I/O.
 *
 * calcRisk() is resurrected from git history (bc2fd90, the last commit where
 * the per-test trend algorithm was live) with its known flaw fixed: the
 * original `totalRuns` only incremented when a test appeared in a failure/
 * flaky record — a passing run never counted, so "totalRuns" meant "times
 * seen as a problem". Here the denominator is executedRuns = passed + failed
 * + flaky (skipped stored upstream but excluded — Nova Q2), computed from
 * real per-test test_results rows.
 *
 * Score formula (weights per the TD-120 brief, derived from bc2fd90's
 * scoreTest): failure-rate 0-40, consecutive 0-25, risk-level 0-15,
 * flaky-rate 0-10, acceleration 0-10. NOTE one documented drift from
 * bc2fd90: consecutive points are min(consecutiveFails*8, 25) — bc2fd90
 * stepped 1→8 / 2→15 / 3+→25; this yields 2→16 / 3→24 (±1pt).
 */

export interface TestExecutionSummary {
  executedRuns: number;     // passed + failed + flaky only (skipped excluded)
  failureCount: number;
  flakyCount: number;
  consecutiveFails: number;
}

export type RiskLevel = 'High' | 'Medium' | 'Low';

export type FlakyConfidence =
  | 'high' | 'medium' | 'low'
  | 'insufficient-evidence' | 'unknown';

export function calcRisk(s: TestExecutionSummary): RiskLevel {
  if (s.consecutiveFails >= 3) return 'High'
  if (s.consecutiveFails >= 2) return 'Medium'
  if (s.flakyCount >= 3) return 'Medium'
  if ((s.failureCount + s.flakyCount) >= 5) return 'Medium'
  return 'Low'
}

export interface FlakyScore {
  score: number;              // 0-100
  confidence: FlakyConfidence;
  trend: 'degrading' | 'improving' | 'stable';
  recommendation: string;
}

/**
 * @param history per-test test_results rows, MOST-RECENT-FIRST (the
 * TestResultRepository/stage query order). Only status/started_at are read.
 */
export function computeFlakyScore(
  summary: TestExecutionSummary,
  history: Array<{ status: string; started_at: string }>,
): FlakyScore {
  const failureRate = summary.executedRuns > 0
    ? summary.failureCount / summary.executedRuns : 0
  const flakyRate = summary.executedRuns > 0
    ? summary.flakyCount / summary.executedRuns : 0
  const riskLevel = calcRisk(summary)

  // Score components (see header for weight provenance).
  const failurePts     = Math.round(failureRate * 40)
  const consecutivePts = Math.min(summary.consecutiveFails * 8, 25)
  const riskPts        = riskLevel === 'High' ? 15 : riskLevel === 'Medium' ? 8 : 0
  const flakyPts       = Math.round(flakyRate * 10)

  // Acceleration: recent half (history is most-recent-first) vs older half.
  const half = Math.floor(history.length / 2)
  const isProblem = (r: { status: string }) => r.status === 'failed' || r.status === 'flaky'
  const recentFails = history.slice(0, half).filter(isProblem).length
  const olderFails  = history.slice(half).filter(isProblem).length
  const accelerating = half > 0 && recentFails > olderFails
  const accelPts = accelerating ? 10 : 0

  const score = Math.min(failurePts + consecutivePts + riskPts + flakyPts + accelPts, 100)

  // Trend vocabulary aligned with the EXISTING consumers, not invented:
  // FlakyAnalysisRepository.findDegrading() queries trend='degrading' and
  // core/types/flaky.ts declares 'improving'|'degrading'|'stable'.
  const trend: FlakyScore['trend'] = accelerating ? 'degrading'
    : recentFails < olderFails ? 'improving'
    : 'stable'

  // Evidential standing from sample size (below-minSample never reaches here —
  // the stage persists insufficient-evidence records without scoring).
  const confidence: FlakyConfidence =
    summary.executedRuns >= 20 ? 'high'
    : summary.executedRuns >= 10 ? 'medium'
    : 'low'

  const recommendation =
    riskLevel === 'High' ? 'Quarantine: consistently failing. Investigate immediately.'
    : score >= 60        ? 'Monitor closely: high flakiness score.'
    : score >= 30        ? 'Watch: moderate instability detected.'
    :                      'Stable: no action required.'

  return { score, confidence, trend, recommendation }
}
