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
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { ExecutionRepository } from '../src/core/storage/repositories/ExecutionRepository'
import { RunRepository } from '../src/core/storage/repositories/RunRepository'
import { TestResultRepository } from '../src/core/storage/repositories/TestResultRepository'
import { ExecutionRunCoordinator } from '../src/core/execution/ExecutionRunCoordinator'
import {
  ExecutionRecoveryCoordinator,
  ExecutionRecoveryRefusedError,
} from '../src/core/execution/ExecutionRecoveryCoordinator'

const ACCEPTED = '2026-08-10T12:00:00.000Z'
const RECOVERY_NOW = '2026-08-10T12:10:00.000Z'
const OWNER = 'process-original'
const RECOVERY = 'process-recovery'

interface Fixture {
  projectId: string
  executionId: string
  hashes: string[]
  definitionIds: string[]
}

async function disposable(body: () => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-e-'))
  try {
    initDb(path.join(root, 'forge.db'))
    await runMigrations()
    await body()
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function selectionHash(hashes: string[]): string {
  if (hashes.length === 1) return hashes[0]
  return crypto.createHash('sha256').update(JSON.stringify({ schemaVersion: 1, planFingerprints: hashes })).digest('hex')
}

async function accepted(suffix: string, itemCount = 1, withLock = true): Promise<Fixture> {
  const projectId = `project-${suffix}`
  const executionId = `execution-${suffix}`
  const hashes = Array.from({ length: itemCount }, (_, index) => crypto.createHash('sha256').update(`${suffix}:${index}`).digest('hex'))
  const definitionIds = hashes.map((_, index) => `definition-${suffix}-${index + 1}`)
  const planHash = selectionHash(hashes)
  await getDb().insertInto('executions').values({
    execution_id: executionId, project_id: projectId, accepted_at: ACCEPTED,
    test_set_id: `test-set-${suffix}`, test_set_revision: 1, model_row_id: 1,
    model_version: '1.0.0', source_observation_id: `observation-${suffix}`,
    manifest_hash: planHash, max_run_attempts: 1, dispatch_mode: 'serial',
    stop_rule: 'stop_on_first_non_completed',
  }).execute()
  await getDb().insertInto('execution_items').values(hashes.map((hash, index) => ({
    execution_id: executionId, item_ordinal: index + 1,
    definition_id: definitionIds[index], executable_plan_hash: hash,
  }))).execute()
  await getDb().insertInto('execution_events').values({
    execution_id: executionId, project_id: projectId, event_type: 'started', outcome: null,
    occurred_at: ACCEPTED, process_instance_id: OWNER, safe_code: null,
    safe_message: 'Accepted fixture.', execution_plan_hash: planHash,
    lifecycle: 'accepted',
  }).execute()
  if (withLock) {
    await getDb().insertInto('execution_locks').values({
      project_id: projectId, execution_id: executionId, process_instance_id: OWNER,
      acquired_at: ACCEPTED, last_heartbeat_at: ACCEPTED,
    }).execute()
  }
  return { projectId, executionId, hashes, definitionIds }
}

async function admit(fixture: Fixture): Promise<string> {
  const run = await new ExecutionRunCoordinator(
    () => getDb(), undefined, undefined, undefined, () => `run-${fixture.executionId}`,
  ).admitRun({
    executionId: fixture.executionId, projectId: fixture.projectId, processInstanceId: OWNER,
    expectedResultCount: fixture.hashes.length, runnerAdapter: 'playwright-plan-executor/v1',
    environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true },
    startedAt: '2026-08-10T12:00:01.000Z',
  })
  return run.run_id
}

async function result(fixture: Fixture, runId: string, ordinal: number, status: 'passed' | 'failed' | 'could_not_verify', overrides: Record<string, unknown> = {}): Promise<void> {
  const reason = status === 'passed' ? 'completed' : status === 'failed' ? 'oracle_failed' : 'navigation_failed'
  await new TestResultRepository().insert({
    run_id: runId, test_id: fixture.definitionIds[ordinal - 1], title: fixture.definitionIds[ordinal - 1],
    suite: 'product-execution', status, duration_ms: ordinal * 10, retry_count: 0,
    error_msg: reason, browser: 'chromium', tier: 'ui', started_at: `2026-08-10T12:00:0${ordinal}.000Z`,
    worker_index: 0, tags: '[]', flaky_history: 0, screenshot_path: null, video_path: null,
    metadata: '{}', result_id: `result-${fixture.executionId}-${ordinal}-${crypto.randomUUID()}`,
    execution_item_ordinal: ordinal, definition_id: fixture.definitionIds[ordinal - 1],
    executable_plan_hash: fixture.hashes[ordinal - 1],
    ...overrides,
  } as any)
}

function recover(fixture: Fixture, overrides: Partial<Parameters<ExecutionRecoveryCoordinator['reconcile']>[0]> = {}) {
  return new ExecutionRecoveryCoordinator().reconcile({
    projectId: fixture.projectId, executionId: fixture.executionId,
    currentProcessInstanceId: RECOVERY, locallyActive: false, now: RECOVERY_NOW,
    staleAfterMs: 1000, ...overrides,
  })
}

async function evidence(fixture: Fixture) {
  const run = await getDb().selectFrom('runs').selectAll().where('execution_id', '=', fixture.executionId).executeTakeFirst()
  return {
    run: run ?? null,
    results: run ? await getDb().selectFrom('test_results').selectAll().where('run_id', '=', run.run_id).orderBy('id').execute() : [],
    events: await getDb().selectFrom('execution_events').selectAll().where('execution_id', '=', fixture.executionId).orderBy('id').execute(),
    locks: await getDb().selectFrom('execution_locks').selectAll().where('execution_id', '=', fixture.executionId).execute(),
  }
}

test('TD069B-C-E-1 accepted without a Run becomes interrupted_before_dispatch and creates no Result', () => disposable(async () => {
  const fixture = await accepted('accepted-no-run')
  const decision = await recover(fixture)
  const persisted = await evidence(fixture)
  assert.equal(decision.action, 'recovered')
  assert.equal(decision.status?.state, 'interrupted')
  assert.equal(decision.status?.outcome, 'could_not_verify')
  assert.equal(decision.status?.safeCode, 'interrupted_before_dispatch')
  assert.equal(persisted.run, null)
  assert.equal(persisted.results.length, 0)
  assert.equal(persisted.events.length, 2)
  assert.equal(persisted.locks.length, 0)
}))

test('TD069B-C-E-2 admitted Run without Results becomes interrupted and preserves an honest unknown Run outcome', () => disposable(async () => {
  const fixture = await accepted('run-no-results')
  await admit(fixture)
  const decision = await recover(fixture)
  const persisted = await evidence(fixture)
  assert.equal(decision.status?.safeCode, 'interrupted_before_result')
  assert.equal(persisted.run?.lifecycle, 'interrupted')
  assert.equal(persisted.run?.status, 'unknown')
  assert.equal(persisted.run?.completed_at, null)
  assert.equal(persisted.results.length, 0)
  assert.equal(persisted.locks.length, 0)
}))

test('TD069B-C-E-3 partial Results retain only observed rows and weaken Execution to could_not_verify', () => disposable(async () => {
  const fixture = await accepted('partial', 2)
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'passed')
  const decision = await recover(fixture)
  const persisted = await evidence(fixture)
  assert.equal(decision.status?.state, 'interrupted')
  assert.equal(decision.status?.outcome, 'could_not_verify')
  assert.equal(decision.status?.safeCode, 'interrupted_incomplete_manifest')
  assert.equal(persisted.run?.lifecycle, 'interrupted')
  assert.equal(persisted.run?.status, 'passed')
  assert.equal(persisted.results.length, 1)
  assert.equal(persisted.results[0].execution_item_ordinal, 1)
}))

test('TD069B-C-E-4 failed evidence dominates a partial manifest', () => disposable(async () => {
  const fixture = await accepted('partial-failed', 2)
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'failed')
  const decision = await recover(fixture)
  assert.equal(decision.status?.state, 'interrupted')
  assert.equal(decision.status?.outcome, 'failed')
  assert.equal((await evidence(fixture)).run?.status, 'failed')
}))

test('TD069B-C-E-5 complete persisted Results complete a running Run after process loss', () => disposable(async () => {
  const fixture = await accepted('all-results', 2)
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'passed')
  await result(fixture, runId, 2, 'passed')
  const decision = await recover(fixture)
  const persisted = await evidence(fixture)
  assert.equal(decision.status?.state, 'completed')
  assert.equal(decision.status?.outcome, 'passed')
  assert.equal(persisted.run?.lifecycle, 'completed')
  assert.equal(persisted.run?.status, 'passed')
  assert.equal(persisted.run?.duration_ms, 599000)
}))

test('TD069B-C-E-6 completed Run without terminal Execution derives the missing terminal event', () => disposable(async () => {
  const fixture = await accepted('completed-run')
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'could_not_verify')
  await getDb().transaction().execute(trx => new RunRepository().terminalizeProduct(runId, {
    status: 'could_not_verify', passed: 0, failed: 0, skipped: 1,
    duration_ms: 4000, completed_at: '2026-08-10T12:00:05.000Z',
  }, trx))
  const decision = await recover(fixture)
  assert.equal(decision.status?.state, 'completed')
  assert.equal(decision.status?.outcome, 'could_not_verify')
  assert.equal((await evidence(fixture)).events.length, 2)
}))

test('TD069B-C-E-7 healthy local and foreign owners remain untouched', () => disposable(async () => {
  const local = await accepted('healthy-local')
  const localDecision = await recover(local, {
    currentProcessInstanceId: OWNER, locallyActive: true, now: '2026-08-10T12:00:00.500Z',
  })
  assert.equal(localDecision.action, 'untouched_active')
  assert.equal((await evidence(local)).events.length, 1)

  const foreign = await accepted('healthy-foreign')
  const foreignDecision = await recover(foreign, { now: '2026-08-10T12:00:00.500Z' })
  assert.equal(foreignDecision.action, 'untouched_active')
  assert.equal((await evidence(foreign)).locks.length, 1)
}))

test('TD069B-C-E-8 fresh owned lock with an inactive local process and a stale foreign lock both recover', () => disposable(async () => {
  const killed = await accepted('process-kill')
  const killedDecision = await recover(killed, {
    currentProcessInstanceId: OWNER, locallyActive: false, now: '2026-08-10T12:00:00.500Z',
  })
  assert.equal(killedDecision.status?.state, 'interrupted')

  const stale = await accepted('stale-foreign')
  const staleDecision = await recover(stale)
  assert.equal(staleDecision.status?.state, 'interrupted')
  assert.equal((await evidence(stale)).locks.length, 0)
}))

test('TD069B-C-E-9 missing lock recovers and double recovery is persistence-idempotent', () => disposable(async () => {
  const fixture = await accepted('missing-lock', 1, false)
  const first = await recover(fixture)
  const once = JSON.stringify(await evidence(fixture))
  const second = await recover(fixture)
  const twice = JSON.stringify(await evidence(fixture))
  assert.equal(first.action, 'recovered')
  assert.equal(second.action, 'already_terminal')
  assert.equal(twice, once)
}))

test('TD069B-C-E-10 duplicate Results are refused without persistence changes', () => disposable(async () => {
  const fixture = await accepted('duplicate-results')
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'passed')
  await sql`DROP INDEX uq_results_run_manifest_item`.execute(getDb())
  await result(fixture, runId, 1, 'passed')
  const before = JSON.stringify(await evidence(fixture))
  await assert.rejects(recover(fixture), (error: unknown) => error instanceof ExecutionRecoveryRefusedError && error.code === 'duplicate_results')
  assert.equal(JSON.stringify(await evidence(fixture)), before)
}))

test('TD069B-C-E-11 manifest mismatch and conflicting Product provenance are refused', () => disposable(async () => {
  const mismatch = await accepted('manifest-mismatch')
  const mismatchRun = await admit(mismatch)
  await sql`DROP TRIGGER validate_product_result_insert`.execute(getDb())
  await result(mismatch, mismatchRun, 1, 'passed', { executable_plan_hash: 'f'.repeat(64) })
  await assert.rejects(recover(mismatch), (error: unknown) => error instanceof ExecutionRecoveryRefusedError && error.code === 'manifest_mismatch')

  const conflict = await accepted('conflicting-provenance')
  const conflictRun = await admit(conflict)
  await result(conflict, conflictRun, 1, 'passed')
  await sql`DROP TRIGGER product_run_admission_immutable`.execute(getDb())
  await getDb().updateTable('runs').set({ app_name: 'different-project' }).where('run_id', '=', conflictRun).execute()
  await assert.rejects(recover(conflict), (error: unknown) => error instanceof ExecutionRecoveryRefusedError && error.code === 'conflicting_provenance')
}))

test('TD069B-C-E-12 terminal write failure rolls back Run reconciliation, event append, and lock release', () => disposable(async () => {
  const fixture = await accepted('terminal-rollback')
  const runId = await admit(fixture)
  await result(fixture, runId, 1, 'passed')
  await sql.raw(`CREATE TRIGGER fail_recovery_terminal BEFORE INSERT ON execution_events WHEN NEW.execution_id = '${fixture.executionId}' AND NEW.event_type = 'terminal' BEGIN SELECT RAISE(ABORT, 'forced recovery failure'); END`).execute(getDb())
  await assert.rejects(recover(fixture), (error: unknown) => error instanceof ExecutionRecoveryRefusedError && error.code === 'recovery_persistence_failed')
  const persisted = await evidence(fixture)
  assert.equal(persisted.run?.lifecycle, 'running')
  assert.equal(persisted.run?.status, 'unknown')
  assert.equal(persisted.events.length, 1)
  assert.equal(persisted.locks.length, 1)
  assert.equal(persisted.results.length, 1)
}))

test('TD069B-C-E-13 recovery output and persistence contain no credential or raw-error channel', () => disposable(async () => {
  const fixture = await accepted('secret-boundary')
  await admit(fixture)
  const decision = await recover(fixture)
  const persisted = await evidence(fixture)
  const serialized = JSON.stringify({ decision, persisted })
  assert.doesNotMatch(serialized, /username|password|cookie|token|storageState|raw.browser/i)
  assert.equal(persisted.results.length, 0)
}))
