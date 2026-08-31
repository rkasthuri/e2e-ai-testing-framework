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
import * as os from 'node:os'
import * as path from 'node:path'
import type { AppModel } from '../src/core/onboarding/types'
import type { CredentialExecutionScope, CredentialMaterial } from '../src/core/security/CredentialExecutionScope'
import {
  materializeCanonicalTestSet,
  generateCanonicalFlowTestSetV3,
  generateCanonicalTestSetV2,
  parseCanonicalTestSetV2,
  parseCanonicalTestSetV3,
  TestDefinitionContractError,
} from '../src/core/test-design/TestDefinitionContract'
import {
  NORMALIZED_TEST_INTENT_REFUSAL_CODES,
  normalizeDiscoveredIntentV1,
  refusedNormalizedTestIntentV1,
  NormalizedTestIntentContractError,
  type DiscoveredIntentNormalizationInputV1,
  type MaterializedNormalizedTestIntentV1,
} from '../src/core/test-design/NormalizedTestIntentContract'
import type { CanonicalTestDefinitionAuthority } from '../src/core/test-design/TestDefinitionAuthorityProjectionService'
import type { CanonicalRouteEvidence } from '../src/core/test-design/CanonicalRouteEvidenceProjection'
import type { AuthenticationExpectationProjection } from '../src/core/test-design/AuthenticationExpectationProjection'
import { projectExecutablePlan } from '../src/core/execution/ExecutionProjectionService'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { productResultTruth } from '../src/core/execution/ExecutionRunCoordinator'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import { TestCasePresentationService } from '../src/core/test-design/TestCasePresentationService'
import { ExecutionService, productRunnerAdapterIdentity } from '../src/core/execution/ExecutionService'

const PROJECT = 'm1-cart-fixture'
const WORKSPACE_ROOT = path.join(os.tmpdir(), 'forge-m1-observed-flow', process.pid.toString())
const SEAL = 'a'.repeat(64)
const ROUTE_HASH = 'b'.repeat(64)
const AUTH_DIGEST = 'c'.repeat(64)
const AUTH_HASH = 'd'.repeat(64)

function model(): AppModel {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-08-24T12:00:00.000Z',
    generatedBy: 'engine',
    classificationRunId: 'classification-m1',
    app: {
      name: PROJECT,
      displayName: 'M1 cart fixture',
      baseUrl: 'https://m1.example.test',
      appType: 'web-ui',
      modelVersion: '1.0.0',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: null,
    },
    roles: [{
      id: 'standardUser',
      displayName: 'Standard user',
      authFlow: 'form-login',
      credentialsEnvKey: 'M1_CREDENTIALS',
      storageStatePath: null,
      reachablePageIds: ['cart-html', 'checkout-step-one-html'],
      restrictedPageIds: [],
      authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'cart-html',
      displayName: 'Cart',
      urlPattern: '/cart.html',
      urlPatternType: 'exact',
      fingerprint: 'cart-fingerprint',
      fingerprintBasis: 'url+dom-hash',
      appType: 'web-ui',
      accessibleByRoles: ['standardUser'],
      isAuthPage: false,
      module: {
        name: 'Cart', confidence: 'medium', method: 'rule', evidenceIds: ['cart-html'],
        source: 'evidence-matched', reason: 'one unambiguous cart keyword',
      },
      elements: [{
        id: 'cart-html:checkout',
        name: 'checkout',
        kind: 'button',
        label: 'Checkout',
        critical: true,
        aiNamed: false,
        strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
        tier3Assertions: [],
        cardinality: { kind: 'single' },
        observedState: 'visible',
        href: null,
      }],
    }, {
      id: 'checkout-step-one-html',
      displayName: 'Checkout information',
      urlPattern: '/checkout-step-one.html',
      urlPatternType: 'exact',
      fingerprint: 'checkout-fingerprint',
      fingerprintBasis: 'url+dom-hash',
      appType: 'web-ui',
      accessibleByRoles: ['standardUser'],
      isAuthPage: false,
      module: {
        name: 'Checkout', confidence: 'medium', method: 'rule', evidenceIds: ['checkout-step-one-html'],
        source: 'evidence-matched', reason: 'one unambiguous checkout keyword',
      },
      elements: [],
    }],
    flows: [{
      id: 'direct-checkout',
      displayName: 'Direct checkout from cart',
      confidence: 'partial',
      source: 'agent-proposed',
      roleId: 'standardUser',
      steps: [{
        stepIndex: 1,
        pageId: 'home',
        action: 'assert-navigation',
        elementId: null,
        targetPageId: 'cart-html',
        value: null,
        grounding: 'inferred',
      }, {
        stepIndex: 2,
        pageId: 'cart-html',
        action: 'click',
        elementId: 'cart-html:checkout',
        targetPageId: 'checkout-step-one-html',
        value: null,
        grounding: 'observed',
      }],
      linkedApiEndpointIds: [],
      groundingWarnings: ['The excluded entry navigation was not observed.'],
    }],
    endpoints: null,
    api: null,
    diff: null,
  }
}

function authority(): CanonicalTestDefinitionAuthority {
  return {
    schemaVersion: 'forge-test-definition-authority/v2',
    authorityClass: 'canonical_v2',
    projectId: PROJECT,
    modelRowId: 41,
    modelVersion: '1.0.0',
    observationRunId: 'observation-run-m1',
    supportSealHash: SEAL,
    characterizationPolicy: { id: 'forge.crawl-observation-characterization', version: '1' },
    supportingObservationIds: ['obs-cart', 'obs-checkout'],
    supportingGapIds: [],
    subjectSupport: [{
      canonicalSubjectId: 'cart-html', supportingObservationIds: ['obs-cart'], supportingGapIds: [],
    }, {
      canonicalSubjectId: 'checkout-step-one-html', supportingObservationIds: ['obs-checkout'], supportingGapIds: [],
    }],
  }
}

function routes(): CanonicalRouteEvidence {
  return {
    schemaVersion: 'forge-canonical-route-evidence/v1',
    projectId: PROJECT,
    modelRowId: 41,
    supportSealHash: SEAL,
    normalizationPolicy: { id: 'forge.canonical-route-normalization', version: '1' },
    subjects: [{
      canonicalSubjectId: 'cart-html', normalizedPath: '/cart.html', supportingObservationIds: ['obs-cart'],
    }, {
      canonicalSubjectId: 'checkout-step-one-html', normalizedPath: '/checkout-step-one.html', supportingObservationIds: ['obs-checkout'],
    }],
    identityHash: ROUTE_HASH,
  }
}

function authentication(): AuthenticationExpectationProjection {
  return {
    schemaVersion: 'forge-authentication-expectation/v1',
    state: 'required',
    mechanism: 'form-login',
    bases: [{
      kind: 'declared_configuration',
      policyId: 'forge.authentication-expectation.declared-configuration',
      policyVersion: '1',
      configurationDigest: AUTH_DIGEST,
      mechanism: 'form-login',
    }],
    identityHash: AUTH_HASH,
  }
}

function normalizationInput(): DiscoveredIntentNormalizationInputV1 {
  return {
    projectId: PROJECT,
    model: model(),
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    selection: { flowId: 'direct-checkout', selectedFlowStepIndexes: [2] },
  }
}

function supportedIntent(): MaterializedNormalizedTestIntentV1 {
  const result = normalizeDiscoveredIntentV1(normalizationInput())
  assert.equal(result.kind, 'supported')
  return result.materialized
}

test('M1 intent normalizes only the observed segment and retains excluded inference as limitations', () => {
  const normalized = supportedIntent()
  assert.equal(normalized.value.source, 'discovered')
  assert.equal(normalized.value.appArea.id, 'Cart')
  assert.deepEqual(normalized.value.grounding.selectedFlowStepIndexes, [2])
  assert.deepEqual(normalized.value.grounding.excludedFlowStepIndexes, [1])
  assert.deepEqual(normalized.value.steps.map(step => step.kind), [
    'navigate_to_observed_route', 'click_observed_data_test',
  ])
  assert.equal(normalized.value.steps[1].kind === 'click_observed_data_test'
    ? normalized.value.steps[1].dataTestValue : null, 'checkout')
  assert.match(normalized.value.evidenceAssessment.limitations.join(' '), /partial.*directly observed/i)
  assert.match(normalized.fingerprint, /^[a-f0-9]{64}$/)
})

test('M1 public refusal vocabulary is frozen and every internal refusal branch maps into it', () => {
  assert.deepEqual(NORMALIZED_TEST_INTENT_REFUSAL_CODES, [
    'insufficient_evidence', 'ambiguous_evidence', 'unsupported_semantics', 'app_area_unknown',
  ])
  assert.throws(() => refusedNormalizedTestIntentV1(
    PROJECT,
    { flowId: 'direct-checkout', selectedFlowStepIndexes: [2] },
    'missing_flow' as any,
  ), NormalizedTestIntentContractError)
  const cases: Array<[string, (input: DiscoveredIntentNormalizationInputV1) => void, string]> = [
    ['project mismatch', input => { input.routeEvidence.projectId = 'other-project' }, 'insufficient_evidence'],
    ['invalid segment', input => { input.selection.selectedFlowStepIndexes = [] }, 'unsupported_semantics'],
    ['missing flow', input => { input.selection.flowId = 'missing-flow' }, 'insufficient_evidence'],
    ['ambiguous flow', input => { input.model.flows!.push(structuredClone(input.model.flows![0])) }, 'ambiguous_evidence'],
    ['untrusted flow confidence', input => { input.model.flows![0].confidence = 'inferred' }, 'insufficient_evidence'],
    ['missing selected step', input => { input.selection.selectedFlowStepIndexes = [99] }, 'unsupported_semantics'],
    ['ambiguous selected step', input => { input.model.flows![0].steps.push(structuredClone(input.model.flows![0].steps[1])) }, 'ambiguous_evidence'],
    ['inferred', input => { input.model.flows![0].steps[1].grounding = 'inferred' }, 'insufficient_evidence'],
    ['unsupported action', input => { input.model.flows![0].steps[1].action = 'fill' }, 'unsupported_semantics'],
    ['missing source subject', input => { input.model.pages!.shift() }, 'insufficient_evidence'],
    ['same source and target', input => { input.model.flows![0].steps[1].targetPageId = 'cart-html' }, 'unsupported_semantics'],
    ['missing app area', input => { input.model.pages![0].module = undefined }, 'app_area_unknown'],
    ['ambiguous app area', input => { input.model.pages![0].module!.confidence = 'low' }, 'app_area_unknown'],
    ['invalid app area evidence', input => { input.model.pages![0].module!.evidenceIds = [] }, 'app_area_unknown'],
    ['missing element', input => { input.model.pages![0].elements = [] }, 'insufficient_evidence'],
    ['repeated element', input => { input.model.pages![0].elements[0].cardinality = { kind: 'repeated', index: 0 } }, 'ambiguous_evidence'],
    ['unsupported locator', input => { input.model.pages![0].elements[0].strategies = [] }, 'unsupported_semantics'],
    ['ambiguous locator', input => { input.model.pages![0].elements[0].strategies.push({ type: 'data-test', value: 'checkout-two', confidence: 1 }) }, 'ambiguous_evidence'],
    ['missing route', input => { input.routeEvidence.subjects.pop() }, 'insufficient_evidence'],
    ['missing support', input => { input.authority.subjectSupport.pop() }, 'insufficient_evidence'],
    ['unknown authentication', input => { input.authenticationExpectation = { schemaVersion: 'forge-authentication-expectation/v1', state: 'unknown', mechanism: null, bases: [], identityHash: AUTH_HASH } }, 'insufficient_evidence'],
    ['conflicted authentication', input => { input.authenticationExpectation = { schemaVersion: 'forge-authentication-expectation/v1', state: 'conflicted', mechanism: null, bases: [], identityHash: AUTH_HASH } }, 'ambiguous_evidence'],
    ['auth not established', input => { input.model.roles[0].authOutcome = 'failed' }, 'insufficient_evidence'],
  ]
  const observedCodes = new Set<string>()
  for (const [label, mutate, expected] of cases) {
    const input = structuredClone(normalizationInput())
    mutate(input)
    const result = normalizeDiscoveredIntentV1(input)
    assert.equal(result.kind, 'refused', label)
    assert.equal(result.intent.disposition.code, expected, label)
    assert.ok(NORMALIZED_TEST_INTENT_REFUSAL_CODES.includes(result.intent.disposition.code), label)
    observedCodes.add(result.intent.disposition.code)
    assert.deepEqual(result.intent.steps, [], label)
  }
  assert.deepEqual([...observedCodes].sort(), [...NORMALIZED_TEST_INTENT_REFUSAL_CODES].sort())
})

test('M1 Test Definition embeds intent identity/hash and rejects reordered or duplicate plan steps', () => {
  const normalizedIntent = supportedIntent()
  const materialized = generateCanonicalFlowTestSetV3({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    normalizedIntent,
  }, 'generation-m1', 1)
  const definition = materialized.value.definitions[0]
  assert.equal(definition.provenance.intentId, normalizedIntent.value.intentId)
  assert.equal(definition.provenance.intentContentHash, normalizedIntent.fingerprint)
  assert.equal(definition.appArea, 'Cart')
  assert.deepEqual(definition.actions?.map(step => step.kind), [
    'navigate_to_observed_route', 'click_observed_data_test',
  ])

  const reordered = structuredClone(materialized.value) as any
  reordered.definitions[0].actions.reverse()
  assert.throws(() => materializeCanonicalTestSet(reordered), TestDefinitionContractError)
  const duplicate = structuredClone(materialized.value) as any
  duplicate.definitions[0].actions[1].stepId = duplicate.definitions[0].actions[0].stepId
  duplicate.definitions[0].normalizedIntent.steps[1].stepId = duplicate.definitions[0].normalizedIntent.steps[0].stepId
  assert.throws(() => materializeCanonicalTestSet(duplicate), TestDefinitionContractError)
  const wrongArea = structuredClone(materialized.value) as any
  wrongArea.definitions[0].appArea = 'Checkout'
  assert.throws(() => materializeCanonicalTestSet(wrongArea), TestDefinitionContractError)
})

test('M1 v2 and v3 decoders are disjoint and v2 navigation remains unchanged', () => {
  const v3 = generateCanonicalFlowTestSetV3({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    normalizedIntent: supportedIntent(),
  }, 'generation-v3-boundary', 2)
  assert.equal(parseCanonicalTestSetV3(v3.json).value.schemaVersion, 3)
  assert.throws(() => parseCanonicalTestSetV2(v3.json), TestDefinitionContractError)

  const presentedAsV2 = structuredClone(v3.value) as any
  presentedAsV2.schemaVersion = 2
  assert.throws(() => materializeCanonicalTestSet(presentedAsV2), TestDefinitionContractError)
  const v2ProjectionBypass = projectExecutablePlan({
    definition: v3.value.definitions[0],
    definitionSchemaVersion: 2,
    definitionTestSetId: v3.value.testSetId,
    definitionRevision: v3.value.revision,
    testSetContentHash: v3.fingerprint,
  }, {
    currentRevision: { revision: v3.value.revision, testSetId: v3.value.testSetId, contentHash: v3.fingerprint },
    sealedAuthority: authority(), routeEvidence: routes(), authenticationExpectation: authentication(),
  }, '2026-08-24T13:05:00.000Z')
  assert.equal(v2ProjectionBypass.kind, 'failed')

  const v2 = generateCanonicalTestSetV2({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:01.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
  }, 'generation-v2-boundary', 1)
  const decodedV2 = parseCanonicalTestSetV2(v2.json)
  assert.equal(decodedV2.value.schemaVersion, 2)
  assert.ok(decodedV2.value.definitions.every(definition => definition.action?.kind === 'navigate_to_observed_route'))
  assert.ok(decodedV2.value.definitions.every(definition => !('actions' in definition)))
  assert.throws(() => parseCanonicalTestSetV3(v2.json), TestDefinitionContractError)

  const unsupported = structuredClone(v3.value) as any
  unsupported.definitions[0].actions[1].kind = 'fill'
  unsupported.definitions[0].normalizedIntent.steps[1].kind = 'fill'
  assert.throws(() => materializeCanonicalTestSet(unsupported), TestDefinitionContractError)
  const missingArea = structuredClone(v3.value) as any
  delete missingArea.definitions[0].appArea
  assert.throws(() => materializeCanonicalTestSet(missingArea), TestDefinitionContractError)
})

test('M1 generation service re-reads authority and commits the embedded intent through the canonical repository seam', async () => {
  let began = 0
  let committed = 0
  const repository = {
    async beginGeneration() { began++ },
    async commitCanonicalV3Generation(input: any, generationId: string) {
      committed++
      const materialized = generateCanonicalFlowTestSetV3(input, generationId, 1)
      return { rowId: 7, testSet: materialized.value, contentHash: materialized.fingerprint }
    },
    async failGeneration() { throw new Error('must not fail') },
  }
  const service = new CanonicalTestDefinitionGenerationService(
    repository as any,
    { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
    { read: async () => ({ kind: 'ok', evidence: routes() }) } as any,
    { read: () => authentication() } as any,
    () => '2026-08-24T13:00:00.000Z',
    async () => undefined,
    { getModel: async () => model() } as any,
  )
  const result = await service.generateDiscoveredFlow(
    PROJECT,
    WORKSPACE_ROOT,
    { flowId: 'direct-checkout', selectedFlowStepIndexes: [2] },
    'generation-service-m1',
  )
  assert.equal(result.kind, 'committed')
  assert.equal(began, 1)
  assert.equal(committed, 1)
  assert.equal(result.testSet.definitions[0].normalizedIntent?.intentId,
    result.testSet.definitions[0].provenance.intentId)
  assert.deepEqual(result.save, {
    schemaVersion: 3,
    testSetId: result.testSet.testSetId,
    definitionId: result.testSet.definitions[0].id,
    revision: result.testSet.revision,
  })
})

test('M1 generation service returns a refusal before starting persistence for stale uncategorized evidence', async () => {
  let began = 0
  const stale = model()
  stale.pages![0].module = undefined
  const service = new CanonicalTestDefinitionGenerationService(
    { async beginGeneration() { began++ } } as any,
    { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
    { read: async () => ({ kind: 'ok', evidence: routes() }) } as any,
    { read: () => authentication() } as any,
    () => '2026-08-24T13:00:00.000Z',
    async () => undefined,
    { getModel: async () => stale } as any,
  )
  const result = await service.generateDiscoveredFlow(
    PROJECT,
    WORKSPACE_ROOT,
    { flowId: 'direct-checkout', selectedFlowStepIndexes: [2] },
    'generation-refused-m1',
  )
  assert.equal(result.kind, 'refused')
  assert.equal(result.intent.disposition.code, 'app_area_unknown')
  assert.equal(began, 0)
})

test('M1 generation admission collapses unavailable authority, route, and model into the public refusal vocabulary', async () => {
  const selection = { flowId: 'direct-checkout', selectedFlowStepIndexes: [2] as const }
  const services = [
    new CanonicalTestDefinitionGenerationService(
      {} as any,
      { read: async () => ({ kind: 'refused', code: 'missing_active_model' }) } as any,
      {} as any,
      {} as any,
      undefined,
      async () => undefined,
      {} as any,
    ),
    new CanonicalTestDefinitionGenerationService(
      {} as any,
      { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
      { read: async () => ({ kind: 'refused', code: 'route_unknown' }) } as any,
      {} as any,
      undefined,
      async () => undefined,
      {} as any,
    ),
    new CanonicalTestDefinitionGenerationService(
      {} as any,
      { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
      { read: async () => ({ kind: 'ok', evidence: routes() }) } as any,
      { read: () => authentication() } as any,
      undefined,
      async () => undefined,
      { getModel: async () => null } as any,
    ),
  ]
  for (const service of services) {
    const result = await service.readDiscoveredFlowAdmission(PROJECT, WORKSPACE_ROOT, selection)
    assert.equal(result.kind, 'refused')
    assert.equal(result.intent.disposition.code, 'insufficient_evidence')
    assert.ok(NORMALIZED_TEST_INTENT_REFUSAL_CODES.includes(result.intent.disposition.code))
  }
})

function projectedPlan() {
  const normalizedIntent = supportedIntent()
  const testSet = generateCanonicalFlowTestSetV3({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    normalizedIntent,
  }, 'generation-m1', 1)
  const result = projectExecutablePlan({
    definition: testSet.value.definitions[0],
    definitionSchemaVersion: 3,
    definitionTestSetId: testSet.value.testSetId,
    definitionRevision: testSet.value.revision,
    testSetContentHash: testSet.fingerprint,
  }, {
    currentRevision: { revision: 1, testSetId: testSet.value.testSetId, contentHash: testSet.fingerprint },
    sealedAuthority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    activeAppModel: { rowId: 41, modelVersion: '1.0.0', snapshot: model() },
  }, '2026-08-24T14:00:00.000Z')
  assert.equal(result.kind, 'ok')
  return { result, testSet }
}

test('M1 projection preserves exact order, app area, intent provenance, routes, and stale-seal refusal', () => {
  const { result, testSet } = projectedPlan()
  assert.equal(testSet.value.schemaVersion, 3)
  assert.equal(result.plan.value.schemaVersion, 2)
  assert.equal(result.plan.value.category, 'observed_flow')
  assert.equal(result.plan.value.appArea, 'Cart')
  assert.deepEqual(result.plan.value.steps.map(step => step.kind), [
    'navigate_to_observed_route', 'click_observed_data_test',
  ])
  assert.equal(result.plan.value.oracle.routePath, '/checkout-step-one.html')
  assert.equal(result.plan.value.provenance.intentId, testSet.value.definitions[0].provenance.intentId)
  assert.equal(productRunnerAdapterIdentity([result.plan]), 'playwright-plan-executor/v2')

  const stale = authority()
  stale.supportSealHash = 'e'.repeat(64)
  const refused = projectExecutablePlan({
    definition: testSet.value.definitions[0], definitionSchemaVersion: 3,
    definitionTestSetId: testSet.value.testSetId, definitionRevision: 1,
    testSetContentHash: testSet.fingerprint,
  }, {
    currentRevision: { revision: 1, testSetId: testSet.value.testSetId, contentHash: testSet.fingerprint },
    sealedAuthority: stale, routeEvidence: routes(), authenticationExpectation: authentication(),
  }, '2026-08-24T14:00:00.000Z')
  assert.equal(refused.kind, 'failed')
  assert.equal(refused.failure.code, 'support_seal_mismatch')

  const staleRevision = projectExecutablePlan({
    definition: testSet.value.definitions[0], definitionSchemaVersion: 3,
    definitionTestSetId: testSet.value.testSetId, definitionRevision: 1,
    testSetContentHash: testSet.fingerprint,
  }, {
    currentRevision: { revision: 2, testSetId: testSet.value.testSetId, contentHash: testSet.fingerprint },
    sealedAuthority: authority(), routeEvidence: routes(), authenticationExpectation: authentication(),
  }, '2026-08-24T14:00:00.000Z')
  assert.equal(staleRevision.kind, 'failed')
  if (staleRevision.kind !== 'failed') throw new Error('Expected stale v3 revision refusal.')
  assert.equal(staleRevision.failure.code, 'stale_definition')
})

test('M1 canonical presentation exposes app area, intent provenance, selected segment, and both governed routes', () => {
  const { testSet } = projectedPlan()
  const v2 = generateCanonicalTestSetV2({
    projectId: PROJECT,
    generatedAt: '2026-08-24T12:30:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
  }, 'generation-v2-history', 1)
  const presented = new TestCasePresentationService().present({
    current: {
      rowId: 9,
      contentHash: testSet.fingerprint,
      testSet: testSet.value,
      startedAt: testSet.value.generatedAt,
      completedAt: testSet.value.generatedAt,
      temporalIntegrity: 'verified',
      temporalCode: null,
      temporalExplanation: 'The persisted generation lifecycle timestamps are ordered.',
    },
    history: [{
      rowId: 8,
      testSetId: v2.value.testSetId,
      revision: 1,
      generationId: v2.value.generationId,
      generatedAt: v2.value.generatedAt,
      outcome: v2.value.outcome,
      schemaVersion: 2,
      sourceObservationId: null,
      modelRowId: v2.value.canonicalSupport.modelRowId,
      modelVersion: v2.value.canonicalSupport.modelVersion,
      observationRunId: v2.value.canonicalSupport.observationRunId,
      supportSealHash: v2.value.canonicalSupport.supportSealHash,
      definitionCount: v2.value.definitions.length,
      contentHash: v2.fingerprint,
      startedAt: v2.value.generatedAt,
      completedAt: v2.value.generatedAt,
      temporalIntegrity: 'verified',
      temporalCode: null,
      temporalExplanation: 'verified',
    }],
    total: 2,
    nextCursor: null,
    requestedDefinition: null,
  })
  assert.equal(presented.current?.testSet.schemaVersion, 3)
  if (presented.current?.testSet.schemaVersion !== 3) throw new Error('Expected canonical v3 presentation.')
  const definition = presented.current.testSet.definitions[0]
  assert.equal(definition.category, 'observed_flow')
  assert.equal(definition.appArea, 'Cart')
  assert.equal(definition.provenance.intentId, definition.normalizedIntent?.intentId)
  assert.equal(definition.routeEvidence.state, 'available_flow')
  if (definition.routeEvidence.state !== 'available_flow') throw new Error('Expected governed flow routes.')
  assert.deepEqual(definition.routeEvidence.routes.map(route => route.normalizedPath), [
    '/cart.html', '/checkout-step-one.html',
  ])
  assert.deepEqual(definition.actions.map(action => action.kind), [
    'navigate_to_observed_route', 'click_observed_data_test',
  ])
  assert.equal(presented.history[0].schemaVersion, 2)
  assert.equal(presented.history[0].authorityClass, 'canonical_v2')
})

test('M1 existing Product execution preflight admits the current sealed observed-flow definition', async () => {
  const { testSet } = projectedPlan()
  const service = new ExecutionService({
    definitions: { readInventory: async () => ({
      current: {
        rowId: 9, contentHash: testSet.fingerprint, testSet: testSet.value,
        startedAt: testSet.value.generatedAt, completedAt: testSet.value.generatedAt,
        temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'verified',
      },
      history: [], total: 1, nextCursor: null, requestedDefinition: null,
    }) } as any,
    authorityProjection: { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
    routeProjection: { read: async () => ({ kind: 'ok', evidence: routes() }) } as any,
    authenticationProjection: { read: () => authentication() } as any,
    appModels: { getActiveCommitted: async () => ({
      rowId: 41, appName: PROJECT, status: 'active', snapshot: model(),
    }) } as any,
    credentials: { isAvailable: () => true } as any,
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'ready' }),
  })
  const request: any = {
    projectId: PROJECT,
    executionIntentKey: 'm1-preflight',
    definitionIds: [testSet.value.definitions[0].id],
    revision: 1,
    workspaceRoot: WORKSPACE_ROOT,
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
    runtime: { baseUrl: 'https://m1.example.test' },
    clientDefinitionPayload: { schemaVersion: 3, actions: [{ kind: 'fill' }] },
  }
  const result = await service.preflight(request)
  assert.equal(result.kind, 'ready')
  if (result.kind !== 'ready') throw new Error('Expected ready M1 preflight.')
  assert.equal(result.plans[0].value.category, 'observed_flow')
  assert.equal(result.definitionResults[0].schemaVersion, 3)
  assert.deepEqual(result.definitionResults[0].actions, ['navigate_to_observed_route', 'click_observed_data_test'])

  const bypass = await service.preflight({ ...request, definitionIds: ['client-only-definition'] })
  assert.equal(bypass.kind, 'rejected')
  if (bypass.kind !== 'rejected') throw new Error('Expected canonical inventory bypass refusal.')
  assert.equal(bypass.code, 'stale_definition')
})

function preflightInventory(testSet: ReturnType<typeof generateCanonicalFlowTestSetV3>) {
  return {
    current: {
      rowId: 9, contentHash: testSet.fingerprint, testSet: testSet.value,
      startedAt: testSet.value.generatedAt, completedAt: testSet.value.generatedAt,
      temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'verified',
    },
    history: [], total: 1, nextCursor: null, requestedDefinition: null,
  }
}

function preflightRequest(testSet: ReturnType<typeof generateCanonicalFlowTestSetV3>) {
  return {
    projectId: PROJECT,
    executionIntentKey: 'm1-current-model-preflight',
    definitionIds: [testSet.value.definitions[0].id],
    revision: testSet.value.revision,
    workspaceRoot: WORKSPACE_ROOT,
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
    runtime: { baseUrl: 'https://m1.example.test' },
  }
}

function preflightService(
  testSet: ReturnType<typeof generateCanonicalFlowTestSetV3>,
  currentModel: AppModel,
  options: {
    currentAuthority?: CanonicalTestDefinitionAuthority
    currentRoutes?: CanonicalRouteEvidence
    currentAuthentication?: AuthenticationExpectationProjection
    activeRowId?: number
  } = {},
) {
  const currentAuthority = options.currentAuthority ?? authority()
  return new ExecutionService({
    definitions: { readInventory: async () => preflightInventory(testSet) } as any,
    authorityProjection: { read: async () => ({ kind: 'ok', authority: currentAuthority }) } as any,
    routeProjection: { read: async () => ({ kind: 'ok', evidence: options.currentRoutes ?? routes() }) } as any,
    authenticationProjection: { read: () => options.currentAuthentication ?? authentication() } as any,
    appModels: { getActiveCommitted: async () => ({
      rowId: options.activeRowId ?? currentAuthority.modelRowId,
      appName: PROJECT,
      status: 'active',
      snapshot: currentModel,
    }) } as any,
    credentials: { isAvailable: () => true } as any,
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'ready' }),
  })
}

test('M1 v3 preflight blocks every hostile active App Model semantic drift without mutating the Definition', async () => {
  const normalizedIntent = supportedIntent()
  const testSet = generateCanonicalFlowTestSetV3({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    normalizedIntent,
  }, 'generation-current-model-hostile', 1)
  const persistedBytes = JSON.stringify(testSet.value)
  const cases: Array<[string, (current: AppModel) => void, string]> = [
    ['source flow removed', current => { current.flows = [] }, 'stale_definition'],
    ['selected step changed', current => { current.flows![0].steps[1].action = 'fill' }, 'stale_definition'],
    ['selected flow steps reordered', current => { current.flows![0].steps.reverse() }, 'conflicting_evidence'],
    ['selected step inferred', current => { current.flows![0].steps[1].grounding = 'inferred' }, 'stale_definition'],
    ['entry subject removed', current => { current.pages!.shift() }, 'stale_definition'],
    ['outcome subject removed', current => { current.pages!.pop() }, 'stale_definition'],
    ['app area changed', current => { current.pages![0].module!.name = 'Checkout' }, 'stale_definition'],
    ['app area unknown', current => { current.pages![0].module = undefined }, 'stale_definition'],
    ['app area classification ambiguous', current => { current.pages![0].module!.confidence = 'unknown' }, 'stale_definition'],
    ['data-test changed', current => { current.pages![0].elements[0].strategies[0].value = 'continue' }, 'stale_definition'],
    ['element removed', current => { current.pages![0].elements = [] }, 'stale_definition'],
    ['element cardinality ambiguous', current => { current.pages![0].elements[0].cardinality = { kind: 'repeated', index: 0 } }, 'stale_definition'],
    ['authentication no longer established', current => { current.roles[0].authOutcome = 'failed' }, 'stale_definition'],
  ]
  for (const [label, mutate, expectedCode] of cases) {
    const current = model()
    mutate(current)
    const result = await preflightService(testSet, current).preflight(preflightRequest(testSet))
    assert.equal(result.kind, 'rejected', label)
    if (result.kind !== 'rejected') throw new Error(`Expected ${label} to be rejected.`)
    assert.equal(result.code, expectedCode, label)
    assert.equal(JSON.stringify(testSet.value), persistedBytes, `${label} mutated the persisted v3 Definition`)
  }
})

test('M1 v3 preflight blocks active revision, support seal, and authentication authority drift', async () => {
  const testSet = generateCanonicalFlowTestSetV3({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
    normalizedIntent: supportedIntent(),
  }, 'generation-current-authority-hostile', 1)
  const revisedAuthority = authority()
  revisedAuthority.modelRowId = 42
  revisedAuthority.modelVersion = '2.0.0'
  revisedAuthority.supportSealHash = 'e'.repeat(64)
  const revisedRoutes = routes()
  revisedRoutes.modelRowId = 42
  revisedRoutes.supportSealHash = revisedAuthority.supportSealHash
  const revisedModel = model()
  revisedModel.app.modelVersion = '2.0.0'
  const revised = await preflightService(testSet, revisedModel, {
    currentAuthority: revisedAuthority,
    currentRoutes: revisedRoutes,
    activeRowId: 42,
  }).preflight(preflightRequest(testSet))
  assert.equal(revised.kind, 'rejected')
  if (revised.kind !== 'rejected') throw new Error('Expected active revision drift refusal.')
  assert.equal(revised.code, 'support_seal_mismatch')

  const staleSealAuthority = authority()
  staleSealAuthority.supportSealHash = 'f'.repeat(64)
  const staleSealRoutes = routes()
  staleSealRoutes.supportSealHash = staleSealAuthority.supportSealHash
  const staleSeal = await preflightService(testSet, model(), {
    currentAuthority: staleSealAuthority,
    currentRoutes: staleSealRoutes,
  }).preflight(preflightRequest(testSet))
  assert.equal(staleSeal.kind, 'rejected')
  if (staleSeal.kind !== 'rejected') throw new Error('Expected stale support seal refusal.')
  assert.equal(staleSeal.code, 'support_seal_mismatch')

  const incoherent = await preflightService(testSet, model(), { activeRowId: 42 })
    .preflight(preflightRequest(testSet))
  assert.equal(incoherent.kind, 'rejected')
  if (incoherent.kind !== 'rejected') throw new Error('Expected incoherent active snapshot refusal.')
  assert.equal(incoherent.code, 'conflicting_evidence')

  const missingRouteEvidence = routes()
  missingRouteEvidence.subjects.pop()
  const missingRoute = await preflightService(testSet, model(), { currentRoutes: missingRouteEvidence })
    .preflight(preflightRequest(testSet))
  assert.equal(missingRoute.kind, 'rejected')
  if (missingRoute.kind !== 'rejected') throw new Error('Expected missing current outcome route refusal.')
  assert.equal(missingRoute.code, 'route_unknown')

  const changedRouteEvidence = routes()
  changedRouteEvidence.subjects[1].normalizedPath = '/checkout-step-two.html'
  const changedRoute = await preflightService(testSet, model(), { currentRoutes: changedRouteEvidence })
    .preflight(preflightRequest(testSet))
  assert.equal(changedRoute.kind, 'rejected')
  if (changedRoute.kind !== 'rejected') throw new Error('Expected changed current outcome route refusal.')
  assert.equal(changedRoute.code, 'stale_definition')

  for (const state of ['unknown', 'conflicted'] as const) {
    const currentAuthentication: AuthenticationExpectationProjection = {
      schemaVersion: 'forge-authentication-expectation/v1',
      state,
      mechanism: null,
      bases: [],
      identityHash: AUTH_HASH,
    }
    const result = await preflightService(testSet, model(), { currentAuthentication })
      .preflight(preflightRequest(testSet))
    assert.equal(result.kind, 'rejected', state)
    if (result.kind !== 'rejected') throw new Error(`Expected ${state} authentication refusal.`)
    assert.equal(result.code, state === 'unknown' ? 'authentication_unknown' : 'authentication_conflicted')
  }
})

test('M1 v2 navigation preflight remains executable without reading active flow semantics', async () => {
  const v2 = generateCanonicalTestSetV2({
    projectId: PROJECT,
    generatedAt: '2026-08-24T13:00:00.000Z',
    authority: authority(),
    routeEvidence: routes(),
    authenticationExpectation: authentication(),
  }, 'generation-v2-preflight-regression', 1)
  let activeModelReads = 0
  const service = new ExecutionService({
    definitions: { readInventory: async () => ({
      current: {
        rowId: 10, contentHash: v2.fingerprint, testSet: v2.value,
        startedAt: v2.value.generatedAt, completedAt: v2.value.generatedAt,
        temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'verified',
      },
      history: [], total: 1, nextCursor: null, requestedDefinition: null,
    }) } as any,
    authorityProjection: { read: async () => ({ kind: 'ok', authority: authority() }) } as any,
    routeProjection: { read: async () => ({ kind: 'ok', evidence: routes() }) } as any,
    authenticationProjection: { read: () => authentication() } as any,
    appModels: { getActiveCommitted: async () => { activeModelReads++; throw new Error('v2 must not read flow semantics') } } as any,
    credentials: { isAvailable: () => true } as any,
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'ready' }),
  })
  const result = await service.preflight({
    projectId: PROJECT,
    executionIntentKey: 'm1-v2-regression',
    definitionIds: [v2.value.definitions[0].id],
    revision: 1,
    workspaceRoot: WORKSPACE_ROOT,
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
    runtime: { baseUrl: 'https://m1.example.test' },
  })
  assert.equal(result.kind, 'ready')
  assert.equal(activeModelReads, 0)
})

class Resolver implements CredentialExecutionScope {
  isAvailable(): boolean { return true }
  async run<T>(_reference: unknown, operation: (material: CredentialMaterial) => Promise<T>) {
    return { kind: 'completed' as const, value: await operation({ username: 'fixture-user', password: 'fixture-password' }) }
  }
  runProvided<T>(material: { username: string; password: string }, operation: (material: CredentialMaterial) => Promise<T>): Promise<T> {
    return operation(material)
  }
}

function flowSession(options: { clickFails?: boolean; finalPath?: string } = {}) {
  const state = { currentUrl: '', clicks: [] as string[], closed: false }
  const factory: ExecutionSessionFactory = async () => ({
    async authenticateFormLogin() { return true },
    async navigate(url) { state.currentUrl = url },
    async clickDataTest(value) {
      state.clicks.push(value)
      if (options.clickFails) throw new Error('withheld')
      state.currentUrl = `https://m1.example.test${options.finalPath ?? '/checkout-step-one.html'}`
      return 'one' as const
    },
    currentUrl() { return state.currentUrl },
    async close() { state.closed = true },
  })
  return { state, factory }
}

test('M1 executor distinguishes completed, action failure, and Product oracle failure truth', async () => {
  const { result } = projectedPlan()
  const plan = result.plan.value
  const completeSession = flowSession()
  const completed = await new PlaywrightPlanExecutor(new Resolver(), completeSession.factory).execute(plan, {
    baseUrl: 'https://m1.example.test',
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
  })
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completeSession.state.clicks, ['checkout'])
  assert.equal(productResultTruth(completed).outcome, 'passed')

  const actionSession = flowSession({ clickFails: true })
  const actionFailed = await new PlaywrightPlanExecutor(new Resolver(), actionSession.factory).execute(plan, {
    baseUrl: 'https://m1.example.test',
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
  })
  assert.deepEqual(actionFailed, {
    status: 'action_failed', reasonCode: 'action_failed', navigationUrl: 'https://m1.example.test/cart.html',
  })
  assert.deepEqual(productResultTruth(actionFailed), { outcome: 'could_not_verify', reasonCode: 'action_failed' })

  const oracleSession = flowSession({ finalPath: '/cart.html' })
  const oracleFailed = await new PlaywrightPlanExecutor(new Resolver(), oracleSession.factory).execute(plan, {
    baseUrl: 'https://m1.example.test',
    credentialReference: { usernameEnv: 'M1_USER', passwordEnv: 'M1_PASSWORD' },
  })
  assert.equal(oracleFailed.status, 'oracle_failed')
  assert.deepEqual(productResultTruth(oracleFailed), { outcome: 'failed', reasonCode: 'oracle_failed' })
  assert.equal(oracleSession.state.closed, true)
})
