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
 * TD-082 — shared assertion-capability decisions for the spec generator.
 *
 * Consolidates the evidence-propagation decisions that were derived independently
 * across SpecGenerator's emit sites (FC-001 multiplicity, FC-002 nav grounding,
 * FC-003 observed-state, FC-004a prerequisite/reachability). Pure functions: no
 * side effects, no I/O, only the FlowStep type.
 *
 * Two orthogonal axes (see the SpecGenerator emit sites):
 *   - STEP axis  — grounding of this step + prior steps (determineStepCapability /
 *                  determineClickCapability).
 *   - ELEMENT axis — an element's cardinality + observed state, plus the step
 *                  capability it inherits (determineElementForm).
 */
import { FlowStep } from '../types';

/** A prior step in the flow was inferred (ungrounded) — the chain to reach this
 *  step is therefore unproven. Shared by both step-capability derivations. */
export function priorBroken(step: FlowStep, allSteps: FlowStep[]): boolean {
  return allSteps.some(s => s.stepIndex < step.stepIndex && s.grounding === 'inferred');
}

/** FC-004a batch/assertion gate: how strongly may an assertion at this step be
 *  emitted, given the grounding of arrival at it. priorBroken is load-bearing —
 *  checked before this step's own grounding. */
export function determineStepCapability(step: FlowStep, allSteps: FlowStep[]): 'full' | 'downgraded' | 'omit' {
  const thisInferred = step.grounding === 'inferred';
  if (priorBroken(step, allSteps)) return 'omit';
  if (thisInferred)                return 'downgraded';
  return 'full';
}

/** FC-004a click gate: a click cannot be weakened (no visible→attached analog),
 *  so an un-performable click is omitted with a machine-readable reason. Precedence
 *  is load-bearing — priorBroken (003 class) is checked before ownUnknown (002). */
export function determineClickCapability(step: FlowStep, allSteps: FlowStep[]): 'omit-prerequisite' | 'omit-ungrounded' | 'full' {
  const ownUnknown = step.grounding !== 'observed' && step.grounding !== 'inferred';
  if (priorBroken(step, allSteps)) return 'omit-prerequisite';   // 003 class — CHECK FIRST
  if (ownUnknown)                  return 'omit-ungrounded';      // 002 class
  return 'full';
}

/** FC-001 (multiplicity) + FC-003 (observed hidden) + FC-004a step-downgrade merge:
 *  the per-element assertion form. useFirst → repeated element (presence via
 *  .first() + not.toHaveCount(0)); useAttached → assert attached rather than
 *  visible (element hidden at crawl OR arrival at the page only inferred). */
export function determineElementForm(
  element: { cardinality?: { kind: string }; observedState?: string },
  stepCapability: 'full' | 'downgraded' | 'omit',
): { useAttached: boolean; useFirst: boolean } {
  const useFirst    = element.cardinality?.kind === 'repeated';
  const useAttached = element.observedState === 'attached' || stepCapability === 'downgraded';
  return { useAttached, useFirst };
}
