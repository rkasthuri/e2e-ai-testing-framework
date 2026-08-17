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
import type { Kysely } from 'kysely'
import { getDb } from '../storage/db'
import type { Database, Run, TestResult } from '../storage/types'
import { ExecutionRepository, type ProductEvidenceOutcome } from '../storage/repositories/ExecutionRepository'
import { RunRepository } from '../storage/repositories/RunRepository'
import { TestResultRepository } from '../storage/repositories/TestResultRepository'
import type { MaterializedExecutablePlan } from './ExecutablePlanContract'
import type { PlaywrightPlanExecutionResult } from './PlaywrightPlanExecutor'
import {
  PersistedEvidenceAggregator,
  hasInvalidPersistedEvidence,
} from './PersistedEvidenceAggregator'

export type ProductResultOutcome = ProductEvidenceOutcome

export interface ProductRunAdmission {
  executionId: string
  projectId: string
  processInstanceId: string
  expectedResultCount: number
  runnerAdapter: 'playwright-plan-executor/v1'
  environmentSnapshot: {
    environment: 'local' | 'ci' | 'staging' | 'production'
    browser: 'chromium'
    headless: boolean
  }
  startedAt: string
}

export interface ProductResultObservation {
  executionId: string
  runId: string
  itemOrdinal: number
  plan: MaterializedExecutablePlan
  observed: PlaywrightPlanExecutionResult
  startedAt: string
  completedAt: string
}

export interface ProductTerminalAggregate {
  runOutcome: ProductResultOutcome
  executionOutcome: ProductResultOutcome
  expectedResultCount: number
  recordedResultCount: number
  passed: number
  failed: number
  couldNotVerify: number
}

export class ProductRunAdmissionError extends Error {
  constructor(message = 'Product Run admission did not commit.') {
    super(message)
    this.name = 'ProductRunAdmissionError'
  }
}

export class ProductResultPersistenceError extends Error {
  constructor(message = 'Product Result evidence did not commit.') {
    super(message)
    this.name = 'ProductResultPersistenceError'
  }
}

export class DuplicateProductResultError extends ProductResultPersistenceError {
  constructor() {
    super('A Product Result already exists for this Run manifest item.')
    this.name = 'DuplicateProductResultError'
  }
}

export class ProductTerminalizationError extends Error {
  constructor(message = 'Product terminal state did not commit.') {
    super(message)
    this.name = 'ProductTerminalizationError'
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_REASON = /^[a-z][a-z0-9_]{0,99}$/

function exactIso(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function resultTruth(result: PlaywrightPlanExecutionResult): { outcome: ProductResultOutcome; reasonCode: string } {
  if (result.status === 'cancelled') {
    throw new ProductResultPersistenceError('Cancellation is not Product Result evidence.')
  }
  if (result.status === 'completed') return { outcome: 'passed', reasonCode: result.reasonCode }
  if (result.status === 'oracle_failed') return { outcome: 'failed', reasonCode: result.reasonCode }
  return { outcome: 'could_not_verify', reasonCode: result.reasonCode }
}

function environmentJson(snapshot: ProductRunAdmission['environmentSnapshot']): string {
  return JSON.stringify({ schemaVersion: 1, browser: snapshot.browser, headless: snapshot.headless })
}

/**
 * Coordinates the existing Execution, Run, and Test Result authorities. It is
 * the sole Product evidence writer; Playwright remains a SQL-free adapter that
 * returns structured observed truth.
 */
export class ExecutionRunCoordinator {
  constructor(
    private readonly dbProvider: () => Kysely<Database> = getDb,
    private readonly runs = new RunRepository(),
    private readonly results = new TestResultRepository(),
    private readonly executions = new ExecutionRepository(dbProvider),
    private readonly mintRunId: () => string = () => `run-${crypto.randomUUID()}`,
    private readonly mintResultId: () => string = () => `result-${crypto.randomUUID()}`,
    private readonly aggregator = new PersistedEvidenceAggregator(dbProvider, executions, runs, results),
  ) {}

  async admitRun(input: ProductRunAdmission): Promise<Run> {
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.processInstanceId) || !exactIso(input.startedAt)
      || !Number.isSafeInteger(input.expectedResultCount) || input.expectedResultCount < 1
      || input.runnerAdapter !== 'playwright-plan-executor/v1'
      || !['local', 'ci', 'staging', 'production'].includes(input.environmentSnapshot.environment)
      || input.environmentSnapshot.browser !== 'chromium'
      || typeof input.environmentSnapshot.headless !== 'boolean') {
      throw new ProductRunAdmissionError('Product Run admission input is malformed.')
    }
    const runId = this.mintRunId()
    if (!SAFE_ID.test(runId)) throw new ProductRunAdmissionError('Product Run identity is malformed.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const execution = await trx.selectFrom('executions').select(['execution_id', 'project_id', 'max_run_attempts'])
          .where('execution_id', '=', input.executionId).executeTakeFirst()
        const lock = await trx.selectFrom('execution_locks').select('execution_id')
          .where('project_id', '=', input.projectId)
          .where('execution_id', '=', input.executionId)
          .where('process_instance_id', '=', input.processInstanceId)
          .executeTakeFirst()
        const manifest = await trx.selectFrom('execution_items').select('item_ordinal')
          .where('execution_id', '=', input.executionId).orderBy('item_ordinal').execute()
        const existing = await this.runs.findProductByExecution(input.executionId, trx)
        const cancellation = await trx.selectFrom('execution_events').select('id')
          .where('execution_id', '=', input.executionId)
          .where('event_type', '=', 'cancellation_requested')
          .executeTakeFirst()
        if (!execution || execution.project_id !== input.projectId || Number(execution.max_run_attempts) !== 1
          || !lock || cancellation || existing.length !== 0 || manifest.length !== input.expectedResultCount
          || manifest.some((item, index) => Number(item.item_ordinal) !== index + 1)) {
          throw new ProductRunAdmissionError()
        }
        return this.runs.insert({
          run_id: runId,
          app_name: input.projectId,
          branch: 'unknown',
          commit_sha: 'unknown',
          environment: input.environmentSnapshot.environment,
          base_url: '',
          triggered_by: 'platform',
          reporter_version: input.runnerAdapter,
          status: 'unknown',
          total_tests: input.expectedResultCount,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration_ms: 0,
          started_at: input.startedAt,
          completed_at: null,
          metadata: environmentJson(input.environmentSnapshot),
          input_health: 'unknown',
          input_health_reason: null,
          lifecycle: 'running',
          execution_id: input.executionId,
          origin: 'product',
          attempt_ordinal: 1,
        }, trx)
      })
    } catch (cause) {
      if (cause instanceof ProductRunAdmissionError) throw cause
      throw new ProductRunAdmissionError()
    }
  }

  async recordResult(input: ProductResultObservation): Promise<TestResult> {
    const definitionId = input.plan.value.definitionId
    const fingerprint = input.plan.fingerprint
    const truth = resultTruth(input.observed)
    const observedOracle = input.observed.status === 'completed' || input.observed.status === 'oracle_failed'
      ? { oracleKind: input.plan.value.oracle.kind, observedSubjectId: input.plan.value.oracle.subjectId }
      : null
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.runId)
      || !SAFE_ID.test(definitionId) || !SHA256.test(fingerprint)
      || !Number.isSafeInteger(input.itemOrdinal) || input.itemOrdinal < 1
      || !exactIso(input.startedAt) || !exactIso(input.completedAt)
      || input.completedAt < input.startedAt || !SAFE_REASON.test(truth.reasonCode)) {
      throw new ProductResultPersistenceError('Product Result input is malformed.')
    }
    const resultId = this.mintResultId()
    if (!SAFE_ID.test(resultId)) throw new ProductResultPersistenceError('Product Result identity is malformed.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const run = await this.runs.findById(input.runId, trx)
        if (!run || run.origin !== 'product' || run.execution_id !== input.executionId || run.lifecycle !== 'running') {
          throw new ProductResultPersistenceError('Product Run is not available for Result recording.')
        }
        return this.results.insert({
          run_id: input.runId,
          test_id: definitionId,
          title: definitionId,
          suite: 'product-execution',
          status: truth.outcome,
          duration_ms: Math.max(0, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
          retry_count: 0,
          // For Product rows this legacy-named column is a bounded safe reason
          // code only. Raw exceptions and browser URLs are never accepted.
          error_msg: truth.reasonCode,
          browser: 'chromium',
          tier: 'ui',
          started_at: input.startedAt,
          worker_index: 0,
          tags: '[]',
          flaky_history: 0,
          screenshot_path: null,
          video_path: null,
          metadata: '{}',
          result_id: resultId,
          execution_item_ordinal: input.itemOrdinal,
          definition_id: definitionId,
          executable_plan_hash: fingerprint,
          oracle_kind: observedOracle?.oracleKind ?? null,
          observed_subject_id: observedOracle?.observedSubjectId ?? null,
        }, trx)
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (/UNIQUE constraint failed|uq_results_run_manifest_item/i.test(message)) throw new DuplicateProductResultError()
      if (cause instanceof ProductResultPersistenceError) throw cause
      throw new ProductResultPersistenceError()
    }
  }

  async terminalize(input: {
    executionId: string
    projectId: string
    processInstanceId: string
    runId: string
    completedAt: string
  }): Promise<ProductTerminalAggregate> {
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.processInstanceId) || !SAFE_ID.test(input.runId)
      || !exactIso(input.completedAt)) throw new ProductTerminalizationError('Product terminal input is malformed.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const run = await this.runs.findById(input.runId, trx)
        if (!run || run.origin !== 'product' || run.execution_id !== input.executionId
          || run.app_name !== input.projectId || run.lifecycle !== 'running') {
          throw new ProductTerminalizationError('Product Run is not eligible for terminalization.')
        }
        const read = await this.aggregator.read(input.projectId, input.executionId, trx)
        if (read.kind === 'not_found' || hasInvalidPersistedEvidence(read.aggregation)) {
          throw new ProductTerminalizationError('Persisted Product evidence is unavailable or integrity-invalid.')
        }
        const aggregate = read.aggregation
        const expectedResultCount = aggregate.manifest.expectedResultCount
        if (aggregate.run.runId !== input.runId || aggregate.run.lifecycle !== 'running'
          || aggregate.run.terminalOutcome === null || Number(run.total_tests) !== expectedResultCount
          || expectedResultCount < 1) {
          throw new ProductTerminalizationError('Product Run expectation does not match its immutable manifest.')
        }
        const executionOutcome = aggregate.execution.outcome
        const reason = aggregate.execution.reasonCode
        if (!SAFE_REASON.test(reason)) throw new ProductTerminalizationError('Persisted Product Result reason is unsafe.')
        const duration = Math.max(0, Date.parse(input.completedAt) - Date.parse(run.started_at))
        await this.runs.terminalizeProduct(input.runId, {
          status: aggregate.run.terminalOutcome,
          passed: aggregate.counts.passed,
          failed: aggregate.counts.failed,
          skipped: aggregate.counts.couldNotVerify,
          duration_ms: duration,
          completed_at: input.completedAt,
        }, trx)
        await this.executions.terminalizeProductExecution({
          projectId: input.projectId,
          executionId: input.executionId,
          processInstanceId: input.processInstanceId,
          completedAt: input.completedAt,
          outcome: executionOutcome,
          safeCode: reason,
          safeMessage: executionOutcome === 'passed'
            ? 'The governed execution completed with persisted passing Result evidence.'
            : executionOutcome === 'failed'
              ? 'The governed execution completed with persisted failing Result evidence.'
              : 'The governed execution completed without enough persisted evidence to verify every expected item.',
        }, trx)
        return {
          runOutcome: aggregate.run.terminalOutcome,
          executionOutcome,
          expectedResultCount,
          recordedResultCount: aggregate.manifest.observedResultCount,
          passed: aggregate.counts.passed,
          failed: aggregate.counts.failed,
          couldNotVerify: aggregate.counts.couldNotVerify,
        }
      })
    } catch (cause) {
      if (cause instanceof ProductTerminalizationError) throw cause
      throw new ProductTerminalizationError()
    }
  }

  async terminalizeCancellation(input: {
    executionId: string
    projectId: string
    processInstanceId: string
    runId: string | null
    completedAt: string
  }): Promise<ProductTerminalAggregate | null> {
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.processInstanceId) || input.runId !== null && !SAFE_ID.test(input.runId)
      || !exactIso(input.completedAt)) throw new ProductTerminalizationError('Cancellation terminal input is malformed.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const read = await this.aggregator.read(input.projectId, input.executionId, trx)
        if (read.kind === 'not_found' || hasInvalidPersistedEvidence(read.aggregation)) {
          throw new ProductTerminalizationError('Persisted Product evidence is unavailable or integrity-invalid.')
        }
        const aggregate = read.aggregation
        if (aggregate.manifest.expectedResultCount < 1
          || aggregate.execution.lifecycle !== 'cancellation_requested'
          || aggregate.run.runId !== input.runId) {
          throw new ProductTerminalizationError('Cancellation Run identity is ambiguous.')
        }

        if (input.runId === null) {
          await this.executions.terminalizeCancelledExecution({
            projectId: input.projectId,
            executionId: input.executionId,
            processInstanceId: input.processInstanceId,
            completedAt: input.completedAt,
            outcome: aggregate.execution.outcome,
            safeCode: 'cancelled_before_execution',
            safeMessage: 'The execution was cancelled before any Product Result evidence was observed.',
          }, trx)
          return null
        }

        const run = read.evidence.runs[0]
        if (!run || aggregate.run.lifecycle !== 'running' || aggregate.run.terminalOutcome === null
          || run.app_name !== input.projectId
          || Number(run.total_tests) !== aggregate.manifest.expectedResultCount) {
          throw new ProductTerminalizationError('Product Run is not eligible for cancellation terminalization.')
        }
        await this.runs.cancelProduct(run.run_id, {
          status: aggregate.run.terminalOutcome,
          passed: aggregate.counts.passed,
          failed: aggregate.counts.failed,
          skipped: aggregate.counts.couldNotVerify,
          duration_ms: Math.max(0, Date.parse(input.completedAt) - Date.parse(run.started_at)),
          completed_at: input.completedAt,
        }, trx)
        const safeCode = aggregate.manifest.observedResultCount === 0 ? 'cancelled_before_execution' : 'cancelled_by_request'
        await this.executions.terminalizeCancelledExecution({
          projectId: input.projectId,
          executionId: input.executionId,
          processInstanceId: input.processInstanceId,
          completedAt: input.completedAt,
          outcome: aggregate.execution.outcome,
          safeCode,
          safeMessage: 'The execution stopped cooperatively; its outcome reflects only immutable persisted Result evidence.',
        }, trx)
        return {
          runOutcome: aggregate.run.terminalOutcome,
          executionOutcome: aggregate.execution.outcome,
          expectedResultCount: aggregate.manifest.expectedResultCount,
          recordedResultCount: aggregate.manifest.observedResultCount,
          passed: aggregate.counts.passed,
          failed: aggregate.counts.failed,
          couldNotVerify: aggregate.counts.couldNotVerify,
        }
      })
    } catch (cause) {
      if (cause instanceof ProductTerminalizationError) throw cause
      throw new ProductTerminalizationError()
    }
  }
}
