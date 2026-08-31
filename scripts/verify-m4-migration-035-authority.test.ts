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
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Kysely, SqliteDialect, sql } from 'kysely'
import { NodeWasmDialect } from 'kysely-wasm'
import { Database as WasmDatabase } from 'node-sqlite3-wasm'
import { routeEvidenceIdentity } from '../src/core/execution/ExecutionProjectionService'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { up as migrate035 } from '../src/core/storage/migrations/035_suite_v2_multi_source_execution_authority'
import { suiteHash, type CanonicalSuiteRevision } from '../src/core/suites/SuiteContract'
import {
  generateCanonicalFlowTestSetV3,
  materializeCanonicalTestSet,
  type CanonicalTestSetV2,
  type CanonicalTestSetV3,
} from '../src/core/test-design/TestDefinitionContract'
import { normalizeDiscoveredIntentV1 } from '../src/core/test-design/NormalizedTestIntentContract'

const PROJECT = 'migration-035-project'
const NOW = '2026-08-30T12:00:00.000Z'
const HASH = 'a'.repeat(64)
const PLAN_HASH = 'b'.repeat(64)

type Backend = 'native' | 'wasm'

function v2Fixture() {
  const definition = (id: string, subject: string) => ({
    id, title: id, intent: `Navigate to ${subject}.`, canonicalSubjects: [subject],
    provenance: { modelRowId: 11, modelVersion: 'model-v2', supportSealHash: HASH,
      subjectSupport: [{ canonicalSubjectId: subject, supportingObservationIds: [`obs-${subject}`], supportingGapIds: [] }] },
    generationMethod: 'deterministic' as const,
    validation: { state: 'valid' as const, explanation: 'Valid fixture.' },
    confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: 'Bounded fixture.',
  })
  const value: CanonicalTestSetV2 = {
    schemaVersion: 2, testSetId: 'test-set-v2', revision: 1, projectId: PROJECT, generationId: 'generation-v2',
    generatedAt: NOW, generationMethod: 'deterministic', outcome: 'completed',
    canonicalSupport: { modelRowId: 11, modelVersion: 'model-v2', observationRunId: 'observation-v2',
      supportSealHash: HASH, characterizationPolicy: { id: 'fixture-policy', version: '1' },
      supportingObservationIds: ['obs-subject-a', 'obs-subject-b'], supportingGapIds: [] },
    definitions: [definition('definition-v2-a', 'subject-a'), definition('definition-v2-b', 'subject-b')],
    limitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerSet: 'Bounded fixture.',
    coverage: 'unknown', freshness: 'not_evaluated',
  }
  return materializeCanonicalTestSet(value)
}

function v3Fixture() {
  const authority = { schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2',
    projectId: PROJECT, modelRowId: 22, modelVersion: 'model-v3', observationRunId: 'observation-v3',
    supportSealHash: HASH, characterizationPolicy: { id: 'fixture-policy', version: '1' },
    supportingObservationIds: ['obs-cart', 'obs-checkout'], supportingGapIds: [], subjectSupport: [
      { canonicalSubjectId: 'cart', supportingObservationIds: ['obs-cart'], supportingGapIds: [] },
      { canonicalSubjectId: 'checkout', supportingObservationIds: ['obs-checkout'], supportingGapIds: [] },
    ] } as any
  const routeEvidence = { schemaVersion: 'forge-canonical-route-evidence/v1', projectId: PROJECT, modelRowId: 22,
    supportSealHash: HASH, normalizationPolicy: { id: 'route-policy', version: '1' }, subjects: [
      { canonicalSubjectId: 'cart', normalizedPath: '/cart', supportingObservationIds: ['obs-cart'] },
      { canonicalSubjectId: 'checkout', normalizedPath: '/checkout', supportingObservationIds: ['obs-checkout'] },
    ], identityHash: 'd'.repeat(64) } as any
  const authenticationExpectation = { schemaVersion: 'forge-authentication-expectation/v1', state: 'not_required',
    mechanism: null, bases: [{ kind: 'declared_configuration', policyId: 'auth-policy', policyVersion: '1',
      configurationDigest: 'e'.repeat(64), mechanism: null }], identityHash: 'f'.repeat(64) } as any
  const model = { schemaVersion: '2.0', generatedAt: NOW, generatedBy: 'engine', classificationRunId: 'classification-v3',
    app: { name: PROJECT, displayName: 'Fixture', baseUrl: 'https://example.invalid', appType: 'web-ui',
      modelVersion: 'model-v3', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null },
    roles: [{ id: 'user', displayName: 'User', authFlow: 'none', credentialsEnvKey: null, storageStatePath: null,
      reachablePageIds: ['cart', 'checkout'], restrictedPageIds: [], authOutcome: 'not_required' }],
    pages: [{ id: 'cart', displayName: 'Cart', urlPattern: '/cart', urlPatternType: 'exact', fingerprint: 'cart',
      fingerprintBasis: 'url-only', appType: 'web-ui', accessibleByRoles: ['user'], isAuthPage: false,
      module: { name: 'Cart', confidence: 'medium', method: 'rule', evidenceIds: ['cart'], source: 'evidence-matched', reason: 'fixture' },
      elements: [{ id: 'checkout-control', name: 'Checkout', kind: 'button', label: 'Checkout', critical: true,
        aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }], tier3Assertions: [],
        cardinality: { kind: 'single' }, observedState: 'visible', href: null }] },
    { id: 'checkout', displayName: 'Checkout', urlPattern: '/checkout', urlPatternType: 'exact', fingerprint: 'checkout',
      fingerprintBasis: 'url-only', appType: 'web-ui', accessibleByRoles: ['user'], isAuthPage: false,
      module: { name: 'Checkout', confidence: 'medium', method: 'rule', evidenceIds: ['checkout'], source: 'evidence-matched', reason: 'fixture' }, elements: [] }],
    flows: [{ id: 'checkout-flow', displayName: 'Checkout', confidence: 'partial', source: 'agent-proposed', roleId: 'user',
      steps: [{ stepIndex: 1, pageId: 'cart', action: 'click', elementId: 'checkout-control', targetPageId: 'checkout',
        value: null, grounding: 'observed' }], linkedApiEndpointIds: [], groundingWarnings: [] }],
    endpoints: null, api: null, diff: null } as any
  const normalized = normalizeDiscoveredIntentV1({ projectId: PROJECT, model, authority, routeEvidence,
    authenticationExpectation, selection: { flowId: 'checkout-flow', selectedFlowStepIndexes: [1] } })
  if (normalized.kind !== 'supported') throw new Error('Migration 035 v3 fixture must be supported.')
  return generateCanonicalFlowTestSetV3({ projectId: PROJECT, generatedAt: NOW, authority, routeEvidence,
    authenticationExpectation, normalizedIntent: normalized.materialized }, 'generation-v3', 2)
}

function openDb(backend: Backend, dbPath: string): Kysely<any> {
  if (backend === 'native') {
    const BetterSqlite3 = require('better-sqlite3')
    return new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(dbPath) }) })
  }
  return new Kysely({ dialect: new NodeWasmDialect({ database: new WasmDatabase(dbPath) }) } as any)
}

async function createPre035Schema(db: Kysely<any>): Promise<void> {
  const statements = [
    `CREATE TABLE test_set_revisions (id integer PRIMARY KEY AUTOINCREMENT,test_set_id text NOT NULL,revision integer NOT NULL,project_id text NOT NULL,generation_id text NOT NULL UNIQUE,schema_version integer NOT NULL,source_observation_id text,model_row_id integer NOT NULL,model_version text NOT NULL,observation_run_id text,support_seal_hash text,characterization_policy_id text,characterization_policy_version text,generated_at text NOT NULL,outcome text NOT NULL,definition_count integer NOT NULL,payload_json text NOT NULL,content_hash text NOT NULL,UNIQUE(project_id,revision))`,
    `CREATE TABLE suites (suite_id text PRIMARY KEY,project_id text NOT NULL,current_revision integer NOT NULL,name_key text NOT NULL,created_at text NOT NULL,UNIQUE(suite_id,project_id))`,
    `CREATE TABLE suite_revisions (suite_id text NOT NULL,revision integer NOT NULL,project_id text NOT NULL,name text NOT NULL,name_key text NOT NULL,purpose text NOT NULL,definition_schema_version integer NOT NULL,test_set_row_id integer NOT NULL,test_set_id text NOT NULL,test_set_revision integer NOT NULL,test_set_content_hash text NOT NULL,created_at text NOT NULL,provenance_source text NOT NULL,change_kind text NOT NULL,prior_revision integer,change_intent_key text NOT NULL,change_intent_fingerprint text NOT NULL,member_count integer NOT NULL,content_hash text NOT NULL,PRIMARY KEY(suite_id,revision),UNIQUE(project_id,change_intent_key),FOREIGN KEY(suite_id,project_id) REFERENCES suites(suite_id,project_id),FOREIGN KEY(test_set_row_id) REFERENCES test_set_revisions(id))`,
    `CREATE TABLE suite_revision_members (suite_id text NOT NULL,suite_revision integer NOT NULL,member_ordinal integer NOT NULL,definition_id text NOT NULL,PRIMARY KEY(suite_id,suite_revision,member_ordinal),FOREIGN KEY(suite_id,suite_revision) REFERENCES suite_revisions(suite_id,revision))`,
    `CREATE TABLE executions (execution_id text PRIMARY KEY,project_id text NOT NULL,accepted_at text NOT NULL,test_set_id text NOT NULL,test_set_revision integer NOT NULL,definition_schema_version integer NOT NULL,model_row_id integer NOT NULL,model_version text NOT NULL,source_observation_id text,support_seal_hash text,route_evidence_identity_hash text,authentication_expectation_identity_hash text,manifest_hash text NOT NULL,max_run_attempts integer NOT NULL,dispatch_mode text NOT NULL,stop_rule text NOT NULL,execution_intent_key text,execution_intent_fingerprint text,suite_id text,suite_revision integer,suite_content_hash text)`,
    `CREATE TABLE execution_items (execution_id text NOT NULL,item_ordinal integer NOT NULL,definition_id text NOT NULL,executable_plan_hash text NOT NULL,oracle_kind text,oracle_subject_id text,PRIMARY KEY(execution_id,item_ordinal))`,
    `CREATE TABLE execution_events (id integer PRIMARY KEY AUTOINCREMENT,execution_id text NOT NULL,project_id text NOT NULL,event_type text NOT NULL,outcome text,occurred_at text NOT NULL,process_instance_id text NOT NULL,safe_code text,safe_message text NOT NULL,execution_plan_hash text NOT NULL,lifecycle text)`,
  ]
  for (const statement of statements) await sql.raw(statement).execute(db)
}

async function seedValid(db: Kysely<any>): Promise<void> {
  const v2 = v2Fixture()
  const v3 = v3Fixture()
  const insertSet = async (set: typeof v2, modelRowId: number, modelVersion: string) => {
    const value = set.value as CanonicalTestSetV2 | CanonicalTestSetV3
    return db.insertInto('test_set_revisions').values({ test_set_id: value.testSetId, revision: value.revision,
      project_id: value.projectId, generation_id: value.generationId, schema_version: value.schemaVersion,
      source_observation_id: null, model_row_id: modelRowId, model_version: modelVersion,
      observation_run_id: value.canonicalSupport.observationRunId, support_seal_hash: value.canonicalSupport.supportSealHash,
      characterization_policy_id: value.canonicalSupport.characterizationPolicy.id,
      characterization_policy_version: value.canonicalSupport.characterizationPolicy.version,
      generated_at: value.generatedAt, outcome: value.outcome, definition_count: value.definitions.length,
      payload_json: set.json, content_hash: set.fingerprint }).returning('id').executeTakeFirstOrThrow()
  }
  const v2Row = await insertSet(v2, 11, 'model-v2')
  const v3Row = await insertSet(v3, 22, 'model-v3')
  const insertSuite = async (suiteId: string, name: string, set: typeof v2, rowId: number, definitionIds: string[]) => {
    const value = set.value as CanonicalTestSetV2 | CanonicalTestSetV3
    const members = definitionIds.map((definitionId, index) => ({ ordinal: index + 1, definitionAuthority: {
      definitionId, definitionSchemaVersion: value.schemaVersion as 2 | 3, testSetId: value.testSetId,
      testSetRevision: value.revision, testSetContentHash: set.fingerprint } }))
    const base: Omit<CanonicalSuiteRevision, 'contentHash'> = { schemaVersion: 1, suiteId, projectId: PROJECT,
      revision: 1, name, purpose: 'sanity', members, createdAt: NOW, provenance: { source: 'product_api',
        changeKind: 'created', priorRevision: null, changeIntentKey: `${suiteId}-intent`,
        changeIntentFingerprint: '1'.repeat(64) } }
    const contentHash = suiteHash(base)
    await db.insertInto('suites').values({ suite_id: suiteId, project_id: PROJECT, current_revision: 1,
      name_key: name.toLowerCase(), created_at: NOW }).execute()
    await db.insertInto('suite_revisions').values({ suite_id: suiteId, revision: 1, project_id: PROJECT, name,
      name_key: name.toLowerCase(), purpose: 'sanity', definition_schema_version: value.schemaVersion,
      test_set_row_id: rowId, test_set_id: value.testSetId, test_set_revision: value.revision,
      test_set_content_hash: set.fingerprint, created_at: NOW, provenance_source: 'product_api', change_kind: 'created',
      prior_revision: null, change_intent_key: `${suiteId}-intent`, change_intent_fingerprint: '1'.repeat(64),
      member_count: members.length, content_hash: contentHash }).execute()
    await db.insertInto('suite_revision_members').values(members.map(member => ({ suite_id: suiteId,
      suite_revision: 1, member_ordinal: member.ordinal, definition_id: member.definitionAuthority.definitionId }))).execute()
    return contentHash
  }
  await insertSuite('suite-v2', 'Suite v2 history', v2, Number(v2Row.id),
    (v2.value as CanonicalTestSetV2).definitions.map(definition => definition.id))
  const v3Definition = (v3.value as CanonicalTestSetV3).definitions[0]
  const suiteV3Hash = await insertSuite('suite-v3', 'Suite v3 history', v3, Number(v3Row.id), [v3Definition.id])
  const routeHash = routeEvidenceIdentity(v3Definition)!
  const authHash = createHash('sha256').update(JSON.stringify({ schemaVersion: 'forge-authentication-expectation/v1',
    state: v3Definition.authenticationExpectation.state, mechanism: v3Definition.authenticationExpectation.mechanism,
    bases: v3Definition.authenticationExpectation.bases })).digest('hex')
  const insertExecution = async (executionId: string, suite: boolean) => {
    await db.insertInto('executions').values({ execution_id: executionId, project_id: PROJECT, accepted_at: NOW,
      test_set_id: v3.value.testSetId, test_set_revision: v3.value.revision, definition_schema_version: 3,
      model_row_id: 22, model_version: 'model-v3', source_observation_id: null, support_seal_hash: HASH,
      route_evidence_identity_hash: routeHash, authentication_expectation_identity_hash: authHash,
      manifest_hash: PLAN_HASH, max_run_attempts: 1, dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
      execution_intent_key: `${executionId}-intent`, execution_intent_fingerprint: '2'.repeat(64),
      suite_id: suite ? 'suite-v3' : null, suite_revision: suite ? 1 : null, suite_content_hash: suite ? suiteV3Hash : null }).execute()
    await db.insertInto('execution_items').values({ execution_id: executionId, item_ordinal: 1,
      definition_id: v3Definition.id, executable_plan_hash: PLAN_HASH, oracle_kind: 'subject_observable',
      oracle_subject_id: v3Definition.oracle.subjectId }).execute()
  }
  await insertExecution('execution-suite-v3', true)
  await insertExecution('execution-direct-v3', false)
}

async function withFixture<T>(backend: Backend, operation: (db: Kysely<any>) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `migration-035-${backend}-`))
  const db = openDb(backend, path.join(root, 'forge.db'))
  try {
    await sql`PRAGMA foreign_keys = ON`.execute(db)
    await createPre035Schema(db)
    await seedValid(db)
    return await operation(db)
  } finally {
    await db.destroy()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

async function migrate(db: Kysely<any>): Promise<void> {
  await runWithMigrationContext({ dialect: 'sqlite' } as any,
    () => db.transaction().execute(async trx => {
      await migrate035(trx)
      const violations = (await sql<any>`PRAGMA foreign_key_check`.execute(trx)).rows
      if (violations.length > 0) throw new Error(`Migration 035 fixture FK violations: ${JSON.stringify(violations)}`)
    }))
}

async function authoritySnapshot(db: Kysely<any>) {
  return {
    suites: await db.selectFrom('suite_revision_member_authorities').selectAll()
      .orderBy('suite_id').orderBy('member_ordinal').execute(),
    executions: await db.selectFrom('execution_item_authorities').selectAll()
      .orderBy('execution_id').orderBy('item_ordinal').execute(),
  }
}

test('Migration 035 populated backfill is identical under native SQLite and forced WASM', async () => {
  const native = await withFixture('native', async db => { await migrate(db); return authoritySnapshot(db) })
  const wasm = await withFixture('wasm', async db => { await migrate(db); return authoritySnapshot(db) })
  assert.deepEqual(wasm, native)
  assert.equal(native.suites.length, 3)
  assert.equal(native.executions.length, 2)
})

const corruptions: Array<[string, (db: Kysely<any>) => Promise<unknown>]> = [
  ['missing Suite member row', db => db.deleteFrom('suite_revision_members').where('suite_id', '=', 'suite-v2').where('member_ordinal', '=', 2).execute()],
  ['non-contiguous Suite member ordinal', db => sql`UPDATE suite_revision_members SET member_ordinal=3 WHERE suite_id='suite-v2' AND member_ordinal=2`.execute(db)],
  ['missing Execution item', db => db.deleteFrom('execution_items').where('execution_id', '=', 'execution-direct-v3').execute()],
  ['non-contiguous Execution item ordinal', db => sql`UPDATE execution_items SET item_ordinal=2 WHERE execution_id='execution-direct-v3'`.execute(db)],
  ['v3 root missing support seal', db => db.updateTable('executions').set({ support_seal_hash: null }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['v3 root missing route identity', db => db.updateTable('executions').set({ route_evidence_identity_hash: null }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['v3 root missing auth identity', db => db.updateTable('executions').set({ authentication_expectation_identity_hash: null }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['model mismatch', db => db.updateTable('executions').set({ model_row_id: 999 }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['support mismatch', db => db.updateTable('executions').set({ support_seal_hash: '3'.repeat(64) }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['route mismatch', db => db.updateTable('executions').set({ route_evidence_identity_hash: '4'.repeat(64) }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['auth mismatch', db => db.updateTable('executions').set({ authentication_expectation_identity_hash: '5'.repeat(64) }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['malformed Suite authority hash', db => db.updateTable('suite_revisions').set({ test_set_content_hash: 'z'.repeat(64) }).where('suite_id', '=', 'suite-v2').execute()],
  ['malformed Execution authority hash', db => db.updateTable('executions').set({ route_evidence_identity_hash: 'z'.repeat(64) }).where('execution_id', '=', 'execution-direct-v3').execute()],
  ['cross-project Test Set row', db => db.updateTable('test_set_revisions').set({ project_id: 'other-project' }).where('test_set_id', '=', 'test-set-v2').execute()],
  ['Definition absent from exact row', db => db.updateTable('suite_revision_members').set({ definition_id: 'missing-definition' }).where('suite_id', '=', 'suite-v2').where('member_ordinal', '=', 2).execute()],
  ['duplicate Definition ambiguity in exact row', async db => {
    const suite = await db.selectFrom('suite_revisions').select('test_set_row_id')
      .where('suite_id', '=', 'suite-v3').executeTakeFirstOrThrow()
    const row = await db.selectFrom('test_set_revisions').select(['id', 'payload_json'])
      .where('id', '=', suite.test_set_row_id).executeTakeFirstOrThrow()
    await db.deleteFrom('suite_revision_members').where('suite_id', '=', 'suite-v3').execute()
    await db.deleteFrom('suite_revisions').where('suite_id', '=', 'suite-v3').execute()
    await db.deleteFrom('suites').where('suite_id', '=', 'suite-v3').execute()
    const payload = JSON.parse(row.payload_json)
    payload.definitions.push({ ...payload.definitions[0] })
    const payloadJson = JSON.stringify(payload)
    await db.updateTable('test_set_revisions').set({
      definition_count: 2,
      payload_json: payloadJson,
      content_hash: createHash('sha256').update(payloadJson).digest('hex'),
    }).where('id', '=', row.id).execute()
  }],
  ['partial Execution Suite tuple', db => db.updateTable('executions').set({ suite_content_hash: null }).where('execution_id', '=', 'execution-suite-v3').execute()],
]

test('Migration 035 hostile pre-035 corruption matrix aborts without repair or skip', async t => {
  for (const [label, corrupt] of corruptions) {
    await t.test(label, async () => withFixture('native', async db => {
      await corrupt(db)
      await assert.rejects(migrate(db), /Migration 035/)
      assert.equal((await sql<{ count: number }>`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='execution_item_authorities'`.execute(db)).rows[0].count, 0)
    }))
  }
})

test('Migration 035 corrupt populated fixture fails closed under forced WASM too', async () => {
  await withFixture('wasm', async db => {
    await db.deleteFrom('execution_items').where('execution_id', '=', 'execution-direct-v3').execute()
    await assert.rejects(migrate(db), /Migration 035 found incomplete or contradictory Execution manifest authority/)
  })
})

test('Migration 035 DB guard independently rejects incomplete v3 single-root and contaminated scopes', async () => {
  await withFixture('native', async db => {
    await migrate(db)
    const root = await db.selectFrom('executions').selectAll().where('execution_id', '=', 'execution-direct-v3').executeTakeFirstOrThrow()
    for (const field of ['support_seal_hash', 'route_evidence_identity_hash', 'authentication_expectation_identity_hash'] as const) {
      await assert.rejects(db.insertInto('executions').values({ ...root, execution_id: `invalid-${field}`,
        execution_intent_key: `invalid-${field}-intent`, execution_intent_fingerprint: '7'.repeat(64),
        [field]: null }).execute(), /CHECK constraint failed|Execution Test Set authority scope is invalid/i)
    }
    const suite = await db.selectFrom('suite_revisions').select('content_hash').where('suite_id', '=', 'suite-v3').executeTakeFirstOrThrow()
    await assert.rejects(db.insertInto('executions').values({ ...root, execution_id: 'invalid-per-item-root',
      execution_intent_key: 'invalid-per-item-root-intent', execution_intent_fingerprint: '8'.repeat(64),
      test_set_authority_scope: 'per_item', suite_id: 'suite-v3', suite_revision: 1,
      suite_content_hash: suite.content_hash }).execute(), /CHECK constraint failed|Execution Test Set authority scope is invalid|Execution Suite authority mismatch/i)
  })
})
