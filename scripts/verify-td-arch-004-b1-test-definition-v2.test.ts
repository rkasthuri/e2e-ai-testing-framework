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
import * as os from 'node:os'
import * as path from 'node:path'
import { closeDb, getDatabaseProvenance, getDb, initDb } from '../src/core/storage/db'
import { runMigrations, runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { TestSetService } from '../src/core/storage/TestSetService'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { up as migrateUp, down as migrateDown } from '../src/core/storage/migrations/026_canonical_test_definition_v2'
import {
  generateEvidenceBackedTestSet,
  materializeCanonicalTestSet,
  parseCanonicalTestSet,
  TestDefinitionContractError,
  type CanonicalTestSetV2,
  type TestDesignAuthorityInput,
} from '../src/core/test-design/TestDefinitionContract'

const observationOne = '11111111-1111-4111-8111-111111111111'
const observationTwo = '22222222-2222-4222-8222-222222222222'
const gapOne = '33333333-3333-4333-8333-333333333333'
const seal = 'a'.repeat(64)

function v1Fixture(): TestDesignAuthorityInput {
  return {
    projectId: 'saucedemo',
    sourceObservation: {
      id: observationOne,
      outcome: 'completed',
      authenticationOutcome: 'not_required',
      authenticationExpectation: 'none',
      credentialReference: null,
      subjectIds: ['inventory-html'],
    },
    model: {
      rowId: 7,
      version: '1.0.0',
      sourceObservationId: observationOne,
      validation: 'valid',
      integrity: 'verified',
      subjects: [{ id: 'inventory-html', routePath: '/inventory.html', evidenceId: observationOne }],
    },
    evidence: [{
      id: observationOne,
      canonicalSubjectId: 'inventory-html',
      routePath: '/inventory.html',
      sourceObservationId: observationOne,
      sourceModelRows: [7],
      support: 'current',
      integrity: 'verified',
      freshness: 'not_evaluated',
      access: 'available',
      conflict: 'not_evaluated',
    }],
    generatedAt: '2026-08-12T12:00:00.000Z',
  }
}

function v2Fixture(): CanonicalTestSetV2 {
  return {
    schemaVersion: 2,
    testSetId: 'test-set-saucedemo',
    revision: 2,
    projectId: 'saucedemo',
    generationId: 'generation-v2',
    generatedAt: '2026-08-12T12:01:00.000Z',
    generationMethod: 'deterministic',
    outcome: 'partially_completed',
    canonicalSupport: {
      modelRowId: 8,
      modelVersion: '1.0.1',
      observationRunId: '44444444-4444-4444-8444-444444444444',
      supportSealHash: seal,
      characterizationPolicy: { id: 'forge.crawl-characterization', version: '1' },
      supportingObservationIds: [observationOne, observationTwo],
      supportingGapIds: [gapOne],
    },
    definitions: [{
      id: 'definition-inventory',
      title: 'Inventory definition foundation',
      intent: 'Retain exact sealed subject provenance without route or authentication claims.',
      canonicalSubjects: ['inventory-html'],
      provenance: {
        modelRowId: 8,
        modelVersion: '1.0.1',
        supportSealHash: seal,
        subjectSupport: [{
          canonicalSubjectId: 'inventory-html',
          supportingObservationIds: [observationOne, observationTwo],
          supportingGapIds: [gapOne],
        }],
      },
      generationMethod: 'deterministic',
      validation: { state: 'valid', explanation: 'The definition references an exact sealed subject-support subset.' },
      confidenceLimitations: ['Route and authentication evidence are outside B1.'],
      materialUnknowns: ['Executable navigation is not established.'],
      unobservedScope: ['Behavior outside the sealed support remains unknown.'],
      preventedStrongerDefinition: 'B1 establishes provenance persistence only.',
    }],
    limitations: ['No route or authentication projection was performed.'],
    materialUnknowns: ['Execution compatibility is not evaluated.'],
    unobservedScope: ['Unsealed application behavior remains unknown.'],
    preventedStrongerSet: 'The v2 persistence foundation does not perform definition admission.',
    coverage: 'unknown',
    freshness: 'not_evaluated',
  }
}

test('explicit parsing preserves v1 and accepts v2 without upgrading either version', () => {
  const v1 = generateEvidenceBackedTestSet(v1Fixture(), 'generation-v1', 1)
  const parsedV1 = parseCanonicalTestSet(v1.json)
  assert.equal(parsedV1.value.schemaVersion, 1)
  assert.equal(parsedV1.json, v1.json)
  assert.equal(parsedV1.fingerprint, v1.fingerprint)
  assert.deepEqual(JSON.parse(parsedV1.json), JSON.parse(v1.json))

  const v2 = materializeCanonicalTestSet(v2Fixture())
  assert.equal(parseCanonicalTestSet(v2.json).value.schemaVersion, 2)
  assert.doesNotMatch(v2.json, /sourceObservationId/)
})

test('v2 support identity is strict, canonical, unique, sealed, and unknown-field closed', () => {
  const cases: Array<(value: any) => void> = [
    value => { value.sourceObservationId = observationOne },
    value => { value.canonicalSupport.supportingObservationIds = [observationOne, observationOne] },
    value => { value.canonicalSupport.supportingObservationIds = [observationTwo, observationOne] },
    value => { value.canonicalSupport.supportingGapIds = [gapOne, gapOne] },
    value => { value.canonicalSupport.supportSealHash = 'not-a-seal' },
    value => { value.canonicalSupport.unexpected = true },
    value => { value.definitions[0].provenance.subjectSupport[0].supportingObservationIds = ['foreign-observation'] },
    value => { value.definitions[0].provenance.subjectSupport[0].unexpected = true },
  ]
  for (const mutate of cases) {
    const value = structuredClone(v2Fixture()) as any
    mutate(value)
    assert.throws(() => materializeCanonicalTestSet(value), TestDefinitionContractError)
  }
})

test('Migration 026 preserves v1 payload bytes, rolls back without v2 rows, and reapplies', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-004-b1-rollback-'))
  initDb(path.join(root, 'forge.db'))
  try {
    const migrationsDirectory = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
    const through026 = Object.fromEntries(fs.readdirSync(migrationsDirectory)
      .filter(file => /^\d+_.*\.ts$/.test(file) && file <= '026_canonical_test_definition_v2.ts')
      .sort()
      .map(file => [file.replace(/\.ts$/, ''), require(path.join(migrationsDirectory, file))]))
    await runSqliteMigrationCoordinator(getDb(), through026)
    const materialized = generateEvidenceBackedTestSet(v1Fixture(), 'generation-v1', 1)
    await getDb().insertInto('test_set_revisions').values({
      test_set_id: materialized.value.testSetId, revision: materialized.value.revision,
      project_id: materialized.value.projectId, generation_id: materialized.value.generationId,
      schema_version: 1, source_observation_id: materialized.value.sourceObservationId,
      model_row_id: materialized.value.modelRowId, model_version: materialized.value.modelVersion,
      observation_run_id: null, support_seal_hash: null,
      characterization_policy_id: null, characterization_policy_version: null,
      generated_at: materialized.value.generatedAt, outcome: materialized.value.outcome,
      definition_count: materialized.value.definitions.length, payload_json: materialized.json,
      content_hash: materialized.fingerprint,
    }).execute()
    const before = await getDb().selectFrom('test_set_revisions').select(['payload_json', 'content_hash']).executeTakeFirstOrThrow()
    const authority = getDatabaseProvenance()
    await runWithMigrationContext(authority, () => migrateDown(getDb()))
    const rolledBack = await getDb().selectFrom('test_set_revisions').select(['payload_json', 'content_hash']).executeTakeFirstOrThrow()
    assert.deepEqual(rolledBack, before)
    await runWithMigrationContext(authority, () => migrateUp(getDb()))
    const reapplied = await getDb().selectFrom('test_set_revisions').selectAll().executeTakeFirstOrThrow()
    assert.equal(reapplied.schema_version, 1)
    assert.equal(reapplied.payload_json, before.payload_json)
    assert.equal(reapplied.content_hash, before.content_hash)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('v1 and v2 revisions coexist, mirror exact authority columns, and remain immutable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-004-b1-coexist-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    await runMigrations()
    const service = new TestSetService(new TestSetRepository(), () => '2026-08-12T12:00:00.000Z')
    await service.generate(v1Fixture(), 'generation-v1')
    const v2 = materializeCanonicalTestSet(v2Fixture())
    await getDb().insertInto('test_set_revisions').values({
      test_set_id: v2.value.testSetId,
      revision: v2.value.revision,
      project_id: v2.value.projectId,
      generation_id: v2.value.generationId,
      schema_version: 2,
      source_observation_id: null,
      model_row_id: v2.value.canonicalSupport.modelRowId,
      model_version: v2.value.canonicalSupport.modelVersion,
      observation_run_id: v2.value.canonicalSupport.observationRunId,
      support_seal_hash: v2.value.canonicalSupport.supportSealHash,
      characterization_policy_id: v2.value.canonicalSupport.characterizationPolicy.id,
      characterization_policy_version: v2.value.canonicalSupport.characterizationPolicy.version,
      generated_at: v2.value.generatedAt,
      outcome: v2.value.outcome,
      definition_count: v2.value.definitions.length,
      payload_json: v2.json,
      content_hash: v2.fingerprint,
    }).execute()
    for (const event of ['started', 'terminal'] as const) {
      await getDb().insertInto('test_generation_events').values({
        generation_id: v2.value.generationId,
        project_id: v2.value.projectId,
        event_type: event,
        outcome: event === 'terminal' ? v2.value.outcome : null,
        occurred_at: v2.value.generatedAt,
        process_instance_id: 'b1-test-process',
        test_set_row_id: event === 'terminal' ? 2 : null,
        safe_code: null,
        safe_message: event === 'terminal' ? 'V2 foundation persisted.' : 'V2 foundation persistence started.',
      }).execute()
    }
    const inventory = await new TestSetRepository().readInventory('saucedemo')
    assert.ok(!('kind' in inventory)); if ('kind' in inventory) throw new Error('unexpected cursor result')
    assert.equal(inventory.total, 2)
    assert.equal(inventory.current?.testSet.schemaVersion, 2)
    assert.equal(inventory.history[0].sourceObservationId, null)
    assert.equal(inventory.history[0].supportSealHash, seal)
    assert.equal(inventory.history[1].schemaVersion, 1)
    assert.equal(inventory.history[1].sourceObservationId, observationOne)
    await assert.rejects(() => getDb().updateTable('test_set_revisions').set({ outcome: 'failed' }).where('revision', '=', 2).execute(), /immutable/i)
    await assert.rejects(() => getDb().deleteFrom('test_set_revisions').where('revision', '=', 2).execute(), /immutable/i)
    await assert.rejects(
      () => runWithMigrationContext(getDatabaseProvenance(), () => migrateDown(getDb())),
      /cannot roll back while v2 Test Set revisions exist/i,
    )
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
