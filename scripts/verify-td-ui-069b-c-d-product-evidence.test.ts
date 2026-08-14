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
import {
  DuplicateProductResultError,
  ExecutionRunCoordinator,
  ProductTerminalizationError,
  type ProductResultOutcome,
} from '../src/core/execution/ExecutionRunCoordinator'
import { ExecutionService, type GovernedExecutionStartRequest } from '../src/core/execution/ExecutionService'
import { projectExecutablePlan } from '../src/core/execution/ExecutionProjectionService'
import type { MaterializedExecutablePlan } from '../src/core/execution/ExecutablePlanContract'
import type { PlaywrightPlanExecutionResult } from '../src/core/execution/PlaywrightPlanExecutor'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import type { CanonicalTestDefinition, TestDesignAuthorityInput } from '../src/core/test-design/TestDefinitionContract'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-d-evidence-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const NOW = '2026-08-10T20:00:00.000Z'
const PROCESS = 'process-td069bcd'
const USER_ENV = 'SAUCEDEMO_USERNAME'
const PASSWORD_ENV = 'SAUCEDEMO_PASSWORD'

interface Authority {
  projectId: string
  modelRowId: number
  definition: CanonicalTestDefinition
  testSetId: string
  plan: MaterializedExecutablePlan
  request: GovernedExecutionStartRequest
}

async function authority(suffix: string): Promise<Authority> {
  const projectId = `product-${suffix}`
  const observationId = `observation-${suffix}`
  const evidenceId = `evidence-${suffix}`
  const inserted = await getDb().insertInto('app_models').values({
    app_name: projectId, version: '1.0.0', base_url: 'https://example.invalid', app_type: 'web',
    intake_mode: 'crawl', crawl_config_hash: 'a'.repeat(64), page_count: 1, flow_count: 0, role_count: 1,
    model_json: '{}', crawled_at: NOW, crawled_by: 'engine', status: 'active', evidence_state: 'crawled',
    operation_id: null, candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  const modelRowId = Number(inserted.id)
  const input: TestDesignAuthorityInput = {
    projectId,
    sourceObservation: {
      id: observationId, outcome: 'completed', authenticationOutcome: 'succeeded',
      authenticationExpectation: 'form-login',
      credentialReference: { usernameEnv: USER_ENV, passwordEnv: PASSWORD_ENV },
      subjectIds: [`subject-${suffix}`],
    },
    model: {
      rowId: modelRowId, version: '1.0.0', sourceObservationId: observationId,
      validation: 'valid', integrity: 'not_evaluated',
      subjects: [{ id: `subject-${suffix}`, routePath: '/inventory.html', evidenceId }],
    },
    evidence: [{
      id: evidenceId, canonicalSubjectId: `subject-${suffix}`, routePath: '/inventory.html',
      sourceObservationId: observationId, sourceModelRows: [modelRowId], support: 'current',
      integrity: 'not_evaluated', freshness: 'not_evaluated', access: 'available', conflict: 'not_evaluated',
    }],
    generatedAt: NOW,
  }
  const generated = await new TestSetService(new TestSetRepository(), () => NOW)
    .generate(input, `generation-${suffix}`)
  const definition = generated.testSet.definitions[0]
  const projected = projectExecutablePlan({
    definition,
    definitionTestSetId: generated.testSet.testSetId,
    definitionRevision: 1,
  }, {
    currentRevision: { testSetId: generated.testSet.testSetId, revision: 1 },
    sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
    model: { rowId: modelRowId, version: '1.0.0' },
    currentSupportEvidenceIds: [evidenceId],
  }, NOW)
  assert.equal(projected.kind, 'ok')
  if (projected.kind !== 'ok') throw new Error('expected projection')
  return {
    projectId,
    modelRowId,
    definition,
    testSetId: generated.testSet.testSetId,
    plan: projected.plan,
    request: {
      projectId,
      definitionIds: [definition.id],
      revision: 1,
      preflightState: 'ready',
      projectionAuthority: {
        sourceObservation: { id: observationId, authenticationExpectation: 'form-login', authenticationOutcome: 'succeeded' },
        model: { rowId: modelRowId, version: '1.0.0' },
        currentSupportEvidenceIds: [evidenceId],
      },
      runtime: { baseUrl: 'https://example.invalid', loginUrl: 'https://example.invalid' },
    },
  }
}

function service(
  executionId: string,
  result: PlaywrightPlanExecutionResult | Error,
  executeCounter?: { count: number },
): ExecutionService {
  let tick = 0
  return new ExecutionService({
    v1ExecutionPolicy: 'historical_compatibility',
    credentials: new EnvironmentCredentialExecutionScope({
      SAUCEDEMO_USERNAME: 'fixture-user', SAUCEDEMO_PASSWORD: 'fixture-password',
    }),
    executor: { execute: async () => {
      if (executeCounter) executeCounter.count++
      if (result instanceof Error) throw result
      return result
    } },
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'Disposable runner available.' }),
    migrate: async () => undefined,
    now: () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString(),
    mintExecutionId: () => executionId,
    processInstanceId: PROCESS,
  })
}

async function startAndWait(
  suffix: string,
  result: PlaywrightPlanExecutionResult | Error,
  counter?: { count: number },
): Promise<{ authority: Authority; executionId: string; lifecycle: ExecutionService }> {
  const context = await authority(suffix)
  const executionId = `execution-${suffix}`
  const lifecycle = service(executionId, result, counter)
  const accepted = await lifecycle.start(context.request)
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  await accepted.completion
  return { authority: context, executionId, lifecycle }
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-C-D-1 Migration 022 installs exact Product evidence immutability guards', async () => {
  const names = new Set((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'trigger'`.execute(getDb())).rows.map(row => row.name))
  for (const name of ['product_result_immutable_update', 'product_result_immutable_delete', 'product_run_admission_immutable', 'product_run_immutable_delete']) {
    assert.equal(names.has(name), true)
  }
  const history = await getDb().selectFrom('kysely_migration' as any).select('name' as any).execute() as Array<{ name: string }>
  assert.equal(history.filter(row => row.name === '022_product_execution_evidence_guards').length, 1)
  await runMigrations()
  const rerun = await getDb().selectFrom('kysely_migration' as any).select('name' as any).execute() as Array<{ name: string }>
  assert.equal(rerun.filter(row => row.name === '022_product_execution_evidence_guards').length, 1)
})

test('TD069B-C-D-2 Run admission is atomic, precedes Playwright, and records the bounded environment snapshot', async () => {
  const context = await authority('admission')
  const counter = { count: 0 }
  await sql.raw(`CREATE TRIGGER fail_product_admission BEFORE INSERT ON runs WHEN NEW.execution_id = 'execution-admission' BEGIN SELECT RAISE(ABORT, 'forced admission failure'); END`).execute(getDb())
  const lifecycle = service('execution-admission', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example' }, counter)
  const accepted = await lifecycle.start(context.request)
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  await accepted.completion
  assert.equal(counter.count, 0)
  assert.equal((await getDb().selectFrom('runs').selectAll().where('execution_id', '=', 'execution-admission').execute()).length, 0)
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-admission').execute()).length, 1)
  await sql.raw('DROP TRIGGER fail_product_admission').execute(getDb())

  const completed = await startAndWait('admitted', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example/inventory.html' })
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', completed.executionId).executeTakeFirstOrThrow()
  assert.notEqual(run.run_id, completed.executionId)
  assert.equal(run.origin, 'product')
  assert.equal(run.attempt_ordinal, 1)
  assert.equal(run.total_tests, 1)
  assert.equal(run.reporter_version, 'playwright-plan-executor/v1')
  assert.equal(run.environment, 'local')
  assert.deepEqual(JSON.parse(run.metadata), { schemaVersion: 1, browser: 'chromium', headless: true })
  assert.equal(run.base_url, '')
})

test('TD069B-C-D-3 passed, failed, and could_not_verify are persisted from structured observed truth', async () => {
  const cases: Array<[string, PlaywrightPlanExecutionResult, ProductResultOutcome]> = [
    ['pass', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example/inventory.html' }, 'passed'],
    ['fail', { status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: 'https://unsafe.example/login' }, 'failed'],
    ['unverified', { status: 'authentication_failed', reasonCode: 'authentication_failed' }, 'could_not_verify'],
  ]
  for (const [suffix, observed, expected] of cases) {
    const completed = await startAndWait(suffix, observed)
    const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', completed.executionId).executeTakeFirstOrThrow()
    const results = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()
    const terminal = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', completed.executionId).where('event_type', '=', 'terminal').executeTakeFirstOrThrow()
    assert.equal(results.length, 1)
    assert.equal(results[0].status, expected)
    assert.equal(run.status, expected)
    assert.equal(run.lifecycle, 'completed')
    assert.equal(terminal.outcome, expected)
    assert.equal((await completed.lifecycle.readStatus(completed.authority.projectId, completed.executionId))?.state, 'completed')
    assert.equal((await completed.lifecycle.readStatus(completed.authority.projectId, completed.executionId))?.outcome, expected)
    assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', completed.executionId).execute()).length, 0)
  }
})

test('TD069B-C-D-4 Product Result identity is unique and the complete evidence row is immutable', async () => {
  const completed = await startAndWait('immutable', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example/inventory.html' })
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', completed.executionId).executeTakeFirstOrThrow()
  const result = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).executeTakeFirstOrThrow()
  await assert.rejects(getDb().updateTable('test_results').set({ status: 'failed' }).where('id', '=', result.id).execute(), /immutable/i)
  await assert.rejects(getDb().deleteFrom('test_results').where('id', '=', result.id).execute(), /immutable/i)
  await assert.rejects(getDb().updateTable('runs').set({ total_tests: 2 }).where('id', '=', run.id).execute(), /immutable/i)
  await assert.rejects(getDb().deleteFrom('runs').where('id', '=', run.id).execute(), /immutable/i)
})

test('TD069B-C-D-5 duplicate Result append is rejected and cannot overwrite the first observation', async () => {
  const context = await authority('duplicate-result')
  const repository = new ExecutionRepository()
  await repository.beginExecution({
    executionId: 'execution-duplicate-result', projectId: context.projectId, processInstanceId: PROCESS,
    startedAt: NOW, executionPlanHash: context.plan.fingerprint,
    expectedTestSetId: context.testSetId, expectedRevision: 1, expectedModelRowId: context.modelRowId,
    expectedModelVersion: '1.0.0', sourceObservationId: 'observation-duplicate-result',
    manifestItems: [{ itemOrdinal: 1, definitionId: context.definition.id, executablePlanHash: context.plan.fingerprint }],
  })
  const coordinator = new ExecutionRunCoordinator()
  const run = await coordinator.admitRun({
    executionId: 'execution-duplicate-result', projectId: context.projectId, processInstanceId: PROCESS,
    expectedResultCount: 1, runnerAdapter: 'playwright-plan-executor/v1',
    environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true }, startedAt: NOW,
  })
  const observation = {
    executionId: 'execution-duplicate-result', runId: run.run_id, itemOrdinal: 1, plan: context.plan,
    observed: { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example' } as const,
    startedAt: NOW, completedAt: '2026-08-10T20:00:01.000Z',
  }
  const first = await coordinator.recordResult(observation)
  await assert.rejects(coordinator.recordResult(observation), DuplicateProductResultError)
  const persisted = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].result_id, first.result_id)
  await coordinator.terminalize({
    executionId: 'execution-duplicate-result', projectId: context.projectId, processInstanceId: PROCESS,
    runId: run.run_id, completedAt: '2026-08-10T20:00:02.000Z',
  })
})

test('TD069B-C-D-6 crash before Result leaves no Result and requires recovery without fabricated terminal truth', async () => {
  const crashed = await startAndWait('crash-before', new Error('unsafe browser exception'))
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', crashed.executionId).executeTakeFirstOrThrow()
  assert.equal((await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()).length, 0)
  assert.equal(run.lifecycle, 'running')
  assert.equal((await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', crashed.executionId).where('event_type', '=', 'terminal').execute()).length, 0)
  const status = await crashed.lifecycle.readStatus(crashed.authority.projectId, crashed.executionId)
  assert.equal(status?.state, 'interrupted')
  assert.equal(status?.safeCode, 'interrupted_before_result')
  const recoveredRun = await getDb().selectFrom('runs').selectAll().where('run_id', '=', run.run_id).executeTakeFirstOrThrow()
  assert.equal(recoveredRun.lifecycle, 'interrupted')
  assert.equal(recoveredRun.status, 'unknown')
  assert.equal((await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', crashed.executionId).where('event_type', '=', 'terminal').execute()).length, 1)
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', crashed.executionId).execute()).length, 0)
  await assert.rejects(new ExecutionRunCoordinator().terminalize({
    executionId: crashed.executionId, projectId: crashed.authority.projectId, processInstanceId: PROCESS,
    runId: run.run_id, completedAt: '2026-08-10T20:00:20.000Z',
  }), ProductTerminalizationError)
})

test('TD069B-C-D-7 terminal transaction rollback preserves the Result and rolls back Run/event/lock changes', async () => {
  const context = await authority('terminal-rollback')
  await sql.raw(`CREATE TRIGGER fail_product_terminal BEFORE INSERT ON execution_events WHEN NEW.execution_id = 'execution-terminal-rollback' AND NEW.event_type = 'terminal' BEGIN SELECT RAISE(ABORT, 'forced terminal failure'); END`).execute(getDb())
  const lifecycle = service('execution-terminal-rollback', { status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example' })
  const accepted = await lifecycle.start(context.request)
  assert.equal(accepted.kind, 'accepted')
  if (accepted.kind !== 'accepted') throw new Error('expected acceptance')
  await accepted.completion
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', 'execution-terminal-rollback').executeTakeFirstOrThrow()
  assert.equal((await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).execute()).length, 1)
  assert.equal(run.lifecycle, 'running')
  assert.equal(run.status, 'unknown')
  assert.equal((await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', 'execution-terminal-rollback').where('event_type', '=', 'terminal').execute()).length, 0)
  assert.equal((await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', 'execution-terminal-rollback').execute()).length, 1)
  await sql.raw('DROP TRIGGER fail_product_terminal').execute(getDb())
  const aggregate = await new ExecutionRunCoordinator().terminalize({
    executionId: 'execution-terminal-rollback', projectId: context.projectId, processInstanceId: PROCESS,
    runId: run.run_id, completedAt: '2026-08-10T20:00:30.000Z',
  })
  assert.equal(aggregate.runOutcome, 'passed')
  assert.equal(aggregate.executionOutcome, 'passed')
})

test('TD069B-C-D-8 Product persistence contains safe codes only and ignores executor URLs and credential values', async () => {
  const secret = 'must-not-persist-td069bcd'
  const completed = await startAndWait('secret-boundary', {
    status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: `https://example.invalid/${secret}`,
  })
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', completed.executionId).executeTakeFirstOrThrow()
  const result = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).executeTakeFirstOrThrow()
  const events = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', completed.executionId).execute()
  const persisted = JSON.stringify({ run, result, events })
  assert.doesNotMatch(persisted, new RegExp(secret, 'i'))
  assert.doesNotMatch(persisted, /fixture-password|username|password|cookie|token|storageState/i)
  assert.equal(result.error_msg, 'oracle_failed')
  assert.equal(result.metadata, '{}')
  assert.equal(result.screenshot_path, null)
  assert.equal(result.video_path, null)
})

test('TD069B-C-D-9 ExecutionService orders admission, execution, Result append, and terminalization across the SQL-free runner boundary', () => {
  const serviceSource = fs.readFileSync(path.resolve('src/core/execution/ExecutionService.ts'), 'utf8')
  const executorSource = fs.readFileSync(path.resolve('src/core/execution/PlaywrightPlanExecutor.ts'), 'utf8')
  const admission = serviceSource.indexOf('this.coordinator.admitRun')
  const execute = serviceSource.indexOf('this.executor.execute')
  const result = serviceSource.indexOf('this.coordinator.recordResult')
  const terminal = serviceSource.indexOf('this.coordinator.terminalize({', result)
  assert.ok(admission > 0 && admission < execute && execute < result && result < terminal)
  assert.doesNotMatch(executorSource, /getDb|insertInto|updateTable|deleteFrom|ExecutionRepository|RunRepository|TestResultRepository/)
})
