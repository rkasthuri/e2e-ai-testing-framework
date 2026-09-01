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
import { createHash } from 'node:crypto'
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
import { parseCanonicalTestSet } from '../src/core/test-design/TestDefinitionContract'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { SuiteService } from '../src/core/suites/SuiteService'
import { SuiteContractError, type CanonicalSuiteRevision, type DefinitionRevisionRef } from '../src/core/suites/SuiteContract'
import { ExecutionService, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { ExecutionRepository, type BeginExecutionInput } from '../src/core/storage/repositories/ExecutionRepository'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory, type PlaywrightPlanExecutionResult } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { ExecutionResultProjectionService, type ExecutionResultProjection } from '../src/core/execution/ExecutionResultProjectionService'
import { PersistedEvidenceAggregator } from '../src/core/execution/PersistedEvidenceAggregator'
import {
  ExecutionRunCoordinator,
  executorFailureDiagnosticEvidence,
} from '../src/core/execution/ExecutionRunCoordinator'
import {
  ExecutionRecoveryCoordinator,
  ExecutionRecoveryRefusedError,
} from '../src/core/execution/ExecutionRecoveryCoordinator'
import {
  materializeExecutablePlan,
  type MaterializedExecutablePlan,
} from '../src/core/execution/ExecutablePlanContract'
import {
  DiagnosticEvidenceConflictError,
  DiagnosticEvidenceRepository,
} from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import {
  parseDiagnosticEvidenceFactsV1,
  parseDiagnosticEvidenceV1,
  type DiagnosticEvidenceFactsV1,
} from '../src/core/execution/DiagnosticEvidenceContract'
import { HistoricalDefinitionAuthorityResolver } from '../src/core/execution/HistoricalDefinitionAuthorityResolver'
import { DiagnosticClassificationService } from '../src/core/execution/DiagnosticClassificationService'
import { DIAGNOSTIC_CLASSIFIER_VERSION } from '../src/core/execution/DiagnosticClassificationContract'
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

async function classifyPersistedDiagnostic(row: Awaited<ReturnType<DiagnosticEvidenceRepository['read']>>[number]) {
  return new DiagnosticClassificationService().classify({
    projectId: row.project_id,
    executionId: row.execution_id,
    runId: row.run_id,
    itemOrdinal: Number(row.item_ordinal),
    evidenceSchemaVersion: row.evidence_schema_version,
    evidenceHash: row.evidence_hash,
    classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
  })
}

function frozenContradictionFacts(): DiagnosticEvidenceFactsV1 {
  const contractRoot = path.resolve(process.cwd(), 'fixtures', 'm4-contract')
  const manifest = JSON.parse(fs.readFileSync(path.join(contractRoot, 'manifest.json'), 'utf8')) as {
    evidenceBases: Record<string, Record<string, unknown>>
  }
  const fixture = JSON.parse(fs.readFileSync(
    path.join(contractRoot, 'cases', 'integrity-invalid-contradiction.json'), 'utf8',
  )) as { base: string; operations: Array<{ path: string; value: unknown }> }
  const base = structuredClone(manifest.evidenceBases[fixture.base])
  for (const operation of fixture.operations) {
    if (!operation.path.startsWith('/') || operation.path.slice(1).includes('/')) {
      throw new Error('Frozen contradiction fixture operation is outside the supported top-level parity shape.')
    }
    base[operation.path.slice(1)] = structuredClone(operation.value)
  }
  const { authorityTemplate: _authorityTemplate, ...facts } = base
  return parseDiagnosticEvidenceFactsV1(facts)
}

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
      id: generation>=20?`checkout-flow-${generation}`:'checkout-flow', displayName: 'Observed checkout', confidence: 'partial', source: 'agent-proposed', roleId: 'shopper', linkedApiEndpointIds: [],
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

  startRawExecution(request: GovernedExecutionStartRequest) {
    return this.execution.start(request)
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

type Chunk0AcceptedDefinitionAuthority = {
  definitionSchemaVersion: 3
  testSetId: string
  testSetRevision: number
  testSetContentHash: string
  definitionId: string
  definitionContentHash: string
  supportSealHash: string
  routeEvidenceIdentityHash: string
  authenticationExpectationIdentityHash: string
  snapshotHash: string
}

type Chunk0SuiteAuthority = {
  suiteId: string
  suiteRevision: number
  suiteContentHash: string
}

type Chunk0Authority = {
  projectId: string
  executionId: string
  runId: string
  itemOrdinal: number
  resultId: string | null
  definitionId: string
  executablePlanHash: string
  acceptedDefinitionAuthority: Chunk0AcceptedDefinitionAuthority
  suiteAuthority: Chunk0SuiteAuthority | null
}

class Chunk0AuthorityIntegrityError extends Error {
  constructor() {
    super('Chunk 0 authority candidate does not match accepted historical Product authority.')
    this.name = 'Chunk0AuthorityIntegrityError'
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function deriveChunk0Authority(projectId: string, executionId: string): Promise<Chunk0Authority[]> {
  const read = await new PersistedEvidenceAggregator().read(projectId, executionId)
  if (read.kind !== 'ok' || read.aggregation.integrityState === 'invalid'
    || read.evidence.runs.length !== 1 || !read.aggregation.run.runId) throw new Chunk0AuthorityIntegrityError()
  const execution = read.evidence.execution

  const suiteValues = [execution.suite_id, execution.suite_revision, execution.suite_content_hash]
  const suiteAuthority = suiteValues.every(value => value === null)
    ? null
    : suiteValues.some(value => value === null)
      ? (() => { throw new Chunk0AuthorityIntegrityError() })()
      : {
          suiteId: execution.suite_id!,
          suiteRevision: Number(execution.suite_revision),
          suiteContentHash: execution.suite_content_hash!,
        }
  if (suiteAuthority && (!Number.isSafeInteger(suiteAuthority.suiteRevision) || suiteAuthority.suiteRevision < 1)) {
    throw new Chunk0AuthorityIntegrityError()
  }

  if(read.evidence.items.length===0)throw new Chunk0AuthorityIntegrityError()
  const resolver=new HistoricalDefinitionAuthorityResolver()
  return Promise.all(read.evidence.items.map(async item => {
    const result = read.evidence.results.find(candidate => Number(candidate.execution_item_ordinal) === Number(item.item_ordinal))
    const resolved=await resolver.resolve({projectId,executionId,runId:read.aggregation.run.runId!,itemOrdinal:Number(item.item_ordinal),
      resultId:result?.result_id??null,definitionId:item.definition_id,executablePlanHash:item.executable_plan_hash})
    return {
      projectId,
      executionId,
      runId: read.aggregation.run.runId!,
      itemOrdinal: Number(item.item_ordinal),
      resultId: result?.result_id ?? null,
      definitionId: item.definition_id,
      executablePlanHash: item.executable_plan_hash,
      acceptedDefinitionAuthority:resolved.acceptedDefinitionAuthority,
      suiteAuthority:resolved.suiteAuthority,
    }
  }))
}

function validateChunk0Authority(candidate: unknown, accepted: Chunk0Authority): void {
  if (JSON.stringify(candidate) !== JSON.stringify(accepted)) throw new Chunk0AuthorityIntegrityError()
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
      clickDataTest: async value => { assert.equal(value, 'checkout'); currentUrl = 'https://m2.example.test/checkout.html'; return 'one' as const },
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
      await sql.raw('DROP TRIGGER suite_member_authority_immutable_update').execute(getDb())
      await getDb().transaction().execute(async trx=>{
        await sql`PRAGMA defer_foreign_keys=ON`.execute(trx)
        await trx.updateTable('suite_revision_members').set({ member_ordinal: 3 })
          .where('suite_id', '=', suite.suiteId).where('suite_revision', '=', suite.revision)
          .where('member_ordinal', '=', 2).execute()
        await trx.updateTable('suite_revision_member_authorities').set({member_ordinal:3})
          .where('suite_id','=',suite.suiteId).where('suite_revision','=',suite.revision).where('member_ordinal','=',2).execute()
      })
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
        attack.label,
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

test('M4 Chunk 0 proves Suite-originated authority from accepted Execution through Run and Result', async () => {
  const context = await productSetup()
  try {
    const generation = new CanonicalTestDefinitionGenerationService()
    const intent = await generation.generateDiscoveredIntent(PROJECT, context.root, 'checkout')
    assert.equal(isSupportedNormalizedTestIntentV1(intent), true)
    if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Chunk 0 requires a canonical observed-flow intent.')
    await generation.saveReviewedDiscoveredIntent(PROJECT, context.root, intent, 'm4-chunk0-v3-save')

    const inventory = await new TestSetRepository().readInventory(PROJECT, { limit: 1 })
    if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3) {
      throw new Error('Chunk 0 v3 Definition authority was not persisted.')
    }
    const definition = inventory.current.testSet.definitions[0]
    assert.ok(definition)
    const candidates = await context.port.listCandidates(PROJECT)
    assert.deepEqual(candidates.map(candidate => candidate.definitionAuthority.definitionId), [definition!.id])

    const created = await context.port.createSuite({
      projectId: PROJECT,
      name: 'M4 Chunk 0 Sanity',
      purpose: 'sanity',
      changeIntentKey: 'm4-chunk0-suite-create',
      members: [{ ordinal: 1, definitionAuthority: candidates[0]!.definitionAuthority }],
    })
    assert.equal(created.kind, 'accepted')
    if (created.kind !== 'accepted') throw new Error('Chunk 0 Suite was not accepted.')
    const selection = {
      kind: 'suite_revision' as const,
      suiteId: created.suite.suiteId,
      suiteRevision: created.suite.revision,
    }

    const forgedClient = await context.port.startRawExecution({
      projectId: PROJECT,
      executionIntentKey: 'm4-chunk0-forged-client',
      workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
      selection,
      suiteContentHash: 'f'.repeat(64),
    } as GovernedExecutionStartRequest)
    assert.deepEqual(forgedClient, {
      kind: 'rejected',
      code: 'invalid_request',
      safeMessage: 'The governed execution request is malformed.',
    })

    const started = await context.port.startSuiteExecution(PROJECT, {
      executionIntentKey: 'm4-chunk0-suite-start', selection,
    })
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('Chunk 0 Suite execution was not accepted.')

    const acceptedBeforeHeadAdvance = await deriveChunk0Authority(PROJECT, started.executionId)
    assert.equal(acceptedBeforeHeadAdvance.length, 1)
    const accepted = acceptedBeforeHeadAdvance[0]!
    const evidenceRepository = new DiagnosticEvidenceRepository()
    const suiteEvidenceRows = await evidenceRepository.read(PROJECT, started.executionId)
    assert.equal(suiteEvidenceRows.length, 1)
    const suiteEvidence = JSON.parse(suiteEvidenceRows[0]!.evidence_json)
    assert.equal(suiteEvidence.authority.runId, accepted.runId)
    assert.equal(suiteEvidence.authority.resultId, accepted.resultId)
    assert.deepEqual(suiteEvidence.authority.suiteAuthority, accepted.suiteAuthority)
    assert.deepEqual(suiteEvidence.authority.acceptedDefinitionAuthority, accepted.acceptedDefinitionAuthority)
    assert.equal(suiteEvidenceRows[0]!.evidence_hash, hashJson(JSON.parse(suiteEvidenceRows[0]!.evidence_json)))
    const suiteV1ClassificationBeforeAdvance = await classifyPersistedDiagnostic(suiteEvidenceRows[0]!)
    assert.equal(suiteV1ClassificationBeforeAdvance.outcome.kind, 'refusal')
    if (suiteV1ClassificationBeforeAdvance.outcome.kind === 'refusal') {
      assert.equal(suiteV1ClassificationBeforeAdvance.outcome.refusalCode, 'insufficient_evidence')
    }
    await assert.rejects(getDb().updateTable('diagnostic_evidence').set({ evidence_hash: '0'.repeat(64) })
      .where('id', '=', suiteEvidenceRows[0]!.id).execute())
    await assert.rejects(getDb().deleteFrom('diagnostic_evidence').where('id', '=', suiteEvidenceRows[0]!.id).execute())
    assert.deepEqual(accepted.suiteAuthority, {
      suiteId: created.suite.suiteId,
      suiteRevision: created.suite.revision,
      suiteContentHash: created.suite.contentHash,
    })
    assert.equal(accepted.projectId, PROJECT)
    assert.equal(accepted.executionId, started.executionId)
    assert.equal(accepted.itemOrdinal, 1)
    assert.ok(accepted.runId.startsWith('run-'))
    assert.ok(accepted.resultId?.startsWith('result-'))
    assert.equal(accepted.definitionId, definition!.id)
    assert.equal(accepted.acceptedDefinitionAuthority.definitionId, definition!.id)
    assert.equal(accepted.acceptedDefinitionAuthority.testSetRevision, inventory.current.testSet.revision)

    const suiteV1RecoveryService = new ExecutionService({
      executor: { execute: async () => { throw new Error('controlled Suite v1 interrupted adapter') } },
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled Suite v1 recovery adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-suite-v1-recovery-process',
    })
    const suiteV1Recovery = await suiteV1RecoveryService.start({
      projectId: PROJECT, executionIntentKey: 'm4-suite-v1-recovery-start', selection,
      workspaceRoot: context.root, credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(suiteV1Recovery.kind, 'accepted')
    if (suiteV1Recovery.kind !== 'accepted') throw new Error('Suite v1 recovery execution was refused.')
    await suiteV1Recovery.completion
    await new ExecutionRecoveryCoordinator().reconcile({
      projectId: PROJECT, executionId: suiteV1Recovery.executionId,
      currentProcessInstanceId: 'm4-suite-v1-recovery-process', locallyActive: false,
      now: new Date(Date.now() + 5_000).toISOString(),
    })
    const suiteV1RecoveryRows = await new DiagnosticEvidenceRepository().read(PROJECT, suiteV1Recovery.executionId)
    assert.equal(suiteV1RecoveryRows.length, 1)
    const suiteV1RecoveredEvidence = JSON.parse(suiteV1RecoveryRows[0]!.evidence_json)
    assert.equal(suiteV1RecoveredEvidence.authority.resultId, null)
    assert.deepEqual(suiteV1RecoveredEvidence.authority.suiteAuthority, accepted.suiteAuthority)

    const revised = await context.port.reviseSuite({
      projectId: PROJECT,
      suiteId: created.suite.suiteId,
      expectedRevision: created.suite.revision,
      name: 'M4 Chunk 0 New Head',
      purpose: 'sanity',
      changeIntentKey: 'm4-chunk0-suite-revise',
      members: [{ ordinal: 1, definitionAuthority: candidates[0]!.definitionAuthority }],
    })
    assert.equal(revised.kind, 'accepted')
    if (revised.kind !== 'accepted') throw new Error('Chunk 0 current Suite head was not advanced.')
    assert.notEqual(revised.suite.contentHash, created.suite.contentHash)

    const historicalProjection = await new ExecutionResultProjectionService().read(PROJECT, started.executionId)
    assert.equal(historicalProjection.kind, 'ok')
    if (historicalProjection.kind !== 'ok') throw new Error('Chunk 0 historical Results projection is unavailable.')
    assert.deepEqual(historicalProjection.projection.execution.selectionAuthority, {
      kind: 'suite_revision',
      suiteId: created.suite.suiteId,
      suiteRevision: created.suite.revision,
      suiteContentHash: created.suite.contentHash,
      name: created.suite.name,
      purpose: 'sanity',
    })
    assert.deepEqual(await deriveChunk0Authority(PROJECT, started.executionId), acceptedBeforeHeadAdvance)

    const mutate = (change: (candidate: Record<string, unknown>) => void): unknown => {
      const candidate = structuredClone(accepted) as unknown as Record<string, unknown>
      change(candidate)
      return candidate
    }
    const suite = (candidate: Record<string, unknown>) => candidate.suiteAuthority as Record<string, unknown>
    const definitionAuthority = (candidate: Record<string, unknown>) => candidate.acceptedDefinitionAuthority as Record<string, unknown>
    const attacks: Array<[string, unknown]> = [
      ['floated suiteId', mutate(candidate => { suite(candidate).suiteId = 'suite-floated' })],
      ['floated suiteRevision', mutate(candidate => { suite(candidate).suiteRevision = 999 })],
      ['floated suiteContentHash', mutate(candidate => { suite(candidate).suiteContentHash = '0'.repeat(64) })],
      ['partial Suite tuple', mutate(candidate => { delete suite(candidate).suiteContentHash })],
      ['current-head Suite substitution', mutate(candidate => { candidate.suiteAuthority = {
        suiteId: revised.suite.suiteId,
        suiteRevision: revised.suite.revision,
        suiteContentHash: revised.suite.contentHash,
      } })],
      ['cross-project authority', mutate(candidate => { candidate.projectId = 'm4-cross-project' })],
      ['reordered Suite member ordinal', mutate(candidate => { candidate.itemOrdinal = 2 })],
      ['replaced Suite member Definition', mutate(candidate => { candidate.definitionId = 'definition-replaced' })],
      ['floated Run', mutate(candidate => { candidate.runId = 'run-floated' })],
      ['floated Result', mutate(candidate => { candidate.resultId = 'result-floated' })],
      ['mismatched plan', mutate(candidate => { candidate.executablePlanHash = '1'.repeat(64) })],
      ['current-head Definition substitution', mutate(candidate => {
        definitionAuthority(candidate).testSetRevision = Number(definitionAuthority(candidate).testSetRevision) + 1
      })],
    ]
    for (const [label, candidate] of attacks) {
      assert.throws(() => validateChunk0Authority(candidate, accepted), Chunk0AuthorityIntegrityError, label)
    }

    const crossProjectStart = await context.port.startRawExecution({
      projectId: 'm4-cross-project',
      executionIntentKey: 'm4-chunk0-cross-project',
      workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
      selection,
    })
    assert.equal(crossProjectStart.kind, 'rejected')
    if (crossProjectStart.kind === 'rejected') assert.equal(crossProjectStart.code, 'suite_not_found')

    const direct = await context.port.startRawExecution({
      projectId: PROJECT,
      executionIntentKey: 'm4-chunk0-direct-definition',
      definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision,
      workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(direct.kind, 'accepted')
    if (direct.kind !== 'accepted') throw new Error('Chunk 0 direct-Definition control was not accepted.')
    await direct.completion
    const directAuthority = (await deriveChunk0Authority(PROJECT, direct.executionId))[0]!
    assert.equal(directAuthority.suiteAuthority, null)
    const resolverBinding={projectId:directAuthority.projectId,executionId:directAuthority.executionId,runId:directAuthority.runId,
      itemOrdinal:directAuthority.itemOrdinal,resultId:directAuthority.resultId,definitionId:directAuthority.definitionId,
      executablePlanHash:directAuthority.executablePlanHash}
    const originalRoot=await getDb().selectFrom('executions').selectAll().where('execution_id','=',direct.executionId).executeTakeFirstOrThrow()
    const immutableExecutionTrigger=(await sql<{sql:string}>`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='executions_immutable_update'`.execute(getDb())).rows[0]!.sql
    await sql`DROP TRIGGER executions_immutable_update`.execute(getDb())
    const contradictions:Array<[string,Record<string,unknown>]>=[
      ['model authority',{model_row_id:Number(originalRoot.model_row_id)+1}],
      ['model version',{model_version:`${originalRoot.model_version}-contradiction`}],
      ['support seal',{support_seal_hash:'1'.repeat(64)}],
      ['route identity',{route_evidence_identity_hash:'2'.repeat(64)}],
      ['authentication identity',{authentication_expectation_identity_hash:'3'.repeat(64)}],
    ]
    for(const [label,change] of contradictions){
      await getDb().updateTable('executions').set(change).where('execution_id','=',direct.executionId).execute()
      await assert.rejects(new HistoricalDefinitionAuthorityResolver().resolve(resolverBinding),undefined,label)
      await getDb().updateTable('executions').set(originalRoot).where('execution_id','=',direct.executionId).execute()
    }
    await sql.raw(immutableExecutionTrigger).execute(getDb())
    const directEvidenceRows = await evidenceRepository.read(PROJECT, direct.executionId)
    assert.equal(directEvidenceRows.length, 1)
    assert.equal(JSON.parse(directEvidenceRows[0]!.evidence_json).authority.suiteAuthority, null)
    const contaminatedDirect = structuredClone(directAuthority) as Chunk0Authority
    contaminatedDirect.suiteAuthority = accepted.suiteAuthority
    assert.throws(
      () => validateChunk0Authority(contaminatedDirect, directAuthority),
      Chunk0AuthorityIntegrityError,
      'direct-Definition execution cannot be classified as Suite-originated',
    )

    const facts = parseDiagnosticEvidenceFactsV1({
      executor: suiteEvidence.executor,
      authentication: suiteEvidence.authentication,
      navigation: suiteEvidence.navigation,
      targetObservation: suiteEvidence.targetObservation,
      action: suiteEvidence.action,
      oracle: suiteEvidence.oracle,
    })
    const exactRetry = await evidenceRepository.append({
      binding: {
        projectId: accepted.projectId, executionId: accepted.executionId, runId: accepted.runId,
        itemOrdinal: accepted.itemOrdinal, resultId: accepted.resultId, definitionId: accepted.definitionId,
        executablePlanHash: accepted.executablePlanHash,
      },
      facts,
    })
    assert.equal(exactRetry.replayed, true)
    assert.equal(exactRetry.evidenceHash, suiteEvidenceRows[0]!.evidence_hash)
    const terminalRetry = await new ExecutionRunCoordinator().terminalize({
      projectId: accepted.projectId,
      executionId: accepted.executionId,
      runId: accepted.runId,
      processInstanceId: 'm4-terminal-retry',
      completedAt: '2026-08-31T12:00:00.000Z',
    })
    assert.equal(terminalRetry.expectedResultCount, 1)
    assert.equal(terminalRetry.recordedResultCount, 1)
    const exactBinding = {
      projectId: accepted.projectId, executionId: accepted.executionId, runId: accepted.runId,
      itemOrdinal: accepted.itemOrdinal, resultId: accepted.resultId, definitionId: accepted.definitionId,
      executablePlanHash: accepted.executablePlanHash,
    }
    for (const floatedBinding of [
      { ...exactBinding, projectId: 'project-floated' },
      { ...exactBinding, executionId: 'execution-floated' },
      { ...exactBinding, runId: 'run-floated' },
      { ...exactBinding, itemOrdinal: exactBinding.itemOrdinal + 1 },
      { ...exactBinding, resultId: 'result-floated' },
      { ...exactBinding, resultId: null },
      { ...exactBinding, definitionId: 'definition-floated' },
      { ...exactBinding, executablePlanHash: '0'.repeat(64) },
    ]) {
      await assert.rejects(evidenceRepository.append({ binding: floatedBinding, facts }))
    }
    await assert.rejects(evidenceRepository.append({
      binding: {
        projectId: accepted.projectId, executionId: accepted.executionId, runId: accepted.runId,
        itemOrdinal: accepted.itemOrdinal, resultId: accepted.resultId, definitionId: accepted.definitionId,
        executablePlanHash: accepted.executablePlanHash,
      },
      facts: { ...facts, oracle: facts.oracle.outcome === 'matched'
        ? { ...facts.oracle, outcome: 'mismatched', actual: '/conflicting-replay' }
        : { outcome: 'not_performed' } },
    }), DiagnosticEvidenceConflictError)
    assert.throws(() => parseDiagnosticEvidenceFactsV1({ ...facts, stack: 'raw prose is forbidden' }))
    assert.throws(() => parseDiagnosticEvidenceFactsV1({ ...facts,
      executor: { outcome: 'failed', failureClass: 'not_bounded' },
    }))
    assert.deepEqual(parseDiagnosticEvidenceFactsV1({ ...facts,
      executor: { outcome: 'failed', failureClass: 'executor_internal_failure' },
    }), { ...facts, executor: { outcome: 'failed', failureClass: 'executor_internal_failure' } })
    const contradictionFacts = frozenContradictionFacts()
    assert.deepEqual(parseDiagnosticEvidenceFactsV1(contradictionFacts), contradictionFacts)
    assert.throws(() => parseDiagnosticEvidenceFactsV1({ ...contradictionFacts,
      action: { outcome: 'completed', semantic: 'click_observed_data_test' },
    }))
    assert.throws(() => parseDiagnosticEvidenceFactsV1({ ...contradictionFacts,
      targetObservation: { ...contradictionFacts.targetObservation, cardinality: 'many' },
    }))
    assert.throws(() => parseDiagnosticEvidenceFactsV1({ ...contradictionFacts,
      oracle: { outcome: 'not_performed', explanation: 'prohibited prose' },
    }))
    assert.throws(() => parseDiagnosticEvidenceV1({ ...suiteEvidence, schemaVersion: 'forge.m4.diagnostic-evidence/v999' }))
    assert.throws(() => parseDiagnosticEvidenceV1({ ...suiteEvidence, authority: {
      ...suiteEvidence.authority, executablePlanHash: 'malformed-hash',
    } }))

    const failedService = new ExecutionService({
      executor: { execute: async () => ({ status: 'oracle_failed' as const, reasonCode: 'oracle_failed' as const,
        navigationUrl: 'https://m2.example.test/cart.html', finalUrl: 'https://m2.example.test/wrong.html',
        targetCardinality: 'one' as const }) },
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled failure adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-failed-evidence-process',
    })
    const failed = await failedService.start({
      projectId: PROJECT, executionIntentKey: 'm4-chunk1-direct-failed', definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision, workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(failed.kind, 'accepted')
    if (failed.kind !== 'accepted') throw new Error('Controlled failed direct execution was not accepted.')
    await failed.completion
    const failedRows = await evidenceRepository.read(PROJECT, failed.executionId)
    assert.equal(failedRows.length, 1)
    const failedEvidence = JSON.parse(failedRows[0]!.evidence_json)
    assert.equal(failedEvidence.authority.suiteAuthority, null)
    assert.equal(failedEvidence.oracle.outcome, 'mismatched')
    const failedClassification = await classifyPersistedDiagnostic(failedRows[0]!)
    assert.equal(failedClassification.outcome.kind, 'classified_failure')
    if (failedClassification.outcome.kind === 'classified_failure') {
      assert.equal(failedClassification.outcome.failureMode, 'oracle_mismatch')
    }

    const positiveMatrix: Array<{
      name: string
      expected: 'executor_failure' | 'authentication_not_established' | 'navigation_not_completed' | 'target_not_observed' | 'action_not_completed'
      observed: PlaywrightPlanExecutionResult
    }> = [
      { name: 'executor', expected: 'executor_failure', observed: {
        status: 'executor_failure', reasonCode: 'executor_failure', failureClass: 'browser_session_unavailable',
      } },
      { name: 'authentication', expected: 'authentication_not_established', observed: {
        status: 'authentication_failed', reasonCode: 'authentication_failed',
      } },
      { name: 'navigation', expected: 'navigation_not_completed', observed: {
        status: 'navigation_failed', reasonCode: 'navigation_failed', observedUrl: 'https://m2.example.test/login', failureClass: 'timeout',
      } },
      { name: 'target', expected: 'target_not_observed', observed: {
        status: 'action_failed', reasonCode: 'action_failed', navigationUrl: 'https://m2.example.test/cart.html',
        targetCardinality: 'zero', failureClass: 'target_not_actionable',
      } },
      { name: 'action', expected: 'action_not_completed', observed: {
        status: 'action_failed', reasonCode: 'action_failed', navigationUrl: 'https://m2.example.test/cart.html',
        targetCardinality: 'one', failureClass: 'interaction_failed',
      } },
    ]
    for (const candidate of positiveMatrix) {
      const service = new ExecutionService({
        executor: { execute: async () => candidate.observed },
        runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: `controlled ${candidate.name} adapter is available` }),
        credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
        processInstanceId: `m4-${candidate.name}-classification-process`,
      })
      const execution = await service.start({
        projectId: PROJECT,
        executionIntentKey: `m4-chunk2-${candidate.name}`,
        definitionIds: [definition!.id],
        revision: inventory.current.testSet.revision,
        workspaceRoot: context.root,
        credentialReference: CREDENTIAL_REFERENCE,
        runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
      })
      assert.equal(execution.kind, 'accepted', candidate.name)
      if (execution.kind !== 'accepted') throw new Error(`Controlled ${candidate.name} execution was not accepted.`)
      await execution.completion
      const rows = await new DiagnosticEvidenceRepository().read(PROJECT, execution.executionId)
      assert.equal(rows.length, 1, candidate.name)
      const first = await classifyPersistedDiagnostic(rows[0]!)
      const repeated = await classifyPersistedDiagnostic(rows[0]!)
      assert.deepEqual(first, repeated, candidate.name)
      assert.equal(first.outcome.kind, 'classified_failure', candidate.name)
      if (first.outcome.kind === 'classified_failure') assert.equal(first.outcome.failureMode, candidate.expected, candidate.name)
      const transported = await new ExecutionResultProjectionService().read(PROJECT, execution.executionId)
      assert.equal(transported.kind, 'ok', candidate.name)
      if (transported.kind === 'ok') {
        const diagnostic = transported.projection.items[0]!.diagnostic
        assert.equal(diagnostic?.state, 'available', candidate.name)
        if (diagnostic?.state === 'available') {
          assert.deepEqual(diagnostic.identity, first.identity, candidate.name)
          assert.deepEqual(diagnostic.outcome, first.outcome, candidate.name)
          assert.equal(diagnostic.displayString, first.displayString, candidate.name)
        }
      }
      assert.equal(Object.hasOwn(JSON.parse(rows[0]!.evidence_json), 'classification'), false, candidate.name)
    }

    let missingPlan: MaterializedExecutablePlan | null = null
    const missingService = new ExecutionService({
      executor: { execute: async plan => {
        missingPlan = materializeExecutablePlan(plan)
        throw new Error('controlled unstructured adapter failure')
      } },
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled test adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-missing-result-process',
    })
    const missing = await missingService.start({
      projectId: PROJECT,
      executionIntentKey: 'm4-chunk1-missing-result',
      definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision,
      workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(missing.kind, 'accepted')
    if (missing.kind !== 'accepted') throw new Error('Controlled missing-Result execution was not accepted.')
    await missing.completion
    const missingRun = await getDb().selectFrom('runs').select('run_id')
      .where('execution_id', '=', missing.executionId).executeTakeFirstOrThrow()
    if (!missingPlan) throw new Error('Controlled missing-Result plan was not captured.')
    await new ExecutionRunCoordinator().terminalize({
      projectId: PROJECT,
      executionId: missing.executionId,
      runId: missingRun.run_id,
      processInstanceId: 'm4-missing-result-process',
      completedAt: new Date(Date.now() + 1_000).toISOString(),
      missingResults: [{ itemOrdinal: 1, plan: missingPlan, facts: contradictionFacts }],
    })
    const missingRows = await evidenceRepository.read(PROJECT, missing.executionId)
    assert.equal(missingRows.length, 1)
    const missingEvidence = JSON.parse(missingRows[0]!.evidence_json)
    assert.equal(missingEvidence.authority.resultId, null)
    assert.deepEqual({
      executor: missingEvidence.executor,
      authentication: missingEvidence.authentication,
      navigation: missingEvidence.navigation,
      targetObservation: missingEvidence.targetObservation,
      action: missingEvidence.action,
      oracle: missingEvidence.oracle,
    }, contradictionFacts)
    assert.equal(Object.hasOwn(missingEvidence, 'classification'), false)
    assert.equal(Object.hasOwn(missingEvidence, 'diagnosticOutcome'), false)
    const contradictionClassification = await classifyPersistedDiagnostic(missingRows[0]!)
    assert.equal(contradictionClassification.outcome.kind, 'refusal')
    if (contradictionClassification.outcome.kind === 'refusal') {
      assert.equal(contradictionClassification.outcome.refusalCode, 'integrity_invalid')
      if (contradictionClassification.outcome.refusalCode === 'integrity_invalid') {
        assert.deepEqual(contradictionClassification.outcome.integrityFindings, ['diagnostic_evidence_contradiction'])
      }
    }
    const missingTransport = await new ExecutionResultProjectionService().read(PROJECT, missing.executionId)
    assert.equal(missingTransport.kind, 'ok')
    if (missingTransport.kind === 'ok') {
      const diagnostic = missingTransport.projection.items[0]!.diagnostic
      assert.equal(diagnostic?.state, 'available')
      if (diagnostic?.state === 'available') assert.deepEqual(diagnostic.outcome, contradictionClassification.outcome)
    }
    assert.equal((await getDb().selectFrom('execution_events').select('id')
      .where('execution_id', '=', missing.executionId).where('event_type', '=', 'terminal').execute()).length, 1)

    await closeDb()
    await openProjectDatabase(createWorkspace(context.root))
    assert.deepEqual(await deriveChunk0Authority(PROJECT, started.executionId), acceptedBeforeHeadAdvance)
    assert.equal((await deriveChunk0Authority(PROJECT, direct.executionId))[0]!.suiteAuthority, null)
    const reopenedSuiteRows = await new DiagnosticEvidenceRepository().read(PROJECT, started.executionId)
    assert.equal(reopenedSuiteRows[0]!.evidence_hash, suiteEvidenceRows[0]!.evidence_hash)
    assert.equal(reopenedSuiteRows[0]!.evidence_json, suiteEvidenceRows[0]!.evidence_json)
    assert.deepEqual(await classifyPersistedDiagnostic(reopenedSuiteRows[0]!), suiteV1ClassificationBeforeAdvance)
    await new ExecutionRunCoordinator().terminalize({
      projectId: PROJECT, executionId: missing.executionId, runId: missingRun.run_id,
      processInstanceId: 'm4-missing-result-process', completedAt: new Date(Date.now() + 2_000).toISOString(),
      missingResults: [{ itemOrdinal: 1, plan: missingPlan, facts: contradictionFacts }],
    })
    const replayedMissingRows = await new DiagnosticEvidenceRepository().read(PROJECT, missing.executionId)
    assert.equal(replayedMissingRows.length, 1)
    assert.equal(replayedMissingRows[0]!.evidence_hash, missingRows[0]!.evidence_hash)
    assert.equal(replayedMissingRows[0]!.evidence_json, missingRows[0]!.evidence_json)

    class FailingEvidenceRepository extends DiagnosticEvidenceRepository {
      override async append(): Promise<never> { throw new Error('controlled evidence persistence failure') }
    }
    const recoveryService = new ExecutionService({
      executor: { execute: async () => { throw new Error('controlled interrupted adapter') } },
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled recovery adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-recovery-evidence-process',
    })
    const recovering = await recoveryService.start({
      projectId: PROJECT, executionIntentKey: 'm4-chunk1-recovery-direct', definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision, workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(recovering.kind, 'accepted')
    if (recovering.kind !== 'accepted') throw new Error('Recovery direct execution was not accepted.')
    await recovering.completion
    const recoveringRun = await getDb().selectFrom('runs').selectAll()
      .where('execution_id', '=', recovering.executionId).executeTakeFirstOrThrow()
    const recoveringItem = await getDb().selectFrom('execution_items').selectAll()
      .where('execution_id', '=', recovering.executionId).executeTakeFirstOrThrow()
    const recovered = await new ExecutionRecoveryCoordinator().reconcile({
      projectId: PROJECT, executionId: recovering.executionId,
      currentProcessInstanceId: 'm4-recovery-evidence-process', locallyActive: false,
      now: new Date(Date.now() + 10_000).toISOString(),
    })
    assert.equal(recovered.action, 'recovered')
    assert.equal(recovered.status?.terminal, true)
    const recoveredRows = await new DiagnosticEvidenceRepository().read(PROJECT, recovering.executionId)
    assert.equal(recoveredRows.length, 1)
    const recoveredEvidence = JSON.parse(recoveredRows[0]!.evidence_json)
    assert.deepEqual({
      projectId: recoveredEvidence.authority.projectId,
      executionId: recoveredEvidence.authority.executionId,
      runId: recoveredEvidence.authority.runId,
      itemOrdinal: recoveredEvidence.authority.itemOrdinal,
      resultId: recoveredEvidence.authority.resultId,
      definitionId: recoveredEvidence.authority.definitionId,
      executablePlanHash: recoveredEvidence.authority.executablePlanHash,
    }, {
      projectId: PROJECT, executionId: recovering.executionId, runId: recoveringRun.run_id,
      itemOrdinal: 1, resultId: null, definitionId: recoveringItem.definition_id,
      executablePlanHash: recoveringItem.executable_plan_hash,
    })
    assert.deepEqual({
      executor: recoveredEvidence.executor, authentication: recoveredEvidence.authentication,
      navigation: recoveredEvidence.navigation, targetObservation: recoveredEvidence.targetObservation,
      action: recoveredEvidence.action, oracle: recoveredEvidence.oracle,
    }, {
      executor: { outcome: 'not_started' }, authentication: { state: 'not_performed' },
      navigation: { outcome: 'not_performed' }, targetObservation: { outcome: 'not_performed' },
      action: { outcome: 'not_performed' }, oracle: { outcome: 'not_performed' },
    })
    assert.equal((await getDb().selectFrom('test_results').select('result_id')
      .where('run_id', '=', recoveringRun.run_id).execute()).length, 0)
    assert.equal((await getDb().selectFrom('execution_events').select('id')
      .where('execution_id', '=', recovering.executionId).where('event_type', '=', 'terminal').execute()).length, 1)
    const recoveredReplay = await new ExecutionRecoveryCoordinator().reconcile({
      projectId: PROJECT, executionId: recovering.executionId,
      currentProcessInstanceId: 'm4-recovery-replay-process', locallyActive: false,
      now: new Date(Date.now() + 20_000).toISOString(),
    })
    assert.equal(recoveredReplay.action, 'already_terminal')
    const replayedRecoveryRows = await new DiagnosticEvidenceRepository().read(PROJECT, recovering.executionId)
    assert.deepEqual(replayedRecoveryRows.map(row => [row.evidence_hash, row.evidence_json]),
      recoveredRows.map(row => [row.evidence_hash, row.evidence_json]))
    await closeDb()
    await openProjectDatabase(createWorkspace(context.root))
    const reopenedRecoveryRows = await new DiagnosticEvidenceRepository().read(PROJECT, recovering.executionId)
    assert.deepEqual(reopenedRecoveryRows.map(row => [row.evidence_hash, row.evidence_json]),
      recoveredRows.map(row => [row.evidence_hash, row.evidence_json]))
    const recoveredClassification = await classifyPersistedDiagnostic(reopenedRecoveryRows[0]!)
    assert.equal(recoveredClassification.outcome.kind, 'refusal')
    if (recoveredClassification.outcome.kind === 'refusal') {
      assert.equal(recoveredClassification.outcome.refusalCode, 'insufficient_evidence')
    }

    class ConflictingRecoveryEvidenceRepository extends DiagnosticEvidenceRepository {
      override append(write: Parameters<DiagnosticEvidenceRepository['append']>[0], transaction?: Parameters<DiagnosticEvidenceRepository['append']>[1]) {
        return super.append({ ...write, facts: executorFailureDiagnosticEvidence() }, transaction)
      }
    }
    await assert.rejects(new ExecutionRecoveryCoordinator(
      getDb, undefined, undefined, undefined, undefined, new ConflictingRecoveryEvidenceRepository(),
    ).reconcile({
      projectId: PROJECT, executionId: recovering.executionId,
      currentProcessInstanceId: 'm4-recovery-conflict-process', locallyActive: false,
      now: new Date(Date.now() + 30_000).toISOString(),
    }), (cause: unknown) => cause instanceof ExecutionRecoveryRefusedError && cause.code === 'conflicting_provenance')

    const rollbackService = new ExecutionService({
      executor: { execute: async () => { throw new Error('controlled recovery rollback adapter') } },
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled recovery rollback adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-recovery-rollback-process',
    })
    const rollback = await rollbackService.start({
      projectId: PROJECT, executionIntentKey: 'm4-chunk1-recovery-rollback', definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision, workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(rollback.kind, 'accepted')
    if (rollback.kind !== 'accepted') throw new Error('Recovery rollback execution was not accepted.')
    await rollback.completion
    const rollbackRun = await getDb().selectFrom('runs').selectAll()
      .where('execution_id', '=', rollback.executionId).executeTakeFirstOrThrow()
    await assert.rejects(new ExecutionRecoveryCoordinator(
      getDb, undefined, undefined, undefined, undefined, new FailingEvidenceRepository(),
    ).reconcile({
      projectId: PROJECT, executionId: rollback.executionId,
      currentProcessInstanceId: 'm4-recovery-rollback-process', locallyActive: false,
      now: new Date(Date.now() + 40_000).toISOString(),
    }), (cause: unknown) => cause instanceof ExecutionRecoveryRefusedError && cause.code === 'recovery_persistence_failed')
    assert.equal((await getDb().selectFrom('execution_events').select('id')
      .where('execution_id', '=', rollback.executionId).where('event_type', '=', 'terminal').execute()).length, 0)
    assert.equal((await getDb().selectFrom('diagnostic_evidence').select('id')
      .where('execution_id', '=', rollback.executionId).execute()).length, 0)
    assert.equal((await getDb().selectFrom('runs').select('lifecycle')
      .where('run_id', '=', rollbackRun.run_id).executeTakeFirstOrThrow()).lifecycle, 'running')
    await new ExecutionRecoveryCoordinator().reconcile({
      projectId: PROJECT, executionId: rollback.executionId,
      currentProcessInstanceId: 'm4-recovery-rollback-process', locallyActive: false,
      now: new Date(Date.now() + 50_000).toISOString(),
    })

    const atomicCoordinator = new ExecutionRunCoordinator(
      getDb, undefined, undefined, undefined,
      () => 'run-m4-atomic-failure', () => 'result-m4-atomic-failure', undefined,
      new FailingEvidenceRepository(),
    )
    const atomicService = new ExecutionService({
      executor: { execute: async () => ({ status: 'executor_failure' as const, reasonCode: 'executor_failure' as const }) },
      coordinator: atomicCoordinator,
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'controlled test adapter is available' }),
      credentials: new EnvironmentCredentialExecutionScope({ M2_PRODUCT_USER: 'shopper', M2_PRODUCT_PASSWORD: 'secret' }),
      processInstanceId: 'm4-atomic-failure-process',
    })
    const atomic = await atomicService.start({
      projectId: PROJECT,
      executionIntentKey: 'm4-chunk1-atomic-failure',
      definitionIds: [definition!.id],
      revision: inventory.current.testSet.revision,
      workspaceRoot: context.root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m2.example.test', loginUrl: 'https://m2.example.test' },
    })
    assert.equal(atomic.kind, 'accepted')
    if (atomic.kind !== 'accepted') throw new Error('Atomic failure control was not accepted.')
    await atomic.completion
    assert.equal((await getDb().selectFrom('test_results').select('result_id')
      .where('run_id', '=', 'run-m4-atomic-failure').execute()).length, 0)
    assert.equal((await getDb().selectFrom('diagnostic_evidence').select('id')
      .where('run_id', '=', 'run-m4-atomic-failure').execute()).length, 0)
    assert.equal((await getDb().selectFrom('execution_events').select('id')
      .where('execution_id', '=', atomic.executionId).where('event_type', '=', 'terminal').execute()).length, 0)
  } finally {
    await closeDb()
    fs.rmSync(context.root, { recursive: true, force: true })
  }
})

test('M4 Chunk 0B proves ordered two-member Suite v2 authority survives head advancement and restart', async () => {
  const context=await productSetup()
  try{
    const generation=new CanonicalTestDefinitionGenerationService()
    const firstIntent=await generation.generateDiscoveredIntent(PROJECT,context.root,'checkout')
    if(!isSupportedNormalizedTestIntentV1(firstIntent))throw new Error('Chunk 0B first intent is unavailable.')
    await generation.saveReviewedDiscoveredIntent(PROJECT,context.root,firstIntent,'m4-chunk0b-first-save')
    const firstInventory=await new TestSetRepository().readInventory(PROJECT,{limit:1})
    if('kind' in firstInventory||!firstInventory.current||firstInventory.current.testSet.schemaVersion!==3)throw new Error('Chunk 0B first v3 row is unavailable.')
    const first={rowId:firstInventory.current.rowId,testSet:firstInventory.current.testSet,contentHash:firstInventory.current.contentHash}

    await commitObservedModel(context.root,20)
    const secondIntent=await generation.generateDiscoveredIntent(PROJECT,context.root,'checkout')
    if(!isSupportedNormalizedTestIntentV1(secondIntent))throw new Error('Chunk 0B second intent is unavailable.')
    await generation.saveReviewedDiscoveredIntent(PROJECT,context.root,secondIntent,'m4-chunk0b-second-save')
    const secondInventory=await new TestSetRepository().readInventory(PROJECT,{limit:1})
    if('kind' in secondInventory||!secondInventory.current||secondInventory.current.testSet.schemaVersion!==3)throw new Error('Chunk 0B second v3 row is unavailable.')
    const second={rowId:secondInventory.current.rowId,testSet:secondInventory.current.testSet,contentHash:secondInventory.current.contentHash}
    assert.notEqual(first.testSet.definitions[0]!.id,second.testSet.definitions[0]!.id)

    const members=[first,second].map(source=>({testSetRowId:source.rowId,testSetId:source.testSet.testSetId,
      testSetRevision:source.testSet.revision,testSetContentHash:source.contentHash,definitionSchemaVersion:3 as const,
      definitionId:source.testSet.definitions[0]!.id}))
    const suite=await new SuiteService(undefined,()=>new Date().toISOString(),()=> 'suite-m4-chunk0b').create({
      schemaVersion:2,projectId:PROJECT,name:'M4 Chunk 0B Multi-source Sanity',changeIntentKey:'m4-chunk0b-suite-create',members,
    })
    assert.equal(suite.schemaVersion,2)
    assert.deepEqual(suite.members.map(member=>member.definitionAuthority),members)
    const started=await context.port.startSuiteExecution(PROJECT,{executionIntentKey:'m4-chunk0b-start',selection:{kind:'suite_revision',suiteId:suite.suiteId,suiteRevision:suite.revision}})
    assert.equal(started.kind,'accepted')
    if(started.kind!=='accepted')throw new Error('Chunk 0B execution was refused.')
    let recoveryCalls=0
    const partialRecoveryService=new ExecutionService({
      executor:{execute:async()=>{
        recoveryCalls+=1
        if(recoveryCalls===2)throw new Error('controlled Suite v2 interrupted adapter')
        return {status:'completed' as const,reasonCode:'completed' as const,
          navigationUrl:'https://m2.example.test/cart.html',finalUrl:'https://m2.example.test/checkout.html',
          targetCardinality:'one' as const}
      }},
      runnerReadiness:()=>({available:true,safeCode:'ready',safeMessage:'controlled Suite v2 recovery adapter is available'}),
      credentials:new EnvironmentCredentialExecutionScope({M2_PRODUCT_USER:'shopper',M2_PRODUCT_PASSWORD:'secret'}),
      processInstanceId:'m4-chunk0b-recovery-process',
    })
    const recoveringSuite=await partialRecoveryService.start({projectId:PROJECT,
      executionIntentKey:'m4-chunk0b-recovery-start',
      selection:{kind:'suite_revision',suiteId:suite.suiteId,suiteRevision:suite.revision},
      workspaceRoot:context.root,credentialReference:CREDENTIAL_REFERENCE,
      runtime:{baseUrl:'https://m2.example.test',loginUrl:'https://m2.example.test'}})
    assert.equal(recoveringSuite.kind,'accepted')
    if(recoveringSuite.kind!=='accepted')throw new Error('Chunk 0B recovery execution was refused.')
    await recoveringSuite.completion
    const recoveringSuiteRun=await getDb().selectFrom('runs').selectAll()
      .where('execution_id','=',recoveringSuite.executionId).executeTakeFirstOrThrow()
    const observedBeforeRecovery=await getDb().selectFrom('test_results').selectAll()
      .where('run_id','=',recoveringSuiteRun.run_id).execute()
    assert.deepEqual(observedBeforeRecovery.map(result=>Number(result.execution_item_ordinal)),[1])
    const observedEvidenceBeforeRecovery=await new DiagnosticEvidenceRepository().read(PROJECT,recoveringSuite.executionId)
    assert.equal(observedEvidenceBeforeRecovery.length,1)
    assert.equal(JSON.parse(observedEvidenceBeforeRecovery[0]!.evidence_json).authority.resultId,
      observedBeforeRecovery[0]!.result_id)
    const root=await getDb().selectFrom('executions').selectAll().where('execution_id','=',started.executionId).executeTakeFirstOrThrow()
    assert.equal(root.test_set_authority_scope,'per_item')
    for(const value of [root.test_set_id,root.test_set_revision,root.definition_schema_version,root.model_row_id,root.model_version,
      root.source_observation_id,root.support_seal_hash,root.route_evidence_identity_hash,root.authentication_expectation_identity_hash])assert.equal(value,null)
    const persisted=await getDb().selectFrom('execution_item_authorities').selectAll().where('execution_id','=',started.executionId).orderBy('item_ordinal').execute()
    assert.deepEqual(persisted.map(row=>[Number(row.item_ordinal),Number(row.test_set_row_id),row.definition_id]),members.map((member,index)=>[index+1,member.testSetRowId,member.definitionId]))
    const perItemProjection=await new ExecutionResultProjectionService().read(PROJECT,started.executionId)
    assert.equal(perItemProjection.kind,'ok')
    if(perItemProjection.kind==='ok'){
      assert.deepEqual(perItemProjection.projection.execution.definitionAuthority,{scope:'per_item'})
      assert.deepEqual(perItemProjection.projection.items.map(item=>item.diagnostic?.state),['available','available'])
      assert.equal(JSON.stringify(perItemProjection).includes('"schemaVersion":0'),false)
      assert.equal(JSON.stringify(perItemProjection).includes('"revision":0'),false)
      assert.equal(JSON.stringify(perItemProjection).includes('"modelRowId":0'),false)
    }
    const accepted=await deriveChunk0Authority(PROJECT,started.executionId)
    assert.deepEqual(accepted.map(item=>item.definitionId),members.map(member=>member.definitionId))
    const evidenceBeforeHeadAdvance=await new DiagnosticEvidenceRepository().read(PROJECT,started.executionId)
    assert.equal(evidenceBeforeHeadAdvance.length,2)
    const suiteV2ClassificationsBeforeHeadAdvance=await Promise.all(evidenceBeforeHeadAdvance.map(classifyPersistedDiagnostic))
    assert.deepEqual(evidenceBeforeHeadAdvance.map(row=>{
      const evidence=JSON.parse(row.evidence_json)
      return [evidence.authority.itemOrdinal,evidence.authority.definitionId,
        evidence.authority.acceptedDefinitionAuthority.testSetId,
        evidence.authority.acceptedDefinitionAuthority.testSetRevision,
        evidence.authority.suiteAuthority]
    }),accepted.map(item=>[item.itemOrdinal,item.definitionId,item.acceptedDefinitionAuthority.testSetId,
      item.acceptedDefinitionAuthority.testSetRevision,item.suiteAuthority]))

    await commitObservedModel(context.root,21)
    await new CanonicalTestDefinitionGenerationService().generate(PROJECT,context.root,'m4-chunk0b-new-head')
    assert.deepEqual(await deriveChunk0Authority(PROJECT,started.executionId),accepted)
    assert.deepEqual((await new DiagnosticEvidenceRepository().read(PROJECT,started.executionId))
      .map(row=>[row.evidence_hash,row.evidence_json]),evidenceBeforeHeadAdvance.map(row=>[row.evidence_hash,row.evidence_json]))
    await closeDb();await openProjectDatabase(createWorkspace(context.root))
    const firstRecoveredSuiteDecision=await new ExecutionRecoveryCoordinator().reconcile({projectId:PROJECT,
      executionId:recoveringSuite.executionId,currentProcessInstanceId:'m4-chunk0b-recovery-process',
      locallyActive:false,now:new Date(Date.now()+60_000).toISOString()})
    assert.equal(firstRecoveredSuiteDecision.action,'recovered')
    class NoCurrentHeadExecutionRepository extends ExecutionRepository{
      currentHeadLookups=0
      protected override async readCurrentTestSet():Promise<any>{this.currentHeadLookups+=1;throw new Error('Suite v2 invoked current-head lookup')}
    }
    const noLookup=new NoCurrentHeadExecutionRepository(()=>getDb())
    const acceptedItems=await getDb().selectFrom('execution_items').selectAll().where('execution_id','=',started.executionId).orderBy('item_ordinal').execute()
    const directAcceptance:BeginExecutionInput={executionId:'execution-m4-chunk0b-no-head',projectId:PROJECT,
      processInstanceId:'process-m4-chunk0b-no-head',startedAt:'2026-08-30T12:00:00.000Z',executionPlanHash:root.manifest_hash,
      executionIntentKey:'m4-chunk0b-no-head',executionIntentFingerprint:'7'.repeat(64),
      expectedTestSetContentHash:first.contentHash,definitionSchemaVersion:3,expectedModelRowId:1,expectedModelVersion:'unused-v2-root',
      sourceObservationId:null,supportSealHash:'8'.repeat(64),routeEvidenceIdentityHash:'9'.repeat(64),
      authenticationExpectationIdentityHash:'a'.repeat(64),suiteAuthority:{suiteId:suite.suiteId,suiteRevision:suite.revision,suiteContentHash:suite.contentHash},
      manifestItems:acceptedItems.map(item=>({itemOrdinal:Number(item.item_ordinal),definitionId:item.definition_id,
        executablePlanHash:item.executable_plan_hash,oracleKind:item.oracle_kind as 'subject_observable',oracleSubjectId:item.oracle_subject_id!}))}
    assert.deepEqual(await noLookup.beginExecution(directAcceptance),{kind:'accepted'})
    assert.equal(noLookup.currentHeadLookups,0)
    await closeDb();await openProjectDatabase(createWorkspace(context.root))
    assert.deepEqual(await deriveChunk0Authority(PROJECT,started.executionId),accepted)
    assert.deepEqual((await new DiagnosticEvidenceRepository().read(PROJECT,started.executionId))
      .map(row=>[row.evidence_hash,row.evidence_json]),evidenceBeforeHeadAdvance.map(row=>[row.evidence_hash,row.evidence_json]))
    const reopenedSuiteV2Rows=await new DiagnosticEvidenceRepository().read(PROJECT,started.executionId)
    assert.deepEqual(await Promise.all(reopenedSuiteV2Rows.map(classifyPersistedDiagnostic)),
      suiteV2ClassificationsBeforeHeadAdvance)
    const reopenedTransport=await new ExecutionResultProjectionService().read(PROJECT,started.executionId)
    assert.equal(reopenedTransport.kind,'ok')
    if(reopenedTransport.kind==='ok'){
      assert.deepEqual(reopenedTransport.projection.execution.definitionAuthority,{scope:'per_item'})
      assert.deepEqual(reopenedTransport.projection.items.map(item=>item.diagnostic?.state),['available','available'])
      assert.deepEqual(reopenedTransport.projection.items.map(item=>item.diagnostic?.state==='available'
        ? item.diagnostic.outcome:null),suiteV2ClassificationsBeforeHeadAdvance.map(value=>value.outcome))
    }
    const reopened=await new SuiteService().read(PROJECT,suite.suiteId,suite.revision)
    assert.deepEqual(reopened,suite)
    const recoveredSuiteDecision=await new ExecutionRecoveryCoordinator().reconcile({projectId:PROJECT,
      executionId:recoveringSuite.executionId,currentProcessInstanceId:'m4-chunk0b-recovery-process',
      locallyActive:false,now:new Date(Date.now()+70_000).toISOString()})
    assert.equal(recoveredSuiteDecision.action,'already_terminal')
    const recoveredSuiteRows=await new DiagnosticEvidenceRepository().read(PROJECT,recoveringSuite.executionId)
    assert.equal(recoveredSuiteRows.length,2)
    assert.deepEqual(recoveredSuiteRows.slice(0,1).map(row=>[row.evidence_hash,row.evidence_json]),
      observedEvidenceBeforeRecovery.map(row=>[row.evidence_hash,row.evidence_json]))
    const recoveredSuiteAuthority=await deriveChunk0Authority(PROJECT,recoveringSuite.executionId)
    assert.deepEqual(recoveredSuiteRows.map(row=>{
      const evidence=JSON.parse(row.evidence_json)
      return [evidence.authority.itemOrdinal,evidence.authority.resultId,evidence.authority.definitionId,
        evidence.authority.executablePlanHash,evidence.authority.acceptedDefinitionAuthority,
        evidence.authority.suiteAuthority]
    }),recoveredSuiteAuthority.map(authority=>[authority.itemOrdinal,authority.resultId,authority.definitionId,
      authority.executablePlanHash,authority.acceptedDefinitionAuthority,authority.suiteAuthority]))
    assert.equal(JSON.parse(recoveredSuiteRows[0]!.evidence_json).authority.resultId,observedBeforeRecovery[0]!.result_id)
    assert.equal(JSON.parse(recoveredSuiteRows[1]!.evidence_json).authority.resultId,null)
    assert.deepEqual(recoveredSuiteAuthority.map(authority=>authority.acceptedDefinitionAuthority.testSetRevision),
      members.map(member=>member.testSetRevision))
    assert.deepEqual(recoveredSuiteAuthority.map(authority=>authority.suiteAuthority),
      members.map(()=>({suiteId:suite.suiteId,suiteRevision:suite.revision,suiteContentHash:suite.contentHash})))
    const recoverySource=fs.readFileSync(path.resolve(process.cwd(),'src','core','execution','ExecutionRecoveryCoordinator.ts'),'utf8')
    assert.doesNotMatch(recoverySource,/ExecutionResultProjectionService|TestSetRepository|readInventory|currentHead/)
  }finally{await closeDb();fs.rmSync(context.root,{recursive:true,force:true})}
})
