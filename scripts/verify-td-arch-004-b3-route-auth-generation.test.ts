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
import { canonicalObservationIntegrityHash } from '../src/core/observation/ObservationIntegrity'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationRecord } from '../src/core/observation/ObservationTypes'
import {
  CanonicalRouteEvidenceProjection,
  normalizeCanonicalRoute,
  ROUTE_NORMALIZATION_POLICY,
} from '../src/core/test-design/CanonicalRouteEvidenceProjection'
import {
  AuthenticationExpectationProjectionService,
  type DeclaredAuthenticationSource,
} from '../src/core/test-design/AuthenticationExpectationProjection'
import { generateCanonicalTestSetV2, parseCanonicalTestSet } from '../src/core/test-design/TestDefinitionContract'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import type { CanonicalTestDefinitionAuthority } from '../src/core/test-design/TestDefinitionAuthorityProjectionService'

const authority: CanonicalTestDefinitionAuthority = {
  schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: 'product',
  modelRowId: 7, modelVersion: '1.0.0', observationRunId: 'run-1', supportSealHash: 'a'.repeat(64),
  characterizationPolicy: { id: 'forge.policy', version: '1' },
  supportingObservationIds: ['obs-1'], supportingGapIds: ['gap-1'],
  subjectSupport: [{ canonicalSubjectId: 'inventory', supportingObservationIds: ['obs-1'], supportingGapIds: [] }],
}

function observation(urlPattern: string, id = 'obs-1'): ObservationRecord {
  const core = {
    schemaVersion: 'forge-observation/v1' as const, observationRunId: 'run-1', projectId: 'product',
    producer: 'forge.crawler', producerVersion: '1', method: 'browser_dom_inspection' as const,
    methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection, subjectId: 'inventory',
    predicate: 'page.discovered', outcome: 'present' as const,
    observedValue: { urlPattern, elementCount: 1, fingerprint: 'dom' },
    boundary: {
      schemaVersion: 'forge-observation-boundary/v1' as const, kind: 'document' as const,
      scope: { acquisitionKind: 'web_crawl' }, startedAt: '2026-08-12T10:00:00.000Z',
      endedAt: '2026-08-12T10:00:01.000Z', completion: 'complete' as const,
      policyId: 'forge.boundary', policyVersion: '1',
    },
    capturedAt: '2026-08-12T10:00:01.000Z', provenanceClass: 'native' as const, safeReasonCode: null,
  }
  return {
    ...core, observationId: id, idempotencyKey: id,
    integrityHash: canonicalObservationIntegrityHash(core, []), artifactIds: [], safeMessage: null,
  }
}

function routeProjection(observations: ObservationRecord[], modelRoute = '/inventory.html') {
  const appModels = { readHistory: async () => ({
    kind: 'ok', activeCount: 1, activeModel: {
      rowId: 7, version: '1.0.0', validation: 'valid', integrity: 'verified',
      subjects: [{ id: 'inventory', routePath: modelRoute }],
    },
  }) }
  const repository = { readRun: async () => ({
    run: {}, observations, gaps: [], artifacts: [],
  }) }
  return new CanonicalRouteEvidenceProjection(appModels as any, () => repository as any)
}

test('route normalization strips origin/query/fragment and refuses unsafe or malformed forms', () => {
  assert.deepEqual(normalizeCanonicalRoute('https://example.invalid/inventory.html?q=secret#token'), { kind: 'ok', normalizedPath: '/inventory.html' })
  assert.deepEqual(normalizeCanonicalRoute('/inventory.html?q=secret#token'), { kind: 'ok', normalizedPath: '/inventory.html' })
  for (const unsafe of ['//evil.invalid/x', '/a\\b', '/%2fadmin', '/user@example', 'https://u:p@example.invalid/x']) {
    assert.equal(normalizeCanonicalRoute(unsafe).kind, 'refused', unsafe)
  }
  assert.deepEqual(normalizeCanonicalRoute('/%zz'), { kind: 'refused', code: 'route_malformed' })
})

test('one route and repeated same-route Observations produce exact combined canonical evidence', async () => {
  const second = observation('/inventory.html?ignored=1', 'obs-2')
  const expanded = {
    ...authority,
    supportingObservationIds: ['obs-1', 'obs-2'],
    subjectSupport: [{ canonicalSubjectId: 'inventory', supportingObservationIds: ['obs-1', 'obs-2'], supportingGapIds: [] }],
  }
  const result = await routeProjection([observation('/inventory.html'), second]).read('product', expanded)
  assert.equal(result.kind, 'ok')
  if (result.kind === 'ok') {
    assert.equal(result.evidence.subjects[0].normalizedPath, '/inventory.html')
    assert.deepEqual(result.evidence.subjects[0].supportingObservationIds, ['obs-1', 'obs-2'])
    assert.deepEqual(result.evidence.normalizationPolicy, ROUTE_NORMALIZATION_POLICY)
  }
})

test('conflicting, missing, integrity-failed, and App Model-disagreeing routes refuse', async () => {
  const conflictAuthority = {
    ...authority, supportingObservationIds: ['obs-1', 'obs-2'],
    subjectSupport: [{ canonicalSubjectId: 'inventory', supportingObservationIds: ['obs-1', 'obs-2'], supportingGapIds: [] }],
  }
  assert.equal((await routeProjection([observation('/inventory.html'), observation('/cart.html', 'obs-2')])
    .read('product', conflictAuthority)).kind, 'refused')
  const unrelated = { ...observation('/inventory.html'), predicate: 'control.present' }
  assert.equal((await routeProjection([unrelated]).read('product', authority) as any).code, 'route_unknown')
  const corrupt = { ...observation('/inventory.html'), integrityHash: '0'.repeat(64) }
  assert.equal((await routeProjection([corrupt]).read('product', authority) as any).code, 'route_observation_integrity_failed')
  assert.equal((await routeProjection([observation('/inventory.html')], '/cart.html').read('product', authority) as any).code, 'route_model_disagreement')
})

function auth(sources: DeclaredAuthenticationSource[]) {
  return new AuthenticationExpectationProjectionService({ read: () => sources })
    .read('product', 'unused')
}

test('declared auth required/not-required are safe; unknown and conflict remain explicit', () => {
  const required = auth([{ state: 'required', mechanism: 'form-login', configurationDigest: '1'.repeat(64) }])
  const notRequired = auth([{ state: 'not_required', mechanism: null, configurationDigest: '2'.repeat(64) }])
  assert.equal(required.state, 'required'); assert.equal(required.mechanism, 'form-login')
  assert.equal(notRequired.state, 'not_required'); assert.equal(notRequired.mechanism, null)
  assert.equal(auth([]).state, 'unknown')
  assert.equal(auth([
    { state: 'required', mechanism: 'form-login', configurationDigest: '1'.repeat(64) },
    { state: 'not_required', mechanism: null, configurationDigest: '2'.repeat(64) },
  ]).state, 'conflicted')
  assert.doesNotMatch(JSON.stringify(required), /username|password|envKey|credential/i)
})

test('canonical v2 generation carries exact route/auth/support and blocks unknown without credential state', () => {
  const routeEvidence = {
    schemaVersion: 'forge-canonical-route-evidence/v1' as const, projectId: 'product', modelRowId: 7,
    supportSealHash: 'a'.repeat(64), normalizationPolicy: { ...ROUTE_NORMALIZATION_POLICY },
    subjects: [{ canonicalSubjectId: 'inventory', normalizedPath: '/inventory.html', supportingObservationIds: ['obs-1'] }],
    identityHash: 'b'.repeat(64),
  }
  const known = generateCanonicalTestSetV2({ projectId: 'product', generatedAt: '2026-08-12T10:00:02.000Z', authority, routeEvidence,
    authenticationExpectation: auth([{ state: 'required', mechanism: 'form-login', configurationDigest: '1'.repeat(64) }]) }, 'generation-1', 1)
  assert.equal(known.value.outcome, 'completed')
  assert.equal(known.value.definitions[0].runnerCompatibility?.state, 'compatible')
  assert.equal(known.value.definitions[0].routeEvidence?.normalizedPath, '/inventory.html')
  assert.equal('sourceObservationId' in known.value.definitions[0], false)
  assert.doesNotMatch(known.json, /username|password|envKey|credentialAvailability|authenticationExecutionResult/i)
  assert.equal(parseCanonicalTestSet(known.json).fingerprint, known.fingerprint)
  const unknown = generateCanonicalTestSetV2({ projectId: 'product', generatedAt: '2026-08-12T10:00:02.000Z', authority, routeEvidence,
    authenticationExpectation: auth([]) }, 'generation-2', 2)
  assert.equal(unknown.value.outcome, 'blocked')
  assert.equal((unknown.value.definitions[0].runnerCompatibility as any).reason, 'authentication_unknown')
  const conflicted = generateCanonicalTestSetV2({ projectId: 'product', generatedAt: '2026-08-12T10:00:02.000Z', authority, routeEvidence,
    authenticationExpectation: auth([
      { state: 'required', mechanism: 'form-login', configurationDigest: '1'.repeat(64) },
      { state: 'not_required', mechanism: null, configurationDigest: '2'.repeat(64) },
    ]) }, 'generation-3', 3)
  assert.equal(conflicted.value.outcome, 'blocked')
  assert.equal(conflicted.value.definitions[0].authenticationExpectation?.state, 'conflicted')
  assert.equal((conflicted.value.definitions[0].runnerCompatibility as any).reason, 'authentication_conflicted')
})

test('credential availability cannot change canonical generation output', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/core/test-design/CanonicalTestDefinitionGenerationService.ts'), 'utf8')
  assert.doesNotMatch(source, /CredentialResolver|CredentialStore|process\.env|usernameEnv|passwordEnv/)
})

test('support seal or characterization policy changes during generation refuse as STALE_AUTHORITY', async () => {
  for (const changed of [
    { ...authority, supportSealHash: 'c'.repeat(64) },
    { ...authority, characterizationPolicy: { id: 'forge.policy', version: '2' } },
  ]) {
    let authorityReads = 0
    let failedCode = ''
    const repository = {
      beginGeneration: async () => undefined,
      commitCanonicalV2Generation: async () => { throw new Error('must not commit') },
      failGeneration: async (_p: string, _g: string, _i: string, _t: string, code: string) => { failedCode = code },
    }
    const authorityProjection = { read: async () => ({ kind: 'ok', authority: authorityReads++ === 0 ? authority : changed }) }
    const routeProjection = { read: async (_p: string, current: CanonicalTestDefinitionAuthority) => ({ kind: 'ok', evidence: {
      schemaVersion: 'forge-canonical-route-evidence/v1', projectId: 'product', modelRowId: 7,
      supportSealHash: current.supportSealHash, normalizationPolicy: { ...ROUTE_NORMALIZATION_POLICY },
      subjects: [{ canonicalSubjectId: 'inventory', normalizedPath: '/inventory.html', supportingObservationIds: ['obs-1'] }],
      identityHash: `${current.supportSealHash}:${current.characterizationPolicy.version}`,
    } }) }
    const service = new CanonicalTestDefinitionGenerationService(repository as any, authorityProjection as any, routeProjection as any,
      { read: () => auth([]) } as any, () => '2026-08-12T10:00:02.000Z', async () => undefined)
    await assert.rejects(() => service.generate('product', 'unused', `generation-stale-${authorityReads}`), (error: any) => error.code === 'STALE_AUTHORITY')
    assert.equal(failedCode, 'STALE_AUTHORITY')
  }
})

test('controller supplies identity and intent only; no route/auth/support injection surface remains', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/TestInventoryController.ts'), 'utf8')
  assert.match(source, /generateCanonicalTestSet\(appName, generationId\)/)
  assert.doesNotMatch(source, /routePath|authType|authenticationExpectation|supportSealHash|supportingObservationIds|sourceObservationId/)
})

test('readiness carries sealed, route, auth, generation, and deferred-execution dimensions separately', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/registry/ApplicationReadinessPresenter.ts'), 'utf8')
  for (const term of ['testDefinitionSemanticAdmission', 'routeState', 'authenticationExpectation', 'generationAvailable']) {
    assert.match(source, new RegExp(term))
  }
  assert.match(source, /unsupportedDownstreamDecision\(input, 'execute_existing_tests'\)/)
})
