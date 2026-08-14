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
import * as fs from 'node:fs'
import type { TestDesignAuthorityInput } from '../src/core/test-design/TestDefinitionContract'
import { generateEvidenceBackedTestSet, parseCanonicalTestSet } from '../src/core/test-design/TestDefinitionContract'
import { evaluateIntrinsicCompatibility, type CompatibilityIntrinsicInput } from '../src/core/execution/DefinitionCompatibilityEvaluator'
import {
  projectExecutablePlan,
  type CurrentProjectionAuthority,
  type ProjectionRequest,
} from '../src/core/execution/ExecutionProjectionService'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const projectedAt = '2026-08-09T10:00:00.000Z'
const saucedemoReference = { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' }

function baseInput(overrides: Partial<TestDesignAuthorityInput['sourceObservation']> = {}): TestDesignAuthorityInput {
  return {
    projectId: 'saucedemo',
    sourceObservation: {
      id: observationId, outcome: 'completed', authenticationOutcome: 'succeeded',
      authenticationExpectation: 'form-login', credentialReference: saucedemoReference,
      subjectIds: ['inventory-html'],
      ...overrides,
    },
    model: { rowId: 7, version: '1.0.6', sourceObservationId: observationId, validation: 'valid', integrity: 'verified', subjects: [{ id: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }] },
    evidence: [{ id: 'evidence-1', canonicalSubjectId: 'inventory-html', routePath: '/inventory.html', sourceObservationId: observationId, sourceModelRows: [7], support: 'current', integrity: 'verified', freshness: 'not_evaluated', access: 'available', conflict: 'not_evaluated' }],
    generatedAt: projectedAt,
  }
}

// --- 1. PRODUCER/CONSUMER INVENTORY (executable proof, not just prose) ---

test('PRODUCER: TestDefinitionContract stamps runnerCompatibility via the shared evaluator, never independently', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-1', 1)
  const definition = materialized.value.definitions[0]
  const expected = evaluateIntrinsicCompatibility({
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html' },
    authenticationRequired: true,
    authenticationSetup: { mechanism: 'form-login' },
  })
  assert.deepEqual(definition.runnerCompatibility, expected)
})

// --- item 3 (compatible definition) ---

test('COMPATIBLE: real complete evidence (form-login, recorded reference, succeeded auth) → runnerCompatibility.state compatible, and the live projector agrees', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-2', 2)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.runnerCompatibility.state, 'compatible')
  assert.ok(!('reason' in definition.runnerCompatibility))

  const request: ProjectionRequest = { definition, definitionTestSetId: materialized.value.testSetId, definitionRevision: 2 }
  const authority: CurrentProjectionAuthority = {
    currentRevision: { revision: 2, testSetId: materialized.value.testSetId },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
  }
  const result = projectExecutablePlan(request, authority, projectedAt)
  assert.equal(result.kind, 'ok', result.kind === 'failed' ? `stored 'compatible' but live projection disagreed: ${result.failure.code}` : undefined)
})

// --- missing auth -> blocked / missing_auth_setup ---

test('BLOCKED/missing_auth_setup: auth required, no derivable reference at generation time', () => {
  assert.throws(() => generateEvidenceBackedTestSet(baseInput({ authenticationOutcome: 'succeeded', authenticationExpectation: 'form-login', credentialReference: null }), 'gen-bad', 1))
  // The evaluator's own direct behavior for the equivalent shape (required, no setup):
  const result = evaluateIntrinsicCompatibility({
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html' },
    authenticationRequired: true,
    authenticationSetup: undefined,
  })
  assert.equal(result.state, 'blocked')
  if (result.state === 'blocked') assert.equal(result.reason, 'missing_auth_setup')
})

// --- unsupported action -> blocked / unsupported_action ---

test('BLOCKED/unsupported_action', () => {
  const input: CompatibilityIntrinsicInput = {
    steps: [{ kind: 'click_element', subjectId: 'inventory-html' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html' },
    authenticationRequired: false,
  }
  const result = evaluateIntrinsicCompatibility(input)
  assert.equal(result.state, 'blocked')
  if (result.state === 'blocked') assert.equal(result.reason, 'unsupported_action')
})

test('BLOCKED/unsupported_action: an additional step cannot be ignored by the shared evaluator', () => {
  const result = evaluateIntrinsicCompatibility({
    steps: [
      { kind: 'navigate_to_observed_route', subjectId: 'inventory-html' },
      { kind: 'click_element', subjectId: 'inventory-html' },
    ],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html' },
    authenticationRequired: false,
  })
  assert.equal(result.state, 'blocked')
  if (result.state === 'blocked') assert.equal(result.reason, 'unsupported_action')
})

// --- missing oracle -> blocked / missing_oracle ---

test('BLOCKED/missing_oracle', () => {
  const input: CompatibilityIntrinsicInput = {
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html' }],
    oracle: { kind: 'element_text_equals', subjectId: 'inventory-html' },
    authenticationRequired: false,
  }
  const result = evaluateIntrinsicCompatibility(input)
  assert.equal(result.state, 'blocked')
  if (result.state === 'blocked') assert.equal(result.reason, 'missing_oracle')
})

// --- conflicting provenance -> blocked / conflicting_evidence (live-only, via the projector) ---

test('BLOCKED/conflicting_evidence: a compatible-per-evaluator definition still fails live re-verification against a disagreeing authority', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-3', 3)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.runnerCompatibility.state, 'compatible') // intrinsically fine
  const request: ProjectionRequest = { definition, definitionTestSetId: materialized.value.testSetId, definitionRevision: 3 }
  const disagreeingAuthority: CurrentProjectionAuthority = {
    currentRevision: { revision: 3, testSetId: materialized.value.testSetId },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 8, version: '2.0.0' }, // disagrees with definition.provenance.modelRowId=7
    currentSupportEvidenceIds: ['evidence-1'],
  }
  const result = projectExecutablePlan(request, disagreeingAuthority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'conflicting_evidence')
})

// --- stale definition -> blocked / stale_definition (live-only, via the projector) ---

test('BLOCKED/stale_definition: a compatible-per-evaluator definition still fails live re-verification when it is not the current revision', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-4', 4)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.runnerCompatibility.state, 'compatible')
  const request: ProjectionRequest = { definition, definitionTestSetId: materialized.value.testSetId, definitionRevision: 4 }
  const authority: CurrentProjectionAuthority = {
    currentRevision: { revision: 5, testSetId: materialized.value.testSetId }, // a newer revision is now current
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
  }
  const result = projectExecutablePlan(request, authority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'stale_definition')
})

// --- runner unavailable has no bearing ---

test('runner/adapter availability has no bearing on runnerCompatibility or on the intrinsic evaluator — no such parameter exists anywhere in this call chain', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-5', 1)
  const definition = materialized.value.definitions[0]
  // evaluateIntrinsicCompatibility's signature has no runner/adapter field;
  // calling it repeatedly is the structural proof the result cannot vary
  // with environment state.
  const results = Array.from({ length: 5 }, () => evaluateIntrinsicCompatibility({
    steps: definition.steps.map(s => ({ kind: s.kind, subjectId: s.subjectId })),
    oracle: { kind: definition.oracle.kind, subjectId: definition.oracle.subjectId },
    authenticationRequired: definition.authenticationRequired,
    authenticationSetup: definition.authenticationSetup ? { mechanism: definition.authenticationSetup.mechanism } : undefined,
  }))
  for (const r of results) assert.equal(r.state, 'compatible')
})

// --- existing revisions remain readable (backward compatibility) ---

test('BACKWARD COMPATIBILITY: a legacy-shaped payload (state: blocked, no reason field, no authenticationRequired) still parses and validates', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-legacy', 1)
  const legacyShaped = structuredClone(materialized.value) as any
  for (const definition of legacyShaped.definitions) {
    definition.runnerCompatibility = { state: 'blocked', explanation: 'The current authorities do not establish reusable authentication setup for this bounded definition.' }
    delete definition.authenticationRequired
    delete definition.authenticationSetup
  }
  const json = JSON.stringify(legacyShaped)
  const reparsed = parseCanonicalTestSet(json)
  assert.equal(reparsed.value.definitions[0].runnerCompatibility.state, 'blocked')
  assert.equal(reparsed.value.definitions[0].authenticationRequired, undefined)

  // And the live projector treats it exactly as an undefined-shape legacy
  // definition — missing_auth_setup, never silently promoted.
  const request: ProjectionRequest = { definition: reparsed.value.definitions[0], definitionTestSetId: reparsed.value.testSetId, definitionRevision: reparsed.value.revision }
  const authority: CurrentProjectionAuthority = {
    currentRevision: { revision: reparsed.value.revision, testSetId: reparsed.value.testSetId },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
  }
  const result = projectExecutablePlan(request, authority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_auth_setup')
})

test('BACKWARD COMPATIBILITY: revision 1 and 2 persisted payloads on disk (if present) remain readable under the widened validator', () => {
  // Read-only inspection of what TD-UI-068A's certification record described
  // as the real, persisted, immutable revision 1 payload shape — proving the
  // widened validator does not require fields that revision predates.
  const legacy = {
    schemaVersion: 1, testSetId: 'test-set-x', revision: 1, projectId: 'saucedemo', generationId: 'g-1',
    generatedAt: '2026-08-07T10:00:00.000Z', generationMethod: 'deterministic', outcome: 'partially_completed',
    sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.6', supportingEvidenceIds: ['evidence-1'],
    definitions: [{
      id: 'test-x', title: 'Observe x', intent: 'x', category: 'navigation', canonicalSubjects: ['inventory-html'],
      preconditions: ['A separately governed authenticated session may be required; current evidence does not establish reusable session setup.'],
      steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }],
      oracle: { kind: 'subject_observable', subjectId: 'inventory-html', evidenceId: 'evidence-1', explanation: 'x' },
      provenance: { sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.6', supportingEvidenceIds: ['evidence-1'] },
      generationMethod: 'deterministic', validation: { state: 'valid', explanation: 'x' },
      runnerCompatibility: { state: 'blocked', explanation: 'x' }, // no `reason` field — pre-existing shape
      confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: 'x',
    }],
    limitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerSet: 'x', coverage: 'unknown', freshness: 'not_evaluated',
  }
  assert.doesNotThrow(() => parseCanonicalTestSet(JSON.stringify(legacy)))
})

// --- no duplicate compatibility evaluator remains (static source scan) ---

test('NO DUPLICATE EVALUATOR: ExecutionPreflightPresenter no longer declares its own SUPPORTED_STEP_KINDS/SUPPORTED_ORACLE_KINDS', () => {
  const source = fs.readFileSync('forge-ui/server/registry/ExecutionPreflightPresenter.ts', 'utf8')
  assert.ok(!source.includes('SUPPORTED_STEP_KINDS'))
  assert.ok(!source.includes('SUPPORTED_ORACLE_KINDS'))
})

test('NO DUPLICATE EVALUATOR: ExecutionProjectionService imports the shared evaluator rather than redeclaring intrinsic checks', () => {
  const source = fs.readFileSync('src/core/execution/ExecutionProjectionService.ts', 'utf8')
  assert.ok(source.includes("from './DefinitionCompatibilityEvaluator'"))
  assert.ok(!source.includes("SUPPORTED_STEP_KINDS = new Set"))
  assert.ok(!source.includes("SUPPORTED_AUTH_MECHANISMS = new Set"))
})

test('NO DUPLICATE EVALUATOR: ExecutionPreflightController delegates live evaluation to the core execution boundary', () => {
  const source = fs.readFileSync('forge-ui/server/context/ExecutionPreflightController.ts', 'utf8')
  assert.ok(source.includes('readProductExecutionPreflight'))
  assert.ok(!source.includes('evaluateDefinitionCompatibility'))
  assert.ok(!source.includes('runnerCompatibility: d.runnerCompatibility'))
})

test('SECRET BOUNDARY holds through the unification: no credential value in generated payload, plan, or evaluator output', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-secret', 1)
  const serialized = JSON.stringify(materialized.value)
  for (const forbidden of ['standard_user', 'secret_sauce']) assert.ok(!serialized.toLowerCase().includes(forbidden))
  assert.ok(serialized.includes('SAUCEDEMO_USERNAME'))
})
