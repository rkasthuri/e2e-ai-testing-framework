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

import * as crypto from 'crypto'
import type { Kysely, Transaction } from 'kysely'
import { getDb } from '../storage/db'
import type {
  Database,
  Execution,
  ExecutionEvent,
  ExecutionItem,
  ExecutionLock,
  Run,
  TestResult,
} from '../storage/types'
import {
  ExecutionPersistenceError,
  ExecutionRepository,
  type ProductEvidenceOutcome,
} from '../storage/repositories/ExecutionRepository'
import { RunRepository } from '../storage/repositories/RunRepository'
import { TestResultRepository } from '../storage/repositories/TestResultRepository'

export type PersistedExecutionLifecycle =
  | 'running'
  | 'cancellation_requested'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

export type PersistedRunLifecycle =
  | 'not_admitted'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

export type PersistedEvidenceIntegrityCode =
  | 'missing_expected_result'
  | 'duplicate_or_conflicting_result'
  | 'manifest_mismatch'
  | 'run_aggregate_mismatch'
  | 'execution_aggregate_mismatch'
  | 'missing_linked_run'
  | 'impossible_lifecycle_outcome'
  | 'unsupported_legacy_evidence'
  | 'conflicting_provenance'

export interface PersistedEvidenceIntegrityWarning {
  code: PersistedEvidenceIntegrityCode
  severity: 'warning' | 'error'
  safeMessage: string
}

export interface PersistedExecutionEvidence {
  execution: Execution
  items: ExecutionItem[]
  events: ExecutionEvent[]
  lock: ExecutionLock | null
  runs: Run[]
  results: TestResult[]
}

export interface PersistedEvidenceAggregation {
  schemaVersion: 'forge-persisted-evidence-aggregation/v1'
  executionId: string
  projectId: string
  manifest: {
    expectedResultCount: number
    observedResultCount: number
    complete: boolean
    missingItemOrdinals: number[]
  }
  counts: {
    passed: number
    failed: number
    couldNotVerify: number
  }
  run: {
    runId: string | null
    lifecycle: PersistedRunLifecycle
    outcome: ProductEvidenceOutcome | null
    /** Outcome to persist if this admitted Run terminalizes now; absence defaults to could_not_verify. */
    terminalOutcome: ProductEvidenceOutcome | null
    reasonCode: string | null
    durationMs: number
  }
  execution: {
    lifecycle: PersistedExecutionLifecycle
    outcome: ProductEvidenceOutcome
    reasonCode: string
    persistedReasonCode: string | null
    terminal: boolean
    acceptedAt: string
    terminalAt: string | null
    lastHeartbeatAt: string | null
    processInstanceId: string
    safeMessage: string
    executionPlanHash: string
  }
  integrityState: 'valid' | 'warning' | 'invalid'
  integrityWarnings: PersistedEvidenceIntegrityWarning[]
}

export type PersistedEvidenceRead =
  | { kind: 'not_found' }
  | {
      kind: 'ok'
      evidence: PersistedExecutionEvidence
      aggregation: PersistedEvidenceAggregation
    }

export interface DurableExecutionRead {
  executionId: string
  projectId: string
  state: PersistedExecutionLifecycle
  outcome: ProductEvidenceOutcome | null
  terminal: boolean
  startedAt: string
  completedAt: string | null
  lastHeartbeatAt: string | null
  processInstanceId: string
  safeCode: string | null
  safeMessage: string
  executionPlanHash: string
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SAFE_REASON = /^[a-z][a-z0-9_]{0,99}$/
const SHA256 = /^[a-f0-9]{64}$/
const OUTCOMES = new Set<ProductEvidenceOutcome>(['passed', 'failed', 'could_not_verify'])
const WARNING_ORDER: PersistedEvidenceIntegrityCode[] = [
  'conflicting_provenance',
  'manifest_mismatch',
  'duplicate_or_conflicting_result',
  'unsupported_legacy_evidence',
  'impossible_lifecycle_outcome',
  'missing_linked_run',
  'missing_expected_result',
  'run_aggregate_mismatch',
  'execution_aggregate_mismatch',
]

const WARNING_MESSAGES: Record<PersistedEvidenceIntegrityCode, string> = {
  missing_expected_result: 'At least one immutable manifest item has no persisted Product Result evidence.',
  duplicate_or_conflicting_result: 'Persisted Product Results contain duplicate or conflicting identity.',
  manifest_mismatch: 'Persisted Product Result provenance does not match the immutable execution manifest.',
  run_aggregate_mismatch: 'The stored Product Run aggregate disagrees with canonical persisted-evidence aggregation.',
  execution_aggregate_mismatch: 'The stored Execution terminal outcome disagrees with canonical persisted-evidence aggregation.',
  missing_linked_run: 'The persisted Execution lifecycle requires a linked Product Run, but none exists.',
  impossible_lifecycle_outcome: 'Persisted lifecycle and outcome evidence cannot form a truthful Product lifecycle.',
  unsupported_legacy_evidence: 'A Product-linked record uses a legacy-only evidence shape.',
  conflicting_provenance: 'Persisted Execution, Run, Result, event, or lock provenance conflicts.',
}

function exactIso(value: string | null): value is string {
  if (value === null) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function manifestHash(items: ExecutionItem[]): string {
  if (items.length === 1) return items[0].executable_plan_hash
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    planFingerprints: items.map(item => item.executable_plan_hash),
  })).digest('hex')
}

/** Legacy execution-event vocabulary is translated once at this input boundary. */
function canonicalTerminalOutcome(event: ExecutionEvent): ProductEvidenceOutcome | null {
  if (OUTCOMES.has(event.outcome as ProductEvidenceOutcome)) {
    return event.outcome as ProductEvidenceOutcome
  }
  if (event.outcome === 'completed') return 'passed'
  if (event.outcome === 'oracle_failed') return 'failed'
  if (event.outcome !== null) return 'could_not_verify'
  return null
}

/** Pre-023 terminal rows are translated once; canonical callers see only this lifecycle. */
function canonicalTerminalLifecycle(event: ExecutionEvent): 'completed' | 'cancelled' | 'interrupted' {
  if (event.lifecycle === 'completed' || event.lifecycle === 'cancelled' || event.lifecycle === 'interrupted') {
    return event.lifecycle
  }
  if (event.safe_code?.startsWith('cancelled_')) return 'cancelled'
  if (event.safe_code?.startsWith('interrupted_') || event.outcome === 'interrupted') return 'interrupted'
  return 'completed'
}

function canonicalRunLifecycle(value: string): PersistedRunLifecycle {
  return value === 'running' || value === 'completed' || value === 'cancelled' || value === 'interrupted'
    ? value
    : 'unknown'
}

function canonicalResultOutcome(value: string): ProductEvidenceOutcome | null {
  return OUTCOMES.has(value as ProductEvidenceOutcome) ? value as ProductEvidenceOutcome : null
}

function sortedResults(results: TestResult[]): TestResult[] {
  return [...results].sort((left, right) => {
    const ordinal = Number(left.execution_item_ordinal ?? Number.MAX_SAFE_INTEGER)
      - Number(right.execution_item_ordinal ?? Number.MAX_SAFE_INTEGER)
    if (ordinal !== 0) return ordinal
    return String(left.result_id ?? '').localeCompare(String(right.result_id ?? ''))
  })
}

function integrityState(warnings: PersistedEvidenceIntegrityWarning[]): 'valid' | 'warning' | 'invalid' {
  return warnings.some(item => item.severity === 'error')
    ? 'invalid'
    : warnings.length > 0 ? 'warning' : 'valid'
}

export function hasInvalidPersistedEvidence(aggregation: PersistedEvidenceAggregation): boolean {
  return aggregation.integrityState === 'invalid'
}

/**
 * The sole Product aggregation algorithm. It is deterministic, reads only
 * persisted evidence, and never mutates or repairs any source record.
 *
 * Dominance and tie-breaks:
 * 1. the first manifest-ordered persisted failure supplies failed truth/reason;
 * 2. otherwise the first manifest-ordered could_not_verify supplies the reason;
 * 3. otherwise a manifest gap supplies expected_result_missing;
 * 4. only a complete all-passing manifest supplies passed/completed.
 */
export function aggregatePersistedEvidence(evidence: PersistedExecutionEvidence): PersistedEvidenceAggregation {
  const { execution: root, items, events, lock, runs, results } = evidence
  const findings = new Map<PersistedEvidenceIntegrityCode, 'warning' | 'error'>()
  const add = (code: PersistedEvidenceIntegrityCode, severity: 'warning' | 'error') => {
    if (findings.get(code) === 'error') return
    findings.set(code, severity)
  }

  if (!SAFE_ID.test(root.execution_id) || !SAFE_ID.test(root.project_id) || !exactIso(root.accepted_at)
    || !SAFE_ID.test(root.test_set_id) || !Number.isSafeInteger(Number(root.test_set_revision))
    || Number(root.test_set_revision) < 1 || !Number.isSafeInteger(Number(root.model_row_id))
    || Number(root.model_row_id) < 1
    || Number(root.definition_schema_version) === 1 && (!root.source_observation_id || !SAFE_ID.test(root.source_observation_id))
    || Number(root.definition_schema_version) === 2 && (root.source_observation_id !== null
      || !SHA256.test(root.support_seal_hash ?? '') || !SHA256.test(root.route_evidence_identity_hash ?? '')
      || !SHA256.test(root.authentication_expectation_identity_hash ?? ''))
    || ![1, 2].includes(Number(root.definition_schema_version))
    || !SHA256.test(root.manifest_hash) || Number(root.max_run_attempts) !== 1
    || root.dispatch_mode !== 'serial' || root.stop_rule !== 'stop_on_first_non_completed') {
    add('conflicting_provenance', 'error')
  }

  if (items.length < 1 || items.some((item, index) => item.execution_id !== root.execution_id
    || Number(item.item_ordinal) !== index + 1 || !SAFE_ID.test(item.definition_id)
    || !SHA256.test(item.executable_plan_hash))
    || new Set(items.map(item => item.definition_id)).size !== items.length
    || items.length > 0 && manifestHash(items) !== root.manifest_hash) {
    add('manifest_mismatch', 'error')
  }

  const startedEvents = events.filter(event => event.event_type === 'started')
  const cancellationEvents = events.filter(event => event.event_type === 'cancellation_requested')
  const terminalEvents = events.filter(event => event.event_type === 'terminal')
  if (startedEvents.length !== 1 || cancellationEvents.length > 1 || terminalEvents.length > 1
    || events.some(event => !['started', 'cancellation_requested', 'terminal'].includes(event.event_type))) {
    add('impossible_lifecycle_outcome', 'error')
  }
  const started = startedEvents[0] ?? null
  const cancellation = cancellationEvents[0] ?? null
  const terminal = terminalEvents[0] ?? null
  if (!started || started.execution_id !== root.execution_id || started.project_id !== root.project_id
    || started.outcome !== null || started.safe_code !== null
    || started.lifecycle !== null && started.lifecycle !== 'accepted'
    || !exactIso(started.occurred_at) || started.occurred_at !== root.accepted_at
    || !SAFE_ID.test(started.process_instance_id) || started.execution_plan_hash !== root.manifest_hash
    || started.safe_message.length < 1 || started.safe_message.length > 500) {
    add('conflicting_provenance', 'error')
  }
  if (cancellation && (cancellation.execution_id !== root.execution_id
    || cancellation.project_id !== root.project_id || cancellation.lifecycle !== 'cancellation_requested'
    || cancellation.outcome !== null || cancellation.safe_code !== 'cancellation_requested'
    || !exactIso(cancellation.occurred_at) || cancellation.occurred_at < root.accepted_at
    || !SAFE_ID.test(cancellation.process_instance_id)
    || cancellation.execution_plan_hash !== root.manifest_hash
    || cancellation.safe_message.length < 1 || cancellation.safe_message.length > 500)) {
    add('conflicting_provenance', 'error')
  }
  if (terminal && (terminal.execution_id !== root.execution_id || terminal.project_id !== root.project_id
    || canonicalTerminalOutcome(terminal) === null || !exactIso(terminal.occurred_at)
    || terminal.occurred_at < root.accepted_at || !SAFE_ID.test(terminal.process_instance_id)
    || !terminal.safe_code || !SAFE_REASON.test(terminal.safe_code)
    || terminal.execution_plan_hash !== root.manifest_hash
    || terminal.safe_message.length < 1 || terminal.safe_message.length > 500
    || cancellation && terminal.occurred_at < cancellation.occurred_at)) {
    add('conflicting_provenance', 'error')
  }
  const terminalLifecycle = terminal ? canonicalTerminalLifecycle(terminal) : null
  if (terminal && (terminalLifecycle === 'cancelled') !== Boolean(cancellation)) {
    add('impossible_lifecycle_outcome', 'error')
  }
  if (terminal && lock) add('impossible_lifecycle_outcome', 'error')
  if (lock && (!started || lock.execution_id !== root.execution_id || lock.project_id !== root.project_id
    || lock.process_instance_id !== started.process_instance_id || !exactIso(lock.acquired_at)
    || !exactIso(lock.last_heartbeat_at) || lock.acquired_at < root.accepted_at
    || lock.last_heartbeat_at < lock.acquired_at)) {
    add('conflicting_provenance', 'error')
  }

  if (runs.length > 1) add('conflicting_provenance', 'error')
  const run = runs[0] ?? null
  const runLifecycle = run ? canonicalRunLifecycle(run.lifecycle) : 'not_admitted'
  if (run && (run.origin !== 'product' || run.execution_id !== root.execution_id
    || run.app_name !== root.project_id || Number(run.attempt_ordinal) !== 1
    || Number(run.total_tests) !== items.length || !exactIso(run.started_at)
    || run.started_at < root.accepted_at || runLifecycle === 'unknown')) {
    add('conflicting_provenance', 'error')
  }
  if (terminalLifecycle === 'completed' && !run) add('missing_linked_run', 'error')
  if (terminal && run && runLifecycle !== terminalLifecycle) {
    add('impossible_lifecycle_outcome', 'error')
  }

  const resultIds = results.map(result => result.result_id)
  const resultOrdinals = results.map(result => result.execution_item_ordinal)
  if (resultIds.some(value => value === null) || resultOrdinals.some(value => value === null)) {
    add('unsupported_legacy_evidence', 'error')
  }
  if (new Set(resultIds).size !== resultIds.length || new Set(resultOrdinals).size !== resultOrdinals.length) {
    add('duplicate_or_conflicting_result', 'error')
  }
  const itemsByOrdinal = new Map(items.map(item => [Number(item.item_ordinal), item]))
  for (const item of items) {
    if (item.oracle_kind !== null && item.oracle_kind !== 'subject_observable'
      || item.oracle_subject_id !== null && !SAFE_ID.test(item.oracle_subject_id)
      || (item.oracle_kind === null) !== (item.oracle_subject_id === null)) {
      add('conflicting_provenance', 'error')
    }
  }
  for (const result of results) {
    const item = itemsByOrdinal.get(Number(result.execution_item_ordinal))
    if (!item || !run || result.run_id !== run.run_id || result.test_id !== item.definition_id
      || result.definition_id !== item.definition_id
      || result.executable_plan_hash !== item.executable_plan_hash) {
      add('manifest_mismatch', 'error')
    }
    if (result.result_id === null || !SAFE_ID.test(result.result_id)
      || canonicalResultOutcome(result.status) === null || !exactIso(result.started_at)
      || !Number.isSafeInteger(Number(result.duration_ms)) || Number(result.duration_ms) < 0
      || !result.error_msg || !SAFE_REASON.test(result.error_msg)
      || result.suite !== 'product-execution' || result.browser !== 'chromium' || result.tier !== 'ui'
      || result.screenshot_path !== null || result.video_path !== null
      || result.tags !== '[]' || result.metadata !== '{}'
      || result.oracle_kind !== null && result.oracle_kind !== 'subject_observable'
      || result.observed_subject_id !== null && !SAFE_ID.test(result.observed_subject_id)
      || (result.oracle_kind === null) !== (result.observed_subject_id === null)) {
      add('conflicting_provenance', 'error')
    }
    const performedOracle = result.status === 'passed' && result.error_msg === 'completed'
      || result.status === 'failed' && result.error_msg === 'oracle_failed'
    if (result.oracle_kind !== null && (!performedOracle || !item
      || item.oracle_kind !== result.oracle_kind
      || item.oracle_subject_id !== result.observed_subject_id)) {
      add('conflicting_provenance', 'error')
    }
    if (item?.oracle_kind !== null && performedOracle && result.oracle_kind === null) {
      add('conflicting_provenance', 'error')
    }
  }

  const ordered = sortedResults(results)
  const recognized = ordered.filter(result => canonicalResultOutcome(result.status) !== null)
  const passedResults = recognized.filter(result => result.status === 'passed')
  const failedResults = recognized.filter(result => result.status === 'failed')
  const couldNotVerifyResults = recognized.filter(result => result.status === 'could_not_verify')
  const observedOrdinals = new Set(recognized.map(result => Number(result.execution_item_ordinal)))
  const missingItemOrdinals = items.map(item => Number(item.item_ordinal))
    .filter(ordinal => !observedOrdinals.has(ordinal))
  const complete = missingItemOrdinals.length === 0 && recognized.length === items.length
  if (!complete) add('missing_expected_result', 'warning')

  const observedRunOutcome: ProductEvidenceOutcome | null = run === null || recognized.length === 0
    ? null
    : failedResults.length > 0
      ? 'failed'
      : couldNotVerifyResults.length > 0
        ? 'could_not_verify'
        : 'passed'
  const terminalRunOutcome: ProductEvidenceOutcome | null = run === null
    ? null
    : observedRunOutcome ?? 'could_not_verify'
  const runOutcome = observedRunOutcome ?? (runLifecycle === 'cancelled' ? terminalRunOutcome : null)
  const executionOutcome: ProductEvidenceOutcome = failedResults.length > 0
    ? 'failed'
    : couldNotVerifyResults.length > 0 || !complete
      ? 'could_not_verify'
      : 'passed'
  const firstFailureReason = failedResults[0]?.error_msg ?? null
  const firstCouldNotVerifyReason = couldNotVerifyResults[0]?.error_msg ?? null
  const runReason = runOutcome === null
    ? null
    : runOutcome === 'failed'
      ? firstFailureReason!
      : runOutcome === 'could_not_verify'
        ? firstCouldNotVerifyReason ?? 'expected_result_missing'
        : 'completed'
  const executionReason = executionOutcome === 'failed'
    ? firstFailureReason!
    : executionOutcome === 'could_not_verify'
      ? firstCouldNotVerifyReason ?? 'expected_result_missing'
      : 'completed'

  if (run && runLifecycle !== 'running') {
    const expectedStoredStatus = runLifecycle === 'interrupted' && recognized.length === 0
      ? 'unknown'
      : runLifecycle === 'completed' || runLifecycle === 'cancelled'
        ? terminalRunOutcome
        : runOutcome
    const expectedDuration = (runLifecycle === 'completed' || runLifecycle === 'cancelled')
      && exactIso(run.completed_at)
      ? Math.max(0, Date.parse(run.completed_at) - Date.parse(run.started_at))
      : recognized.reduce((total, result) => total + Number(result.duration_ms), 0)
    if (run.status !== expectedStoredStatus || Number(run.passed) !== passedResults.length
      || Number(run.failed) !== failedResults.length || Number(run.skipped) !== couldNotVerifyResults.length
      || Number(run.duration_ms) !== expectedDuration
      || runLifecycle === 'completed' && !exactIso(run.completed_at)
      || runLifecycle === 'cancelled' && !exactIso(run.completed_at)
      || runLifecycle === 'interrupted' && run.completed_at !== null) {
      add('run_aggregate_mismatch', 'warning')
    }
  }
  const persistedExecutionOutcome = terminal ? canonicalTerminalOutcome(terminal) : null
  if (terminal && persistedExecutionOutcome !== executionOutcome) {
    add('execution_aggregate_mismatch', 'warning')
  }

  const lifecycle: PersistedExecutionLifecycle = terminalLifecycle
    ?? (cancellation ? 'cancellation_requested' : lock ? 'running' : 'unknown')
  const currentEvent = terminal ?? cancellation ?? started
  const warnings = WARNING_ORDER
    .filter(code => findings.has(code))
    .map(code => ({ code, severity: findings.get(code)!, safeMessage: WARNING_MESSAGES[code] }))

  return {
    schemaVersion: 'forge-persisted-evidence-aggregation/v1',
    executionId: root.execution_id,
    projectId: root.project_id,
    manifest: {
      expectedResultCount: items.length,
      observedResultCount: results.length,
      complete,
      missingItemOrdinals,
    },
    counts: {
      passed: passedResults.length,
      failed: failedResults.length,
      couldNotVerify: couldNotVerifyResults.length,
    },
    run: {
      runId: run?.run_id ?? null,
      lifecycle: runLifecycle,
      outcome: runOutcome,
      terminalOutcome: terminalRunOutcome,
      reasonCode: runReason,
      durationMs: recognized.reduce((total, result) => total + Number(result.duration_ms), 0),
    },
    execution: {
      lifecycle,
      outcome: executionOutcome,
      reasonCode: executionReason,
      persistedReasonCode: currentEvent?.safe_code ?? null,
      terminal: terminal !== null,
      acceptedAt: root.accepted_at,
      terminalAt: terminal?.occurred_at ?? null,
      lastHeartbeatAt: lock?.last_heartbeat_at ?? null,
      processInstanceId: currentEvent?.process_instance_id ?? '',
      safeMessage: currentEvent?.safe_message ?? 'Persisted execution lifecycle evidence is unavailable.',
      executionPlanHash: root.manifest_hash,
    },
    integrityState: integrityState(warnings),
    integrityWarnings: warnings,
  }
}

/** Read-only cross-repository evidence loader and canonical aggregation owner. */
export class PersistedEvidenceAggregator {
  constructor(
    private readonly dbProvider: () => Kysely<Database> = getDb,
    private readonly executions = new ExecutionRepository(dbProvider),
    private readonly runs = new RunRepository(),
    private readonly results = new TestResultRepository(),
  ) {}

  aggregate(evidence: PersistedExecutionEvidence): PersistedEvidenceAggregation {
    return aggregatePersistedEvidence(evidence)
  }

  async read(
    projectId: string,
    executionId: string,
    trx?: Transaction<Database>,
  ): Promise<PersistedEvidenceRead> {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(executionId)) {
      throw new ExecutionPersistenceError('Persisted evidence aggregation identity is malformed.')
    }
    if (!trx) {
      return this.dbProvider().transaction().execute(transaction => this.read(projectId, executionId, transaction))
    }
    const source = await this.executions.readProjectionSnapshot(projectId, executionId, trx)
    if (!source.execution) return { kind: 'not_found' }
    const runs = await this.runs.findProductByExecution(executionId, trx)
    const resultGroups = await Promise.all(runs.map(run => this.results.findByRun(run.run_id, trx)))
    const evidence: PersistedExecutionEvidence = {
      ...source,
      execution: source.execution,
      runs,
      results: resultGroups.flat(),
    }
    return { kind: 'ok', evidence, aggregation: this.aggregate(evidence) }
  }

  async readStatus(projectId: string, executionId: string): Promise<DurableExecutionRead | null> {
    const read = await this.read(projectId, executionId)
    if (read.kind === 'not_found') return null
    if (hasInvalidPersistedEvidence(read.aggregation)) {
      throw new ExecutionPersistenceError('Persisted execution evidence is integrity-invalid.')
    }
    const value = read.aggregation
    return {
      executionId: value.executionId,
      projectId: value.projectId,
      state: value.execution.lifecycle,
      outcome: value.execution.terminal ? value.execution.outcome : null,
      terminal: value.execution.terminal,
      startedAt: value.execution.acceptedAt,
      completedAt: value.execution.terminalAt,
      lastHeartbeatAt: value.execution.lastHeartbeatAt,
      processInstanceId: value.execution.processInstanceId,
      safeCode: value.execution.persistedReasonCode,
      safeMessage: value.execution.safeMessage,
      executionPlanHash: value.execution.executionPlanHash,
    }
  }
}

export const persistedEvidenceAggregator = new PersistedEvidenceAggregator()
