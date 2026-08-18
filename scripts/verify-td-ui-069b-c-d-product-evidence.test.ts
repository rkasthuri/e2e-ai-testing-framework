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
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { certifyCanonicalResultDetailGuards, runMigrations } from '../src/core/storage/migrate'
import { down as migrate029Down } from '../src/core/storage/migrations/029_canonical_result_detail_evidence'
import { getDatabaseProvenance } from '../src/core/storage/db'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
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
import { ExecutionResultProjectionService } from '../src/core/execution/ExecutionResultProjectionService'
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

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

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
      executionIntentKey: `intent-${suffix}`,
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

async function admitWithoutResult(suffix: string): Promise<{ authority: Authority; executionId: string; runId: string }> {
  const context = await authority(suffix)
  const executionId = `execution-${suffix}`
  await new ExecutionRepository().beginExecution({
    executionId, projectId: context.projectId, processInstanceId: PROCESS,
    executionIntentKey: `intent-direct-${suffix}`, executionIntentFingerprint: context.plan.fingerprint,
    startedAt: NOW, executionPlanHash: context.plan.fingerprint,
    expectedTestSetId: context.testSetId, expectedRevision: 1, expectedModelRowId: context.modelRowId,
    expectedModelVersion: '1.0.0', sourceObservationId: `observation-${suffix}`,
    manifestItems: [{
      itemOrdinal: 1, definitionId: context.definition.id, executablePlanHash: context.plan.fingerprint,
      oracleKind: context.plan.value.oracle.kind, oracleSubjectId: context.plan.value.oracle.subjectId,
    }],
  })
  const run = await new ExecutionRunCoordinator().admitRun({
    executionId, projectId: context.projectId, processInstanceId: PROCESS,
    expectedResultCount: 1, runnerAdapter: 'playwright-plan-executor/v1',
    environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true }, startedAt: NOW,
  })
  return { authority: context, executionId, runId: run.run_id }
}

async function directResult(input: {
  id: string
  runId: string
  definitionId: string
  planHash: string
  status: string
  reason: string | null
  oracleKind: string | null
  subjectId: string | null
}): Promise<void> {
  await getDb().insertInto('test_results').values({
    run_id: input.runId, test_id: input.definitionId, title: input.definitionId,
    suite: 'product-execution', status: input.status, duration_ms: 1, retry_count: 0,
    error_msg: input.reason, browser: 'chromium', tier: 'ui', started_at: NOW,
    worker_index: 0, tags: '[]', flaky_history: 0, screenshot_path: null, video_path: null,
    metadata: '{}', result_id: input.id, execution_item_ordinal: 1,
    definition_id: input.definitionId, executable_plan_hash: input.planHash,
    oracle_kind: input.oracleKind, observed_subject_id: input.subjectId,
  } as any).execute()
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
  assert.equal(rerun.filter(row => row.name === '029_canonical_result_detail_evidence').length, 1)
  const resultColumns = new Set((await sql<{ name: string }>`PRAGMA table_info(test_results)`.execute(getDb())).rows.map(row => row.name))
  assert.equal(resultColumns.has('oracle_kind'), true)
  assert.equal(resultColumns.has('observed_subject_id'), true)
  assert.equal((await sql<{ quick_check: string }>`PRAGMA quick_check`.execute(getDb())).rows[0].quick_check, 'ok')
  assert.equal((await sql`PRAGMA foreign_key_check`.execute(getDb())).rows.length, 0)
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
    const oracleReached = observed.status === 'completed' || observed.status === 'oracle_failed'
    assert.equal(results[0].oracle_kind, oracleReached ? 'subject_observable' : null)
    assert.equal(results[0].observed_subject_id, oracleReached ? completed.authority.plan.value.oracle.subjectId : null)
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
  await assert.rejects(
    getDb().updateTable('test_results').set({ observed_subject_id: 'subject-other' }).where('id', '=', result.id).execute(),
    /immutable/i,
  )
  await assert.rejects(getDb().updateTable('runs').set({ total_tests: 2 }).where('id', '=', run.id).execute(), /immutable/i)
  await assert.rejects(getDb().deleteFrom('runs').where('id', '=', run.id).execute(), /immutable/i)
})

test('TD-PRODUCT-001-C direct SQL rejects malformed or legacy canonical Result detail', async () => {
  const completed = await startAndWait('detail-guards', {
    status: 'completed', reasonCode: 'completed', finalUrl: 'https://unsafe.example/inventory.html',
  })
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', completed.executionId).executeTakeFirstOrThrow()
  const result = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).executeTakeFirstOrThrow()
  const legacyRunId = 'legacy-detail-guard'
  await getDb().insertInto('runs').values({
    run_id: legacyRunId, app_name: completed.authority.projectId, branch: 'main', commit_sha: 'unknown',
    environment: 'local', base_url: '', triggered_by: 'test', reporter_version: 'legacy',
    status: 'passed', total_tests: 1, passed: 1, failed: 0, skipped: 0, duration_ms: 1,
    started_at: NOW, completed_at: NOW, metadata: '{}', input_health: 'unknown',
    input_health_reason: null, lifecycle: 'completed', execution_id: null, origin: 'legacy', attempt_ordinal: null,
  }).execute()
  const legacyRow = {
    run_id: legacyRunId, test_id: 'legacy-test', title: 'legacy', suite: 'legacy', status: 'passed',
    duration_ms: 1, retry_count: 0, error_msg: null, browser: 'chromium', tier: 'ui',
    started_at: NOW, worker_index: 0, tags: '[]', flaky_history: 0, screenshot_path: null,
    video_path: null, metadata: '{}', result_id: null, execution_item_ordinal: null,
    definition_id: null, executable_plan_hash: null,
  }
  await assert.rejects(
    getDb().insertInto('test_results').values({
      ...legacyRow, oracle_kind: 'subject_observable', observed_subject_id: 'subject-illicit',
    }).execute(),
    /Legacy Result cannot claim canonical detail/,
  )
  await getDb().insertInto('test_results').values(legacyRow).execute()
  const preservedLegacy = await getDb().selectFrom('test_results').selectAll()
    .where('run_id', '=', legacyRunId).executeTakeFirstOrThrow()
  assert.equal(preservedLegacy.oracle_kind, null)
  assert.equal(preservedLegacy.observed_subject_id, null)
  await assert.rejects(
    sql.raw(`INSERT INTO test_results (
      run_id,test_id,title,suite,status,duration_ms,retry_count,error_msg,browser,tier,started_at,
      worker_index,tags,flaky_history,screenshot_path,video_path,metadata,result_id,
      execution_item_ordinal,definition_id,executable_plan_hash,oracle_kind,observed_subject_id
    ) SELECT run_id,test_id,title,suite,status,duration_ms,retry_count,error_msg,browser,tier,started_at,
      worker_index,tags,flaky_history,screenshot_path,video_path,metadata,'result-malformed',
      execution_item_ordinal,definition_id,executable_plan_hash,'subject_observable',NULL
      FROM test_results WHERE id = ${result.id}`).execute(getDb()),
    /detail is incomplete/,
  )
  await assert.rejects(
    sql.raw(`INSERT INTO test_results (
      run_id,test_id,title,suite,status,duration_ms,retry_count,error_msg,browser,tier,started_at,
      worker_index,tags,flaky_history,screenshot_path,video_path,metadata,result_id,
      execution_item_ordinal,definition_id,executable_plan_hash,oracle_kind,observed_subject_id
    ) SELECT run_id,test_id,title,suite,status,duration_ms,retry_count,error_msg,browser,tier,started_at,
      worker_index,tags,flaky_history,screenshot_path,video_path,metadata,'result-invalid-oracle',
      execution_item_ordinal,definition_id,executable_plan_hash,'raw_selector','subject-safe'
      FROM test_results WHERE id = ${result.id}`).execute(getDb()),
    /CHECK constraint|malformed|disagrees with immutable execution authority/i,
  )
})

test('TD-PRODUCT-001-C-R1 SQLite binds performed-oracle detail to immutable execution-item authority', async () => {
  const primary = await admitWithoutResult('r1-primary')
  const other = await authority('r1-other-workspace')
  const base = {
    runId: primary.runId,
    definitionId: primary.authority.definition.id,
    planHash: primary.authority.plan.fingerprint,
    oracleKind: 'subject_observable',
    subjectId: primary.authority.plan.value.oracle.subjectId,
  }
  for (const [suffix, status, reason] of [
    ['navigation', 'could_not_verify', 'navigation_failed'],
    ['authentication', 'could_not_verify', 'authentication_failed'],
    ['unsupported', 'could_not_verify', 'unsupported_plan'],
    ['executor', 'could_not_verify', 'executor_failure'],
    ['cancellation', 'could_not_verify', 'cancellation_requested'],
  ] as const) {
    await assert.rejects(directResult({ ...base, id: `result-r1-${suffix}`, status, reason }), /oracle was not performed/)
  }
  await assert.rejects(directResult({
    ...base, id: 'result-r1-null-reason', status: 'passed', reason: null,
  }), /oracle was not performed/)
  await assert.rejects(directResult({
    ...base, id: 'result-r1-rogue', status: 'passed', reason: 'completed', subjectId: 'subject-valid-but-rogue',
  }), /disagrees with immutable execution authority/)
  await assert.rejects(directResult({
    ...base, id: 'result-r1-other-workspace', status: 'failed', reason: 'oracle_failed',
    subjectId: other.plan.value.oracle.subjectId,
  }), /disagrees with immutable execution authority/)
  await assert.rejects(directResult({
    ...base, id: 'result-r1-pair', status: 'passed', reason: 'completed', subjectId: null,
  }), /detail is incomplete/)
  await assert.rejects(directResult({
    ...base, id: 'result-r1-enum', status: 'passed', reason: 'completed', oracleKind: 'raw_selector',
  }), /CHECK constraint|malformed|disagrees with immutable execution authority/i)
  await assert.rejects(directResult({
    ...base, id: 'result-r1-unsafe', status: 'passed', reason: 'completed', subjectId: '../unsafe',
  }), /malformed|disagrees with immutable execution authority/i)

  await directResult({ ...base, id: 'result-r1-valid-completed', status: 'passed', reason: 'completed' })
  const accepted = await getDb().selectFrom('test_results').selectAll().where('result_id', '=', 'result-r1-valid-completed').executeTakeFirstOrThrow()
  assert.equal(accepted.observed_subject_id, primary.authority.plan.value.oracle.subjectId)
  await assert.rejects(getDb().updateTable('test_results').set({ observed_subject_id: 'subject-other' }).where('id', '=', accepted.id).execute(), /immutable/i)
  await assert.rejects(getDb().deleteFrom('test_results').where('id', '=', accepted.id).execute(), /immutable/i)

  const failed = await admitWithoutResult('r1-oracle-failed')
  await directResult({
    id: 'result-r1-valid-oracle-failed', runId: failed.runId,
    definitionId: failed.authority.definition.id, planHash: failed.authority.plan.fingerprint,
    status: 'failed', reason: 'oracle_failed', oracleKind: 'subject_observable',
    subjectId: failed.authority.plan.value.oracle.subjectId,
  })
})

test('TD-PRODUCT-001-C projection allowlists bounded oracle detail and preserves absence', async () => {
  const observed = await startAndWait('detail-projection', {
    status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: 'https://unsafe.example/login',
  })
  const observedRead = await new ExecutionResultProjectionService().read(observed.authority.projectId, observed.executionId)
  assert.equal(observedRead.kind, 'ok')
  if (observedRead.kind !== 'ok') throw new Error('expected observed projection')
  const evidence = observedRead.projection.items[0].result
  assert.equal(evidence.state, 'result_observed')
  if (evidence.state !== 'result_observed') throw new Error('expected observed Result')
  assert.equal(evidence.oracleKind, 'subject_observable')
  assert.equal(evidence.observedSubjectId, observed.authority.plan.value.oracle.subjectId)
  assert.equal(evidence.safeMessage, null)

  const notReached = await startAndWait('detail-not-reached', {
    status: 'navigation_failed', reasonCode: 'navigation_failed',
  })
  const notReachedRead = await new ExecutionResultProjectionService().read(notReached.authority.projectId, notReached.executionId)
  assert.equal(notReachedRead.kind, 'ok')
  if (notReachedRead.kind !== 'ok') throw new Error('expected not-reached projection')
  const unavailable = notReachedRead.projection.items[0].result
  assert.equal(unavailable.state === 'result_observed' ? unavailable.oracleKind : 'missing', null)
  assert.equal(unavailable.state === 'result_observed' ? unavailable.observedSubjectId : 'missing', null)
})

test('TD-PRODUCT-001-C-R1 migration inspector behaviorally rejects no-op performed and subject guards', async () => {
  for (const name of ['canonical_result_detail_performed_insert', 'canonical_result_detail_subject_insert']) {
    const trigger = await sql<{ definition: string }>`
      SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ${name}
    `.execute(getDb())
    const original = trigger.rows[0]?.definition
    assert.ok(original)
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON test_results WHEN 0 BEGIN SELECT 1; END`).execute(getDb())
    assert.equal(await certifyCanonicalResultDetailGuards(getDb()), false)
    await assert.rejects(runMigrations(), /semantic persistence guards are incomplete/)
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(original).execute(getDb())
    await runMigrations()
  }
})

test('TD-PRODUCT-001-C-R3 routine restart rejects every token-preserving inert Migration 029 guard family', async () => {
  const inert = new Map<string, { replacement: string; category: string }>([
    ['canonical_result_detail_performed_insert', `
      CREATE TRIGGER canonical_result_detail_performed_insert
      BEFORE INSERT ON test_results
      WHEN 0
      BEGIN
        SELECT CASE WHEN NEW.status IS 'passed' AND NEW.error_msg IS 'completed' THEN 1 END;
        SELECT CASE WHEN NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed' THEN 1 END;
      END
    `],
    ['canonical_result_detail_subject_insert', `
      CREATE TRIGGER canonical_result_detail_subject_insert
      BEFORE INSERT ON test_results
      WHEN 0
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM runs r JOIN execution_items i
            ON i.execution_id = r.execution_id
          WHERE i.oracle_kind = NEW.oracle_kind
            AND i.oracle_subject_id = NEW.observed_subject_id
        ) THEN 1 END;
      END
    `],
    ['canonical_result_detail_insert', `
      CREATE TRIGGER canonical_result_detail_insert
      BEFORE INSERT ON test_results
      WHEN 0
      BEGIN
        SELECT CASE WHEN NEW.result_id IS NULL
          AND (NEW.oracle_kind IS NOT NULL OR NEW.observed_subject_id IS NOT NULL) THEN 1 END;
        SELECT CASE WHEN NEW.result_id IS NOT NULL
          AND ((NEW.oracle_kind IS NULL) <> (NEW.observed_subject_id IS NULL)) THEN 1 END;
        SELECT CASE WHEN NEW.oracle_kind IS NOT 'subject_observable'
          OR length(NEW.observed_subject_id) > 255 THEN 1 END;
      END
    `],
    ['canonical_result_detail_legacy_update', `
      CREATE TRIGGER canonical_result_detail_legacy_update
      BEFORE UPDATE OF oracle_kind, observed_subject_id ON test_results
      WHEN 0
      BEGIN
        SELECT CASE WHEN OLD.result_id IS NULL
          AND (NEW.oracle_kind IS NOT NULL OR NEW.observed_subject_id IS NOT NULL) THEN 1 END;
      END
    `],
    ['canonical_execution_item_oracle_insert', `
      CREATE TRIGGER canonical_execution_item_oracle_insert
      BEFORE INSERT ON execution_items
      WHEN 0
      BEGIN
        SELECT CASE WHEN (NEW.oracle_kind IS NULL) <> (NEW.oracle_subject_id IS NULL) THEN 1 END;
        SELECT CASE WHEN NEW.oracle_kind IS NOT 'subject_observable'
          OR length(NEW.oracle_subject_id) > 255 THEN 1 END;
      END
    `],
  ].map(([name, replacement]) => [name, {
    replacement,
    category: name.includes('performed')
      ? 'performed_oracle'
      : name.includes('subject_insert')
        ? 'subject_binding'
        : name === 'canonical_result_detail_insert'
          ? 'legacy_insert'
          : name.includes('legacy_update')
            ? 'legacy_update'
            : 'execution_item_authority',
  }]))
  for (const [name, adversary] of inert) {
    const trigger = await sql<{ definition: string }>`
      SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ${name}
    `.execute(getDb())
    const original = trigger.rows[0]?.definition
    assert.ok(original)
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(adversary.replacement).execute(getDb())
    const weakenedSourceHash = hashFile(DB_PATH)
    try {
      await assert.rejects(
        runMigrations(),
        new RegExp(`029_canonical_result_detail_evidence.*${adversary.category} semantic persistence guard could not be established on a disposable snapshot`, 'i'),
      )
      assert.equal(hashFile(DB_PATH), weakenedSourceHash)
    } finally {
      await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
      await sql.raw(original).execute(getDb())
    }
    await runMigrations()
  }
})

test('TD-PRODUCT-001-C-R4 routine restart rejects token-preserving performed-oracle pairing weakenings', async () => {
  const name = 'canonical_result_detail_performed_insert'
  const trigger = await sql<{ definition: string }>`
    SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ${name}
  `.execute(getDb())
  const original = trigger.rows[0]?.definition
  assert.ok(original)
  const weakenings = [
    {
      label: 'status/reason set membership without exact pairing',
      allowed: `(NEW.status IS 'passed' OR NEW.status IS 'failed')
        AND (NEW.error_msg IS 'completed' OR NEW.error_msg IS 'oracle_failed')`,
    },
    {
      label: 'exact pairs plus could-not-verify performed reason',
      allowed: `(NEW.status IS 'passed' AND NEW.error_msg IS 'completed')
        OR (NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed')
        OR (NEW.status IS 'could_not_verify' AND NEW.error_msg IS 'completed')`,
    },
    {
      label: 'enforcement special-cased to the former deterministic probe prefix',
      allowed: `(NEW.status IS 'passed' AND NEW.error_msg IS 'completed')
        OR (NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed')
        OR NEW.result_id NOT LIKE 'forge-m029-inspector-%'`,
    },
  ] as const
  for (const weakening of weakenings) {
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(`
      CREATE TRIGGER canonical_result_detail_performed_insert
      BEFORE INSERT ON test_results
      WHEN NEW.result_id IS NOT NULL AND NEW.oracle_kind IS NOT NULL AND NEW.observed_subject_id IS NOT NULL
        AND NOT (${weakening.allowed})
      BEGIN
        SELECT CASE WHEN NEW.status IS 'passed' AND NEW.error_msg IS 'completed' THEN 1 END;
        SELECT CASE WHEN NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed' THEN 1 END;
        SELECT RAISE(ABORT, 'Canonical Result oracle was not performed');
      END
    `).execute(getDb())
    const weakenedSourceHash = hashFile(DB_PATH)
    try {
      await assert.rejects(
        runMigrations(),
        /029_canonical_result_detail_evidence.*performed_oracle semantic persistence guard could not be established on a disposable snapshot/i,
        weakening.label,
      )
      assert.equal(hashFile(DB_PATH), weakenedSourceHash)
    } finally {
      await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
      await sql.raw(original).execute(getDb())
    }
  }
  await runMigrations()
})

test('TD-PRODUCT-001-C-R4 routine restart rejects token-preserving weakened subject ownership joins', async () => {
  const name = 'canonical_result_detail_subject_insert'
  const trigger = await sql<{ definition: string }>`
    SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ${name}
  `.execute(getDb())
  const original = trigger.rows[0]?.definition
  assert.ok(original)
  const weakenings = [
    {
      label: 'same-execution subject existence',
      where: `r.run_id = NEW.run_id
          AND i.execution_id = r.execution_id
          AND i.oracle_kind = NEW.oracle_kind
          AND i.oracle_subject_id = NEW.observed_subject_id`,
    },
    {
      label: 'global subject existence',
      where: `i.oracle_kind = NEW.oracle_kind
          AND i.oracle_subject_id = NEW.observed_subject_id`,
    },
  ] as const
  for (const weakening of weakenings) {
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(`
      CREATE TRIGGER canonical_result_detail_subject_insert
      BEFORE INSERT ON test_results
      WHEN NEW.result_id IS NOT NULL AND NEW.oracle_kind IS NOT NULL AND NEW.observed_subject_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM runs r JOIN execution_items i
            ON i.execution_id = r.execution_id
          WHERE ${weakening.where}
        )
      BEGIN SELECT RAISE(ABORT, 'Canonical Result oracle detail disagrees with immutable execution authority'); END
    `).execute(getDb())
    const weakenedSourceHash = hashFile(DB_PATH)
    try {
      await assert.rejects(
        runMigrations(),
        /029_canonical_result_detail_evidence.*subject_binding semantic persistence guard could not be established on a disposable snapshot/i,
        weakening.label,
      )
      assert.equal(hashFile(DB_PATH), weakenedSourceHash)
    } finally {
      await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
      await sql.raw(original).execute(getDb())
    }
  }
  await runMigrations()
})

test('TD-PRODUCT-001-C-R3 bounds snapshot setup and cleanup failures without changing the source database', async () => {
  let setupSnapshot: string | null = null
  let sourceHash = hashFile(DB_PATH)
  await assert.rejects(
    runMigrations({
      migration029SnapshotVerificationFault: 'setup',
      migration029SnapshotObserver: snapshotRoot => { setupSnapshot = snapshotRoot },
    }),
    (error: unknown) => error instanceof Error
      && error.name === 'MigrationStateMismatchError'
      && /029_canonical_result_detail_evidence.*snapshot_setup semantic persistence guard/i.test(error.message)
      && !error.message.includes('forced bounded snapshot setup failure'),
  )
  assert.equal(hashFile(DB_PATH), sourceHash)
  assert.equal(setupSnapshot, null)

  let cleanupSnapshot: string | null = null
  sourceHash = hashFile(DB_PATH)
  await assert.rejects(
    runMigrations({
      migration029SnapshotVerificationFault: 'cleanup',
      migration029SnapshotObserver: snapshotRoot => { cleanupSnapshot = snapshotRoot },
    }),
    (error: unknown) => error instanceof Error
      && error.name === 'MigrationStateMismatchError'
      && /snapshot_cleanup semantic persistence guard/i.test(error.message)
      && /snapshot cleanup could not be established/i.test(error.message)
      && !error.message.includes('forced bounded snapshot cleanup failure'),
  )
  assert.equal(hashFile(DB_PATH), sourceHash)
  assert.ok(cleanupSnapshot)
  assert.equal(fs.existsSync(cleanupSnapshot), false)
})

test('TD-PRODUCT-001-C-R3 preserves primary semantic failure when snapshot cleanup also fails', async () => {
  const name = 'canonical_result_detail_performed_insert'
  const trigger = await sql<{ definition: string }>`
    SELECT sql AS definition FROM sqlite_master WHERE type = 'trigger' AND name = ${name}
  `.execute(getDb())
  const original = trigger.rows[0]?.definition
  assert.ok(original)
  await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
  await sql.raw(`
    CREATE TRIGGER canonical_result_detail_performed_insert
    BEFORE INSERT ON test_results
    WHEN 0
    BEGIN
      SELECT CASE WHEN NEW.status IS 'passed' AND NEW.error_msg IS 'completed' THEN 1 END;
      SELECT CASE WHEN NEW.status IS 'failed' AND NEW.error_msg IS 'oracle_failed' THEN 1 END;
    END
  `).execute(getDb())
  const sourceHash = hashFile(DB_PATH)
  let failedSnapshot: string | null = null
  try {
    await assert.rejects(
      runMigrations({
        migration029SnapshotVerificationFault: 'cleanup',
        migration029SnapshotObserver: snapshotRoot => { failedSnapshot = snapshotRoot },
      }),
      (error: unknown) => error instanceof Error
        && error.name === 'MigrationStateMismatchError'
        && /performed_oracle semantic persistence guard/i.test(error.message)
        && /snapshot cleanup could not be established/i.test(error.message)
        && !error.message.includes('forced bounded snapshot cleanup failure'),
    )
    assert.equal(hashFile(DB_PATH), sourceHash)
    assert.ok(failedSnapshot)
    assert.equal(fs.existsSync(failedSnapshot), false)
  } finally {
    await sql.raw(`DROP TRIGGER ${name}`).execute(getDb())
    await sql.raw(original).execute(getDb())
  }
  await runMigrations()
})

test('TD-PRODUCT-001-C Migration 029 is explicitly forward-only', async () => {
  await assert.rejects(
    runWithMigrationContext(getDatabaseProvenance(), () => migrate029Down(getDb())),
    /intentionally irreversible/,
  )
})

test('TD069B-C-D-5 duplicate Result append is rejected and cannot overwrite the first observation', async () => {
  const context = await authority('duplicate-result')
  const repository = new ExecutionRepository()
  await repository.beginExecution({
    executionId: 'execution-duplicate-result', projectId: context.projectId, processInstanceId: PROCESS,
    executionIntentKey: 'intent-duplicate-result', executionIntentFingerprint: context.plan.fingerprint,
    startedAt: NOW, executionPlanHash: context.plan.fingerprint,
    expectedTestSetId: context.testSetId, expectedRevision: 1, expectedModelRowId: context.modelRowId,
    expectedModelVersion: '1.0.0', sourceObservationId: 'observation-duplicate-result',
    manifestItems: [{
      itemOrdinal: 1, definitionId: context.definition.id, executablePlanHash: context.plan.fingerprint,
      oracleKind: context.plan.value.oracle.kind, oracleSubjectId: context.plan.value.oracle.subjectId,
    }],
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
