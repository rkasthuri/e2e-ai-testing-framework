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
import { CrawlObservationProducer } from '../src/core/observation/CrawlObservationProducer'
import { ApiSpecCrawler } from '../src/core/onboarding/ApiSpecCrawler'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import type { AppModelCandidate } from '../src/core/onboarding/types'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-003-b1-r-'))
const PROJECT = 'b1-r-product'
const START = '2026-08-12T12:00:00.000Z'
const END = '2026-08-12T12:00:01.000Z'
const PRODUCER = 'forge.crawler'
let service: ObservationService

before(async () => {
  await openProjectDatabase(createWorkspace(ROOT))
  service = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: '11111111-1111-4111-8111-111111111111',
  })
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

function documentBoundary(
  completion: 'complete' | 'partial' = 'complete',
  scope: Record<string, unknown> = { acquisitionKind: 'web_crawl' },
) {
  return {
    schemaVersion: 'forge-observation-boundary/v1' as const,
    kind: 'document' as const,
    scope,
    startedAt: START,
    endedAt: END,
    completion,
    policyId: 'forge.b1-r-boundary',
    policyVersion: '1',
  }
}

function httpBoundary() {
  return {
    ...documentBoundary(),
    kind: 'http_exchange' as const,
    scope: { requestMethod: 'GET', requestUrl: 'https://example.invalid/items', responseStatus: 200 },
  }
}

async function start(operationId: string, owner = service, acquisitionKind: 'web_crawl' | 'api_crawl' = 'web_crawl') {
  return (await owner.startRun({
    operationId,
    producer: PRODUCER,
    producerVersion: '1',
    acquisitionKind,
    startedAt: START,
    policyId: 'forge.b1-r-acquisition',
    policyVersion: '1',
    acquisitionPlan: { target: 'https://example.invalid/' },
  })).value
}

function observation(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    observationRunId: runId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    method: 'browser_dom_inspection',
    methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    subjectId: 'inventory-page',
    predicate: 'page.discovered',
    outcome: 'present',
    observedValue: { urlPattern: '/inventory.html', elementCount: 1, fingerprint: 'dom-digest' },
    boundary: documentBoundary(),
    capturedAt: END,
    idempotencyKey: 'page-inventory',
    ...overrides,
  } as any
}

function emptyCandidate(name = PROJECT): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: END,
    generatedBy: 'engine',
    app: {
      name,
      displayName: name,
      baseUrl: 'https://example.invalid',
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled-empty',
      crawlMetadata: {
        crawlConfigHash: 'b1-r',
        crawledAt: END,
        crawledBy: 'engine',
        crawlDurationMs: 1,
        pagesBudget: 1,
        pagesDiscovered: 0,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [],
    flows: [],
    endpoints: null,
    api: null,
    diff: null,
  }
}

function pageCandidate(): AppModelCandidate {
  const candidate = emptyCandidate()
  candidate.app.evidenceState = 'crawled'
  candidate.app.crawlMetadata!.pagesDiscovered = 1
  candidate.app.crawlMetadata!.pagesSkipped = 0
  candidate.pages = [{
    id: 'inventory-page',
    displayName: 'Inventory',
    urlPattern: '/inventory.html',
    urlPatternType: 'exact',
    fingerprint: 'dom-digest',
    fingerprintBasis: 'url+dom-hash',
    appType: 'web-ui',
    accessibleByRoles: [],
    isAuthPage: false,
    elements: [],
  }]
  return candidate
}

test('B1-R API specification intake remains planning input and never HTTP Observation provenance', async () => {
  const inlineConfig: any = {
    app: { name: PROJECT, baseUrl: 'https://example.invalid', appType: 'rest-api' },
    appType: 'rest-api',
    roles: [],
    apiEndpoints: [{ method: 'GET', path: '/items', summary: 'Items', auth: false }],
  }
  const inline = await new ApiSpecCrawler(inlineConfig).crawl()
  const inlineRun = await start('inline-spec', service, 'api_crawl')
  const inlineTruth = await new CrawlObservationProducer().persist(inline, inlineRun, service)
  await service.terminalizeRun({
    observationRunId: inlineRun.observationRunId,
    lifecycle: 'blocked',
    completeness: inlineTruth.completeness,
    terminalAt: END,
    safeReasonCode: 'planning_input_only',
    safeMessage: 'API specification input did not establish an HTTP exchange.',
  })
  assert.equal(inlineTruth.support.observations.length, 0)
  assert.equal(inlineTruth.support.subjects.length, 0)
  assert.equal(inlineTruth.support.gaps.length, 1)
  assert.equal((await service.readRun(inlineRun.observationRunId))?.observations.length, 0)
  const model = await new AppModelRepository().commitCandidate(inline, 'inline-spec-model', inlineTruth.support)
  assert.equal((await getProductDb().selectFrom('app_model_observation_support').selectAll()
    .where('model_row_id', '=', model.committed.rowId).execute()).length, 0)

  const specPath = path.join(ROOT, 'openapi.json')
  fs.writeFileSync(specPath, JSON.stringify({ openapi: '3.0.0', paths: { '/local': { get: { responses: { 200: {} } } } } }))
  const local = await new ApiSpecCrawler({ ...inlineConfig, apiEndpoints: undefined, apiSpecFile: specPath }).crawl()
  const localRun = await start('local-spec', service, 'api_crawl')
  const localTruth = await new CrawlObservationProducer().persist(local, localRun, service)
  await service.terminalizeRun({
    observationRunId: localRun.observationRunId,
    lifecycle: 'blocked',
    completeness: localTruth.completeness,
    terminalAt: END,
    safeReasonCode: 'planning_input_only',
    safeMessage: 'Local API specification input did not establish an HTTP exchange.',
  })
  assert.equal((await service.readRun(localRun.observationRunId))?.observations.length, 0)
})

test('B1-R Observation admission and bounded absence fail closed', async () => {
  const run = await start('admission')
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    predicate: 'invented.predicate',
    idempotencyKey: 'bad-predicate',
  })), /Unsupported DOM predicate/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    boundary: { ...documentBoundary(), kind: 'http_exchange' },
    idempotencyKey: 'bad-boundary',
  })), /cannot use boundary/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    boundary: documentBoundary('complete', { acquisitionKind: 'web_crawl', unexpected: true }),
    idempotencyKey: 'bad-scope',
  })), /unknown or missing fields/)
  await assert.rejects(service.recordObservation({
    ...observation(run.observationRunId, { idempotencyKey: 'unknown-input' }),
    unexpected: true,
  }), /unknown fields/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    subjectId: 'missing-control',
    predicate: 'control.present',
    outcome: 'absent',
    observedValue: undefined,
    boundary: documentBoundary('partial', { route: '/inventory.html', queryDigest: 'a'.repeat(64) }),
    idempotencyKey: 'partial-absence',
  })), /complete boundary/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    subjectId: 'missing-control',
    predicate: 'control.present',
    outcome: 'absent',
    observedValue: undefined,
    boundary: documentBoundary('complete', { route: '/inventory.html', queryDigest: 'a'.repeat(64) }),
    idempotencyKey: 'artifactless-absence',
  })), /durable method artifacts/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    safeMessage: 'Authorization: Bearer top-secret-token',
    idempotencyKey: 'secret-message',
  })), /governed redacted operator text/)
  await assert.rejects(service.recordObservation(observation(run.observationRunId, {
    observedValue: { urlPattern: '/inventory.html', elementCount: 1, fingerprint: 'dom', note: 'Bearer top-secret-token' },
    idempotencyKey: 'secret-value',
  })), /unknown or missing fields|prohibited sensitive material/)

  const http = await service.recordObservation(observation(run.observationRunId, {
    method: 'http_response_inspection',
    methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.http_response_inspection,
    subjectId: 'items-endpoint',
    predicate: 'endpoint.response.status',
    observedValue: 200,
    boundary: httpBoundary(),
    idempotencyKey: 'actual-http',
  }))
  assert.equal(http.value.method, 'http_response_inspection')
  await service.terminalizeRun({
    observationRunId: run.observationRunId,
    lifecycle: 'completed',
    completeness: 'partial',
    terminalAt: END,
    safeReasonCode: 'bounded_test',
    safeMessage: 'The governed admission test completed with bounded scope.',
  })
})

test('B1-R artifact admission rejects credential material before authority rows exist', async () => {
  const run = await start('artifact-redaction')
  const before = await getProductDb().selectFrom('observation_artifacts').selectAll().execute()
  const fixtures: Array<{ mediaType: 'application/json' | 'text/html' | 'text/plain'; content: string }> = [
    { mediaType: 'application/json', content: '{"password":"quoted-secret"}' },
    { mediaType: 'application/json', content: '{"nested":{"secret":"hidden"}}' },
    { mediaType: 'text/html', content: '<input type="password" value="populated">' },
    { mediaType: 'text/plain', content: 'Authorization: Bearer abc.def.ghi' },
    { mediaType: 'application/json', content: '{"session":{"cookie":"session-token"}}' },
  ]
  for (const [index, fixture] of fixtures.entries()) {
    await assert.rejects(service.persistArtifact({
      observationRunId: run.observationRunId,
      projectId: PROJECT,
      mediaType: fixture.mediaType,
      content: fixture.content,
      sensitivityClass: 'sensitive',
      redactionState: 'redacted',
      capturedAt: END,
      retentionClass: 'standard_diagnostic',
      retentionPolicyId: 'forge.b1-r-retention',
      retentionPolicyVersion: '1',
    }), /credential, token, cookie, or authorization material/)
    assert.equal((await getProductDb().selectFrom('observation_artifacts').selectAll().execute()).length, before.length, `fixture ${index} created no authority row`)
  }
  await service.terminalizeRun({
    observationRunId: run.observationRunId,
    lifecycle: 'blocked',
    completeness: 'unobserved',
    terminalAt: END,
    safeReasonCode: 'redaction_test',
    safeMessage: 'Sensitive artifact fixtures were refused.',
  })
})

test('B1-R ownership recovery preserves live work and recovers only affirmatively dead PID ownership', async () => {
  const live = await start('live-owner')
  const foreign = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: '22222222-2222-4222-8222-222222222222',
  })
  await assert.rejects(start('foreign-live-owner', foreign), /live process ownership|active ObservationRun/i)
  assert.equal((await service.readRun(live.observationRunId))?.run.lifecycle, 'running')
  await service.terminalizeRun({
    observationRunId: live.observationRunId,
    lifecycle: 'interrupted',
    completeness: 'unobserved',
    terminalAt: END,
    safeReasonCode: 'test_cleanup',
    safeMessage: 'The live ownership proof was closed by its owning process.',
  })

  const dead = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: '33333333-3333-4333-8333-333333333333',
    producerProcessId: 2147483000,
  })
  const abandoned = await start('dead-owner', dead)
  const recoveredBy = await start('recover-dead-owner', foreign)
  assert.equal((await foreign.readRun(abandoned.observationRunId))?.run.lifecycle, 'interrupted')
  await foreign.terminalizeRun({
    observationRunId: recoveredBy.observationRunId,
    lifecycle: 'interrupted',
    completeness: 'unobserved',
    terminalAt: END,
    safeReasonCode: 'test_cleanup',
    safeMessage: 'The dead ownership recovery proof completed.',
  })
})

test('B1-R cross-path support identity, sealing, and replay are complete', async () => {
  const run = await start('cross-path')
  const page = await new CrawlObservationProducer().persistPageDiscovery({
    pageId: 'inventory-page',
    urlPattern: '/inventory.html?session=discarded',
    elements: [],
    outboundUrls: [],
    domHash: 'dom-digest',
    isAuthPage: false,
  }, run, service, END)
  const gap = await service.recordGap({
    observationRunId: run.observationRunId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    intendedMethod: 'browser_dom_inspection',
    intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'checkout-page',
    intendedPredicate: 'page.discovered',
    boundary: documentBoundary('partial'),
    reason: 'not_reached',
    occurredAt: END,
    idempotencyKey: 'checkout-not-reached',
    safeMessage: 'Checkout was not reached within the governed crawl boundary.',
  })
  await service.terminalizeRun({
    observationRunId: run.observationRunId,
    lifecycle: 'completed',
    completeness: 'partial',
    terminalAt: END,
    safeReasonCode: 'coverage_incomplete',
    safeMessage: 'The governed crawl boundary was partially observed.',
  })
  const support = {
    projectId: PROJECT,
    observationRunId: run.observationRunId,
    observations: [{ observationId: page.observationId, claimKey: 'page:inventory-page', supportRole: 'basis' as const }],
    subjects: [{ canonicalSubjectId: 'inventory-page', observationId: page.observationId, claimKey: 'subject.exists', supportRole: 'basis' as const }],
    gaps: [{ gapId: gap.value.gapId, claimKey: 'application.coverage', supportRole: 'bounds' as const }],
    characterizationPolicyId: 'forge.crawl-observation-characterization',
    characterizationPolicyVersion: '1',
    linkedAt: END,
  }
  const repository = new AppModelRepository()
  const committed = await repository.commitCandidate(pageCandidate(), 'cross-path-model', support)
  assert.equal((await repository.commitCandidate(pageCandidate(), 'cross-path-model', support)).outcome, 'replayed_existing')
  await assert.rejects(repository.commitCandidate(pageCandidate(), 'cross-path-model', {
    ...support,
    subjects: [{ ...support.subjects[0], claimKey: 'subject.changed' }],
  }), /different canonical Observation support/)
  await assert.rejects(repository.commitCandidate(pageCandidate(), 'cross-path-model', {
    ...support,
    characterizationPolicyVersion: '2',
  }), /different canonical Observation support/)

  const db = getProductDb()
  await assert.rejects(db.insertInto('app_model_subject_support').values({
    model_row_id: committed.committed.rowId,
    project_id: PROJECT,
    canonical_subject_id: 'inventory-page',
    observation_id: page.observationId,
    claim_key: 'late',
    support_role: 'basis',
    characterization_policy_id: support.characterizationPolicyId,
    characterization_policy_version: support.characterizationPolicyVersion,
    linked_at: END,
  }).execute(), /support set is sealed/)
  const artifact = await service.repository.insertArtifact({
    artifact_id: '44444444-4444-4444-8444-444444444444',
    observation_run_id: run.observationRunId,
    project_id: PROJECT,
    storage_key: '.forge/observation-artifacts/test/immutable.txt',
    sha256: 'a'.repeat(64),
    media_type: 'text/plain',
    byte_size: 0,
    sensitivity_class: 'internal',
    redaction_state: 'not_required',
    captured_at: END,
    retention_class: 'standard_diagnostic',
    retention_policy_id: 'forge.b1-r-retention',
    retention_policy_version: '1',
    expires_at: null,
  })
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: artifact.value.artifactId,
    project_id: PROJECT,
    observation_id: page.observationId,
    gap_id: null,
    ordinal: 0,
  }).execute(), /artifact set is sealed/)
  assert.equal((await db.selectFrom('app_model_support_seals').selectAll()
    .where('model_row_id', '=', committed.committed.rowId).execute()).length, 1)
})

test('B1-R transport route admits work without deciding reachability truth', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '..', 'forge-ui', 'server', 'routes', 'crawl.ts'), 'utf8')
  const post = route.slice(route.indexOf("router.post('/'"), route.indexOf("router.get('/:jobId/status'"))
  assert.doesNotMatch(post, /checkReachability|TARGET_UNREACHABLE/)
  assert.match(post, /jobRunner\.submit/)
  assert.match(post, /observationId:\s*null/)
})

test('B1-R unreachable acquisition is admitted before canonical failed-gap truth', async () => {
  const run = await start('unreachable-target')
  const gap = await service.recordGap({
    observationRunId: run.observationRunId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    intendedMethod: 'browser_dom_inspection',
    intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'unreachable-start-page',
    intendedPredicate: 'page.discovered',
    boundary: documentBoundary('partial'),
    reason: 'acquisition_failed',
    occurredAt: END,
    idempotencyKey: 'unreachable-acquisition',
    safeMessage: 'The governed target could not be acquired.',
  })
  await service.terminalizeRun({
    observationRunId: run.observationRunId,
    lifecycle: 'failed',
    completeness: 'unobserved',
    terminalAt: END,
    safeReasonCode: 'acquisition_failed',
    safeMessage: 'Acquisition failed after canonical run admission.',
  })
  const snapshot = await service.readRun(run.observationRunId)
  assert.equal(snapshot?.run.lifecycle, 'failed')
  assert.equal(snapshot?.run.completeness, 'unobserved')
  assert.deepEqual(snapshot?.gaps.map(item => item.gapId), [gap.value.gapId])
  assert.equal(snapshot?.observations.length, 0)
})
