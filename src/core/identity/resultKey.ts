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
 * Canonical result-identity key.
 *
 * A test result is identified by its spec FILE + test TITLE (+ optional BROWSER/
 * project). The file component disambiguates across apps — the same TC-GEN id
 * resets per app, so title alone is not unique (see TD-080). Production keys are
 * 3-part (file::title::browser); consumers with a single, non-discriminating
 * project (e.g. the TD-063 eval harness, all rows "generated") omit browser and
 * get a 2-part key. Both sides of any given join must build the key with THIS
 * function so the format never drifts.
 *
 * Takes primitives so callers absorb their own field-name differences
 * (results-store's `f.browser` vs ai-triage's `r.test.browserName`).
 */
export function makeResultKey(file: string, title: string, browser?: string): string {
  return browser ? `${file}::${title}::${browser}` : `${file}::${title}`
}
