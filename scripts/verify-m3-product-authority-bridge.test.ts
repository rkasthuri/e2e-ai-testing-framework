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
import test from 'node:test'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationBoundary } from '../src/core/observation/ObservationTypes'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { DatabaseAuthorityMode } from '../src/core/storage/DatabaseAuthority'
import { closeDb, getDatabaseProvenance } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  ManualPromotionCertificationFault,
  ManualTestCertificationPersistenceAdapter,
} from '../src/core/storage/certification/ManualTestCertificationPersistenceAdapter'
import {
  ExecutionContext,
  M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN,
} from '../forge-ui/server/context/ExecutionContext'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import { analyzeManualTest, saveManualTest } from '../forge-ui/server/context/ManualTestController'
import { ProductM3CertificationDriver, type ProductControllerSaveObservation, type ProductM3ObservationPort } from './m3-certification/product-driver'
import { ManualTestSourceRepository } from '../src/core/storage/repositories/ManualTestSourceRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { SuiteService } from '../src/core/suites/SuiteService'
import { ExecutionService } from '../src/core/execution/ExecutionService'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { ExecutionResultProjectionService } from '../src/core/execution/ExecutionResultProjectionService'
import { TestCasePresentationService } from '../src/core/test-design/TestCasePresentationService'
import { loadSharedContracts } from './m3-certification/fixture-loader'
import { certifyGolden } from './m3-certification/suite'
import type {
  AnalyzeRequest,
  AnalyzeResult,
  CertificationPersistenceInventory,
  DefinitionAuthority,
  DefinitionObservation,
  DefinitionPresentation,
  M2Candidate,
  ManualPromotionResultV1,
  ManualTestSourceV1,
  ResultsObservation,
} from './m3-certification/driver'

const PROJECT = 'project-storefront'
const START = '2026-08-28T12:00:00.000Z'
const END = '2026-08-28T12:00:01.000Z'
const CREDENTIAL_REFERENCE = { usernameEnv: 'M3_PRODUCT_USER', passwordEnv: 'M3_PRODUCT_PASSWORD' }
const SOURCE_INPUT = {
  schemaVersion: 'forge-manual-test-source-input/v1' as const,
  sourceKind: 'manual' as const,
  title: 'Checkout from cart',
  objective: 'Proceed from cart to checkout.',
  steps: [{ ordinal: 1, text: 'Open the cart page.' }, { ordinal: 2, text: 'Click the Checkout button.' }],
  expectedOutcome: 'Checkout information page is displayed.',
}

function boundary(scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' }): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1', kind: 'document', scope,
    startedAt: START, endedAt: END, completion: 'complete',
    policyId: 'forge.m3-product-bridge', policyVersion: '1',
  }
}

function candidate(runId: string): AppModelCandidate {
  return {
    schemaVersion: '2.0', generatedAt: END, generatedBy: 'engine', classificationRunId: runId,
    app: {
      name: PROJECT, displayName: 'Storefront', baseUrl: 'https://m3.example.test', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled', crawlMetadata: {
        crawlConfigHash: 'm3-product-bridge', crawledAt: END, crawledBy: 'engine', crawlDurationMs: 1000,
        pagesBudget: 2, pagesDiscovered: 2, pagesSkipped: 0, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: 'M3_PRODUCT_CREDENTIALS',
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout-step-one'], restrictedPageIds: [],
      authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'subject-cart', displayName: 'cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: 'cart-dom', fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'],
      isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'], source: 'evidence-matched', reason: 'Observed checkout control.' },
      elements: [{
        id: 'subject-checkout-control', name: 'Checkout', kind: 'button', label: 'Checkout', critical: true,
        aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }], tier3Assertions: [],
        cardinality: { kind: 'single' }, observedState: 'visible', href: null,
      }],
    }, {
      id: 'subject-checkout-step-one', displayName: 'Checkout information', urlPattern: '/checkout-step-one.html',
      urlPatternType: 'exact', fingerprint: 'checkout-dom', fingerprintBasis: 'url+dom-hash', appType: 'web-ui',
      accessibleByRoles: ['shopper'], isAuthPage: false, elements: [],
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout-step-one'], source: 'evidence-matched', reason: 'Observed checkout destination.' },
    }],
    flows: [{
      id: 'flow-cart-checkout', displayName: 'Cart checkout', confidence: 'observed', source: 'agent-proposed',
      roleId: 'shopper', linkedApiEndpointIds: [], steps: [{
        stepIndex: 7, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control',
        targetPageId: 'subject-checkout-step-one', value: null, grounding: 'observed',
      }], groundingWarnings: [],
    }],
    endpoints: null, api: null, diff: null,
  }
}

function classificationDriver(observation: ProductControllerSaveObservation): ProductM3CertificationDriver {
  return new ProductM3CertificationDriver({
    saveReviewedProposal: async () => observation,
  } as unknown as ProductM3ObservationPort)
}

async function classifyObservation(observation: ProductControllerSaveObservation): Promise<unknown> {
  const driver = classificationDriver(observation)
  try {
    await driver.saveReviewedProposal({})
  } catch (cause) {
    return driver.classifySaveFailure(cause)
  }
  return null
}

class RealM3ProductPort implements ProductM3ObservationPort {
  private scenario: string | null = null
  private readonly sources = new ManualTestSourceRepository()
  private readonly testSets = new TestSetRepository()
  private readonly suites = new SuiteService()
  private readonly results = new ExecutionResultProjectionService()
  private readonly executionAuthorities = new Map<string, DefinitionAuthority>()

  constructor(
    private readonly root: string,
    private readonly harness: Awaited<ReturnType<typeof ExecutionContext.createM3CertificationHarness>>,
    private readonly execution: ExecutionService,
  ) {}

  async configureCertificationScenario(scenario: string | null): Promise<void> {
    this.scenario = scenario
  }

  async snapshot(projectId: string): Promise<CertificationPersistenceInventory> {
    return structuredClone(await this.harness.persistence.snapshot(projectId)) as CertificationPersistenceInventory
  }

  async armPromotionFaultOnce(): Promise<void> { this.harness.persistence.armPromotionFaultOnce() }
  async disarmPromotionFault(): Promise<void> { this.harness.persistence.disarmPromotionFault() }

  async analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult> {
    if (this.scenario !== null || request.scenario !== undefined) {
      throw new Error(`Unsupported real Product certification scenario: ${request.scenario ?? this.scenario}`)
    }
    const source = request.source as Partial<ManualTestSourceV1>
    const body = {
      schemaVersion: source.schemaVersion === 'forge-manual-test-source/v1'
        ? 'forge-manual-test-source-input/v1'
        : source.schemaVersion,
      sourceKind: source.sourceKind,
      title: source.title,
      objective: source.objective,
      steps: source.steps,
      expectedOutcome: source.expectedOutcome,
    }
    const response = await analyzeManualTest(PROJECT, body, async appName => appName === PROJECT ? { appName } : undefined, this.harness.controllerEngine)
    if (response.status === 400 && (response.body as any).code === 'MANUAL_SOURCE_INVALID') {
      return { kind: 'transport_error', code: 'MANUAL_SOURCE_INVALID' }
    }
    if (response.status !== 200) throw new Error(`Product Analyze failed with HTTP ${response.status}.`)
    const data = (response.body as any).data
    return { kind: 'analysis', source: structuredClone(data.source), result: structuredClone(data.analysis) }
  }

  readManualSource(projectId: string, sourceId: string): Promise<ManualTestSourceV1 | null> {
    return this.sources.read(projectId, sourceId) as Promise<ManualTestSourceV1 | null>
  }

  async saveReviewedProposal(value: unknown): Promise<ProductControllerSaveObservation> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: 'completed', result: { kind: 'refused', code: 'SAVE_REQUEST_INVALID' } }
    }
    const request = value as Record<string, any>
    if (Object.keys(request).sort().join('|') !== 'projectId|proposalAuthority|sourceAuthority'
      || request.projectId !== PROJECT) {
      return { kind: 'completed', result: { kind: 'refused', code: 'SAVE_REQUEST_NOT_IDENTITY_ONLY' } }
    }
    const before = await this.snapshot(PROJECT)
    const response = await saveManualTest(PROJECT, {
      schemaVersion: 'forge-manual-promotion-request/v1',
      sourceAuthority: request.sourceAuthority,
      reviewedProposalAuthority: {
        proposalId: request.proposalAuthority?.proposalId,
        proposalContentHash: request.proposalAuthority?.proposalContentHash,
      },
    }, async appName => appName === PROJECT ? { appName } : undefined, this.harness.controllerEngine)
    if (response.status === 201) {
      const after = await this.snapshot(PROJECT)
      const replayed = JSON.stringify(after) === JSON.stringify(before)
      const completeDelta = after.counts.definitions === before.counts.definitions + 1
        && after.counts.testSetRevisions === before.counts.testSetRevisions + 1
        && after.counts.manualTestPromotions === before.counts.manualTestPromotions + 1
      return {
        kind: 'completed',
        result: {
          kind: 'promoted', result: structuredClone((response.body as any).data),
          reanalysisPerformed: true, replayed, atomic: replayed || completeDelta,
        },
      }
    }
    const code = typeof (response.body as any).code === 'string' ? (response.body as any).code : null
    if (response.status === 409 || response.status === 422) {
      return { kind: 'completed', result: { kind: 'refused', code: code ?? `HTTP_${response.status}` } }
    }
    return {
      kind: 'controller_failure', publicStatus: response.status,
      publicCode: code, observedCause: this.harness.controllerEngine.takeObservedSaveCause(),
    }
  }

  async readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null> {
    const inventory = await this.testSets.readInventory(projectId, { limit: 100, definitionId })
    if ('kind' in inventory || !inventory.requestedDefinition || inventory.requestedDefinition.schemaVersion !== 3) return null
    const history = inventory.history.find(item => item.rowId === inventory.requestedDefinition!.rowId)
    if (!history) return null
    const definition = inventory.requestedDefinition.definition as any
    return {
      schemaVersion: 3,
      projectId,
      definitionAuthority: {
        definitionId: definition.id,
        definitionSchemaVersion: 3,
        testSetId: history.testSetId,
        testSetRevision: history.revision,
        testSetContentHash: history.contentHash,
      },
      normalizedIntent: structuredClone(definition.normalizedIntent),
      appArea: structuredClone(definition.appArea),
      canonicalActions: structuredClone(definition.actions),
      oracle: structuredClone(definition.oracle),
      authenticationExpectation: structuredClone(definition.authenticationExpectation),
    }
  }

  async readManualPromotion(projectId: string, authority: DefinitionAuthority): Promise<ManualPromotionResultV1 | null> {
    const inventory = await this.snapshot(projectId)
    const row = inventory.manualTestPromotions.find(item => item.definitionId === authority.definitionId
      && item.testSetId === authority.testSetId
      && item.testSetRevision === authority.testSetRevision
      && item.testSetContentHash === authority.testSetContentHash)
    return row ? {
      schemaVersion: 'forge-manual-promotion-result/v1',
      outcome: 'promoted',
      sourceAuthority: { sourceId: row.sourceId, sourceContentHash: row.sourceContentHash },
      proposalAuthority: { proposalId: row.proposalId, proposalContentHash: row.proposalContentHash },
      definitionAuthority: structuredClone(authority),
    } : null
  }

  async readDefinitionPresentation(projectId: string, definitionId: string): Promise<DefinitionPresentation | null> {
    const presented = await new TestCasePresentationService(this.testSets).read(projectId, { limit: 100, definitionId })
    if ('kind' in presented || !presented.requestedDefinition) return null
    const definition = await this.readDefinition(projectId, definitionId)
    const promotion = definition && await this.readManualPromotion(projectId, definition.definitionAuthority)
    return definition && promotion
      ? { definitionAuthority: definition.definitionAuthority, promotion }
      : null
  }

  async addDefinitionToSuite(projectId: string, authority: DefinitionAuthority): Promise<M2Candidate | null> {
    const candidates = await this.suites.readCandidates(projectId)
    const candidate = candidates.definitions.find(item => JSON.stringify(item.definitionAuthority) === JSON.stringify(authority))
    if (!candidate) return null
    const preflight = await this.execution.preflight(this.executionRequest(projectId, authority, 'm3-product-preflight'))
    return preflight.kind === 'ready'
      ? { projectId, executable: true, definitionAuthority: structuredClone(authority) }
      : null
  }

  async startExecution(projectId: string, authority: DefinitionAuthority): Promise<{ kind: 'accepted'; executionId: string } | { kind: 'refused' }> {
    const result = await this.execution.start(this.executionRequest(projectId, authority, `m3-product-${authority.definitionId}`))
    if (result.kind !== 'accepted') return { kind: 'refused' }
    await result.completion
    this.executionAuthorities.set(result.executionId, structuredClone(authority))
    return { kind: 'accepted', executionId: result.executionId }
  }

  async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const authority = this.executionAuthorities.get(executionId)
    const read = await this.results.read(projectId, executionId)
    if (!authority || read.kind !== 'ok' || read.projection.headlineOutcome !== 'passed'
      || read.projection.execution.definitionAuthority.schemaVersion !== 3
      || read.projection.execution.definitionAuthority.testSetId !== authority.testSetId
      || read.projection.execution.definitionAuthority.revision !== authority.testSetRevision
      || read.projection.items.length !== 1
      || read.projection.items[0]?.definitionId !== authority.definitionId) return null
    const promotion = await this.readManualPromotion(projectId, authority)
    return promotion ? { executionId, outcome: 'passed', definitionAuthority: structuredClone(authority), promotion } : null
  }

  private executionRequest(projectId: string, authority: DefinitionAuthority, executionIntentKey: string) {
    return {
      projectId, executionIntentKey, definitionIds: [authority.definitionId], revision: authority.testSetRevision,
      workspaceRoot: this.root, credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m3.example.test', loginUrl: 'https://m3.example.test/login' },
    }
  }
}

async function seedCanonicalProductEvidence(root: string): Promise<void> {
  fs.mkdirSync(path.join(root, '.forge'), { recursive: true })
  fs.writeFileSync(path.join(root, '.forge', 'config.json'), JSON.stringify({
    schemaVersion: 1, appName: PROJECT, authType: 'form-login',
  }))
  const observations = new ObservationService(PROJECT, root, {
    producerInstanceId: '55555555-5555-4555-8555-555555555555',
  })
  const run = await observations.startRun({
    operationId: 'm3-product-bridge', producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', startedAt: START, policyId: 'forge.m3-product-acquisition',
    policyVersion: '1', acquisitionPlan: { target: 'https://m3.example.test' },
  })
  const record = (subjectId: string, predicate: string, observedValue: unknown, key: string, scope?: Record<string, unknown>) => observations.recordObservation({
    observationRunId: run.value.observationRunId, projectId: PROJECT, producer: 'forge.crawler', producerVersion: '1',
    method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId, predicate, outcome: 'present', observedValue, boundary: boundary(scope), capturedAt: END, idempotencyKey: key,
  })
  const cart = await record('subject-cart', 'page.discovered', { urlPattern: '/cart.html', elementCount: 1, fingerprint: 'cart-dom' }, 'cart')
  const control = await record('subject-cart', 'control.present', null, 'control', { route: '/cart.html' })
  const checkout = await record('subject-checkout-step-one', 'page.discovered', { urlPattern: '/checkout-step-one.html', elementCount: 0, fingerprint: 'checkout-dom' }, 'checkout')
  await observations.terminalizeRun({
    observationRunId: run.value.observationRunId, lifecycle: 'completed', completeness: 'complete',
    terminalAt: END, safeReasonCode: null, safeMessage: null,
  })
  const observationIds = [cart.value.observationId, control.value.observationId, checkout.value.observationId]
  await new AppModelRepository().commitCandidate(candidate(run.value.observationRunId), 'm3-product-model', {
    projectId: PROJECT, observationRunId: run.value.observationRunId,
    observations: observationIds.map((observationId, index) => ({ observationId, claimKey: `m3.claim.${index}`, supportRole: 'basis' as const })),
    subjects: [
      { canonicalSubjectId: 'subject-cart', observationId: cart.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-cart', observationId: control.value.observationId, claimKey: 'subject.control', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-checkout-step-one', observationId: checkout.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
    ],
    gaps: [], characterizationPolicyId: 'forge.crawl-observation-characterization',
    characterizationPolicyVersion: '1', linkedAt: END,
  })
}

test('M3 certification bridge keeps production Product authority and binds controller Save plus CORE-F fault to one disposable database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-product-bridge-'))
  const resolver = new WorkspaceResolver(root)
  const projectRoot = resolver.resolve(PROJECT).root
  try {
    const production = new ExecutionContext(resolver)
    await production.analyzeProductManualTest(PROJECT, SOURCE_INPUT)
    assert.equal(getDatabaseProvenance().authorityMode, DatabaseAuthorityMode.PRODUCT_WORKSPACE)
    assert.throws(() => new ManualTestCertificationPersistenceAdapter(), /disposable governed SQLite database/i)
    await seedCanonicalProductEvidence(projectRoot)
    await closeDb()

    await assert.rejects(ExecutionContext.createM3CertificationHarness({
      appName: PROJECT, sqlitePath: path.join(root, 'rejected.db'), workspaces: resolver,
      optIn: Symbol('not-the-harness-capability') as any,
    }), /explicit in-process harness opt-in/i)

    const harness = await ExecutionContext.createM3CertificationHarness({
      appName: PROJECT, sqlitePath: path.join(projectRoot, '.forge', 'forge.db'), workspaces: resolver,
      optIn: M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN,
    })
    assert.equal(getDatabaseProvenance().authorityMode, DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION)
    await runMigrations()
    const resolveProject = async (appName: string) => appName === PROJECT ? { appName } : undefined
    const analyzed = await analyzeManualTest(PROJECT, SOURCE_INPUT, resolveProject, harness.controllerEngine)
    assert.equal(analyzed.status, 200)
    const payload = (analyzed.body as any).data
    assert.equal(payload.analysis.outcome.kind, 'proposal')
    const frozenSource = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'm3-contract', 'positive-manual-source.json'),
      'utf8',
    ))
    assert.notEqual(payload.source.sourceId, frozenSource.sourceId)
    assert.notEqual(payload.source.contentHash, frozenSource.contentHash)
    const proposal = payload.analysis.outcome.proposal
    assert.deepEqual(proposal.normalizedIntent.grounding.selectedFlowStepIndexes, [7])
    assert.equal(proposal.sourceGrounding[0].basis.flowStepIndex, null)
    assert.equal(proposal.sourceGrounding[1].basis.flowStepIndex, 7)
    assert.equal(proposal.sourceGrounding[2].basis.flowStepIndex, null)
    const saveRequest = {
      schemaVersion: 'forge-manual-promotion-request/v1',
      sourceAuthority: { sourceId: payload.source.sourceId, sourceContentHash: payload.source.contentHash },
      reviewedProposalAuthority: { proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash },
    }
    const saved = await saveManualTest(PROJECT, saveRequest, resolveProject, harness.controllerEngine)
    assert.equal(saved.status, 201)
    assert.deepEqual((await harness.persistence.snapshot(PROJECT) as any).counts, {
      manualTestSources: 1, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1,
    })

    const faultAnalysis = await analyzeManualTest(PROJECT, { ...SOURCE_INPUT, title: 'Checkout from cart fault control' }, resolveProject, harness.controllerEngine)
    const faultPayload = (faultAnalysis.body as any).data
    const faultProposal = faultPayload.analysis.outcome.proposal
    const faultRequest = {
      schemaVersion: 'forge-manual-promotion-request/v1',
      sourceAuthority: { sourceId: faultPayload.source.sourceId, sourceContentHash: faultPayload.source.contentHash },
      reviewedProposalAuthority: { proposalId: faultProposal.proposalId, proposalContentHash: faultProposal.proposalContentHash },
    }
    const beforeFault = await harness.persistence.snapshot(PROJECT)
    harness.persistence.armPromotionFaultOnce()
    const faulted = await saveManualTest(PROJECT, faultRequest, resolveProject, harness.controllerEngine)
    assert.equal(faulted.status, 500)
    assert.equal((faulted.body as any).code, 'INTERNAL_ERROR')
    const controlledCause = harness.controllerEngine.takeObservedSaveCause()
    assert(controlledCause instanceof ManualPromotionCertificationFault)
    assert.equal(harness.controllerEngine.takeObservedSaveCause(), null)
    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: faulted.status,
      publicCode: (faulted.body as any).code, observedCause: controlledCause,
    }), { kind: 'internal', code: 'CERTIFICATION_PROMOTION_FAULT' })
    assert.deepEqual(await harness.persistence.snapshot(PROJECT), beforeFault)
    harness.persistence.disarmPromotionFault()
    assert.equal((await saveManualTest(PROJECT, faultRequest, resolveProject, harness.controllerEngine)).status, 201)
    assert.equal(harness.controllerEngine.takeObservedSaveCause(), null)

    const originalSave = harness.executionContext.saveProductManualTest.bind(harness.executionContext)
    const unrelated = new Error('unrelated internal failure')
    harness.executionContext.saveProductManualTest = async () => { throw unrelated }
    const unrelatedResult = await saveManualTest(PROJECT, faultRequest, resolveProject, harness.controllerEngine)
    assert.equal(unrelatedResult.status, 500)
    assert.equal((unrelatedResult.body as any).error, 'Manual test promotion failed internally.')
    assert.equal((unrelatedResult.body as any).code, 'INTERNAL_ERROR')
    const unrelatedCause = harness.controllerEngine.takeObservedSaveCause()
    assert.equal(unrelatedCause, unrelated)
    assert.deepEqual(Object.keys(unrelatedResult.body as object).sort(), Object.keys(faulted.body as object).sort())
    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: unrelatedResult.status,
      publicCode: (unrelatedResult.body as any).code, observedCause: unrelatedCause,
    }), { kind: 'unexpected', status: 500, code: 'INTERNAL_ERROR', name: 'Error', message: 'unrelated internal failure' })

    const sqliteFailure = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' })
    harness.executionContext.saveProductManualTest = async () => { throw sqliteFailure }
    const sqliteResult = await saveManualTest(PROJECT, faultRequest, resolveProject, harness.controllerEngine)
    assert.equal(sqliteResult.status, unrelatedResult.status)
    assert.equal((sqliteResult.body as any).error, (unrelatedResult.body as any).error)
    assert.equal((sqliteResult.body as any).code, (unrelatedResult.body as any).code)
    const observedSqliteFailure = harness.controllerEngine.takeObservedSaveCause()
    assert.equal(observedSqliteFailure, sqliteFailure)
    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: sqliteResult.status,
      publicCode: (sqliteResult.body as any).code, observedCause: observedSqliteFailure,
    }), { kind: 'unexpected', status: 500, code: 'INTERNAL_ERROR', name: 'Error', message: 'UNIQUE constraint failed' })
    harness.executionContext.saveProductManualTest = originalSave

    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: 409,
      publicCode: 'STALE_REVIEWED_PROPOSAL', observedCause: new Error('frozen Save refusal'),
    }), { kind: 'save_failure', status: 409, code: 'STALE_REVIEWED_PROPOSAL' })
    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: 422,
      publicCode: 'MANUAL_PROPOSAL_NOT_EXECUTABLE', observedCause: new Error('frozen Save refusal'),
    }), { kind: 'save_failure', status: 422, code: 'MANUAL_PROPOSAL_NOT_EXECUTABLE' })
    assert.deepEqual(await classifyObservation({
      kind: 'controller_failure', publicStatus: 400,
      publicCode: 'INVALID_MANUAL_PROMOTION_REQUEST', observedCause: null,
    }), { kind: 'transport', status: 400, code: 'INVALID_MANUAL_PROMOTION_REQUEST' })
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('real M3 Product driver passes complete golden Certification with canonical proposal and v3 oracle wording', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-product-certification-'))
  const resolver = new WorkspaceResolver(root)
  const projectRoot = resolver.resolve(PROJECT).root
  try {
    const production = new ExecutionContext(resolver)
    await production.analyzeProductManualTest(PROJECT, SOURCE_INPUT)
    await seedCanonicalProductEvidence(projectRoot)
    await closeDb()
    const harness = await ExecutionContext.createM3CertificationHarness({
      appName: PROJECT, sqlitePath: path.join(projectRoot, '.forge', 'forge.db'), workspaces: resolver,
      optIn: M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN,
    })
    await runMigrations()

    const credentials = new EnvironmentCredentialExecutionScope({ M3_PRODUCT_USER: 'shopper', M3_PRODUCT_PASSWORD: 'secret' })
    let currentUrl = 'https://m3.example.test/login'
    const createSession: ExecutionSessionFactory = async () => ({
      authenticateFormLogin: async () => { currentUrl = 'https://m3.example.test/'; return true },
      navigate: async url => { currentUrl = url },
      clickDataTest: async value => {
        assert.equal(value, 'checkout')
        currentUrl = 'https://m3.example.test/checkout-step-one.html'
        return 'one' as const
      },
      currentUrl: () => currentUrl,
      close: async () => undefined,
    })
    const execution = new ExecutionService({
      credentials,
      executor: new PlaywrightPlanExecutor(credentials, createSession),
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable Product session is ready.' }),
      processInstanceId: 'process-m3-product-certification',
    })
    const driver = new ProductM3CertificationDriver(new RealM3ProductPort(projectRoot, harness, execution))
    const report = await certifyGolden(driver, loadSharedContracts())
    assert.equal(report.passed, true)
    assert.deepEqual(report.findings, [])
    assert.deepEqual(report.observations.faultFailure, {
      kind: 'internal', code: 'CERTIFICATION_PROMOTION_FAULT',
    })
    assert.deepEqual(report.observations.afterFaultPersistence, report.observations.beforeFaultPersistence)
    const inventory = report.observations.afterDisarmedPersistence as CertificationPersistenceInventory
    assert.deepEqual(inventory.counts, {
      manualTestSources: 2, definitions: 2, testSetRevisions: 2, manualTestPromotions: 2,
    })
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('public Analyze and Save transport has no certification authority selection channel', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'forge-ui', 'server', 'routes', 'projects.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(__dirname, '..', 'forge-ui', 'server', 'context', 'ManualTestController.ts'), 'utf8')
  assert.doesNotMatch(`${route}\n${controller}`, /M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN|createM3CertificationHarness|DISPOSABLE_CERTIFICATION/)
  assert.match(route, /analyzeManualTest\(req\.params\.appName, req\.body, resolveKnownProject\)/)
  assert.match(route, /saveManualTest\(req\.params\.appName, req\.body, resolveKnownProject\)/)
  assert.doesNotMatch(route, /manual-tests[^\n]*(?:req\.query|req\.headers)/)
  assert.equal('takeObservedSaveCause' in new ExecutionContext(), false)
})
