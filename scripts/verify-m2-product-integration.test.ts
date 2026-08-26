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
import { sql } from 'kysely'
import { closeDb, getDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationBoundary } from '../src/core/observation/ObservationTypes'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { MIGRATION_032_TRIGGER_DEFINITIONS_V1 } from '../src/core/storage/migrations/032_canonical_suite_revision_authority'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import { isSupportedNormalizedTestIntentV1 } from '../forge-ui/src/api/m1TestIntentContract'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { SuiteService } from '../src/core/suites/SuiteService'
import { SuiteContractError, type CanonicalSuiteRevision, type DefinitionRevisionRef } from '../src/core/suites/SuiteContract'
import { ExecutionService, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { ExecutionRepository, type BeginExecutionInput } from '../src/core/storage/repositories/ExecutionRepository'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { ExecutionResultProjectionService, type ExecutionResultProjection } from '../src/core/execution/ExecutionResultProjectionService'
import { loadM2CertificationCase } from './m2-certification/fixture-loader'
import { ProductM2CertificationDriver, type ProductM2ObservationPort } from './m2-certification/product-driver'
import { assertM2CertificationPassed, certifyM2Case } from './m2-certification/suite'
import type {
  CandidateDefinition,
  CanonicalTestSetFixture,
  ExecutionObservation,
  M2CertificationCase,
  MutationResult,
  ResultsObservation,
  SavedSuite,
  StartResult,
  SuiteIntegrityFault,
  SuiteMember,
  SuitePreflight,
  SuiteReadResult,
  SuiteSelection,
} from './m2-certification/driver'

const PROJECT = 'm2-product-storefront'
const START = '2026-08-25T20:00:00.000Z'
const END = '2026-08-25T20:00:01.000Z'
const HASH = 'a'.repeat(64)
const CREDENTIAL_REFERENCE = { usernameEnv: 'M2_PRODUCT_USER', passwordEnv: 'M2_PRODUCT_PASSWORD' }

function boundary(scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' }): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1', kind: 'document', scope,
    startedAt: START, endedAt: END, completion: 'complete', policyId: 'forge.m2-product-integration', policyVersion: '1',
  }
}

function model(runId: string, generation: number): AppModelCandidate {
  return {
    schemaVersion: '2.0', generatedAt: END, generatedBy: 'engine', classificationRunId: runId,
    app: {
      name: PROJECT, displayName: 'M2 Storefront', baseUrl: 'https://m2.example.test', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: `m2-product-${generation}`, crawledAt: END, crawledBy: 'engine', crawlDurationMs: 1000,
        pagesBudget: 2, pagesDiscovered: 2, pagesSkipped: 0, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: 'M2_PRODUCT_CREDENTIALS',
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout'], restrictedPageIds: [], authOutcome: 'succeeded',
    }],
    pages: [
      {
        id: 'subject-cart', displayName: 'Cart', urlPattern: '/cart.html', urlPatternType: 'exact',
        fingerprint: `cart-${generation}`, fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'],
        isAuthPage: false, module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'], source: 'evidence-matched', reason: 'Observed cart.' },
        elements: [{
          id: 'subject-checkout-control', name: 'checkout', kind: 'button', label: 'Checkout', critical: true, aiNamed: false,
          strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }], tier3Assertions: [],
          cardinality: { kind: 'single' }, observedState: 'visible', href: null,
        }],
      },
      {
        id: 'subject-checkout', displayName: 'Checkout', urlPattern: '/checkout.html', urlPatternType: 'exact',
        fingerprint: `checkout-${generation}`, fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'],
        isAuthPage: false, module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout'], source: 'evidence-matched', reason: 'Observed checkout.' }, elements: [],
      },
    ],
    flows: [{
      id: 'checkout-flow', displayName: 'Observed checkout', confidence: 'partial', source: 'agent-proposed', roleId: 'shopper', linkedApiEndpointIds: [],
      steps: [
        { stepIndex: 0, pageId: 'home', action: 'assert-navigation', elementId: null, targetPageId: 'subject-cart', value: null, grounding: 'inferred' },
        { stepIndex: 1, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control', targetPageId: 'subject-checkout', value: null, grounding: 'observed' },
      ],
      groundingWarnings: ['The unobserved entry step remains excluded.'],
    }], endpoints: null, api: null, diff: null,
  }
}

async function commitObservedModel(root: string, generation: number): Promise<void> {
  const observations = new ObservationService(PROJECT, root, { producerInstanceId: `55555555-5555-4555-8555-${String(generation).padStart(12, '0')}` })
  const run = await observations.startRun({
    operationId: `m2-observation-${generation}`, producer: 'forge.crawler', producerVersion: '1', acquisitionKind: 'web_crawl',
    startedAt: START, policyId: 'forge.m2-product-acquisition', policyVersion: '1', acquisitionPlan: { target: 'https://m2.example.test' },
  })
  const record = (subjectId: string, predicate: string, observedValue: unknown, key: string, scope?: Record<string, unknown>) => observations.recordObservation({
    observationRunId: run.value.observationRunId, projectId: PROJECT, producer: 'forge.crawler', producerVersion: '1',
    method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId, predicate, outcome: 'present', observedValue,
    boundary: boundary(scope), capturedAt: END, idempotencyKey: key,
  })
  const cart = await record('subject-cart', 'page.discovered', { urlPattern: '/cart.html', elementCount: 1, fingerprint: `subject-cart-${generation}` }, `cart-${generation}`)
  const control = await record('subject-cart', 'control.present', null, `checkout-control-${generation}`, { route: '/cart.html' })
  const checkout = await record('subject-checkout', 'page.discovered', { urlPattern: '/checkout.html', elementCount: 0, fingerprint: `subject-checkout-${generation}` }, `checkout-${generation}`)
  await observations.terminalizeRun({ observationRunId: run.value.observationRunId, lifecycle: 'completed', completeness: 'complete', terminalAt: END, safeReasonCode: null, safeMessage: null })
  await new AppModelRepository().commitCandidate(model(run.value.observationRunId, generation), `m2-model-${generation}`, {
    projectId: PROJECT, observationRunId: run.value.observationRunId,
    observations: [cart.value.observationId, control.value.observationId, checkout.value.observationId].map((observationId, index) => ({ observationId, claimKey: `m2.claim.${index}`, supportRole: 'basis' as const })),
    subjects: [
      { canonicalSubjectId: 'subject-cart', observationId: cart.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-cart', observationId: control.value.observationId, claimKey: 'subject.control', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-checkout', observationId: checkout.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
    ],
    gaps: [], characterizationPolicyId: 'forge.m2-characterization', characterizationPolicyVersion: '1', linkedAt: END,
  })
}

function certificationFixture(base: M2CertificationCase, current: Awaited<ReturnType<TestSetRepository['readInventory']>>): M2CertificationCase {
  if ('kind' in current || !current.current || current.current.testSet.schemaVersion !== 2) throw new Error('Current Product v2 Test Set is unavailable.')
  const fixture = structuredClone(base)
  const testSet = current.current.testSet
  fixture.projectId = PROJECT
  fixture.testSets = [{
    projectId: PROJECT, testSetId: testSet.testSetId, testSetRevision: testSet.revision,
    definitionSchemaVersion: 2, testSetContentHash: current.current.contentHash,
    definitions: testSet.definitions.map(definition => ({ definitionId: definition.id, executable: true, executionOutcome: 'passed' as const })),
  }]
  fixture.suite.orderedDefinitionIds = testSet.definitions.map(definition => definition.id)
  fixture.suite.expectedOrdinals = testSet.definitions.map((_definition, index) => index + 1)
  return fixture
}

function requestMembers(value: unknown): { projectId: string; name: string; changeIntentKey: string; members: DefinitionRevisionRef[]; suiteId?: string; expectedRevision?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (typeof request.projectId !== 'string' || typeof request.name !== 'string' || request.purpose !== 'sanity'
    || typeof request.changeIntentKey !== 'string' || !Array.isArray(request.members)) return null
  const members = request.members as SuiteMember[]
  if (members.some((member, index) => member.ordinal !== index + 1)) return null
  const revision = request.suiteId === undefined ? {} : {
    suiteId: typeof request.suiteId === 'string' ? request.suiteId : '',
    expectedRevision: Number(request.expectedRevision),
  }
  return { projectId: request.projectId, name: request.name, changeIntentKey: request.changeIntentKey, members: members.map(member => member.definitionAuthority), ...revision }
}

function suiteError(cause: unknown): string | null {
  let current = cause
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (current instanceof SuiteContractError) return current.code
    if ('code' in current && typeof current.code === 'string') return current.code
    current = 'cause' in current ? current.cause : null
  }
  return null
}

class RealProductPort implements ProductM2ObservationPort {
  private readonly suites = new SuiteService()
  private readonly results = new ExecutionResultProjectionService()
  private readonly completions = new Map<string, Promise<void>>()
  private readonly mutationIntents = new Map<string, SavedSuite>()

  constructor(private readonly root: string, private readonly execution: ExecutionService) {}

  async persistCanonicalTestSet(expected: CanonicalTestSetFixture): Promise<void> {
    const inventory = await new TestSetRepository().readInventory(expected.projectId, { limit: 1 })
    if ('kind' in inventory || !inventory.current
      || inventory.current.testSet.testSetId !== expected.testSetId
      || inventory.current.testSet.revision !== expected.testSetRevision
      || inventory.current.testSet.schemaVersion !== expected.definitionSchemaVersion
      || inventory.current.contentHash !== expected.testSetContentHash
      || inventory.current.testSet.definitions.map(item => item.id).join('|') !== expected.definitions.map(item => item.definitionId).join('|')) {
      throw new Error('Certification fixture does not match observed current Product Test Set authority.')
    }
  }

  async injectSuiteIntegrityFault(_projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void> {
    if (fault === 'corrupted_content_hash') {
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({ content_hash: '9'.repeat(64) }).where('suite_id', '=', suiteId).where('revision', '=', suiteRevision).execute()
      await sql.raw(MIGRATION_032_TRIGGER_DEFINITIONS_V1.suite_revisions_immutable_update).execute(getDb())
      return
    }
    throw new Error(`Unsupported Product corruption fixture: ${fault}`)
  }

  async listCandidates(projectId: string): Promise<CandidateDefinition[]> {
    const candidates = await this.suites.readCandidates(projectId)
    const preflight = await this.execution.preflight(this.executionRequest(projectId, {
      definitionIds: candidates.definitions.map(item => item.definitionAuthority.definitionId),
      revision: candidates.testSetAuthority.testSetRevision,
    }))
    const eligible = new Set(preflight.kind === 'ready' ? preflight.definitionResults.map(item => item.definitionId) : [])
    return candidates.definitions.map(item => ({ projectId, executable: eligible.has(item.definitionAuthority.definitionId), definitionAuthority: item.definitionAuthority }))
  }

  listSuites(projectId: string): Promise<SavedSuite[]> { return this.suites.listHeads(projectId) }

  async createSuite(value: unknown): Promise<MutationResult> {
    const request = requestMembers(value)
    if (!request || request.suiteId !== undefined) return { kind: 'refused', refusalCode: null }
    try {
      const suite = await this.suites.create({ projectId: request.projectId, changeIntentKey: request.changeIntentKey, name: request.name, members: request.members })
      const intent = `${request.projectId}\u0000${request.changeIntentKey}`
      const replayed = this.mutationIntents.has(intent)
      if (!replayed) this.mutationIntents.set(intent, structuredClone(suite))
      return { kind: 'accepted', suite, replayed }
    } catch (cause) { return { kind: 'refused', refusalCode: suiteError(cause) } }
  }

  async readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult> {
    try { return { kind: 'available', suite: await this.suites.read(projectId, suiteId, suiteRevision) } }
    catch (cause) {
      const code = suiteError(cause)
      return code === 'suite_not_found' || code === 'suite_revision_not_found'
        ? { kind: 'not_found', refusalCode: null }
        : { kind: 'refused', refusalCode: 'suite_integrity_invalid' }
    }
  }

  async reviseSuite(value: unknown): Promise<MutationResult> {
    const request = requestMembers(value)
    if (!request?.suiteId || !Number.isSafeInteger(request.expectedRevision)) return { kind: 'refused', refusalCode: null }
    try {
      const suite = await this.suites.revise({ projectId: request.projectId, suiteId: request.suiteId, expectedRevision: request.expectedRevision!, changeIntentKey: request.changeIntentKey, name: request.name, members: request.members })
      const intent = `${request.projectId}\u0000${request.changeIntentKey}`
      const replayed = this.mutationIntents.has(intent)
      if (!replayed) this.mutationIntents.set(intent, structuredClone(suite))
      return { kind: 'accepted', suite, replayed }
    } catch (cause) { return { kind: 'refused', refusalCode: suiteError(cause) } }
  }

  async preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight> {
    const result = await this.execution.preflight(this.executionRequest(projectId, { selection }))
    if (result.kind === 'ready') return { kind: 'accepted', selection, suiteContentHash: result.suiteAuthority?.contentHash ?? null, refusalCode: null, wholeSuiteEligible: true }
    let suiteContentHash: string | null = null
    try { suiteContentHash = (await this.suites.read(projectId, selection.suiteId, selection.suiteRevision)).contentHash } catch { /* integrity/not-found remains null */ }
    return { kind: 'refused', selection, suiteContentHash, refusalCode: result.code === 'stale_suite_authority' || result.code === 'suite_integrity_invalid' ? result.code : null, wholeSuiteEligible: false }
  }

  async startSuiteExecution(projectId: string, value: unknown): Promise<StartResult> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'refused', refusalCode: null }
    const request = value as Record<string, unknown>
    if (Object.keys(request).sort().join('|') !== 'executionIntentKey|selection' || typeof request.executionIntentKey !== 'string') return { kind: 'refused', refusalCode: null }
    const result = await this.execution.start(this.executionRequest(projectId, { executionIntentKey: request.executionIntentKey, selection: request.selection as SuiteSelection }))
    if (result.kind === 'rejected') return { kind: 'refused', refusalCode: result.code }
    this.completions.set(result.executionId, result.completion)
    await result.completion
    return { kind: 'accepted', executionId: result.executionId, replayed: result.replayed }
  }

  async readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null> {
    const observed = await this.observed(projectId, executionId)
    if (!observed) return null
    return observed.execution
  }

  async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const observed = await this.observed(projectId, executionId)
    return observed?.results ?? null
  }

  private executionRequest(projectId: string, selection: { definitionIds: string[]; revision: number } | { selection: SuiteSelection } | { executionIntentKey: string; selection: SuiteSelection }): GovernedExecutionStartRequest {
    return {
      projectId, executionIntentKey: 'executionIntentKey' in selection ? selection.executionIntentKey : `preflight-${crypto.randomUUID()}`,
      ...('selection' in selection ? { selection: selection.selection } : { definitionIds: selection.definitionIds, revision: selection.revision }),
      workspaceRoot: this.root, credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    }
  }

  private async observed(projectId: string, executionId: string): Promise<{ execution: ExecutionObservation; results: ResultsObservation } | null> {
    await this.completions.get(executionId)
    const read = await this.results.read(projectId, executionId)
    if (read.kind !== 'ok' || !read.projection.execution.selectionAuthority) return null
    const projection = read.projection
    const selected = projection.execution.selectionAuthority
    const suite = await this.suites.read(projectId, selected.suiteId, selected.suiteRevision)
    const pinned = suite.members[0]!.definitionAuthority
    const snapshot = { suiteId: selected.suiteId, suiteRevision: selected.suiteRevision, suiteContentHash: selected.suiteContentHash, name: selected.name, purpose: selected.purpose, provenance: suite.provenance }
    const manifest = projection.items.map(item => ({ definitionId: item.definitionId, testSetId: pinned.testSetId, testSetRevision: pinned.testSetRevision, definitionSchemaVersion: pinned.definitionSchemaVersion, testSetContentHash: pinned.testSetContentHash }))
    const testSetAuthority = { testSetId: pinned.testSetId, testSetRevision: pinned.testSetRevision, definitionSchemaVersion: pinned.definitionSchemaVersion, testSetContentHash: pinned.testSetContentHash }
    return {
      execution: { executionId, projectId, state: 'completed', selection: { kind: 'suite_revision', suiteId: selected.suiteId, suiteRevision: selected.suiteRevision }, suite: snapshot, testSetAuthority, manifest },
      results: { executionId, headlineOutcome: projection.headlineOutcome, suite: snapshot, testSetAuthority, items: projection.items.map(item => item.result.state === 'result_observed' ? { definitionId: item.definitionId, state: 'result_observed', outcome: item.result.outcome } : { definitionId: item.definitionId, state: 'no_result_observed', reasonCode: 'expected_result_missing' }) },
    }
  }
}

class RaceWindowExecutionRepository extends ExecutionRepository {
  beforeAcceptance: ((input: BeginExecutionInput) => Promise<void>) | null = null

  override async beginExecution(input: BeginExecutionInput) {
    const hook = this.beforeAcceptance
    this.beforeAcceptance = null
    if (hook) await hook(input)
    return super.beginExecution(input)
  }
}

async function productSetup(repository?: ExecutionRepository): Promise<{ root: string; port: RealProductPort; fixture: M2CertificationCase }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m2-product-integration-'))
  const workspace = createWorkspace(root)
  try {
    await openProjectDatabase(workspace)
    fs.writeFileSync(path.join(workspace.forgeDir, 'config.json'), JSON.stringify({ schemaVersion: 1, appName: PROJECT, authType: 'form-login' }))
    await commitObservedModel(root, 1)
    const generated = await new CanonicalTestDefinitionGenerationService().generate(PROJECT, root, 'm2-product-v2-1')
    assert.ok(generated.testSet.definitions.length >= 2)
    const credentials = new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' })
    let currentUrl = 'https://m2.example.test/login'
    const createSession: ExecutionSessionFactory = async () => ({
      authenticateFormLogin: async () => { currentUrl = 'https://m2.example.test/'; return true },
      navigate: async url => { currentUrl = url },
      clickDataTest: async value => { assert.equal(value, 'checkout'); currentUrl = 'https://m2.example.test/checkout.html' },
      currentUrl: () => currentUrl,
      close: async () => undefined,
    })
    const execution = new ExecutionService({
      repository,
      credentials, executor: new PlaywrightPlanExecutor(credentials, createSession),
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable Product session is ready.' }),
      processInstanceId: 'process-m2-product-integration',
    })
    const inventory = await new TestSetRepository().readInventory(PROJECT, { limit: 1 })
    return { root, port: new RealProductPort(root, execution), fixture: certificationFixture(loadM2CertificationCase('golden-v2.json'), inventory) }
  } catch (cause) {
    await closeDb().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
    throw cause
  }
}

test('M2 Product driver earns golden v2 through real Suite, Execution, and Results boundaries', async () => {
  const context = await productSetup()
  try {
    const driver = new ProductM2CertificationDriver(context.port)
    assert.equal(driver.authorityClass, 'product')
    const report = await certifyM2Case(driver, context.fixture)
    assertM2CertificationPassed(report)
    const suite = report.observations.savedSuite as SavedSuite
    assert.deepEqual(suite.members.map(member => member.ordinal), [1, 2])
    const results = report.observations.results as ResultsObservation
    assert.equal(results.suite?.suiteContentHash, suite.contentHash)
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('real Product hostile transport rejects invalid mutation, stale edit, injection, and idempotency drift', async () => {
  const context = await productSetup()
  try {
    const driver = new ProductM2CertificationDriver(context.port)
    const candidates = await driver.listCandidates(PROJECT)
    const members = candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority }))
    const create = (name: string, changeIntentKey: string, selectedMembers = members) => driver.createSuite({
      projectId: PROJECT, name, purpose: 'sanity', members: selectedMembers, changeIntentKey,
    })

    assert.deepEqual(await create('Empty Sanity', 'hostile-empty', []), { kind: 'refused', refusalCode: 'empty_suite' })
    assert.deepEqual(await create('Duplicate Member Sanity', 'hostile-duplicate', [members[0]!, { ordinal: 2, definitionAuthority: members[0]!.definitionAuthority }]), { kind: 'refused', refusalCode: 'duplicate_suite_member' })
    assert.deepEqual(await create('Oversized Sanity', 'hostile-oversized', Array.from({ length: 51 }, (_item, index) => ({ ordinal: index + 1, definitionAuthority: members[0]!.definitionAuthority }))), { kind: 'refused', refusalCode: 'too_many_suite_members' })
    assert.deepEqual(await create('Cross Authority Sanity', 'hostile-cross', [members[0]!, { ordinal: 2, definitionAuthority: { ...members[1]!.definitionAuthority, testSetId: 'other-test-set' } }]), { kind: 'refused', refusalCode: 'suite_members_not_single_test_set' })

    const createRequest = { projectId: PROJECT, name: 'Checkout Sanity', purpose: 'sanity', members, changeIntentKey: 'hostile-create' }
    const created = await driver.createSuite(createRequest)
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Product refused the hostile-matrix control Suite.')
    assert.deepEqual(await driver.createSuite(createRequest), { ...created, replayed: true })
    assert.deepEqual(await create('  checkout   sanity  ', 'hostile-name'), { kind: 'refused', refusalCode: 'duplicate_suite_name' })

    const firstSelection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: 1 }
    assert.equal((await driver.preflightSuite(PROJECT, firstSelection)).kind, 'accepted')
    const beforeInjection = Number((await getDb().selectFrom('executions').select(({ fn }) => fn.countAll<number>().as('count')).where('project_id', '=', PROJECT).executeTakeFirstOrThrow()).count)
    assert.deepEqual(await driver.startSuiteExecution(PROJECT, { executionIntentKey: 'hostile-injection', selection: firstSelection, members }), { kind: 'refused', refusalCode: null })
    assert.equal(Number((await getDb().selectFrom('executions').select(({ fn }) => fn.countAll<number>().as('count')).where('project_id', '=', PROJECT).executeTakeFirstOrThrow()).count), beforeInjection)

    const started = await driver.startSuiteExecution(PROJECT, { executionIntentKey: 'hostile-k1', selection: firstSelection })
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('Product refused the hostile-matrix control execution.')
    const replay = await driver.startSuiteExecution(PROJECT, { executionIntentKey: 'hostile-k1', selection: firstSelection })
    assert.equal(replay.kind, 'accepted')
    if (replay.kind === 'accepted') {
      assert.equal(replay.executionId, started.executionId)
      assert.equal(replay.replayed, true)
    }

    const revised = await driver.reviseSuite({
      projectId: PROJECT, suiteId: created.suite.suiteId, expectedRevision: 1, name: 'Renamed Checkout Sanity', purpose: 'sanity', members, changeIntentKey: 'hostile-revise',
    })
    assert.equal(revised.kind, 'accepted')
    if (revised.kind !== 'accepted') throw new Error('Product refused the hostile-matrix control revision.')
    const staleEdit = await driver.reviseSuite({
      projectId: PROJECT, suiteId: created.suite.suiteId, expectedRevision: 1, name: 'Stale Rename', purpose: 'sanity', members, changeIntentKey: 'hostile-stale-edit',
    })
    assert.deepEqual(staleEdit, { kind: 'refused', refusalCode: 'stale_suite_revision' })
    assert.deepEqual((await driver.listSuites(PROJECT)).map(suite => [suite.revision, suite.name]), [[2, 'Renamed Checkout Sanity']])
    assert.deepEqual(await driver.startSuiteExecution(PROJECT, {
      executionIntentKey: 'hostile-k1', selection: { ...firstSelection, suiteRevision: 2 },
    }), { kind: 'refused', refusalCode: 'execution_intent_conflict' })

    const historical = await driver.readResults(PROJECT, started.executionId)
    assert.equal(historical?.suite?.suiteRevision, 1)
    assert.equal(historical?.suite?.name, 'Checkout Sanity')
    assert.equal(historical?.suite?.suiteContentHash, created.suite.contentHash)
    assert.deepEqual(historical?.items.map(item => item.definitionId), members.map(member => member.definitionAuthority.definitionId))
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('M2 Product driver executes a one-member Suite against current canonical v3 authority', async () => {
  const context = await productSetup()
  try {
    const generation = new CanonicalTestDefinitionGenerationService()
    const areas = await generation.listDiscoveredAreas(PROJECT, context.root)
    assert.deepEqual(areas.map(area => [area.appArea, area.availability]), [['checkout', 'available']])
    const intent = await generation.generateDiscoveredIntent(PROJECT, context.root, 'checkout')
    assert.equal(isSupportedNormalizedTestIntentV1(intent), true)
    if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Product did not expose a supported observed-flow intent.')
    await generation.saveReviewedDiscoveredIntent(PROJECT, context.root, intent, 'm2-product-v3-save')
    const inventory = await new TestSetRepository().readInventory(PROJECT, { limit: 1 })
    if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3) throw new Error('Current Product v3 authority was not persisted.')
    const current = inventory.current.testSet
    assert.equal(current.definitions.length, 1)

    const driver = new ProductM2CertificationDriver(context.port)
    const candidates = await driver.listCandidates(PROJECT)
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0]?.definitionAuthority.definitionSchemaVersion, 3)
    const created = await driver.createSuite({
      projectId: PROJECT, name: 'Checkout Flow Sanity', purpose: 'sanity', changeIntentKey: 'm2-v3-suite-create',
      members: [{ ordinal: 1, definitionAuthority: candidates[0]!.definitionAuthority }],
    })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Product refused the current v3 Suite.')
    const selection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: 1 }
    const preflight = await driver.preflightSuite(PROJECT, selection)
    assert.deepEqual(preflight, { kind: 'accepted', selection, suiteContentHash: created.suite.contentHash, refusalCode: null, wholeSuiteEligible: true })
    const started = await driver.startSuiteExecution(PROJECT, { executionIntentKey: 'm2-v3-suite-start', selection })
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('Product refused the current v3 Suite execution.')
    const results = await driver.readResults(PROJECT, started.executionId)
    assert.equal(results?.headlineOutcome, 'passed')
    assert.equal(results?.suite?.suiteContentHash, created.suite.contentHash)
    assert.deepEqual(results?.items.map(item => item.definitionId), [current.definitions[0]!.id])
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('real Product stale authority remains readable and accepts no Execution, including same Definition IDs', async () => {
  const context = await productSetup()
  try {
    const candidates = await context.port.listCandidates(PROJECT)
    const members = candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority }))
    const created = await context.port.createSuite({ projectId: PROJECT, name: 'Checkout Sanity', purpose: 'sanity', members, changeIntentKey: 'stale-create' })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Product Suite was not created.')
    const frozen = structuredClone(created.suite)
    const selection = { kind: 'suite_revision' as const, suiteId: frozen.suiteId, suiteRevision: 1 }
    assert.deepEqual(await context.port.preflightSuite(PROJECT, selection), { kind: 'accepted', selection, suiteContentHash: frozen.contentHash, refusalCode: null, wholeSuiteEligible: true })
    const newer = await new CanonicalTestDefinitionGenerationService().generate(PROJECT, context.root, 'm2-product-v2-2')
    assert.deepEqual(newer.testSet.definitions.map(item => item.id), frozen.members.map(item => item.definitionAuthority.definitionId))
    const read = await context.port.readSuite(PROJECT, frozen.suiteId, 1)
    assert.deepEqual(read, { kind: 'available', suite: frozen })
    assert.deepEqual(await context.port.preflightSuite(PROJECT, selection), { kind: 'refused', selection, suiteContentHash: frozen.contentHash, refusalCode: 'stale_suite_authority', wholeSuiteEligible: false })
    assert.deepEqual(await context.port.startSuiteExecution(PROJECT, { executionIntentKey: 'stale-start', selection }), { kind: 'refused', refusalCode: 'stale_suite_authority' })
    assert.equal((await getDb().selectFrom('executions').select(({ fn }) => fn.countAll<number>().as('count')).where('project_id', '=', PROJECT).executeTakeFirstOrThrow()).count, 0)
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('actual Product Suite corruption surfaces integrity-invalid and never stale', async () => {
  const context = await productSetup()
  try {
    const candidates = await context.port.listCandidates(PROJECT)
    const created = await context.port.createSuite({ projectId: PROJECT, name: 'Integrity Sanity', purpose: 'sanity', members: candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority })), changeIntentKey: 'integrity-create' })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Product Suite was not created.')
    await context.port.injectSuiteIntegrityFault(PROJECT, created.suite.suiteId, 1, 'corrupted_content_hash')
    const selection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: 1 }
    assert.deepEqual(await context.port.readSuite(PROJECT, created.suite.suiteId, 1), { kind: 'refused', refusalCode: 'suite_integrity_invalid' })
    assert.deepEqual(await context.port.preflightSuite(PROJECT, selection), { kind: 'refused', selection, suiteContentHash: null, refusalCode: 'suite_integrity_invalid', wholeSuiteEligible: false })
    assert.deepEqual(await context.port.startSuiteExecution(PROJECT, { executionIntentKey: 'integrity-start', selection }), { kind: 'refused', refusalCode: 'suite_integrity_invalid' })
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

async function assertNoExecutionAccepted(): Promise<void> {
  for (const table of ['executions', 'execution_items', 'execution_locks', 'execution_events'] as const) {
    const row = await getDb().selectFrom(table).select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()
    assert.equal(Number(row.count), 0, `${table} must remain empty after refused acceptance`)
  }
}

test('M2 Start atomically rejects post-preflight Suite semantic, provenance, count, member, and hash corruption', async () => {
  const attacks: Array<{ label: string; mutate: (suite: SavedSuite) => Promise<void> }> = [
    { label: 'name', mutate: async suite => {
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({ name: 'Corrupted Acceptance Name' })
        .where('suite_id', '=', suite.suiteId).where('revision', '=', suite.revision).execute()
    } },
    { label: 'provenance', mutate: async suite => {
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({ change_intent_key: 'corrupted-acceptance-provenance' })
        .where('suite_id', '=', suite.suiteId).where('revision', '=', suite.revision).execute()
    } },
    { label: 'member-count', mutate: async suite => {
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({ member_count: 1 })
        .where('suite_id', '=', suite.suiteId).where('revision', '=', suite.revision).execute()
    } },
    { label: 'member-gap', mutate: async suite => {
      await sql.raw('DROP TRIGGER suite_revision_members_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revision_members').set({ member_ordinal: 3 })
        .where('suite_id', '=', suite.suiteId).where('suite_revision', '=', suite.revision)
        .where('member_ordinal', '=', 2).execute()
    } },
    { label: 'stored-content-hash', mutate: async suite => {
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({ content_hash: '9'.repeat(64) })
        .where('suite_id', '=', suite.suiteId).where('revision', '=', suite.revision).execute()
    } },
  ]

  for (const attack of attacks) {
    const repository = new RaceWindowExecutionRepository()
    const context = await productSetup(repository)
    try {
      const candidates = await context.port.listCandidates(PROJECT)
      const created = await context.port.createSuite({
        projectId: PROJECT, name: `Race ${attack.label} Sanity`, purpose: 'sanity',
        members: candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority })),
        changeIntentKey: `race-${attack.label}-create`,
      })
      assert.equal(created.kind, 'accepted')
      if (created.kind !== 'accepted') throw new Error(`Race control Suite was not created for ${attack.label}.`)
      const selection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: created.suite.revision }
      assert.equal((await context.port.preflightSuite(PROJECT, selection)).kind, 'accepted')
      repository.beforeAcceptance = async () => attack.mutate(created.suite)

      assert.deepEqual(
        await context.port.startSuiteExecution(PROJECT, { executionIntentKey: `race-${attack.label}-start`, selection }),
        { kind: 'refused', refusalCode: 'suite_integrity_invalid' },
      )
      await assertNoExecutionAccepted()
    } finally {
      await closeDb()
      fs.rmSync(context.root, { recursive: true, force: true })
    }
  }
})

test('M2 Start classifies a post-preflight same-members current Test Set advance as stale without substitution', async () => {
  const repository = new RaceWindowExecutionRepository()
  const context = await productSetup(repository)
  try {
    const candidates = await context.port.listCandidates(PROJECT)
    const created = await context.port.createSuite({
      projectId: PROJECT, name: 'Race Stale Sanity', purpose: 'sanity',
      members: candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority })),
      changeIntentKey: 'race-stale-create',
    })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Race stale control Suite was not created.')
    const selection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: created.suite.revision }
    assert.equal((await context.port.preflightSuite(PROJECT, selection)).kind, 'accepted')
    repository.beforeAcceptance = async () => {
      const newer = await new CanonicalTestDefinitionGenerationService().generate(PROJECT, context.root, 'm2-race-current-v2-2')
      assert.deepEqual(
        newer.testSet.definitions.map(definition => definition.id),
        created.suite.members.map(member => member.definitionAuthority.definitionId),
      )
    }

    assert.deepEqual(
      await context.port.startSuiteExecution(PROJECT, { executionIntentKey: 'race-stale-start', selection }),
      { kind: 'refused', refusalCode: 'stale_suite_authority' },
    )
    assert.deepEqual(await context.port.readSuite(PROJECT, created.suite.suiteId, created.suite.revision), {
      kind: 'available', suite: created.suite,
    })
    await assertNoExecutionAccepted()
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('M2 Start accepts an unchanged post-preflight Suite and replays the same K1 exactly', async () => {
  const repository = new RaceWindowExecutionRepository()
  const context = await productSetup(repository)
  try {
    const candidates = await context.port.listCandidates(PROJECT)
    const created = await context.port.createSuite({
      projectId: PROJECT, name: 'Race Control Sanity', purpose: 'sanity',
      members: candidates.map((candidate, index) => ({ ordinal: index + 1, definitionAuthority: candidate.definitionAuthority })),
      changeIntentKey: 'race-control-create',
    })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Race acceptance control Suite was not created.')
    const selection = { kind: 'suite_revision' as const, suiteId: created.suite.suiteId, suiteRevision: created.suite.revision }
    assert.equal((await context.port.preflightSuite(PROJECT, selection)).kind, 'accepted')
    repository.beforeAcceptance = async () => undefined

    const accepted = await context.port.startSuiteExecution(PROJECT, { executionIntentKey: 'race-control-start', selection })
    assert.equal(accepted.kind, 'accepted')
    if (accepted.kind !== 'accepted') throw new Error('Unchanged Suite was not accepted.')
    assert.equal(accepted.replayed, false)
    assert.deepEqual(
      await context.port.startSuiteExecution(PROJECT, { executionIntentKey: 'race-control-start', selection }),
      { kind: 'accepted', executionId: accepted.executionId, replayed: true },
    )
    assert.equal(Number((await getDb().selectFrom('executions').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count), 1)
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})
