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
  presentExecutionPreflight,
  type ExecutionPreflightInput,
  type PreflightDefinitionInput,
} from '../forge-ui/server/registry/ExecutionPreflightPresenter'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const subjectIds = ['inventory-html', 'inventory-item-html', 'cart-html', 'checkout-step-one-html']
const evidenceIds = subjectIds.map((_, index) => `evidence-${index + 1}`)

function definitions(): PreflightDefinitionInput[] {
  return subjectIds.map((subjectId, index) => ({
    id: `test-${subjectId}`,
    title: `Observe ${subjectId}`,
    provenance: { sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.6', supportingEvidenceIds: [evidenceIds[index]] },
    runnerCompatibility: { state: 'compatible' as const, explanation: 'The definition\'s steps, oracle, and authentication setup are all supported.' },
    steps: [{ kind: 'navigate_to_observed_route' }],
    oracle: { kind: 'subject_observable' },
  }))
}

function fixture(overrides: Partial<ExecutionPreflightInput> = {}): ExecutionPreflightInput {
  const defs = definitions()
  return {
    project: { id: 'saucedemo', name: 'saucedemo' },
    requested: { definitionIds: defs.map(d => d.id), revision: 2 },
    currentRevision: { revision: 2, testSetId: 'test-set-saucedemo', contentHash: 'a'.repeat(64), definitions: defs },
    designReadiness: {
      state: 'supported_with_constraints',
      explanation: 'A valid active model has exact direct-observation links to current-support evidence.',
      blockers: [],
      unknowns: ['Coverage, unobserved application scope, freshness, and evidence conflict are unknown.'],
    },
    runnerAdapter: { id: 'playwright-cli', version: 'not_established', available: false, explanation: 'No FORGE execution authority currently wires a runner adapter to controlled test-definition execution.' },
    credentials: { expectation: 'form-login', availability: 'available' },
    ...overrides,
  }
}

function present(input: ExecutionPreflightInput) {
  const result = presentExecutionPreflight(input)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') throw new Error('Fixture should be presentable')
  return result.value
}

test('all four current Sauce Demo definitions are compatible; runner availability remains a separate preflight concern', () => {
  const value = present(fixture())
  assert.equal(value.definitions.length, 4)
  for (const definition of value.definitions) assert.equal(definition.state, 'runner_unavailable')
  assert.equal(value.aggregate.state, 'runner_unavailable')
  assert.equal(value.executionOccurred, false)
})

test('aggregate state is deterministic across repeated evaluation of the same input', () => {
  const first = present(fixture())
  const second = present(fixture())
  assert.deepEqual(first, second)
})

test('an explicitly empty selection is invalid input — malformed, not a vacuous ready or blocked evaluation', () => {
  const result = presentExecutionPreflight(fixture({ requested: { definitionIds: [], revision: 2 } }))
  assert.equal(result.kind, 'malformed')
})

test('no current test-set revision → stale_or_unknown_inputs, never fabricated as ready', () => {
  const value = present(fixture({ currentRevision: null }))
  assert.equal(value.aggregate.state, 'stale_or_unknown_inputs')
  assert.equal(value.testSetRevision, null)
})

test('requesting a non-current revision → stale_or_unknown_inputs', () => {
  const value = present(fixture({ requested: { definitionIds: definitions().map(d => d.id), revision: 1 } }))
  assert.equal(value.aggregate.state, 'stale_or_unknown_inputs')
})

test('requesting an unknown definition id → stale_or_unknown_inputs', () => {
  const value = present(fixture({ requested: { definitionIds: ['test-does-not-exist'], revision: 2 } }))
  assert.equal(value.aggregate.state, 'stale_or_unknown_inputs')
})

test('blocked design_evidence_backed_tests readiness → conflicting_provenance, not silently promoted', () => {
  const value = present(fixture({ designReadiness: { state: 'blocked', explanation: 'x', blockers: ['Current-support evidence integrity failed.'], unknowns: [] } }))
  assert.equal(value.aggregate.state, 'conflicting_provenance')
})

test('unknown design_evidence_backed_tests readiness → stale_or_unknown_inputs', () => {
  const value = present(fixture({ designReadiness: { state: 'unknown', explanation: 'x', blockers: [], unknowns: ['x'] } }))
  assert.equal(value.aggregate.state, 'stale_or_unknown_inputs')
})

test('malformed input (invalid project id) fails closed without a presentation', () => {
  const result = presentExecutionPreflight(fixture({ project: { id: 'Bad Id!', name: 'x' } }))
  assert.equal(result.kind, 'malformed')
})

test('compatible definitions still require credential availability independently', () => {
  const value = present(fixture({
    runnerAdapter: { id: 'playwright-cli', version: 'test', available: true, explanation: 'Available for this disposable preflight proof.' },
    credentials: { expectation: 'form-login', availability: 'missing' },
  }))
  for (const definition of value.definitions) assert.equal(definition.state, 'credentials_unavailable')
  assert.equal(value.aggregate.state, 'credentials_unavailable')
})

test('response never claims pass, fail, coverage, health, or completeness', () => {
  const value = present(fixture())
  const serialized = JSON.stringify(value).toLowerCase()
  for (const forbidden of ['"passed"', '"failed":true', 'coverage_percent', 'health_score', 'completeness']) {
    assert.ok(!serialized.includes(forbidden), `unexpected claim: ${forbidden}`)
  }
})

test('response never carries credential values, stack traces, or filesystem paths', () => {
  const value = present(fixture())
  const serialized = JSON.stringify(value)
  for (const forbidden of ['secret_sauce', 'password', 'C:\\', '/home/', 'at Object.<anonymous>', '.forge-projects']) {
    assert.ok(!serialized.includes(forbidden), `forbidden content leaked: ${forbidden}`)
  }
})
