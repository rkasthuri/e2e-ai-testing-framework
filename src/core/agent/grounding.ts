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
 * TD-013 Phase 3 (Block 2a) — derived goal-grounding.
 *
 * A goal's grounding is DERIVED from its actions, never stored, so it cannot
 * drift from the evidence it summarizes. Mirrors FlowDetector.finalizeFlowStatus
 * exactly: the whole is 'observed' only when EVERY part is observed; anything
 * less — including zero evidence — is 'inferred'. An empty action set is
 * 'inferred', never 'observed': zero evidence is never the stronger claim
 * (the honesty floor — no evidence is not a passing default).
 *
 * Reads only; never mutates. AgentAction.grounding is `readonly`, so the
 * immutability this function relies on is also enforced at the type level.
 */

import { AgentAction } from './types'

export function deriveGoalGrounding(actions: AgentAction[]): 'observed' | 'inferred' {
  return actions.length > 0 && actions.every(a => a.grounding === 'observed')
    ? 'observed'
    : 'inferred'
}
