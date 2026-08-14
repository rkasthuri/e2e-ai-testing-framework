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

import type { Kysely, Transaction } from 'kysely'
import { getDb } from '../storage/db'
import { ExecutionPersistenceError, ExecutionRepository } from '../storage/repositories/ExecutionRepository'
import { RunRepository } from '../storage/repositories/RunRepository'
import { TestResultRepository } from '../storage/repositories/TestResultRepository'
import type { Database } from '../storage/types'
import {
  PersistedEvidenceAggregator,
  type PersistedEvidenceIntegrityCode,
  type PersistedEvidenceIntegrityWarning,
  type PersistedEvidenceRead,
} from './PersistedEvidenceAggregator'

export type ProjectionOutcome = 'passed' | 'failed' | 'could_not_verify'
export type ProjectionLifecycle =
  | 'accepted'
  | 'running'
  | 'cancellation_requested'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

export type ProjectionIntegrityCode = PersistedEvidenceIntegrityCode
export interface ProjectionIntegrityWarning extends PersistedEvidenceIntegrityWarning {}

export interface PersistedResultProjection {
  state: 'result_observed'
  resultId: string
  outcome: ProjectionOutcome
  reasonCode: string
  /** No governed result message is currently persisted; absence remains explicit. */
  safeMessage: null
  durationMs: number
  /** Migration 021/022 did not persist these observations. They are never inferred. */
  oracleKind: null
  observedSubjectId: null
}

export interface MissingResultProjection {
  state: 'no_result_observed'
  reasonCode: 'expected_result_missing'
}

export interface ExecutionItemResultProjection {
  itemOrdinal: number
  definitionId: string
  executablePlanHash: string
  result: PersistedResultProjection | MissingResultProjection
}

export interface ExecutionResultProjection {
  availability: 'available'
  headlineOutcome: ProjectionOutcome
  execution: {
    executionId: string
    lifecycle: ProjectionLifecycle
    outcome: ProjectionOutcome | null
    reasonCode: string | null
    acceptedAt: string
    terminalAt: string | null
    manifestCount: number
    definitionAuthority: {
      schemaVersion: 1 | 2
      testSetId: string
      revision: number
      modelRowId: number
      modelVersion: string
      supportSealHash: string | null
      routeEvidenceIdentityHash: string | null
      authenticationExpectationIdentityHash: string | null
    }
  }
  run: null | {
    runId: string
    lifecycle: 'running' | 'completed' | 'cancelled' | 'interrupted'
    outcome: ProjectionOutcome | null
    reasonCode: string | null
    startedAt: string
    terminalAt: string | null
    expectedResultCount: number
    observedResultCount: number
    aggregateCounts: {
      passed: number
      failed: number
      couldNotVerify: number
    }
  }
  items: ExecutionItemResultProjection[]
  integrityWarnings: ProjectionIntegrityWarning[]
}

export interface ExecutionResultSummary {
  executionId: string
  lifecycle: ProjectionLifecycle
  outcome: ProjectionOutcome | null
  reasonCode: string | null
  acceptedAt: string
  terminalAt: string | null
  manifestCount: number
  runCount: number
  observedResultCount: number
  integrityState: 'valid' | 'warning' | 'invalid'
}

export type ExecutionResultProjectionRead =
  | { kind: 'ok'; projection: ExecutionResultProjection }
  | { kind: 'not_found' }
  | { kind: 'integrity_invalid'; integrityWarnings: ProjectionIntegrityWarning[] }

export type ExecutionResultListRead = {
  kind: 'ok'
  executions: ExecutionResultSummary[]
  limit: number
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

class ProjectionIntegrityError extends Error {
  constructor(readonly integrityWarnings: ProjectionIntegrityWarning[]) {
    super('Execution Result projection integrity is invalid.')
    this.name = 'ProjectionIntegrityError'
  }
}

/**
 * Read-only Product Results composition. All truth, lifecycle, manifest, and
 * integrity meaning comes from PersistedEvidenceAggregator; this service only
 * maps that canonical result into the allowlisted presentation contract.
 */
export class ExecutionResultProjectionService {
  private readonly aggregator: PersistedEvidenceAggregator

  constructor(
    private readonly dbProvider: () => Kysely<Database> = getDb,
    private readonly executions = new ExecutionRepository(dbProvider),
    private readonly runs = new RunRepository(),
    private readonly results = new TestResultRepository(),
    aggregator?: PersistedEvidenceAggregator,
  ) {
    this.aggregator = aggregator ?? new PersistedEvidenceAggregator(dbProvider, executions, runs, results)
  }

  async read(projectId: string, executionId: string): Promise<ExecutionResultProjectionRead> {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(executionId)) return { kind: 'not_found' }
    try {
      const read = await this.dbProvider().transaction().execute(
        trx => this.aggregator.read(projectId, executionId, trx),
      )
      return read.kind === 'not_found'
        ? { kind: 'not_found' }
        : { kind: 'ok', projection: this.project(read) }
    } catch (cause) {
      if (cause instanceof ProjectionIntegrityError) {
        return { kind: 'integrity_invalid', integrityWarnings: cause.integrityWarnings }
      }
      throw cause
    }
  }

  async list(projectId: string, limit = 25): Promise<ExecutionResultListRead> {
    if (!SAFE_ID.test(projectId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new ExecutionPersistenceError('Execution Result list input is invalid.')
    }
    const executions = await this.dbProvider().transaction().execute(async trx => {
      const roots = await this.executions.listProjectionRoots(projectId, limit, trx)
      const summaries: ExecutionResultSummary[] = []
      for (const root of roots) {
        try {
          const read = await this.aggregator.read(projectId, root.execution_id, trx)
          if (read.kind === 'not_found') continue
          const projection = this.project(read)
          summaries.push({
            executionId: projection.execution.executionId,
            lifecycle: projection.execution.lifecycle,
            outcome: projection.execution.outcome,
            reasonCode: projection.execution.reasonCode,
            acceptedAt: projection.execution.acceptedAt,
            terminalAt: projection.execution.terminalAt,
            manifestCount: projection.execution.manifestCount,
            runCount: projection.run ? 1 : 0,
            observedResultCount: projection.run?.observedResultCount ?? 0,
            integrityState: projection.integrityWarnings.length > 0 ? 'warning' : 'valid',
          })
        } catch (cause) {
          if (!(cause instanceof ProjectionIntegrityError)) throw cause
          const raw = await this.executions.readProjectionSnapshot(projectId, root.execution_id, trx)
          const productRuns = await this.runs.findProductByExecution(root.execution_id, trx)
          const observedResultCount = (await Promise.all(productRuns.map(run => this.results.findByRun(run.run_id, trx))))
            .reduce((count, rows) => count + rows.filter(row => row.result_id !== null).length, 0)
          summaries.push({
            executionId: root.execution_id,
            lifecycle: 'unknown',
            outcome: null,
            reasonCode: 'projection_integrity_invalid',
            acceptedAt: root.accepted_at,
            terminalAt: null,
            manifestCount: raw.items.length,
            runCount: productRuns.length,
            observedResultCount,
            integrityState: 'invalid',
          })
        }
      }
      return summaries
    })
    return { kind: 'ok', executions, limit }
  }

  private project(read: Extract<PersistedEvidenceRead, { kind: 'ok' }>): ExecutionResultProjection {
    const { evidence, aggregation } = read
    const invalid = aggregation.integrityWarnings.filter(item => item.severity === 'error')
    if (invalid.length > 0) throw new ProjectionIntegrityError(invalid)

    const run = evidence.runs[0] ?? null
    const resultsByOrdinal = new Map(
      evidence.results.map(result => [Number(result.execution_item_ordinal), result]),
    )
    const items: ExecutionItemResultProjection[] = evidence.items.map(item => {
      const result = resultsByOrdinal.get(Number(item.item_ordinal))
      return {
        itemOrdinal: Number(item.item_ordinal),
        definitionId: item.definition_id,
        executablePlanHash: item.executable_plan_hash,
        result: result
          ? {
              state: 'result_observed',
              resultId: result.result_id!,
              outcome: result.status as ProjectionOutcome,
              reasonCode: result.error_msg!,
              safeMessage: null,
              durationMs: Number(result.duration_ms),
              oracleKind: null,
              observedSubjectId: null,
            }
          : { state: 'no_result_observed', reasonCode: 'expected_result_missing' },
      }
    })
    const executionMismatch = aggregation.integrityWarnings
      .some(item => item.code === 'execution_aggregate_mismatch')

    return {
      availability: 'available',
      headlineOutcome: aggregation.execution.outcome,
      execution: {
        executionId: aggregation.executionId,
        lifecycle: aggregation.execution.lifecycle,
        outcome: aggregation.execution.terminal ? aggregation.execution.outcome : null,
        reasonCode: executionMismatch
          ? 'execution_aggregate_mismatch'
          : aggregation.execution.persistedReasonCode
            ?? (aggregation.execution.lifecycle === 'unknown' ? 'execution_lock_missing' : null),
        acceptedAt: aggregation.execution.acceptedAt,
        terminalAt: aggregation.execution.terminalAt,
        manifestCount: aggregation.manifest.expectedResultCount,
        definitionAuthority: {
          schemaVersion: Number(evidence.execution.definition_schema_version) as 1 | 2,
          testSetId: evidence.execution.test_set_id,
          revision: Number(evidence.execution.test_set_revision),
          modelRowId: Number(evidence.execution.model_row_id),
          modelVersion: evidence.execution.model_version,
          supportSealHash: evidence.execution.support_seal_hash,
          routeEvidenceIdentityHash: evidence.execution.route_evidence_identity_hash,
          authenticationExpectationIdentityHash: evidence.execution.authentication_expectation_identity_hash,
        },
      },
      run: run ? {
        runId: run.run_id,
        lifecycle: aggregation.run.lifecycle as 'running' | 'completed' | 'cancelled' | 'interrupted',
        outcome: aggregation.run.outcome,
        reasonCode: aggregation.run.reasonCode,
        startedAt: run.started_at,
        terminalAt: run.completed_at,
        expectedResultCount: aggregation.manifest.expectedResultCount,
        observedResultCount: aggregation.manifest.observedResultCount,
        aggregateCounts: { ...aggregation.counts },
      } : null,
      items,
      integrityWarnings: aggregation.integrityWarnings,
    }
  }
}

export const executionResultProjectionService = new ExecutionResultProjectionService()
