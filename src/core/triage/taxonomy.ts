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
 * src/core/triage/taxonomy.ts
 *
 * Canonical triage taxonomy — the single source of truth for failure categories
 * (TD-063 promotion). Reports, notifier, dashboard, and the triage classifier all
 * read from here so the category set and its display metadata never drift.
 *
 * NOTE: this file is intentionally self-contained and currently unused — consumers
 * are wired in later promotion commits (2/6+). No behavior change.
 */

export const TRIAGE_CATEGORIES = {
  APP_BUG:               'app-bug',
  TEST_DEFECT:           'test-defect',
  INFRA_DEFECT:          'infra-defect',
  FLAKY:                 'flaky',
  INSUFFICIENT_EVIDENCE: 'insufficient-evidence',
} as const;

export type TriageCategory = typeof TRIAGE_CATEGORIES[keyof typeof TRIAGE_CATEGORIES];

export const ALL_TRIAGE_CATEGORIES: TriageCategory[] = Object.values(TRIAGE_CATEGORIES);

// Display metadata (icon + short action) — single place, used by reports/notifier/dashboard later.
export const TRIAGE_DISPLAY: Record<TriageCategory, { icon: string; action: string }> = {
  'app-bug':               { icon: '🐛', action: 'File ticket / fix app code' },
  'test-defect':           { icon: '🔧', action: 'Fix the test/spec' },
  'infra-defect':          { icon: '🔴', action: 'Fix config / infra / environment' },
  'flaky':                 { icon: '🟡', action: 'Add retry or stabilize' },
  'insufficient-evidence': { icon: '❓', action: 'Manual review — evidence inconclusive' },
};
