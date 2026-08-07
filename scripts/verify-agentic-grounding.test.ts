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
 * TD-013 Phase 3 (Block 2a) — grounding guard tests.
 *   G1 all-observed actions        → 'observed'
 *   G2 one inferred among observed  → 'inferred' (the whole goal is a hypothesis)
 *   G3 empty actions[]              → 'inferred' (zero evidence is never the stronger claim)
 *   G4 IMMUTABILITY                 → derivation reads, never writes grounding
 *
 * Type-level immutability: AgentAction.grounding is declared `readonly`, so a
 * write like `act.grounding = 'inferred'` fails to COMPILE — the strongest guard.
 * G4 below is belt-and-suspenders proof that the runtime path never mutates.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveGoalGrounding } from '../src/core/agent/grounding'
import { AgentAction } from '../src/core/agent/types'

const observedAct = (target: string): AgentAction => ({ type: 'click', target, grounding: 'observed' })
const inferredAct = (target: string): AgentAction => ({ type: 'click', target, grounding: 'inferred' })

test('G1 all-observed actions -> observed', () => {
  assert.equal(deriveGoalGrounding([observedAct('a'), observedAct('b')]), 'observed')
})

test('G2 one inferred among observed -> inferred (whole goal is a hypothesis)', () => {
  assert.equal(deriveGoalGrounding([observedAct('a'), inferredAct('b'), observedAct('c')]), 'inferred')
})

test('G3 empty actions[] -> inferred (zero evidence is never the stronger claim)', () => {
  assert.equal(deriveGoalGrounding([]), 'inferred')
})

test('G4 IMMUTABILITY — derivation reads, never writes grounding', () => {
  const act = observedAct('a')
  const before = act.grounding
  deriveGoalGrounding([act, inferredAct('b')])
  assert.equal(act.grounding, before, 'derivation must not mutate an action grounding')
  assert.equal(act.grounding, 'observed')
})
