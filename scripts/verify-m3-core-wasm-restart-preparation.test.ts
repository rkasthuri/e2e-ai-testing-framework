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

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { sql } from 'kysely'
import type { AppModel } from '../src/core/onboarding/types'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  ManualPromotionCertificationFault,
  ManualTestCertificationPersistenceAdapter,
} from '../src/core/storage/certification/ManualTestCertificationPersistenceAdapter'
import { MIGRATION_033_TRIGGER_DEFINITIONS_V1 } from '../src/core/storage/migrations/033_manual_test_source_promotion_authority'
import { ManualTestSourceRepository } from '../src/core/storage/repositories/ManualTestSourceRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { ExecutionRepository } from '../src/core/storage/repositories/ExecutionRepository'
import { ExecutionRunCoordinator } from '../src/core/execution/ExecutionRunCoordinator'
import { projectExecutablePlan, routeEvidenceIdentity } from '../src/core/execution/ExecutionProjectionService'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import {
  DiagnosticEvidenceConflictError,
  DiagnosticEvidenceRepository,
} from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import { parseDiagnosticEvidenceFactsV1 } from '../src/core/execution/DiagnosticEvidenceContract'
import { DiagnosticClassificationService } from '../src/core/execution/DiagnosticClassificationService'
import { DiagnosticInsightsService } from '../src/core/execution/DiagnosticInsightsService'
import { DIAGNOSTIC_CLASSIFIER_VERSION } from '../src/core/execution/DiagnosticClassificationContract'
import type { ManualTestSourceInputV1 } from '../src/core/test-design/ManualTestSourceContract'
import {
  ManualTestIngestionService,
  type ManualAnalysisEvidenceV1,
} from '../src/core/test-design/ManualTestIngestionService'

const Module = require('node:module') as typeof import('node:module') & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}
const originalLoad = Module._load
let forceWasm = true
let forcedWasmLoads = 0
Module._load = function(request: string, parent: NodeModule | null, isMain: boolean): unknown {
  if (forceWasm && request === 'better-sqlite3') {
    forcedWasmLoads += 1
    throw new Error('CORE-D forced node-sqlite3-wasm fallback')
  }
  return originalLoad.call(this, request, parent, isMain)
}

after(async () => {
  await closeDb()
  Module._load = originalLoad
})

const PROJECT = 'm3-core-d-wasm'
const NOW = '2026-08-27T12:00:00.000Z'
const OBSERVATION_RUN_ID = '11111111-1111-4111-8111-111111111111'
const SUPPORT_HASH = 'c'.repeat(64)
const ROUTE_HASH = 'd'.repeat(64)
const AUTH_HASH = 'e'.repeat(64)
const HASH = 'a'.repeat(64)
const SOURCE_INPUT: ManualTestSourceInputV1 = {
  schemaVersion: 'forge-manual-test-source-input/v1',
  sourceKind: 'manual',
  title: 'Checkout from cart',
  objective: 'Proceed from cart to checkout.',
  steps: [
    { ordinal: 1, text: 'Open the cart page.' },
    { ordinal: 2, text: 'Click the Checkout button.' },
  ],
  expectedOutcome: 'Checkout information page is displayed.',
}

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

function model(): AppModel {
  return {
    schemaVersion: '2.0', generatedAt: NOW, generatedBy: 'engine', classificationRunId: OBSERVATION_RUN_ID,
    app: {
      name: PROJECT, displayName: 'Storefront', baseUrl: 'https://example.invalid', appType: 'web-ui',
      modelVersion: 'app-model-v7', spaConfig: null, evidenceState: 'crawled', crawlMetadata: {
        crawlConfigHash: HASH, crawledAt: NOW, crawledBy: 'engine', crawlDurationMs: 1000,
        pagesBudget: 2, pagesDiscovered: 2, pagesSkipped: 0, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: null,
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout-step-one'],
      restrictedPageIds: [], authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'subject-cart', displayName: 'cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: HASH, fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'],
      isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'], source: 'evidence-matched', reason: 'Observed cart.' },
      elements: [{
        id: 'subject-checkout-control', name: 'Checkout', kind: 'button', label: 'Checkout',
        critical: true, aiNamed: false,
        strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
        tier3Assertions: [], cardinality: { kind: 'single' }, observedState: 'visible', href: null,
      }],
    }, {
      id: 'subject-checkout-step-one', displayName: 'Checkout information',
      urlPattern: '/checkout-step-one.html', urlPatternType: 'exact', fingerprint: HASH,
      fingerprintBasis: 'url+dom-hash', appType: 'web-ui', accessibleByRoles: ['shopper'], isAuthPage: false,
      elements: [],
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout-step-one'], source: 'evidence-matched', reason: 'Observed checkout.' },
    }],
    flows: [{
      id: 'flow-cart-checkout', displayName: 'Cart checkout', confidence: 'observed', source: 'inferred',
      roleId: 'shopper', linkedApiEndpointIds: [], steps: [{
        stepIndex: 0, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control',
        targetPageId: 'subject-checkout-step-one', value: null, grounding: 'observed',
      }], groundingWarnings: [],
    }],
    endpoints: null, api: null, diff: null,
  } as unknown as AppModel
}

function evidence(modelRowId: number): ManualAnalysisEvidenceV1 {
  return {
    model: model(),
    authority: {
      schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: PROJECT,
      modelRowId, modelVersion: 'app-model-v7', observationRunId: OBSERVATION_RUN_ID,
      supportSealHash: SUPPORT_HASH,
      characterizationPolicy: { id: 'forge.policy', version: '1' },
      supportingObservationIds: ['obs-cart-route', 'obs-checkout-control', 'obs-checkout-subject'],
      supportingGapIds: [],
      subjectSupport: [{
        canonicalSubjectId: 'subject-cart',
        supportingObservationIds: ['obs-cart-route', 'obs-checkout-control'], supportingGapIds: [],
      }, {
        canonicalSubjectId: 'subject-checkout-step-one',
        supportingObservationIds: ['obs-checkout-subject'], supportingGapIds: [],
      }],
    },
    routeEvidence: {
      schemaVersion: 'forge-canonical-route-evidence/v1', projectId: PROJECT, modelRowId,
      supportSealHash: SUPPORT_HASH, normalizationPolicy: { id: 'forge.route', version: '1' },
      subjects: [{
        canonicalSubjectId: 'subject-cart', normalizedPath: '/cart.html',
        supportingObservationIds: ['obs-cart-route'],
      }, {
        canonicalSubjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html',
        supportingObservationIds: ['obs-checkout-subject'],
      }],
      identityHash: ROUTE_HASH,
    },
    authenticationExpectation: {
      schemaVersion: 'forge-authentication-expectation/v1', state: 'required', mechanism: 'form-login',
      bases: [{
        kind: 'declared_configuration', policyId: 'forge.auth', policyVersion: '1',
        configurationDigest: 'f'.repeat(64), mechanism: 'form-login',
      }],
      identityHash: AUTH_HASH,
    },
  }
}

async function seedCanonicalAuthority(): Promise<number> {
  await getDb().insertInto('observation_runs').values({
    observation_run_id: OBSERVATION_RUN_ID, project_id: PROJECT,
    workspace_authority: 'PRODUCT_WORKSPACE', operation_id: 'core-d-observation',
    producer: 'core-d-test', producer_version: '1',
    producer_instance_id: '22222222-2222-4222-8222-222222222222', producer_process_id: 1,
    acquisition_kind: 'web_crawl', started_at: NOW, terminal_at: NOW,
    lifecycle: 'completed', completeness: 'complete', safe_reason_code: null, safe_message: null,
    policy_id: 'forge.observation', policy_version: '1', acquisition_plan_hash: HASH,
  }).execute()
  const appModel = model()
  const inserted = await getDb().insertInto('app_models').values({
    app_name: PROJECT, version: 'app-model-v7', base_url: 'https://example.invalid', app_type: 'web',
    intake_mode: 'crawl', crawl_config_hash: HASH, page_count: 2, flow_count: 1, role_count: 1,
    model_json: JSON.stringify(appModel), crawled_at: NOW, crawled_by: 'engine', status: 'active',
    evidence_state: 'crawled', operation_id: null, candidate_hash: null,
    recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  const modelRowId = Number(inserted.id)
  await getDb().insertInto('app_model_support_seals').values({
    model_row_id: modelRowId, project_id: PROJECT, observation_run_id: OBSERVATION_RUN_ID,
    characterization_policy_id: 'forge.policy', characterization_policy_version: '1',
    support_hash: SUPPORT_HASH, sealed_at: NOW,
  }).execute()
  return modelRowId
}

async function createThenReopenWasm(
  prefix: string,
  run: (root: string, dbPath: string, modelRowId: number) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const dbPath = path.join(root, 'forge.db')
  try {
    forceWasm = true
    initDb(dbPath)
    await runMigrations()
    const modelRowId = await seedCanonicalAuthority()
    await closeDb()
    initDb(dbPath)
    await run(root, dbPath, modelRowId)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('CORE-D forced WASM reopen supports Analyze, Save, diagnostic evidence replay, and Migration 033 authority', async () => {
  await createThenReopenWasm('forge-m3-core-d-wasm-', async (root, dbPath, modelRowId) => {
    const currentEvidence = evidence(modelRowId)
    const certification = new ManualTestCertificationPersistenceAdapter()
    let generation = 0
    const service = new ManualTestIngestionService(
      new ManualTestSourceRepository(),
      new TestSetRepository(certification),
      { read: async () => currentEvidence } as any,
      () => NOW,
      async () => { await runMigrations() },
      () => `generation-core-d-${++generation}`,
      () => AUTH_HASH,
    )
    const first = await service.analyze(PROJECT, '.', SOURCE_INPUT)
    assert.equal(first.analysis.outcome.kind, 'proposal')
    if (first.analysis.outcome.kind !== 'proposal') throw new Error('Expected supported proposal')
    const proposal = first.analysis.outcome.proposal
    const request = {
      schemaVersion: 'forge-manual-promotion-request/v1',
      sourceAuthority: { ...proposal.sourceAuthority },
      reviewedProposalAuthority: {
        proposalId: proposal.proposalId,
        proposalContentHash: proposal.proposalContentHash,
      },
    }
    const saved = await service.save(PROJECT, '.', request)
    const repeated = await service.analyze(PROJECT, '.', SOURCE_INPUT)
    assert.equal(repeated.analysis.outcome.kind, 'proposal')
    assert.deepEqual(await service.save(PROJECT, '.', request), saved)
    assert.equal(await getDb().selectFrom('test_set_revisions').selectAll().execute().then(rows => rows.length), 1)
    assert.equal(await getDb().selectFrom('manual_test_promotions').selectAll().execute().then(rows => rows.length), 1)
    assert.equal(await getDb().selectFrom('manual_test_sources').selectAll().execute().then(rows => rows.length), 1)
    assert.equal(generation, 1)

    const beforeFault = await certification.snapshot(PROJECT)
    const second = await service.analyze(PROJECT, '.', { ...SOURCE_INPUT, title: 'Checkout from cart WASM control' })
    assert.equal(second.analysis.outcome.kind, 'proposal')
    if (second.analysis.outcome.kind !== 'proposal') throw new Error('Expected second supported proposal')
    const secondProposal = second.analysis.outcome.proposal
    const secondRequest = {
      schemaVersion: 'forge-manual-promotion-request/v1',
      sourceAuthority: { ...secondProposal.sourceAuthority },
      reviewedProposalAuthority: {
        proposalId: secondProposal.proposalId,
        proposalContentHash: secondProposal.proposalContentHash,
      },
    }
    const withSecondSource = await certification.snapshot(PROJECT)
    assert.deepEqual(withSecondSource.counts, {
      manualTestSources: 2, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1,
    })
    certification.armPromotionFaultOnce()
    await assert.rejects(service.save(PROJECT, '.', secondRequest),
      (error: unknown) => error instanceof ManualPromotionCertificationFault)
    assert.deepEqual(await certification.snapshot(PROJECT), withSecondSource)
    assert.deepEqual(beforeFault.counts, {
      manualTestSources: 1, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1,
    })
    certification.disarmPromotionFault()
    await service.save(PROJECT, '.', secondRequest)
    assert.deepEqual((await certification.snapshot(PROJECT)).counts, {
      manualTestSources: 2, definitions: 2, testSetRevisions: 2, manualTestPromotions: 2,
    })

    const triggerNames = (await sql<{ name: string }>`
      SELECT name FROM sqlite_schema
      WHERE type = 'trigger' AND tbl_name IN ('manual_test_sources', 'manual_test_promotions')
      ORDER BY name
    `.execute(getDb())).rows.map(row => row.name)
    assert.deepEqual(triggerNames, Object.keys(MIGRATION_033_TRIGGER_DEFINITIONS_V1).sort())

    const promotion = await getDb().selectFrom('manual_test_promotions').selectAll().executeTakeFirstOrThrow()
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({
      ...promotion,
      proposal_id: 'proposal-invalid-membership',
      proposal_content_hash: 'b'.repeat(64),
      definition_id: 'definition-not-in-canonical-v3-body',
    }).execute(), /definition membership mismatch/i)

    const inventory = await new TestSetRepository(certification).readInventory(PROJECT, { limit: 1 })
    if ('kind' in inventory || !inventory.current || inventory.current.testSet.schemaVersion !== 3) {
      throw new Error('Forced WASM diagnostic evidence control requires canonical v3 authority.')
    }
    const definition = inventory.current.testSet.definitions[0]
    if (!definition) throw new Error('Forced WASM diagnostic evidence control requires a Definition.')
    const committed = await new AppModelRepository().getCommittedById(modelRowId)
    const canonical = evidence(modelRowId)
    const projected = projectExecutablePlan({
      definition,
      definitionSchemaVersion: 3,
      definitionTestSetId: inventory.current.testSet.testSetId,
      definitionRevision: inventory.current.testSet.revision,
      testSetContentHash: inventory.current.contentHash,
    }, {
      currentRevision: {
        testSetId: inventory.current.testSet.testSetId,
        revision: inventory.current.testSet.revision,
        contentHash: inventory.current.contentHash,
      },
      sealedAuthority: canonical.authority,
      routeEvidence: canonical.routeEvidence,
      authenticationExpectation: canonical.authenticationExpectation,
      activeAppModel: { rowId: committed.rowId, modelVersion: committed.snapshot.app.modelVersion, snapshot: committed.snapshot },
    }, NOW)
    assert.equal(projected.kind, 'ok', projected.kind === 'failed' ? projected.failure.explanation : undefined)
    if (projected.kind !== 'ok') throw new Error('Forced WASM plan projection failed.')
    const plan = projected.plan
    const executionId = 'execution-m4-wasm-evidence'
    const processInstanceId = 'm4-wasm-evidence-process'
    await new ExecutionRepository().beginExecution({
      executionId,
      projectId: PROJECT,
      processInstanceId,
      startedAt: NOW,
      executionPlanHash: plan.fingerprint,
      executionIntentKey: 'm4-wasm-evidence-start',
      executionIntentFingerprint: '1'.repeat(64),
      expectedTestSetId: inventory.current.testSet.testSetId,
      expectedRevision: inventory.current.testSet.revision,
      expectedTestSetContentHash: inventory.current.contentHash,
      definitionSchemaVersion: 3,
      expectedModelRowId: modelRowId,
      expectedModelVersion: committed.snapshot.app.modelVersion,
      sourceObservationId: null,
      supportSealHash: canonical.authority.supportSealHash,
      routeEvidenceIdentityHash: routeEvidenceIdentity(definition),
      authenticationExpectationIdentityHash: createHash('sha256').update(JSON.stringify({
        schemaVersion: 'forge-authentication-expectation/v1',
        state: definition.authenticationExpectation.state,
        mechanism: definition.authenticationExpectation.mechanism,
        bases: definition.authenticationExpectation.bases,
      })).digest('hex'),
      manifestItems: [{
        itemOrdinal: 1,
        definitionId: definition.id,
        executablePlanHash: plan.fingerprint,
        oracleKind: plan.value.oracle.kind,
        oracleSubjectId: plan.value.oracle.subjectId,
      }],
    })
    const coordinator = new ExecutionRunCoordinator()
    const run = await coordinator.admitRun({
      executionId,
      projectId: PROJECT,
      processInstanceId,
      expectedResultCount: 1,
      runnerAdapter: 'playwright-plan-executor/v2',
      environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true },
      startedAt: NOW,
    })
    await coordinator.recordResult({
      executionId,
      runId: run.run_id,
      itemOrdinal: 1,
      plan,
      observed: {
        status: 'completed',
        reasonCode: 'completed',
        navigationUrl: 'https://example.invalid/cart.html',
        finalUrl: 'https://example.invalid/checkout-step-one.html',
        targetCardinality: 'one',
      },
      startedAt: NOW,
      completedAt: '2026-08-27T12:00:01.000Z',
    })

    const evidenceRepository = new DiagnosticEvidenceRepository()
    const beforeReopen = await evidenceRepository.read(PROJECT, executionId)
    assert.equal(beforeReopen.length, 1)
    const classificationBeforeReopen = await classifyPersistedDiagnostic(beforeReopen[0]!)
    const insightsRequest = {
      projectId: PROJECT,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
    }
    const insightsBeforeReopen = await new DiagnosticInsightsService().read(insightsRequest)
    assert.deepEqual(insightsBeforeReopen, {
      projectId: PROJECT,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
      totalDiagnostics: 1,
      classifiedFailureCount: 0,
      refusalCount: 1,
      countsByFailureMode: {
        executor_failure: 0,
        authentication_not_established: 0,
        navigation_not_completed: 0,
        target_not_observed: 0,
        action_not_completed: 0,
        oracle_mismatch: 0,
      },
      insufficientEvidenceCount: 1,
      integrityInvalidCount: 0,
    })
    const stored = beforeReopen[0]!
    const record = JSON.parse(stored.evidence_json)
    const facts = parseDiagnosticEvidenceFactsV1({
      executor: record.executor,
      authentication: record.authentication,
      navigation: record.navigation,
      targetObservation: record.targetObservation,
      action: record.action,
      oracle: record.oracle,
    })
    const binding = {
      projectId: stored.project_id,
      executionId: stored.execution_id,
      runId: stored.run_id,
      itemOrdinal: Number(stored.item_ordinal),
      resultId: stored.result_id,
      definitionId: stored.definition_id,
      executablePlanHash: stored.executable_plan_hash,
    }
    await assert.rejects(getDb().updateTable('diagnostic_evidence').set({ evidence_hash: '0'.repeat(64) })
      .where('id', '=', stored.id).execute(), /immutable/i)
    await assert.rejects(getDb().deleteFrom('diagnostic_evidence').where('id', '=', stored.id).execute(), /immutable/i)
    assert.equal((await evidenceRepository.append({ binding, facts })).replayed, true)
    await assert.rejects(evidenceRepository.append({
      binding,
      facts: { ...facts, oracle: facts.oracle.outcome === 'matched'
        ? { ...facts.oracle, outcome: 'mismatched', actual: `${facts.oracle.actual}-conflict` }
        : { outcome: 'not_performed' } },
    }), DiagnosticEvidenceConflictError)

    await closeDb()
    initDb(dbPath)
    await runMigrations()
    const afterReopen = await new DiagnosticEvidenceRepository().read(PROJECT, executionId)
    assert.deepEqual(afterReopen.map(row => [row.evidence_hash, row.evidence_json]),
      beforeReopen.map(row => [row.evidence_hash, row.evidence_json]))
    assert.deepEqual(await classifyPersistedDiagnostic(afterReopen[0]!), classificationBeforeReopen)
    assert.deepEqual(await new DiagnosticInsightsService().read(insightsRequest), insightsBeforeReopen)
    assert.equal((await new DiagnosticEvidenceRepository().append({ binding, facts })).replayed, true)
    assert.ok(forcedWasmLoads >= 3)
  })
})

test('CORE-D forced WASM restart still rejects a token-preserving weakened Migration 029 guard', async () => {
  await createThenReopenWasm('forge-m3-core-d-m029-', async () => {
    await sql`DROP TRIGGER canonical_result_detail_performed_insert`.execute(getDb())
    await sql.raw(`
      CREATE TRIGGER canonical_result_detail_performed_insert
      BEFORE INSERT ON test_results
      WHEN 0
      BEGIN
        SELECT CASE WHEN NEW.status IS 'passed' AND NEW.error_msg IS 'completed' THEN 1 END;
        SELECT CASE WHEN NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed' THEN 1 END;
      END
    `).execute(getDb())
    await assert.rejects(
      runMigrations(),
      /029_canonical_result_detail_evidence.*performed_oracle semantic persistence guard could not be established on a disposable snapshot/i,
    )
  })
})

test('CORE-D forced WASM restart still rejects missing and inert Migration 033 membership authority', async () => {
  await createThenReopenWasm('forge-m3-core-d-m033-', async () => {
    const trigger = 'manual_test_promotions_definition_membership_insert'
    await sql.raw(`DROP TRIGGER ${trigger}`).execute(getDb())
    await assert.rejects(runMigrations(), /033_manual_test_source_promotion_authority.*trigger contract/i)
    await sql.raw(`CREATE TRIGGER ${trigger}
      BEFORE INSERT ON manual_test_promotions BEGIN SELECT 1; END`).execute(getDb())
    await assert.rejects(runMigrations(), /033_manual_test_source_promotion_authority.*trigger contract/i)
  })
})

test('CORE-D Better-SQLite restart and repeated preparation semantics remain intact', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-core-d-better-'))
  const dbPath = path.join(root, 'forge.db')
  try {
    forceWasm = false
    initDb(dbPath)
    await runMigrations()
    await closeDb()
    initDb(dbPath)
    await runMigrations()
    await runMigrations()
  } finally {
    await closeDb()
    forceWasm = true
    fs.rmSync(root, { recursive: true, force: true })
  }
})
