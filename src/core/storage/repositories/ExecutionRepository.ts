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
import { SuiteContractError } from '../../suites/SuiteContract'
import { getProductDb } from '../db'
import type { Database, Execution, ExecutionEvent, ExecutionItem, ExecutionLock } from '../types'
import { SuiteRepository } from './SuiteRepository'

/**
 * Existing FORGE run-lifecycle precedent uses a two-hour on-next-run stale
 * threshold (`ForgeStreamingReporter`). Product execution adopts the same
 * conservative bound. Heartbeats occur at bounded executor transitions; no
 * daemon or ungrounded shorter timeout is introduced here.
 */
export const EXECUTION_STALE_AFTER_MS = 120 * 60_000

export type ExecutionTerminalOutcome =
  | 'completed'
  | 'passed'
  | 'failed'
  | 'could_not_verify'
  | 'authentication_failed'
  | 'navigation_failed'
  | 'oracle_failed'
  | 'unsupported_plan'
  | 'executor_failure'
  | 'interrupted'

export type ProductEvidenceOutcome = 'passed' | 'failed' | 'could_not_verify'
export type ExecutionTerminalLifecycle = 'completed' | 'cancelled' | 'interrupted'

export type CancellationRequestWrite =
  | { kind: 'requested'; requestedAt: string }
  | { kind: 'already_requested'; requestedAt: string }
  | { kind: 'already_terminal'; lifecycle: ExecutionTerminalLifecycle }
  | { kind: 'not_found' }

export interface BeginExecutionInput {
  executionId: string
  projectId: string
  processInstanceId: string
  startedAt: string
  executionPlanHash: string
  executionIntentKey: string
  executionIntentFingerprint: string
  expectedTestSetId: string
  expectedRevision: number
  expectedTestSetContentHash?: string
  definitionSchemaVersion?: 1 | 2 | 3
  expectedModelRowId: number
  expectedModelVersion: string
  sourceObservationId?: string | null
  supportSealHash?: string | null
  routeEvidenceIdentityHash?: string | null
  authenticationExpectationIdentityHash?: string | null
  suiteAuthority?: { suiteId:string; suiteRevision:number; suiteContentHash:string }
  manifestItems: Array<{
    itemOrdinal: number
    definitionId: string
    executablePlanHash: string
    oracleKind?: 'subject_observable'
    oracleSubjectId?: string
  }>
}

export interface ExecutionIntentReplay {
  executionId: string
  acceptedAt: string
  executionPlanHash: string
  requestFingerprint: string
}

export type ExecutionAcceptanceWrite =
  | { kind: 'accepted' }
  | ({ kind: 'replayed' } & ExecutionIntentReplay)

export interface ExecutionRecoverySnapshot {
  execution: Execution | null
  items: ExecutionItem[]
  events: ExecutionEvent[]
  lock: ExecutionLock | null
}

export type ExecutionProjectionSnapshot = ExecutionRecoverySnapshot

export class DuplicateExecutionError extends Error {
  constructor() {
    super('A Product UI execution is already active for this project.')
    this.name = 'DuplicateExecutionError'
  }
}

export class ExecutionIntentConflictError extends Error {
  constructor() {
    super('The execution intent key was already accepted with different request semantics.')
    this.name = 'ExecutionIntentConflictError'
  }
}

export class StaleExecutionAuthorityError extends Error {
  constructor(readonly code: 'stale_definition' | 'conflicting_evidence' | 'stale_suite_authority') {
    super(code === 'stale_suite_authority' ? 'The Suite pinned Test Set authority is no longer current.' : code === 'stale_definition'
      ? 'The selected test-set revision is no longer current.'
      : 'The selected definition provenance no longer matches the active App Model.')
    this.name = 'StaleExecutionAuthorityError'
  }
}

export class SuiteExecutionIntegrityError extends Error {
  constructor() {
    super('The exact Suite revision failed canonical integrity revalidation at execution acceptance.')
    this.name = 'SuiteExecutionIntegrityError'
  }
}

export class ExecutionPersistenceError extends Error {
  constructor(message = 'Durable execution state could not be validated safely.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExecutionPersistenceError'
  }
}

export class ExecutionOwnershipError extends Error {
  constructor() {
    super('The durable execution lock is not owned by this execution process.')
    this.name = 'ExecutionOwnershipError'
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SAFE_INTENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/

function exactIso(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function manifestHash(items: BeginExecutionInput['manifestItems']): string {
  if (items.length === 1) return items[0].executablePlanHash
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    planFingerprints: items.map(item => item.executablePlanHash),
  })).digest('hex')
}

function safeInput(input: BeginExecutionInput): boolean {
  const schemaVersion = input.definitionSchemaVersion ?? 1
  const provenanceValid = schemaVersion === 1
    ? typeof input.sourceObservationId === 'string' && SAFE_ID.test(input.sourceObservationId)
      && input.supportSealHash == null && input.routeEvidenceIdentityHash == null
      && input.authenticationExpectationIdentityHash == null
    : input.sourceObservationId == null && SHA256.test(input.expectedTestSetContentHash ?? '')
      && SHA256.test(input.supportSealHash ?? '') && SHA256.test(input.routeEvidenceIdentityHash ?? '')
      && SHA256.test(input.authenticationExpectationIdentityHash ?? '')
  return SAFE_ID.test(input.executionId) && SAFE_ID.test(input.projectId)
    && SAFE_INTENT_KEY.test(input.executionIntentKey)
    && SHA256.test(input.executionIntentFingerprint)
    && SAFE_ID.test(input.processInstanceId) && SAFE_ID.test(input.expectedTestSetId)
    && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0
    && [1, 2, 3].includes(schemaVersion)
    && Number.isSafeInteger(input.expectedModelRowId) && input.expectedModelRowId > 0
    && typeof input.expectedModelVersion === 'string' && input.expectedModelVersion.length > 0
    && provenanceValid
    && (input.suiteAuthority === undefined || SAFE_ID.test(input.suiteAuthority.suiteId) && Number.isSafeInteger(input.suiteAuthority.suiteRevision) && input.suiteAuthority.suiteRevision>0 && SHA256.test(input.suiteAuthority.suiteContentHash))
    && Array.isArray(input.manifestItems) && input.manifestItems.length > 0
    && input.manifestItems.every((item, index) => item.itemOrdinal === index + 1
      && SAFE_ID.test(item.definitionId) && SHA256.test(item.executablePlanHash)
      && (item.oracleKind === undefined) === (item.oracleSubjectId === undefined)
      && (item.oracleKind === undefined
        || item.oracleKind === 'subject_observable' && SAFE_ID.test(item.oracleSubjectId ?? '')))
    && new Set(input.manifestItems.map(item => item.definitionId)).size === input.manifestItems.length
    && manifestHash(input.manifestItems) === input.executionPlanHash
    && exactIso(input.startedAt) && SHA256.test(input.executionPlanHash)
}

function terminalMessage(outcome: ExecutionTerminalOutcome): string {
  switch (outcome) {
    case 'completed': return 'The governed execution completed its bounded oracle.'
    case 'passed': return 'The governed execution completed with persisted passing Result evidence.'
    case 'failed': return 'The governed execution completed with persisted failing Result evidence.'
    case 'could_not_verify': return 'The governed execution completed without enough persisted evidence to verify every expected item.'
    case 'authentication_failed': return 'The governed form-login step did not establish authenticated navigation.'
    case 'navigation_failed': return 'The governed observed-route navigation did not complete.'
    case 'oracle_failed': return 'The bounded subject-observable oracle did not match the final route.'
    case 'unsupported_plan': return 'The executable plan contained a capability unsupported by the current runner.'
    case 'executor_failure': return 'The governed executor could not complete safely.'
    case 'interrupted': return 'The durable start has no supported live owner and was reconciled as interrupted.'
  }
}

export class ExecutionRepository {
  private readonly suites: SuiteRepository

  constructor(private readonly dbProvider: () => Kysely<Database> = getProductDb) {
    this.suites = new SuiteRepository(dbProvider)
  }

  async findExecutionIntent(projectId: string, executionIntentKey: string): Promise<ExecutionIntentReplay | null> {
    if (!SAFE_ID.test(projectId) || !SAFE_INTENT_KEY.test(executionIntentKey)) {
      throw new ExecutionPersistenceError('Execution intent lookup is malformed.')
    }
    const row = await this.dbProvider().selectFrom('executions')
      .select(['execution_id', 'accepted_at', 'manifest_hash', 'execution_intent_fingerprint'])
      .where('project_id', '=', projectId)
      .where('execution_intent_key', '=', executionIntentKey)
      .executeTakeFirst()
    if (!row) return null
    if (!row.execution_intent_fingerprint || !SHA256.test(row.execution_intent_fingerprint)) {
      throw new ExecutionPersistenceError('Persisted execution intent authority is malformed.')
    }
    return {
      executionId: row.execution_id,
      acceptedAt: row.accepted_at,
      executionPlanHash: row.manifest_hash,
      requestFingerprint: row.execution_intent_fingerprint,
    }
  }

  /** Intent claim, Execution root, manifest, lock, and started event commit atomically. */
  async beginExecution(input: BeginExecutionInput): Promise<ExecutionAcceptanceWrite> {
    if (!safeInput(input)) {
      throw new ExecutionPersistenceError('Execution acceptance input is malformed.')
    }
    const db = this.dbProvider()
    try {
      return await db.transaction().execute(async trx => {
        const replay = await trx.selectFrom('executions')
          .select(['execution_id', 'accepted_at', 'manifest_hash', 'execution_intent_fingerprint'])
          .where('project_id', '=', input.projectId)
          .where('execution_intent_key', '=', input.executionIntentKey)
          .executeTakeFirst()
        if (replay) {
          if (replay.execution_intent_fingerprint !== input.executionIntentFingerprint) {
            throw new ExecutionIntentConflictError()
          }
          return {
            kind: 'replayed' as const,
            executionId: replay.execution_id,
            acceptedAt: replay.accepted_at,
            executionPlanHash: replay.manifest_hash,
            requestFingerprint: replay.execution_intent_fingerprint,
          }
        }
        const existingLock = await trx.selectFrom('execution_locks')
          .selectAll().where('project_id', '=', input.projectId).executeTakeFirst()
        if (existingLock) throw new DuplicateExecutionError()

        let verifiedSuite: Awaited<ReturnType<SuiteRepository['readVerifiedInTransaction']>> | undefined
        if (input.suiteAuthority) {
          try {
            verifiedSuite = await this.suites.readVerifiedInTransaction(
              trx, input.projectId, input.suiteAuthority.suiteId, input.suiteAuthority.suiteRevision,
            )
          } catch (cause) {
            if (cause instanceof SuiteContractError) throw new SuiteExecutionIntegrityError()
            throw cause
          }
          const pinned = verifiedSuite.members[0].definitionAuthority
          if (verifiedSuite.contentHash !== input.suiteAuthority.suiteContentHash
            || pinned.testSetId !== input.expectedTestSetId
            || pinned.testSetRevision !== input.expectedRevision
            || pinned.definitionSchemaVersion !== (input.definitionSchemaVersion ?? 1)
            || pinned.testSetContentHash !== input.expectedTestSetContentHash
            || verifiedSuite.members.length !== input.manifestItems.length
            || verifiedSuite.members.some((member, index) => member.ordinal !== index + 1
              || member.definitionAuthority.definitionId !== input.manifestItems[index].definitionId)) {
            throw new SuiteExecutionIntegrityError()
          }
        }

        const current = await trx.selectFrom('test_set_revisions')
          .select(['test_set_id', 'revision', 'schema_version', 'content_hash', 'support_seal_hash'])
          .where('project_id', '=', input.projectId)
          .orderBy('revision', 'desc').limit(1).executeTakeFirst()
        if (verifiedSuite) {
          const pinned = verifiedSuite.members[0].definitionAuthority
          if (!current || current.test_set_id !== pinned.testSetId
            || Number(current.revision) !== pinned.testSetRevision
            || Number(current.schema_version) !== pinned.definitionSchemaVersion
            || current.content_hash !== pinned.testSetContentHash) {
            throw new StaleExecutionAuthorityError('stale_suite_authority')
          }
        } else if (!current || current.test_set_id !== input.expectedTestSetId
          || Number(current.revision) !== input.expectedRevision
          || Number(current.schema_version) !== (input.definitionSchemaVersion ?? 1)
          || input.definitionSchemaVersion !== undefined && input.definitionSchemaVersion !== 1
            && (current.content_hash !== input.expectedTestSetContentHash
            || current.support_seal_hash !== input.supportSealHash)) {
          throw new StaleExecutionAuthorityError('stale_definition')
        }
        const models = await trx.selectFrom('app_models')
          .select(['id', 'version']).where('app_name', '=', input.projectId)
          .where('status', '=', 'active').execute()
        if (models.length !== 1 || Number(models[0].id) !== input.expectedModelRowId
          || models[0].version !== input.expectedModelVersion) {
          throw new StaleExecutionAuthorityError('conflicting_evidence')
        }

        await trx.insertInto('executions').values({
          execution_id: input.executionId,
          project_id: input.projectId,
          accepted_at: input.startedAt,
          test_set_id: input.expectedTestSetId,
          test_set_revision: input.expectedRevision,
          definition_schema_version: input.definitionSchemaVersion ?? 1,
          model_row_id: input.expectedModelRowId,
          model_version: input.expectedModelVersion,
          source_observation_id: input.sourceObservationId ?? null,
          support_seal_hash: input.supportSealHash ?? null,
          route_evidence_identity_hash: input.routeEvidenceIdentityHash ?? null,
          authentication_expectation_identity_hash: input.authenticationExpectationIdentityHash ?? null,
          manifest_hash: input.executionPlanHash,
          max_run_attempts: 1,
          dispatch_mode: 'serial',
          stop_rule: 'stop_on_first_non_completed',
          execution_intent_key: input.executionIntentKey,
          execution_intent_fingerprint: input.executionIntentFingerprint,
          suite_id: input.suiteAuthority?.suiteId ?? null,
          suite_revision: input.suiteAuthority?.suiteRevision ?? null,
          suite_content_hash: input.suiteAuthority?.suiteContentHash ?? null,
        }).execute()
        await trx.insertInto('execution_items').values(input.manifestItems.map(item => ({
          execution_id: input.executionId,
          item_ordinal: item.itemOrdinal,
          definition_id: item.definitionId,
          executable_plan_hash: item.executablePlanHash,
          oracle_kind: item.oracleKind ?? null,
          oracle_subject_id: item.oracleSubjectId ?? null,
        }))).execute()

        await trx.insertInto('execution_locks').values({
          project_id: input.projectId,
          execution_id: input.executionId,
          process_instance_id: input.processInstanceId,
          acquired_at: input.startedAt,
          last_heartbeat_at: input.startedAt,
        }).execute()
        await trx.insertInto('execution_events').values({
          execution_id: input.executionId,
          project_id: input.projectId,
          event_type: 'started',
          outcome: null,
          occurred_at: input.startedAt,
          process_instance_id: input.processInstanceId,
          safe_code: null,
          safe_message: 'The governed execution was accepted and its executable-plan hash was persisted.',
          execution_plan_hash: input.executionPlanHash,
          lifecycle: 'accepted',
        }).execute()
        return { kind: 'accepted' as const }
      })
    } catch (cause) {
      if (cause instanceof DuplicateExecutionError
        || cause instanceof StaleExecutionAuthorityError
        || cause instanceof SuiteExecutionIntegrityError
        || cause instanceof ExecutionPersistenceError
        || cause instanceof ExecutionIntentConflictError) throw cause
      const message = cause instanceof Error ? cause.message : String(cause)
      // A concurrent exact request can win the unique intent claim after this
      // transaction's lookup. Resolve only the persisted exact replay.
      if (/uq_executions_project_intent|executions\.project_id, executions\.execution_intent_key|UNIQUE constraint failed/i.test(message)) {
        const replay = await this.findExecutionIntent(input.projectId, input.executionIntentKey)
        if (replay) {
          if (replay.requestFingerprint !== input.executionIntentFingerprint) throw new ExecutionIntentConflictError()
          return { kind: 'replayed', ...replay }
        }
      }
      if (/execution_locks/i.test(message)) throw new DuplicateExecutionError()
      throw new ExecutionPersistenceError('Atomic execution acceptance failed; no execution identity was persisted.', { cause })
    }
  }

  async heartbeat(projectId: string, executionId: string, processInstanceId: string, occurredAt: string): Promise<void> {
    if (!exactIso(occurredAt)) throw new ExecutionPersistenceError('Execution heartbeat timestamp is malformed.')
    const result = await this.dbProvider().updateTable('execution_locks')
      .set({ last_heartbeat_at: occurredAt })
      .where('project_id', '=', projectId)
      .where('execution_id', '=', executionId)
      .where('process_instance_id', '=', processInstanceId)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) throw new ExecutionOwnershipError()
  }

  /** Appends operator intent before any in-memory cooperative signal is raised. */
  async requestCancellation(input: {
    projectId: string
    executionId: string
    requestProcessInstanceId: string
    requestedAt: string
  }): Promise<CancellationRequestWrite> {
    if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.executionId)
      || !SAFE_ID.test(input.requestProcessInstanceId) || !exactIso(input.requestedAt)) {
      throw new ExecutionPersistenceError('Cancellation request input is malformed.')
    }
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const events = await trx.selectFrom('execution_events').selectAll()
          .where('project_id', '=', input.projectId).where('execution_id', '=', input.executionId)
          .orderBy('id').execute()
        const started = events.filter(event => event.event_type === 'started')
        if (started.length === 0) return { kind: 'not_found' } as const
        if (started.length !== 1) throw new ExecutionPersistenceError()
        const terminal = events.find(event => event.event_type === 'terminal')
        if (terminal) {
          const lifecycle = terminal.lifecycle === 'cancelled' || terminal.lifecycle === 'interrupted'
            ? terminal.lifecycle
            : terminal.safe_code?.startsWith('cancelled_')
              ? 'cancelled'
              : terminal.safe_code?.startsWith('interrupted_') || terminal.outcome === 'interrupted'
                ? 'interrupted'
                : 'completed'
          return { kind: 'already_terminal', lifecycle } as const
        }
        const existing = events.find(event => event.event_type === 'cancellation_requested')
        if (existing) return { kind: 'already_requested', requestedAt: existing.occurred_at } as const
        if (input.requestedAt < started[0].occurred_at) {
          throw new ExecutionPersistenceError('Cancellation request predates execution acceptance.')
        }
        await trx.insertInto('execution_events').values({
          execution_id: input.executionId,
          project_id: input.projectId,
          event_type: 'cancellation_requested',
          outcome: null,
          occurred_at: input.requestedAt,
          process_instance_id: input.requestProcessInstanceId,
          safe_code: 'cancellation_requested',
          safe_message: 'An operator requested cooperative cancellation at the next safe boundary.',
          execution_plan_hash: started[0].execution_plan_hash,
          lifecycle: 'cancellation_requested',
        }).execute()
        return { kind: 'requested', requestedAt: input.requestedAt } as const
      })
    } catch (cause) {
      if (cause instanceof ExecutionPersistenceError) throw cause
      throw new ExecutionPersistenceError('Cancellation intent could not be persisted safely.', { cause })
    }
  }

  completeExecution(projectId: string, executionId: string, processInstanceId: string, completedAt: string): Promise<void> {
    return this.recordTerminal(projectId, executionId, processInstanceId, completedAt, 'completed', 'completed', terminalMessage('completed'))
  }

  failExecution(
    projectId: string,
    executionId: string,
    processInstanceId: string,
    completedAt: string,
    outcome: Exclude<ExecutionTerminalOutcome, 'completed' | 'interrupted'>,
    safeCode: string,
  ): Promise<void> {
    return this.recordTerminal(projectId, executionId, processInstanceId, completedAt, outcome, safeCode, terminalMessage(outcome))
  }

  /**
   * Joins the coordinator-owned cross-repository terminal transaction. The
   * aggregate is already derived from persisted Results; this repository only
   * appends the Execution event and releases its lock.
   */
  async terminalizeProductExecution(
    input: {
      projectId: string
      executionId: string
      processInstanceId: string
      completedAt: string
      outcome: ProductEvidenceOutcome
      safeCode: string
      safeMessage: string
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    if (!exactIso(input.completedAt) || !SAFE_ID.test(input.safeCode)
      || !SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.executionId)
      || !SAFE_ID.test(input.processInstanceId)
      || !['passed', 'failed', 'could_not_verify'].includes(input.outcome)
      || typeof input.safeMessage !== 'string' || input.safeMessage.length === 0 || input.safeMessage.length > 500) {
      throw new ExecutionPersistenceError('Product execution terminal input is malformed.')
    }
    const existing = await trx.selectFrom('execution_events').select('id')
      .where('execution_id', '=', input.executionId)
      .where('event_type', '=', 'terminal')
      .executeTakeFirst()
    const cancellation = await trx.selectFrom('execution_events').select('id')
      .where('execution_id', '=', input.executionId)
      .where('event_type', '=', 'cancellation_requested')
      .executeTakeFirst()
    const lock = await trx.selectFrom('execution_locks').select('project_id')
      .where('project_id', '=', input.projectId)
      .where('execution_id', '=', input.executionId)
      .where('process_instance_id', '=', input.processInstanceId)
      .executeTakeFirst()
    if (existing || cancellation || !lock) throw new ExecutionOwnershipError()
    await this.recordTerminalInTransaction(
      trx,
      input.projectId,
      input.executionId,
      input.processInstanceId,
      input.completedAt,
      input.outcome,
      input.safeCode,
      input.safeMessage,
      'completed',
    )
  }

  async terminalizeCancelledExecution(
    input: {
      projectId: string
      executionId: string
      processInstanceId: string
      completedAt: string
      outcome: ProductEvidenceOutcome
      safeCode: 'cancelled_before_execution' | 'cancelled_by_request'
      safeMessage: string
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    if (!exactIso(input.completedAt) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.processInstanceId)
      || !['passed', 'failed', 'could_not_verify'].includes(input.outcome)
      || input.safeMessage.length < 1 || input.safeMessage.length > 500) {
      throw new ExecutionPersistenceError('Cancelled execution terminal input is malformed.')
    }
    const events = await trx.selectFrom('execution_events').selectAll()
      .where('project_id', '=', input.projectId).where('execution_id', '=', input.executionId)
      .orderBy('id').execute()
    const started = events.filter(event => event.event_type === 'started')
    const requests = events.filter(event => event.event_type === 'cancellation_requested')
    const terminal = events.filter(event => event.event_type === 'terminal')
    const lock = await trx.selectFrom('execution_locks').selectAll()
      .where('project_id', '=', input.projectId).where('execution_id', '=', input.executionId)
      .where('process_instance_id', '=', input.processInstanceId).executeTakeFirst()
    if (started.length !== 1 || requests.length !== 1 || terminal.length !== 0 || !lock
      || input.completedAt < requests[0].occurred_at) throw new ExecutionOwnershipError()
    await this.recordTerminalInTransaction(
      trx, input.projectId, input.executionId, input.processInstanceId,
      input.completedAt, input.outcome, input.safeCode, input.safeMessage, 'cancelled',
    )
  }

  async readRecoverySnapshot(
    projectId: string,
    executionId: string,
    trx: Transaction<Database>,
  ): Promise<ExecutionRecoverySnapshot> {
    const [execution, items, events, lock] = await Promise.all([
      trx.selectFrom('executions').selectAll().where('execution_id', '=', executionId).executeTakeFirst(),
      trx.selectFrom('execution_items').selectAll().where('execution_id', '=', executionId).orderBy('item_ordinal').execute(),
      trx.selectFrom('execution_events').selectAll().where('execution_id', '=', executionId).orderBy('id').execute(),
      trx.selectFrom('execution_locks').selectAll().where('execution_id', '=', executionId).executeTakeFirst(),
    ])
    if (execution && execution.project_id !== projectId
      || events.some(event => event.project_id !== projectId)
      || lock && lock.project_id !== projectId) {
      throw new ExecutionPersistenceError('Execution recovery identity conflicts with its project authority.')
    }
    return { execution: execution ?? null, items, events, lock: lock ?? null }
  }

  /**
   * Read-only reporting boundary. This intentionally returns the same durable
   * authorities recovery consumes, but never performs reconciliation or writes.
   */
  async readProjectionSnapshot(
    projectId: string,
    executionId: string,
    trx?: Transaction<Database>,
  ): Promise<ExecutionProjectionSnapshot> {
    const db = trx ?? this.dbProvider()
    const execution = await db.selectFrom('executions').selectAll()
      .where('project_id', '=', projectId).where('execution_id', '=', executionId).executeTakeFirst()
    // A different workspace's identity is indistinguishable from absence at
    // this presentation boundary; never disclose cross-project existence.
    if (!execution) return { execution: null, items: [], events: [], lock: null }
    const [items, events, lock] = await Promise.all([
      db.selectFrom('execution_items').selectAll().where('execution_id', '=', executionId).orderBy('item_ordinal').execute(),
      db.selectFrom('execution_events').selectAll().where('project_id', '=', projectId)
        .where('execution_id', '=', executionId).orderBy('id').execute(),
      db.selectFrom('execution_locks').selectAll().where('project_id', '=', projectId)
        .where('execution_id', '=', executionId).executeTakeFirst(),
    ])
    if (events.some(event => event.project_id !== projectId) || lock && lock.project_id !== projectId) {
      throw new ExecutionPersistenceError('Execution projection identity conflicts with its project authority.')
    }
    return { execution, items, events, lock: lock ?? null }
  }

  /** Bounded Product roots only; accepted timestamp and identity form a stable order. */
  async listProjectionRoots(
    projectId: string,
    limit: number,
    trx?: Transaction<Database>,
  ): Promise<Execution[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new ExecutionPersistenceError('Execution projection limit is invalid.')
    }
    const db = trx ?? this.dbProvider()
    return db.selectFrom('executions').selectAll()
      .where('project_id', '=', projectId)
      .orderBy('accepted_at', 'desc')
      .orderBy('execution_id', 'asc')
      .limit(limit)
      .execute()
  }

  async readProjectLock(projectId: string): Promise<ExecutionLock | null> {
    return (await this.dbProvider().selectFrom('execution_locks').selectAll()
      .where('project_id', '=', projectId).executeTakeFirst()) ?? null
  }

  async terminalizeRecoveredExecution(
    input: {
      projectId: string
      executionId: string
      recoveryProcessInstanceId: string
      expectedLockProcessInstanceId: string | null
      completedAt: string
      outcome: ProductEvidenceOutcome
      lifecycle: ExecutionTerminalLifecycle
      safeCode: string
      safeMessage: string
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    if (!exactIso(input.completedAt) || !SAFE_ID.test(input.projectId)
      || !SAFE_ID.test(input.executionId) || !SAFE_ID.test(input.recoveryProcessInstanceId)
      || input.expectedLockProcessInstanceId !== null && !SAFE_ID.test(input.expectedLockProcessInstanceId)
      || !SAFE_ID.test(input.safeCode) || !['passed', 'failed', 'could_not_verify'].includes(input.outcome)
      || !['completed', 'cancelled', 'interrupted'].includes(input.lifecycle)
      || input.safeMessage.length < 1 || input.safeMessage.length > 500) {
      throw new ExecutionPersistenceError('Recovered execution terminal input is malformed.')
    }
    const events = await trx.selectFrom('execution_events').selectAll()
      .where('project_id', '=', input.projectId).where('execution_id', '=', input.executionId)
      .orderBy('id').execute()
    const started = events.filter(event => event.event_type === 'started')
    const terminal = events.filter(event => event.event_type === 'terminal')
    const lock = await trx.selectFrom('execution_locks').selectAll()
      .where('project_id', '=', input.projectId).where('execution_id', '=', input.executionId).executeTakeFirst()
    if (started.length !== 1 || terminal.length !== 0
      || (input.expectedLockProcessInstanceId === null) !== !lock
      || lock && lock.process_instance_id !== input.expectedLockProcessInstanceId) {
      throw new ExecutionOwnershipError()
    }
    await trx.insertInto('execution_events').values({
      execution_id: input.executionId,
      project_id: input.projectId,
      event_type: 'terminal',
      outcome: input.outcome,
      occurred_at: input.completedAt,
      process_instance_id: input.recoveryProcessInstanceId,
      safe_code: input.safeCode,
      safe_message: input.safeMessage,
      execution_plan_hash: started[0].execution_plan_hash,
      lifecycle: input.lifecycle,
    }).execute()
    if (lock) {
      const released = await trx.deleteFrom('execution_locks')
        .where('project_id', '=', input.projectId)
        .where('execution_id', '=', input.executionId)
        .where('process_instance_id', '=', input.expectedLockProcessInstanceId!)
        .executeTakeFirst()
      if (Number(released.numDeletedRows) !== 1) throw new ExecutionOwnershipError()
    }
  }

  async releaseRecoveredLock(
    projectId: string,
    executionId: string,
    expectedProcessInstanceId: string,
    trx: Transaction<Database>,
  ): Promise<void> {
    const released = await trx.deleteFrom('execution_locks')
      .where('project_id', '=', projectId).where('execution_id', '=', executionId)
      .where('process_instance_id', '=', expectedProcessInstanceId).executeTakeFirst()
    if (Number(released.numDeletedRows) !== 1) throw new ExecutionOwnershipError()
  }

  private async recordTerminal(
    projectId: string,
    executionId: string,
    processInstanceId: string,
    completedAt: string,
    outcome: ExecutionTerminalOutcome,
    safeCode: string,
    safeMessage: string,
  ): Promise<void> {
    if (!exactIso(completedAt) || !SAFE_ID.test(safeCode)) {
      throw new ExecutionPersistenceError('Execution terminal input is malformed.')
    }
    try {
      await this.dbProvider().transaction().execute(trx => this.recordTerminalInTransaction(
        trx, projectId, executionId, processInstanceId, completedAt, outcome, safeCode, safeMessage,
        outcome === 'interrupted' ? 'interrupted' : 'completed',
      ))
    } catch (cause) {
      if (cause instanceof ExecutionPersistenceError || cause instanceof ExecutionOwnershipError) throw cause
      throw new ExecutionPersistenceError('Execution terminal state could not be persisted; completion was not recorded.', { cause })
    }
  }

  private async recordTerminalInTransaction(
    trx: Transaction<Database>,
    projectId: string,
    executionId: string,
    processInstanceId: string,
    completedAt: string,
    outcome: ExecutionTerminalOutcome,
    safeCode: string,
    safeMessage: string,
    lifecycle: ExecutionTerminalLifecycle,
  ): Promise<void> {
    const events = await trx.selectFrom('execution_events').selectAll()
      .where('project_id', '=', projectId).where('execution_id', '=', executionId)
      .orderBy('id').execute()
    const started = events.find(event => event.event_type === 'started')
    if (!started || started.process_instance_id !== processInstanceId) throw new ExecutionOwnershipError()
    const existing = events.find(event => event.event_type === 'terminal')
    if (!existing) {
      await trx.insertInto('execution_events').values({
        execution_id: executionId,
        project_id: projectId,
        event_type: 'terminal',
        outcome,
        occurred_at: completedAt,
        process_instance_id: processInstanceId,
        safe_code: safeCode,
        safe_message: safeMessage,
        execution_plan_hash: started.execution_plan_hash,
        lifecycle,
      }).execute()
    }
    await trx.deleteFrom('execution_locks')
      .where('project_id', '=', projectId)
      .where('execution_id', '=', executionId)
      .where('process_instance_id', '=', processInstanceId)
      .execute()
  }
}
