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
 * TD-UI-061 — SURGICAL BRIDGE for the deprecated src/platform dashboard header
 * health badge.
 *
 * The badge previously fell through to 'Healthy' (bright green) whenever no
 * adverse signal was present — INCLUDING when there was NO evidence at all (empty
 * run set) or when the latest run was one FORGE could-not-verify. That is a
 * fabricated green: absence of a failure signal is not proof of health
 * (ADR-015 no-hardcoded-confidence), and a could-not-verify run is not a pass
 * (ADR-018 aggregate-to-the-weakest-truth).
 *
 * This module is the extracted, side-effect-free resolution + presentation so it
 * is unit-testable (dashboard-server.ts starts an HTTP server at import, so its
 * internals cannot be imported directly). It is a BRIDGE to stop a live lie —
 * NOT investment in the deprecated surface. The real fix is the honest DB-backed
 * forge-ui dashboard (TD-UI-062); src/platform retires with the Dashboard
 * milestone. Touch nothing else here.
 */

export type HealthState = 'Unknown' | 'At Risk' | 'Failing' | 'Changes' | 'Healthy';

/**
 * Resolve the header health badge honestly. The HONESTY GATE runs FIRST: with no
 * evidence, or a latest run FORGE could-not-verify (DB `status === 'unknown'`,
 * ADR-018), the badge is 'Unknown' — NEVER 'Healthy' (that would fabricate a
 * green) and NEVER 'At Risk'/'Failing' (absence is not a demonstrated defect).
 * Only with real evidence do the existing risk/triage/visual rules apply.
 */
export function resolveOverallHealth(s: {
  hasEvidence: boolean;    // at least one run present in the dashboard's window
  latestStatus?: string;   // newest run's DB status; 'unknown' = could-not-verify (ADR-018)
  highRisk: number;
  streak: number;
  triageFailed: number;
  visualChanges: number;
}): HealthState {
  if (!s.hasEvidence || s.latestStatus === 'unknown') return 'Unknown';   // honesty gate
  if (s.highRisk > 0 && s.streak === 0)                return 'At Risk';
  if (s.triageFailed > 0)                              return 'Failing';
  if (s.visualChanges > 0)                             return 'Changes';
  return 'Healthy';
}

/**
 * Human-facing badge label. 'Unknown' renders as "Insufficient Evidence" — an
 * honest "we don't know", never "Healthy" in grey, never a fabricated number.
 */
export function healthBadgeLabel(state: HealthState): string {
  return state === 'Unknown' ? 'Insufficient Evidence' : state;
}

/**
 * Badge colors. 'Unknown' is NEUTRAL GREY (absence ≠ failure — never the red
 * 'Failing' treatment, never the green 'Healthy' treatment). src/platform has no
 * design token system, so plain neutral greys are used (bridge, not a restyle).
 */
export function healthBadgeColors(state: HealthState): { color: string; bg: string } {
  if (state === 'Healthy') return { color: '#059669', bg: '#d1fae5' };  // green
  if (state === 'Changes') return { color: '#d97706', bg: '#fef3c7' };  // amber
  if (state === 'Unknown') return { color: '#6b7280', bg: '#eef0f2' };  // neutral grey
  return { color: '#dc2626', bg: '#fee2e2' };                            // red (At Risk / Failing)
}
