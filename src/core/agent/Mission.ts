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
 * Mission — the assignment handed to the Agent before it starts.
 * Same Agent, different behavior based on Mission policy.
 * Nova-approved abstraction (TD-093 Phase 2 design review).
 */

export type MissionType =
  | 'bootstrap'
  | 'crawl'
  | 'verification'
  | 'regression';

export interface Mission {
  type: MissionType;
  // TD-105: enforced at the Phase-3 goal-expansion/spawn loop (Block 3), not here —
  // depth is discovery policy; no spawn loop exists yet to bound.
  depthBudget: number;
  authAttemptsPermitted: boolean;
  /**
   * Hard lock: Bootstrap missions ALWAYS run supervised regardless of the
   * --autonomous CLI flag. NOTE (2026-07-18 audit): the actual enforcement in
   * AgentRunner keys on `mission.type === 'bootstrap'` (AgentRunner:54), NOT on
   * this field — no code reads supervisedOnly today. RESERVED, not removed:
   * TD-139's ExecutionDecision design may make it load-bearing; until then it
   * is declarative documentation of the policy, not the mechanism.
   */
  supervisedOnly: boolean;
  /** RESERVED (2026-07-18 audit) — declared but consumed by NO code path yet
   *  (sole appearances are a Bootstrap log echo and this declaration). Kept for
   *  the mission-policy design space (TD-139); do not treat as enforced. */
  optimizeFor: 'information-gain' | 'efficiency';
  label: string;
}

export const Missions = {
  bootstrap: (): Mission => ({
    type: 'bootstrap',
    depthBudget: 2,
    authAttemptsPermitted: true,
    supervisedOnly: true,
    optimizeFor: 'information-gain',
    label: 'Bootstrap: first-time app discovery',
  }),

  crawl: (): Mission => ({
    type: 'crawl',
    depthBudget: 10,
    authAttemptsPermitted: true,
    supervisedOnly: false,
    optimizeFor: 'efficiency',
    label: 'Crawl: deep app exploration',
  }),

  verification: (): Mission => ({
    type: 'verification',
    depthBudget: 3,
    authAttemptsPermitted: false,
    supervisedOnly: false,
    optimizeFor: 'efficiency',
    label: 'Verification: targeted element check',
  }),

  regression: (): Mission => ({
    type: 'regression',
    depthBudget: 10,
    authAttemptsPermitted: true,
    supervisedOnly: false,
    optimizeFor: 'efficiency',
    label: 'Regression: full re-verification',
  }),
};
