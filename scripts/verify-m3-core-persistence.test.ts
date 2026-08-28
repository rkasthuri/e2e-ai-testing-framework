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
import * as crypto from 'node:crypto'
import { sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { ManualTestSourceRepository } from '../src/core/storage/repositories/ManualTestSourceRepository'
import type { ManualTestSourceInputV1 } from '../src/core/test-design/ManualTestSourceContract'
import { generateCanonicalManualFlowTestSetV3 } from '../src/core/test-design/TestDefinitionContract'
import { materializeSupportedNormalizedTestIntentV1 } from '../src/core/test-design/NormalizedTestIntentContract'
import { parseManualAutomationProposalV1 } from '../src/core/test-design/ManualAutomationProposalContract'

const PROJECT = 'm3-persistence'
const HASH = 'a'.repeat(64)
const NOW = '2026-08-26T12:00:00.000Z'
const SOURCE_INPUT: ManualTestSourceInputV1 = {
  schemaVersion: 'forge-manual-test-source-input/v1', sourceKind: 'manual', title: 'Checkout from cart',
  objective: 'Proceed from cart to checkout.',
  steps: [{ ordinal: 1, text: 'Open the cart page.' }, { ordinal: 2, text: 'Click the Checkout button.' }],
  expectedOutcome: 'Checkout information page is displayed.',
}

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-persistence-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    await run()
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('Migration 033 admits immutable manual source authority idempotently by project and content hash', async () => {
  await withDatabase(async () => {
    const ids = ['manual-source-first', 'manual-source-must-not-be-used']
    const repository = new ManualTestSourceRepository(() => ids.shift()!)
    const first = await repository.admit(PROJECT, SOURCE_INPUT, NOW)
    const replay = await repository.admit(PROJECT, {
      expectedOutcome: SOURCE_INPUT.expectedOutcome, steps: SOURCE_INPUT.steps, objective: SOURCE_INPUT.objective,
      title: SOURCE_INPUT.title, sourceKind: SOURCE_INPUT.sourceKind, schemaVersion: SOURCE_INPUT.schemaVersion,
    }, '2026-08-26T12:01:00.000Z')
    assert.equal(first.sourceId, 'manual-source-first')
    assert.deepEqual(replay, first)
    assert.equal(await getDb().selectFrom('manual_test_sources').selectAll().execute().then(rows => rows.length), 1)
    await assert.rejects(getDb().updateTable('manual_test_sources').set({ admitted_at: NOW }).where('source_id', '=', first.sourceId).execute(), /immutable/i)
    await assert.rejects(getDb().deleteFrom('manual_test_sources').where('source_id', '=', first.sourceId).execute(), /immutable/i)
  })
})

test('Migration 033 promotion guard requires the exact source and schema-3 Test Set revision authority', async () => {
  await withDatabase(async () => {
    const source = await new ManualTestSourceRepository(() => 'manual-source-authority').admit(PROJECT, SOURCE_INPUT, NOW)
    const fixture = parseManualAutomationProposalV1(JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'm3-contract', 'positive-automation-proposal.json'), 'utf8',
    )), false)
    const canonical = (revision: number, suffix: string) => {
      const normalizedIntent = {
        ...structuredClone(fixture.normalizedIntent),
        projectId: PROJECT,
        intentId: `manual-intent-${suffix}`,
      }
      return generateCanonicalManualFlowTestSetV3({
        projectId: PROJECT,
        generatedAt: NOW,
        authority: {
          schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: PROJECT,
          modelRowId: 42, modelVersion: 'app-model-v7', observationRunId: '11111111-1111-4111-8111-111111111111',
          supportSealHash: 'c'.repeat(64), characterizationPolicy: { id: 'forge.policy', version: '1' },
          supportingObservationIds: ['obs-cart-route', 'obs-checkout-control', 'obs-checkout-subject'], supportingGapIds: [],
          subjectSupport: [
            { canonicalSubjectId: 'subject-cart', supportingObservationIds: ['obs-cart-route', 'obs-checkout-control'], supportingGapIds: [] },
            { canonicalSubjectId: 'subject-checkout-step-one', supportingObservationIds: ['obs-checkout-subject'], supportingGapIds: [] },
          ],
        },
        routeEvidence: {
          schemaVersion: 'forge-canonical-route-evidence/v1', projectId: PROJECT, modelRowId: 42,
          supportSealHash: 'c'.repeat(64), normalizationPolicy: { id: 'forge.route', version: '1' },
          subjects: [
            { canonicalSubjectId: 'subject-cart', normalizedPath: '/cart.html', supportingObservationIds: ['obs-cart-route'] },
            { canonicalSubjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html', supportingObservationIds: ['obs-checkout-subject'] },
          ], identityHash: 'd'.repeat(64),
        },
        authenticationExpectation: fixture.authenticationExpectation,
        normalizedIntent: materializeSupportedNormalizedTestIntentV1(normalizedIntent),
      }, `generation-${suffix}`, revision)
    }
    const insertTestSet = async (
      materialized: ReturnType<typeof canonical>,
      payloadJson = materialized.json,
      contentHash = materialized.fingerprint,
    ) => getDb().insertInto('test_set_revisions').values({
      test_set_id: materialized.value.testSetId, revision: materialized.value.revision,
      project_id: PROJECT, generation_id: materialized.value.generationId,
      schema_version: 3, source_observation_id: null, model_row_id: 42, model_version: 'app-model-v7',
      observation_run_id: '11111111-1111-4111-8111-111111111111', support_seal_hash: 'c'.repeat(64),
      characterization_policy_id: 'forge.policy', characterization_policy_version: '1',
      generated_at: NOW, outcome: 'completed', definition_count: materialized.value.definitions.length,
      payload_json: payloadJson, content_hash: contentHash,
    }).returning('id').executeTakeFirstOrThrow()
    const exact = canonical(1, 'exact')
    const inserted = await insertTestSet(exact)
    const values = {
      proposal_id: 'manual-proposal-authority', project_id: PROJECT,
      proposal_schema_version: 'forge-manual-automation-proposal/v1' as const,
      source_id: source.sourceId, source_content_hash: source.contentHash,
      proposal_payload_json: '{}', proposal_content_hash: 'b'.repeat(64), test_set_row_id: Number(inserted.id),
      test_set_id: exact.value.testSetId, test_set_revision: 1, test_set_content_hash: exact.fingerprint,
      definition_id: exact.value.definitions[0].id, promoted_at: NOW,
    }
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({ ...values, source_content_hash: 'c'.repeat(64) }).execute(), /authority mismatch|foreign key/i)
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({ ...values, test_set_revision: 2 }).execute(), /authority mismatch/i)

    await assert.rejects(getDb().insertInto('manual_test_promotions').values({
      ...values, proposal_id: 'manual-proposal-arbitrary', proposal_content_hash: 'c'.repeat(64),
      definition_id: 'definition-arbitrary',
    }).execute(), /definition membership mismatch/i)

    const currentAuthority = canonical(2, 'current')
    const current = await insertTestSet(currentAuthority)
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({
      ...values, proposal_id: 'manual-proposal-current-fallback', proposal_content_hash: 'd'.repeat(64),
      definition_id: currentAuthority.value.definitions[0].id,
    }).execute(), /definition membership mismatch/i)
    assert.ok(Number(current.id) > Number(inserted.id))

    const wrongSchemaAuthority = canonical(3, 'wrong-schema')
    const wrongSchemaPayload = JSON.stringify({ ...wrongSchemaAuthority.value, schemaVersion: 2 })
    const wrongSchemaHash = crypto.createHash('sha256').update(wrongSchemaPayload).digest('hex')
    const wrongSchema = await insertTestSet(wrongSchemaAuthority, wrongSchemaPayload, wrongSchemaHash)
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({
      ...values, proposal_id: 'manual-proposal-wrong-schema', proposal_content_hash: 'e'.repeat(64),
      test_set_row_id: Number(wrongSchema.id), test_set_id: wrongSchemaAuthority.value.testSetId, test_set_revision: 3,
      test_set_content_hash: wrongSchemaHash, definition_id: wrongSchemaAuthority.value.definitions[0].id,
    }).execute(), /definition membership mismatch/i)

    const malformedAuthority = canonical(4, 'malformed')
    const malformedValue = structuredClone(malformedAuthority.value)
    delete (malformedValue.definitions[0] as unknown as Record<string, unknown>).title
    const malformedPayload = JSON.stringify(malformedValue)
    const malformedHash = crypto.createHash('sha256').update(malformedPayload).digest('hex')
    const malformed = await insertTestSet(malformedAuthority, malformedPayload, malformedHash)
    await assert.rejects(getDb().insertInto('manual_test_promotions').values({
      ...values, proposal_id: 'manual-proposal-malformed', proposal_content_hash: 'f'.repeat(64),
      test_set_row_id: Number(malformed.id), test_set_id: malformedAuthority.value.testSetId, test_set_revision: 4,
      test_set_content_hash: malformedHash, definition_id: malformedAuthority.value.definitions[0].id,
    }).execute(), /definition membership mismatch/i)

    await getDb().insertInto('manual_test_promotions').values(values).execute()
    await assert.rejects(getDb().updateTable('manual_test_promotions').set({ promoted_at: NOW }).where('proposal_id', '=', values.proposal_id).execute(), /immutable/i)
    await assert.rejects(getDb().deleteFrom('manual_test_promotions').where('proposal_id', '=', values.proposal_id).execute(), /immutable/i)

    await assert.rejects(getDb().transaction().execute(async trx => {
      const nextAuthority = canonical(5, 'atomic-refusal')
      const next = await trx.insertInto('test_set_revisions').values({
        test_set_id: nextAuthority.value.testSetId, revision: 5, project_id: PROJECT, generation_id: nextAuthority.value.generationId,
        schema_version: 3, source_observation_id: null, model_row_id: 42, model_version: 'app-model-v7',
        observation_run_id: '11111111-1111-4111-8111-111111111111', support_seal_hash: 'c'.repeat(64),
        characterization_policy_id: 'forge.policy', characterization_policy_version: '1',
        generated_at: NOW, outcome: 'completed', definition_count: 1,
        payload_json: nextAuthority.json, content_hash: nextAuthority.fingerprint,
      }).returning('id').executeTakeFirstOrThrow()
      await trx.insertInto('manual_test_promotions').values({
        ...values, proposal_id: 'manual-proposal-atomic-refusal', proposal_content_hash: '2'.repeat(64),
        test_set_row_id: Number(next.id), test_set_id: nextAuthority.value.testSetId,
        test_set_revision: 5, test_set_content_hash: nextAuthority.fingerprint, definition_id: 'definition-not-a-member',
      }).execute()
    }), /definition membership mismatch/i)
    assert.equal(await getDb().selectFrom('test_set_revisions').select('id')
      .where('revision', '=', 5).where('project_id', '=', PROJECT).executeTakeFirst(), undefined)
  })
})

test('Migration ceiling records 033 as the latest applied authority', async () => {
  await withDatabase(async () => {
    const rows = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(getDb())
    assert.equal(rows.rows[0].name, '033_manual_test_source_promotion_authority')
  })
})

test('Migration 033 restart inspection rejects a missing or inert same-name membership guard', async () => {
  await withDatabase(async () => {
    await sql`DROP TRIGGER manual_test_promotions_definition_membership_insert`.execute(getDb())
    await assert.rejects(runMigrations(), /033_manual_test_source_promotion_authority.*trigger contract/i)
    await sql.raw(`CREATE TRIGGER manual_test_promotions_definition_membership_insert
      BEFORE INSERT ON manual_test_promotions BEGIN SELECT 1; END`).execute(getDb())
    await assert.rejects(runMigrations(), /033_manual_test_source_promotion_authority.*trigger contract/i)
  })
})
