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
import * as crypto from 'crypto'
import { Kysely, SqliteDialect, sql } from 'kysely'
import { closeDb, getDatabaseProvenance, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { up as migrate030Up } from '../src/core/storage/migrations/030_canonical_execution_start_idempotency'
import {
  ExecutionIntentConflictError,
  ExecutionPersistenceError,
  ExecutionRepository,
  type BeginExecutionInput,
} from '../src/core/storage/repositories/ExecutionRepository'
import { ExecutionService, executionIntentFingerprint, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { ExecutionRunCoordinator } from '../src/core/execution/ExecutionRunCoordinator'
import { startExecution } from '../forge-ui/server/context/ExecutionLifecycleController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-product-004-a-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const PROJECT = 'idempotency-project'
const MODEL_VERSION = '1.0.0'
const ACCEPTED = '2026-08-18T12:00:00.000Z'
const PLAN_HASH = 'a'.repeat(64)
let modelRowId = 0

function beginInput(overrides: Partial<BeginExecutionInput> = {}): BeginExecutionInput {
  const key = overrides.executionIntentKey ?? 'intent-default'
  const requestFingerprint = overrides.executionIntentFingerprint ?? crypto.createHash('sha256').update(key).digest('hex')
  return {
    executionId: 'execution-default', projectId: PROJECT, processInstanceId: 'process-idempotency',
    startedAt: ACCEPTED, executionPlanHash: PLAN_HASH,
    executionIntentKey: key, executionIntentFingerprint: requestFingerprint,
    expectedTestSetId: 'test-set-idempotency', expectedRevision: 1,
    expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
    sourceObservationId: 'observation-idempotency',
    manifestItems: [{ itemOrdinal: 1, definitionId: 'definition-idempotency', executablePlanHash: PLAN_HASH }],
    ...overrides,
  }
}

const plan = {
  fingerprint: PLAN_HASH,
  value: {
    schemaVersion: 1 as const,
    definitionId: 'definition-idempotency',
    title: 'Idempotency definition',
    category: 'navigation' as const,
    steps: [{ kind: 'navigate_to_observed_route' as const, subjectId: 'subject-idempotency', routePath: '/inventory.html' }],
    oracle: { kind: 'subject_observable' as const, subjectId: 'subject-idempotency', assertion: 'final_url_matches_route_no_navigation_error' as const },
    provenance: {
      definitionId: 'definition-idempotency', sourceObservationId: 'observation-idempotency',
      modelRowId: 1, modelVersion: MODEL_VERSION, supportingEvidenceIds: ['evidence-idempotency'],
      testSetId: 'test-set-idempotency', revision: 1,
    },
    authenticationRequired: false,
  },
}

function request(key: string, definitionIds = ['definition-idempotency']): GovernedExecutionStartRequest {
  return {
    projectId: PROJECT, executionIntentKey: key, definitionIds, revision: 1,
    workspaceRoot: ROOT,
    credentialReference: { usernameEnv: 'FORGE_FIXTURE_USERNAME', passwordEnv: 'FORGE_FIXTURE_PASSWORD' },
    runtime: { baseUrl: 'https://example.invalid' },
  }
}

function service(executionId: string, executeCounter: { count: number }, repository = new ExecutionRepository()): ExecutionService {
  let tick = 0
  const lifecycle = new ExecutionService({
    repository,
    v1ExecutionPolicy: 'historical_compatibility',
    migrate: async () => undefined,
    mintExecutionId: () => executionId,
    mintCancellationTokenId: () => `token-${executionId}`,
    processInstanceId: `process-${executionId}`,
    now: () => new Date(Date.parse(ACCEPTED) + tick++).toISOString(),
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'ready' }),
    credentials: { isAvailable: () => true } as any,
    executor: {
      execute: async () => {
        executeCounter.count++
        return { status: 'completed' as const, reasonCode: 'completed' as const, finalUrl: 'https://example.invalid/inventory.html' }
      },
    },
    coordinator: {
      admitRun: async () => ({ run_id: `run-${executionId}` }),
      recordResult: async () => undefined,
      terminalize: async (input: any) => repository.completeExecution(input.projectId, input.executionId, input.processInstanceId, input.completedAt),
      terminalizeCancellation: async (input: any) => new ExecutionRunCoordinator().terminalizeCancellation(input),
    } as any,
  })
  ;(lifecycle as any).preflight = async () => ({
    kind: 'ready', plans: [plan],
    current: { contentHash: PLAN_HASH, testSet: { schemaVersion: 1, testSetId: 'test-set-idempotency', revision: 1 } },
    authority: {
      sourceObservation: { id: 'observation-idempotency', authenticationExpectation: 'none', authenticationOutcome: null },
      model: { rowId: modelRowId, version: MODEL_VERSION }, currentSupportEvidenceIds: ['evidence-idempotency'],
    },
  })
  return lifecycle
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
  const model = await getDb().insertInto('app_models').values({
    app_name: PROJECT, version: MODEL_VERSION, base_url: 'https://example.invalid', app_type: 'web',
    intake_mode: 'crawl', crawl_config_hash: 'b'.repeat(64), page_count: 1, flow_count: 0, role_count: 0,
    model_json: '{}', crawled_at: ACCEPTED, crawled_by: 'engine', status: 'active', evidence_state: 'crawled',
    operation_id: null, candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  modelRowId = Number(model.id)
  await getDb().insertInto('test_set_revisions').values({
    test_set_id: 'test-set-idempotency', revision: 1, project_id: PROJECT, generation_id: 'generation-idempotency',
    schema_version: 1, source_observation_id: 'observation-idempotency', model_row_id: modelRowId,
    model_version: MODEL_VERSION, observation_run_id: null, support_seal_hash: null,
    characterization_policy_id: null, characterization_policy_version: null,
    generated_at: ACCEPTED, outcome: 'completed', definition_count: 1, payload_json: '{}', content_hash: PLAN_HASH,
  }).execute()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD-PRODUCT-004-A-1 fingerprint is versioned, project-scoped, order-sensitive, and secret-free', () => {
  const first = executionIntentFingerprint(request('ignored', ['definition-a', 'definition-b']))
  const same = executionIntentFingerprint(request('different-key', ['definition-a', 'definition-b']))
  const reordered = executionIntentFingerprint(request('ignored', ['definition-b', 'definition-a']))
  const otherProject = executionIntentFingerprint({ ...request('ignored', ['definition-a', 'definition-b']), projectId: 'other-project' })
  const changedRuntimeAndCredentials = executionIntentFingerprint({
    ...request('ignored', ['definition-a', 'definition-b']),
    credentialReference: { usernameEnv: 'OTHER_USERNAME', passwordEnv: 'OTHER_PASSWORD' },
    runtime: { baseUrl: 'https://other.invalid', loginUrl: 'https://other.invalid/login' },
  })
  const currentRevisionIntent = executionIntentFingerprint({ ...request('ignored', ['definition-a', 'definition-b']), revision: undefined })
  assert.equal(first, same)
  assert.equal(first, changedRuntimeAndCredentials)
  assert.notEqual(first, reordered)
  assert.notEqual(first, otherProject)
  assert.notEqual(first, currentRevisionIntent)
  assert.doesNotMatch(first, /credential|password|token/i)
})

test('TD-PRODUCT-004-A-2 repository replay is durable after completion and conflicting reuse rejects', async () => {
  const repository = new ExecutionRepository()
  const input = beginInput({ executionId: 'execution-replay', executionIntentKey: 'intent-replay' })
  assert.deepEqual(await repository.beginExecution(input), { kind: 'accepted' })
  await repository.completeExecution(PROJECT, input.executionId, input.processInstanceId, '2026-08-18T12:00:01.000Z')
  const replay = await repository.beginExecution({ ...input, executionId: 'execution-must-not-exist' })
  assert.equal(replay.kind, 'replayed')
  if (replay.kind !== 'replayed') throw new Error('expected replay')
  assert.equal(replay.executionId, input.executionId)
  await assert.rejects(repository.beginExecution({
    ...input, executionId: 'execution-conflict', executionIntentFingerprint: 'c'.repeat(64),
  }), ExecutionIntentConflictError)
  assert.equal((await getDb().selectFrom('executions').selectAll().where('execution_intent_key', '=', 'intent-replay').execute()).length, 1)
})

test('TD-PRODUCT-004-A-3 N concurrent identical requests persist one Execution and resolve one identity', async () => {
  const repository = new ExecutionRepository()
  const key = 'intent-concurrent'
  const fingerprint = 'd'.repeat(64)
  const concurrentModel = await getDb().insertInto('app_models').values({
    app_name: 'concurrent-project', version: MODEL_VERSION, base_url: '', app_type: 'web', intake_mode: 'crawl',
    crawl_config_hash: 'e'.repeat(64), page_count: 1, flow_count: 0, role_count: 0, model_json: '{}',
    crawled_at: ACCEPTED, crawled_by: 'engine', status: 'active', evidence_state: 'crawled', operation_id: null,
    candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  const concurrentModelRowId = Number(concurrentModel.id)
  await getDb().insertInto('test_set_revisions').values({
    test_set_id: 'test-set-idempotency', revision: 1, project_id: 'concurrent-project', generation_id: 'generation-concurrent',
    schema_version: 1, source_observation_id: 'observation-idempotency', model_row_id: concurrentModelRowId,
    model_version: MODEL_VERSION, observation_run_id: null, support_seal_hash: null,
    characterization_policy_id: null, characterization_policy_version: null, generated_at: ACCEPTED,
    outcome: 'completed', definition_count: 1, payload_json: '{}', content_hash: PLAN_HASH,
  }).execute()
  const inputs = Array.from({ length: 8 }, (_, index) => beginInput({
    executionId: `execution-concurrent-${index + 1}`, executionIntentKey: key,
    executionIntentFingerprint: fingerprint, projectId: 'concurrent-project',
    expectedModelRowId: concurrentModelRowId,
  }))
  const writes = await Promise.all(inputs.map(input => repository.beginExecution(input)))
  const acceptedIndex = writes.findIndex(write => write.kind === 'accepted')
  assert.notEqual(acceptedIndex, -1)
  const acceptedId = inputs[acceptedIndex].executionId
  assert.deepEqual(new Set(writes.map((write, index) => write.kind === 'accepted' ? inputs[index].executionId : write.executionId)), new Set([acceptedId]))
  assert.equal((await getDb().selectFrom('executions').selectAll().where('project_id', '=', 'concurrent-project').where('execution_intent_key', '=', key).execute()).length, 1)
  await repository.completeExecution('concurrent-project', acceptedId, 'process-idempotency', '2026-08-18T12:00:02.000Z')
})

test('TD-PRODUCT-004-A-4 service replay survives completion and a fresh service instance without rerunning', async () => {
  const counter = { count: 0 }
  const firstService = service('execution-service-original', counter)
  const first = await firstService.start(request('intent-service-restart'))
  assert.equal(first.kind, 'accepted')
  if (first.kind !== 'accepted') throw new Error('expected acceptance')
  assert.equal(first.replayed, false)
  await first.completion
  await closeDb()
  initDb(DB_PATH)
  await runMigrations()
  const restarted = service('execution-service-new-id', counter)
  const replay = await restarted.start(request('intent-service-restart'))
  assert.equal(replay.kind, 'accepted')
  if (replay.kind !== 'accepted') throw new Error('expected replay')
  assert.equal(replay.replayed, true)
  assert.equal(replay.executionId, first.executionId)
  assert.equal(counter.count, 1)
  const semanticConflict = await restarted.start(request('intent-service-restart', ['definition-idempotency', 'definition-other']))
  assert.equal(semanticConflict.kind, 'rejected')
  if (semanticConflict.kind === 'rejected') assert.equal(semanticConflict.code, 'execution_intent_conflict')
})

test('TD-PRODUCT-004-A-4B concurrent canonical Start calls resolve one backend identity and one execution', async () => {
  const counter = { count: 0 }
  const starts = await Promise.all(Array.from({ length: 8 }, (_, index) => (
    service(`execution-service-concurrent-${index + 1}`, counter).start(request('intent-service-concurrent'))
  )))
  assert.ok(starts.every(result => result.kind === 'accepted'))
  const accepted = starts.filter((result): result is Extract<typeof result, { kind: 'accepted' }> => result.kind === 'accepted')
  assert.equal(new Set(accepted.map(result => result.executionId)).size, 1)
  assert.equal(accepted.filter(result => !result.replayed).length, 1)
  await Promise.all(accepted.map(result => result.completion))
  assert.equal(counter.count, 1)
  assert.equal((await getDb().selectFrom('executions').selectAll()
    .where('project_id', '=', PROJECT).where('execution_intent_key', '=', 'intent-service-concurrent').execute()).length, 1)
})

test('TD-PRODUCT-004-A-5 cancelled acceptance remains the replay target', async () => {
  const repository = new ExecutionRepository()
  const input = beginInput({ executionId: 'execution-cancelled-replay', executionIntentKey: 'intent-cancelled-replay' })
  await repository.beginExecution(input)
  await repository.requestCancellation({
    projectId: PROJECT, executionId: input.executionId, requestProcessInstanceId: input.processInstanceId,
    requestedAt: '2026-08-18T12:00:03.000Z',
  })
  await new ExecutionRunCoordinator().terminalizeCancellation({
    projectId: PROJECT, executionId: input.executionId, processInstanceId: input.processInstanceId,
    runId: null, completedAt: '2026-08-18T12:00:04.000Z',
  })
  const replay = await repository.beginExecution({ ...input, executionId: 'execution-after-cancel' })
  assert.equal(replay.kind, 'replayed')
  if (replay.kind === 'replayed') assert.equal(replay.executionId, input.executionId)
})

test('TD-PRODUCT-004-A-6 failed acceptance transaction leaves no replay claim', async () => {
  const repository = new ExecutionRepository()
  await sql.raw(`CREATE TRIGGER fail_intent_atomicity BEFORE INSERT ON execution_events WHEN NEW.execution_id = 'execution-atomic-fail' BEGIN SELECT RAISE(ABORT, 'forced atomicity failure'); END`).execute(getDb())
  const failed = beginInput({ executionId: 'execution-atomic-fail', executionIntentKey: 'intent-atomic-fail' })
  await assert.rejects(repository.beginExecution(failed), ExecutionPersistenceError)
  assert.equal(await repository.findExecutionIntent(PROJECT, failed.executionIntentKey), null)
  assert.equal((await getDb().selectFrom('executions').selectAll().where('execution_intent_key', '=', failed.executionIntentKey).execute()).length, 0)
  await sql.raw('DROP TRIGGER fail_intent_atomicity').execute(getDb())
  const accepted = await repository.beginExecution({ ...failed, executionId: 'execution-atomic-retry' })
  assert.equal(accepted.kind, 'accepted')
  await repository.completeExecution(PROJECT, 'execution-atomic-retry', failed.processInstanceId, '2026-08-18T12:00:05.000Z')
})

test('TD-PRODUCT-004-A-7 SQLite rejects missing/malformed/duplicate/reassigned intent authority and scopes keys by project', async () => {
  const columns = `execution_id,project_id,accepted_at,test_set_id,test_set_revision,definition_schema_version,model_row_id,model_version,source_observation_id,support_seal_hash,route_evidence_identity_hash,authentication_expectation_identity_hash,manifest_hash,max_run_attempts,dispatch_mode,stop_rule,execution_intent_key,execution_intent_fingerprint`
  const values = (id: string, project: string, key: string, fingerprint: string) => `'${id}','${project}','${ACCEPTED}','set-direct',1,2,1,'1',NULL,'${PLAN_HASH}','${PLAN_HASH}','${PLAN_HASH}','${PLAN_HASH}',1,'serial','stop_on_first_non_completed','${key}','${fingerprint}'`
  await sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-a', 'sql-project-a', 'intent-sql', PLAN_HASH)})`).execute(getDb())
  await assert.rejects(sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-duplicate', 'sql-project-a', 'intent-sql', PLAN_HASH)})`).execute(getDb()))
  await sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-cross-project', 'sql-project-b', 'intent-sql', PLAN_HASH)})`).execute(getDb())
  await assert.rejects(sql.raw(`INSERT INTO executions (${columns.replace(',execution_intent_key,execution_intent_fingerprint', '')}) VALUES ('execution-sql-missing','sql-project-c','${ACCEPTED}','set',1,2,1,'1',NULL,'${PLAN_HASH}','${PLAN_HASH}','${PLAN_HASH}','${PLAN_HASH}',1,'serial','stop_on_first_non_completed')`).execute(getDb()))
  await assert.rejects(sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-bad-key', 'sql-project-c', '../unsafe', PLAN_HASH)})`).execute(getDb()))
  await assert.rejects(sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-long-key', 'sql-project-c', `a${'b'.repeat(128)}`, PLAN_HASH)})`).execute(getDb()))
  await assert.rejects(sql.raw(`INSERT INTO executions (${columns}) VALUES (${values('execution-sql-bad-hash', 'sql-project-c', 'intent-safe', 'A'.repeat(64))})`).execute(getDb()))
  await assert.rejects(getDb().updateTable('executions').set({ execution_intent_key: 'intent-reassigned' }).where('execution_id', '=', 'execution-sql-a').execute())
  await assert.rejects(getDb().updateTable('executions').set({ execution_intent_fingerprint: 'f'.repeat(64) }).where('execution_id', '=', 'execution-sql-a').execute())
  await assert.rejects(getDb().deleteFrom('executions').where('execution_id', '=', 'execution-sql-a').execute())
})

test('TD-PRODUCT-004-A-8 controller requires strict intent authority and reports replay/conflict explicitly', async () => {
  const original = executionContext.startProductExecution
  const calls: Array<Record<string, unknown>> = []
  try {
    ;(executionContext as any).startProductExecution = async (_appName: string, input: Record<string, unknown>) => {
      calls.push(input)
      return input.executionIntentKey === 'intent-conflict'
        ? { kind: 'rejected', code: 'execution_intent_conflict', safeMessage: 'conflict' }
        : { kind: 'accepted', executionId: 'execution-from-server', startedAt: ACCEPTED, executionPlanHash: PLAN_HASH, replayed: input.executionIntentKey === 'intent-replay' }
    }
    const resolve = async () => ({ appName: PROJECT, url: 'https://example.invalid' })
    assert.equal((await startExecution(PROJECT, { definitionIds: ['definition-idempotency'], revision: 1 }, resolve)).status, 400)
    assert.equal((await startExecution(PROJECT, { executionIntentKey: '../unsafe', definitionIds: ['definition-idempotency'], revision: 1 }, resolve)).status, 400)
    assert.equal((await startExecution(PROJECT, { executionIntentKey: 'intent-extra', definitionIds: ['definition-idempotency'], revision: 1, unexpected: true }, resolve)).status, 400)
    assert.equal((await startExecution(PROJECT, { executionIntentKey: 'intent-bad-revision', definitionIds: ['definition-idempotency'], revision: 1.5 }, resolve)).status, 400)
    assert.equal((await startExecution(PROJECT, { executionIntentKey: 'intent-current', definitionIds: ['definition-idempotency'] }, resolve)).status, 202)
    const accepted = await startExecution(PROJECT, { executionIntentKey: 'intent-new', definitionIds: ['definition-idempotency'], revision: 1 }, resolve)
    assert.equal(accepted.status, 202)
    assert.match(JSON.stringify(accepted.body), /"executionId":"execution-from-server"/)
    assert.match(JSON.stringify(accepted.body), /"replayed":false/)
    const replay = await startExecution(PROJECT, { executionIntentKey: 'intent-replay', definitionIds: ['definition-idempotency'], revision: 1 }, resolve)
    assert.equal(replay.status, 202)
    assert.match(JSON.stringify(replay.body), /"replayed":true/)
    const conflict = await startExecution(PROJECT, { executionIntentKey: 'intent-conflict', definitionIds: ['definition-idempotency'], revision: 1 }, resolve)
    assert.equal(conflict.status, 409)
    assert.match(JSON.stringify(conflict.body), /EXECUTION_INTENT_CONFLICT/)
    assert.equal(calls.length, 4)
    assert.equal(calls[0].executionIntentKey, 'intent-current')
    assert.equal('revision' in calls[0], false)
    assert.equal('executionId' in calls[0], false)
  } finally {
    ;(executionContext as any).startProductExecution = original
  }
})

test('TD-PRODUCT-004-A-9 Migration 030 preserves historical null authority and refuses rollback', async () => {
  const historicalPath = path.join(ROOT, 'historical-pre-030.db')
  const BetterSqlite3 = require('better-sqlite3')
  const sqlite = new BetterSqlite3(historicalPath)
  const historicalDb = new Kysely<any>({ dialect: new SqliteDialect({ database: sqlite }) })
  try {
    await sql.raw(`CREATE TABLE executions (execution_id TEXT PRIMARY KEY, project_id TEXT NOT NULL)`).execute(historicalDb)
    await sql.raw(`INSERT INTO executions (execution_id,project_id) VALUES ('historical-execution','historical-project')`).execute(historicalDb)
    await runWithMigrationContext(getDatabaseProvenance(), () => migrate030Up(historicalDb))
    const row = await sql<{ execution_intent_key: string | null; execution_intent_fingerprint: string | null }>`
      SELECT execution_intent_key, execution_intent_fingerprint FROM executions WHERE execution_id = 'historical-execution'
    `.execute(historicalDb)
    assert.deepEqual(row.rows[0], { execution_intent_key: null, execution_intent_fingerprint: null })
    await assert.rejects(runWithMigrationContext(getDatabaseProvenance(), async () => {
      const migration = await import('../src/core/storage/migrations/030_canonical_execution_start_idempotency')
      await migration.down(historicalDb)
    }), /intentionally irreversible/)
  } finally {
    await historicalDb.destroy()
  }
})

test('TD-PRODUCT-004-A-10 intact restart is byte-stable and SQLite integrity remains valid', async () => {
  const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex')
  await runMigrations()
  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex')
  assert.equal(afterHash, beforeHash)
  assert.equal((await sql<{ quick_check: string }>`PRAGMA quick_check`.execute(getDb())).rows[0]?.quick_check, 'ok')
  assert.equal((await sql`PRAGMA foreign_key_check`.execute(getDb())).rows.length, 0)
})

test('TD-PRODUCT-004-A-11 routine migration inspection behaviorally rejects an inert required-authority trigger', async () => {
  await sql.raw('DROP TRIGGER execution_intent_authority_required_insert').execute(getDb())
  await sql.raw(`
    CREATE TRIGGER execution_intent_authority_required_insert BEFORE INSERT ON executions
    WHEN NEW.execution_intent_key IS NULL OR NEW.execution_intent_fingerprint IS NULL
    BEGIN SELECT CASE WHEN NEW.execution_intent_key IS NULL THEN 1 ELSE 0 END; END
  `).execute(getDb())
  await assert.rejects(runMigrations(), /030_canonical_execution_start_idempotency.*required_authority semantic persistence guard/i)
  const trigger = (await sql<{ definition: string }>`
    SELECT sql AS definition FROM sqlite_master
    WHERE type = 'trigger' AND name = 'execution_intent_authority_required_insert'
  `.execute(getDb())).rows[0]?.definition ?? ''
  assert.match(trigger, /THEN 1 ELSE 0/)
})
