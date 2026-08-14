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

import type { Kysely } from 'kysely'
import { getDb } from '../storage/db'
import type { Database } from '../storage/types'
import {
  EXECUTION_STALE_AFTER_MS,
  ExecutionPersistenceError,
  ExecutionRepository,
  type ProductEvidenceOutcome,
} from '../storage/repositories/ExecutionRepository'
import { RunRepository } from '../storage/repositories/RunRepository'
import { TestResultRepository } from '../storage/repositories/TestResultRepository'
import {
  PersistedEvidenceAggregator,
  type DurableExecutionRead,
  type PersistedEvidenceAggregation,
} from './PersistedEvidenceAggregator'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

export type ExecutionRecoveryRefusalCode =
  | 'ambiguous_history'
  | 'duplicate_results'
  | 'manifest_mismatch'
  | 'conflicting_provenance'
  | 'invalid_lifecycle'
  | 'recovery_persistence_failed'

export type ExecutionRecoveryAction =
  | 'not_found'
  | 'untouched_active'
  | 'already_terminal'
  | 'recovered'

export interface ExecutionRecoveryDecision {
  action: ExecutionRecoveryAction
  status: DurableExecutionRead | null
}

export interface ExecutionRecoveryInput {
  projectId: string
  executionId: string
  currentProcessInstanceId: string
  locallyActive: boolean
  now: string
  staleAfterMs?: number
}

export class ExecutionRecoveryRefusedError extends Error {
  constructor(readonly code: ExecutionRecoveryRefusalCode) {
    super('Persisted execution evidence is not safe to reconcile automatically.')
    this.name = 'ExecutionRecoveryRefusedError'
  }
}

function exactIso(value: string | null): value is string {
  if (value === null) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function safeMessage(outcome: ProductEvidenceOutcome, interrupted: boolean, cancelled = false): string {
  if (cancelled) return 'The execution was cancelled by operator request; its outcome reflects only persisted Result evidence and manifest gaps.'
  if (interrupted) return 'The execution was interrupted; its outcome reflects only persisted Result evidence and manifest gaps.'
  if (outcome === 'passed') return 'Recovery completed the lifecycle from a complete persisted passing Result set.'
  if (outcome === 'failed') return 'Recovery completed the lifecycle from persisted failing Result evidence.'
  return 'Recovery completed the lifecycle without enough persisted evidence to verify every expected item.'
}

function refuseForAggregation(aggregation: PersistedEvidenceAggregation): void {
  const refusal = aggregation.integrityWarnings.find(item => item.code !== 'missing_expected_result')
  if (!refusal) return
  if (refusal.code === 'duplicate_or_conflicting_result') {
    throw new ExecutionRecoveryRefusedError('duplicate_results')
  }
  if (refusal.code === 'manifest_mismatch') {
    throw new ExecutionRecoveryRefusedError('manifest_mismatch')
  }
  if (refusal.code === 'conflicting_provenance' || refusal.code === 'unsupported_legacy_evidence') {
    throw new ExecutionRecoveryRefusedError('conflicting_provenance')
  }
  throw new ExecutionRecoveryRefusedError('invalid_lifecycle')
}

/**
 * Sole recovery owner. It owns no table: all reads and writes are delegated to
 * the established Execution, Run, and Test Result repositories inside one
 * transaction. Missing Result evidence is represented only in aggregates.
 */
export class ExecutionRecoveryCoordinator {
  constructor(
    private readonly dbProvider: () => Kysely<Database> = getDb,
    private readonly executions = new ExecutionRepository(dbProvider),
    private readonly runs = new RunRepository(),
    private readonly results = new TestResultRepository(),
    private readonly aggregator = new PersistedEvidenceAggregator(dbProvider, executions, runs, results),
  ) {}

  async reconcile(input: ExecutionRecoveryInput): Promise<ExecutionRecoveryDecision> {
    const staleAfterMs = input.staleAfterMs ?? EXECUTION_STALE_AFTER_MS
    if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.executionId)
      || !SAFE_ID.test(input.currentProcessInstanceId) || !exactIso(input.now)
      || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) {
      throw new ExecutionRecoveryRefusedError('ambiguous_history')
    }
    let action: ExecutionRecoveryAction
    try {
      action = await this.dbProvider().transaction().execute(async trx => {
        const read = await this.aggregator.read(input.projectId, input.executionId, trx)
        if (read.kind === 'not_found') {
          return 'not_found'
        }
        const snapshot = read.evidence
        const aggregate = read.aggregation
        refuseForAggregation(aggregate)
        const run = snapshot.runs[0] ?? null
        const persistedResults = snapshot.results

        const lock = snapshot.lock
        const stale = lock !== null && Date.parse(input.now) - Date.parse(lock.last_heartbeat_at) >= staleAfterMs
        const healthyOwner = lock !== null && (
          lock.process_instance_id === input.currentProcessInstanceId
            ? input.locallyActive
            : !stale
        )

        if (aggregate.execution.terminal) {
          if (!lock) return 'already_terminal'
          if (healthyOwner) throw new ExecutionRecoveryRefusedError('invalid_lifecycle')
          await this.executions.releaseRecoveredLock(
            input.projectId, input.executionId, lock.process_instance_id, trx,
          )
          return 'recovered'
        }

        if (healthyOwner) return 'untouched_active'
        if (Date.parse(input.now) < Date.parse(snapshot.execution.accepted_at)) {
          throw new ExecutionRecoveryRefusedError('ambiguous_history')
        }

        if (aggregate.execution.lifecycle === 'cancellation_requested') {
          let outcome: ProductEvidenceOutcome = aggregate.execution.outcome
          let reasonCode = 'cancelled_before_execution'
          if (run) {
            if (run.lifecycle === 'running') {
              const runOutcome: ProductEvidenceOutcome = aggregate.run.terminalOutcome!
              outcome = aggregate.execution.outcome
              reasonCode = persistedResults.length === 0 ? 'cancelled_before_execution' : 'cancelled_by_request'
              await this.runs.reconcileProduct(run.run_id, {
                lifecycle: 'cancelled', status: runOutcome,
                passed: aggregate.counts.passed, failed: aggregate.counts.failed, skipped: aggregate.counts.couldNotVerify,
                duration_ms: Math.max(0, Date.parse(input.now) - Date.parse(run.started_at)), completed_at: input.now,
              }, trx)
            } else if (run.lifecycle === 'cancelled') {
              outcome = aggregate.execution.outcome
              reasonCode = persistedResults.length === 0 ? 'cancelled_before_execution' : 'cancelled_by_request'
            } else {
              throw new ExecutionRecoveryRefusedError('invalid_lifecycle')
            }
          }
          await this.executions.terminalizeRecoveredExecution({
            projectId: input.projectId,
            executionId: input.executionId,
            recoveryProcessInstanceId: input.currentProcessInstanceId,
            expectedLockProcessInstanceId: lock?.process_instance_id ?? null,
            completedAt: input.now,
            outcome,
            lifecycle: 'cancelled',
            safeCode: reasonCode,
            safeMessage: safeMessage(outcome, false, true),
          }, trx)
          return 'recovered'
        }

        let outcome: ProductEvidenceOutcome = aggregate.execution.outcome
        let reasonCode = 'interrupted_before_dispatch'
        let interrupted = true
        if (run) {
          if (run.lifecycle === 'running') {
            if (persistedResults.length === 0) {
              reasonCode = 'interrupted_before_result'
              await this.runs.reconcileProduct(run.run_id, {
                lifecycle: 'interrupted', status: 'unknown', passed: 0, failed: 0, skipped: 0,
                duration_ms: 0, completed_at: null,
              }, trx)
            } else if (!aggregate.manifest.complete) {
              outcome = aggregate.execution.outcome
              reasonCode = 'interrupted_incomplete_manifest'
              await this.runs.reconcileProduct(run.run_id, {
                lifecycle: 'interrupted', status: aggregate.run.terminalOutcome!,
                passed: aggregate.counts.passed, failed: aggregate.counts.failed, skipped: aggregate.counts.couldNotVerify,
                duration_ms: aggregate.run.durationMs, completed_at: null,
              }, trx)
            } else {
              outcome = aggregate.execution.outcome
              reasonCode = aggregate.execution.reasonCode
              interrupted = false
              await this.runs.reconcileProduct(run.run_id, {
                lifecycle: 'completed', status: aggregate.run.terminalOutcome!,
                passed: aggregate.counts.passed, failed: aggregate.counts.failed, skipped: aggregate.counts.couldNotVerify,
                duration_ms: Math.max(0, Date.parse(input.now) - Date.parse(run.started_at)), completed_at: input.now,
              }, trx)
            }
          } else {
            outcome = aggregate.execution.outcome
            interrupted = run.lifecycle === 'interrupted'
            reasonCode = interrupted
              ? aggregate.manifest.complete ? 'interrupted_after_results' : 'interrupted_incomplete_manifest'
              : aggregate.execution.reasonCode
          }
        }

        await this.executions.terminalizeRecoveredExecution({
          projectId: input.projectId,
          executionId: input.executionId,
          recoveryProcessInstanceId: input.currentProcessInstanceId,
          expectedLockProcessInstanceId: lock?.process_instance_id ?? null,
          completedAt: input.now,
          outcome,
          lifecycle: interrupted ? 'interrupted' : 'completed',
          safeCode: reasonCode,
          safeMessage: safeMessage(outcome, interrupted),
        }, trx)
        return 'recovered'
      })
    } catch (cause) {
      if (cause instanceof ExecutionRecoveryRefusedError) throw cause
      if (cause instanceof ExecutionPersistenceError) {
        throw new ExecutionRecoveryRefusedError('conflicting_provenance')
      }
      throw new ExecutionRecoveryRefusedError('recovery_persistence_failed')
    }
    return { action, status: action === 'not_found' ? null : await this.aggregator.readStatus(input.projectId, input.executionId) }
  }

  async reconcileProject(input: Omit<ExecutionRecoveryInput, 'executionId'>): Promise<ExecutionRecoveryDecision | null> {
    const lock = await this.executions.readProjectLock(input.projectId)
    if (!lock) return null
    return this.reconcile({ ...input, executionId: lock.execution_id })
  }
}
