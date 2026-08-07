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
 * TD-067 — input-health assessment for the triage / results pipeline.
 *
 * The pipeline consumes whatever sits in `reports/test-results.json` and has
 * historically presented its verdicts as the CURRENT run's health with no check
 * that the input is fresh or the run actually executed. This helper computes an
 * honest verdict from the results + the CI provenance sidecar (`reports/
 * provenance.json`, written post-test by the `test` job — TD-067 Commit 2) so
 * callers can surface "stale / degraded / invalid / unverified" instead of
 * laundering old or broken input as current.
 *
 * Honesty principle (same as TD-066): no signal -> say so, never assume healthy.
 * A missing sidecar is 'unknown', NOT 'healthy' — absence of evidence is not
 * evidence of freshness.
 *
 * Shared by both pipeline stages that read the results independently:
 * `results-store.ts` (writes runs.input_health) and `ai-triage.ts` (markdown +
 * confidenceSource) — so the assessment can never drift between them.
 */
import * as fs from 'fs';
import * as path from 'path';

export type InputHealth = 'healthy' | 'stale' | 'degraded' | 'invalid' | 'unknown';

export type InputHealthReason =
  | 'missing-provenance'
  | 'run-id-mismatch'
  | 'partial-results'
  | 'invalid-schema'
  | 'no-run'
  | 'stale-artifact'
  | null;

// Minimal shape of the fields we read off Playwright's stats block. Deliberately
// permissive — callers pass their already-parsed stats object. `total` is
// intentionally NOT modeled: it does not exist in real Playwright JSON, so any
// count must be derived from the four outcome fields below.
export interface AssessableStats {
  startTime?: string;
  expected?:  number;
  unexpected?: number;
  flaky?:     number;
  skipped?:   number;
}

// Delta (minutes) between the provenance timestamp and the Playwright run-start
// beyond which we treat the pair as anomalous rather than a clean current run.
const MAX_START_DELTA_MINUTES = 15;

// FORGE_REPORTS_DIR overrides where the provenance sidecar is read from — used by
// tests to point at a throwaway dir (mirrors DB_PATH / HEAL_STORE_PATH in TD-066).
// Unset in production -> defaults to <cwd>/reports, unchanged behavior.
const PROVENANCE_PATH = path.resolve(
  process.env.FORGE_REPORTS_DIR || path.join(process.cwd(), 'reports'),
  'provenance.json',
);

/**
 * Assess whether the results the caller is about to act on are verifiably from
 * the current run. Precedence is EXACT — do not reorder.
 *
 * @param stats        the parsed Playwright stats, or null if JSON.parse failed upstream
 * @param errors       Playwright's top-level `errors[]` (config/globalSetup failures land here)
 * @param currentRunId the canonical run id for the run being processed (CURRENT_RUN_ID)
 */
export async function assessInputHealth(
  stats: AssessableStats | null,
  errors: unknown[],
  currentRunId: string,
): Promise<{ health: InputHealth; reason: InputHealthReason }> {
  // 1. Upstream parse failed -> the file is unusable.
  if (stats === null) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  // 2. Provenance sidecar — the only signal that ties this file to a run.
  let provenance: { runId?: string; timestamp?: string } | null = null;
  if (fs.existsSync(PROVENANCE_PATH)) {
    try {
      provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf-8'));
    } catch {
      provenance = null; // present but unparseable -> treat as missing
    }
  }

  if (!provenance) {
    // Absent (or unparseable) sidecar -> we cannot verify freshness. Honest
    // 'unknown', never 'healthy' (predates Commit 2 / local runs / lost artifact).
    return { health: 'unknown', reason: 'missing-provenance' };
  }

  if (provenance.runId !== currentRunId) {
    // A complete, valid results file — but from a different run. This is the
    // TD-059 case (stale artifact presented as current).
    return { health: 'stale', reason: 'stale-artifact' };
  }

  // runId matches — cross-check the timestamps if both are present. A large
  // delta means the sidecar and the results disagree about when the run started
  // (a timing anomaly), so we downgrade rather than trust the match blindly.
  if (provenance.timestamp && stats.startTime) {
    const provMs  = Date.parse(provenance.timestamp);
    const statsMs = Date.parse(stats.startTime);
    if (!Number.isNaN(provMs) && !Number.isNaN(statsMs)) {
      const deltaMinutes = Math.abs(provMs - statsMs) / 60000;
      if (deltaMinutes > MAX_START_DELTA_MINUTES) {
        return { health: 'degraded', reason: 'partial-results' };
      }
    }
  }

  // 3. The run is provenance-verified as current — is it a real, complete run?
  //    Count from the four outcome fields; stats.total does NOT exist in real
  //    Playwright JSON and must never be used here.
  const ran = (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.flaky ?? 0);
  const sum = ran + (stats.skipped ?? 0);

  if (sum === 0) {
    // Nothing executed. errors[] populated -> config/globalSetup failure;
    // empty -> no test files matched. Both are "no run happened" for our purpose.
    return { health: 'invalid', reason: 'no-run' };
  }

  if ((stats.skipped ?? 0) > 0 && ran === 0) {
    // Every test was intentionally skipped — a valid run, just nothing to judge.
    return { health: 'healthy', reason: null };
  }

  // 4. Provenance-verified, current, and real tests executed.
  return { health: 'healthy', reason: null };
}
