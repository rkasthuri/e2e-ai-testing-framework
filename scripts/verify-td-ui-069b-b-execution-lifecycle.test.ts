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
import { sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  DuplicateExecutionError,
  ExecutionPersistenceError,
  ExecutionRepository,
} from '../src/core/storage/repositories/ExecutionRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { TestSetService } from '../src/core/storage/TestSetService'
import { ExecutionService, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { ExecutionRecoveryCoordinator } from '../src/core/execution/ExecutionRecoveryCoordinator'
import { PersistedEvidenceAggregator } from '../src/core/execution/PersistedEvidenceAggregator'
import type { PlaywrightPlanExecutionResult } from '../src/core/execution/PlaywrightPlanExecutor'
import type { CredentialExecutionScope, CredentialMaterial } from '../src/core/security/CredentialExecutionScope'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import type { CanonicalTestDefinition, TestDesignAuthorityInput } from '../src/core/test-design/TestDefinitionContract'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-b-life-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const PROJECT = 'saucedemo'
const OBSERVATION = 'td069bb-observation'
const EVIDENCE = 'td069bb-evidence'
const MODEL_VERSION = '1.0.0'
const USERNAME_REFERENCE = 'SAUCEDEMO_USERNAME'
const PASSWORD_REFERENCE = 'SAUCEDEMO_PASSWORD'
let modelRowId = 0
let definition: CanonicalTestDefinition
let testSetId = ''
let executionIntentOrdinal = 0

function manifest(executablePlanHash: string) {
  return {
    executionIntentKey: `intent-direct-${executablePlanHash.slice(0, 12)}`,
    executionIntentFingerprint: executablePlanHash,
    sourceObservationId: OBSERVATION,
    manifestItems: [{ itemOrdinal: 1, definitionId: definition.id, executablePlanHash }],
  }
}

function designInput(): TestDesignAuthorityInput {
  return {
    projectId: PROJECT,
    sourceObservation: {
      id: OBSERVATION,
      outcome: 'completed',
      authenticationOutcome: 'succeeded',
      authenticationExpectation: 'form-login',
      credentialReference: { usernameEnv: USERNAME_REFERENCE, passwordEnv: PASSWORD_REFERENCE },
      subjectIds: ['inventory-html'],
    },
    model: {
      rowId: modelRowId,
      version: MODEL_VERSION,
      sourceObservationId: OBSERVATION,
      validation: 'valid',
      integrity: 'not_evaluated',
      subjects: [{ id: 'inventory-html', routePath: '/inventory.html', evidenceId: EVIDENCE }],
    },
    evidence: [{
      id: EVIDENCE,
      canonicalSubjectId: 'inventory-html',
      routePath: '/inventory.html',
      sourceObservationId: OBSERVATION,
      sourceModelRows: [modelRowId],
      support: 'current',
      integrity: 'not_evaluated',
      freshness: 'not_evaluated',
      access: 'available',
      conflict: 'not_evaluated',
    }],
    generatedAt: '2026-08-10T12:00:00.000Z',
  }
}

function request(overrides: Partial<GovernedExecutionStartRequest> = {}): GovernedExecutionStartRequest {
  return {
    projectId: PROJECT,
    executionIntentKey: `intent-service-${++executionIntentOrdinal}`,
    definitionIds: [definition.id],
    revision: 1,
    preflightState: 'ready',
    projectionAuthority: {
      sourceObservation: {
        id: OBSERVATION,
        authenticationExpectation: 'form-login',
        authenticationOutcome: 'succeeded',
      },
      model: { rowId: modelRowId, version: MODEL_VERSION },
      currentSupportEvidenceIds: [EVIDENCE],
    },
    runtime: { baseUrl: 'https://www.saucedemo.com', loginUrl: 'https://www.saucedemo.com' },
    ...overrides,
  }
}

class Credentials implements CredentialExecutionScope {
  constructor(private readonly available = true) {}
  isAvailable() { return this.available }
  async run<T>(_reference: unknown, operation: (material: CredentialMaterial) => Promise<T>) {
    return this.available
      ? { kind: 'completed' as const, value: await operation({ username: 'fixture-user', password: 'fixture-secret-069bb' }) }
      : { kind: 'unavailable' as const }
  }
  runProvided<T>(material: { username: string; password: string }, operation: (material: CredentialMaterial) => Promise<T>): Promise<T> {
    return operation(material)
  }
}

function service(
  executionId: string,
  result: PlaywrightPlanExecutionResult | Error = { status: 'completed', reasonCode: 'completed', finalUrl: 'https://www.saucedemo.com/inventory.html' },
  credentials: CredentialExecutionScope = new Credentials(),
  overrides: Record<string, unknown> = {},
): ExecutionService {
  let tick = 0
  return new ExecutionService({
    v1ExecutionPolicy: 'historical_compatibility',
    credentials,
    executor: { execute: async () => { if (result instanceof Error) throw result; return result } },
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable runner available.' }),
    migrate: async () => undefined,
    now: () => new Date(Date.parse('2026-08-10T13:00:00.000Z') + tick++ * 1000).toISOString(),
    mintExecutionId: () => executionId,
    processInstanceId: 'process-lifecycle-test',
    ...overrides,
  })
}

async function eventCount(executionId?: string): Promise<number> {
  let query = getDb().selectFrom('execution_events').select(({ fn }) => fn.countAll<number>().as('count'))
  if (executionId) query = query.where('execution_id', '=', executionId)
  return Number((await query.executeTakeFirstOrThrow()).count)
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
  const inserted = await getDb().insertInto('app_models').values({
    app_name: PROJECT,
    version: MODEL_VERSION,
    base_url: 'https://www.saucedemo.com',
    app_type: 'web',
    intake_mode: 'crawl',
    crawl_config_hash: 'a'.repeat(64),
    page_count: 1,
    flow_count: 0,
    role_count: 1,
    model_json: '{}',
    crawled_at: '2026-08-10T11:00:00.000Z',
    crawled_by: 'engine',
    status: 'active',
    evidence_state: 'crawled',
    operation_id: null,
    candidate_hash: null,
    recovery_source_row_id: null,
    recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  modelRowId = Number(inserted.id)
  const generated = await new TestSetService(new TestSetRepository(), () => '2026-08-10T12:00:00.000Z')
    .generate(designInput(), 'td069bb-generation')
  definition = generated.testSet.definitions[0]
  testSetId = generated.testSet.testSetId
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-B-1 empty selection, stale revision, runner unavailable, and missing credentials persist no execution identity', async () => {
  const before = await eventCount()
  const empty = await service('execution-empty').start(request({ definitionIds: [] }))
  assert.deepEqual(empty, { kind: 'rejected', code: 'empty_selection', safeMessage: 'At least one current-revision definition must be selected.' })
  assert.equal((await service('execution-stale').start(request({ revision: 99 }))).kind, 'rejected')
  const noRunner = service('execution-runner', undefined, new Credentials(), {
    runnerReadiness: () => ({ available: false, safeCode: 'runner_unavailable', safeMessage: 'Runner unavailable.' }),
  })
  assert.equal((await noRunner.start(request()) as any).code, 'runner_unavailable')
  assert.equal((await service('execution-creds', undefined, new Credentials(false)).start(request()) as any).code, 'credentials_unavailable')
  assert.equal(await eventCount(), before)
})

test('TD069B-B-2 incompatible and conflicting definitions are refused before persistence', async () => {
  const malformed = structuredClone(definition) as any
  malformed.steps[0].kind = 'click'
  const reader = {
    async readInventory() {
      return {
        current: { rowId: 1, contentHash: 'a'.repeat(64), testSet: { schemaVersion: 1, testSetId, revision: 1, definitions: [malformed] } },
        history: [], total: 1, nextCursor: null, requestedDefinition: null,
      } as any
    },
  }
  const incompatible = service('execution-incompatible', undefined, new Credentials(), { definitions: reader })
  assert.equal((await incompatible.start(request()) as any).code, 'incompatible_definition')
  const conflicting = await service('execution-conflict').start(request({
    projectionAuthority: { ...request().projectionAuthority, currentSupportEvidenceIds: [] },
  }))
  assert.equal((conflicting as any).code, 'conflicting_evidence')
  assert.equal(await eventCount('execution-incompatible'), 0)
  assert.equal(await eventCount('execution-conflict'), 0)
})

test('TD069B-B-3 atomic Start persists one identity, one lock, one started event, and the exact plan hash', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const runner = { execute: async () => { await held; return { status: 'completed', reasonCode: 'completed', finalUrl: 'https://www.saucedemo.com/inventory.html' } as const } }
  const lifecycle = service('execution-atomic', undefined, new Credentials(), { executor: runner })
  const accepted = await lifecycle.start(request())
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  const events = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', accepted.executionId).execute()
  const locks = await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', accepted.executionId).execute()
  const roots = await getDb().selectFrom('executions').selectAll().where('execution_id', '=', accepted.executionId).execute()
  const items = await getDb().selectFrom('execution_items').selectAll().where('execution_id', '=', accepted.executionId).execute()
  assert.equal(events.length, 1)
  assert.equal(events[0].event_type, 'started')
  assert.equal(events[0].execution_plan_hash, accepted.executionPlanHash)
  assert.equal(locks.length, 1)
  assert.equal(roots.length, 1)
  assert.equal(roots[0].manifest_hash, accepted.executionPlanHash)
  assert.equal(items.length, 1)
  assert.equal(items[0].definition_id, definition.id)
  assert.equal((await lifecycle.readStatus(PROJECT, accepted.executionId))?.state, 'running')
  release()
  await accepted.completion
})

test('TD069B-B-4 duplicate active execution creates no secondary identity, event, or lock', async () => {
  const repository = new ExecutionRepository()
  await repository.beginExecution({
    executionId: 'execution-duplicate-one', projectId: PROJECT, processInstanceId: 'process-duplicate',
    startedAt: '2026-08-10T14:00:00.000Z', executionPlanHash: 'b'.repeat(64),
    ...manifest('b'.repeat(64)),
    expectedTestSetId: testSetId, expectedRevision: 1, expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
  })
  await assert.rejects(repository.beginExecution({
    executionId: 'execution-duplicate-two', projectId: PROJECT, processInstanceId: 'process-duplicate',
    startedAt: '2026-08-10T14:00:01.000Z', executionPlanHash: 'c'.repeat(64),
    ...manifest('c'.repeat(64)),
    expectedTestSetId: testSetId, expectedRevision: 1, expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
  }), DuplicateExecutionError)
  assert.equal(await eventCount('execution-duplicate-two'), 0)
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-duplicate-two').execute()).length, 0)
  assert.equal((await getDb().selectFrom('executions').selectAll().where('execution_id', '=', 'execution-duplicate-two').execute()).length, 0)
  await repository.completeExecution(PROJECT, 'execution-duplicate-one', 'process-duplicate', '2026-08-10T14:00:02.000Z')
})

test('TD069B-B-5 executor reasons map to separate completed lifecycle and evidence outcomes', async () => {
  const cases: Array<[string, PlaywrightPlanExecutionResult, string, string]> = [
    ['completed', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://www.saucedemo.com/inventory.html' }, 'passed', 'completed'],
    ['authentication', { status: 'authentication_failed', reasonCode: 'authentication_failed' }, 'could_not_verify', 'authentication_failed'],
    ['navigation', { status: 'navigation_failed', reasonCode: 'navigation_failed' }, 'could_not_verify', 'navigation_failed'],
    ['oracle', { status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: 'https://www.saucedemo.com/login' }, 'failed', 'oracle_failed'],
    ['unsupported', { status: 'unsupported_plan', reasonCode: 'unsupported_action' }, 'could_not_verify', 'unsupported_action'],
    ['executor', { status: 'executor_failure', reasonCode: 'executor_failure' }, 'could_not_verify', 'executor_failure'],
  ]
  for (const [name, result, expectedOutcome, expectedReason] of cases) {
    const lifecycle = service(`execution-map-${name}`, result)
    const accepted = await lifecycle.start(request())
    assert.equal(accepted.kind, 'accepted')
    if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
    await accepted.completion
    const status = await lifecycle.readStatus(PROJECT, accepted.executionId)
    assert.equal(status?.state, 'completed')
    assert.equal(status?.outcome, expectedOutcome)
    assert.equal(status?.safeCode, expectedReason)
    assert.equal(status?.terminal, true)
    assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', accepted.executionId).execute()).length, 0)
  }
})

test('TD069B-B-6 heartbeat advances liveness and a stale foreign lock reconciles to interrupted on contact', async () => {
  const repository = new ExecutionRepository()
  await repository.beginExecution({
    executionId: 'execution-stale', projectId: PROJECT, processInstanceId: 'process-old',
    startedAt: '2026-08-10T15:00:00.000Z', executionPlanHash: 'd'.repeat(64),
    ...manifest('d'.repeat(64)),
    expectedTestSetId: testSetId, expectedRevision: 1, expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
  })
  await repository.heartbeat(PROJECT, 'execution-stale', 'process-old', '2026-08-10T15:01:00.000Z')
  assert.equal((await new PersistedEvidenceAggregator().readStatus(PROJECT, 'execution-stale'))?.lastHeartbeatAt, '2026-08-10T15:01:00.000Z')
  const reconciled = await new ExecutionRecoveryCoordinator().reconcile({
    projectId: PROJECT, executionId: 'execution-stale', currentProcessInstanceId: 'process-new',
    locallyActive: false, now: '2026-08-10T17:01:00.000Z',
  })
  assert.equal(reconciled.status?.state, 'interrupted')
  assert.equal(reconciled.status?.safeCode, 'interrupted_before_dispatch')
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-stale').execute()).length, 0)
})

test('TD069B-B-7 begin failure rolls back the lock and started identity together', async () => {
  const repository = new ExecutionRepository()
  await sql.raw(`CREATE TRIGGER fail_execution_begin BEFORE INSERT ON execution_events WHEN NEW.execution_id = 'execution-begin-failure' BEGIN SELECT RAISE(ABORT, 'forced begin failure'); END`).execute(getDb())
  await assert.rejects(repository.beginExecution({
    executionId: 'execution-begin-failure', projectId: PROJECT, processInstanceId: 'process-failure',
    startedAt: '2026-08-10T18:00:00.000Z', executionPlanHash: 'e'.repeat(64),
    ...manifest('e'.repeat(64)),
    expectedTestSetId: testSetId, expectedRevision: 1, expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
  }), ExecutionPersistenceError)
  assert.equal(await eventCount('execution-begin-failure'), 0)
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-begin-failure').execute()).length, 0)
  assert.equal((await getDb().selectFrom('executions').selectAll().where('execution_id', '=', 'execution-begin-failure').execute()).length, 0)
  assert.equal((await getDb().selectFrom('execution_items').selectAll().where('execution_id', '=', 'execution-begin-failure').execute()).length, 0)
  await sql.raw('DROP TRIGGER fail_execution_begin').execute(getDb())
})

test('TD069B-B-8 terminal-write failure never fabricates completion; on-contact recovery records interrupted', async () => {
  const repository = new ExecutionRepository()
  await repository.beginExecution({
    executionId: 'execution-terminal-failure', projectId: PROJECT, processInstanceId: 'process-terminal',
    startedAt: '2026-08-10T19:00:00.000Z', executionPlanHash: 'f'.repeat(64),
    ...manifest('f'.repeat(64)),
    expectedTestSetId: testSetId, expectedRevision: 1, expectedModelRowId: modelRowId, expectedModelVersion: MODEL_VERSION,
  })
  await sql.raw(`CREATE TRIGGER fail_execution_terminal BEFORE INSERT ON execution_events WHEN NEW.execution_id = 'execution-terminal-failure' AND NEW.event_type = 'terminal' BEGIN SELECT RAISE(ABORT, 'forced terminal failure'); END`).execute(getDb())
  await assert.rejects(repository.completeExecution(PROJECT, 'execution-terminal-failure', 'process-terminal', '2026-08-10T19:00:01.000Z'), ExecutionPersistenceError)
  const unconfirmed = await new PersistedEvidenceAggregator().readStatus(PROJECT, 'execution-terminal-failure')
  assert.equal(unconfirmed?.terminal, false)
  assert.equal(unconfirmed?.state, 'running')
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-terminal-failure').execute()).length, 1)
  await sql.raw('DROP TRIGGER fail_execution_terminal').execute(getDb())
  const recovered = await new ExecutionRecoveryCoordinator().reconcile({
    projectId: PROJECT, executionId: 'execution-terminal-failure', currentProcessInstanceId: 'process-terminal',
    locallyActive: false, now: '2026-08-10T19:00:02.000Z',
  })
  assert.equal(recovered.status?.state, 'interrupted')
  assert.notEqual(recovered.status?.state, 'completed')
})

test('TD069B-B-9 raw executor errors create no Result or fabricated terminal truth and never leak', async () => {
  const secret = 'must-not-leak-td069bb'
  const lifecycle = service(
    'execution-secret',
    new Error(secret),
    new EnvironmentCredentialExecutionScope({
      SAUCEDEMO_USERNAME: `user-${secret}`, SAUCEDEMO_PASSWORD: secret,
    }),
  )
  const accepted = await lifecycle.start(request())
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  await accepted.completion
  const status = await lifecycle.readStatus(PROJECT, accepted.executionId)
  const persisted = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', accepted.executionId).execute()
  assert.equal(status?.state, 'interrupted')
  assert.equal(status?.safeCode, 'interrupted_before_result')
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', accepted.executionId).executeTakeFirstOrThrow()
  assert.equal((await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()).length, 0)
  const terminal = await getDb().selectFrom('execution_events').selectAll()
    .where('execution_id', '=', accepted.executionId).where('event_type', '=', 'terminal').execute()
  assert.equal(terminal.length, 1)
  assert.doesNotMatch(JSON.stringify({ status, persisted }), new RegExp(secret, 'i'))
  assert.doesNotMatch(JSON.stringify({ status, persisted }), /username|password|cookie|token|storageState/i)
  assert.equal((await getDb().selectFrom('runs').select('lifecycle').where('run_id', '=', run.run_id).executeTakeFirstOrThrow()).lifecycle, 'interrupted')
})

test('TD069B-B-10 execution writes one intended Run/Result and does not mutate App Model or test-set revision authority', async () => {
  const before = {
    runs: Number((await getDb().selectFrom('runs').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count),
    results: Number((await getDb().selectFrom('test_results').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count),
    models: await getDb().selectFrom('app_models').select(['id', 'status', 'model_json']).where('app_name', '=', PROJECT).execute(),
    revisions: await getDb().selectFrom('test_set_revisions').select(['id', 'content_hash', 'payload_json']).where('project_id', '=', PROJECT).execute(),
  }
  const lifecycle = service('execution-boundary')
  const accepted = await lifecycle.start(request())
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  await accepted.completion
  const afterBoundary = {
    runs: Number((await getDb().selectFrom('runs').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count),
    results: Number((await getDb().selectFrom('test_results').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow()).count),
    models: await getDb().selectFrom('app_models').select(['id', 'status', 'model_json']).where('app_name', '=', PROJECT).execute(),
    revisions: await getDb().selectFrom('test_set_revisions').select(['id', 'content_hash', 'payload_json']).where('project_id', '=', PROJECT).execute(),
  }
  assert.equal(afterBoundary.runs, before.runs + 1)
  assert.equal(afterBoundary.results, before.results + 1)
  assert.deepEqual(afterBoundary.models, before.models)
  assert.deepEqual(afterBoundary.revisions, before.revisions)
})

test('TD069B-B-11 Start and Status routes are transport-only and expose the approved endpoints', () => {
  const routes = fs.readFileSync(path.resolve('forge-ui/server/routes/projects.ts'), 'utf8')
  assert.match(routes, /router\.post\('\/:appName\/execution\/start'/)
  assert.match(routes, /router\.get\('\/:appName\/execution\/:executionId\/status'/)
  assert.match(routes, /startExecution\(req\.params\.appName, req\.body, resolveKnownProject\)/)
  assert.match(routes, /readExecutionStatus\(req\.params\.appName, req\.params\.executionId, resolveKnownProject\)/)
  assert.doesNotMatch(routes, /PlaywrightPlanExecutor|chromium\.launch|execution_events|execution_locks/)
})
