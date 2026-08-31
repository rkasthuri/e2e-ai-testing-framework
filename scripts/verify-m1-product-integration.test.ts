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

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'
import { closeDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationBoundary } from '../src/core/observation/ObservationTypes'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { TestCasePresentationService } from '../src/core/test-design/TestCasePresentationService'
import { ExecutionService } from '../src/core/execution/ExecutionService'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { ExecutionResultProjectionService } from '../src/core/execution/ExecutionResultProjectionService'
import { isSupportedNormalizedTestIntentV1 } from '../forge-ui/src/api/m1TestIntentContract'
import { decodeTestInventoryResponse } from '../forge-ui/src/api/testInventoryContract'
import { decodeCanonicalExecutionPreflight } from '../forge-ui/src/api/executionPreflightContract'
import {
  decodeCanonicalExecutionResultsDetail,
  serializeCanonicalExecutionResultsRead,
} from '../forge-ui/src/api/resultsContract'
import { loadM1CertificationCase } from './m1-certification/fixture-loader'
import { ProductM1CertificationDriver, type ProductAcceptedV3Observation } from './m1-certification/product-driver'
import { assertM1CertificationPassed, certifyM1Case } from './m1-certification/suite'
import type { M1CertificationCase, M1CertificationStep, M1FinalOracle } from './m1-certification/driver'

const PROJECT = 'project-storefront'
const START = '2026-08-24T16:00:00.000Z'
const END = '2026-08-24T16:00:01.000Z'
const CREDENTIAL_REFERENCE = { usernameEnv: 'M1_PRODUCT_USER', passwordEnv: 'M1_PRODUCT_PASSWORD' }

function boundary(scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' }): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1', kind: 'document', scope,
    startedAt: START, endedAt: END, completion: 'complete', policyId: 'forge.m1-product-integration', policyVersion: '1',
  }
}

function candidate(runId: string): AppModelCandidate {
  return {
    schemaVersion: '2.0', generatedAt: END, generatedBy: 'engine', classificationRunId: runId,
    app: {
      name: PROJECT, displayName: 'Storefront', baseUrl: 'https://m1.example.test', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'm1-product-integration', crawledAt: END, crawledBy: 'engine', crawlDurationMs: 1000,
        pagesBudget: 2, pagesDiscovered: 2, pagesSkipped: 0, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: 'M1_PRODUCT_CREDENTIALS',
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout-step-one'], restrictedPageIds: [],
      authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'subject-cart', displayName: 'Cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: 'cart-dom', fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'],
      isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'], source: 'evidence-matched', reason: 'Observed checkout control.' },
      elements: [{
        id: 'subject-checkout-control', name: 'checkout', kind: 'button', label: 'Checkout', critical: true,
        aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }], tier3Assertions: [],
        cardinality: { kind: 'single' }, observedState: 'visible', href: null,
      }],
    }, {
      id: 'subject-checkout-step-one', displayName: 'Checkout information', urlPattern: '/checkout-step-one.html',
      urlPatternType: 'exact', fingerprint: 'checkout-dom', fingerprintBasis: 'url+dom-hash', appType: 'web-ui',
      accessibleByRoles: ['shopper'], isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout-step-one'], source: 'evidence-matched', reason: 'Observed checkout destination.' },
      elements: [],
    }],
    flows: [{
      id: 'flow-cart-checkout-step-one', displayName: 'Open checkout from the observed cart control', confidence: 'partial',
      source: 'agent-proposed', roleId: 'shopper', linkedApiEndpointIds: [],
      steps: [{ stepIndex: 0, pageId: 'home', action: 'assert-navigation', elementId: null, targetPageId: 'subject-cart', value: null, grounding: 'inferred' },
        { stepIndex: 1, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control', targetPageId: 'subject-checkout-step-one', value: null, grounding: 'observed' }],
      groundingWarnings: ['The unobserved entry step remains excluded.'],
    }],
    endpoints: null, api: null, diff: null,
  }
}

function semanticSteps(intent: any): M1CertificationStep[] {
  return intent.steps.map((step: any) => ({ ...step }))
}

function finalOracle(intent: any): M1FinalOracle {
  const outcome = intent.expectedOutcomes[0]
  return { kind: 'subject_observable', subjectId: outcome.subjectId, routePath: outcome.routePath }
}

function productCase(base: M1CertificationCase, observationIds: string[]): M1CertificationCase {
  const value = structuredClone(base)
  value.input.appModel.supportObservationIds = [...observationIds].sort()
  return value
}

test('real Product authority completes app-area selection through immutable Result and earns the Product verdict', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m1-product-integration-'))
  const workspace = createWorkspace(root)
  try {
    await openProjectDatabase(workspace)
    fs.writeFileSync(path.join(workspace.forgeDir, 'config.json'), JSON.stringify({ schemaVersion: 1, appName: PROJECT, authType: 'form-login' }))

    const observations = new ObservationService(PROJECT, root, { producerInstanceId: '55555555-5555-4555-8555-555555555555' })
    const run = await observations.startRun({
      operationId: 'm1-product-observation', producer: 'forge.crawler', producerVersion: '1', acquisitionKind: 'web_crawl',
      startedAt: START, policyId: 'forge.m1-product-acquisition', policyVersion: '1', acquisitionPlan: { target: 'https://m1.example.test' },
    })
    const record = (subjectId: string, predicate: string, observedValue: unknown, key: string, scope?: Record<string, unknown>) => observations.recordObservation({
      observationRunId: run.value.observationRunId, projectId: PROJECT, producer: 'forge.crawler', producerVersion: '1',
      method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
      subjectId, predicate, outcome: 'present', observedValue, boundary: boundary(scope), capturedAt: END, idempotencyKey: key,
    })
    const cartRoute = await record('subject-cart', 'page.discovered', { urlPattern: '/cart.html', elementCount: 1, fingerprint: 'cart-dom' }, 'cart-route')
    const checkoutControl = await record('subject-cart', 'control.present', null, 'checkout-control', { route: '/cart.html' })
    const checkoutRoute = await record('subject-checkout-step-one', 'page.discovered', { urlPattern: '/checkout-step-one.html', elementCount: 0, fingerprint: 'checkout-dom' }, 'checkout-route')
    await observations.terminalizeRun({ observationRunId: run.value.observationRunId, lifecycle: 'completed', completeness: 'complete', terminalAt: END, safeReasonCode: null, safeMessage: null })

    const observationIds = [cartRoute.value.observationId, checkoutControl.value.observationId, checkoutRoute.value.observationId]
    await new AppModelRepository().commitCandidate(candidate(run.value.observationRunId), 'm1-product-model', {
      projectId: PROJECT, observationRunId: run.value.observationRunId,
      observations: observationIds.map((observationId, index) => ({ observationId, claimKey: `m1.claim.${index}`, supportRole: 'basis' as const })),
      subjects: [
        { canonicalSubjectId: 'subject-cart', observationId: cartRoute.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
        { canonicalSubjectId: 'subject-cart', observationId: checkoutControl.value.observationId, claimKey: 'subject.control', supportRole: 'basis' },
        { canonicalSubjectId: 'subject-checkout-step-one', observationId: checkoutRoute.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
      ],
      gaps: [], characterizationPolicyId: 'forge.crawl-observation-characterization', characterizationPolicyVersion: '1', linkedAt: END,
    })

    const generation = new CanonicalTestDefinitionGenerationService()
    const areas = await generation.listDiscoveredAreas(PROJECT, root)
    assert.deepEqual(areas.map(area => [area.appArea, area.availability]), [['checkout', 'available']])
    const generated = await generation.generateDiscoveredIntent(PROJECT, root, 'checkout')
    assert.equal(isSupportedNormalizedTestIntentV1(generated), true)
    if (!isSupportedNormalizedTestIntentV1(generated)) throw new Error('Product did not expose a supported M1 intent.')

    const saved = await generation.saveReviewedDiscoveredIntent(PROJECT, root, generated, '11111111-1111-4111-8111-111111111111')
    const replay = await generation.saveReviewedDiscoveredIntent(PROJECT, root, generated, '22222222-2222-4222-8222-222222222222')
    assert.deepEqual(replay, saved)
    const repository = new TestSetRepository()
    const beforeConflict = await repository.readInventory(PROJECT, { limit: 5 })
    await assert.rejects(
      generation.saveReviewedDiscoveredIntent(PROJECT, root, { ...generated, title: `${generated.title} changed after review` }, '33333333-3333-4333-8333-333333333333'),
      (error: any) => error?.code === 'AUTHORITY_MISMATCH',
    )
    assert.deepEqual(await repository.readInventory(PROJECT, { limit: 5 }), beforeConflict)

    const inventory = await repository.readInventory(PROJECT, { limit: 5 })
    assert.equal('kind' in inventory, false)
    if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3) throw new Error('Canonical v3 inventory was not persisted.')
    const definition = inventory.current.testSet.definitions[0]
    const presentation = await new TestCasePresentationService(repository).read(PROJECT, { limit: 5, definitionId: definition.id })
    const decodedInventory = decodeTestInventoryResponse(presentation)
    assert.equal(decodedInventory.current?.testSet.schemaVersion, 3)

    const credentials = new EnvironmentCredentialExecutionScope({ M1_PRODUCT_USER: 'shopper', M1_PRODUCT_PASSWORD: 'secret' })
    let currentUrl = 'https://m1.example.test/login'
    const createSession: ExecutionSessionFactory = async () => ({
      authenticateFormLogin: async () => { currentUrl = 'https://m1.example.test/'; return true },
      navigate: async url => { currentUrl = url },
      clickDataTest: async value => { assert.equal(value, 'checkout'); currentUrl = 'https://m1.example.test/checkout-step-one.html'; return 'one' as const },
      currentUrl: () => currentUrl,
      close: async () => undefined,
    })
    const execution = new ExecutionService({
      credentials, executor: new PlaywrightPlanExecutor(credentials, createSession),
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Integration session is ready.' }),
      processInstanceId: 'process-m1-product-integration',
    })
    const request = {
      projectId: PROJECT, executionIntentKey: 'm1-product-execution', definitionIds: [definition.id],
      revision: inventory.current.testSet.revision, workspaceRoot: root, credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m1.example.test', loginUrl: 'https://m1.example.test/login' },
    }
    const preflight = await execution.preflight(request)
    assert.equal(preflight.kind, 'ready')
    if (preflight.kind !== 'ready') throw new Error('Product preflight refused.')
    const uiPreflight = decodeCanonicalExecutionPreflight({
      project: { id: PROJECT, name: PROJECT },
      testSetRevision: { revision: preflight.current.testSet.revision, testSetId: preflight.current.testSet.testSetId, schemaVersion: preflight.current.testSet.schemaVersion, contentHash: preflight.current.contentHash },
      definitionResults: preflight.definitionResults,
      aggregate: { state: 'ready', explanation: 'Core revalidated current authority.' },
      liveEligibility: { state: 'eligible', runner: 'available', credentials: 'available' },
      boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
    }, { projectId: PROJECT, definitionIds: [definition.id], revision: inventory.current.testSet.revision })
    assert.equal(uiPreflight.aggregate.state, 'ready')
    const stale = await execution.preflight({ ...request, revision: request.revision + 1 })
    assert.deepEqual(stale, { kind: 'rejected', code: 'stale_definition', safeMessage: 'The requested Test Set revision is no longer current.' })

    const resultProjection = new ExecutionResultProjectionService()
    assert.deepEqual(await resultProjection.read(PROJECT, 'execution-not-admitted'), { kind: 'not_found' })
    const started = await execution.start(request)
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('Product execution refused.')
    await started.completion
    const resultRead = await resultProjection.read(PROJECT, started.executionId)
    assert.equal(resultRead.kind, 'ok')
    if (resultRead.kind !== 'ok' || !resultRead.projection.run) throw new Error('Immutable Product Result projection is unavailable.')
    const projected = resultRead.projection
    const projectedRun = projected.run
    if (!projectedRun) throw new Error('Product Run projection is unavailable.')
    const item = projected.items[0]
    if (item.result.state !== 'result_observed') throw new Error('Product Result evidence was not persisted.')
    assert.equal(projected.headlineOutcome, 'passed')
    assert.equal(item.result.reasonCode, 'completed')
    assert.equal(item.result.observedSubjectId, 'subject-checkout-step-one')
    const transportedRead = serializeCanonicalExecutionResultsRead(resultRead)
    assert.equal(transportedRead.kind, 'ok')
    if (transportedRead.kind !== 'ok') throw new Error('Canonical v3 Product Result did not cross the Results API boundary.')
    const clientFacingResult = decodeCanonicalExecutionResultsDetail(structuredClone(transportedRead.projection))
    assert.equal(clientFacingResult.execution.definitionAuthority.schemaVersion, 3)
    assert.equal(clientFacingResult.execution.lifecycle, projected.execution.lifecycle)
    assert.equal(clientFacingResult.execution.terminalOutcome, projected.execution.outcome)
    assert.equal(clientFacingResult.execution.authorityReasonCode, projected.execution.reasonCode)
    assert.equal(clientFacingResult.run?.evidenceOutcome, projectedRun.outcome)
    assert.equal(clientFacingResult.run?.evidenceReasonCode, projectedRun.reasonCode)
    assert.equal(clientFacingResult.items[0].evidence.kind, 'observed_result')
    if (clientFacingResult.items[0].evidence.kind !== 'observed_result') throw new Error('Transport lost Product Result evidence.')
    assert.equal(clientFacingResult.items[0].evidence.resultId, item.result.resultId)
    assert.equal(clientFacingResult.items[0].evidence.reasonCode, item.result.reasonCode)
    assert.equal(clientFacingResult.items[0].evidence.observedSubjectId, item.result.observedSubjectId)

    const fixture = productCase(loadM1CertificationCase('end-to-end-case.json'), observationIds)
    const productObservation: ProductAcceptedV3Observation = {
      kind: 'accepted_v3', scenarioId: fixture.caseId,
      stages: ['observation', 'app_model', 'intent', 'definition', 'plan', 'execution', 'run', 'result'],
      intent: generated,
      testSet: { value: inventory.current.testSet, contentHash: inventory.current.contentHash },
      plan: { value: preflight.plans[0].value, semanticHash: preflight.plans[0].fingerprint },
      execution: { executionId: started.executionId, lifecycle: 'completed', infrastructureOutcome: 'completed' },
      run: { runId: projectedRun.runId, executionId: started.executionId, lifecycle: 'completed' },
      result: {
        resultId: item.result.resultId, runId: projectedRun.runId, outcome: item.result.outcome,
        reasonCode: 'completed', durationMs: item.result.durationMs, oracleKind: item.result.oracleKind,
        observedSubjectId: item.result.observedSubjectId,
      },
      ui: {
        state: 'generated_review', appArea: generated.appArea.id, steps: semanticSteps(generated),
        finalOracle: finalOracle(generated), canRun: uiPreflight.aggregate.state === 'ready', backendContractVersion: 3,
      },
      mutationObservations: [],
      compatibility: {
        v2: { schemaVersion: 2, semantics: 'navigation_only', executable: true, silentlyUpgraded: false },
        v1: { schemaVersion: 1, readable: true, executable: false, quarantine: true, silentlyUpgraded: false },
      },
    }
    const report = await certifyM1Case(new ProductM1CertificationDriver({ observe: async () => productObservation }), fixture)
    assertM1CertificationPassed(report)

    const hostileCases: Array<[string, (observation: any) => void]> = [
      ['Definition action mutation', observation => { observation.testSet.value.definitions[0].actions[1].dataTestValue = 'continue' }],
      ['Plan order mutation', observation => { observation.plan.value.steps.reverse() }],
      ['Result linkage mutation', observation => { observation.result.runId = 'run-without-product-execution' }],
    ]
    for (const [label, mutate] of hostileCases) {
      await t.test(`Product driver rejects ${label}`, async () => {
        const hostile = structuredClone(productObservation)
        mutate(hostile)
        const hostileReport = await certifyM1Case(new ProductM1CertificationDriver({ observe: async () => hostile }), fixture)
        assert.equal(hostileReport.passed, false)
        assert.ok(hostileReport.findings.length > 0)
      })
    }
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
