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
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  ExecutionResultProjectionService,
  type ProjectionOutcome,
} from '../src/core/execution/ExecutionResultProjectionService'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'
import { listExecutionResults, readExecutionResults } from '../forge-ui/server/context/ExecutionResultsController'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-g-results-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const BASE_MS = Date.parse('2026-08-10T20:00:00.000Z')
const PROCESS = 'projection-process'

interface FixtureOptions {
  suffix: string
  projectId?: string
  acceptedOffset?: number
  itemCount?: number
  resultOutcomes?: ProjectionOutcome[]
  executionLifecycle?: 'running' | 'completed' | 'cancelled' | 'interrupted'
  terminalOutcome?: ProjectionOutcome
  runStatus?: string
  runLifecycle?: 'running' | 'completed' | 'cancelled' | 'interrupted'
  withRun?: boolean
}

function iso(offsetSeconds: number): string {
  return new Date(BASE_MS + offsetSeconds * 1000).toISOString()
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function manifestHash(hashes: string[]): string {
  if (hashes.length === 1) return hashes[0]
  return hash(JSON.stringify({ schemaVersion: 1, planFingerprints: hashes }))
}

function aggregate(outcomes: ProjectionOutcome[]): ProjectionOutcome | null {
  if (outcomes.length === 0) return null
  if (outcomes.includes('failed')) return 'failed'
  if (outcomes.includes('could_not_verify')) return 'could_not_verify'
  return 'passed'
}

async function fixture(options: FixtureOptions): Promise<{ projectId: string; executionId: string; runId: string | null }> {
  const projectId = options.projectId ?? `projection-${options.suffix}`
  const executionId = `execution-${options.suffix}`
  const runId = `run-${options.suffix}`
  const acceptedAt = iso(options.acceptedOffset ?? 0)
  const itemCount = options.itemCount ?? 1
  const outcomes = options.resultOutcomes ?? []
  const executionLifecycle = options.executionLifecycle ?? 'completed'
  const withRun = options.withRun ?? true
  const hashes = Array.from({ length: itemCount }, (_, index) => hash(`plan-${options.suffix}-${index + 1}`))
  const rootHash = manifestHash(hashes)
  const db = getDb()
  await db.insertInto('executions').values({
    execution_id: executionId,
    project_id: projectId,
    accepted_at: acceptedAt,
    test_set_id: `test-set-${options.suffix}`,
    test_set_revision: 1,
    model_row_id: 1,
    model_version: '1.0.0',
    source_observation_id: `observation-${options.suffix}`,
    manifest_hash: rootHash,
    max_run_attempts: 1,
    dispatch_mode: 'serial',
    stop_rule: 'stop_on_first_non_completed',
  }).execute()
  await db.insertInto('execution_items').values(hashes.map((planHash, index) => ({
    execution_id: executionId,
    item_ordinal: index + 1,
    definition_id: `definition-${options.suffix}-${index + 1}`,
    executable_plan_hash: planHash,
  }))).execute()
  await db.insertInto('execution_events').values({
    execution_id: executionId,
    project_id: projectId,
    event_type: 'started',
    outcome: null,
    occurred_at: acceptedAt,
    process_instance_id: PROCESS,
    safe_code: null,
    safe_message: 'The governed execution was accepted.',
    execution_plan_hash: rootHash,
    lifecycle: 'accepted',
  }).execute()

  const runLifecycle = options.runLifecycle ?? executionLifecycle
  const runOutcome = aggregate(outcomes)
  const completedAt = executionLifecycle === 'running' ? null : iso((options.acceptedOffset ?? 0) + 4)
  if (withRun) {
    await db.insertInto('runs').values({
      run_id: runId,
      app_name: projectId,
      branch: 'unknown',
      commit_sha: 'unknown',
      environment: 'local',
      base_url: '',
      triggered_by: 'platform',
      reporter_version: 'playwright-plan-executor/v1',
      status: options.runStatus ?? (runLifecycle === 'running' || runLifecycle === 'interrupted' && runOutcome === null
        ? 'unknown'
        : runLifecycle === 'cancelled' && runOutcome === null ? 'could_not_verify' : runOutcome ?? 'unknown'),
      total_tests: itemCount,
      passed: outcomes.filter(outcome => outcome === 'passed').length,
      failed: outcomes.filter(outcome => outcome === 'failed').length,
      skipped: outcomes.filter(outcome => outcome === 'could_not_verify').length,
      duration_ms: completedAt ? 3000 : outcomes.length * 100,
      started_at: iso((options.acceptedOffset ?? 0) + 1),
      completed_at: runLifecycle === 'interrupted' || runLifecycle === 'running' ? null : completedAt,
      metadata: '{"schemaVersion":1,"browser":"chromium","headless":true}',
      input_health: 'unknown',
      input_health_reason: null,
      lifecycle: runLifecycle,
      execution_id: executionId,
      origin: 'product',
      attempt_ordinal: 1,
    }).execute()
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index]
      await db.insertInto('test_results').values({
        run_id: runId,
        test_id: `definition-${options.suffix}-${index + 1}`,
        title: `definition-${options.suffix}-${index + 1}`,
        suite: 'product-execution',
        status: outcome,
        duration_ms: 100,
        retry_count: 0,
        error_msg: outcome === 'passed' ? 'completed' : outcome === 'failed' ? 'oracle_failed' : 'navigation_failed',
        browser: 'chromium',
        tier: 'ui',
        started_at: iso((options.acceptedOffset ?? 0) + 1 + index),
        worker_index: 0,
        tags: '[]',
        flaky_history: 0,
        screenshot_path: null,
        video_path: null,
        metadata: '{}',
        result_id: `result-${options.suffix}-${index + 1}`,
        execution_item_ordinal: index + 1,
        definition_id: `definition-${options.suffix}-${index + 1}`,
        executable_plan_hash: hashes[index],
      }).execute()
    }
  }

  if (executionLifecycle === 'running') {
    await db.insertInto('execution_locks').values({
      project_id: projectId,
      execution_id: executionId,
      process_instance_id: PROCESS,
      acquired_at: acceptedAt,
      last_heartbeat_at: iso((options.acceptedOffset ?? 0) + 1),
    }).execute()
  } else {
    if (executionLifecycle === 'cancelled') {
      await db.insertInto('execution_events').values({
        execution_id: executionId,
        project_id: projectId,
        event_type: 'cancellation_requested',
        outcome: null,
        occurred_at: iso((options.acceptedOffset ?? 0) + 3),
        process_instance_id: PROCESS,
        safe_code: 'cancellation_requested',
        safe_message: 'An operator requested cancellation.',
        execution_plan_hash: rootHash,
        lifecycle: 'cancellation_requested',
      }).execute()
    }
    const derivedExecutionOutcome = outcomes.includes('failed')
      ? 'failed'
      : outcomes.length !== itemCount || outcomes.includes('could_not_verify')
        ? 'could_not_verify'
        : 'passed'
    await db.insertInto('execution_events').values({
      execution_id: executionId,
      project_id: projectId,
      event_type: 'terminal',
      outcome: options.terminalOutcome ?? derivedExecutionOutcome,
      occurred_at: completedAt!,
      process_instance_id: PROCESS,
      safe_code: executionLifecycle === 'cancelled'
        ? outcomes.length === 0 ? 'cancelled_before_execution' : 'cancelled_by_request'
        : executionLifecycle === 'interrupted'
          ? withRun ? 'interrupted_incomplete_manifest' : 'interrupted_before_dispatch'
          : derivedExecutionOutcome === 'passed' ? 'completed' : derivedExecutionOutcome === 'failed' ? 'oracle_failed' : 'incomplete_execution_manifest',
      safe_message: 'The execution reached a safe terminal lifecycle.',
      execution_plan_hash: rootHash,
      lifecycle: executionLifecycle,
    }).execute()
  }
  return { projectId, executionId, runId: withRun ? runId : null }
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD069B-C-G-1 completed passed, failed, and could_not_verify remain distinct', async () => {
  const service = new ExecutionResultProjectionService()
  for (const outcome of ['passed', 'failed', 'could_not_verify'] as const) {
    const row = await fixture({ suffix: `terminal-${outcome}`, resultOutcomes: [outcome] })
    const read = await service.read(row.projectId, row.executionId)
    assert.equal(read.kind, 'ok')
    if (read.kind !== 'ok') throw new Error('expected projection')
    assert.equal(read.projection.execution.lifecycle, 'completed')
    assert.equal(read.projection.execution.outcome, outcome)
    assert.equal(read.projection.headlineOutcome, outcome)
    assert.equal(read.projection.run?.outcome, outcome)
    assert.equal(read.projection.items[0].result.state, 'result_observed')
  }
})

test('TD069B-C-G-2 lifecycle stays separate for cancelled/passed and interrupted/unverified', async () => {
  const service = new ExecutionResultProjectionService()
  const cancelled = await fixture({ suffix: 'cancelled-pass', resultOutcomes: ['passed'], executionLifecycle: 'cancelled' })
  const interrupted = await fixture({ suffix: 'interrupted-empty', resultOutcomes: [], executionLifecycle: 'interrupted' })
  const cancelledRead = await service.read(cancelled.projectId, cancelled.executionId)
  const interruptedRead = await service.read(interrupted.projectId, interrupted.executionId)
  assert.equal(cancelledRead.kind, 'ok')
  assert.equal(interruptedRead.kind, 'ok')
  if (cancelledRead.kind !== 'ok' || interruptedRead.kind !== 'ok') throw new Error('expected projections')
  assert.deepEqual(
    [cancelledRead.projection.execution.lifecycle, cancelledRead.projection.execution.outcome],
    ['cancelled', 'passed'],
  )
  assert.deepEqual(
    [interruptedRead.projection.execution.lifecycle, interruptedRead.projection.headlineOutcome, interruptedRead.projection.run?.outcome],
    ['interrupted', 'could_not_verify', null],
  )
})

test('TD069B-C-G-3 missing Result is projection-only and never fabricates Result identity', async () => {
  const row = await fixture({ suffix: 'missing', itemCount: 2, resultOutcomes: ['passed'] })
  const beforeCount = await getDb().selectFrom('test_results').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow()
  const read = await new ExecutionResultProjectionService().read(row.projectId, row.executionId)
  const afterCount = await getDb().selectFrom('test_results').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow()
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') throw new Error('expected projection')
  assert.equal(read.projection.headlineOutcome, 'could_not_verify')
  assert.equal(read.projection.execution.outcome, 'could_not_verify')
  assert.equal(read.projection.execution.reasonCode, 'incomplete_execution_manifest')
  assert.deepEqual(read.projection.items[1].result, {
    state: 'no_result_observed', reasonCode: 'expected_result_missing',
  })
  assert.equal('resultId' in read.projection.items[1].result, false)
  assert.equal(read.projection.integrityWarnings.some(item => item.code === 'missing_expected_result'), true)
  assert.equal(Number(afterCount.n), Number(beforeCount.n))
})

test('TD069B-C-G-4 stored aggregate disagreements are surfaced while headline remains evidence-derived', async () => {
  const row = await fixture({
    suffix: 'mismatch', itemCount: 2, resultOutcomes: ['passed'], runStatus: 'failed', terminalOutcome: 'passed',
  })
  const read = await new ExecutionResultProjectionService().read(row.projectId, row.executionId)
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') throw new Error('expected projection')
  assert.equal(read.projection.headlineOutcome, 'could_not_verify')
  assert.equal(read.projection.execution.outcome, 'could_not_verify')
  assert.equal(read.projection.execution.reasonCode, 'execution_aggregate_mismatch')
  assert.deepEqual(
    new Set(read.projection.integrityWarnings.map(item => item.code)),
    new Set(['missing_expected_result', 'run_aggregate_mismatch', 'execution_aggregate_mismatch']),
  )
})

test('TD069B-C-G-5 missing linked Run and impossible cross-authority lifecycle are integrity-invalid', async () => {
  const row = await fixture({ suffix: 'missing-run', resultOutcomes: [], withRun: false })
  const read = await new ExecutionResultProjectionService().read(row.projectId, row.executionId)
  assert.equal(read.kind, 'integrity_invalid')
  if (read.kind !== 'integrity_invalid') throw new Error('expected refusal')
  assert.equal(read.integrityWarnings[0].code, 'missing_linked_run')

  const impossible = await fixture({
    suffix: 'impossible-lifecycle', resultOutcomes: ['passed'],
    executionLifecycle: 'interrupted', runLifecycle: 'completed',
  })
  const impossibleRead = await new ExecutionResultProjectionService().read(impossible.projectId, impossible.executionId)
  assert.equal(impossibleRead.kind, 'integrity_invalid')
  if (impossibleRead.kind !== 'integrity_invalid') throw new Error('expected refusal')
  assert.equal(impossibleRead.integrityWarnings[0].code, 'impossible_lifecycle_outcome')
})

test('TD069B-C-G-6 duplicate/conflicting Result and manifest mismatch are refused', async () => {
  const row = await fixture({ suffix: 'conflict-source', resultOutcomes: ['passed'] })
  const source = await new ExecutionResultProjectionService().read(row.projectId, row.executionId)
  assert.equal(source.kind, 'ok')
  const root = await getDb().selectFrom('executions').selectAll().where('execution_id', '=', row.executionId).executeTakeFirstOrThrow()
  const items = await getDb().selectFrom('execution_items').selectAll().where('execution_id', '=', row.executionId).execute()
  const events = await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', row.executionId).execute()
  const run = await getDb().selectFrom('runs').selectAll().where('run_id', '=', row.runId!).executeTakeFirstOrThrow()
  const result = await getDb().selectFrom('test_results').selectAll().where('run_id', '=', row.runId!).executeTakeFirstOrThrow()
  const fakeExecutions = { readProjectionSnapshot: async () => ({ execution: root, items, events, lock: null }) }
  const fakeRuns = { findProductByExecution: async () => [run] }
  const duplicate = new ExecutionResultProjectionService(getDb, fakeExecutions as any, fakeRuns as any, {
    findByRun: async () => [result, { ...result, id: Number(result.id) + 1, result_id: 'result-conflict-second' }],
  } as any)
  const duplicateRead = await duplicate.read(row.projectId, row.executionId)
  assert.equal(duplicateRead.kind, 'integrity_invalid')
  if (duplicateRead.kind !== 'integrity_invalid') throw new Error('expected refusal')
  assert.equal(duplicateRead.integrityWarnings[0].code, 'duplicate_or_conflicting_result')

  const mismatch = new ExecutionResultProjectionService(getDb, fakeExecutions as any, fakeRuns as any, {
    findByRun: async () => [{ ...result, definition_id: 'different-definition' }],
  } as any)
  const mismatchRead = await mismatch.read(row.projectId, row.executionId)
  assert.equal(mismatchRead.kind, 'integrity_invalid')
  if (mismatchRead.kind !== 'integrity_invalid') throw new Error('expected refusal')
  assert.equal(mismatchRead.integrityWarnings[0].code, 'manifest_mismatch')
})

test('TD069B-C-G-7 unknown execution and empty Product history remain explicit', async () => {
  const service = new ExecutionResultProjectionService()
  assert.deepEqual(await service.read('projection-empty', 'execution-missing'), { kind: 'not_found' })
  assert.deepEqual(await service.list('projection-empty', 25), { kind: 'ok', executions: [], limit: 25 })
})

test('TD069B-C-G-8 list is bounded, deterministic, and excludes legacy Runs', async () => {
  const projectId = 'projection-list'
  const old = await fixture({ suffix: 'list-old', projectId, acceptedOffset: 10, resultOutcomes: ['passed'] })
  const tiedA = await fixture({ suffix: 'list-a', projectId, acceptedOffset: 20, resultOutcomes: ['passed'] })
  const tiedB = await fixture({ suffix: 'list-b', projectId, acceptedOffset: 20, resultOutcomes: ['failed'] })
  await getDb().insertInto('runs').values({
    run_id: 'legacy-list-run', app_name: projectId, branch: 'main', commit_sha: 'legacy', environment: 'local',
    base_url: '', triggered_by: 'cli', reporter_version: 'legacy', status: 'passed', total_tests: 1,
    passed: 1, failed: 0, skipped: 0, duration_ms: 1, started_at: iso(30), completed_at: iso(31),
    metadata: '{}', input_health: 'unknown', input_health_reason: null, lifecycle: 'completed',
    execution_id: null, origin: 'legacy', attempt_ordinal: null,
  }).execute()
  const read = await new ExecutionResultProjectionService().list(projectId, 3)
  assert.deepEqual(read.executions.map(item => item.executionId), [tiedA.executionId, tiedB.executionId, old.executionId])
  assert.equal(read.executions.every(item => item.runCount === 1 && item.observedResultCount === 1), true)
  assert.deepEqual(
    read.executions.map(item => [item.passedResultCount, item.failedResultCount, item.couldNotVerifyResultCount]),
    [[1, 0, 0], [0, 1, 0], [1, 0, 0]],
  )
  assert.equal(JSON.stringify(read).includes('legacy-list-run'), false)
})

test('TD-PRODUCT-001-A-R4 list totals come from canonical aggregation and invalid summaries refuse totals', async () => {
  const projectId = 'projection-list-r4'
  const rows = await Promise.all([
    fixture({ suffix: 'r4-pass', projectId, acceptedOffset: 1, resultOutcomes: ['passed'] }),
    fixture({ suffix: 'r4-fail', projectId, acceptedOffset: 2, resultOutcomes: ['failed'] }),
    fixture({ suffix: 'r4-cnv', projectId, acceptedOffset: 3, resultOutcomes: ['could_not_verify'] }),
    fixture({ suffix: 'r4-partial', projectId, acceptedOffset: 4, itemCount: 2, resultOutcomes: ['passed'] }),
    fixture({ suffix: 'r4-cancelled', projectId, acceptedOffset: 5, resultOutcomes: [], executionLifecycle: 'cancelled', runLifecycle: 'cancelled' }),
    fixture({ suffix: 'r4-invalid', projectId, acceptedOffset: 6, resultOutcomes: [], withRun: false }),
  ])
  const read = await new ExecutionResultProjectionService().list(projectId, 10)
  const byId = new Map(read.executions.map(item => [item.executionId, item]))
  assert.deepEqual(
    rows.slice(0, 5).map(row => {
      const item = byId.get(row.executionId)!
      return [item.evidenceHeadlineOutcome, item.passedResultCount, item.failedResultCount, item.couldNotVerifyResultCount]
    }),
    [
      ['passed', 1, 0, 0],
      ['failed', 0, 1, 0],
      ['could_not_verify', 0, 0, 1],
      ['could_not_verify', 1, 0, 0],
      ['could_not_verify', 0, 0, 0],
    ],
  )
  const invalid = byId.get(rows[5].executionId)!
  assert.deepEqual(
    [invalid.integrityState, invalid.evidenceHeadlineOutcome, invalid.passedResultCount,
      invalid.failedResultCount, invalid.couldNotVerifyResultCount],
    ['invalid', null, null, null, null],
  )
})

test('TD069B-C-G-9 safe result allowlist exposes no legacy metadata, paths, or credential material', async () => {
  const row = await fixture({ suffix: 'safe', resultOutcomes: ['passed'] })
  const read = await new ExecutionResultProjectionService().read(row.projectId, row.executionId)
  assert.equal(read.kind, 'ok')
  const serialized = JSON.stringify(read)
  for (const forbidden of ['fixture-password', 'SAUCEDEMO_PASSWORD', 'screenshot_path', 'video_path', 'metadata', 'base_url', 'error_msg']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
  if (read.kind !== 'ok') throw new Error('expected projection')
  const observed = read.projection.items[0].result
  assert.equal(observed.state, 'result_observed')
  if (observed.state !== 'result_observed') throw new Error('expected Result')
  assert.deepEqual([observed.safeMessage, observed.oracleKind, observed.observedSubjectId], [null, null, null])
})

test('TD069B-C-G-10 controller maps list/detail, 404, integrity 503, and invalid limit without writes', async () => {
  const originalRead = executionContext.readProductExecutionResults.bind(executionContext)
  const originalList = executionContext.listProductExecutionResults.bind(executionContext)
  const project = async () => ({ appName: 'projection-api', url: 'https://example.invalid' })
  const projection = (id: string) => ({
    availability: 'available' as const,
    headlineOutcome: 'passed' as const,
    execution: {
      executionId: id, lifecycle: 'completed' as const, outcome: 'passed' as const, reasonCode: 'completed',
      acceptedAt: '2026-08-10T00:00:00.000Z', terminalAt: '2026-08-10T00:00:02.000Z', manifestCount: 1,
      definitionAuthority: {
        schemaVersion: 2 as const, testSetId: 'test-set-api', revision: 1, modelRowId: 1, modelVersion: '1.0.0',
        supportSealHash: 'a'.repeat(64), routeEvidenceIdentityHash: 'b'.repeat(64),
        authenticationExpectationIdentityHash: 'c'.repeat(64),
      },
    },
    run: {
      runId: 'run-api', lifecycle: 'completed' as const, outcome: 'passed' as const, reasonCode: 'completed',
      startedAt: '2026-08-10T00:00:00.000Z', terminalAt: '2026-08-10T00:00:02.000Z',
      expectedResultCount: 1, observedResultCount: 1,
      aggregateCounts: { passed: 1, failed: 0, couldNotVerify: 0 },
    },
    items: [{
      itemOrdinal: 1, definitionId: 'definition-api', executablePlanHash: 'd'.repeat(64),
      result: {
        state: 'result_observed' as const, resultId: 'result-api', outcome: 'passed' as const,
        reasonCode: 'completed', safeMessage: null, durationMs: 2_000, oracleKind: null, observedSubjectId: null,
      },
    }],
    integrityWarnings: [],
  })
  try {
    ;(executionContext as any).readProductExecutionResults = async (_app: string, id: string) => id === 'missing'
      ? { kind: 'not_found' }
      : id === 'invalid'
        ? { kind: 'integrity_invalid', integrityWarnings: [{ code: 'manifest_mismatch', severity: 'error', safeMessage: 'Safe.' }] }
        : { kind: 'ok', projection: projection(id) }
    ;(executionContext as any).listProductExecutionResults = async (_app: string, limit: number) => ({
      kind: 'ok', executions: [{
        executionId: 'execution-api', lifecycle: 'completed', evidenceHeadlineOutcome: 'passed', outcome: 'passed',
        reasonCode: 'completed', acceptedAt: '2026-08-10T00:00:00.000Z', terminalAt: '2026-08-10T00:00:02.000Z',
        manifestCount: 1, runCount: 1, observedResultCount: 1, integrityState: 'valid',
        passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 0,
      }], limit,
    })
    assert.equal((await readExecutionResults('projection-api', 'execution-ok', project)).status, 200)
    assert.equal((await readExecutionResults('projection-api', 'missing', project)).status, 404)
    assert.equal((await readExecutionResults('projection-api', 'invalid', project)).status, 503)
    assert.equal((await listExecutionResults('projection-api', {}, project)).status, 200)
    assert.equal((await listExecutionResults('projection-api', { limit: '0' }, project)).status, 400)
  } finally {
    ;(executionContext as any).readProductExecutionResults = originalRead
    ;(executionContext as any).listProductExecutionResults = originalList
  }
})

test('TD069B-C-G-11 route wiring is GET-only and does not invoke lifecycle recovery', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/routes/projects.ts'), 'utf8')
  const context = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ExecutionContext.ts'), 'utf8')
  const projection = fs.readFileSync(path.join(process.cwd(), 'src/core/execution/ExecutionResultProjectionService.ts'), 'utf8')
  assert.match(routes, /router\.get\('\/:appName\/executions'/)
  assert.match(routes, /router\.get\('\/:appName\/executions\/:executionId\/results'/)
  assert.doesNotMatch(routes, /router\.post\('\/:appName\/executions/)
  assert.match(context, /executionResultProjectionService\.read/)
  assert.doesNotMatch(projection, /ExecutionRecoveryCoordinator|terminalize|insertInto|updateTable|deleteFrom/)
})

test('TD069B-C-G-12 actual projection/list reads preserve the SQLite file hash and row counts', async () => {
  const row = await fixture({ suffix: 'readonly', resultOutcomes: ['passed'] })
  const countsBefore = await Promise.all([
    getDb().selectFrom('executions').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('execution_events').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('runs').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('test_results').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
  ])
  await closeDb()
  const beforeHash = hash(fs.readFileSync(DB_PATH).toString('binary'))
  initDb(DB_PATH)
  const service = new ExecutionResultProjectionService()
  assert.equal((await service.read(row.projectId, row.executionId)).kind, 'ok')
  assert.equal((await service.list(row.projectId, 25)).executions.length, 1)
  const countsAfter = await Promise.all([
    getDb().selectFrom('executions').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('execution_events').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('runs').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    getDb().selectFrom('test_results').select(getDb().fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
  ])
  await closeDb()
  const afterHash = hash(fs.readFileSync(DB_PATH).toString('binary'))
  assert.deepEqual(countsAfter.map(row => Number(row.n)), countsBefore.map(row => Number(row.n)))
  assert.equal(afterHash, beforeHash)
  initDb(DB_PATH)
})
