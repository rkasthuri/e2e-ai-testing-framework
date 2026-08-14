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
import type { CanonicalTestDefinition, TestDesignAuthorityInput } from '../src/core/test-design/TestDefinitionContract'
import { generateEvidenceBackedTestSet, validateCanonicalTestSet } from '../src/core/test-design/TestDefinitionContract'
import {
  projectExecutablePlan,
  type CurrentProjectionAuthority,
  type ProjectionRequest,
} from '../src/core/execution/ExecutionProjectionService'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const projectedAt = '2026-08-07T21:00:00.000Z'
const saucedemoReference = { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' }

function baseInput(overrides: Partial<TestDesignAuthorityInput['sourceObservation']> = {}): TestDesignAuthorityInput {
  return {
    projectId: 'saucedemo',
    sourceObservation: {
      id: observationId,
      outcome: 'completed',
      authenticationOutcome: 'not_required',
      authenticationExpectation: 'none',
      credentialReference: null,
      subjectIds: ['inventory-html'],
      ...overrides,
    },
    model: { rowId: 7, version: '1.0.6', sourceObservationId: observationId, validation: 'valid', integrity: 'verified', subjects: [{ id: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }] },
    evidence: [{ id: 'evidence-1', canonicalSubjectId: 'inventory-html', routePath: '/inventory.html', sourceObservationId: observationId, sourceModelRows: [7], support: 'current', integrity: 'verified', freshness: 'not_evaluated', access: 'available', conflict: 'not_evaluated' }],
    generatedAt: projectedAt,
  }
}

function authRequiredInput() {
  return baseInput({ authenticationOutcome: 'succeeded', authenticationExpectation: 'form-login', credentialReference: saucedemoReference })
}

// --- 1. GENERATION: auth not required ---

test('generation: auth not required → no fabricated authenticationSetup', () => {
  const materialized = generateEvidenceBackedTestSet(baseInput(), 'gen-none', 1)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.authenticationRequired, false)
  assert.equal(definition.authenticationSetup, undefined)
  assert.deepEqual(definition.preconditions, [])
})

// --- 2. GENERATION: auth required + complete structured setup ---

test('generation: auth required + complete evidence → authenticationSetup is carried, correctly and completely', () => {
  const materialized = generateEvidenceBackedTestSet(authRequiredInput(), 'gen-auth', 1)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.authenticationRequired, true)
  assert.equal(definition.authenticationSetup?.required, true)
  assert.equal(definition.authenticationSetup?.mechanism, 'form-login')
  assert.deepEqual(definition.authenticationSetup?.credentialReference, saucedemoReference)
  assert.equal(definition.authenticationSetup?.provenance.sourceObservationId, observationId)
  assert.doesNotThrow(() => validateCanonicalTestSet(materialized.value))
})

// --- generation: real Sauce Demo evidence expectation ---

test('SAUCE DEMO EXPECTATION: real current evidence (form-login, recorded credential reference, succeeded auth) is sufficient — the definition moves beyond missing_auth_setup once projected', () => {
  const materialized = generateEvidenceBackedTestSet(authRequiredInput(), 'gen-saucedemo', 2)
  const definition = materialized.value.definitions[0]
  const request: ProjectionRequest = { definition, definitionTestSetId: materialized.value.testSetId, definitionRevision: 2 }
  const authority: CurrentProjectionAuthority = {
    currentRevision: { revision: 2, testSetId: materialized.value.testSetId },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
  }
  const result = projectExecutablePlan(request, authority, projectedAt)
  assert.equal(result.kind, 'ok', result.kind === 'failed' ? `unexpected failure: ${result.failure.code} — ${result.failure.explanation}` : undefined)
})

// --- 3. GENERATION: no fabrication ---

test('generation never invents a credential reference when none can be derived: input validation rejects an inconsistent authority rather than fabricating', () => {
  assert.throws(() => generateEvidenceBackedTestSet(baseInput({ authenticationOutcome: 'succeeded', authenticationExpectation: 'form-login', credentialReference: null }), 'gen-bad', 1))
})

// --- ExecutionProjectionService consumption of the structured field ---

function definition(overrides: Partial<CanonicalTestDefinition> = {}): CanonicalTestDefinition {
  return {
    id: 'test-inventory-html',
    title: 'Observe inventory-html',
    intent: 'x',
    category: 'navigation',
    canonicalSubjects: ['inventory-html'],
    preconditions: [],
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html', evidenceId: 'evidence-1', explanation: 'x' },
    provenance: { sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.6', supportingEvidenceIds: ['evidence-1'] },
    generationMethod: 'deterministic',
    validation: { state: 'valid', explanation: 'x' },
    runnerCompatibility: { state: 'blocked', explanation: 'x' },
    authenticationRequired: false,
    confidenceLimitations: [],
    materialUnknowns: [],
    unobservedScope: [],
    preventedStrongerDefinition: 'x',
    ...overrides,
  } as CanonicalTestDefinition
}

function request(overrides: Partial<ProjectionRequest> = {}): ProjectionRequest {
  return { definition: definition(), definitionTestSetId: 'test-set-saucedemo', definitionRevision: 2, ...overrides }
}

function authority(overrides: Partial<CurrentProjectionAuthority> = {}): CurrentProjectionAuthority {
  return {
    currentRevision: { revision: 2, testSetId: 'test-set-saucedemo' },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
    ...overrides,
  }
}

const completeSetup = {
  required: true as const,
  mechanism: 'form-login',
  credentialReference: saucedemoReference,
  provenance: { sourceObservationId: observationId },
}

// --- 4. auth not required ---

test('projection: auth not required → ok, regardless of the current authority\'s own auth expectation', () => {
  const result = projectExecutablePlan(request({ definition: definition({ authenticationRequired: false }) }), authority(), projectedAt)
  assert.equal(result.kind, 'ok')
})

// --- 5. auth required + complete structured setup ---

test('projection: auth required + complete structured setup → ok', () => {
  const def = definition({ authenticationRequired: true, authenticationSetup: completeSetup })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'ok')
  if (result.kind === 'ok') {
    assert.equal(result.plan.value.authenticationSetup?.mechanism, 'form-login')
    assert.deepEqual(result.plan.value.authenticationSetup?.credentialReference, saucedemoReference)
  }
})

// --- 6. auth required + missing credential reference ---

test('projection: auth required + no authenticationSetup at all → missing_auth_setup', () => {
  const def = definition({ authenticationRequired: true })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_auth_setup')
})

// --- 7. auth required + missing/unsupported mechanism ---

test('projection: auth required + unsupported mechanism → missing_auth_setup, precisely naming the mechanism', () => {
  const def = definition({
    authenticationRequired: true,
    authenticationSetup: { ...completeSetup, mechanism: 'sso-oidc' },
  })
  const ssoAuthority = authority({ sourceObservation: { id: observationId, authenticationExpectation: 'sso-oidc', authenticationOutcome: 'succeeded' } })
  const result = projectExecutablePlan(request({ definition: def }), ssoAuthority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') {
    assert.equal(result.failure.code, 'missing_auth_setup')
    assert.ok(result.failure.explanation.includes('sso-oidc'))
  }
})

// --- 8. conflicting/stale auth provenance ---

test('projection: authenticationSetup provenance from a different observation → conflicting_evidence', () => {
  const def = definition({
    authenticationRequired: true,
    authenticationSetup: { ...completeSetup, provenance: { sourceObservationId: 'a-different-observation-id' } },
  })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'conflicting_evidence')
})

test('projection: authenticationSetup mechanism no longer matches the current authority\'s expectation → conflicting_evidence', () => {
  const def = definition({ authenticationRequired: true, authenticationSetup: completeSetup })
  const driftedAuthority = authority({ sourceObservation: { id: observationId, authenticationExpectation: 'sso-oidc', authenticationOutcome: 'succeeded' } })
  const result = projectExecutablePlan(request({ definition: def }), driftedAuthority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'conflicting_evidence')
})

// --- 9. no fallback to old preconditions proxy ---

test('no fallback to the retired preconditions proxy: non-empty preconditions text alone never implies missing_auth_setup', () => {
  const def = definition({ authenticationRequired: false, preconditions: ['Some unrelated future precondition text.'] })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'ok', 'preconditions content must never be consulted by the projector')
})

test('no fallback to the retired preconditions proxy: empty preconditions alone never implies compatibility when auth is genuinely required and unestablished', () => {
  const def = definition({ authenticationRequired: true, preconditions: [] })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_auth_setup')
})

test('a definition generated before TD-UI-069C-C (authenticationRequired undefined) is never silently promoted to compatible', () => {
  const def = definition({ authenticationRequired: undefined, preconditions: [] }) as any
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_auth_setup')
})

// --- 10. no secrets serialized ---

test('SECRET BOUNDARY: definition JSON contains no secret values, only env-var-name references', () => {
  const materialized = generateEvidenceBackedTestSet(authRequiredInput(), 'gen-secret-check', 1)
  const serialized = materialized.json
  for (const forbidden of ['secret_sauce', 'password123', 'Bearer ', 'sessionid=', 'token=']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `forbidden content leaked: ${forbidden}`)
  }
  assert.ok(serialized.includes('SAUCEDEMO_USERNAME'))
  assert.ok(serialized.includes('SAUCEDEMO_PASSWORD'))
})

test('SECRET BOUNDARY: ExecutablePlan JSON and semantic hash input contain no secret values', () => {
  const def = definition({ authenticationRequired: true, authenticationSetup: completeSetup })
  const result = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  for (const serialized of [result.plan.json, result.plan.semanticJson, result.plan.fingerprint]) {
    for (const forbidden of ['secret_sauce', 'password123', 'Bearer ', 'sessionid=']) {
      assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `forbidden content leaked: ${forbidden}`)
    }
  }
  assert.ok(result.plan.json.includes('SAUCEDEMO_USERNAME'))
})

// --- deterministic materialization (auth-inclusive) ---

test('deterministic materialization: identical auth setup yields identical plan value and semantic hash', () => {
  const def = definition({ authenticationRequired: true, authenticationSetup: completeSetup })
  const first = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  const second = projectExecutablePlan(request({ definition: def }), authority(), projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.deepEqual(first.plan.value, second.plan.value)
  assert.equal(first.plan.fingerprint, second.plan.fingerprint)
})

// --- 9 (from the objective list): auth change affects semantic hash ---

test('HASH DISCIPLINE: an auth-free plan and an otherwise-identical auth-setup plan have different semantic hashes', () => {
  const authFree = projectExecutablePlan(request({ definition: definition({ authenticationRequired: false }) }), authority(), projectedAt)
  const withSetup = projectExecutablePlan(request({ definition: definition({ authenticationRequired: true, authenticationSetup: completeSetup }) }), authority(), projectedAt)
  assert.equal(authFree.kind, 'ok')
  assert.equal(withSetup.kind, 'ok')
  if (authFree.kind !== 'ok' || withSetup.kind !== 'ok') return
  assert.notEqual(authFree.plan.fingerprint, withSetup.plan.fingerprint)
})

test('HASH DISCIPLINE: a different (but still supported-shape) credential reference changes the semantic hash', () => {
  const first = projectExecutablePlan(request({ definition: definition({ authenticationRequired: true, authenticationSetup: completeSetup }) }), authority(), projectedAt)
  const differentReference = { ...completeSetup, credentialReference: { usernameEnv: 'OTHERAPP_USERNAME', passwordEnv: 'OTHERAPP_PASSWORD' } }
  const second = projectExecutablePlan(request({ definition: definition({ authenticationRequired: true, authenticationSetup: differentReference }) }), authority(), projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.notEqual(first.plan.fingerprint, second.plan.fingerprint)
})

// --- 10 (from the objective list): runner availability remains unrelated ---

test('runner/adapter availability remains entirely unrelated to authentication compatibility — no such input exists anywhere in this file\'s call sites', () => {
  const def = definition({ authenticationRequired: true, authenticationSetup: completeSetup })
  const results = Array.from({ length: 3 }, () => projectExecutablePlan(request({ definition: def }), authority(), projectedAt))
  for (const result of results) assert.equal(result.kind, 'ok')
})
