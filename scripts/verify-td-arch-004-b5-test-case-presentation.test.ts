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
import * as path from 'node:path'
import { TestCasePresentationService } from '../src/core/test-design/TestCasePresentationService'
import type { TestInventoryRead } from '../src/core/storage/repositories/TestSetRepository'
import type { CanonicalTestDefinitionV2, CanonicalTestSetV1, CanonicalTestSetV2 } from '../src/core/test-design/TestDefinitionContract'
import { readTestDefinition } from '../forge-ui/server/context/TestInventoryController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const seal = 'a'.repeat(64)
const observations = ['obs-1', 'obs-2']
const gaps = ['gap-1']

function v2Definition(auth: 'required' | 'not_required' | 'unknown' | 'conflicted' = 'required', route: 'available' | 'unknown' | 'conflicted' = 'available'): CanonicalTestDefinitionV2 {
  const blockedReason = route === 'conflicted' ? 'route_conflicted' : route === 'unknown' ? 'route_unknown'
    : auth === 'unknown' ? 'authentication_unknown' : auth === 'conflicted' ? 'authentication_conflicted' : null
  return {
    id: `definition-${auth}-${route}`,
    title: 'Inventory navigation',
    intent: 'Navigate using governed canonical route evidence.',
    canonicalSubjects: ['inventory-html'],
    provenance: { modelRowId: 7, modelVersion: '1.0.0', supportSealHash: seal, subjectSupport: [{ canonicalSubjectId: 'inventory-html', supportingObservationIds: observations, supportingGapIds: gaps }] },
    ...(route === 'available' ? { routeEvidence: { normalizedPath: '/inventory.html', normalizationPolicy: { id: 'forge.route', version: '1' }, supportingObservationIds: observations } } : {}),
    authenticationExpectation: { state: auth, mechanism: auth === 'required' ? 'form-login' : null, bases: auth === 'unknown' ? [] : [{ kind: 'declared_configuration', policyId: 'forge.auth', policyVersion: '1', configurationDigest: 'b'.repeat(64), mechanism: auth === 'required' ? 'form-login' : null }] },
    ...(route === 'available' ? { action: { kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/inventory.html' }, oracle: { kind: 'subject_observable', subjectId: 'inventory-html', supportingObservationIds: observations, explanation: 'Subject remains observable.' } } : {}),
    generationMethod: 'deterministic',
    validation: { state: 'valid', explanation: 'Valid.' },
    runnerCompatibility: blockedReason ? { state: 'blocked', reason: blockedReason, explanation: 'Blocked precisely.' } : { state: 'compatible', explanation: 'Compatible.' },
    confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: blockedReason ?? 'None.',
  }
}

function v2Set(definition = v2Definition()): CanonicalTestSetV2 {
  return {
    schemaVersion: 2, testSetId: 'test-set-v2', revision: 2, projectId: 'product', generationId: 'generation-v2', generatedAt: '2026-08-13T12:00:00.000Z', generationMethod: 'deterministic', outcome: definition.runnerCompatibility?.state === 'blocked' ? 'blocked' : 'completed',
    canonicalSupport: { modelRowId: 7, modelVersion: '1.0.0', observationRunId: 'run-1', supportSealHash: seal, characterizationPolicy: { id: 'forge.policy', version: '1' }, supportingObservationIds: observations, supportingGapIds: gaps },
    definitions: [definition], limitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerSet: 'Bounded.', coverage: 'unknown', freshness: 'not_evaluated',
  }
}

function v1Set(): CanonicalTestSetV1 {
  return {
    schemaVersion: 1, testSetId: 'test-set-v1', revision: 1, projectId: 'product', generationId: 'generation-v1', generatedAt: '2026-08-12T12:00:00.000Z', generationMethod: 'deterministic', outcome: 'completed', sourceObservationId: 'legacy-observation', modelRowId: 3, modelVersion: '0.9.0', supportingEvidenceIds: ['legacy-evidence'],
    definitions: [{ id: 'legacy-definition', title: 'Legacy navigation', intent: 'Historical compatibility.', category: 'navigation', canonicalSubjects: ['inventory-html'], preconditions: [], steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory-html', routePath: '/legacy?secret=withheld', evidenceId: 'legacy-evidence' }], oracle: { kind: 'subject_observable', subjectId: 'inventory-html', evidenceId: 'legacy-evidence', explanation: 'Legacy oracle.' }, provenance: { sourceObservationId: 'legacy-observation', modelRowId: 3, modelVersion: '0.9.0', supportingEvidenceIds: ['legacy-evidence'] }, generationMethod: 'deterministic', validation: { state: 'valid', explanation: 'Historical.' }, runnerCompatibility: { state: 'compatible', explanation: 'Historical compatibility only.' }, authenticationRequired: true, authenticationSetup: { required: true, mechanism: 'form-login', credentialReference: { usernameEnv: 'FORBIDDEN_USERNAME_ENV', passwordEnv: 'FORBIDDEN_PASSWORD_ENV' }, provenance: { sourceObservationId: 'legacy-observation' } }, confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: 'Legacy.' }],
    limitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerSet: 'Legacy.', coverage: 'unknown', freshness: 'not_evaluated',
  }
}

function inventory(current: CanonicalTestSetV1 | CanonicalTestSetV2, legacy = v1Set()): TestInventoryRead {
  const temporal = { startedAt: current.generatedAt, completedAt: current.generatedAt, temporalIntegrity: 'verified' as const, temporalCode: null, temporalExplanation: 'Verified.' }
  return {
    current: { rowId: current.schemaVersion, contentHash: 'c'.repeat(64), testSet: current, ...temporal },
    history: [
      { rowId: 2, testSetId: current.testSetId, revision: current.revision, generationId: current.generationId, generatedAt: current.generatedAt, outcome: current.outcome, schemaVersion: current.schemaVersion, sourceObservationId: current.schemaVersion === 1 ? current.sourceObservationId : null, modelRowId: current.schemaVersion === 1 ? current.modelRowId : current.canonicalSupport.modelRowId, modelVersion: current.schemaVersion === 1 ? current.modelVersion : current.canonicalSupport.modelVersion, observationRunId: current.schemaVersion === 2 ? current.canonicalSupport.observationRunId : null, supportSealHash: current.schemaVersion === 2 ? current.canonicalSupport.supportSealHash : null, definitionCount: current.definitions.length, contentHash: 'c'.repeat(64), ...temporal },
      { rowId: 1, testSetId: legacy.testSetId, revision: legacy.revision, generationId: legacy.generationId, generatedAt: legacy.generatedAt, outcome: legacy.outcome, schemaVersion: 1, sourceObservationId: legacy.sourceObservationId, modelRowId: legacy.modelRowId, modelVersion: legacy.modelVersion, observationRunId: null, supportSealHash: null, definitionCount: 1, contentHash: 'd'.repeat(64), ...temporal },
    ],
    total: 2, nextCursor: null, requestedDefinition: null,
  }
}

test('v2 presentation exposes sealed summaries and deliberate exact-ID drill-down without singular provenance', () => {
  const result = new TestCasePresentationService().present(inventory(v2Set()))
  assert.equal(result.current?.testSet.schemaVersion, 2)
  if (result.current?.testSet.schemaVersion !== 2) throw new Error('Expected v2 presentation.')
  const definition = result.current.testSet.definitions[0]
  assert.equal(definition.provenance.label, 'SEALED CANONICAL SUPPORT')
  assert.deepEqual([definition.provenance.supportingObservationCount, definition.provenance.supportingGapCount, definition.provenance.subjectSupportCount], [2, 1, 1])
  assert.deepEqual(definition.provenance.supportingObservationIds, observations)
  assert.equal('sourceObservationId' in definition.provenance, false)
})

test('v1 remains readable only as quarantined legacy provenance and withholds route/auth compatibility details', () => {
  const result = new TestCasePresentationService().present(inventory(v1Set()))
  assert.equal(result.current?.testSet.schemaVersion, 1)
  if (result.current?.testSet.schemaVersion !== 1) throw new Error('Expected v1 presentation.')
  const definition = result.current.testSet.definitions[0]
  assert.equal(definition.provenance.label, 'LEGACY PROVENANCE')
  assert.equal(definition.executionPolicy, 'legacy_provenance_unsupported')
  assert.equal(definition.routeEvidence.normalizedPath, null)
  assert.equal(definition.authenticationExpectation.state, 'legacy_compatibility')
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN_USERNAME_ENV|FORBIDDEN_PASSWORD_ENV|legacy\?secret/)
})

test('route unknown/conflicted and every authentication expectation remain honest', () => {
  for (const state of ['required', 'not_required', 'unknown', 'conflicted'] as const) {
    const result = new TestCasePresentationService().present(inventory(v2Set(v2Definition(state))))
    if (result.current?.testSet.schemaVersion !== 2) throw new Error('Expected v2 presentation.')
    assert.equal(result.current.testSet.definitions[0].authenticationExpectation.state, state)
  }
  for (const state of ['unknown', 'conflicted'] as const) {
    const result = new TestCasePresentationService().present(inventory(v2Set(v2Definition('required', state))))
    if (result.current?.testSet.schemaVersion !== 2) throw new Error('Expected v2 presentation.')
    assert.equal(result.current.testSet.definitions[0].routeEvidence.state, state)
    assert.equal(result.current.testSet.definitions[0].routeEvidence.normalizedPath, null)
  }
})

test('revision history discriminates canonical sealed support from legacy provenance', () => {
  const result = new TestCasePresentationService().present(inventory(v2Set()))
  assert.equal(result.history[0].authorityClass, 'canonical_v2')
  assert.equal(result.history[1].authorityClass, 'legacy_v1')
  assert.equal(result.history[0].provenance.label, 'SEALED CANONICAL SUPPORT')
  assert.equal(result.history[1].provenance.label, 'LEGACY PROVENANCE')
})

test('active pages consume the discriminated presentation and do not reconstruct v2 singular provenance', () => {
  const tests = fs.readFileSync(path.join(process.cwd(), 'forge-ui/src/pages/TestCasesPage.tsx'), 'utf8')
  const run = fs.readFileSync(path.join(process.cwd(), 'forge-ui/src/pages/RunPage.tsx'), 'utf8')
  const context = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ExecutionContext.ts'), 'utf8')
  assert.match(tests, /definition\.schemaVersion === 2/)
  assert.match(tests, /LEGACY PROVENANCE/)
  assert.match(tests, /SEALED CANONICAL SUPPORT/)
  assert.match(run, /current\?\.schemaVersion === 2/)
  assert.doesNotMatch(run, /sourceObservationId|supportingEvidenceIds|credentialReference/)
  assert.match(context, /testCasePresentationService\.read/)
})

test('the Product API transports the governed v2 presentation without reconstructing provenance', async () => {
  const original = executionContext.readTestInventory
  executionContext.readTestInventory = async () => new TestCasePresentationService().present({
    ...inventory(v2Set()),
    requestedDefinition: { definition: v2Definition(), revision: 2, rowId: 7 },
  })
  try {
    const response = await readTestDefinition('product', v2Definition().id, async () => ({ appName: 'product' }))
    assert.equal(response.status, 200)
    const serialized = JSON.stringify(response.body)
    assert.match(serialized, /"schemaVersion":2/)
    assert.match(serialized, /SEALED CANONICAL SUPPORT/)
    assert.doesNotMatch(serialized, /sourceObservationId|credentialReference|usernameEnv|passwordEnv/)
  } finally {
    executionContext.readTestInventory = original
  }
})

test('presentation owner is read-only and exposes no secret, raw URL, artifact, or persistence channel', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/core/test-design/TestCasePresentationService.ts'), 'utf8')
  assert.doesNotMatch(source, /insertInto|updateTable|deleteFrom|credentialReference|usernameEnv|passwordEnv|rawUrl|artifactPath/)
  assert.match(source, /normalizedPath/)
})
