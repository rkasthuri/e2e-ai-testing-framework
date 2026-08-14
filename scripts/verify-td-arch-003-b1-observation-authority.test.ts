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

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { closeDb, getProductDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS } from '../src/core/observation/ObservationTypes'
import { ObservationReplayConflictError } from '../src/core/observation/ObservationErrors'
import { CrawlObservationProducer } from '../src/core/observation/CrawlObservationProducer'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-003-b1-'))
const PROJECT = 'b1-product'
let service: ObservationService

before(async () => {
  await openProjectDatabase(createWorkspace(ROOT))
  service = new ObservationService(PROJECT, ROOT, { producerInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

function boundary(startedAt: string, endedAt: string, completion: 'complete' | 'partial' = 'complete') {
  return {
    schemaVersion: 'forge-observation-boundary/v1' as const,
    kind: 'document' as const,
    scope: { acquisitionKind: 'web_crawl' },
    startedAt,
    endedAt,
    completion,
    policyId: 'forge.test-boundary',
    policyVersion: '1',
  }
}

function controlBoundary(startedAt: string, endedAt: string, completion: 'complete' | 'partial', absent = false) {
  return {
    ...boundary(startedAt, endedAt, completion),
    scope: absent
      ? { route: '/inventory.html', queryDigest: 'a'.repeat(64) }
      : { route: '/inventory.html' },
  }
}

test('TD-ARCH-003-B1 canonical crawl Observation authority contract', async () => {
  const startedAt = '2026-08-11T12:00:00.000Z'
  const capturedAt = '2026-08-11T12:00:01.000Z'
  const runResult = await service.startRun({
    operationId: 'b1-operation', producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', startedAt, policyId: 'forge.test-acquisition', policyVersion: '1',
    acquisitionPlan: { url: 'https://example.invalid/' },
  })
  assert.equal(runResult.outcome, 'committed_new')
  const run = runResult.value

  const positiveInput = {
    observationRunId: run.observationRunId, projectId: PROJECT,
    producer: 'forge.crawler', producerVersion: '1', method: 'browser_dom_inspection',
    methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId: 'inventory-page', predicate: 'page.discovered', outcome: 'present',
    observedValue: { urlPattern: '/inventory.html', elementCount: 1, fingerprint: 'inventory-dom' }, boundary: boundary(startedAt, capturedAt),
    capturedAt, idempotencyKey: 'page-inventory',
  }
  const positive = await service.recordObservation(positiveInput)
  assert.equal(positive.value.outcome, 'present')
  assert.equal((await service.recordObservation(positiveInput)).value.observationId, positive.value.observationId)
  await assert.rejects(
    service.recordObservation({ ...positiveInput, observedValue: { ...positiveInput.observedValue, fingerprint: 'different-dom' } }),
    ObservationReplayConflictError,
  )

  await assert.rejects(service.recordObservation({
    ...positiveInput, subjectId: 'missing-control', predicate: 'control.present', outcome: 'absent',
    observedValue: undefined, boundary: controlBoundary(startedAt, capturedAt, 'partial', true), idempotencyKey: 'invalid-negative',
  }), /Absent requires a complete boundary/i)

  const artifact = await service.persistArtifact({
    observationRunId: run.observationRunId, projectId: PROJECT, mediaType: 'text/html',
    content: '<html><body>inventory</body></html>', sensitivityClass: 'internal',
    redactionState: 'not_required', capturedAt, retentionClass: 'standard_diagnostic',
    retentionPolicyId: 'forge.test-retention', retentionPolicyVersion: '1',
  })
  const negative = await service.recordObservation({
    ...positiveInput, subjectId: 'missing-control', predicate: 'control.present', outcome: 'absent',
    observedValue: undefined, boundary: controlBoundary(startedAt, capturedAt, 'complete', true),
    artifactIds: [artifact.value.artifactId], idempotencyKey: 'valid-negative',
  })
  assert.equal(negative.value.outcome, 'absent')
  await service.recordObservation({
    ...positiveInput, subjectId: 'conflicting-control', predicate: 'control.present', outcome: 'present',
    observedValue: undefined, boundary: controlBoundary(startedAt, capturedAt, 'complete'), idempotencyKey: 'present-control',
  })
  await assert.rejects(service.recordObservation({
    ...positiveInput, subjectId: 'conflicting-control', predicate: 'control.present', outcome: 'absent', observedValue: undefined,
    boundary: controlBoundary(startedAt, capturedAt, 'complete', true), artifactIds: [artifact.value.artifactId], idempotencyKey: 'conflicting-negative',
  }), /unreconciled present Observation/i)

  const indeterminate = await service.recordObservation({
    ...positiveInput, subjectId: 'uncertain-control', predicate: 'control.present', outcome: 'indeterminate',
    observedValue: undefined, boundary: controlBoundary(startedAt, capturedAt, 'partial'),
    safeReasonCode: 'boundary_incomplete', idempotencyKey: 'indeterminate-control',
  })
  assert.equal(indeterminate.value.outcome, 'indeterminate')

  const gap = await service.recordGap({
    observationRunId: run.observationRunId, projectId: PROJECT, producer: 'forge.crawler', producerVersion: '1',
    intendedMethod: 'browser_dom_inspection', intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'checkout-page', intendedPredicate: 'page.discovered',
    boundary: boundary(startedAt, capturedAt, 'partial'), reason: 'not_reached', occurredAt: capturedAt,
    idempotencyKey: 'gap-checkout', safeMessage: 'Checkout was not reached.',
  })
  assert.equal(gap.value.reason, 'not_reached')

  const failedArtifactService = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: service.producerInstanceId,
    artifacts: { persist: async () => { throw new Error('injected artifact write failure') } },
  })
  await assert.rejects(failedArtifactService.persistArtifact({
    observationRunId: run.observationRunId, projectId: PROJECT, mediaType: 'text/plain', content: 'diagnostic',
    sensitivityClass: 'internal', redactionState: 'not_required', capturedAt,
    retentionClass: 'short_lived_diagnostic', retentionPolicyId: 'forge.test-retention', retentionPolicyVersion: '1',
  }), /injected artifact write failure/)
  const artifactGap = await failedArtifactService.recordGap({
    observationRunId: run.observationRunId, projectId: PROJECT, producer: 'forge.crawler', producerVersion: '1',
    intendedMethod: 'browser_dom_inspection', intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'diagnostic-artifact', intendedPredicate: 'artifact.persisted',
    boundary: boundary(startedAt, capturedAt, 'partial'), reason: 'artifact_persistence_failed', occurredAt: capturedAt,
    idempotencyKey: 'gap-artifact-write', safeMessage: 'Artifact persistence failed.',
  })
  assert.equal(artifactGap.value.reason, 'artifact_persistence_failed')

  await assert.rejects(service.repository.findRun('other-product', run.observationRunId), /cross-project/i)
  const terminal = await service.terminalizeRun({
    observationRunId: run.observationRunId, terminalAt: capturedAt, lifecycle: 'completed',
    completeness: 'partial', safeReasonCode: 'coverage_incomplete', safeMessage: 'Partial crawl.',
  })
  assert.equal(terminal.completeness, 'partial')

  const candidate: AppModelCandidate = {
    schemaVersion: '2.0', generatedAt: capturedAt, generatedBy: 'engine',
    app: {
      name: PROJECT, displayName: PROJECT, baseUrl: 'https://example.invalid', appType: 'web-ui',
      spaConfig: null, evidenceState: 'crawled-empty',
      crawlMetadata: {
        crawlConfigHash: 'b1-test', crawledAt: capturedAt, crawledBy: 'engine', crawlDurationMs: 1,
        pagesBudget: 1, pagesDiscovered: 0, pagesSkipped: null, aiBudgetStatus: 'within-budget', crawlDiagnostics: null,
      },
    },
    roles: [], pages: [], flows: [], endpoints: null, api: null, diff: null,
  }
  const repository = new AppModelRepository()
  const support = {
    projectId: PROJECT, observationRunId: run.observationRunId,
    observations: [{ observationId: positive.value.observationId, claimKey: 'application.observed', supportRole: 'basis' as const }],
    subjects: [], gaps: [{ gapId: gap.value.gapId, claimKey: 'application.coverage', supportRole: 'bounds' as const }],
    characterizationPolicyId: 'forge.test-characterization', characterizationPolicyVersion: '1', linkedAt: capturedAt,
  }
  const committed = await repository.commitCandidate(candidate, 'b1-model-operation', support)
  assert.equal(committed.outcome, 'committed_new')
  assert.equal((await getProductDb().selectFrom('app_model_observation_support').selectAll().where('model_row_id', '=', committed.committed.rowId).execute()).length, 1)
  assert.equal((await getProductDb().selectFrom('app_model_gap_support').selectAll().where('model_row_id', '=', committed.committed.rowId).execute()).length, 1)
  await assert.rejects(getProductDb().insertInto('app_model_observation_support').values({
    model_row_id: committed.committed.rowId, project_id: PROJECT, observation_id: positive.value.observationId,
    claim_key: 'late-support', support_role: 'basis', characterization_policy_id: 'forge.test-characterization',
    characterization_policy_version: '1', linked_at: capturedAt,
  }).execute(), /support set is sealed/i)
  await assert.rejects(getProductDb().insertInto('observation_artifact_links').values({
    artifact_id: artifact.value.artifactId, project_id: PROJECT, observation_id: positive.value.observationId,
    gap_id: null, ordinal: 1,
  }).execute(), /artifact set is sealed/i)
  const appModelCount = await getProductDb().selectFrom('app_models').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()
  await assert.rejects(repository.commitCandidate(candidate, 'b1-model-invalid-support', {
    ...support,
    observations: [{ observationId: '00000000-0000-4000-8000-000000000000', claimKey: 'missing', supportRole: 'basis' }],
  }), /missing or cross-run Observation/i)
  const afterFailedCommit = await getProductDb().selectFrom('app_models').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()
  assert.equal(Number(afterFailedCommit.count), Number(appModelCount.count), 'model and support must roll back together')
  assert.equal((await repository.findActive(PROJECT))?.id, committed.committed.rowId)
  const history = await repository.readHistory(PROJECT)
  assert.equal(history.kind, 'ok')
  if (history.kind === 'ok') {
    assert.equal(history.activeModel?.sourceObservationId, null, 'operation_id must not masquerade as canonical Observation provenance')
    assert.equal(history.activeModel?.sourceObservationRunId, run.observationRunId)
    assert.deepEqual(history.activeModel?.supportObservationIds, [positive.value.observationId])
  }

  const db = getProductDb()
  await assert.rejects(db.insertInto('app_model_observation_support').values({
    model_row_id: 999999, project_id: PROJECT,
    observation_id: '00000000-0000-4000-8000-000000000000', claim_key: 'missing', support_role: 'basis',
    characterization_policy_id: 'forge.test', characterization_policy_version: '1', linked_at: capturedAt,
  }).execute(), /(?:crosses project authority|FOREIGN KEY constraint failed)/i)

  const tables = await db.selectFrom('observation_runs').select('observation_run_id').execute()
  assert.equal(tables.length, 1)
  assert.equal(fs.existsSync(path.join(ROOT, artifact.value.storageKey)), true)
  assert.equal(/(?:7|14|30)[_-]?day/i.test(artifact.value.retentionClass), false)

  const deadProducer = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', producerProcessId: 2147483000,
  })
  const streamedRun = (await deadProducer.startRun({
    operationId: 'b1-streamed-partial', producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', policyId: 'forge.test-acquisition', policyVersion: '1',
    acquisitionPlan: { url: 'https://example.invalid/partial' },
  })).value
  const streamed = await new CrawlObservationProducer().persistPageDiscovery({
    pageId: 'streamed-page', urlPattern: '/streamed', elements: [], outboundUrls: [],
    domHash: 'streamed-dom-hash', isAuthPage: false,
  }, streamedRun, deadProducer)
  assert.equal(streamed.subjectId, 'streamed-page')
  const restarted = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })
  const reconciliationRun = (await restarted.startRun({
    operationId: 'b1-restart-reconciliation', producer: 'forge.crawler', producerVersion: '1',
    acquisitionKind: 'web_crawl', policyId: 'forge.test-acquisition', policyVersion: '1',
    acquisitionPlan: { url: 'https://example.invalid/restart' },
  })).value
  const recovered = await restarted.readRun(streamedRun.observationRunId)
  assert.equal(recovered?.run.lifecycle, 'interrupted')
  assert.equal(recovered?.run.completeness, 'partial')
  assert.deepEqual(recovered?.observations.map(item => item.observationId), [streamed.observationId])
  await restarted.terminalizeRun({
    observationRunId: reconciliationRun.observationRunId, lifecycle: 'interrupted', completeness: 'unobserved',
    safeReasonCode: 'test_cleanup', safeMessage: 'Test reconciliation envelope.',
  })
})

test('TD-ARCH-003-B1 UI adopted route delegates canonical truth to core', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '..', 'forge-ui', 'server', 'routes', 'crawl.ts'), 'utf8')
  const post = route.slice(route.indexOf("router.post('/'"), route.indexOf("router.get('/:jobId/status'"))
  assert.doesNotMatch(post, /observationStore\.(begin|complete)|finalizeObservation/)
  assert.doesNotMatch(post, /checkReachability/)
  assert.match(post, /observationId:\s*null/)
  for (const file of ['BFSStrategy.ts', 'SPAStrategy.ts']) {
    const strategy = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'core', 'onboarding', file), 'utf8')
    assert.match(strategy, /await this\.onPageDiscovered\?\.\(/)
  }
})
