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
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import { closeDb, getProductDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import {
  historicalObservationImportIntegrityHash,
  ObservationImportService,
  type HistoricalObservationImportPackage,
} from '../src/core/observation/ObservationImportService'
import { ObservationReadProjectionService } from '../src/core/observation/ObservationReadProjectionService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS } from '../src/core/observation/ObservationTypes'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-003-b3-'))
const PROJECT = 'b3-product'
const IMPORT_ROOT = path.join(ROOT, '.forge', 'observation-import')
const START = '2026-08-12T15:00:00.000Z'
const END = '2026-08-12T15:00:01.000Z'

function digest(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function candidate(
  observationId: string,
  runId: string,
  provenance: 'clean_direct' | 'reconstructed' | 'ambiguous' = 'clean_direct',
): HistoricalObservationImportPackage {
  const pkg: HistoricalObservationImportPackage = {
    schemaVersion: 'forge-observation-import/v1',
    projectId: PROJECT,
    sourceSchema: 'historical-crawler:v1',
    originalId: observationId,
    captureTimestamp: END,
    producerIdentity: 'historical.crawler',
    legacyProvenanceClass: provenance,
    run: {
      observationRunId: runId,
      acquisitionKind: 'web_crawl',
      startedAt: START,
      terminalAt: END,
      lifecycle: 'completed',
      completeness: 'complete',
      safeReasonCode: null,
      policyId: 'forge.historical-crawl',
      policyVersion: '1',
      acquisitionPlanHash: 'a'.repeat(64),
    },
    observation: {
      observationId,
      method: 'browser_dom_inspection',
      methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
      subjectId: 'inventory-page',
      predicate: 'page.discovered',
      outcome: 'present',
      observedValue: { urlPattern: '/inventory.html', elementCount: 2, fingerprint: 'd'.repeat(64) },
      boundary: {
        schemaVersion: 'forge-observation-boundary/v1',
        kind: 'document',
        scope: { acquisitionKind: 'web_crawl' },
        startedAt: START,
        endedAt: END,
        completion: 'complete',
        policyId: 'forge.historical-boundary',
        policyVersion: '1',
      },
      capturedAt: END,
      integrityHash: '',
      safeReasonCode: null,
      safeMessage: null,
    },
    artifacts: [],
  }
  pkg.observation.integrityHash = historicalObservationImportIntegrityHash(pkg)
  return pkg
}

function writePackage(name: string, pkg: HistoricalObservationImportPackage, sidecar: 'valid' | 'missing' | 'wrong' = 'valid'): void {
  fs.mkdirSync(IMPORT_ROOT, { recursive: true })
  const file = path.join(IMPORT_ROOT, `${name}.json`)
  const bytes = JSON.stringify(pkg, null, 2)
  fs.writeFileSync(file, bytes)
  if (sidecar !== 'missing') fs.writeFileSync(`${file}.sha256`, sidecar === 'valid' ? digest(bytes) : 'f'.repeat(64))
}

before(async () => {
  await openProjectDatabase(createWorkspace(ROOT))
  fs.mkdirSync(path.join(ROOT, '.forge'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, '.forge', 'bootstrap-evidence.json'), JSON.stringify({ appName: PROJECT, evidence: [] }))
  fs.writeFileSync(path.join(ROOT, '.forge', 'agent-memory.json'), JSON.stringify({ appId: PROJECT, goals: [] }))
  const legacyObservationRoot = path.join(ROOT, '.forge', 'observations', '77777777-7777-4777-8777-777777777777')
  fs.mkdirSync(legacyObservationRoot, { recursive: true })
  fs.writeFileSync(path.join(legacyObservationRoot, 'started.json'), JSON.stringify({ schemaVersion: 1 }))
  fs.writeFileSync(path.join(legacyObservationRoot, 'terminal.json'), JSON.stringify({
    schemaVersion: 1,
    observationId: '77777777-7777-4777-8777-777777777777',
    completedAt: END,
    sourceKind: 'crawl-engine',
    evidence: [{ id: 'composite-page-1', integrity: 'unknown' }],
  }))
  await sql`INSERT INTO app_models (
    app_name, version, base_url, app_type, intake_mode, crawl_config_hash,
    page_count, flow_count, role_count, model_json, crawled_at, crawled_by,
    status, evidence_state, operation_id, candidate_hash
  ) VALUES (
    ${PROJECT}, 'legacy', 'https://example.invalid', 'web-ui', 'crawl', '',
    0, 0, 0, '{}', ${END}, 'legacy', 'superseded', 'crawled-empty', 'operation-only', ${'b'.repeat(64)}
  )`.execute(getProductDb())
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('dry run classifies all historical classes without writes', async () => {
  writePackage('clean', candidate(
    '11111111-1111-4111-8111-111111111111',
    '21111111-1111-4111-8111-111111111111',
  ))
  writePackage('migratable', candidate(
    '12222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222',
    'reconstructed',
  ))
  const missingId = candidate('13333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333333')
  missingId.originalId = null
  writePackage('missing-id', missingId)
  writePackage('missing-hash', candidate('14444444-4444-4444-8444-444444444444', '24444444-4444-4444-8444-444444444444'), 'missing')
  const mismatch = candidate('15555555-5555-4555-8555-555555555555', '25555555-5555-4555-8555-555555555555')
  mismatch.projectId = 'foreign-product'
  mismatch.observation.integrityHash = historicalObservationImportIntegrityHash(mismatch)
  writePackage('workspace-mismatch', mismatch)
  const artifactMismatch = candidate('16666666-6666-4666-8666-666666666666', '26666666-6666-4666-8666-666666666666')
  artifactMismatch.artifacts = [{
    artifactId: '36666666-6666-4666-8666-666666666666', sourcePath: 'reports/missing.html',
    sha256: 'c'.repeat(64), mediaType: 'text/html', byteSize: 1,
  }]
  writePackage('artifact-mismatch', artifactMismatch)

  const before = await getProductDb().selectFrom('observation_import_sources').selectAll().execute()
  const report = await new ObservationImportService(PROJECT, ROOT).dryRun()
  const after = await getProductDb().selectFrom('observation_import_sources').selectAll().execute()
  assert.deepEqual(after, before)
  assert.equal(report.mode, 'dry_run')
  assert.equal(report.eligible, 2)
  assert.ok(report.items.some(item => item.reasonCode === 'original_identity_missing_or_invalid'))
  assert.ok(report.items.some(item => item.reasonCode === 'content_hash_missing'))
  assert.ok(report.items.some(item => item.reasonCode === 'workspace_mismatch'))
  assert.ok(report.items.some(item => item.reasonCode === 'artifact_hash_or_workspace_mismatch'))
  assert.ok(report.items.some(item => item.sourceKind === 'bootstrap_evidence' && item.classification === 'compatibility_only'))
  assert.ok(report.items.some(item => item.sourceKind === 'agent_memory' && item.classification === 'compatibility_only'))
  assert.ok(report.items.some(item => item.sourceKind === 'observation_file'
    && item.originalId === '77777777-7777-4777-8777-777777777777'
    && item.reasonCode === 'legacy_fact_identity_or_method_proof_unavailable'
    && item.producerIdentityState === 'unavailable'))
  assert.ok(report.items.some(item => item.sourceKind === 'legacy_app_model_support'
    && item.reasonCode === 'operation_id_is_not_exact_observation_provenance'))
  assert.ok(report.items.some(item => item.sourceKind === 'legacy_evidence_ledger'
    && item.sourcePathState === 'unavailable' && item.producerIdentityState === 'unavailable'))
})

test('transactional import preserves identity, quarantines uncertainty, and never fabricates support or artifacts', async () => {
  const report = await new ObservationImportService(PROJECT, ROOT).import()
  assert.equal(report.imported, 2)
  const observations = await getProductDb().selectFrom('observations').selectAll()
    .where('project_id', '=', PROJECT).execute()
  assert.equal(observations.length, 2)
  assert.deepEqual(observations.map(row => row.provenance_class).sort(), ['legacy_direct', 'legacy_reconstructed'])
  assert.deepEqual(observations.map(row => row.observation_id).sort(), [
    '11111111-1111-4111-8111-111111111111',
    '12222222-2222-4222-8222-222222222222',
  ])
  assert.equal(await getProductDb().selectFrom('observation_artifacts').selectAll().execute().then(rows => rows.length), 0)
  assert.equal(await getProductDb().selectFrom('app_model_observation_support').selectAll().execute().then(rows => rows.length), 0)
  assert.equal(await getProductDb().selectFrom('app_model_subject_support').selectAll().execute().then(rows => rows.length), 0)
  const ledger = await getProductDb().selectFrom('observation_import_sources').selectAll().execute()
  assert.equal(ledger.length, report.recordsScanned)
  assert.ok(ledger.some(row => row.classification === 'ambiguous'))
  assert.ok(ledger.some(row => row.classification === 'compatibility_only'))
  assert.ok(ledger.some(row => row.classification === 'unsupported'))
})

test('same-source replay is idempotent and semantic source drift is refused', async () => {
  const replay = await new ObservationImportService(PROJECT, ROOT).import()
  assert.equal(replay.imported, 0)
  assert.equal(replay.replayed, replay.recordsScanned)
  assert.equal(await getProductDb().selectFrom('observations').selectAll().execute().then(rows => rows.length), 2)

  const changed = candidate('11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111')
  ;(changed.observation.observedValue as { fingerprint: string }).fingerprint = 'e'.repeat(64)
  changed.observation.integrityHash = historicalObservationImportIntegrityHash(changed)
  writePackage('conflicting-source', changed)
  await assert.rejects(new ObservationImportService(PROJECT, ROOT).import(), /replay .*conflicts/i)
  assert.equal(await getProductDb().selectFrom('observation_import_sources').selectAll().execute().then(rows => rows.length), replay.recordsScanned)
})

test('projection distinguishes imported canonical provenance from quarantined compatibility metadata', async () => {
  const projection = await new ObservationReadProjectionService().readProject(PROJECT)
  assert.ok(projection.observations.some(item => item.provenanceClass === 'legacy_direct'))
  assert.ok(projection.observations.some(item => item.provenanceClass === 'legacy_reconstructed'))
  assert.ok(projection.historicalImports.some(item => item.legacyProvenanceClass === 'bootstrap_projection'))
  assert.ok(projection.historicalImports.some(item => item.legacyProvenanceClass === 'agent_memory'))
  assert.ok(projection.historicalImports.some(item => item.classification === 'ambiguous'))
  assert.equal(projection.historicalImports.some(item => Object.hasOwn(item, 'sourcePath')), false)
})

test('import ledger and imported semantic rows are immutable', async () => {
  await assert.rejects(getProductDb().updateTable('observation_import_sources')
    .set({ reason_code: 'rewritten' }).where('project_id', '=', PROJECT).execute(), /immutable/i)
  await assert.rejects(getProductDb().updateTable('observations')
    .set({ subject_id: 'rewritten' }).where('project_id', '=', PROJECT).execute(), /immutable/i)
})
