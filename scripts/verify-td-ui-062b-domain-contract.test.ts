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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendLifecycleTransition, applyLifecycleTransition, asEvidenceId, evaluateTruthConfidence,
  InvalidDomainContractError, InvalidLifecycleTransitionError,
  validateExplainableState,
} from '../src/core/domain/tdUi062b'
import {
  blockedDimensions, currentEvidence, fixtureProject,
  highConfidenceDimensions, integrityFailedEvidence, staleEvidence, unknownDimensions,
} from '../src/core/domain/tdUi062b.fixtures'

const event = (type: Parameters<typeof applyLifecycleTransition>[1]['type'], revision = 0) => ({
  eventId: `event-${type}-${revision}`,
  projectId: fixtureProject.projectId,
  type,
  occurredAt: `2026-07-30T10:0${revision}:00.000Z`,
  expectedRevision: revision,
  reason: `fixture transition: ${type}`,
  evidenceIds: [currentEvidence.id],
})

test('TD-UI-062B lifecycle transitions are deterministic and revisions increase monotonically', () => {
  const first = applyLifecycleTransition(fixtureProject, event('begin_configuration'))
  assert.equal(first.project.lifecycleState, 'configuring')
  assert.equal(first.project.stateRevision, 1)
  const second = applyLifecycleTransition(first.project, event('configuration_ready', 1))
  assert.equal(second.project.lifecycleState, 'ready_to_observe')
  assert.equal(second.project.stateRevision, 2)
})

test('lifecycle events append without mutating the prior event log', () => {
  const log = { events: [] as const }
  const result = appendLifecycleTransition(fixtureProject, log, event('begin_configuration'))
  assert.equal(log.events.length, 0)
  assert.equal(result.log.events.length, 1)
  assert.equal(result.log.events[0].type, 'begin_configuration')
})

test('invalid lifecycle transitions expose current state, attempted event, and required action', () => {
  assert.throws(
    () => applyLifecycleTransition(fixtureProject, event('configuration_ready')),
    (error: unknown) => {
      assert.ok(error instanceof InvalidLifecycleTransitionError)
      assert.equal(error.currentState, 'created')
      assert.equal(error.attemptedEvent.type, 'configuration_ready')
      assert.match(error.requiredNextAction, /allowed lifecycle event/i)
      return true
    },
  )
})

test('archived projects require an explicit restore event', () => {
  const archived = applyLifecycleTransition(fixtureProject, event('archive'))
  assert.equal(archived.project.lifecycleState, 'archived')
  assert.throws(() => applyLifecycleTransition(archived.project, event('observation_started', 1)), InvalidLifecycleTransitionError)
  const restored = applyLifecycleTransition(archived.project, event('restore', 1))
  assert.equal(restored.project.lifecycleState, 'created')
})

test('high confidence requires current valid evidence and all dimensions', () => {
  const evaluation = evaluateTruthConfidence(highConfidenceDimensions, [currentEvidence])
  assert.equal(evaluation.level, 'high')
  assert.equal(evaluation.preventedHigherState, null)
  assert.deepEqual(evaluation.evidenceIds, [currentEvidence.id])
})

test('missing evidence fails closed to unknown', () => {
  const evaluation = evaluateTruthConfidence(unknownDimensions, [])
  assert.equal(evaluation.level, 'unknown')
  assert.match(evaluation.why, /no evidence/i)
  assert.match(evaluation.preventedHigherState ?? '', /cannot be asserted/i)
})

test('stale evidence remains historical but cannot support current high confidence', () => {
  const evaluation = evaluateTruthConfidence(highConfidenceDimensions, [staleEvidence])
  assert.equal(evaluation.level, 'unknown')
  assert.match(evaluation.why, /stale/i)
  assert.ok(evaluation.blockers.some(blocker => blocker.kind === 'currency'))
})

test('integrity-failed evidence cannot support high confidence', () => {
  const evaluation = evaluateTruthConfidence(highConfidenceDimensions, [integrityFailedEvidence])
  assert.equal(evaluation.level, 'unknown')
  assert.ok(evaluation.blockers.some(blocker => blocker.kind === 'integrity'))
})

test('critical unknown prevents high confidence even with otherwise complete evidence', () => {
  const evaluation = evaluateTruthConfidence(highConfidenceDimensions, [currentEvidence], [{
    id: 'unknown-auth', subject: 'authenticated-area', reason: 'The protected area was not reachable', severity: 'critical', evidenceIds: [currentEvidence.id],
  }])
  assert.equal(evaluation.level, 'medium')
  assert.match(evaluation.why, /critical unknown/i)
  assert.notEqual(evaluation.preventedHigherState, null)
})

test('blocked access produces low confidence and an explainable blocker', () => {
  const evaluation = evaluateTruthConfidence(blockedDimensions, [currentEvidence])
  assert.equal(evaluation.level, 'low')
  assert.match(evaluation.why, /access/i)
})

test('conclusions without evidence IDs are rejected', () => {
  assert.throws(() => validateExplainableState({
    meaning: 'A conclusion', why: 'because', impact: 'impact', evidenceIds: [], conclusion: 'unsupported',
    unknowns: [], blockers: [], preventedHigherState: null, recommendedNextStep: null,
  }), (error: unknown) => error instanceof InvalidDomainContractError && /evidence ID/i.test(error.message))
})

test('credential material is rejected from evidence observations', () => {
  assert.throws(() => evaluateTruthConfidence(highConfidenceDimensions, [{
    ...currentEvidence, id: asEvidenceId('credential-evidence'), password: 'secret',
  } as unknown as typeof currentEvidence]), /credential material/i)
})
