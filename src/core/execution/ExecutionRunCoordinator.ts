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
import type { Database, Run, TestResult } from '../storage/types'
import { ExecutionRepository, type ProductEvidenceOutcome } from '../storage/repositories/ExecutionRepository'
import { RunRepository } from '../storage/repositories/RunRepository'
import { TestResultRepository } from '../storage/repositories/TestResultRepository'
import { DiagnosticEvidenceRepository } from '../storage/repositories/DiagnosticEvidenceRepository'
import type { MaterializedExecutablePlan } from './ExecutablePlanContract'
import type { PlaywrightPlanExecutionResult } from './PlaywrightPlanExecutor'
import type { DiagnosticEvidenceFactsV1 } from './DiagnosticEvidenceContract'
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
  runnerAdapter: 'playwright-plan-executor/v1' | 'playwright-plan-executor/v2'
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

export interface MissingProductResultObservation {
  itemOrdinal: number
  plan: MaterializedExecutablePlan
  facts: DiagnosticEvidenceFactsV1
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

export function productResultTruth(result: PlaywrightPlanExecutionResult): { outcome: ProductResultOutcome; reasonCode: string } {
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

function routePath(value: string): string | null {
  try { return new URL(value).pathname } catch { return null }
}

function notPerformedAfterExecutor(executor: DiagnosticEvidenceFactsV1['executor']): DiagnosticEvidenceFactsV1 {
  return {
    executor,
    authentication: { state: 'not_performed' },
    navigation: { outcome: 'not_performed' },
    targetObservation: { outcome: 'not_performed' },
    action: { outcome: 'not_performed' },
    oracle: { outcome: 'not_performed' },
  }
}

export function unattemptedDiagnosticEvidence(): DiagnosticEvidenceFactsV1 {
  return notPerformedAfterExecutor({ outcome: 'not_started' })
}

export function executorFailureDiagnosticEvidence(
  failureClass: Extract<DiagnosticEvidenceFactsV1['executor'], { outcome: 'failed' }>['failureClass'] = 'executor_internal_failure',
): DiagnosticEvidenceFactsV1 {
  return notPerformedAfterExecutor({ outcome: 'failed', failureClass })
}

export function diagnosticEvidenceFromProductResult(
  plan: MaterializedExecutablePlan,
  observed: PlaywrightPlanExecutionResult,
): DiagnosticEvidenceFactsV1 {
  if (observed.status === 'executor_failure' || observed.status === 'unsupported_plan') {
    return executorFailureDiagnosticEvidence(observed.status === 'executor_failure'
      ? observed.failureClass ?? 'executor_internal_failure'
      : 'executor_internal_failure')
  }
  const authentication: DiagnosticEvidenceFactsV1['authentication'] = plan.value.schemaVersion === 2
    ? plan.value.authenticationExpectation.state === 'required'
      ? observed.status === 'authentication_failed'
        ? { state: 'not_established', attemptOccurred: true }
        : { state: 'established', attemptOccurred: true }
      : { state: 'not_required' }
    : plan.value.authenticationRequired
      ? observed.status === 'authentication_failed'
        ? { state: 'not_established', attemptOccurred: true }
        : { state: 'established', attemptOccurred: true }
      : { state: 'not_required' }
  if (observed.status === 'authentication_failed') {
    return { executor: { outcome: 'completed' }, authentication, navigation: { outcome: 'not_performed' },
      targetObservation: { outcome: 'not_performed' }, action: { outcome: 'not_performed' }, oracle: { outcome: 'not_performed' } }
  }
  const navigationStep = plan.value.steps[0]
  if (!navigationStep || navigationStep.kind !== 'navigate_to_observed_route') {
    throw new ProductResultPersistenceError('Diagnostic plan navigation authority is malformed.')
  }
  const intendedRoute = navigationStep.routePath
  if (observed.status === 'navigation_failed') {
    const observedRoute = observed.observedUrl ? routePath(observed.observedUrl) : null
    return { executor: { outcome: 'completed' }, authentication,
      navigation: { outcome: 'not_completed', intendedRoute, observedRoute,
        failureClass: observed.failureClass ?? 'browser_navigation_error' },
      targetObservation: { outcome: 'not_performed' }, action: { outcome: 'not_performed' }, oracle: { outcome: 'not_performed' } }
  }
  if (observed.status === 'action_failed') {
    const observedRoute = observed.navigationUrl ? routePath(observed.navigationUrl) : null
    if (!observedRoute) throw new ProductResultPersistenceError('Observed navigation route is unavailable for diagnostic evidence.')
    const click = plan.value.steps.length === 2 ? plan.value.steps[1] : null
    if (!click || click.kind !== 'click_observed_data_test') {
      throw new ProductResultPersistenceError('M4 diagnostic evidence requires the frozen v3 observed-flow shape.')
    }
    const targetAuthority = { subjectId: click.subjectId, elementId: click.elementId,
      selectorKind: 'data_test' as const, selectorValue: click.dataTestValue }
    const targetObservation: DiagnosticEvidenceFactsV1['targetObservation'] = observed.targetCardinality === 'zero'
      ? { outcome: 'not_observed', targetAuthority, cardinality: 'zero' }
      : observed.targetCardinality === 'one' || observed.targetCardinality === 'many'
        ? { outcome: 'observed', targetAuthority, cardinality: observed.targetCardinality }
        : { outcome: 'not_performed' }
    const action: DiagnosticEvidenceFactsV1['action'] = targetObservation.outcome === 'observed'
      ? { outcome: 'not_completed', interactionAttempted: true, semantic: 'click_observed_data_test',
          failureClass: observed.failureClass ?? 'interaction_failed' }
      : { outcome: 'not_performed' }
    return { executor: { outcome: 'completed' }, authentication,
      navigation: { outcome: 'completed', intendedRoute, observedRoute },
      targetObservation, action, oracle: { outcome: 'not_performed' } }
  }
  if (observed.status === 'cancelled') throw new ProductResultPersistenceError('Cancellation is not diagnostic Result evidence.')
  const actualRoute = routePath(observed.finalUrl)
  const observedNavigationRoute = observed.navigationUrl ? routePath(observed.navigationUrl) : null
  const expectedRoute = plan.value.oracle.routePath ?? intendedRoute
  if (!actualRoute || !observedNavigationRoute) {
    throw new ProductResultPersistenceError('Observed navigation or final route is malformed.')
  }
  const click = plan.value.steps.length === 2 ? plan.value.steps[1] : null
  if (!click || click.kind !== 'click_observed_data_test') {
    throw new ProductResultPersistenceError('M4 diagnostic evidence requires the frozen v3 observed-flow shape.')
  }
  const targetAuthority = {
    subjectId: click.subjectId,
    elementId: click.elementId,
    selectorKind: 'data_test' as const,
    selectorValue: click.dataTestValue,
  }
  if (observed.targetCardinality !== 'one' && observed.targetCardinality !== 'many') {
    throw new ProductResultPersistenceError('Observed target cardinality is unavailable for diagnostic evidence.')
  }
  return {
    executor: { outcome: 'completed' }, authentication,
    navigation: { outcome: 'completed', intendedRoute, observedRoute: observedNavigationRoute },
    targetObservation: { outcome: 'observed', targetAuthority, cardinality: observed.targetCardinality },
    action: { outcome: 'completed', interactionAttempted: true, semantic: 'click_observed_data_test' },
    oracle: {
      outcome: observed.status === 'completed' ? 'matched' : 'mismatched',
      oracleAuthority: { kind: 'subject_observable', subjectId: plan.value.oracle.subjectId },
      expected: expectedRoute,
      actual: actualRoute,
    },
  }
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
    private readonly diagnosticEvidence = new DiagnosticEvidenceRepository(dbProvider),
  ) {}

  private async diagnosticV3Ordinals(executionId: string, trx: Transaction<Database>): Promise<Set<number>> {
    const execution = await trx.selectFrom('executions')
      .select(['test_set_authority_scope', 'definition_schema_version'])
      .where('execution_id', '=', executionId).executeTakeFirst()
    if (!execution) throw new ProductResultPersistenceError('Accepted Execution authority is unavailable.')
    if (execution.test_set_authority_scope === 'single') {
      if (Number(execution.definition_schema_version) !== 3) return new Set()
      const items = await trx.selectFrom('execution_items').select('item_ordinal')
        .where('execution_id', '=', executionId).execute()
      return new Set(items.map(item => Number(item.item_ordinal)))
    }
    if (execution.test_set_authority_scope !== 'per_item' || execution.definition_schema_version !== null) {
      throw new ProductResultPersistenceError('Accepted Execution authority scope is invalid.')
    }
    const [items, authorities] = await Promise.all([
      trx.selectFrom('execution_items').select(['item_ordinal', 'definition_id'])
        .where('execution_id', '=', executionId).orderBy('item_ordinal').execute(),
      trx.selectFrom('execution_item_authorities').select(['item_ordinal', 'definition_id', 'definition_schema_version'])
        .where('execution_id', '=', executionId).orderBy('item_ordinal').execute(),
    ])
    if (items.length < 1 || authorities.length !== items.length
      || items.some((item, index) => Number(item.item_ordinal) !== index + 1)
      || authorities.some((authority, index) => Number(authority.item_ordinal) !== index + 1
        || authority.definition_id !== items[index].definition_id)) {
      throw new ProductResultPersistenceError('Per-item diagnostic authority is incomplete.')
    }
    return new Set(authorities.filter(authority => Number(authority.definition_schema_version) === 3)
      .map(authority => Number(authority.item_ordinal)))
  }

  async admitRun(input: ProductRunAdmission): Promise<Run> {
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.processInstanceId) || !exactIso(input.startedAt)
      || !Number.isSafeInteger(input.expectedResultCount) || input.expectedResultCount < 1
      || !['playwright-plan-executor/v1', 'playwright-plan-executor/v2'].includes(input.runnerAdapter)
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
    const truth = productResultTruth(input.observed)
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
        if (!run || run.origin !== 'product' || run.execution_id !== input.executionId) {
          throw new ProductResultPersistenceError('Product Run is not available for Result recording.')
        }
        const diagnosticV3Ordinals = await this.diagnosticV3Ordinals(input.executionId, trx)
        const existing = (await this.results.findByRun(input.runId, trx))
          .find(candidate => Number(candidate.execution_item_ordinal) === input.itemOrdinal)
        if (existing) {
          if (existing.definition_id !== definitionId || existing.executable_plan_hash !== fingerprint
            || existing.status !== truth.outcome || existing.error_msg !== truth.reasonCode || !existing.result_id) {
            throw new DuplicateProductResultError()
          }
          if (diagnosticV3Ordinals.has(input.itemOrdinal)) await this.diagnosticEvidence.append({
            binding: { projectId: run.app_name, executionId: input.executionId, runId: input.runId,
              itemOrdinal: input.itemOrdinal, resultId: existing.result_id, definitionId, executablePlanHash: fingerprint },
            facts: diagnosticEvidenceFromProductResult(input.plan, input.observed),
          }, trx)
          return existing
        }
        if (run.lifecycle !== 'running') {
          throw new ProductResultPersistenceError('A new Product Result cannot be recorded after Run terminalization.')
        }
        const inserted = await this.results.insert({
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
        if (diagnosticV3Ordinals.has(input.itemOrdinal)) await this.diagnosticEvidence.append({
          binding: { projectId: run.app_name, executionId: input.executionId, runId: input.runId,
            itemOrdinal: input.itemOrdinal, resultId: inserted.result_id, definitionId, executablePlanHash: fingerprint },
          facts: diagnosticEvidenceFromProductResult(input.plan, input.observed),
        }, trx)
        return inserted
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
    missingResults?: MissingProductResultObservation[]
  }): Promise<ProductTerminalAggregate> {
    if (!SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.processInstanceId) || !SAFE_ID.test(input.runId)
      || !exactIso(input.completedAt)) throw new ProductTerminalizationError('Product terminal input is malformed.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const run = await this.runs.findById(input.runId, trx)
        if (!run || run.origin !== 'product' || run.execution_id !== input.executionId
          || run.app_name !== input.projectId || !['running', 'completed'].includes(run.lifecycle)) {
          throw new ProductTerminalizationError('Product Run is not eligible for terminalization.')
        }
        const read = await this.aggregator.read(input.projectId, input.executionId, trx)
        if (read.kind === 'not_found' || hasInvalidPersistedEvidence(read.aggregation)) {
          throw new ProductTerminalizationError('Persisted Product evidence is unavailable or integrity-invalid.')
        }
        const aggregate = read.aggregation
        if (run.lifecycle === 'completed') {
          if (!aggregate.execution.terminal || aggregate.run.runId !== input.runId
            || aggregate.run.lifecycle !== 'completed' || aggregate.run.terminalOutcome === null) {
            throw new ProductTerminalizationError('Persisted terminal Product authority is inconsistent.')
          }
          const diagnosticV3Ordinals = await this.diagnosticV3Ordinals(input.executionId, trx)
          const missingItems = read.evidence.items.filter(item => diagnosticV3Ordinals.has(Number(item.item_ordinal))
            && !read.evidence.results.some(result => Number(result.execution_item_ordinal) === Number(item.item_ordinal)))
          const supplied = input.missingResults ?? []
          if (missingItems.length !== supplied.length || supplied.some((item, index) => item.itemOrdinal !== Number(missingItems[index].item_ordinal))) {
            throw new ProductTerminalizationError('Terminal retry missing-Result evidence does not match the immutable manifest.')
          }
          for (const missing of supplied) {
            const item = missingItems.find(candidate => Number(candidate.item_ordinal) === missing.itemOrdinal)!
            await this.diagnosticEvidence.append({
              binding: { projectId: input.projectId, executionId: input.executionId, runId: input.runId,
                itemOrdinal: missing.itemOrdinal, resultId: null, definitionId: item.definition_id,
                executablePlanHash: item.executable_plan_hash },
              facts: missing.facts,
            }, trx)
          }
          const evidenceRows = diagnosticV3Ordinals.size > 0
            ? await this.diagnosticEvidence.read(input.projectId, input.executionId, trx) : []
          if (evidenceRows.length !== diagnosticV3Ordinals.size) {
            throw new ProductTerminalizationError('Terminal diagnostic evidence is incomplete.')
          }
          return {
            runOutcome: aggregate.run.terminalOutcome,
            executionOutcome: aggregate.execution.outcome,
            expectedResultCount: aggregate.manifest.expectedResultCount,
            recordedResultCount: aggregate.manifest.observedResultCount,
            passed: aggregate.counts.passed,
            failed: aggregate.counts.failed,
            couldNotVerify: aggregate.counts.couldNotVerify,
          }
        }
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
        const diagnosticV3Ordinals = await this.diagnosticV3Ordinals(input.executionId, trx)
        const missingOrdinals = read.evidence.items
          .filter(item => diagnosticV3Ordinals.has(Number(item.item_ordinal))
            && !read.evidence.results.some(result => Number(result.execution_item_ordinal) === Number(item.item_ordinal)))
          .map(item => Number(item.item_ordinal))
        const supplied = input.missingResults ?? []
        if (missingOrdinals.length !== supplied.length
          || supplied.some((item, index) => item.itemOrdinal !== missingOrdinals[index])) {
          throw new ProductTerminalizationError('Every terminal missing Result requires one exact diagnostic evidence observation.')
        }
        for (const missing of supplied) {
          const item = read.evidence.items.find(candidate => Number(candidate.item_ordinal) === missing.itemOrdinal)
          if (!item || missing.plan.value.definitionId !== item.definition_id || missing.plan.fingerprint !== item.executable_plan_hash) {
            throw new ProductTerminalizationError('Missing Result diagnostic authority does not match the immutable manifest.')
          }
          await this.diagnosticEvidence.append({
            binding: { projectId: input.projectId, executionId: input.executionId, runId: input.runId,
              itemOrdinal: missing.itemOrdinal, resultId: null, definitionId: item.definition_id,
              executablePlanHash: item.executable_plan_hash },
            facts: missing.facts,
          }, trx)
        }
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
