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
import { ExecutionRepository } from '../src/core/storage/repositories/ExecutionRepository'
import { TestSetRepository } from '../src/core/storage/repositories/TestSetRepository'
import { TestSetService } from '../src/core/storage/TestSetService'
import { ExecutionRunCoordinator } from '../src/core/execution/ExecutionRunCoordinator'
import { ExecutionRecoveryCoordinator } from '../src/core/execution/ExecutionRecoveryCoordinator'
import { PersistedEvidenceAggregator } from '../src/core/execution/PersistedEvidenceAggregator'
import { ExecutionService, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { GovernedExecutionCancellationToken } from '../src/core/execution/ExecutionCancellationToken'
import { PlaywrightPlanExecutor, type PlaywrightPlanExecutionResult } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import { projectExecutablePlan } from '../src/core/execution/ExecutionProjectionService'
import type { MaterializedExecutablePlan } from '../src/core/execution/ExecutablePlanContract'
import type { TestDesignAuthorityInput } from '../src/core/test-design/TestDefinitionContract'
import { cancelExecution } from '../forge-ui/server/context/ExecutionLifecycleController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-f-cancel-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const BASE = '2026-08-10T20:00:00.000Z'
const OWNER = 'process-cancellation-owner'

interface Authority {
  projectId: string
  request: GovernedExecutionStartRequest
  plans: MaterializedExecutablePlan[]
  testSetId: string
  modelRowId: number
  observationId: string
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function authority(suffix: string, itemCount = 1): Promise<Authority> {
  const projectId = `cancel-${suffix}`
  const observationId = `observation-${suffix}`
  const subjects = Array.from({ length: itemCount }, (_, index) => ({
    id: `subject-${suffix}-${index + 1}`,
    routePath: `/inventory-${index + 1}.html`,
    evidenceId: `evidence-${suffix}-${index + 1}`,
  }))
  const inserted = await getDb().insertInto('app_models').values({
    app_name: projectId, version: '1.0.0', base_url: 'https://example.invalid', app_type: 'web',
    intake_mode: 'crawl', crawl_config_hash: 'a'.repeat(64), page_count: itemCount, flow_count: 0, role_count: 1,
    model_json: '{}', crawled_at: BASE, crawled_by: 'engine', status: 'active', evidence_state: 'crawled',
    operation_id: null, candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  const modelRowId = Number(inserted.id)
  const input: TestDesignAuthorityInput = {
    projectId,
    sourceObservation: {
      id: observationId, outcome: 'completed', authenticationOutcome: 'succeeded',
      authenticationExpectation: 'form-login',
      credentialReference: { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' },
      subjectIds: subjects.map(subject => subject.id),
    },
    model: {
      rowId: modelRowId, version: '1.0.0', sourceObservationId: observationId,
      validation: 'valid', integrity: 'not_evaluated', subjects,
    },
    evidence: subjects.map(subject => ({
      id: subject.evidenceId, canonicalSubjectId: subject.id, routePath: subject.routePath,
      sourceObservationId: observationId, sourceModelRows: [modelRowId], support: 'current' as const,
      integrity: 'not_evaluated' as const, freshness: 'not_evaluated' as const,
      access: 'available' as const, conflict: 'not_evaluated' as const,
    })),
    generatedAt: BASE,
  }
  const generated = await new TestSetService(new TestSetRepository(), () => BASE).generate(input, `generation-${suffix}`)
  assert.equal(generated.testSet.definitions.length, itemCount)
  const projectionAuthority = {
    currentRevision: { testSetId: generated.testSet.testSetId, revision: 1 },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login' as const, authenticationOutcome: 'succeeded' as const },
    model: { rowId: modelRowId, version: '1.0.0' },
    currentSupportEvidenceIds: subjects.map(subject => subject.evidenceId),
  }
  const plans = generated.testSet.definitions.map(definition => {
    const projected = projectExecutablePlan({
      definition, definitionTestSetId: generated.testSet.testSetId, definitionRevision: 1,
    }, projectionAuthority, BASE)
    assert.equal(projected.kind, 'ok')
    if (projected.kind !== 'ok') throw new Error('projection failed')
    return projected.plan
  })
  return {
    projectId, plans, testSetId: generated.testSet.testSetId, modelRowId, observationId,
    request: {
      projectId, definitionIds: generated.testSet.definitions.map(definition => definition.id), revision: 1,
      preflightState: 'ready', projectionAuthority: {
        sourceObservation: projectionAuthority.sourceObservation,
        model: projectionAuthority.model,
        currentSupportEvidenceIds: projectionAuthority.currentSupportEvidenceIds,
      },
      runtime: { baseUrl: 'https://example.invalid', loginUrl: 'https://example.invalid' },
    },
  }
}

function service(executionId: string, overrides: Record<string, unknown> = {}): ExecutionService {
  let tick = 0
  return new ExecutionService({
    v1ExecutionPolicy: 'historical_compatibility',
    credentials: new EnvironmentCredentialExecutionScope({
      SAUCEDEMO_USERNAME: 'fixture-user', SAUCEDEMO_PASSWORD: 'fixture-password',
    }),
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable runner available.' }),
    migrate: async () => undefined,
    now: () => new Date(Date.parse(BASE) + tick++ * 1000).toISOString(),
    mintExecutionId: () => executionId,
    mintCancellationTokenId: () => `token-${executionId}`,
    processInstanceId: OWNER,
    ...overrides,
  } as any)
}

async function beginDirect(context: Authority, executionId: string, startedAt = BASE, process = OWNER): Promise<void> {
  const hash = context.plans.length === 1
    ? context.plans[0].fingerprint
    : require('crypto').createHash('sha256').update(JSON.stringify({ schemaVersion: 1, planFingerprints: context.plans.map(plan => plan.fingerprint) })).digest('hex')
  await new ExecutionRepository().beginExecution({
    executionId, projectId: context.projectId, processInstanceId: process, startedAt,
    executionPlanHash: hash, expectedTestSetId: context.testSetId, expectedRevision: 1,
    expectedModelRowId: context.modelRowId, expectedModelVersion: '1.0.0', sourceObservationId: context.observationId,
    manifestItems: context.plans.map((plan, index) => ({
      itemOrdinal: index + 1, definitionId: plan.value.definitionId, executablePlanHash: plan.fingerprint,
    })),
  })
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-C-F-1 governed token has immutable identity and Playwright polls only at cooperative boundaries', async () => {
  const context = await authority('token')
  const token = new GovernedExecutionCancellationToken('execution-token', 'token-execution-token')
  const calls: string[] = []
  const executor = new PlaywrightPlanExecutor(
    new EnvironmentCredentialExecutionScope({ SAUCEDEMO_USERNAME: 'u', SAUCEDEMO_PASSWORD: 'p' }),
    async () => ({
      authenticateFormLogin: async () => { calls.push('authenticate'); token.request(); return true },
      navigate: async () => { calls.push('navigate') },
      currentUrl: () => 'https://example.invalid/inventory-1.html',
      close: async () => { calls.push('close') },
    }),
  )
  assert.equal(token.executionId, 'execution-token')
  assert.equal(token.tokenId, 'token-execution-token')
  const result = await executor.execute(context.plans[0].value, context.request.runtime, token)
  assert.deepEqual(result, { status: 'cancelled', reasonCode: 'cancellation_requested' })
  assert.deepEqual(calls, ['authenticate', 'close'])

  const before = new GovernedExecutionCancellationToken('execution-before', 'token-execution-before')
  before.request()
  let sessions = 0
  const beforeExecutor = new PlaywrightPlanExecutor(new EnvironmentCredentialExecutionScope({
    SAUCEDEMO_USERNAME: 'u', SAUCEDEMO_PASSWORD: 'p',
  }), async () => {
    sessions++
    throw new Error('must not create session')
  })
  assert.deepEqual(await beforeExecutor.execute(context.plans[0].value, context.request.runtime, before), {
    status: 'cancelled', reasonCode: 'cancellation_requested',
  })
  assert.equal(sessions, 0)
})

test('TD069B-C-F-2 cancellation before Run admission writes no Run or Result and terminalizes cancelled/could_not_verify', async () => {
  const context = await authority('before-dispatch')
  const entered = deferred()
  const release = deferred()
  const actual = new ExecutionRunCoordinator()
  const coordinator = {
    admitRun: async (input: any) => { entered.resolve(); await release.promise; return actual.admitRun(input) },
    recordResult: (input: any) => actual.recordResult(input),
    terminalize: (input: any) => actual.terminalize(input),
    terminalizeCancellation: (input: any) => actual.terminalizeCancellation(input),
  }
  const lifecycle = service('execution-before-dispatch', {
    coordinator,
    executor: { execute: async () => { throw new Error('runner must not start') } },
  })
  const started = await lifecycle.start(context.request)
  assert.equal(started.kind, 'accepted')
  if (started.kind !== 'accepted') throw new Error('expected accepted')
  await entered.promise
  const cancelled = await lifecycle.cancel(context.projectId, started.executionId)
  assert.equal(cancelled.kind, 'accepted')
  release.resolve()
  await started.completion
  assert.equal((await getDb().selectFrom('runs').selectAll().where('execution_id', '=', started.executionId).execute()).length, 0)
  assert.equal((await getDb().selectFrom('test_results').selectAll().where('run_id', 'like', '%before-dispatch%').execute()).length, 0)
  const status = await lifecycle.readStatus(context.projectId, started.executionId)
  assert.equal(status?.state, 'cancelled')
  assert.equal(status?.outcome, 'could_not_verify')
  assert.equal(status?.safeCode, 'cancelled_before_execution')
})

test('TD069B-C-F-3 cancellation after the first Result preserves it, stops before the next Result, and is idempotent', async () => {
  const context = await authority('after-first', 2)
  const secondEntered = deferred()
  const releaseSecond = deferred()
  let calls = 0
  const lifecycle = service('execution-after-first', {
    executor: { execute: async (_plan: unknown, _runtime: unknown, token: GovernedExecutionCancellationToken): Promise<PlaywrightPlanExecutionResult> => {
      calls++
      if (calls === 1) return { status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.invalid/inventory-1.html' }
      secondEntered.resolve()
      await releaseSecond.promise
      return token.isCancellationRequested()
        ? { status: 'cancelled', reasonCode: 'cancellation_requested' }
        : { status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.invalid/inventory-2.html' }
    } },
  })
  const started = await lifecycle.start(context.request)
  assert.equal(started.kind, 'accepted')
  if (started.kind !== 'accepted') throw new Error('expected accepted')
  await secondEntered.promise
  const first = await lifecycle.cancel(context.projectId, started.executionId)
  const second = await lifecycle.cancel(context.projectId, started.executionId)
  assert.deepEqual([first.kind, second.kind], ['accepted', 'accepted'])
  if (second.kind === 'accepted') assert.equal(second.alreadyRequested, true)
  releaseSecond.resolve()
  await started.completion
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', started.executionId).executeTakeFirstOrThrow()
  const results = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()
  const events = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', started.executionId).orderBy('id').execute()
  assert.equal(run.lifecycle, 'cancelled')
  assert.equal(run.status, 'passed')
  assert.equal(results.length, 1)
  assert.equal(results[0].status, 'passed')
  assert.deepEqual(events.map(event => event.event_type), ['started', 'cancellation_requested', 'terminal'])
  assert.deepEqual(events.map(event => event.lifecycle), ['accepted', 'cancellation_requested', 'cancelled'])
  assert.equal(events[2].outcome, 'could_not_verify')
  assert.equal(events[2].safe_code, 'cancelled_by_request')
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', started.executionId).execute()).length, 0)
  assert.equal((await lifecycle.readStatus(context.projectId, started.executionId))?.state, 'cancelled')
  assert.equal((await lifecycle.readStatus(context.projectId, started.executionId))?.state, 'cancelled')
})

test('TD069B-C-F-4 cancellation cannot interrupt Result persistence; completed evidence controls the cancelled aggregate', async () => {
  const context = await authority('during-result')
  const persisted = deferred()
  const release = deferred()
  const actual = new ExecutionRunCoordinator()
  const coordinator = {
    admitRun: (input: any) => actual.admitRun(input),
    recordResult: async (input: any) => { const result = await actual.recordResult(input); persisted.resolve(); await release.promise; return result },
    terminalize: (input: any) => actual.terminalize(input),
    terminalizeCancellation: (input: any) => actual.terminalizeCancellation(input),
  }
  const lifecycle = service('execution-during-result', {
    coordinator,
    executor: { execute: async () => ({ status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: 'https://example.invalid/login' }) },
  })
  const started = await lifecycle.start(context.request)
  assert.equal(started.kind, 'accepted')
  if (started.kind !== 'accepted') throw new Error('expected accepted')
  await persisted.promise
  assert.equal((await lifecycle.cancel(context.projectId, started.executionId)).kind, 'accepted')
  release.resolve()
  await started.completion
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', started.executionId).executeTakeFirstOrThrow()
  const results = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()
  const status = await lifecycle.readStatus(context.projectId, started.executionId)
  assert.equal(results.length, 1)
  assert.equal(results[0].status, 'failed')
  assert.equal(run.lifecycle, 'cancelled')
  assert.equal(run.status, 'failed')
  assert.equal(status?.state, 'cancelled')
  assert.equal(status?.outcome, 'failed')
  await assert.rejects(getDb().updateTable('test_results').set({ status: 'passed' }).where('id', '=', results[0].id).execute(), /immutable/i)
})

test('TD069B-C-F-5 terminal cancellation is atomic; rollback retains request/evidence/lock and recovery converges once', async () => {
  const context = await authority('rollback')
  const executionId = 'execution-cancel-rollback'
  await beginDirect(context, executionId)
  const repository = new ExecutionRepository()
  const coordinator = new ExecutionRunCoordinator()
  const run = await coordinator.admitRun({
    executionId, projectId: context.projectId, processInstanceId: OWNER, expectedResultCount: 1,
    runnerAdapter: 'playwright-plan-executor/v1', environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true },
    startedAt: '2026-08-10T20:00:01.000Z',
  })
  await coordinator.recordResult({
    executionId, runId: run.run_id, itemOrdinal: 1, plan: context.plans[0],
    observed: { status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.invalid/inventory-1.html' },
    startedAt: '2026-08-10T20:00:02.000Z', completedAt: '2026-08-10T20:00:03.000Z',
  })
  await repository.requestCancellation({
    projectId: context.projectId, executionId, requestProcessInstanceId: OWNER, requestedAt: '2026-08-10T20:00:04.000Z',
  })
  await sql.raw(`CREATE TRIGGER fail_cancel_terminal BEFORE INSERT ON execution_events WHEN NEW.execution_id = '${executionId}' AND NEW.event_type = 'terminal' BEGIN SELECT RAISE(ABORT, 'forced cancel terminal failure'); END`).execute(getDb())
  await assert.rejects(coordinator.terminalizeCancellation({
    executionId, projectId: context.projectId, processInstanceId: OWNER, runId: run.run_id,
    completedAt: '2026-08-10T20:00:05.000Z',
  }))
  assert.equal((await getDb().selectFrom('runs').selectAll().where('run_id', '=', run.run_id).executeTakeFirstOrThrow()).lifecycle, 'running')
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', executionId).execute()).length, 1)
  assert.equal((await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()).length, 1)
  await sql.raw('DROP TRIGGER fail_cancel_terminal').execute(getDb())
  const recovery = new ExecutionRecoveryCoordinator()
  const first = await recovery.reconcile({
    projectId: context.projectId, executionId, currentProcessInstanceId: 'process-recovery', locallyActive: false,
    now: '2026-08-11T00:00:00.000Z', staleAfterMs: 1,
  })
  const second = await recovery.reconcile({
    projectId: context.projectId, executionId, currentProcessInstanceId: 'process-recovery', locallyActive: false,
    now: '2026-08-11T00:00:01.000Z', staleAfterMs: 1,
  })
  assert.equal(first.status?.state, 'cancelled')
  assert.equal(first.status?.outcome, 'passed')
  assert.equal(second.action, 'already_terminal')
  assert.equal((await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', executionId).where('event_type', '=', 'terminal').execute()).length, 1)
})

test('TD069B-C-F-6 recovery keeps requested, cancelled, and interrupted distinct across healthy and stale ownership', async () => {
  const healthyContext = await authority('healthy')
  const healthyId = 'execution-cancel-healthy'
  await beginDirect(healthyContext, healthyId)
  const repository = new ExecutionRepository()
  await repository.requestCancellation({
    projectId: healthyContext.projectId, executionId: healthyId,
    requestProcessInstanceId: 'process-operator', requestedAt: '2026-08-10T20:00:01.000Z',
  })
  const recovery = new ExecutionRecoveryCoordinator()
  const healthy = await recovery.reconcile({
    projectId: healthyContext.projectId, executionId: healthyId, currentProcessInstanceId: 'process-other',
    locallyActive: false, now: '2026-08-10T20:00:02.000Z',
  })
  assert.equal(healthy.action, 'untouched_active')
  assert.equal(healthy.status?.state, 'cancellation_requested')
  const stale = await recovery.reconcile({
    projectId: healthyContext.projectId, executionId: healthyId, currentProcessInstanceId: 'process-other',
    locallyActive: false, now: '2026-08-11T00:00:00.000Z', staleAfterMs: 1,
  })
  assert.equal(stale.status?.state, 'cancelled')

  const interruptedContext = await authority('interrupted')
  const interruptedId = 'execution-already-interrupted'
  await beginDirect(interruptedContext, interruptedId, '2026-08-10T00:00:00.000Z')
  const interrupted = await recovery.reconcile({
    projectId: interruptedContext.projectId, executionId: interruptedId, currentProcessInstanceId: 'process-recovery',
    locallyActive: false, now: '2026-08-11T00:00:00.000Z', staleAfterMs: 1,
  })
  assert.equal(interrupted.status?.state, 'interrupted')
  const cancellation = await service('unused').cancel(interruptedContext.projectId, interruptedId)
  assert.equal(cancellation.kind, 'rejected')
  if (cancellation.kind === 'rejected') assert.equal(cancellation.code, 'execution_already_terminal')
  assert.equal((await new PersistedEvidenceAggregator().readStatus(interruptedContext.projectId, interruptedId))?.state, 'interrupted')

  const completedContext = await authority('completed')
  const completedService = service('execution-already-completed', {
    executor: { execute: async () => ({
      status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.invalid/inventory-1.html',
    }) },
  })
  const completedStart = await completedService.start(completedContext.request)
  assert.equal(completedStart.kind, 'accepted')
  if (completedStart.kind !== 'accepted') throw new Error('expected accepted')
  await completedStart.completion
  const completedCancel = await completedService.cancel(completedContext.projectId, completedStart.executionId)
  assert.equal(completedCancel.kind, 'rejected')
  if (completedCancel.kind === 'rejected') assert.equal(completedCancel.code, 'execution_already_terminal')
  assert.equal((await new PersistedEvidenceAggregator().readStatus(completedContext.projectId, completedStart.executionId))?.state, 'completed')
  assert.equal((await getDb().selectFrom('execution_events').selectAll()
    .where('execution_id', '=', completedStart.executionId).where('event_type', '=', 'cancellation_requested').execute()).length, 0)
})

test('TD069B-C-F-7 cancellation API returns 202 only for accepted intent and 409 for terminal execution', async () => {
  const original = executionContext.cancelProductExecution
  try {
    ;(executionContext as any).cancelProductExecution = async () => ({
      kind: 'accepted', state: 'cancellation_requested', requestedAt: BASE, alreadyRequested: false,
    })
    const accepted = await cancelExecution('api-project', 'execution-api', async () => ({ appName: 'api-project', url: 'https://example.invalid' }))
    assert.equal(accepted.status, 202)
    assert.equal((accepted.body as any).data.state, 'cancellation_requested')
    ;(executionContext as any).cancelProductExecution = async () => ({
      kind: 'rejected', code: 'execution_already_terminal', safeMessage: 'Already terminal.',
    })
    const terminal = await cancelExecution('api-project', 'execution-api', async () => ({ appName: 'api-project', url: 'https://example.invalid' }))
    assert.equal(terminal.status, 409)
    assert.equal((terminal.body as any).code, 'EXECUTION_ALREADY_TERMINAL')
  } finally {
    ;(executionContext as any).cancelProductExecution = original
  }
})
