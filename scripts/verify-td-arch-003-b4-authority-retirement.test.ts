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
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ObservationStore } from '../forge-ui/server/registry/ObservationStore'
import { readApplicationEvidenceInventory } from '../forge-ui/server/context/ApplicationEvidenceInventoryController'
import { readApplicationReadiness } from '../forge-ui/server/context/ApplicationReadinessController'

const ROOT = path.resolve(process.cwd())
const source = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('ObservationService is the sole active Product Observation writer', () => {
  const crawlRunner = source('src/core/runner/CrawlRunner.ts')
  const producer = source('src/core/observation/CrawlObservationProducer.ts')
  const legacyStore = source('forge-ui/server/registry/ObservationStore.ts')
  assert.match(crawlRunner, /new ObservationService/)
  assert.match(producer, /ObservationService/)
  assert.doesNotMatch(legacyStore, /\bbegin\s*\(|\bcomplete\s*\(|writeFileSync|writeImmutable/)
  assert.equal('begin' in ObservationStore.prototype, false)
  assert.equal('complete' in ObservationStore.prototype, false)
})

test('canonical evidence never falls back to legacy compatibility', async () => {
  let reads = 0
  const emptyCanonical = {
    authority: 'canonical_product', canonicalRunCount: 0, evidence: [],
    page: { projectTotal: 0, currentSupportTotal: 0, historicalSupportTotal: 0, filteredTotal: 0 },
  }
  const result = await readApplicationEvidenceInventory(
    'saucedemo', {}, async () => ({ appName: 'saucedemo' }),
    { readApplicationEvidenceInventory: async () => { reads += 1; return emptyCanonical } } as any,
  )
  assert.equal(result.status, 200)
  assert.equal((result.body as any).data.authority, 'canonical_product')
  assert.equal((result.body as any).data.canonicalRunCount, 0)
  assert.equal(reads, 1)
})

test('readiness refuses non-canonical Observation projection authority', async () => {
  const result = await readApplicationReadiness(
    'saucedemo', async () => ({ appName: 'saucedemo' }), {
      observationReader: {
        readObservationHistoryView: async () => ({ authority: 'legacy_compatibility', observations: [] }),
      } as any,
    },
  )
  assert.equal(result.status, 422)
  assert.match(JSON.stringify(result.body), /READINESS_SOURCE_INVALID/)
})

test('readiness accepts the canonical projection null authentication outcome without inventing truth', async () => {
  const observationId = '11111111-1111-4111-8111-111111111111'
  const evidenceId = '22222222-2222-4222-8222-222222222222'
  let authorityReads = 0
  let semanticAdmissionReads = 0
  const result = await readApplicationReadiness(
    'saucedemo', async () => ({ appName: 'saucedemo' }), {
      observationReader: { readObservationHistoryView: async () => ({
        authority: 'canonical_product',
        observations: [{
          observationId, projectId: 'saucedemo', startedAt: '2026-08-12T10:00:00.000Z',
          completedAt: '2026-08-12T10:01:00.000Z', terminalState: 'partially_completed',
          authentication: { expectation: 'unknown', credentialAvailability: 'unknown', outcome: null },
          observedSubjects: [{ id: 'inventory-html' }],
          evidence: [{ id: evidenceId, integrity: 'valid', capturedAt: '2026-08-12T10:00:30.000Z' }],
          blockers: [], unknowns: [], limitations: [{ category: 'scope' }],
        }],
      }) } as any,
      modelReader: async () => ({ status: 200, body: { data: {
        page: { total: 1, activeCount: 1 },
        currentModel: {
          rowId: 1, version: '1.0.0', lifecycle: 'active', createdAt: '2026-08-12T10:01:01.000Z',
          sourceObservation: { id: observationId }, validation: 'valid', integrity: 'verified', projection: 'current',
          subjects: [{ id: 'inventory-html', basis: 'direct_observation', evidenceId, derivedClassification: null }],
        },
      } } }),
      evidenceReader: async () => ({ status: 200, body: { data: {
        authority: 'canonical_product',
        page: { projectTotal: 1, currentSupportTotal: 1, historicalSupportTotal: 0, filteredTotal: 1 },
        evidence: [{
          id: evidenceId, canonicalSubjectId: 'inventory-html', support: 'current', integrity: 'verified',
          freshness: 'not_evaluated', access: 'available', conflict: 'not_evaluated',
          sourceObservation: { id: observationId }, sourceModels: [{ rowId: 1 }],
        }],
      } } }),
      authorityReader: { readTestDefinitionAuthority: async () => {
        authorityReads += 1
        return { kind: 'ok', authority: {
          authorityClass: 'canonical_v2', modelRowId: 1, modelVersion: '1.0.0',
          observationRunId: observationId, supportSealHash: 'a'.repeat(64),
          characterizationPolicy: { id: 'canonical-characterization', version: '1.0.0' },
          supportingObservationIds: [observationId], supportingGapIds: [],
          subjectSupport: [{ canonicalSubjectId: 'inventory-html', observationIds: [observationId], gapIds: [] }],
        } }
      } } as any,
      semanticAdmissionReader: { readCanonicalTestDefinitionAdmission: async () => {
        semanticAdmissionReads += 1
        return { kind: 'ok', authenticationExpectation: { state: 'unknown' } }
      } } as any,
    },
  )
  assert.equal(
    result.status,
    200,
    `deterministic readiness dependency calls: authority=${authorityReads}, semanticAdmission=${semanticAdmissionReads}`,
  )
  assert.equal(authorityReads, 1, 'the deterministic Definition authority reader must be used exactly once')
  assert.equal(semanticAdmissionReads, 1, 'the deterministic semantic-admission reader must be used exactly once')
  assert.equal((result.body as any).data.authoritySnapshot.latestObservation.authenticationOutcome, null)
})

test('readiness dependency failures stay bounded while test diagnostics identify the failing category', async () => {
  let authorityFailureObserved = false
  const result = await readApplicationReadiness(
    'saucedemo', async () => ({ appName: 'saucedemo' }), {
      observationReader: { readObservationHistoryView: async () => ({
        authority: 'canonical_product', observations: [],
      }) } as any,
      modelReader: async () => ({ status: 200, body: { data: {
        page: { total: 0, activeCount: 0 }, currentModel: null,
      } } }),
      evidenceReader: async () => ({ status: 200, body: { data: {
        authority: 'canonical_product',
        page: { projectTotal: 0, currentSupportTotal: 0, historicalSupportTotal: 0, filteredTotal: 0 },
        evidence: [],
      } } }),
      authorityReader: { readTestDefinitionAuthority: async () => {
        authorityFailureObserved = true
        throw new Error('SECRET_VALUE workspace /private/forge.db')
      } } as any,
      semanticAdmissionReader: { readCanonicalTestDefinitionAdmission: async () => ({
        kind: 'refused', code: 'missing_active_model',
      }) } as any,
    },
  )
  assert.equal(authorityFailureObserved, true, 'Definition authority dependency was the controlled failure source')
  assert.equal(result.status, 503)
  const serialized = JSON.stringify(result.body)
  assert.match(serialized, /READINESS_UNAVAILABLE/)
  assert.doesNotMatch(serialized, /SECRET_VALUE|private|forge\.db/i)
})

test('CI preserves real reports after an earlier test failure without requiring fabricated files', () => {
  const workflow = source('.github/workflows/e2e-pipeline.yml')
  const uploadStart = workflow.indexOf('- name: Upload reports artifact')
  const nextJob = workflow.indexOf('  ai-pipeline:', uploadStart)
  assert.notEqual(uploadStart, -1)
  assert.notEqual(nextJob, -1)
  const upload = workflow.slice(uploadStart, nextJob)
  assert.match(upload, /uses: actions\/upload-artifact@v4/)
  assert.match(upload, /if: always\(\)/)
  assert.match(upload, /name: forge-reports/)
  assert.match(upload, /path: reports\//)
  assert.match(upload, /if-no-files-found: warn/)

  const downstream = workflow.slice(nextJob)
  assert.match(downstream, /needs: test\s+if: always\(\)/)
  assert.match(downstream, /name: Download reports artifact[\s\S]*?name: forge-reports/)
})

test('active routes use canonical projection and compatibility is explicit', () => {
  const crawl = source('forge-ui/server/routes/crawl.ts')
  const projects = source('forge-ui/server/routes/projects.ts')
  const evidence = source('forge-ui/server/context/ApplicationEvidenceInventoryController.ts')
  assert.doesNotMatch(crawl, /readLatestObservationView\(appName\)[\s\S]{0,80}\?\?\s*legacy/)
  assert.doesNotMatch(projects, /readLatestObservationView\(appName\)[\s\S]{0,80}\?\?\s*legacy/)
  assert.doesNotMatch(evidence, /readEvidenceLedger\(/)
  assert.match(crawl, /compatibility\/latest/)
  assert.match(crawl, /compatibility\/observations/)
  assert.match(projects, /compatibility\/evidence/)
})

test('presenters render canonical support and operation_id remains operation identity only', () => {
  const appModelPresenter = source('forge-ui/server/registry/ApplicationModelHistoryPresenter.ts')
  const appModelRepository = source('src/core/storage/repositories/AppModelRepository.ts')
  const observationRepository = source('src/core/storage/repositories/ObservationRepository.ts')
  assert.doesNotMatch(appModelPresenter, /ObservationStore|operation_id/)
  assert.match(appModelPresenter, /supportObservationIds/)
  assert.match(appModelRepository, /operation identity|request correlation/i)
  assert.match(observationRepository, /findRunByOperation/)
})

test('test-design and execution refuse non-canonical evidence authority', () => {
  const tests = source('forge-ui/server/context/TestInventoryController.ts')
  const execution = source('forge-ui/server/context/ExecutionLifecycleController.ts')
  assert.match(tests, /readCanonicalTestDefinitionAdmission|generateCanonicalTestSet/)
  assert.match(tests, /canGenerate: record\(admission\)\?\.kind === 'ok'/)
  assert.doesNotMatch(tests, /evidenceData|sourceObservationId/)
  assert.match(execution, /startProductExecution/)
  assert.doesNotMatch(execution, /readExecutionPreflight/)
  assert.match(execution, /engine ExecutionService performs the[\s\S]*recheck/)
  assert.doesNotMatch(execution, /projectionAuthority|supportSealHash|sourceObservationId/)
  assert.doesNotMatch(tests, /ObservationStore|operation_id/)
  assert.doesNotMatch(execution, /ObservationStore|operation_id/)
})

test('retirement roadmap preserves compatibility files pending B5', () => {
  const roadmap = source('docs/architecture/TD-ARCH-003-B4_LEGACY_OBSERVATION_RETIREMENT.md')
  assert.match(roadmap, /Stage 1/)
  assert.match(roadmap, /Stage 2/)
  assert.match(roadmap, /Stage 3/)
  assert.match(roadmap, /KEEP FOR LEGACY/)
  assert.match(roadmap, /REMOVE AFTER B5/)
  assert.match(roadmap, /REMOVE NOW/)
})
