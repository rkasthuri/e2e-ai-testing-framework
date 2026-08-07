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
 * TD-120 — per-test row extraction from Playwright's JSON report.
 *
 * Extracted from results-store.ts for testability: that file auto-runs main()
 * at module load (and exits without a results file), so its internals can't be
 * imported by unit tests. results-store's walkSuite delegates here — one
 * source of truth for the vocabulary map and the row shape.
 *
 * Structural types only — callers pass Playwright's parsed JSON shapes.
 */
import { NewTestResult } from '../storage/types'
import { makeResultKey } from '../identity/resultKey'
import { Annotation, hasCouldNotVerify } from '../healing/couldNotVerify'

/** ADR-018 red-side — test-outcome vocabulary, now including could-not-verify. */
export type GradedStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'could-not-verify'

/**
 * Playwright's JSON reporter uses EXPECTATION vocabulary on spec.tests[].status
 * ('expected'/'unexpected'), not result vocabulary. test_results stores the
 * normalized form every consumer filters on (status === 'failed' etc.).
 * Verified against a real reports/test-results.json (TD-120 Step-0 finding E).
 *
 * ADR-018 RED-SIDE: the default and the interruption vocab now map to
 * could-not-verify, NOT failed. An unrecognized status is "I don't recognize
 * this" (could-not-verify), and a timed-out / interrupted execution stopped
 * before evidence was established — neither is a DEMONSTRATED failure. This
 * REVERSES the old `default: 'failed'` phantom-red while still never letting an
 * unknown silently read as "passed".
 */
export function normalizeStatus(s: string): GradedStatus {
  switch (s) {
    case 'expected':    return 'passed'
    case 'unexpected':  return 'failed'
    case 'flaky':       return 'flaky'
    case 'skipped':     return 'skipped'
    case 'timedOut':    return 'could-not-verify'  // execution stopped before evidence established
    case 'interrupted': return 'could-not-verify'  // ditto — NOT a demonstrated failure
    default:            return 'could-not-verify'  // unknown vocab: could-not-verify, never silently
                                                    // "passed" and never falsely "failed"
  }
}

/**
 * ADR-018 RED-SIDE — the single re-grade rule, shared by BOTH ingestion readers
 * (streaming reporter + batch extractor) so the law lives in one place.
 *
 * PRECEDENCE (the lattice, failed > could-not-verify > passed): a genuine failure
 * with NO could-not-verify annotation stays 'failed' (failed dominates). The
 * annotation re-grades two cases to could-not-verify:
 *   - a heal-caused FAILURE (the healer could not confidently resolve), and
 *   - a TD-140 vacuous-refusal SKIP (the generator emitted `test.skip` because every step
 *     was honestly omitted — zero executable statements). Only an ANNOTATED skip re-grades;
 *     an ordinary developer skip has no forge annotation and stays 'skipped'.
 * passed / flaky are never touched.
 */
export function regradeStatus(base: GradedStatus, annotations: Annotation[] | undefined): GradedStatus {
  if ((base === 'failed' || base === 'skipped') && hasCouldNotVerify(annotations)) return 'could-not-verify'
  return base
}

/**
 * ADR-018 RED-SIDE — the RUN-level lattice: reduce a run's constituents to one
 * honest outcome. Shared by both run-outcome writers (results-store authoritative
 * / streaming reporter partial), so the weakest-truth precedence is defined once.
 *
 *   failed (a real test failed) > could-not-verify > passed
 *
 * A run is could-not-verify ('unknown' on runs.status) when it produced any
 * could-not-verify test, ran zero real tests, was interrupted/timed-out, or (only
 * where the caller can assess it) consumed unhealthy input. Callers pass only the
 * signals they honestly have: the streaming reporter cannot assess input_health
 * (passes `unhealthy: false`); results-store, the authoritative last writer, can.
 */
export function deriveRunOutcome(args: {
  realFailed:    number   // tests that genuinely FAILED (could-not-verify already excluded)
  realExecuted:  number   // passed + realFailed + flaky (the "zero real tests" basis)
  couldNotVerify: number  // count of could-not-verify tests in the run
  unhealthy:     boolean  // input_health !== 'healthy' (reporter cannot assess → false)
  interrupted:   boolean  // lifecycle interrupted / timed-out
}): 'passed' | 'failed' | 'unknown' {
  if (args.realFailed > 0) return 'failed'                      // failed dominates
  if (args.unhealthy || args.interrupted || args.realExecuted === 0 || args.couldNotVerify > 0) {
    return 'unknown'                                            // could-not-verify (routed to existing 'unknown')
  }
  return 'passed'
}

// Minimal structural slices of Playwright's JSON report.
export interface ExtractableResult {
  status: string
  duration: number
  error?: { message: string }
  startTime?: string
  workerIndex?: number
}
export interface ExtractableTest {
  projectName: string
  status: string
  results: ExtractableResult[]
  // ADR-018 red-side: Playwright's JSONReportTest carries annotations
  // ({type, description?}[]); a forge:could-not-verify annotation re-grades an
  // otherwise-failed test to could-not-verify (failed still dominates).
  annotations?: Annotation[]
}
export interface ExtractableSpec {
  title: string
  file: string
  tests: ExtractableTest[]
}
export interface ExtractableSuite {
  title: string
  suites?: ExtractableSuite[]
  specs?: ExtractableSpec[]
}

/**
 * One test_results row per test per browser/project, for EVERY status —
 * passed, failed, flaky, AND skipped (skipped rows are stored; the analysis
 * layer excludes them from denominators — Nova Q2). Before TD-120 only flaky
 * tests were captured, which is why test_results stayed empty forever.
 */
export function extractTestResults(suites: ExtractableSuite[], runId: string): NewTestResult[] {
  const rows: NewTestResult[] = []
  function walk(suite: ExtractableSuite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        rows.push({
          run_id:        runId,
          test_id:       makeResultKey(spec.file, spec.title, test.projectName),
          title:         spec.title,
          suite:         suite.title ?? '',
          // ADR-018 red-side: re-grade a heal-caused failure to could-not-verify
          // (failed without the annotation stays failed — failed dominates).
          status:        regradeStatus(normalizeStatus(test.status), test.annotations),
          duration_ms:   Math.round(test.results.reduce((sum, r) => sum + (r.duration ?? 0), 0)),
          retry_count:   Math.max(0, test.results.length - 1),
          browser:       test.projectName ?? 'unknown',
          started_at:    test.results[0]?.startTime ?? new Date().toISOString(),
          worker_index:  test.results[0]?.workerIndex ?? 0,
          tier:          'ui',
          tags:          '[]',
          flaky_history: 0,
          metadata:      '{}',
          error_msg:     test.results.find(r => r.error)?.error?.message ?? null,
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  suites.forEach(walk)
  return rows
}
