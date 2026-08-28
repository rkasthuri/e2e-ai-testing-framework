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

import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AppModel } from '../src/core/onboarding/types'
import { closeDb, getDb, initDb, initProductWorkspaceDatabase } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  ManualPromotionCertificationFault,
  ManualTestCertificationPersistenceAdapter,
} from '../src/core/storage/certification/ManualTestCertificationPersistenceAdapter'
import { ManualTestSourceRepository } from '../src/core/storage/repositories/ManualTestSourceRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import type { ManualTestSourceInputV1 } from '../src/core/test-design/ManualTestSourceContract'
import { materializeSupportedNormalizedTestIntentV1 } from '../src/core/test-design/NormalizedTestIntentContract'
import { generateCanonicalManualFlowTestSetV3 } from '../src/core/test-design/TestDefinitionContract'
import {
  ManualTestIngestionService,
  type ManualAnalysisEvidenceV1,
} from '../src/core/test-design/ManualTestIngestionService'

const PROJECT = 'm3-core-f-certification'
const NOW = '2026-08-27T12:00:00.000Z'
const OBSERVATION_RUN_ID = '11111111-1111-4111-8111-111111111111'
const SUPPORT_HASH = 'c'.repeat(64)
const ROUTE_HASH = 'd'.repeat(64)
const AUTH_HASH = 'e'.repeat(64)
const HASH = 'a'.repeat(64)
const SOURCE_INPUT: ManualTestSourceInputV1 = {
  schemaVersion: 'forge-manual-test-source-input/v1', sourceKind: 'manual',
  title: 'Checkout from cart', objective: 'Proceed from cart to checkout.',
  steps: [{ ordinal: 1, text: 'Open the cart page.' }, { ordinal: 2, text: 'Click the Checkout button.' }],
  expectedOutcome: 'Checkout information page is displayed.',
}

function appModel(): AppModel {
  return {
    schemaVersion: '1', generatedAt: NOW, generatedBy: 'engine',
    app: {
      name: PROJECT, displayName: 'Storefront', baseUrl: 'https://example.invalid', appType: 'web',
      modelVersion: 'app-model-v7', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null,
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: null,
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout-step-one'],
      restrictedPageIds: [], authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'subject-cart', displayName: 'cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: HASH, fingerprintBasis: 'url-only', appType: 'web', accessibleByRoles: ['shopper'],
      isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'] },
      elements: [{
        id: 'subject-checkout-control', name: 'Checkout', kind: 'button', label: 'Checkout',
        critical: true, aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
        tier3Assertions: [], cardinality: { kind: 'single' }, observedState: 'visible',
      }],
    }, {
      id: 'subject-checkout-step-one', displayName: 'Checkout information',
      urlPattern: '/checkout-step-one.html', urlPatternType: 'exact', fingerprint: HASH,
      fingerprintBasis: 'url-only', appType: 'web', accessibleByRoles: ['shopper'], isAuthPage: false,
      elements: [], module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout-step-one'] },
    }],
    flows: [{
      id: 'flow-cart-checkout', displayName: 'Cart checkout', confidence: 'observed', source: 'inferred',
      roleId: 'shopper', linkedApiEndpointIds: [], steps: [{
        stepIndex: 7, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control',
        targetPageId: 'subject-checkout-step-one', value: null, grounding: 'observed',
      }],
    }],
    endpoints: null, api: null, diff: null,
  } as unknown as AppModel
}

function evidence(modelRowId: number): ManualAnalysisEvidenceV1 {
  return {
    model: appModel(),
    authority: {
      schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: PROJECT,
      modelRowId, modelVersion: 'app-model-v7', observationRunId: OBSERVATION_RUN_ID,
      supportSealHash: SUPPORT_HASH, characterizationPolicy: { id: 'forge.policy', version: '1' },
      supportingObservationIds: ['obs-cart-route', 'obs-checkout-control', 'obs-checkout-subject'],
      supportingGapIds: [], subjectSupport: [{
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
        canonicalSubjectId: 'subject-cart', normalizedPath: '/cart.html', supportingObservationIds: ['obs-cart-route'],
      }, {
        canonicalSubjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html',
        supportingObservationIds: ['obs-checkout-subject'],
      }], identityHash: ROUTE_HASH,
    },
    authenticationExpectation: {
      schemaVersion: 'forge-authentication-expectation/v1', state: 'required', mechanism: 'form-login',
      bases: [{
        kind: 'declared_configuration', policyId: 'forge.auth', policyVersion: '1',
        configurationDigest: 'f'.repeat(64), mechanism: 'form-login',
      }], identityHash: AUTH_HASH,
    },
  }
}

async function seedCanonicalAuthority(): Promise<number> {
  await getDb().insertInto('observation_runs').values({
    observation_run_id: OBSERVATION_RUN_ID, project_id: PROJECT,
    workspace_authority: 'PRODUCT_WORKSPACE', operation_id: 'core-f-observation',
    producer: 'core-f-test', producer_version: '1',
    producer_instance_id: '22222222-2222-4222-8222-222222222222', producer_process_id: 1,
    acquisition_kind: 'web_crawl', started_at: NOW, terminal_at: NOW,
    lifecycle: 'completed', completeness: 'complete', safe_reason_code: null, safe_message: null,
    policy_id: 'forge.observation', policy_version: '1', acquisition_plan_hash: HASH,
  }).execute()
  const inserted = await getDb().insertInto('app_models').values({
    app_name: PROJECT, version: 'app-model-v7', base_url: 'https://example.invalid', app_type: 'web',
    intake_mode: 'crawl', crawl_config_hash: HASH, page_count: 2, flow_count: 1, role_count: 1,
    model_json: JSON.stringify(appModel()), crawled_at: NOW, crawled_by: 'engine', status: 'active',
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

async function withDatabase(run: (modelRowId: number) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-core-f-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    await run(await seedCanonicalAuthority())
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function serviceFor(modelRowId: number, adapter: ManualTestCertificationPersistenceAdapter) {
  let generation = 0
  const currentEvidence = evidence(modelRowId)
  return {
    service: new ManualTestIngestionService(
      new ManualTestSourceRepository(), new TestSetRepository(adapter),
      { read: async () => currentEvidence } as any, () => NOW,
      async () => { await runMigrations() }, () => `generation-core-f-${++generation}`, () => AUTH_HASH,
    ),
    testSets: new TestSetRepository(),
    currentEvidence,
  }
}

function requestFor(proposal: any) {
  return {
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: { ...proposal.sourceAuthority },
    reviewedProposalAuthority: {
      proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash,
    },
  }
}

test('CORE-F semantic refusal admits only the immutable manual source row', async () => {
  await withDatabase(async modelRowId => {
    const adapter = new ManualTestCertificationPersistenceAdapter()
    const { service } = serviceFor(modelRowId, adapter)
    const before = await adapter.snapshot(PROJECT)
    const refused = await service.analyze(PROJECT, '.', {
      ...SOURCE_INPUT,
      steps: [{ ordinal: 1, text: 'Open the cart page.' }, { ordinal: 2, text: 'Enter payment details.' }],
    })
    assert.equal(refused.analysis.outcome.kind, 'refusal')
    if (refused.analysis.outcome.kind !== 'refusal') throw new Error('Expected semantic refusal')
    assert.equal(refused.analysis.outcome.refusal.code, 'unsupported_semantics')
    const after = await adapter.snapshot(PROJECT)
    assert.deepEqual(before.counts, { manualTestSources: 0, definitions: 0, testSetRevisions: 0, manualTestPromotions: 0 })
    assert.deepEqual(after.counts, { manualTestSources: 1, definitions: 0, testSetRevisions: 0, manualTestPromotions: 0 })
    assert.equal(after.manualTestSources[0].sourceId, refused.source.sourceId)
    assert.equal(after.manualTestSources[0].contentHash, refused.source.contentHash)
  })
})

test('CORE-F observes exact replay, atomic rollback, disarmed control, and a hidden extra persisted revision', async () => {
  await withDatabase(async modelRowId => {
    const adapter = new ManualTestCertificationPersistenceAdapter()
    const { service, currentEvidence } = serviceFor(modelRowId, adapter)
    const analyzed = await service.analyze(PROJECT, '.', SOURCE_INPUT)
    assert.equal(analyzed.analysis.outcome.kind, 'proposal')
    if (analyzed.analysis.outcome.kind !== 'proposal') throw new Error('Expected proposal')
    const first = await service.save(PROJECT, '.', requestFor(analyzed.analysis.outcome.proposal))
    const afterFirst = await adapter.snapshot(PROJECT)
    assert.deepEqual(afterFirst.counts, { manualTestSources: 1, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1 })
    assert.deepEqual(afterFirst.manualTestPromotions[0], {
      proposalId: first.proposalAuthority.proposalId,
      projectId: PROJECT,
      proposalSchemaVersion: 'forge-manual-automation-proposal/v1',
      sourceId: first.sourceAuthority.sourceId,
      sourceContentHash: first.sourceAuthority.sourceContentHash,
      proposalPayloadJson: afterFirst.manualTestPromotions[0].proposalPayloadJson,
      proposalContentHash: first.proposalAuthority.proposalContentHash,
      testSetRowId: afterFirst.testSetRevisions[0].rowId,
      testSetId: first.definitionAuthority.testSetId,
      testSetRevision: first.definitionAuthority.testSetRevision,
      testSetContentHash: first.definitionAuthority.testSetContentHash,
      definitionId: first.definitionAuthority.definitionId,
      promotedAt: NOW,
    })

    assert.deepEqual(await service.save(PROJECT, '.', requestFor(analyzed.analysis.outcome.proposal)), first)
    assert.deepEqual(await adapter.snapshot(PROJECT), afterFirst)

    const secondAnalysis = await service.analyze(PROJECT, '.', { ...SOURCE_INPUT, title: 'Checkout from cart control' })
    assert.equal(secondAnalysis.analysis.outcome.kind, 'proposal')
    if (secondAnalysis.analysis.outcome.kind !== 'proposal') throw new Error('Expected second proposal')
    const beforeFault = await adapter.snapshot(PROJECT)
    assert.deepEqual(beforeFault.counts, { manualTestSources: 2, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1 })
    adapter.armPromotionFaultOnce()
    await assert.rejects(
      service.save(PROJECT, '.', requestFor(secondAnalysis.analysis.outcome.proposal)),
      (error: unknown) => error instanceof ManualPromotionCertificationFault,
    )
    const afterFault = await adapter.snapshot(PROJECT)
    assert.deepEqual(afterFault, beforeFault)
    assert.deepEqual(afterFault.manualTestPromotions[0], afterFirst.manualTestPromotions[0])

    adapter.disarmPromotionFault()
    const controlled = await service.save(PROJECT, '.', requestFor(secondAnalysis.analysis.outcome.proposal))
    const afterControl = await adapter.snapshot(PROJECT)
    assert.deepEqual(afterControl.counts, { manualTestSources: 2, definitions: 2, testSetRevisions: 2, manualTestPromotions: 2 })
    assert.equal(afterControl.manualTestPromotions.find(row =>
      row.proposalId === controlled.proposalAuthority.proposalId)?.definitionId,
    controlled.definitionAuthority.definitionId)

    const hiddenMaterialized = generateCanonicalManualFlowTestSetV3({
      projectId: PROJECT, generatedAt: NOW, authority: currentEvidence.authority,
      routeEvidence: currentEvidence.routeEvidence,
      authenticationExpectation: currentEvidence.authenticationExpectation,
      normalizedIntent: materializeSupportedNormalizedTestIntentV1(analyzed.analysis.outcome.proposal.normalizedIntent),
    }, 'generation-hidden-extra', 3)
    await getDb().insertInto('test_set_revisions').values({
      test_set_id: hiddenMaterialized.value.testSetId, revision: hiddenMaterialized.value.revision,
      project_id: PROJECT, generation_id: hiddenMaterialized.value.generationId, schema_version: 3,
      source_observation_id: null, model_row_id: hiddenMaterialized.value.canonicalSupport.modelRowId,
      model_version: hiddenMaterialized.value.canonicalSupport.modelVersion,
      observation_run_id: hiddenMaterialized.value.canonicalSupport.observationRunId,
      support_seal_hash: hiddenMaterialized.value.canonicalSupport.supportSealHash,
      characterization_policy_id: hiddenMaterialized.value.canonicalSupport.characterizationPolicy.id,
      characterization_policy_version: hiddenMaterialized.value.canonicalSupport.characterizationPolicy.version,
      generated_at: hiddenMaterialized.value.generatedAt, outcome: hiddenMaterialized.value.outcome,
      definition_count: hiddenMaterialized.value.definitions.length, payload_json: hiddenMaterialized.json,
      content_hash: hiddenMaterialized.fingerprint,
    }).execute()
    const hiddenExtra = await adapter.snapshot(PROJECT)
    assert.deepEqual(hiddenExtra.counts, { manualTestSources: 2, definitions: 3, testSetRevisions: 3, manualTestPromotions: 2 })
    assert.equal(hiddenExtra.testSetRevisions[2].generationId, 'generation-hidden-extra')
  })
})

test('CORE-F seam is read-only, trigger-governed, and absent from public production transport', async () => {
  await withDatabase(async () => {
    const adapter = new ManualTestCertificationPersistenceAdapter()
    assert.deepEqual(Object.getOwnPropertyNames(ManualTestCertificationPersistenceAdapter.prototype).sort(), [
      'afterTestSetRevisionInsertBeforePromotion', 'armPromotionFaultOnce', 'assertDisposableCertification',
      'constructor', 'disarmPromotionFault', 'snapshot',
    ])
    const source = await new ManualTestSourceRepository(() => 'core-f-immutable-source').admit(PROJECT, SOURCE_INPUT, NOW)
    await assert.rejects(getDb().updateTable('manual_test_sources').set({ admitted_at: NOW })
      .where('source_id', '=', source.sourceId).execute(), /immutable/i)
    await assert.rejects(getDb().deleteFrom('manual_test_sources').where('source_id', '=', source.sourceId).execute(), /immutable/i)
    const publicTransportFiles = [
      path.join(__dirname, '..', 'forge-ui', 'server', 'routes', 'projects.ts'),
      path.join(__dirname, '..', 'forge-ui', 'server', 'context', 'ManualTestController.ts'),
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n')
    assert.doesNotMatch(publicTransportFiles, /M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN|createM3CertificationHarness|DISPOSABLE_CERTIFICATION|ManualTestCertificationPersistenceAdapter|armPromotionFaultOnce|afterTestSetRevisionInsertBeforePromotion/)
    const executionContextSource = fs.readFileSync(
      path.join(__dirname, '..', 'forge-ui', 'server', 'context', 'ExecutionContext.ts'), 'utf8',
    )
    assert.match(executionContextSource, /createM3CertificationHarness/)
    assert.match(executionContextSource, /M3_CERTIFICATION_EXECUTION_CONTEXT_OPT_IN/)
    adapter.disarmPromotionFault()
  })
})

test('CORE-F adapter refuses Product workspace authority', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-core-f-product-'))
  try {
    initProductWorkspaceDatabase(root)
    await runMigrations()
    assert.throws(() => new ManualTestCertificationPersistenceAdapter(), /disposable governed SQLite database/i)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
