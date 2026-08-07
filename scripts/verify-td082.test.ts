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
 * TD-082 — proof test for the extracted assertion-capability helpers (pure logic;
 * no generator, no browser, no file I/O).
 *
 * Guards the four consolidated decisions (priorBroken, determineStepCapability,
 * determineClickCapability, determineElementForm) AND their semantic preservation
 * vs the old inline SpecGenerator code (Nova's key requirement — the refactor must
 * not change behavior). Framework: node:test + node:assert/strict under tsx.
 * Run: npx tsx --test scripts/verify-td082.test.ts
 *
 * 13 tests: the PART-2 semantic-preservation checks (P2.1–P2.5) are folded into
 * their PART-1 counterparts (identical input/output), annotated inline as
 * "= old inline behavior", rather than as duplicate blocks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowStep } from '../src/core/onboarding/types';
import {
  priorBroken, determineStepCapability, determineClickCapability, determineElementForm,
} from '../src/core/onboarding/generators/assertionHelpers';

// FlowStep factory — only stepIndex + grounding matter to these helpers.
const mkStep = (stepIndex: number, grounding?: 'observed' | 'inferred'): FlowStep => ({
  stepIndex,
  pageId: `p${stepIndex}`,
  action: 'assert-navigation',
  elementId: null,
  targetPageId: `t${stepIndex}`,
  value: null,
  ...(grounding ? { grounding } : {}),
});

// ══ PART 1 — priorBroken ══════════════════════════════════════════════════════

test('P1.1 priorBroken: a prior inferred step -> true', () => {
  const step = mkStep(2, 'observed');
  assert.equal(priorBroken(step, [mkStep(1, 'inferred'), step]), true);
});

test('P1.2 priorBroken: no prior inferred step -> false', () => {
  const step = mkStep(2, 'observed');
  assert.equal(priorBroken(step, [mkStep(1, 'observed'), step]), false);
});

test('P1.3 priorBroken: inferred step at SAME stepIndex (not prior) -> false', () => {
  const step = mkStep(2, 'observed');
  // another step at the same index that is inferred — not "prior" (stepIndex < step.stepIndex)
  assert.equal(priorBroken(step, [mkStep(2, 'inferred'), step]), false);
});

// ══ PART 1 — determineStepCapability (+ P2.1) ═════════════════════════════════

test('P1.4/P2.1 determineStepCapability: priorBroken=true -> omit (= old computeBatchAssertionCapability)', () => {
  const step = mkStep(2, 'observed');
  assert.equal(determineStepCapability(step, [mkStep(1, 'inferred'), step]), 'omit');
  // vacuity: pre-FC-004a had no priorBroken check -> would have returned 'full'.
});

test('P1.5 determineStepCapability: thisInferred=true, priorBroken=false -> downgraded', () => {
  const step = mkStep(2, 'inferred');
  assert.equal(determineStepCapability(step, [mkStep(1, 'observed'), step]), 'downgraded');
});

test('P1.6 determineStepCapability: all observed -> full', () => {
  const step = mkStep(2, 'observed');
  assert.equal(determineStepCapability(step, [mkStep(1, 'observed'), step]), 'full');
});

// ══ PART 1 — determineClickCapability (+ P2.2, P2.3) ══════════════════════════

test('P1.7/P2.2 determineClickCapability: priorBroken=true (observed) -> omit-prerequisite (= old computeClickCapability)', () => {
  const step = mkStep(2, 'observed');
  assert.equal(determineClickCapability(step, [mkStep(1, 'inferred'), step]), 'omit-prerequisite');
});

test('P1.8/P2.3 determineClickCapability: ownUnknown (grounding undefined) -> omit-ungrounded', () => {
  const step = mkStep(2);   // no grounding -> unknown
  assert.equal(determineClickCapability(step, [mkStep(1, 'observed'), step]), 'omit-ungrounded');
});

test('P1.9 determineClickCapability: observed, no prior inferred -> full', () => {
  const step = mkStep(2, 'observed');
  assert.equal(determineClickCapability(step, [mkStep(1, 'observed'), step]), 'full');
});

// ══ PART 1 — determineElementForm (+ P2.4, P2.5) ═════════════════════════════

test('P1.10 determineElementForm: repeated + downgraded -> {useFirst:true, useAttached:true}', () => {
  assert.deepEqual(determineElementForm({ cardinality: { kind: 'repeated' } }, 'downgraded'), { useAttached: true, useFirst: true });
});

test('P1.11/P2.4 determineElementForm: hidden + full -> {useFirst:false, useAttached:true} (= old FC-003 toBeAttached)', () => {
  assert.deepEqual(determineElementForm({ observedState: 'attached' }, 'full'), { useAttached: true, useFirst: false });
  // vacuity: pre-FC-003 always toBeVisible -> useAttached would be false.
});

test('P1.12 determineElementForm: single + visible + full -> {useFirst:false, useAttached:false}', () => {
  assert.deepEqual(determineElementForm({}, 'full'), { useAttached: false, useFirst: false });
});

test('P1.13/P2.5 determineElementForm: repeated + full -> {useFirst:true, useAttached:false} (= old FC-001 .first()+not.toHaveCount(0))', () => {
  assert.deepEqual(determineElementForm({ cardinality: { kind: 'repeated' } }, 'full'), { useAttached: false, useFirst: true });
});
