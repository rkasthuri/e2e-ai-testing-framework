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
 * TD-085 — the shared eval contract.
 *
 * Every capability harness (triage, generation, healing, vision) produces
 * `EvalRecord`s to this one shape, so a single runner/reporter can collect,
 * score, and aggregate across all of them — and the Dashboard can read one
 * uniform record instead of each harness's bespoke output.
 *
 * Pure types + the canonical-metric map. No I/O, no imports.
 */

// ── The unit every harness produces ───────────────────────────────────────────

export interface EvalMetrics {
  primaryScore: number;        // 0-1, the canonical metric for this capability
  latencyMs?: number;          // wall-clock time for the AI call/operation
  costUsd?: number;            // API cost if applicable
  [key: string]: number | undefined;  // extensible (precision, recall, tokens, etc.)
}

export interface EvalRecord {
  capability: 'triage' | 'generation' | 'healing' | 'vision';
  id: string;                  // unique within the eval run (e.g. "TC-GEN-001")
  input: unknown;              // the thing being evaluated
  expected: unknown;           // what correct looks like
  actual: unknown;             // what the system produced
  pass: boolean;               // did it meet the success criterion?
  metrics: EvalMetrics;        // primaryScore + optional dimensions
  timestamp: string;           // ISO
  notes?: string;              // optional human-readable context
}

// ── Per-capability aggregate (for Dashboard) ──────────────────────────────────

export interface CapabilityMetrics {
  capability: EvalRecord['capability'];
  canonicalMetric: string;     // human label: "Accuracy", "Behavioral pass rate", etc.
  score: number;               // 0-1, aggregate across all records in a run
  passRate: number;            // fraction of records where pass === true
  totalRecords: number;
  timestamp: string;
}

export const CANONICAL_METRICS: Record<EvalRecord['capability'], string> = {
  triage:     'Accuracy',
  generation: 'Behavioral pass rate',
  healing:    'Correct heal rate',
  vision:     'Detection accuracy',
};

// ── What the reporter produces for a whole run ────────────────────────────────

export interface EvalRunSummary {
  runId: string;
  capabilities: CapabilityMetrics[];
  totalPass: number;
  totalFail: number;
  generatedAt: string;
}
