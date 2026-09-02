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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  DiagnosticInsightsIntegrityError,
  DiagnosticInsightsService,
  InvalidDiagnosticInsightsProjectIdError,
  UnsupportedDiagnosticEvidenceSchemaVersionError,
  type DiagnosticInsightsReadModel,
} from '../src/core/execution/DiagnosticInsightsService'
import {
  DIAGNOSTIC_CLASSIFIER_VERSION,
  UnsupportedDiagnosticClassifierVersionError,
} from '../src/core/execution/DiagnosticClassificationContract'
import {
  DiagnosticClassificationService,
  DiagnosticEvidenceUnreadableError,
} from '../src/core/execution/DiagnosticClassificationService'
import {
  canonicalDiagnosticJson,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  parseDiagnosticEvidenceV1,
  type DiagnosticEvidenceV1,
} from '../src/core/execution/DiagnosticEvidenceContract'
import type { DiagnosticEvidenceIdentity } from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import { DiagnosticEvidenceRepository } from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import type { DiagnosticEvidenceRow } from '../src/core/storage/types'
import { closeDb, getDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationBoundary } from '../src/core/observation/ObservationTypes'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { SuiteService } from '../src/core/suites/SuiteService'
import { ExecutionService } from '../src/core/execution/ExecutionService'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { HistoricalDefinitionAuthorityResolver } from '../src/core/execution/HistoricalDefinitionAuthorityResolver'

type JsonObject = Record<string, any>

const CONTRACT_ROOT = path.resolve(__dirname, '..', 'fixtures', 'm4-contract')
const manifest = JSON.parse(readFileSync(path.join(CONTRACT_ROOT, 'manifest.json'), 'utf8')) as JsonObject
const REQUEST = {
  projectId: 'project-m4-contract',
  evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
}
const FAILURE_COUNTS = {
  executor_failure: 1,
  authentication_not_established: 1,
  navigation_not_completed: 1,
  target_not_observed: 1,
  action_not_completed: 1,
  oracle_mismatch: 1,
}
const ZERO_FAILURE_COUNTS = Object.fromEntries(Object.keys(FAILURE_COUNTS).map(key => [key, 0]))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function applyOperations(value: JsonObject, operations: JsonObject[]): JsonObject {
  const result = clone(value)
  for (const operation of operations) {
    const segments = String(operation.path).slice(1).split('/')
      .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    const key = segments.pop()
    assert.ok(key)
    let parent = result
    for (const segment of segments) parent = parent[segment] as JsonObject
    if (operation.op === 'remove') delete parent[key]
    else parent[key] = clone(operation.value)
  }
  return result
}

function fixture(relativePath: string): JsonObject {
  return JSON.parse(readFileSync(path.join(CONTRACT_ROOT, relativePath), 'utf8')) as JsonObject
}

function materialize(
  relativePath: string,
  ordinal: number,
  authorityChanges: JsonObject = {},
): DiagnosticEvidenceV1 {
  const caseFile = fixture(relativePath)
  const base = clone(manifest.evidenceBases[caseFile.base]) as JsonObject
  const authority = clone(manifest.authorityTemplates[base.authorityTemplate]) as JsonObject
  delete base.authorityTemplate
  authority.executionId = `execution-cert-${ordinal}`
  authority.runId = `run-cert-${ordinal}`
  authority.itemOrdinal = ordinal
  if (authority.resultId !== null) authority.resultId = `result-cert-${ordinal}`
  Object.assign(authority, clone(authorityChanges))
  return parseDiagnosticEvidenceV1(applyOperations({
    schemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
    authority,
    ...base,
  }, caseFile.operations))
}

function evidenceHash(evidence: DiagnosticEvidenceV1): string {
  return createHash('sha256').update(canonicalDiagnosticJson(evidence)).digest('hex')
}

function rowFor(evidence: DiagnosticEvidenceV1, id: number): DiagnosticEvidenceRow {
  return {
    id,
    evidence_schema_version: evidence.schemaVersion,
    evidence_hash: evidenceHash(evidence),
    project_id: evidence.authority.projectId,
    execution_id: evidence.authority.executionId,
    run_id: evidence.authority.runId,
    item_ordinal: evidence.authority.itemOrdinal,
    result_id: evidence.authority.resultId,
    definition_id: evidence.authority.definitionId,
    executable_plan_hash: evidence.authority.executablePlanHash,
    accepted_definition_authority_json: canonicalDiagnosticJson(evidence.authority.acceptedDefinitionAuthority),
    suite_authority_json: evidence.authority.suiteAuthority === null
      ? null
      : canonicalDiagnosticJson(evidence.authority.suiteAuthority),
    evidence_json: canonicalDiagnosticJson(evidence),
  }
}

function sameIdentity(row: DiagnosticEvidenceRow, identity: DiagnosticEvidenceIdentity): boolean {
  return row.project_id === identity.projectId
    && row.execution_id === identity.executionId
    && row.run_id === identity.runId
    && Number(row.item_ordinal) === identity.itemOrdinal
    && row.evidence_schema_version === identity.evidenceSchemaVersion
}

class CertificationEvidencePort {
  partitionReads = 0
  exactReads = 0

  constructor(readonly rows: DiagnosticEvidenceRow[]) {}

  async readProjectPartition(): Promise<DiagnosticEvidenceRow[]> {
    this.partitionReads += 1
    return this.rows.map(row => ({ ...row }))
  }

  async readExact(identity: DiagnosticEvidenceIdentity): Promise<DiagnosticEvidenceRow | null> {
    this.exactReads += 1
    const row = this.rows.find(candidate => sameIdentity(candidate, identity))
    return row ? { ...row } : null
  }
}

function tenDiagnosticRows(): DiagnosticEvidenceRow[] {
  const cases = [
    'cases/oracle-mismatch.json',
    'cases/target-not-observed.json',
    'cases/action-not-completed.json',
    'cases/navigation-not-completed.json',
    'cases/authentication-not-established.json',
    'cases/executor-failure.json',
    'cases/insufficient-evidence.json',
    'cases/insufficient-evidence.json',
    'cases/insufficient-evidence.json',
    'cases/integrity-invalid-contradiction.json',
  ]
  return cases.map((relativePath, index) => rowFor(materialize(relativePath, index + 1), index + 1))
}

const POS_3_PROJECT = 'm4-cert-real-suite-v2'
const POS_3_START = '2026-09-02T12:00:00.000Z'
const POS_3_END = '2026-09-02T12:00:01.000Z'
const POS_3_CREDENTIAL_REFERENCE = { usernameEnv: 'M4_CERT_USER', passwordEnv: 'M4_CERT_PASSWORD' }

function pos3Boundary(scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' }): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1', kind: 'document',
    scope,
    startedAt: POS_3_START, endedAt: POS_3_END, completion: 'complete',
    policyId: 'forge.m4-cert-pos-3', policyVersion: '1',
  }
}

function pos3Model(runId: string, generation: number): AppModelCandidate {
  const sourceId = `cert-source-${generation}`
  const targetId = `cert-target-${generation}`
  const controlId = `cert-control-${generation}`
  return {
    schemaVersion: '2.0', generatedAt: POS_3_END, generatedBy: 'engine', classificationRunId: runId,
    app: {
      name: POS_3_PROJECT, displayName: 'M4 Cert Suite v2', baseUrl: 'https://m4-cert.example.test', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: `m4-cert-pos-3-${generation}`, crawledAt: POS_3_END, crawledBy: 'engine', crawlDurationMs: 1000,
        pagesBudget: 2, pagesDiscovered: 2, pagesSkipped: 0, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'cert-user', displayName: 'Cert user', authFlow: 'form-login', credentialsEnvKey: 'M4_CERT_CREDENTIALS',
      storageStatePath: null, reachablePageIds: [sourceId, targetId], restrictedPageIds: [], authOutcome: 'succeeded',
    }],
    pages: [{
      id: sourceId, displayName: `Source ${generation}`, urlPattern: `/source-${generation}`, urlPatternType: 'exact',
      fingerprint: `source-${generation}`, fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['cert-user'],
      isAuthPage: false,
      module: { name: `cert-area-${generation}`, confidence: 'high', method: 'rule', evidenceIds: [sourceId], source: 'evidence-matched', reason: 'Observed Cert source.' },
      elements: [{
        id: controlId, name: 'continue', kind: 'button', label: 'Continue', critical: true, aiNamed: false,
        strategies: [{ type: 'data-test', value: `go-${generation}`, confidence: 1 }], tier3Assertions: [],
        cardinality: { kind: 'single' }, observedState: 'visible', href: null,
      }],
    }, {
      id: targetId, displayName: `Target ${generation}`, urlPattern: `/target-${generation}`, urlPatternType: 'exact',
      fingerprint: `target-${generation}`, fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['cert-user'],
      isAuthPage: false,
      module: { name: `cert-target-${generation}`, confidence: 'high', method: 'rule', evidenceIds: [targetId], source: 'evidence-matched', reason: 'Observed Cert target.' },
      elements: [],
    }],
    flows: [{
      id: `cert-flow-${generation}`, displayName: `Cert flow ${generation}`, confidence: 'partial', source: 'agent-proposed',
      roleId: 'cert-user', linkedApiEndpointIds: [],
      steps: [
        { stepIndex: 0, pageId: 'home', action: 'assert-navigation', elementId: null, targetPageId: sourceId, value: null, grounding: 'inferred' },
        { stepIndex: 1, pageId: sourceId, action: 'click', elementId: controlId, targetPageId: targetId, value: null, grounding: 'observed' },
      ],
      groundingWarnings: ['The unobserved entry step remains excluded.'],
    }], endpoints: null, api: null, diff: null,
  }
}

async function commitPos3ObservedModel(root: string, generation: number): Promise<void> {
  const observations = new ObservationService(POS_3_PROJECT, root, {
    producerInstanceId: `77777777-7777-4777-8777-${String(generation).padStart(12, '0')}`,
  })
  const run = await observations.startRun({
    operationId: `m4-cert-pos-3-observation-${generation}`, producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', startedAt: POS_3_START, policyId: 'forge.m4-cert-pos-3', policyVersion: '1',
    acquisitionPlan: { target: 'https://m4-cert.example.test' },
  })
  const sourceId = `cert-source-${generation}`
  const targetId = `cert-target-${generation}`
  const record = (subjectId: string, predicate: string, observedValue: unknown, key: string, scope?: Record<string, unknown>) => observations.recordObservation({
    observationRunId: run.value.observationRunId, projectId: POS_3_PROJECT, producer: 'forge.crawler', producerVersion: '1',
    method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId, predicate, outcome: 'present', observedValue, boundary: pos3Boundary(scope),
    capturedAt: POS_3_END, idempotencyKey: key,
  })
  const source = await record(sourceId, 'page.discovered', {
    urlPattern: `/source-${generation}`, elementCount: 1, fingerprint: `source-${generation}`,
  }, `source-${generation}`)
  const control = await record(sourceId, 'control.present', null, `control-${generation}`, { route: `/source-${generation}` })
  const target = await record(targetId, 'page.discovered', {
    urlPattern: `/target-${generation}`, elementCount: 0, fingerprint: `target-${generation}`,
  }, `target-${generation}`)
  await observations.terminalizeRun({
    observationRunId: run.value.observationRunId, lifecycle: 'completed', completeness: 'complete', terminalAt: POS_3_END,
    safeReasonCode: null, safeMessage: null,
  })
  await new AppModelRepository().commitCandidate(pos3Model(run.value.observationRunId, generation), `m4-cert-pos-3-model-${generation}`, {
    projectId: POS_3_PROJECT, observationRunId: run.value.observationRunId,
    observations: [source.value.observationId, control.value.observationId, target.value.observationId]
      .map((observationId, index) => ({ observationId, claimKey: `m4.cert.pos3.${generation}.${index}`, supportRole: 'basis' as const })),
    subjects: [
      { canonicalSubjectId: sourceId, observationId: source.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
      { canonicalSubjectId: sourceId, observationId: control.value.observationId, claimKey: 'subject.control', supportRole: 'basis' },
      { canonicalSubjectId: targetId, observationId: target.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' },
    ],
    gaps: [], characterizationPolicyId: 'forge.m4-cert-pos-3', characterizationPolicyVersion: '1', linkedAt: POS_3_END,
  })
}

type Pos3Lifecycle = Awaited<ReturnType<typeof createPos3Lifecycle>>

async function createPos3Lifecycle() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-m4-cert-pos-3-'))
  try {
    const workspace = createWorkspace(root)
    await openProjectDatabase(workspace)
    writeFileSync(path.join(workspace.forgeDir, 'config.json'), JSON.stringify({
      schemaVersion: 1, appName: POS_3_PROJECT, authType: 'form-login',
    }))
    const generation = new CanonicalTestDefinitionGenerationService()
    const members = []
    for (let index = 1; index <= 3; index += 1) {
      await commitPos3ObservedModel(root, index)
      const intent = await generation.generateDiscoveredIntent(POS_3_PROJECT, root, `cert-area-${index}`)
      if (intent.disposition.state !== 'supported') throw new Error(`POS-3 generation ${index} was refused: ${JSON.stringify(intent.disposition)}`)
      await generation.saveReviewedDiscoveredIntent(POS_3_PROJECT, root, intent, `m4-cert-pos-3-save-${index}`)
      const inventory = await new TestSetRepository().readInventory(POS_3_PROJECT, { limit: 1 })
      if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3
        || inventory.current.testSet.definitions.length !== 1) throw new Error(`POS-3 v3 authority ${index} is unavailable.`)
      members.push({
        testSetRowId: inventory.current.rowId,
        testSetId: inventory.current.testSet.testSetId,
        testSetRevision: inventory.current.testSet.revision,
        testSetContentHash: inventory.current.contentHash,
        definitionSchemaVersion: 3 as const,
        definitionId: inventory.current.testSet.definitions[0]!.id,
      })
    }
    assert.equal(new Set(members.map(member => member.testSetRowId)).size, 3)
    assert.equal(new Set(members.map(member => `${member.testSetId}:${member.testSetRevision}:${member.testSetContentHash}`)).size, 3)
    assert.equal(new Set(members.map(member => member.definitionId)).size, 3)
    const suite = await new SuiteService().create({
      schemaVersion: 2, projectId: POS_3_PROJECT, name: 'M4 Cert real three-member Suite v2',
      changeIntentKey: 'm4-cert-pos-3-suite-create', members,
    })
    assert.equal(suite.schemaVersion, 2)
    assert.deepEqual(suite.members.map(member => member.ordinal), [1, 2, 3])
    const credentials = new EnvironmentCredentialExecutionScope({ M4_CERT_USER: 'cert-user', M4_CERT_PASSWORD: 'secret' })
    let currentUrl = 'https://m4-cert.example.test/login'
    const createSession: ExecutionSessionFactory = async () => ({
      authenticateFormLogin: async () => { currentUrl = 'https://m4-cert.example.test/'; return true },
      navigate: async url => { currentUrl = url },
      clickDataTest: async value => {
        const generation = Number(/^go-(\d+)$/.exec(value)?.[1])
        if (!Number.isSafeInteger(generation) || generation < 1 || generation > 3) throw new Error('Unexpected POS-3 selector.')
        currentUrl = `https://m4-cert.example.test/target-${generation}`
        return 'one' as const
      },
      currentUrl: () => currentUrl,
      close: async () => undefined,
    })
    const execution = new ExecutionService({
      credentials, executor: new PlaywrightPlanExecutor(credentials, createSession),
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Controlled POS-3 Product session is ready.' }),
      processInstanceId: 'process-m4-cert-pos-3',
    })
    const started = await execution.start({
      projectId: POS_3_PROJECT, executionIntentKey: 'm4-cert-pos-3-execution',
      selection: { kind: 'suite_revision', suiteId: suite.suiteId, suiteRevision: suite.revision },
      workspaceRoot: root, credentialReference: POS_3_CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m4-cert.example.test', loginUrl: 'https://m4-cert.example.test/login' },
    })
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('POS-3 Suite v2 execution was refused.')
    await started.completion
    const runs = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', started.executionId).execute()
    assert.equal(runs.length, 1)
    const rows = await new DiagnosticEvidenceRepository().read(POS_3_PROJECT, started.executionId)
    assert.equal(rows.length, 3)
    return { root, generation, suite, members, executionId: started.executionId, runId: runs[0]!.run_id, rows }
  } catch (cause) {
    await closeDb().catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
    throw cause
  }
}

async function readAndAssertPos3Lineage(lifecycle: Pos3Lifecycle, candidates: readonly DiagnosticEvidenceV1[]) {
  const [execution, runs, items, itemAuthorities] = await Promise.all([
    getDb().selectFrom('executions').selectAll().where('execution_id', '=', lifecycle.executionId).executeTakeFirstOrThrow(),
    getDb().selectFrom('runs').selectAll().where('execution_id', '=', lifecycle.executionId).execute(),
    getDb().selectFrom('execution_items').selectAll().where('execution_id', '=', lifecycle.executionId).orderBy('item_ordinal').execute(),
    getDb().selectFrom('execution_item_authorities').selectAll().where('execution_id', '=', lifecycle.executionId).orderBy('item_ordinal').execute(),
  ])
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.run_id, lifecycle.runId)
  assert.deepEqual([execution.suite_id, Number(execution.suite_revision), execution.suite_content_hash],
    [lifecycle.suite.suiteId, lifecycle.suite.revision, lifecycle.suite.contentHash])
  assert.deepEqual(items.map(item => Number(item.item_ordinal)), [1, 2, 3])
  assert.equal(itemAuthorities.length, 3)
  assert.deepEqual(itemAuthorities.map((authority, index) => ({
    itemOrdinal: Number(authority.item_ordinal), testSetRowId: Number(authority.test_set_row_id),
    testSetId: authority.test_set_id, testSetRevision: Number(authority.test_set_revision),
    testSetContentHash: authority.test_set_content_hash, definitionSchemaVersion: Number(authority.definition_schema_version),
    definitionId: authority.definition_id,
  })), lifecycle.suite.members.map(member => ({ itemOrdinal: member.ordinal, ...member.definitionAuthority })))
  assert.equal(candidates.length, 3)
  const resolver = new HistoricalDefinitionAuthorityResolver()
  for (const [index, candidate] of candidates.entries()) {
    const item = items[index]!
    const row = lifecycle.rows[index]!
    const resolved = await resolver.resolve({
      projectId: POS_3_PROJECT, executionId: lifecycle.executionId, runId: lifecycle.runId,
      itemOrdinal: index + 1, resultId: row.result_id, definitionId: item.definition_id,
      executablePlanHash: item.executable_plan_hash,
    })
    assert.deepEqual(candidate.authority, {
      projectId: POS_3_PROJECT, executionId: lifecycle.executionId, runId: lifecycle.runId,
      itemOrdinal: index + 1, resultId: row.result_id, definitionId: item.definition_id,
      executablePlanHash: item.executable_plan_hash,
      acceptedDefinitionAuthority: resolved.acceptedDefinitionAuthority,
      suiteAuthority: resolved.suiteAuthority,
    })
    assert.equal(row.evidence_hash, createHash('sha256').update(canonicalDiagnosticJson(candidate)).digest('hex'))
    assert.equal(row.evidence_json, canonicalDiagnosticJson(candidate))
  }
  return { execution, runs, items, itemAuthorities }
}

function assertReconciles(result: DiagnosticInsightsReadModel): void {
  const failureSum = Object.values(result.countsByFailureMode).reduce((sum, count) => sum + count, 0)
  assert.equal(failureSum, result.classifiedFailureCount)
  assert.equal(result.insufficientEvidenceCount + result.integrityInvalidCount, result.refusalCount)
  assert.equal(result.classifiedFailureCount + result.refusalCount, result.totalDiagnostics)
  assert.doesNotMatch(JSON.stringify(result), /root.cause|selector.drift|flaky|confidence|healing/i)
}

describe('M4 Chunk 5 independent Insights certification', () => {
  test('CERT-POS-1 exact ten-diagnostic partition reconciles six failures and four refusals', async () => {
    const result = await new DiagnosticInsightsService(new CertificationEvidencePort(tenDiagnosticRows())).read(REQUEST)
    assert.deepEqual(result, {
      ...REQUEST,
      totalDiagnostics: 10,
      classifiedFailureCount: 6,
      refusalCount: 4,
      countsByFailureMode: FAILURE_COUNTS,
      insufficientEvidenceCount: 3,
      integrityInvalidCount: 1,
    })
    assertReconciles(result)
  })

  test('CERT-POS-2 direct, Suite v1, and Suite v2 per-item authority remain observable inputs', async () => {
    const suiteV1 = { suiteId: 'suite-cert-v1', suiteRevision: 1, suiteContentHash: '2'.repeat(64) }
    const suiteV2 = { suiteId: 'suite-cert-v2', suiteRevision: 2, suiteContentHash: '3'.repeat(64) }
    const direct = materialize('cases/insufficient-evidence.json', 1)
    const v1 = materialize('cases/insufficient-evidence.json', 2, { suiteAuthority: suiteV1 })
    const v2a = materialize('cases/insufficient-evidence.json', 3, {
      suiteAuthority: suiteV2,
      acceptedDefinitionAuthority: {
        ...clone(manifest.authorityTemplates.absent_result.acceptedDefinitionAuthority),
        testSetId: 'test-set-cert-a', testSetRevision: 3, definitionId: 'definition-cert-a',
      },
      definitionId: 'definition-cert-a',
    })
    const v2b = materialize('cases/insufficient-evidence.json', 4, {
      suiteAuthority: suiteV2,
      acceptedDefinitionAuthority: {
        ...clone(manifest.authorityTemplates.absent_result.acceptedDefinitionAuthority),
        testSetId: 'test-set-cert-b', testSetRevision: 7, definitionId: 'definition-cert-b',
      },
      definitionId: 'definition-cert-b',
    })
    const rows = [direct, v1, v2a, v2b].map(rowFor)
    assert.equal(JSON.parse(rows[0]!.evidence_json).authority.suiteAuthority, null)
    assert.deepEqual(JSON.parse(rows[1]!.evidence_json).authority.suiteAuthority, suiteV1)
    assert.deepEqual(rows.slice(2).map(row => {
      const authority = JSON.parse(row.evidence_json).authority
      return [authority.itemOrdinal, authority.acceptedDefinitionAuthority.testSetId, authority.suiteAuthority]
    }), [[3, 'test-set-cert-a', suiteV2], [4, 'test-set-cert-b', suiteV2]])
    const result = await new DiagnosticInsightsService(new CertificationEvidencePort(rows)).read(REQUEST)
    assert.deepEqual(result, {
      ...REQUEST, totalDiagnostics: 4, classifiedFailureCount: 0, refusalCount: 4,
      countsByFailureMode: ZERO_FAILURE_COUNTS, insufficientEvidenceCount: 4, integrityInvalidCount: 0,
    })
    assertReconciles(result)
  })

  describe('CERT-POS-3 real persisted Suite v2 Product lineage', () => {
    let lifecycle: Pos3Lifecycle
    let evidence: DiagnosticEvidenceV1[]

    before(async () => {
      lifecycle = await createPos3Lifecycle()
      evidence = lifecycle.rows.map(row => parseDiagnosticEvidenceV1(JSON.parse(row.evidence_json)))
    })

    after(async () => {
      await closeDb()
      if (lifecycle?.root) rmSync(lifecycle.root, { recursive: true, force: true })
    })

    test('CERT-POS-3 certifies one real three-item Execution/Run as exactly three insufficient refusals', async () => {
      await readAndAssertPos3Lineage(lifecycle, evidence)
      const classifier = new DiagnosticClassificationService()
      const classifications = await Promise.all(lifecycle.rows.map(row => classifier.classify({
      projectId: row.project_id,
      executionId: row.execution_id,
      runId: row.run_id,
      itemOrdinal: Number(row.item_ordinal),
      evidenceSchemaVersion: row.evidence_schema_version,
      evidenceHash: row.evidence_hash,
      classifierVersion: REQUEST.classifierVersion,
      })))
      assert.deepEqual(classifications.map(read => read.outcome.kind === 'refusal' && read.outcome.refusalCode), [
        'insufficient_evidence', 'insufficient_evidence', 'insufficient_evidence',
      ])
      const request = { ...REQUEST, projectId: POS_3_PROJECT }
      const result = await new DiagnosticInsightsService().read(request)
      assert.deepEqual(result, {
        ...request, totalDiagnostics: 3, classifiedFailureCount: 0, refusalCount: 3,
        countsByFailureMode: ZERO_FAILURE_COUNTS, insufficientEvidenceCount: 3, integrityInvalidCount: 0,
      })
      assertReconciles(result)

      const beforeAdvance = lifecycle.rows.map(row => [row.evidence_hash, row.evidence_json])
      await commitPos3ObservedModel(lifecycle.root, 4)
      const intent = await lifecycle.generation.generateDiscoveredIntent(POS_3_PROJECT, lifecycle.root, 'cert-area-4')
      if (intent.disposition.state !== 'supported') throw new Error('POS-3 current-head advancement was refused.')
      await lifecycle.generation.saveReviewedDiscoveredIntent(POS_3_PROJECT, lifecycle.root, intent, 'm4-cert-pos-3-save-4')
      const afterAdvance = await new DiagnosticEvidenceRepository().read(POS_3_PROJECT, lifecycle.executionId)
      assert.deepEqual(afterAdvance.map(row => [row.evidence_hash, row.evidence_json]), beforeAdvance)
      assert.deepEqual(await new DiagnosticInsightsService().read(request), result)
    })

    test('CERT-POS-3-HOSTILE direct-origin substitution fails the persisted lineage check', async () => {
      const substituted = clone(evidence)
      substituted[0]!.authority.suiteAuthority = null
      await assert.rejects(readAndAssertPos3Lineage(lifecycle, substituted))
    })

    test('CERT-POS-3-HOSTILE per-item Test Set/Definition cross-wire fails closed', async () => {
      const crossWired = clone(evidence)
      const first = {
        definitionId: crossWired[0]!.authority.definitionId,
        acceptedDefinitionAuthority: crossWired[0]!.authority.acceptedDefinitionAuthority,
      }
      crossWired[0]!.authority.definitionId = crossWired[1]!.authority.definitionId
      crossWired[0]!.authority.acceptedDefinitionAuthority = crossWired[1]!.authority.acceptedDefinitionAuthority
      crossWired[1]!.authority.definitionId = first.definitionId
      crossWired[1]!.authority.acceptedDefinitionAuthority = first.acceptedDefinitionAuthority
      await assert.rejects(readAndAssertPos3Lineage(lifecycle, crossWired))
    })

    test('CERT-POS-3-HOSTILE Suite tuple float fails the accepted Suite/Execution lineage check', async () => {
      const floated = clone(evidence)
      floated[2]!.authority.suiteAuthority = {
        ...floated[2]!.authority.suiteAuthority!, suiteContentHash: '0'.repeat(64),
      }
      await assert.rejects(readAndAssertPos3Lineage(lifecycle, floated))
    })
  })

  test('CERT-VERSION unknown requests and mixed evidence versions cannot read, merge, or default a partition', async () => {
    const row = tenDiagnosticRows()[0]!
    const port = new CertificationEvidencePort([row])
    await assert.rejects(new DiagnosticInsightsService(port).read({
      ...REQUEST, evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v2',
    }), UnsupportedDiagnosticEvidenceSchemaVersionError)
    await assert.rejects(new DiagnosticInsightsService(port).read({
      ...REQUEST, classifierVersion: 'forge.m4.diagnostic-classifier/v2',
    }), UnsupportedDiagnosticClassifierVersionError)
    assert.equal(port.partitionReads, 0)
    await assert.rejects(new DiagnosticInsightsService(new CertificationEvidencePort([
      { ...row, evidence_schema_version: 'forge.m4.diagnostic-evidence/v2' },
    ])).read(REQUEST), DiagnosticInsightsIntegrityError)
  })

  test('CERT-VERSION mixed classifier outputs abort aggregation without returning partial counts', async () => {
    const rows = tenDiagnosticRows().slice(0, 2)
    const port = new CertificationEvidencePort(rows)
    const productionClassifier = new DiagnosticClassificationService(port)
    const emittedVersions: string[] = []
    let classifierCalls = 0
    const mixedClassifier = {
      classify: async (request: Parameters<DiagnosticClassificationService['classify']>[0]) => {
        const read = await productionClassifier.classify(request)
        classifierCalls += 1
        if (classifierCalls === 1) {
          emittedVersions.push(read.classifierVersion)
          return read
        }
        const mixed = {
          ...read,
          classifierVersion: 'forge.m4.diagnostic-classifier/v2',
          outcome: { ...read.outcome, classifierVersion: 'forge.m4.diagnostic-classifier/v2' },
        }
        emittedVersions.push(mixed.classifierVersion)
        return mixed as any
      },
    }
    let partialResult: DiagnosticInsightsReadModel | undefined
    await assert.rejects(async () => {
      partialResult = await new DiagnosticInsightsService(port, mixedClassifier).read(REQUEST)
    }, DiagnosticInsightsIntegrityError)
    assert.deepEqual(emittedVersions, [DIAGNOSTIC_CLASSIFIER_VERSION, 'forge.m4.diagnostic-classifier/v2'])
    assert.equal(classifierCalls, 2)
    assert.equal(port.partitionReads, 1)
    assert.equal(port.exactReads, 2)
    assert.equal(partialResult, undefined)
  })

  test('CERT-VERSION explicit labels and historical replay are byte-equivalent', async () => {
    const rows = tenDiagnosticRows()
    const first = await new DiagnosticInsightsService(new CertificationEvidencePort(rows)).read(REQUEST)
    const replay = await new DiagnosticInsightsService(new CertificationEvidencePort(structuredClone(rows))).read(REQUEST)
    assert.equal(first.evidenceSchemaVersion, REQUEST.evidenceSchemaVersion)
    assert.equal(first.classifierVersion, REQUEST.classifierVersion)
    assert.equal(JSON.stringify(replay), JSON.stringify(first))
  })

  test('CERT-PROJECT all hostile project IDs reject before repository access', async () => {
    const port = new CertificationEvidencePort([])
    for (const projectId of ['', '   ', undefined, ' project', 'project/path', 'project\\path', 'p'.repeat(256)]) {
      await assert.rejects(new DiagnosticInsightsService(port).read({ ...REQUEST, projectId } as any),
        InvalidDiagnosticInsightsProjectIdError)
    }
    assert.equal(port.partitionReads, 0)
    assert.equal(port.exactReads, 0)
  })

  test('CERT-PROJECT a well-formed unknown project reads once and returns truthful zero counts', async () => {
    const port = new CertificationEvidencePort([])
    const result = await new DiagnosticInsightsService(port).read({ ...REQUEST, projectId: 'unknown.project:valid_id' })
    assert.deepEqual(result, {
      ...REQUEST, projectId: 'unknown.project:valid_id', totalDiagnostics: 0,
      classifiedFailureCount: 0, refusalCount: 0, countsByFailureMode: ZERO_FAILURE_COUNTS,
      insufficientEvidenceCount: 0, integrityInvalidCount: 0,
    })
    assert.equal(port.partitionReads, 1)
    assert.equal(port.exactReads, 0)
  })

  test('CERT-CORRUPTION schema-valid tamper is integrity-invalid and legacy material is inert', async () => {
    const source = tenDiagnosticRows()[0]!
    const tampered = {
      ...source,
      evidence_hash: '0'.repeat(64),
      legacy_triage_json: '{"failureMode":"selector_drift"}',
      legacy_healing_json: '{"rootCause":"invented"}',
    } as DiagnosticEvidenceRow
    const result = await new DiagnosticInsightsService(new CertificationEvidencePort([tampered])).read(REQUEST)
    assert.equal(result.totalDiagnostics, 1)
    assert.equal(result.integrityInvalidCount, 1)
    assert.equal(result.classifiedFailureCount, 0)
    assertReconciles(result)
  })

  test('CERT-CORRUPTION malformed persisted evidence aborts the whole partition without partial counts', async () => {
    const rows = tenDiagnosticRows()
    rows[9] = { ...rows[9]!, evidence_json: '{' }
    await assert.rejects(new DiagnosticInsightsService(new CertificationEvidencePort(rows)).read(REQUEST),
      DiagnosticEvidenceUnreadableError)
  })

  test('CERT-CORRUPTION duplicate identity is idempotent; conflicting duplicate and escaped project fail closed', async () => {
    const row = tenDiagnosticRows()[0]!
    const exact = await new DiagnosticInsightsService(new CertificationEvidencePort([row, { ...row, id: 99 }])).read(REQUEST)
    assert.equal(exact.totalDiagnostics, 1)
    await assert.rejects(new DiagnosticInsightsService(new CertificationEvidencePort([
      row, { ...row, id: 99, evidence_hash: '9'.repeat(64) },
    ])).read(REQUEST), DiagnosticInsightsIntegrityError)
    await assert.rejects(new DiagnosticInsightsService(new CertificationEvidencePort([
      row, { ...row, id: 99, accepted_definition_authority_json: '{}' },
    ])).read(REQUEST), DiagnosticInsightsIntegrityError)
    await assert.rejects(new DiagnosticInsightsService(new CertificationEvidencePort([
      { ...row, project_id: 'escaped-project' },
    ])).read(REQUEST), DiagnosticInsightsIntegrityError)
  })

  test('CERT-AUTHORITY hostile classifier substitution cannot add a causal category or alter authority', async () => {
    const row = tenDiagnosticRows()[0]!
    const port = new CertificationEvidencePort([row])
    const substituted = {
      classify: async () => ({
        identity: {
          projectId: row.project_id, executionId: row.execution_id, runId: row.run_id,
          itemOrdinal: Number(row.item_ordinal), evidenceSchemaVersion: row.evidence_schema_version,
        },
        evidenceHash: row.evidence_hash,
        evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
        classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
        outcome: {
          schemaVersion: 'forge.m4.diagnostic-outcome/v1',
          evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
          classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
          evidenceHash: row.evidence_hash,
          kind: 'classified_failure',
          failureMode: 'selector_drift',
          explanationCode: 'invented_root_cause',
          explanationParameters: {},
        },
        displayString: 'invented',
      } as any),
    }
    await assert.rejects(new DiagnosticInsightsService(port, substituted).read(REQUEST),
      DiagnosticInsightsIntegrityError)
  })

  test('CERT-HISTORY reconstruction is byte-stable and the certification port exposes no current-head join', async () => {
    const pinnedRows = tenDiagnosticRows()
    const before = await new DiagnosticInsightsService(new CertificationEvidencePort(pinnedRows)).read(REQUEST)
    assert.deepEqual(Object.getOwnPropertyNames(CertificationEvidencePort.prototype).sort(), [
      'constructor', 'readExact', 'readProjectPartition',
    ])
    const afterRepositoryReconstruction = await new DiagnosticInsightsService(
      new CertificationEvidencePort(structuredClone(pinnedRows)),
    ).read(REQUEST)
    assert.deepEqual(afterRepositoryReconstruction, before)
  })
})
