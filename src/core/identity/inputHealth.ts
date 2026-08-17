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
  | 'missing-run-start'
  | 'run-id-mismatch'
  | 'partial-results'
  | 'invalid-schema'
  | 'no-run'
  | 'stale-artifact'
  | null;

// Minimal shape of the fields read from Playwright's stats block. The runtime
// guard below requires every field used for health classification. `total` is
// intentionally not modeled because real Playwright JSON does not provide it.
export interface AssessableStats {
  startTime?: string;
  duration?:   number;
  expected?:  number;
  unexpected?: number;
  flaky?:     number;
  skipped?:   number;
}

interface CurrentRunProvenance {
  provenanceVersion: 2;
  runId: string;
  runStartedAt: string;
  provenanceWrittenAt: string;
}

// V2 timestamps are canonical UTC ISO-8601 with exactly millisecond precision.
// Exact precision lets ordering remain strict without a clock-truncation grace.
const CANONICAL_UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

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

  const counts = [stats.expected, stats.unexpected, stats.flaky, stats.skipped];
  const statsStartMs = parseCanonicalUtcTimestamp(stats.startTime);
  if (
    statsStartMs === null
    || !isSafeDuration(stats.duration)
    || counts.some(count => !Number.isSafeInteger(count) || (count ?? -1) < 0)
    || !Array.isArray(errors)
  ) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  // 2. Provenance sidecar — the only signal that ties this file to a run.
  if (!fs.existsSync(PROVENANCE_PATH)) {
    return { health: 'unknown', reason: 'missing-provenance' };
  }

  let parsedProvenance: unknown;
  try {
    parsedProvenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf-8'));
  } catch {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  if (!isRecord(parsedProvenance) || typeof parsedProvenance.runId !== 'string') {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  if (parsedProvenance.runId !== currentRunId) {
    // A complete, valid results file — but from a different run. This is the
    // TD-059 case (stale artifact presented as current).
    return { health: 'stale', reason: 'stale-artifact' };
  }

  // Version-1 provenance carried one ambiguous post-test `timestamp`. It cannot
  // truthfully be reinterpreted as run start, so current CI fails it closed while
  // historical artifacts remain readable as legacy JSON.
  if (parsedProvenance.provenanceVersion !== 2) {
    return { health: 'unknown', reason: 'missing-run-start' };
  }

  if (!isCurrentRunProvenance(parsedProvenance)) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  const runStartedMs = parseCanonicalUtcTimestamp(parsedProvenance.runStartedAt);
  const provenanceWrittenMs = parseCanonicalUtcTimestamp(parsedProvenance.provenanceWrittenAt);
  if (runStartedMs === null || provenanceWrittenMs === null) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  // Identity is primary. Timestamps prove only coherent ordering: the canonical
  // run starts before Playwright, and the sidecar is written after the duration
  // Playwright says it completed. There is deliberately no maximum duration.
  if (statsStartMs < runStartedMs) {
    return { health: 'stale', reason: 'stale-artifact' };
  }
  if (provenanceWrittenMs < runStartedMs) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }
  const reportedCompletionMs = statsStartMs + (stats.duration ?? 0);
  if (
    !Number.isFinite(reportedCompletionMs)
    || Math.abs(reportedCompletionMs) > MAX_DATE_MILLISECONDS
    || !Number.isSafeInteger(Math.trunc(reportedCompletionMs))
  ) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }
  if (provenanceWrittenMs < reportedCompletionMs) {
    return { health: 'degraded', reason: 'partial-results' };
  }

  // 3. The run is provenance-verified as current — is it a real, complete run?
  //    Count from the four outcome fields; stats.total does NOT exist in real
  //    Playwright JSON and must never be used here.
  const ran = safeCountSum([stats.expected ?? 0, stats.unexpected ?? 0, stats.flaky ?? 0]);
  const sum = safeCountSum(counts);
  if (ran === null || sum === null) {
    return { health: 'invalid', reason: 'invalid-schema' };
  }

  if (sum === 0) {
    // Nothing executed. errors[] populated -> config/globalSetup failure;
    // empty -> no test files matched. Both are "no run happened" for our purpose.
    return { health: 'invalid', reason: 'no-run' };
  }

  // Top-level Playwright errors describe runner/configuration failures outside
  // ordinary final test outcomes. Even if some tests ran, that evidence is not a
  // coherent complete execution.
  if (errors.length > 0) {
    return { health: 'degraded', reason: 'partial-results' };
  }

  if ((stats.skipped ?? 0) > 0 && ran === 0) {
    // Every test was intentionally skipped — a valid run, just nothing to judge.
    return { health: 'healthy', reason: null };
  }

  // 4. Provenance-verified, current, and real tests executed.
  return { health: 'healthy', reason: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCanonicalUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = CANONICAL_UTC_TIMESTAMP.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
  const fields = [yearText, monthText, dayText, hourText, minuteText, secondText]
    .map(field => Number(field));
  const [year, month, day, hour, minute, second] = fields;
  const millisecond = Number(millisecondText);

  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(hour, minute, second, millisecond);
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
    || candidate.getUTCHours() !== hour
    || candidate.getUTCMinutes() !== minute
    || candidate.getUTCSeconds() !== second
    || candidate.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return candidate.getTime();
}

function isSafeDuration(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER
    && Number.isSafeInteger(Math.trunc(value));
}

function safeCountSum(values: Array<number | undefined>): number | null {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || (value ?? -1) < 0) return null;
    if ((value ?? 0) > Number.MAX_SAFE_INTEGER - sum) return null;
    sum += value ?? 0;
  }
  return sum;
}

function isCurrentRunProvenance(
  value: Record<string, unknown>,
): value is Record<string, unknown> & CurrentRunProvenance {
  return value.provenanceVersion === 2
    && typeof value.runId === 'string'
    && typeof value.runStartedAt === 'string'
    && typeof value.provenanceWrittenAt === 'string';
}
