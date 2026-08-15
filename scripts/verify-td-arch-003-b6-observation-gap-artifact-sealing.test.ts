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
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sql } from 'kysely'
import { canonicalObservationGapIntegrityHash } from '../src/core/observation/ObservationIntegrity'
import { ObservationReadProjectionService } from '../src/core/observation/ObservationReadProjectionService'
import { ObservationService } from '../src/core/observation/ObservationService'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ArtifactReferenceRecord } from '../src/core/observation/ObservationTypes'
import { closeDb, getDatabaseProvenance, getProductDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { down as migrateDown } from '../src/core/storage/migrations/028_observation_gap_artifact_sealing'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-003-b6-'))
const PROJECT = 'b6-product'
const START = '2026-08-14T20:00:00.000Z'
const END = '2026-08-14T20:00:01.000Z'
const PRODUCER = 'forge.crawler'
let service: ObservationService
let runId = ''
let sealedGapId = ''
let artifacts: ArtifactReferenceRecord[] = []

const boundary = {
  schemaVersion: 'forge-observation-boundary/v1' as const,
  kind: 'document' as const,
  scope: { acquisitionKind: 'web_crawl' },
  startedAt: START,
  endedAt: END,
  completion: 'partial' as const,
  policyId: 'forge.b6-boundary',
  policyVersion: '1',
}

async function start(operationId: string): Promise<string> {
  return (await service.startRun({
    operationId,
    producer: PRODUCER,
    producerVersion: '1',
    acquisitionKind: 'web_crawl',
    startedAt: START,
    policyId: 'forge.b6-acquisition',
    policyVersion: '1',
    acquisitionPlan: { target: 'https://example.invalid/' },
  })).value.observationRunId
}

async function artifact(content: string): Promise<ArtifactReferenceRecord> {
  return (await service.persistArtifact({
    observationRunId: runId,
    projectId: PROJECT,
    mediaType: 'application/json',
    content,
    sensitivityClass: 'internal',
    redactionState: 'not_required',
    capturedAt: END,
    retentionClass: 'standard_diagnostic',
    retentionPolicyId: 'forge.b6-retention',
    retentionPolicyVersion: '1',
  })).value
}

function gap(idempotencyKey: string, artifactIds: string[] = []) {
  return {
    observationRunId: runId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    intendedMethod: 'browser_dom_inspection',
    intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: `subject-${idempotencyKey}`,
    intendedPredicate: 'page.discovered',
    boundary,
    reason: 'not_reached' as const,
    occurredAt: END,
    idempotencyKey,
    artifactIds,
    safeMessage: 'The intended page was not reached inside the governed boundary.',
  }
}

before(async () => {
  await openProjectDatabase(createWorkspace(ROOT))
  service = new ObservationService(PROJECT, ROOT, {
    producerInstanceId: '66666666-6666-4666-8666-666666666666',
  })
  runId = await start('b6-sealing')
  artifacts = await Promise.all([artifact('{"evidence":"first"}'), artifact('{"evidence":"second"}'), artifact('{"evidence":"late"}')])
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('Migration 028 is the current restart-safe schema ceiling with Gap sealing guards', async () => {
  const history = await getProductDb().selectFrom('kysely_migration').select('name').orderBy('name').execute()
  assert.equal(history.at(-1)?.name, '028_observation_gap_artifact_sealing')
  const columns = await sql<{ name: string }>`PRAGMA table_info(observation_gaps)`.execute(getProductDb())
  assert.ok(columns.rows.some(column => column.name === 'artifact_links_sealed'))
  const triggers = await sql<{ name: string; definition: string }>`SELECT name, sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name IN ('observation_artifact_links_closed_insert', 'observation_gaps_immutable_update') ORDER BY name`.execute(getProductDb())
  assert.equal(triggers.rows.length, 2)
  const triggerDefinitions = triggers.rows.map(row => row.definition).join('\n')
  assert.match(triggerDefinitions, /ObservationGap artifact set is sealed/)
  assert.match(triggerDefinitions, /a\.observation_run_id = g\.observation_run_id/)
})

test('Migration 028 inspection refuses a trigger missing only the same-run invariant', async () => {
  const trigger = await sql<{ definition: string }>`
    SELECT sql AS definition FROM sqlite_master
    WHERE type = 'trigger' AND name = 'observation_artifact_links_closed_insert'
  `.execute(getProductDb())
  const original = trigger.rows[0]?.definition
  assert.ok(original)
  const weakened = original.replace(/\s+AND a\.observation_run_id = g\.observation_run_id/, '')
  assert.notEqual(weakened, original)
  await sql`DROP TRIGGER observation_artifact_links_closed_insert`.execute(getProductDb())
  await sql.raw(weakened).execute(getProductDb())
  await closeDb()
  await assert.rejects(
    () => openProjectDatabase(createWorkspace(ROOT)),
    /artifact membership seal or immutable-link guards are incomplete/,
  )
  await closeDb()
  const BetterSqlite3 = require('better-sqlite3')
  const direct = new BetterSqlite3(path.join(ROOT, '.forge', 'forge.db'))
  direct.exec(`DROP TRIGGER observation_artifact_links_closed_insert; ${original}`)
  direct.close()
  await openProjectDatabase(createWorkspace(ROOT))
})

test('zero-artifact and artifact-backed Gaps commit with exact sealed membership', async () => {
  const empty = await service.recordGap(gap('zero-artifacts'))
  assert.deepEqual(empty.value.artifactIds, [])
  const sealed = await service.recordGap(gap('artifact-backed', [artifacts[1].artifactId, artifacts[0].artifactId]))
  sealedGapId = sealed.value.gapId
  const expected = [artifacts[0].artifactId, artifacts[1].artifactId].sort((left, right) => left.localeCompare(right))
  assert.deepEqual(sealed.value.artifactIds, expected)
  const row = await getProductDb().selectFrom('observation_gaps').selectAll().where('gap_id', '=', sealedGapId).executeTakeFirstOrThrow()
  assert.equal(row.artifact_links_sealed, 1)
  const linked = await getProductDb().selectFrom('observation_artifact_links').select(['artifact_id', 'ordinal'])
    .where('gap_id', '=', sealedGapId).orderBy('ordinal').execute()
  assert.deepEqual(linked.map(item => item.artifact_id), expected)
})

test('artifact admission failure and duplicate membership commit no false Gap', async () => {
  const before = await getProductDb().selectFrom('observation_gaps').select('gap_id').execute()
  await assert.rejects(service.recordGap(gap('missing-artifact', ['99999999-9999-4999-8999-999999999999'])), /artifact is missing/)
  await assert.rejects(service.recordGap(gap('duplicate-artifact', [artifacts[0].artifactId, artifacts[0].artifactId])), /must be unique/)
  const after = await getProductDb().selectFrom('observation_gaps').select('gap_id').execute()
  assert.equal(after.length, before.length)
})

test('late INSERT, UPDATE, DELETE, and cross-workspace direct SQL mutations are refused', async () => {
  const db = getProductDb()
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: artifacts[2].artifactId, project_id: PROJECT, observation_id: null, gap_id: sealedGapId, ordinal: 2,
  }).execute(), /ObservationGap artifact set is sealed/)
  const first = await db.selectFrom('observation_artifact_links').selectAll().where('gap_id', '=', sealedGapId).orderBy('ordinal').executeTakeFirstOrThrow()
  await assert.rejects(db.updateTable('observation_artifact_links').set({ ordinal: 9 })
    .where('gap_id', '=', sealedGapId).where('artifact_id', '=', first.artifact_id).execute(), /linkage is immutable/)
  await assert.rejects(db.deleteFrom('observation_artifact_links').where('gap_id', '=', sealedGapId)
    .where('artifact_id', '=', first.artifact_id).execute(), /linkage is immutable/)
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: artifacts[2].artifactId, project_id: 'another-workspace', observation_id: null, gap_id: sealedGapId, ordinal: 2,
  }).execute(), /crosses project authority/)
})

test('SQLite enforces the complete Gap artifact persistence matrix and the seal survives restart', async () => {
  await service.terminalizeRun({
    observationRunId: runId, lifecycle: 'completed', completeness: 'partial', terminalAt: END,
    safeReasonCode: 'bounded_test', safeMessage: 'The B6 first run completed with partial coverage.',
  })
  runId = await start('b6-cross-run')
  await assert.rejects(service.recordGap(gap('cross-run-artifact', [artifacts[0].artifactId])), /another run/)
  const currentRunArtifacts = await Promise.all([
    artifact('{"evidence":"matrix-first"}'),
    artifact('{"evidence":"matrix-late"}'),
  ])
  const matrixGapId = '77777777-7777-4777-8777-777777777777'
  const matrixSemantic = {
    schemaVersion: 'forge-observation-gap/v1' as const,
    observationRunId: runId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    intendedMethod: 'browser_dom_inspection',
    intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'matrix-subject',
    intendedPredicate: 'page.discovered',
    boundary,
    reason: 'not_reached' as const,
    occurredAt: END,
  }
  const db = getProductDb()
  await db.insertInto('observation_gaps').values({
    gap_id: matrixGapId,
    observation_run_id: runId,
    project_id: PROJECT,
    producer: PRODUCER,
    producer_version: '1',
    intended_method: matrixSemantic.intendedMethod,
    intended_method_version: matrixSemantic.intendedMethodVersion,
    intended_subject_id: matrixSemantic.intendedSubjectId,
    intended_predicate: matrixSemantic.intendedPredicate,
    boundary_json: JSON.stringify(boundary),
    reason: matrixSemantic.reason,
    occurred_at: END,
    idempotency_key: 'matrix-gap',
    integrity_hash: canonicalObservationGapIntegrityHash(matrixSemantic, [{
      artifactId: currentRunArtifacts[0].artifactId,
      sha256: currentRunArtifacts[0].sha256,
    }]),
    safe_message: 'Direct-SQL persistence matrix Gap.',
    artifact_links_sealed: 0,
  }).execute()

  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: artifacts[0].artifactId, project_id: PROJECT, observation_id: null, gap_id: matrixGapId, ordinal: 0,
  }).execute(), /crosses ObservationRun authority/)
  assert.equal((await db.selectFrom('observation_artifact_links').select('artifact_id').where('gap_id', '=', matrixGapId).execute()).length, 0)
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: currentRunArtifacts[0].artifactId, project_id: 'another-workspace', observation_id: null, gap_id: matrixGapId, ordinal: 0,
  }).execute(), /crosses project authority/)
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: currentRunArtifacts[0].artifactId, project_id: PROJECT, observation_id: null,
    gap_id: '88888888-8888-4888-8888-888888888888', ordinal: 0,
  }).execute(), /missing Gap/)
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: '99999999-9999-4999-8999-999999999999', project_id: PROJECT,
    observation_id: null, gap_id: matrixGapId, ordinal: 0,
  }).execute(), /missing artifact/)

  await db.insertInto('observation_artifact_links').values({
    artifact_id: currentRunArtifacts[0].artifactId, project_id: PROJECT, observation_id: null, gap_id: matrixGapId, ordinal: 0,
  }).execute()
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: currentRunArtifacts[0].artifactId, project_id: PROJECT, observation_id: null, gap_id: matrixGapId, ordinal: 0,
  }).execute(), /UNIQUE constraint failed/)
  await assert.rejects(db.updateTable('observation_artifact_links').set({ ordinal: 1 })
    .where('gap_id', '=', matrixGapId).execute(), /linkage is immutable/)
  await assert.rejects(db.deleteFrom('observation_artifact_links').where('gap_id', '=', matrixGapId).execute(), /linkage is immutable/)
  await db.updateTable('observation_gaps').set({ artifact_links_sealed: 1 }).where('gap_id', '=', matrixGapId).execute()
  await assert.rejects(db.insertInto('observation_artifact_links').values({
    artifact_id: currentRunArtifacts[1].artifactId, project_id: PROJECT, observation_id: null, gap_id: matrixGapId, ordinal: 1,
  }).execute(), /ObservationGap artifact set is sealed/)
  await closeDb()
  await openProjectDatabase(createWorkspace(ROOT))
  assert.equal((await getProductDb().selectFrom('observation_gaps').select('artifact_links_sealed')
    .where('gap_id', '=', matrixGapId).executeTakeFirstOrThrow()).artifact_links_sealed, 1)
  const quickCheck = await sql<{ quick_check: string }>`PRAGMA quick_check`.execute(getProductDb())
  const foreignKeyCheck = await sql<Record<string, unknown>>`PRAGMA foreign_key_check`.execute(getProductDb())
  assert.deepEqual(quickCheck.rows.map(row => row.quick_check), ['ok'])
  assert.equal(foreignKeyCheck.rows.length, 0)
  await assert.rejects(getProductDb().insertInto('observation_artifact_links').values({
    artifact_id: artifacts[2].artifactId, project_id: PROJECT, observation_id: null, gap_id: sealedGapId, ordinal: 2,
  }).execute(), /ObservationGap artifact set is sealed/)
})

test('Gap integrity is deterministic and changes with pre-commit artifact membership', () => {
  const semantic = {
    schemaVersion: 'forge-observation-gap/v1' as const,
    observationRunId: runId,
    projectId: PROJECT,
    producer: PRODUCER,
    producerVersion: '1',
    intendedMethod: 'browser_dom_inspection',
    intendedMethodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
    intendedSubjectId: 'integrity-subject',
    intendedPredicate: 'page.discovered',
    boundary,
    reason: 'not_reached' as const,
    occurredAt: END,
  }
  const members = artifacts.slice(0, 2).sort((left, right) => left.artifactId.localeCompare(right.artifactId))
    .map(item => ({ artifactId: item.artifactId, sha256: item.sha256 }))
  assert.equal(canonicalObservationGapIntegrityHash(semantic, members), canonicalObservationGapIntegrityHash(semantic, members))
  assert.equal(canonicalObservationGapIntegrityHash(semantic, members), canonicalObservationGapIntegrityHash(semantic, [...members].reverse()))
  assert.notEqual(canonicalObservationGapIntegrityHash(semantic, []), canonicalObservationGapIntegrityHash(semantic, members))
})

test('clean committed Gaps remain readable and projection detects membership disagreement without repair', async () => {
  const clean = await new ObservationReadProjectionService().readProject(PROJECT)
  assert.ok(clean.gaps.some(item => item.gapId === sealedGapId))
  assert.equal(clean.warnings.some(item => item.code === 'gap_artifact_integrity_mismatch'), false)

  await sql`DROP TRIGGER observation_artifact_links_closed_insert`.execute(getProductDb())
  await getProductDb().insertInto('observation_artifact_links').values({
    artifact_id: artifacts[2].artifactId, project_id: PROJECT, observation_id: null, gap_id: sealedGapId, ordinal: 2,
  }).execute()
  const corrupted = await new ObservationReadProjectionService().readProject(PROJECT)
  assert.ok(corrupted.warnings.some(item => item.code === 'gap_artifact_integrity_mismatch' && item.referenceId === sealedGapId))
  assert.equal((await getProductDb().selectFrom('observation_artifact_links').selectAll().where('gap_id', '=', sealedGapId).execute()).length, 3)
})

test('Migration 028 is forward-only and schema-ahead state is refused without repair', async () => {
  await assert.rejects(
    () => runWithMigrationContext(getDatabaseProvenance(), () => migrateDown(getProductDb())),
    /intentionally irreversible/,
  )
  await getProductDb().deleteFrom('kysely_migration').where('name', '=', '028_observation_gap_artifact_sealing').execute()
  await closeDb()
  await assert.rejects(
    () => openProjectDatabase(createWorkspace(ROOT)),
    /028_observation_gap_artifact_sealing is pending.*artifact membership seal/i,
  )
})
