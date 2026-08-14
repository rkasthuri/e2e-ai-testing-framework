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
import type { CanonicalTestDefinition } from '../src/core/test-design/TestDefinitionContract'
import {
  projectExecutablePlan,
  type CurrentProjectionAuthority,
  type ProjectionRequest,
} from '../src/core/execution/ExecutionProjectionService'
import { validateCanonicalExecutablePlan } from '../src/core/execution/ExecutablePlanContract'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const projectedAt = '2026-08-07T21:00:00.000Z'

/** Real current shape: authentication required, no structured setup established (missing_auth_setup). */
function definition(overrides: Partial<CanonicalTestDefinition> = {}): CanonicalTestDefinition {
  return {
    id: 'test-inventory-html',
    title: 'Observe inventory-html',
    intent: 'Establish whether the observed subject inventory-html remains observable at its evidenced route.',
    category: 'navigation',
    canonicalSubjects: ['inventory-html'],
    preconditions: ['A separately governed authenticated session is required; current evidence does not establish reusable session setup.'],
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory-html', evidenceId: 'evidence-1', explanation: 'Observe the same canonical subject without assuming page completeness or a business outcome.' },
    provenance: { sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.6', supportingEvidenceIds: ['evidence-1'] },
    generationMethod: 'deterministic',
    validation: { state: 'valid', explanation: 'x' },
    runnerCompatibility: { state: 'blocked', explanation: 'x' },
    authenticationRequired: true,
    confidenceLimitations: [],
    materialUnknowns: [],
    unobservedScope: [],
    preventedStrongerDefinition: 'x',
    ...overrides,
  } as CanonicalTestDefinition
}

/** Same subject, but authentication is not required at all. */
function authFreeDefinition(overrides: Partial<CanonicalTestDefinition> = {}): CanonicalTestDefinition {
  return definition({ authenticationRequired: false, preconditions: [], ...overrides })
}

/** Same subject, with a complete, evidence-backed structured authentication setup. */
function authSetupDefinition(overrides: Partial<CanonicalTestDefinition> = {}): CanonicalTestDefinition {
  return definition({
    authenticationRequired: true,
    authenticationSetup: {
      required: true,
      mechanism: 'form-login',
      credentialReference: { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' },
      provenance: { sourceObservationId: observationId },
    },
    preconditions: ['An authenticated session is required. A structured, evidence-backed authentication setup (mechanism: form-login) has been established.'],
    ...overrides,
  })
}

function request(overrides: Partial<ProjectionRequest> = {}): ProjectionRequest {
  return { definition: definition(), definitionTestSetId: 'test-set-saucedemo', definitionRevision: 2, ...overrides }
}

function authRequiredAuthority(overrides: Partial<CurrentProjectionAuthority> = {}): CurrentProjectionAuthority {
  return {
    currentRevision: { revision: 2, testSetId: 'test-set-saucedemo' },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: 7, version: '1.0.6' },
    currentSupportEvidenceIds: ['evidence-1'],
    ...overrides,
  }
}

function authFreeAuthority(overrides: Partial<CurrentProjectionAuthority> = {}): CurrentProjectionAuthority {
  return authRequiredAuthority({ sourceObservation: { id: observationId, authenticationExpectation: 'none', authenticationOutcome: 'not_required' }, ...overrides })
}

test('a real-shaped definition without structured authentication setup remains incompatible — missing_auth_setup, precisely, not generic blocked', () => {
  const result = projectExecutablePlan(request(), authRequiredAuthority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_auth_setup')
})

test('an auth-free synthetic definition projects successfully', () => {
  const result = projectExecutablePlan(request({ definition: authFreeDefinition() }), authFreeAuthority(), projectedAt)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.plan.value.oracle.assertion, 'final_url_matches_route_no_navigation_error')
  assert.equal(result.plan.value.steps[0].routePath, '/inventory.html')
  assert.equal(result.plan.value.authenticationRequired, false)
  assert.equal(result.plan.value.authenticationSetup, undefined)
  assert.doesNotThrow(() => validateCanonicalExecutablePlan(result.plan.value))
})

test('a definition with a complete structured authentication setup projects successfully', () => {
  const result = projectExecutablePlan(request({ definition: authSetupDefinition() }), authRequiredAuthority(), projectedAt)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.plan.value.authenticationRequired, true)
  assert.equal(result.plan.value.authenticationSetup?.mechanism, 'form-login')
  assert.equal(result.plan.value.authenticationSetup?.credentialReference.usernameEnv, 'SAUCEDEMO_USERNAME')
})

test('materialization is deterministic — identical input twice yields identical value and json', () => {
  const req = request({ definition: authFreeDefinition() })
  const authority = authFreeAuthority()
  const first = projectExecutablePlan(req, authority, projectedAt)
  const second = projectExecutablePlan(req, authority, projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.deepEqual(first.plan.value, second.plan.value)
  assert.equal(first.plan.json, second.plan.json)
})

test('the content hash is deterministic for identical semantic content', () => {
  const req = request({ definition: authFreeDefinition() })
  const authority = authFreeAuthority()
  const first = projectExecutablePlan(req, authority, projectedAt)
  const second = projectExecutablePlan(req, authority, projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.equal(first.plan.fingerprint, second.plan.fingerprint)
  assert.equal(first.plan.semanticJson, second.plan.semanticJson)
})

test('TD-UI-069C-B-R: same definition + same authority, different projectedAt → identical semantic hash', () => {
  const req = request({ definition: authFreeDefinition() })
  const authority = authFreeAuthority()
  const a = projectExecutablePlan(req, authority, '2026-08-07T21:00:00.000Z')
  const b = projectExecutablePlan(req, authority, '2026-09-15T03:12:47.000Z')
  assert.equal(a.kind, 'ok')
  assert.equal(b.kind, 'ok')
  if (a.kind !== 'ok' || b.kind !== 'ok') return
  assert.notEqual(a.plan.value.projectedAt, b.plan.value.projectedAt, 'sanity: the two calls really did use different projectedAt values')
  assert.equal(a.plan.fingerprint, b.plan.fingerprint, 'a purely-metadata difference must not change the semantic hash')
  assert.equal(a.plan.semanticJson, b.plan.semanticJson)
  assert.equal(a.plan.value.projectedAt, '2026-08-07T21:00:00.000Z')
  assert.equal(b.plan.value.projectedAt, '2026-09-15T03:12:47.000Z')
  assert.ok(a.plan.json.includes('2026-08-07T21:00:00.000Z'))
  assert.ok(b.plan.json.includes('2026-09-15T03:12:47.000Z'))
  assert.ok(!a.plan.semanticJson.includes('projectedAt'))
})

test('a routePath change produces a different semantic hash', () => {
  const first = projectExecutablePlan(request({ definition: authFreeDefinition() }), authFreeAuthority(), projectedAt)
  const differentRoute = request({
    definition: authFreeDefinition({ steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/cart.html', evidenceId: 'evidence-1' }] }),
  })
  const second = projectExecutablePlan(differentRoute, authFreeAuthority(), projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.notEqual(first.plan.fingerprint, second.plan.fingerprint)
})

test('an oracle-affecting change (different observed subject) produces a different semantic hash', () => {
  const first = projectExecutablePlan(request({ definition: authFreeDefinition() }), authFreeAuthority(), projectedAt)
  const differentSubject = request({
    definition: authFreeDefinition({
      canonicalSubjects: ['cart-html'],
      steps: [{ kind: 'navigate_to_observed_route', subjectId: 'cart-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }],
      oracle: { kind: 'subject_observable', subjectId: 'cart-html', evidenceId: 'evidence-1', explanation: 'x' },
    }),
  })
  const second = projectExecutablePlan(differentSubject, authFreeAuthority(), projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.notEqual(first.plan.value.oracle.subjectId, second.plan.value.oracle.subjectId)
  assert.notEqual(first.plan.fingerprint, second.plan.fingerprint)
})

test('a relevant provenance change (different model version) produces a different semantic hash', () => {
  const first = projectExecutablePlan(request({ definition: authFreeDefinition() }), authFreeAuthority(), projectedAt)
  const differentModelVersion = request({
    definition: authFreeDefinition({ provenance: { sourceObservationId: observationId, modelRowId: 7, modelVersion: '1.0.7', supportingEvidenceIds: ['evidence-1'] } }),
  })
  const secondAuthority = authFreeAuthority({ model: { rowId: 7, version: '1.0.7' } })
  const second = projectExecutablePlan(differentModelVersion, secondAuthority, projectedAt)
  assert.equal(first.kind, 'ok')
  assert.equal(second.kind, 'ok')
  if (first.kind !== 'ok' || second.kind !== 'ok') return
  assert.notEqual(first.plan.value.provenance.modelVersion, second.plan.value.provenance.modelVersion)
  assert.notEqual(first.plan.fingerprint, second.plan.fingerprint)
})

test('an unsupported step kind fails to unsupported_action, not generic blocked', () => {
  const def = authFreeDefinition({ steps: [{ kind: 'click_element' as any, subjectId: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }] })
  const result = projectExecutablePlan(request({ definition: def }), authFreeAuthority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'unsupported_action')
})

test('an unsupported oracle kind fails to missing_oracle, not generic blocked', () => {
  const def = authFreeDefinition({ oracle: { kind: 'element_text_equals' as any, subjectId: 'inventory-html', evidenceId: 'evidence-1', explanation: 'x' } })
  const result = projectExecutablePlan(request({ definition: def }), authFreeAuthority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'missing_oracle')
})

test('a definition from a non-current revision fails to stale_definition', () => {
  const result = projectExecutablePlan(request({ definitionRevision: 1 }), authRequiredAuthority(), projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'stale_definition')
})

test('a definition whose provenance no longer agrees with the current model fails to conflicting_evidence', () => {
  const authority = authFreeAuthority({ model: { rowId: 8, version: '1.0.7' } })
  const result = projectExecutablePlan(request({ definition: authFreeDefinition() }), authority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'conflicting_evidence')
})

test('a definition whose supporting evidence is no longer current fails to conflicting_evidence', () => {
  const authority = authFreeAuthority({ currentSupportEvidenceIds: ['evidence-9-different'] })
  const result = projectExecutablePlan(request({ definition: authFreeDefinition() }), authority, projectedAt)
  assert.equal(result.kind, 'failed')
  if (result.kind === 'failed') assert.equal(result.failure.code, 'conflicting_evidence')
})

test('regenerating a plan never mutates a previously returned plan value', () => {
  const req = request({ definition: authFreeDefinition() })
  const first = projectExecutablePlan(req, authFreeAuthority(), projectedAt)
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok') return
  const snapshot = JSON.parse(JSON.stringify(first.plan.value))
  ;(first.plan.value as any).steps[0].routePath = '/tampered.html'
  const second = projectExecutablePlan(req, authFreeAuthority(), projectedAt)
  assert.equal(second.kind, 'ok')
  if (second.kind !== 'ok') return
  assert.deepEqual(second.plan.value, snapshot)
})

test('runner or adapter availability has no bearing on projection — no such input exists, and identical calls always agree', () => {
  const req = request({ definition: authFreeDefinition() })
  const authority = authFreeAuthority()
  // projectExecutablePlan's signature has no runner/adapter-availability
  // parameter at all — this call, repeated, is the structural proof that
  // varying environment state cannot change the result.
  const results = Array.from({ length: 5 }, () => projectExecutablePlan(req, authority, projectedAt))
  for (const result of results) assert.equal(result.kind, 'ok')
  const fingerprints = new Set(results.map(r => (r.kind === 'ok' ? r.plan.fingerprint : null)))
  assert.equal(fingerprints.size, 1)
})

test('runnerCompatibility explanation no longer mentions a runner/execution adapter', async () => {
  const { generateEvidenceBackedTestSet } = await import('../src/core/test-design/TestDefinitionContract')
  const input = {
    projectId: 'saucedemo',
    sourceObservation: {
      id: observationId, outcome: 'completed' as const, authenticationOutcome: 'succeeded' as const,
      authenticationExpectation: 'form-login', credentialReference: { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' },
      subjectIds: ['inventory-html'],
    },
    model: { rowId: 7, version: '1.0.6', sourceObservationId: observationId, validation: 'valid' as const, integrity: 'verified' as const, subjects: [{ id: 'inventory-html', routePath: '/inventory.html', evidenceId: 'evidence-1' }] },
    evidence: [{ id: 'evidence-1', canonicalSubjectId: 'inventory-html', routePath: '/inventory.html', sourceObservationId: observationId, sourceModelRows: [7], support: 'current' as const, integrity: 'verified' as const, freshness: 'not_evaluated' as const, access: 'available' as const, conflict: 'not_evaluated' as const }],
    generatedAt: projectedAt,
  }
  const materialized = generateEvidenceBackedTestSet(input, 'gen-1', 1)
  const definition = materialized.value.definitions[0]
  assert.ok(!definition.runnerCompatibility.explanation.toLowerCase().includes('adapter'), `explanation still mentions an adapter: ${definition.runnerCompatibility.explanation}`)
  // Complete evidence was supplied, so authenticationSetup should now be established.
  assert.equal(definition.authenticationRequired, true)
  assert.equal(definition.authenticationSetup?.mechanism, 'form-login')
})
