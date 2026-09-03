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
import test from 'node:test'
import { sql } from 'kysely'
import { isSupportedNormalizedTestIntentV1 } from '../forge-ui/src/api/m1TestIntentContract'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { ObservationService } from '../src/core/observation/ObservationService'
import {
  CRAWL_OBSERVATION_METHOD_VERSIONS,
  type ObservationBoundary,
} from '../src/core/observation/ObservationTypes'
import { DiagnosticClassificationService, DiagnosticEvidenceNotFoundError, DiagnosticEvidenceUnreadableError } from '../src/core/execution/DiagnosticClassificationService'
import { DIAGNOSTIC_CLASSIFIER_VERSION } from '../src/core/execution/DiagnosticClassificationContract'
import { canonicalDiagnosticJson, type DiagnosticEvidenceV1 } from '../src/core/execution/DiagnosticEvidenceContract'
import { ExecutionResultProjectionService, type ExecutionItemDiagnosticProjection } from '../src/core/execution/ExecutionResultProjectionService'
import { ExecutionService } from '../src/core/execution/ExecutionService'
import {
  HistoricalDefinitionAuthorityError,
  HistoricalDefinitionAuthorityResolver,
  type HistoricalAuthorityBinding,
} from '../src/core/execution/HistoricalDefinitionAuthorityResolver'
import { PlaywrightPlanExecutor, type ExecutionSessionFactory } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { closeDb, getDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { DiagnosticEvidenceRepository } from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import type { DiagnosticEvidenceRow } from '../src/core/storage/types'
import { CanonicalTestDefinitionGenerationService } from '../src/core/test-design/CanonicalTestDefinitionGenerationService'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'

const PROJECT = 'm4-direct-v3-replay'
const START = '2026-09-01T12:00:00.000Z'
const END = '2026-09-01T12:00:01.000Z'
const CREDENTIAL_REFERENCE = { usernameEnv: 'M4_DIRECT_USER', passwordEnv: 'M4_DIRECT_PASSWORD' }

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function digestJson(value: unknown): string {
  return digest(JSON.stringify(value))
}

function boundary(): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1',
    kind: 'document',
    scope: { acquisitionKind: 'web_crawl' },
    startedAt: START,
    endedAt: END,
    completion: 'complete',
    policyId: 'forge.m4-direct-v3-certification',
    policyVersion: '1',
  }
}

function model(observationRunId: string, generation: number): AppModelCandidate {
  const flowId = `checkout-flow-${generation}`
  return {
    schemaVersion: '2.0',
    generatedAt: END,
    generatedBy: 'engine',
    classificationRunId: observationRunId,
    app: {
      name: PROJECT,
      displayName: 'M4 Direct Replay Storefront',
      baseUrl: 'https://m4-direct.example.test',
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: `m4-direct-${generation}`,
        crawledAt: END,
        crawledBy: 'engine',
        crawlDurationMs: 1_000,
        pagesBudget: 2,
        pagesDiscovered: 2,
        pagesSkipped: 0,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'shopper',
      displayName: 'Shopper',
      authFlow: 'form-login',
      credentialsEnvKey: 'M4_DIRECT_CREDENTIALS',
      storageStatePath: null,
      reachablePageIds: ['subject-cart', 'subject-checkout'],
      restrictedPageIds: [],
      authOutcome: 'succeeded',
    }],
    pages: [
      {
        id: 'subject-cart',
        displayName: 'Cart',
        urlPattern: '/cart.html',
        urlPatternType: 'exact',
        fingerprint: `cart-${generation}`,
        fingerprintBasis: 'url+dom-hash',
        appType: 'web-ui',
        accessibleByRoles: ['shopper'],
        isAuthPage: false,
        module: {
          name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'],
          source: 'evidence-matched', reason: 'Observed cart.',
        },
        elements: [{
          id: 'subject-checkout-control', name: 'checkout', kind: 'button', label: 'Checkout', critical: true,
          aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
          tier3Assertions: [], cardinality: { kind: 'single' }, observedState: 'visible', href: null,
        }],
      },
      {
        id: 'subject-checkout',
        displayName: 'Checkout',
        urlPattern: '/checkout.html',
        urlPatternType: 'exact',
        fingerprint: `checkout-${generation}`,
        fingerprintBasis: 'url+dom-hash',
        appType: 'web-ui',
        accessibleByRoles: ['shopper'],
        isAuthPage: false,
        module: {
          name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout'],
          source: 'evidence-matched', reason: 'Observed checkout.',
        },
        elements: [],
      },
    ],
    flows: [{
      id: flowId,
      displayName: `Observed checkout ${generation}`,
      confidence: 'partial',
      source: 'agent-proposed',
      roleId: 'shopper',
      linkedApiEndpointIds: [],
      steps: [
        {
          stepIndex: 0, pageId: 'home', action: 'assert-navigation', elementId: null,
          targetPageId: 'subject-cart', value: null, grounding: 'inferred',
        },
        {
          stepIndex: 1, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control',
          targetPageId: 'subject-checkout', value: null, grounding: 'observed',
        },
      ],
      groundingWarnings: ['The unobserved entry step remains excluded.'],
    }],
    endpoints: null,
    api: null,
    diff: null,
  }
}

async function commitObservedModel(root: string, generation: number): Promise<void> {
  const observations = new ObservationService(PROJECT, root, {
    producerInstanceId: `77777777-7777-4777-8777-${String(generation).padStart(12, '0')}`,
  })
  const run = await observations.startRun({
    operationId: `m4-direct-observation-${generation}`,
    producer: 'forge.crawler',
    producerVersion: '1',
    acquisitionKind: 'web_crawl',
    startedAt: START,
    policyId: 'forge.m4-direct-acquisition',
    policyVersion: '1',
    acquisitionPlan: { target: 'https://m4-direct.example.test' },
  })
  const record = (
    subjectId: string,
    predicate: string,
    observedValue: unknown,
    idempotencyKey: string,
    scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' },
  ) => observations.recordObservation({
    observationRunId: run.value.observationRunId,
    projectId: PROJECT,
    producer: 'forge.crawler',
    producerVersion: '1',
    method: 'browser_dom_inspection',
    methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId,
    predicate,
    outcome: 'present',
    observedValue,
    boundary: { ...boundary(), scope },
    capturedAt: END,
    idempotencyKey,
  })
  const cart = await record('subject-cart', 'page.discovered', {
    urlPattern: '/cart.html', elementCount: 1, fingerprint: `subject-cart-${generation}`,
  }, `cart-${generation}`)
  const control = await record('subject-cart', 'control.present', null, `checkout-control-${generation}`, {
    route: '/cart.html',
  })
  const checkout = await record('subject-checkout', 'page.discovered', {
    urlPattern: '/checkout.html', elementCount: 0, fingerprint: `subject-checkout-${generation}`,
  }, `checkout-${generation}`)
  await observations.terminalizeRun({
    observationRunId: run.value.observationRunId,
    lifecycle: 'completed',
    completeness: 'complete',
    terminalAt: END,
    safeReasonCode: null,
    safeMessage: null,
  })
  const observationIds = [cart.value.observationId, control.value.observationId, checkout.value.observationId]
  await new AppModelRepository().commitCandidate(model(run.value.observationRunId, generation), `m4-direct-model-${generation}`, {
    projectId: PROJECT,
    observationRunId: run.value.observationRunId,
    observations: observationIds.map((observationId, index) => ({
      observationId, claimKey: `m4.direct.claim.${index}`, supportRole: 'basis' as const,
    })),
    subjects: [
      { canonicalSubjectId: 'subject-cart', observationId: observationIds[0]!, claimKey: 'subject.exists', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-cart', observationId: observationIds[1]!, claimKey: 'subject.control', supportRole: 'basis' },
      { canonicalSubjectId: 'subject-checkout', observationId: observationIds[2]!, claimKey: 'subject.exists', supportRole: 'basis' },
    ],
    gaps: [],
    characterizationPolicyId: 'forge.m4-direct-characterization',
    characterizationPolicyVersion: '1',
    linkedAt: END,
  })
}

async function saveCurrentV3(root: string, generation: number) {
  const service = new CanonicalTestDefinitionGenerationService()
  const intent = await service.generateDiscoveredIntent(PROJECT, root, 'checkout')
  assert.equal(isSupportedNormalizedTestIntentV1(intent), true)
  if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Direct-v3 certification requires supported observed-flow intent.')
  await service.saveReviewedDiscoveredIntent(PROJECT, root, intent, `m4-direct-v3-save-${generation}`)
  const inventory = await new TestSetRepository().readInventory(PROJECT, { limit: 2 })
  if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3) {
    throw new Error('Direct-v3 certification did not persist current v3 authority.')
  }
  return inventory.current
}

function classificationRequest(row: DiagnosticEvidenceRow) {
  return {
    projectId: row.project_id,
    executionId: row.execution_id,
    runId: row.run_id,
    itemOrdinal: Number(row.item_ordinal),
    evidenceSchemaVersion: row.evidence_schema_version,
    evidenceHash: row.evidence_hash,
    classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
  }
}

function authoritativeDiagnostic(value: ExecutionItemDiagnosticProjection | undefined) {
  assert.equal(value?.state, 'available')
  if (!value || value.state !== 'available') throw new Error('Direct-v3 Result diagnostic is unavailable.')
  return {
    state: value.state,
    identity: value.identity,
    evidenceSchemaVersion: value.evidenceSchemaVersion,
    evidenceHash: value.evidenceHash,
    classifierVersion: value.classifierVersion,
    outcome: value.outcome,
  }
}

function classificationWithRow(row: DiagnosticEvidenceRow): DiagnosticClassificationService {
  return new DiagnosticClassificationService({ readExact: async () => row })
}

test('M4 Chunk 6 direct-v3 historical evidence, classification, and Result projection survive head advancement and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m4-direct-v3-replay-'))
  const workspace = createWorkspace(root)
  try {
    await openProjectDatabase(workspace)
    fs.writeFileSync(path.join(workspace.forgeDir, 'config.json'), JSON.stringify({
      schemaVersion: 1, appName: PROJECT, authType: 'form-login',
    }))
    await commitObservedModel(root, 1)
    const acceptedHead = await saveCurrentV3(root, 1)
    const acceptedDefinition = acceptedHead.testSet.definitions[0]
    assert.ok(acceptedDefinition)

    const credentials = new EnvironmentCredentialExecutionScope({
      M4_DIRECT_USER: 'shopper', M4_DIRECT_PASSWORD: 'secret',
    })
    let currentUrl = 'https://m4-direct.example.test/login'
    const createSession: ExecutionSessionFactory = async () => ({
      authenticateFormLogin: async () => {
        currentUrl = 'https://m4-direct.example.test/'
        return true
      },
      navigate: async url => { currentUrl = url },
      clickDataTest: async value => {
        assert.equal(value, 'checkout')
        currentUrl = 'https://m4-direct.example.test/unexpected.html'
        return 'one' as const
      },
      currentUrl: () => currentUrl,
      close: async () => undefined,
    })
    const execution = new ExecutionService({
      credentials,
      executor: new PlaywrightPlanExecutor(credentials, createSession),
      runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable direct-v3 session is ready.' }),
      processInstanceId: 'm4-direct-v3-process',
    })
    const started = await execution.start({
      projectId: PROJECT,
      executionIntentKey: 'm4-direct-v3-execution',
      definitionIds: [acceptedDefinition!.id],
      revision: acceptedHead.testSet.revision,
      workspaceRoot: root,
      credentialReference: CREDENTIAL_REFERENCE,
      runtime: { baseUrl: 'https://m4-direct.example.test', loginUrl: 'https://m4-direct.example.test' },
    })
    assert.equal(started.kind, 'accepted')
    if (started.kind !== 'accepted') throw new Error('Direct-v3 Product execution was not accepted.')
    await started.completion

    const evidenceRepository = new DiagnosticEvidenceRepository()
    const initialRows = await evidenceRepository.read(PROJECT, started.executionId)
    assert.equal(initialRows.length, 1)
    const initialRow = initialRows[0]!
    const initialEvidence = JSON.parse(initialRow.evidence_json) as DiagnosticEvidenceV1
    assert.equal(initialRow.evidence_json, canonicalDiagnosticJson(initialEvidence))
    assert.equal(initialRow.evidence_hash, digest(initialRow.evidence_json))
    assert.equal(initialEvidence.authority.suiteAuthority, null)
    assert.equal(initialRow.suite_authority_json, null)
    assert.ok(initialRow.result_id)

    const initialClassification = await new DiagnosticClassificationService().classify(classificationRequest(initialRow))
    assert.equal(initialClassification.classifierVersion, DIAGNOSTIC_CLASSIFIER_VERSION)
    assert.equal(initialClassification.outcome.kind, 'classified_failure')
    if (initialClassification.outcome.kind === 'classified_failure') {
      assert.equal(initialClassification.outcome.failureMode, 'oracle_mismatch')
      assert.equal(initialClassification.outcome.explanationCode, 'governed_oracle_mismatch')
      assert.deepEqual(initialClassification.outcome.explanationParameters, {
        subjectId: 'subject-checkout',
        expectedRoute: '/checkout.html',
        actualRoute: '/unexpected.html',
      })
    }

    const initialProjection = await new ExecutionResultProjectionService().read(PROJECT, started.executionId)
    assert.equal(initialProjection.kind, 'ok')
    if (initialProjection.kind !== 'ok') throw new Error('Direct-v3 Result projection was unavailable before advancement.')
    assert.equal(Object.hasOwn(initialProjection.projection.execution, 'selectionAuthority'), false)
    assert.deepEqual(initialProjection.projection.execution.definitionAuthority, {
      schemaVersion: 3,
      testSetId: acceptedHead.testSet.testSetId,
      revision: acceptedHead.testSet.revision,
      modelRowId: acceptedHead.testSet.canonicalSupport.modelRowId,
      modelVersion: acceptedHead.testSet.canonicalSupport.modelVersion,
      supportSealHash: acceptedHead.testSet.canonicalSupport.supportSealHash,
      routeEvidenceIdentityHash: initialEvidence.authority.acceptedDefinitionAuthority.routeEvidenceIdentityHash,
      authenticationExpectationIdentityHash: initialEvidence.authority.acceptedDefinitionAuthority.authenticationExpectationIdentityHash,
    })
    const initialItem = initialProjection.projection.items[0]!
    assert.equal(initialItem.result.state, 'result_observed')
    if (initialItem.result.state === 'result_observed') assert.equal(initialItem.result.resultId, initialRow.result_id)
    const initialDiagnostic = authoritativeDiagnostic(initialItem.diagnostic)
    assert.deepEqual(initialDiagnostic.identity, initialClassification.identity)
    assert.equal(initialDiagnostic.evidenceHash, initialRow.evidence_hash)
    assert.deepEqual(initialDiagnostic.outcome, initialClassification.outcome)
    assert.equal(initialItem.diagnostic?.state === 'available' ? initialItem.diagnostic.displayString : null, initialClassification.displayString)

    const binding: HistoricalAuthorityBinding = {
      projectId: PROJECT,
      executionId: started.executionId,
      runId: initialRow.run_id,
      itemOrdinal: Number(initialRow.item_ordinal),
      resultId: initialRow.result_id,
      definitionId: initialRow.definition_id,
      executablePlanHash: initialRow.executable_plan_hash,
    }
    const acceptedAuthority = await new HistoricalDefinitionAuthorityResolver().resolve(binding)
    assert.deepEqual(acceptedAuthority, initialEvidence.authority)

    await commitObservedModel(root, 20)
    const currentHead = await saveCurrentV3(root, 20)
    const currentDefinition = currentHead.testSet.definitions[0]
    assert.ok(currentDefinition)
    assert.ok(currentHead.testSet.revision > acceptedHead.testSet.revision)
    assert.notEqual(currentHead.testSet.canonicalSupport.modelRowId, acceptedHead.testSet.canonicalSupport.modelRowId)
    assert.notEqual(currentHead.testSet.canonicalSupport.modelVersion, acceptedHead.testSet.canonicalSupport.modelVersion)
    assert.notEqual(currentDefinition!.id, acceptedDefinition!.id)

    await closeDb()
    await openProjectDatabase(createWorkspace(root))

    const reopenedInventory = await new TestSetRepository().readInventory(PROJECT, { limit: 2 })
    if ('kind' in reopenedInventory || !reopenedInventory.current || reopenedInventory.current.testSet.schemaVersion !== 3) {
      throw new Error('Advanced direct-v3 current head was unavailable after restart.')
    }
    assert.equal(reopenedInventory.current.testSet.revision, currentHead.testSet.revision)
    assert.notEqual(reopenedInventory.current.testSet.revision, acceptedAuthority.acceptedDefinitionAuthority.testSetRevision)
    assert.notEqual(reopenedInventory.current.testSet.canonicalSupport.modelRowId, acceptedHead.testSet.canonicalSupport.modelRowId)

    const reopenedAuthority = await new HistoricalDefinitionAuthorityResolver().resolve(binding)
    assert.deepEqual(reopenedAuthority, acceptedAuthority)
    assert.equal(reopenedAuthority.suiteAuthority, null)
    const reopenedRows = await new DiagnosticEvidenceRepository().read(PROJECT, started.executionId)
    assert.equal(reopenedRows.length, 1)
    const reopenedRow = reopenedRows[0]!
    assert.equal(reopenedRow.evidence_json, initialRow.evidence_json)
    assert.equal(reopenedRow.evidence_hash, initialRow.evidence_hash)
    const reopenedClassification = await new DiagnosticClassificationService().classify(classificationRequest(reopenedRow))
    assert.deepEqual(reopenedClassification.identity, initialClassification.identity)
    assert.equal(reopenedClassification.evidenceHash, initialClassification.evidenceHash)
    assert.equal(reopenedClassification.classifierVersion, initialClassification.classifierVersion)
    assert.deepEqual(reopenedClassification.outcome, initialClassification.outcome)
    assert.equal(reopenedClassification.displayString, initialClassification.displayString)

    const reopenedProjection = await new ExecutionResultProjectionService().read(PROJECT, started.executionId)
    assert.equal(reopenedProjection.kind, 'ok')
    if (reopenedProjection.kind !== 'ok') throw new Error('Direct-v3 Result projection was unavailable after restart.')
    assert.equal(Object.hasOwn(reopenedProjection.projection.execution, 'selectionAuthority'), false)
    assert.deepEqual(reopenedProjection.projection.execution.definitionAuthority, initialProjection.projection.execution.definitionAuthority)
    assert.deepEqual(reopenedProjection.projection.items[0]!.result, initialProjection.projection.items[0]!.result)
    assert.deepEqual(authoritativeDiagnostic(reopenedProjection.projection.items[0]!.diagnostic), initialDiagnostic)
    assert.equal(
      reopenedProjection.projection.items[0]!.diagnostic?.state === 'available'
        ? reopenedProjection.projection.items[0]!.diagnostic.displayString
        : null,
      initialClassification.displayString,
    )

    const classifier = new DiagnosticClassificationService()
    await assert.rejects(classifier.classify({ ...classificationRequest(reopenedRow), runId: 'run-floated' }), DiagnosticEvidenceNotFoundError)
    await assert.rejects(classifier.classify({ ...classificationRequest(reopenedRow), itemOrdinal: 2 }), DiagnosticEvidenceNotFoundError)
    for (const floated of [
      { ...binding, runId: 'run-floated' },
      { ...binding, itemOrdinal: binding.itemOrdinal + 1 },
      { ...binding, resultId: 'result-floated' },
      { ...binding, resultId: null },
    ]) {
      await assert.rejects(new HistoricalDefinitionAuthorityResolver().resolve(floated), HistoricalDefinitionAuthorityError)
    }
    await assert.rejects(
      new HistoricalDefinitionAuthorityResolver().resolve({ ...binding, definitionId: currentDefinition!.id }),
      HistoricalDefinitionAuthorityError,
    )

    const originalExecution = await getDb().selectFrom('executions').selectAll()
      .where('execution_id', '=', started.executionId).executeTakeFirstOrThrow()
    const immutableTrigger = (await sql<{ sql: string }>`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='executions_immutable_update'`.execute(getDb())).rows[0]!.sql
    await sql`DROP TRIGGER executions_immutable_update`.execute(getDb())
    try {
      await getDb().updateTable('executions').set({
        test_set_id: currentHead.testSet.testSetId,
        test_set_revision: currentHead.testSet.revision,
        definition_schema_version: 3,
        model_row_id: currentHead.testSet.canonicalSupport.modelRowId,
        model_version: currentHead.testSet.canonicalSupport.modelVersion,
        support_seal_hash: currentHead.testSet.canonicalSupport.supportSealHash,
      }).where('execution_id', '=', started.executionId).execute()
      await assert.rejects(new HistoricalDefinitionAuthorityResolver().resolve(binding), HistoricalDefinitionAuthorityError)
    } finally {
      await getDb().updateTable('executions').set(originalExecution)
        .where('execution_id', '=', started.executionId).execute()
      await sql.raw(immutableTrigger).execute(getDb())
    }
    assert.deepEqual(await new HistoricalDefinitionAuthorityResolver().resolve(binding), acceptedAuthority)

    const alteredHashRow = { ...reopenedRow, evidence_hash: '0'.repeat(64) }
    const alteredHash = await classificationWithRow(alteredHashRow).classify({
      ...classificationRequest(alteredHashRow), evidenceHash: alteredHashRow.evidence_hash,
    })
    assert.equal(alteredHash.outcome.kind, 'refusal')
    if (alteredHash.outcome.kind === 'refusal') {
      assert.equal(alteredHash.outcome.refusalCode, 'integrity_invalid')
      assert.deepEqual(alteredHash.outcome.integrityFindings, ['diagnostic_authority_binding_invalid'])
    }

    const alteredEvidence = structuredClone(initialEvidence)
    if (alteredEvidence.oracle.outcome !== 'mismatched') throw new Error('Expected replay control to carry oracle mismatch evidence.')
    alteredEvidence.oracle.actual = '/tampered.html'
    const alteredJsonRow = { ...reopenedRow, evidence_json: canonicalDiagnosticJson(alteredEvidence) }
    const alteredJson = await classificationWithRow(alteredJsonRow).classify(classificationRequest(alteredJsonRow))
    assert.equal(alteredJson.outcome.kind, 'refusal')
    if (alteredJson.outcome.kind === 'refusal') assert.equal(alteredJson.outcome.refusalCode, 'integrity_invalid')

    await assert.rejects(
      classificationWithRow({ ...reopenedRow, evidence_json: '{not-json' }).classify(classificationRequest(reopenedRow)),
      DiagnosticEvidenceUnreadableError,
    )

    const substitutedEvidence = structuredClone(initialEvidence)
    const { snapshotHash: _oldSnapshotHash, ...oldBase } = substitutedEvidence.authority.acceptedDefinitionAuthority
    const substitutedBase = {
      ...oldBase,
      testSetId: currentHead.testSet.testSetId,
      testSetRevision: currentHead.testSet.revision,
      testSetContentHash: currentHead.contentHash,
      supportSealHash: currentHead.testSet.canonicalSupport.supportSealHash,
    }
    substitutedEvidence.authority.acceptedDefinitionAuthority = {
      ...substitutedBase,
      snapshotHash: digestJson(substitutedBase),
    }
    const substitutedJson = canonicalDiagnosticJson(substitutedEvidence)
    const substitutedRow = {
      ...reopenedRow,
      evidence_json: substitutedJson,
      evidence_hash: digest(substitutedJson),
    }
    const substituted = await classificationWithRow(substitutedRow).classify(classificationRequest(substitutedRow))
    assert.equal(substituted.outcome.kind, 'refusal')
    if (substituted.outcome.kind === 'refusal') {
      assert.equal(substituted.outcome.refusalCode, 'integrity_invalid')
      assert.deepEqual(substituted.outcome.integrityFindings, ['diagnostic_historical_authority_substitution'])
    }
  } finally {
    await closeDb().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
