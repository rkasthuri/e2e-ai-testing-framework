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
import { runMigrations } from '../src/core/storage/migrate'
import { ExecutionRepository } from '../src/core/storage/repositories/ExecutionRepository'
import { RunRepository } from '../src/core/storage/repositories/RunRepository'
import { TestResultRepository } from '../src/core/storage/repositories/TestResultRepository'
import type {
  Execution,
  ExecutionEvent,
  ExecutionItem,
  ExecutionLock,
  Run,
  TestResult,
} from '../src/core/storage/types'
import {
  PersistedEvidenceAggregator,
  aggregatePersistedEvidence,
  type PersistedExecutionEvidence,
  type PersistedEvidenceAggregation,
} from '../src/core/execution/PersistedEvidenceAggregator'
import {
  ExecutionRunCoordinator,
  ProductTerminalizationError,
} from '../src/core/execution/ExecutionRunCoordinator'
import { ExecutionRecoveryCoordinator } from '../src/core/execution/ExecutionRecoveryCoordinator'
import { ExecutionResultProjectionService } from '../src/core/execution/ExecutionResultProjectionService'
import { ExecutionService } from '../src/core/execution/ExecutionService'

type Outcome = 'passed' | 'failed' | 'could_not_verify'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-002-'))
const DB_PATH = path.join(ROOT, 'forge.db')
const ACCEPTED = '2026-08-11T12:00:00.000Z'
const OWNER = 'process-td-arch-002'

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function iso(offsetSeconds: number): string {
  return new Date(Date.parse(ACCEPTED) + offsetSeconds * 1000).toISOString()
}

function selectionHash(hashes: string[]): string {
  if (hashes.length === 1) return hashes[0]
  return hash(JSON.stringify({ schemaVersion: 1, planFingerprints: hashes }))
}

function resultReason(outcome: Outcome, ordinal: number): string {
  if (outcome === 'passed') return 'completed'
  if (outcome === 'failed') return `oracle_failed_${ordinal}`
  return `navigation_failed_${ordinal}`
}

function observedOutcome(outcomes: Outcome[]): Outcome | null {
  if (outcomes.length === 0) return null
  if (outcomes.includes('failed')) return 'failed'
  if (outcomes.includes('could_not_verify')) return 'could_not_verify'
  return 'passed'
}

function executionOutcome(outcomes: Outcome[], itemCount: number): Outcome {
  if (outcomes.includes('failed')) return 'failed'
  if (outcomes.length !== itemCount || outcomes.includes('could_not_verify')) return 'could_not_verify'
  return 'passed'
}

function evidence(
  suffix: string,
  outcomes: Outcome[],
  itemCount = Math.max(1, outcomes.length),
  lifecycle: 'running' | 'completed' | 'cancelled' | 'interrupted' = 'running',
): PersistedExecutionEvidence {
  const executionId = `execution-${suffix}`
  const projectId = `project-${suffix}`
  const runId = `run-${suffix}`
  const hashes = Array.from({ length: itemCount }, (_, index) => hash(`${suffix}:${index + 1}`))
  const items: ExecutionItem[] = hashes.map((planHash, index) => ({
    execution_id: executionId,
    item_ordinal: index + 1,
    definition_id: `definition-${suffix}-${index + 1}`,
    executable_plan_hash: planHash,
    oracle_kind: null,
    oracle_subject_id: null,
  }))
  const root: Execution = {
    execution_id: executionId,
    project_id: projectId,
    accepted_at: ACCEPTED,
    test_set_id: `test-set-${suffix}`,
    test_set_revision: 1,
    model_row_id: 1,
    model_version: '1.0.0',
    source_observation_id: `observation-${suffix}`,
    manifest_hash: selectionHash(hashes),
    max_run_attempts: 1,
    dispatch_mode: 'serial',
    stop_rule: 'stop_on_first_non_completed',
    execution_intent_key: `intent-${suffix}`,
    execution_intent_fingerprint: hash(`intent:${suffix}`),
  }
  const results: TestResult[] = outcomes.map((outcome, index) => ({
    id: index + 1,
    run_id: runId,
    test_id: items[index].definition_id,
    title: items[index].definition_id,
    suite: 'product-execution',
    status: outcome,
    duration_ms: 100,
    retry_count: 0,
    error_msg: resultReason(outcome, index + 1),
    browser: 'chromium',
    tier: 'ui',
    started_at: iso(index + 1),
    worker_index: 0,
    tags: '[]',
    flaky_history: 0,
    screenshot_path: null,
    video_path: null,
    metadata: '{}',
    result_id: `result-${suffix}-${index + 1}`,
    execution_item_ordinal: index + 1,
    definition_id: items[index].definition_id,
    executable_plan_hash: items[index].executable_plan_hash,
    oracle_kind: null,
    observed_subject_id: null,
  }))
  const terminal = lifecycle !== 'running'
  const runOutcome = observedOutcome(outcomes)
  const run: Run = {
    id: 1,
    run_id: runId,
    app_name: projectId,
    branch: 'unknown',
    commit_sha: 'unknown',
    environment: 'local',
    base_url: '',
    triggered_by: 'platform',
    reporter_version: 'playwright-plan-executor/v1',
    status: lifecycle === 'interrupted' && runOutcome === null
      ? 'unknown'
      : lifecycle === 'cancelled' && runOutcome === null ? 'could_not_verify' : runOutcome ?? 'unknown',
    total_tests: itemCount,
    passed: terminal ? outcomes.filter(value => value === 'passed').length : 0,
    failed: terminal ? outcomes.filter(value => value === 'failed').length : 0,
    skipped: terminal ? outcomes.filter(value => value === 'could_not_verify').length : 0,
    duration_ms: terminal
      ? lifecycle === 'interrupted' ? outcomes.length * 100 : 4000
      : 0,
    started_at: iso(1),
    completed_at: lifecycle === 'completed' || lifecycle === 'cancelled' ? iso(5) : null,
    metadata: '{"schemaVersion":1,"browser":"chromium","headless":true}',
    input_health: 'unknown',
    input_health_reason: null,
    lifecycle,
    execution_id: executionId,
    origin: 'product',
    attempt_ordinal: 1,
  }
  const events: ExecutionEvent[] = [{
    id: 1,
    execution_id: executionId,
    project_id: projectId,
    event_type: 'started',
    outcome: null,
    occurred_at: ACCEPTED,
    process_instance_id: OWNER,
    safe_code: null,
    safe_message: 'The governed execution was accepted.',
    execution_plan_hash: root.manifest_hash,
    lifecycle: 'accepted',
  }]
  if (lifecycle === 'cancelled') {
    events.push({
      id: 2,
      execution_id: executionId,
      project_id: projectId,
      event_type: 'cancellation_requested',
      outcome: null,
      occurred_at: iso(4),
      process_instance_id: OWNER,
      safe_code: 'cancellation_requested',
      safe_message: 'An operator requested cancellation.',
      execution_plan_hash: root.manifest_hash,
      lifecycle: 'cancellation_requested',
    })
  }
  if (terminal) {
    const outcome = executionOutcome(outcomes, itemCount)
    events.push({
      id: events.length + 1,
      execution_id: executionId,
      project_id: projectId,
      event_type: 'terminal',
      outcome,
      occurred_at: iso(5),
      process_instance_id: OWNER,
      safe_code: lifecycle === 'cancelled'
        ? outcomes.length === 0 ? 'cancelled_before_execution' : 'cancelled_by_request'
        : lifecycle === 'interrupted'
          ? outcomes.length === 0 ? 'interrupted_before_result' : 'interrupted_incomplete_manifest'
          : outcome === 'passed' ? 'completed' : resultReason(outcome, 1),
      safe_message: 'The execution reached a terminal lifecycle.',
      execution_plan_hash: root.manifest_hash,
      lifecycle,
    })
  }
  const lock: ExecutionLock | null = terminal ? null : {
    project_id: projectId,
    execution_id: executionId,
    process_instance_id: OWNER,
    acquired_at: ACCEPTED,
    last_heartbeat_at: iso(1),
  }
  return { execution: root, items, events, lock, runs: [run], results }
}

async function persist(value: PersistedExecutionEvidence): Promise<void> {
  const db = getDb()
  const { id: _runRowId, ...run } = value.runs[0]
  const events = value.events.map(({ id: _eventRowId, ...event }) => event)
  const results = value.results.map(({ id: _resultRowId, ...result }) => result)
  const model = await db.insertInto('app_models').values({
    app_name: value.execution.project_id, version: '1.0.0', base_url: '', app_type: 'web', intake_mode: 'crawl',
    crawl_config_hash: value.execution.manifest_hash, page_count: 1, flow_count: 0, role_count: 0, model_json: '{}',
    crawled_at: value.execution.accepted_at, crawled_by: 'fixture', status: 'archived', evidence_state: 'crawled',
    operation_id: null, candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  const testSet = await db.insertInto('test_set_revisions').values({
    test_set_id: value.execution.test_set_id!, revision: Number(value.execution.test_set_revision),
    project_id: value.execution.project_id, generation_id: `generation-${value.execution.execution_id}`,
    schema_version: 1, source_observation_id: value.execution.source_observation_id!, model_row_id: Number(model.id),
    model_version: '1.0.0', observation_run_id: null, support_seal_hash: null,
    characterization_policy_id: null, characterization_policy_version: null, generated_at: value.execution.accepted_at,
    outcome: 'completed', definition_count: value.items.length,
    payload_json: JSON.stringify({ definitions: value.items.map(item => ({ id: item.definition_id })) }),
    content_hash: value.execution.manifest_hash,
  }).returning('id').executeTakeFirstOrThrow()
  await db.insertInto('executions').values({
    ...value.execution, test_set_authority_scope: 'single', definition_schema_version: 1, model_row_id: Number(model.id),
  }).execute()
  await db.insertInto('execution_items').values(value.items).execute()
  await db.insertInto('execution_item_authorities').values(value.items.map(item => ({
    execution_id: item.execution_id, item_ordinal: item.item_ordinal, test_set_row_id: Number(testSet.id),
    test_set_id: value.execution.test_set_id!, test_set_revision: Number(value.execution.test_set_revision),
    test_set_content_hash: value.execution.manifest_hash, definition_schema_version: 1, definition_id: item.definition_id,
  }))).execute()
  await db.insertInto('execution_events').values(events).execute()
  if (value.lock) await db.insertInto('execution_locks').values(value.lock).execute()
  await db.insertInto('runs').values(run).execute()
  if (results.length > 0) await db.insertInto('test_results').values(results).execute()
}

class RecordingAggregator extends PersistedEvidenceAggregator {
  readonly observations: string[] = []

  override aggregate(value: PersistedExecutionEvidence): PersistedEvidenceAggregation {
    const aggregation = super.aggregate(value)
    this.observations.push(JSON.stringify(aggregation))
    return aggregation
  }
}

before(async () => {
  initDb(DB_PATH)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

test('TD-ARCH-002-1 canonical weakest-truth matrix is failure-first and manifest-aware', () => {
  const cases: Array<{
    suffix: string
    outcomes: Outcome[]
    itemCount?: number
    run: Outcome | null
    execution: Outcome
  }> = [
    { suffix: 'single-pass', outcomes: ['passed'], run: 'passed', execution: 'passed' },
    { suffix: 'single-fail', outcomes: ['failed'], run: 'failed', execution: 'failed' },
    { suffix: 'single-cnv', outcomes: ['could_not_verify'], run: 'could_not_verify', execution: 'could_not_verify' },
    { suffix: 'pass-missing', outcomes: ['passed'], itemCount: 2, run: 'passed', execution: 'could_not_verify' },
    { suffix: 'fail-missing', outcomes: ['failed'], itemCount: 2, run: 'failed', execution: 'failed' },
    { suffix: 'multiple-pass', outcomes: ['passed', 'passed'], run: 'passed', execution: 'passed' },
    { suffix: 'multiple-fail', outcomes: ['failed', 'failed'], run: 'failed', execution: 'failed' },
    { suffix: 'mixed', outcomes: ['passed', 'failed'], run: 'failed', execution: 'failed' },
  ]
  for (const item of cases) {
    const aggregation = aggregatePersistedEvidence(evidence(
      item.suffix, item.outcomes, item.itemCount ?? item.outcomes.length,
    ))
    assert.equal(aggregation.run.outcome, item.run, item.suffix)
    assert.equal(aggregation.execution.outcome, item.execution, item.suffix)
  }
})

test('TD-ARCH-002-2 missing evidence is explicit and never fabricates a Result or success', () => {
  const source = evidence('missing', ['passed'], 2)
  const before = JSON.stringify(source)
  const aggregation = aggregatePersistedEvidence(source)
  assert.equal(aggregation.manifest.complete, false)
  assert.deepEqual(aggregation.manifest.missingItemOrdinals, [2])
  assert.equal(aggregation.execution.outcome, 'could_not_verify')
  assert.equal(aggregation.integrityWarnings.some(item => item.code === 'missing_expected_result'), true)
  assert.equal(source.results.length, 1)
  assert.equal(JSON.stringify(source), before)
})

test('TD-ARCH-002-3 failed evidence dominates missing and deterministic reason selection follows manifest order', () => {
  const source = evidence('dominance', ['passed', 'failed'], 3)
  const aggregation = aggregatePersistedEvidence(source)
  assert.equal(aggregation.execution.outcome, 'failed')
  assert.equal(aggregation.execution.reasonCode, 'oracle_failed_2')
  assert.equal(aggregation.run.outcome, 'failed')
  assert.deepEqual(aggregation.manifest.missingItemOrdinals, [3])
})

test('TD-ARCH-002-4 duplicate, manifest, provenance, legacy, lifecycle, and aggregate conflicts are detected without writes', () => {
  const duplicate = evidence('duplicate', ['passed'])
  duplicate.results.push({ ...duplicate.results[0] })
  assert.equal(aggregatePersistedEvidence(duplicate).integrityWarnings
    .some(item => item.code === 'duplicate_or_conflicting_result' && item.severity === 'error'), true)

  const manifest = evidence('manifest', ['passed'])
  manifest.results[0].executable_plan_hash = 'f'.repeat(64)
  assert.equal(aggregatePersistedEvidence(manifest).integrityWarnings
    .some(item => item.code === 'manifest_mismatch' && item.severity === 'error'), true)

  const provenance = evidence('provenance', ['passed'])
  provenance.results[0].browser = 'firefox'
  assert.equal(aggregatePersistedEvidence(provenance).integrityWarnings
    .some(item => item.code === 'conflicting_provenance' && item.severity === 'error'), true)

  const legacy = evidence('legacy', ['passed'])
  legacy.results[0].result_id = null
  assert.equal(aggregatePersistedEvidence(legacy).integrityWarnings
    .some(item => item.code === 'unsupported_legacy_evidence' && item.severity === 'error'), true)

  const lifecycle = evidence('lifecycle', ['passed'], 1, 'completed')
  lifecycle.lock = {
    project_id: lifecycle.execution.project_id,
    execution_id: lifecycle.execution.execution_id,
    process_instance_id: OWNER,
    acquired_at: ACCEPTED,
    last_heartbeat_at: iso(1),
  }
  assert.equal(aggregatePersistedEvidence(lifecycle).integrityWarnings
    .some(item => item.code === 'impossible_lifecycle_outcome' && item.severity === 'error'), true)

  const disagreement = evidence('disagreement', ['passed'], 1, 'completed')
  disagreement.runs[0].status = 'failed'
  disagreement.events.find(item => item.event_type === 'terminal')!.outcome = 'failed'
  const warnings = aggregatePersistedEvidence(disagreement).integrityWarnings.map(item => item.code)
  assert.equal(warnings.includes('run_aggregate_mismatch'), true)
  assert.equal(warnings.includes('execution_aggregate_mismatch'), true)
})

test('TD-PRODUCT-001-C-R1 malformed oracle detail invalidates integrity without changing outcome aggregation', () => {
  const source = evidence('oracle-detail-corrupt', ['passed'])
  source.items[0].oracle_kind = 'subject_observable'
  source.items[0].oracle_subject_id = 'subject-canonical'
  source.results[0].oracle_kind = 'subject_observable'
  source.results[0].observed_subject_id = 'subject-rogue'
  const aggregate = aggregatePersistedEvidence(source)
  assert.equal(aggregate.execution.outcome, 'passed')
  assert.equal(aggregate.integrityWarnings.some(item => item.code === 'conflicting_provenance' && item.severity === 'error'), true)

  const nonOracle = evidence('oracle-detail-not-performed', ['could_not_verify'])
  nonOracle.items[0].oracle_kind = 'subject_observable'
  nonOracle.items[0].oracle_subject_id = 'subject-canonical'
  nonOracle.results[0].oracle_kind = 'subject_observable'
  nonOracle.results[0].observed_subject_id = 'subject-canonical'
  const nonOracleAggregate = aggregatePersistedEvidence(nonOracle)
  assert.equal(nonOracleAggregate.execution.outcome, 'could_not_verify')
  assert.equal(nonOracleAggregate.integrityWarnings.some(item => item.code === 'conflicting_provenance' && item.severity === 'error'), true)
})

test('TD-ARCH-002-5 normal terminalization preserves failed dominance across a partial manifest', async () => {
  const source = evidence('normal-fail-missing', ['failed'], 2)
  await persist(source)
  const aggregate = await new ExecutionRunCoordinator().terminalize({
    executionId: source.execution.execution_id,
    projectId: source.execution.project_id,
    processInstanceId: OWNER,
    runId: source.runs[0].run_id,
    completedAt: iso(10),
  })
  assert.equal(aggregate.runOutcome, 'failed')
  assert.equal(aggregate.executionOutcome, 'failed')
  const terminal = await getDb().selectFrom('execution_events').selectAll()
    .where('execution_id', '=', source.execution.execution_id).where('event_type', '=', 'terminal')
    .executeTakeFirstOrThrow()
  assert.equal(terminal.outcome, 'failed')
  const projection = await new ExecutionResultProjectionService().read(
    source.execution.project_id, source.execution.execution_id,
  )
  assert.equal(projection.kind, 'ok')
  if (projection.kind === 'ok') assert.equal(projection.projection.headlineOutcome, 'failed')
})

test('TD-ARCH-002-6 recovery and cancellation consume the same failure-first aggregate', async () => {
  const recovering = evidence('recovery-fail-missing', ['failed'], 2)
  await persist(recovering)
  const recovered = await new ExecutionRecoveryCoordinator().reconcile({
    projectId: recovering.execution.project_id,
    executionId: recovering.execution.execution_id,
    currentProcessInstanceId: 'process-recovery',
    locallyActive: false,
    now: '2026-08-11T15:00:00.000Z',
    staleAfterMs: 1,
  })
  assert.equal(recovered.status?.state, 'interrupted')
  assert.equal(recovered.status?.outcome, 'failed')

  const cancelling = evidence('cancel-fail-missing', ['failed'], 2)
  cancelling.events.push({
    id: 2,
    execution_id: cancelling.execution.execution_id,
    project_id: cancelling.execution.project_id,
    event_type: 'cancellation_requested',
    outcome: null,
    occurred_at: iso(2),
    process_instance_id: OWNER,
    safe_code: 'cancellation_requested',
    safe_message: 'An operator requested cancellation.',
    execution_plan_hash: cancelling.execution.manifest_hash,
    lifecycle: 'cancellation_requested',
  })
  await persist(cancelling)
  const cancelled = await new ExecutionRunCoordinator().terminalizeCancellation({
    executionId: cancelling.execution.execution_id,
    projectId: cancelling.execution.project_id,
    processInstanceId: OWNER,
    runId: cancelling.runs[0].run_id,
    completedAt: iso(10),
  })
  assert.equal(cancelled?.runOutcome, 'failed')
  assert.equal(cancelled?.executionOutcome, 'failed')
})

test('TD-ARCH-002-7 terminalization, recovery, projection, status, and cancellation observe byte-identical aggregation from identical persistence', async () => {
  const source = evidence('cross-path', ['passed'])
  await persist(source)
  const executions = new ExecutionRepository(getDb)
  const runs = new RunRepository()
  const results = new TestResultRepository()
  const aggregator = new RecordingAggregator(getDb, executions, runs, results)
  const runCoordinator = new ExecutionRunCoordinator(
    getDb,
    runs,
    results,
    executions,
    () => 'unused-run-id',
    () => 'unused-result-id',
    aggregator,
  )
  const recovery = new ExecutionRecoveryCoordinator(getDb, executions, runs, results, aggregator)
  const projection = new ExecutionResultProjectionService(getDb, executions, runs, results, aggregator)

  await sql.raw(`CREATE TRIGGER td_arch_002_rollback BEFORE INSERT ON execution_events
    WHEN NEW.execution_id = '${source.execution.execution_id}' AND NEW.event_type = 'terminal'
    BEGIN SELECT RAISE(ABORT, 'forced invariant rollback'); END`).execute(getDb())
  await assert.rejects(runCoordinator.terminalize({
    executionId: source.execution.execution_id,
    projectId: source.execution.project_id,
    processInstanceId: OWNER,
    runId: source.runs[0].run_id,
    completedAt: iso(10),
  }), ProductTerminalizationError)
  await assert.rejects(runCoordinator.terminalizeCancellation({
    executionId: source.execution.execution_id,
    projectId: source.execution.project_id,
    processInstanceId: OWNER,
    runId: source.runs[0].run_id,
    completedAt: iso(10),
  }), ProductTerminalizationError)
  assert.equal((await projection.read(source.execution.project_id, source.execution.execution_id)).kind, 'ok')
  const recovered = await recovery.reconcile({
    projectId: source.execution.project_id,
    executionId: source.execution.execution_id,
    currentProcessInstanceId: OWNER,
    locallyActive: true,
    now: iso(2),
  })
  assert.equal(recovered.action, 'untouched_active')
  const service = new ExecutionService({ recovery, processInstanceId: OWNER } as any)
  const activeTokens = (service as any).cancellationTokens as Map<string, unknown>
  activeTokens.set(source.execution.execution_id, {
    projectId: source.execution.project_id,
    token: {},
  })
  const status = await service.readStatus(source.execution.project_id, source.execution.execution_id)
  assert.equal(status?.state, 'running')
  await sql.raw('DROP TRIGGER td_arch_002_rollback').execute(getDb())

  assert.ok(aggregator.observations.length >= 6)
  assert.equal(new Set(aggregator.observations).size, 1)
})

test('TD-ARCH-002-8 canonical aggregation is read-only and contains no runtime or secret input channel', async () => {
  const source = evidence('read-only', ['could_not_verify'])
  await persist(source)
  const before = await getDb().selectFrom('execution_events').selectAll()
    .where('execution_id', '=', source.execution.execution_id).execute()
  const aggregation = await new PersistedEvidenceAggregator().read(
    source.execution.project_id, source.execution.execution_id,
  )
  assert.equal(aggregation.kind, 'ok')
  const serialized = JSON.stringify(aggregation)
  for (const forbidden of ['username', 'password', 'token', 'cookie', 'storageState', 'executorMemory', 'currentExecutionState']) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false)
  }
  const afterRows = await getDb().selectFrom('execution_events').selectAll()
    .where('execution_id', '=', source.execution.execution_id).execute()
  assert.deepEqual(afterRows, before)
})

test('TD-ARCH-002-9 Product callers retain one implementation owner', () => {
  const readSource = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  const runCoordinator = readSource('src/core/execution/ExecutionRunCoordinator.ts')
  const recovery = readSource('src/core/execution/ExecutionRecoveryCoordinator.ts')
  const projection = readSource('src/core/execution/ExecutionResultProjectionService.ts')
  const service = readSource('src/core/execution/ExecutionService.ts')
  const repository = readSource('src/core/storage/repositories/ExecutionRepository.ts')

  for (const source of [runCoordinator, recovery, projection]) {
    assert.match(source, /PersistedEvidenceAggregator/)
    assert.match(source, /this\.aggregator\.read/)
    assert.doesNotMatch(source, /function\s+(aggregateResults|weakestOutcome|resultAggregate)/)
  }
  assert.match(service, /this\.recovery\.reconcile/)
  assert.doesNotMatch(repository, /\breadExecution\s*\(/)
})
