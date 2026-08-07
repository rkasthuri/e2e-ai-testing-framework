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
 * ADR-018 RED-SIDE — the could-not-verify cross-boundary vocabulary.
 *
 * `FORGE_COULD_NOT_VERIFY` is the structured Playwright annotation TYPE that
 * carries a "could-not-verify" verdict across the spec→ingestion boundary. It
 * survives on `TestResult.annotations` (reporter API) AND `JSONReportTest.
 * annotations` (batch JSON), so BOTH ingestion readers can re-grade a
 * heal-caused failure to could-not-verify instead of a demonstrated defect.
 *
 * PURE module (no external imports) so the ingestion extractor
 * (testResultExtraction.ts) stays unit-test-importable without pulling in
 * Playwright. The producer-side helper that actually calls `test.info()` lives
 * with the producer (SmartLocator.ts), which already depends on Playwright.
 */

/** Structured annotation type emitted by the healer when it could not confidently
 *  resolve, and read by ingestion to re-grade a failed test to could-not-verify. */
export const FORGE_COULD_NOT_VERIFY = 'forge:could-not-verify';

export type Annotation = { type: string; description?: string };

/** True when the annotation set carries the could-not-verify signal. */
export function hasCouldNotVerify(annotations: Annotation[] | undefined): boolean {
  return !!annotations?.some(a => a.type === FORGE_COULD_NOT_VERIFY);
}

/**
 * Thrown by `SmartLocator.resolve()` when the strategy-chain AND Vision are
 * exhausted without a confident relocation — "could-not-heal-confidently".
 *
 * DISTINCT from a native browser/network error (archetype (b) vs (c)): a genuine
 * environment failure keeps its own error type and is NEVER wrapped as a
 * HealUnresolvedError, so ingestion can tell "I could not confidently heal" apart
 * from "the browser/network broke."
 */
export class HealUnresolvedError extends Error {
  /** Runtime brand — survives duplicate class identities (mirrors SmartLocator). */
  readonly forgeCouldNotVerify = true as const;
  constructor(message: string, public readonly key: string) {
    super(message);
    this.name = 'HealUnresolvedError';
  }
}
