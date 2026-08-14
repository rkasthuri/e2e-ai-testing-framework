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
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sql } from 'kysely'
import { closeDb, getDatabaseProvenance, getProductDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS } from '../src/core/observation/ObservationTypes'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { ObservationReadProjectionService } from '../src/core/observation/ObservationReadProjectionService'
import {
  TestDefinitionAuthorityProjectionService,
  type TestDefinitionAuthorityProjectionResult,
} from '../src/core/test-design/TestDefinitionAuthorityProjectionService'

const PROJECT = 'b2-authority-product'
const START = '2026-08-12T16:00:00.000Z'
const END = '2026-08-12T16:00:01.000Z'

interface Fixture {
  root: string
  dbPath: string
  runId: string
  modelRowId: number
  observationId: string
  extraObservationId: string
  gapId: string
  result(): Promise<TestDefinitionAuthorityProjectionResult>
  close(): Promise<void>
}

function boundary(completion: 'complete' | 'partial') {
  return {
    schemaVersion: 'forge-observation-boundary/v1' as const,
    kind: 'document' as const,
    scope: { acquisitionKind: 'web_crawl' },
    startedAt: START,
    endedAt: END,
    completion,
    policyId: 'forge.b2-authority-boundary',
    policyVersion: '1',
  }
}

async function fixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-004-b2-'))
  await openProjectDatabase(createWorkspace(root))
  const service = new ObservationService(PROJECT, root, {
    producerInstanceId: '44444444-4444-4444-8444-444444444444',
  })
  const run = await service.startRun({
    operationId: 'operation-is-not-provenance', producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', startedAt: START,
    policyId: 'forge.b2-authority-acquisition', policyVersion: '1',
    acquisitionPlan: { target: 'https://example.invalid/' },
  })
  const observed = await service.recordObservation({
    observationRunId: run.value.observationRunId, projectId: PROJECT,
    producer: 'forge.crawler', producerVersion: '1',
    method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId: 'inventory-page', predicate: 'page.discovered', outcome: 'present',
    observedValue: { urlPattern: '/inventory.html', elementCount: 0, fingerprint: 'inventory-dom' },
    boundary: boundary('complete'), capturedAt: END, idempotencyKey: 'inventory-page',
  })
  const extra = await service.recordObservation({
    observationRunId: run.value.observationRunId, projectId: PROJECT,
    producer: 'forge.crawler', producerVersion: '1',
    method: 'browser_dom_inspection', methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId: 'other-page', predicate: 'page.discovered', outcome: 'present',
    observedValue: { urlPattern: '/other.html', elementCount: 0, fingerprint: 'other-dom' },
    boundary: boundary('complete'), capturedAt: END, idempotencyKey: 'other-page',
  })
  const gap = await service.recordGap({
    observationRunId: run.value.observationRunId, projectId: PROJECT,
    producer: 'forge.crawler', producerVersion: '1',
    intendedMethod: 'browser_dom_inspection', intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'checkout-page', intendedPredicate: 'page.discovered',
    boundary: boundary('partial'), reason: 'not_reached', occurredAt: END,
    idempotencyKey: 'checkout-gap', safeMessage: 'Checkout was not reached.',
  })
  await service.terminalizeRun({
    observationRunId: run.value.observationRunId, lifecycle: 'completed', completeness: 'partial', terminalAt: END,
    safeReasonCode: 'coverage_incomplete', safeMessage: 'Partial crawl.',
  })
  const candidate: AppModelCandidate = {
    schemaVersion: '2.0', generatedAt: END, generatedBy: 'engine',
    app: {
      name: PROJECT, displayName: PROJECT, baseUrl: 'https://example.invalid', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'b2-authority', crawledAt: END, crawledBy: 'engine', crawlDurationMs: 1,
        pagesBudget: 1, pagesDiscovered: 1, pagesSkipped: 0,
        aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [{
      id: 'inventory-page', displayName: 'Inventory', urlPattern: '/inventory.html',
      urlPatternType: 'exact', fingerprint: 'inventory-dom', fingerprintBasis: 'url+dom-hash',
      appType: 'web-ui', accessibleByRoles: [], isAuthPage: false, elements: [],
    }],
    flows: [], endpoints: null, api: null, diff: null,
  }
  const committed = await new AppModelRepository().commitCandidate(candidate, 'model-operation', {
    projectId: PROJECT,
    observationRunId: run.value.observationRunId,
    observations: [{ observationId: observed.value.observationId, claimKey: 'page:inventory-page', supportRole: 'basis' }],
    subjects: [{ canonicalSubjectId: 'inventory-page', observationId: observed.value.observationId, claimKey: 'subject.exists', supportRole: 'basis' }],
    gaps: [{ gapId: gap.value.gapId, claimKey: 'application.coverage', supportRole: 'bounds' }],
    characterizationPolicyId: 'forge.crawl-observation-characterization',
    characterizationPolicyVersion: '1', linkedAt: END,
  })
  return {
    root,
    dbPath: getDatabaseProvenance().sqlitePath!,
    runId: run.value.observationRunId,
    modelRowId: committed.committed.rowId,
    observationId: observed.value.observationId,
    extraObservationId: extra.value.observationId,
    gapId: gap.value.gapId,
    result: () => new TestDefinitionAuthorityProjectionService().read(PROJECT),
    close: async () => {
      await closeDb()
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

async function scenario(
  mutate: (value: Fixture) => Promise<void>,
  expectedCode: string,
): Promise<void> {
  const value = await fixture()
  try {
    await mutate(value)
    const result = await value.result()
    assert.equal(result.kind, 'refused')
    if (result.kind === 'refused') assert.equal(result.code, expectedCode)
  } finally {
    await value.close()
  }
}

test('valid sealed authority agrees exactly with ObservationReadProjection and performs no writes', async () => {
  const value = await fixture()
  try {
    const before = crypto.createHash('sha256').update(fs.readFileSync(value.dbPath)).digest('hex')
    const result = await value.result()
    assert.equal(result.kind, 'ok')
    if (result.kind !== 'ok') return
    assert.equal(result.authority.modelRowId, value.modelRowId)
    assert.equal(result.authority.observationRunId, value.runId)
    assert.deepEqual(result.authority.supportingObservationIds, [value.observationId])
    assert.deepEqual(result.authority.supportingGapIds, [value.gapId])
    assert.deepEqual(result.authority.subjectSupport, [{
      canonicalSubjectId: 'inventory-page',
      supportingObservationIds: [value.observationId],
      supportingGapIds: [],
    }])
    const observationRead = await new ObservationReadProjectionService().readProject(PROJECT)
    const support = observationRead.support.find(item => item.modelRowId === value.modelRowId)
    assert.ok(support)
    assert.equal(support?.supportSealHash, result.authority.supportSealHash)
    assert.equal(support?.observationRunId, result.authority.observationRunId)
    assert.deepEqual([...new Set(support?.observations.map(item => item.observationId))].sort(), result.authority.supportingObservationIds)
    assert.deepEqual([...new Set(support?.gaps.map(item => item.gapId))].sort(), result.authority.supportingGapIds)
    assert.deepEqual(support?.characterizationPolicy, result.authority.characterizationPolicy)
    assert.doesNotMatch(JSON.stringify(result), /routePath|authentication|credential|runnerCompatibility|operation-is-not-provenance/)
    const after = crypto.createHash('sha256').update(fs.readFileSync(value.dbPath)).digest('hex')
    assert.equal(after, before)
  } finally {
    await value.close()
  }
})

test('seal mismatch, extra membership, duplicate membership, and policy mismatch refuse', async () => {
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_support_seals_immutable_update`.execute(getProductDb())
    await getProductDb().updateTable('app_model_support_seals').set({ support_hash: '0'.repeat(64) })
      .where('model_row_id', '=', value.modelRowId).execute()
  }, 'support_seal_mismatch')
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_observation_support_closed_insert`.execute(getProductDb())
    await getProductDb().insertInto('app_model_observation_support').values({
      model_row_id: value.modelRowId, project_id: PROJECT, observation_id: value.extraObservationId,
      claim_key: 'page:other-page', support_role: 'basis',
      characterization_policy_id: 'forge.crawl-observation-characterization',
      characterization_policy_version: '1', linked_at: END,
    }).execute()
  }, 'support_seal_mismatch')
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_observation_support_closed_insert`.execute(getProductDb())
    await getProductDb().insertInto('app_model_observation_support').values({
      model_row_id: value.modelRowId, project_id: PROJECT, observation_id: value.observationId,
      claim_key: 'duplicate-claim', support_role: 'bounds',
      characterization_policy_id: 'forge.crawl-observation-characterization',
      characterization_policy_version: '1', linked_at: END,
    }).execute()
  }, 'duplicate_support')
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_observation_support_immutable_update`.execute(getProductDb())
    await getProductDb().updateTable('app_model_observation_support')
      .set({ characterization_policy_version: '2' })
      .where('model_row_id', '=', value.modelRowId).execute()
  }, 'characterization_policy_mismatch')
})

test('missing canonical Observation or Gap refuses exact sealed membership', async () => {
  await scenario(async value => {
    await sql`PRAGMA foreign_keys = OFF`.execute(getProductDb())
    await sql`DROP TRIGGER observations_immutable_delete`.execute(getProductDb())
    await getProductDb().deleteFrom('observations').where('observation_id', '=', value.observationId).execute()
  }, 'missing_observation')
  await scenario(async value => {
    await sql`PRAGMA foreign_keys = OFF`.execute(getProductDb())
    await sql`DROP TRIGGER observation_gaps_immutable_delete`.execute(getProductDb())
    await getProductDb().deleteFrom('observation_gaps').where('gap_id', '=', value.gapId).execute()
  }, 'missing_gap')
})

test('missing and conflicting subject support refuse instead of reconstructing from model or routes', async () => {
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_subject_support_immutable_delete`.execute(getProductDb())
    await getProductDb().deleteFrom('app_model_subject_support')
      .where('model_row_id', '=', value.modelRowId).execute()
  }, 'subject_support_missing')
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_subject_support_immutable_update`.execute(getProductDb())
    await getProductDb().updateTable('app_model_subject_support')
      .set({ observation_id: value.extraObservationId })
      .where('model_row_id', '=', value.modelRowId).execute()
  }, 'subject_support_conflict')
})

test('v1 and operation identity remain legacy-only and cannot satisfy sealed provenance', async () => {
  await scenario(async value => {
    await sql`DROP TRIGGER app_model_observation_support_immutable_delete`.execute(getProductDb())
    await sql`DROP TRIGGER app_model_subject_support_immutable_delete`.execute(getProductDb())
    await sql`DROP TRIGGER app_model_gap_support_immutable_delete`.execute(getProductDb())
    await sql`DROP TRIGGER app_model_support_seals_immutable_delete`.execute(getProductDb())
    await getProductDb().deleteFrom('app_model_observation_support').where('model_row_id', '=', value.modelRowId).execute()
    await getProductDb().deleteFrom('app_model_subject_support').where('model_row_id', '=', value.modelRowId).execute()
    await getProductDb().deleteFrom('app_model_gap_support').where('model_row_id', '=', value.modelRowId).execute()
    await getProductDb().deleteFrom('app_model_support_seals')
      .where('model_row_id', '=', value.modelRowId).execute()
  }, 'legacy_provenance_unsupported')
})

test('controller cannot supply fabricated support and readiness consumes only core authority', () => {
  const controller = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/TestInventoryController.ts'), 'utf8')
  const readiness = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ApplicationReadinessController.ts'), 'utf8')
  assert.match(controller, /readCanonicalTestDefinitionAdmission|generateCanonicalTestSet/)
  assert.doesNotMatch(controller, /sourceObservationId|readEvidenceLedger|supportSealHash|supportingObservationIds|supportingGapIds/)
  assert.match(readiness, /readTestDefinitionAuthority/)
  assert.match(readiness, /testDefinitionAuthority/)
})
