/**
 * FORGE - Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is prohibited.
 */

import * as crypto from 'crypto'
import { getDb } from '../db'
import { AppModel as StoredAppModel, NewAppModel } from '../types'
import type {
  AppModel as AppModelSnapshot,
  AppModelCandidate,
} from '../../onboarding/types'
import { validateAppModelObject } from '../../onboarding/ModelValidator'
import { canonicalJson } from '../JsonAppModelMigrationPlanner'
import {
  AppModelCanonicalCandidateError,
  type CanonicalCandidateIssue,
  type MaterializedAppModelCandidate,
  type MaterializedAppModelSnapshot,
  materializeAppModelCandidate,
  materializeAppModelSnapshot,
} from '../AppModelCanonicalCandidate'
import type {
  InvalidActiveInspection,
  InvalidActiveRecoveryRequest,
} from '../AppModelRecoveryContract'

export type AppModelCommitOutcome = 'committed_new' | 'replayed_existing'

export interface CommittedAppModel {
  rowId: number
  appName: string
  operationId: string | null
  candidateHash: string | null
  status: string
  snapshot: AppModelSnapshot
  recoverySourceRowId: number | null
  recoverySourceFingerprint: string | null
}

export interface AppModelCommitResult {
  outcome: AppModelCommitOutcome
  committed: CommittedAppModel
}

export type AppModelPersistenceStage =
  | 'candidate-materialization'
  | 'candidate-validation'
  | 'candidate-hash'
  | 'transaction-replay-read'
  | 'transaction-source-read'
  | 'transaction-active-read'
  | 'transaction-history-read'
  | 'transaction-source-supersede'
  | 'transaction-replacement-insert'
  | 'transaction-commit'
  | 'conflict-resolution-read'
  | 'committed-row-read'
  | 'service-boundary'

export interface AppModelPersistenceCauseDiagnostic {
  name: string
  code: string | null
  summary: string
}

export interface AppModelPersistenceDiagnostic {
  stage: AppModelPersistenceStage
  causeChain: AppModelPersistenceCauseDiagnostic[]
  structuralIssues?: CanonicalCandidateIssue[]
}

function safeCauseName(cause: Error): string {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(cause.name) ? cause.name : 'Error'
}

function safeCauseCode(cause: Error): string | null {
  const code = (cause as Error & { code?: unknown }).code
  return typeof code === 'string' && /^SQLITE_[A-Z0-9_]+$/.test(code) ? code : null
}

/**
 * Persistable/operator-visible cause text is deliberately allowlisted. SQLite
 * table/column constraint identities are useful and non-secret; arbitrary
 * driver text is not, because it can contain values, paths, connection details,
 * or model payload fragments.
 */
function safeCauseSummary(cause: Error, code: string | null): string {
  if (cause.message === "Canonical JSON cannot contain a value of type 'undefined'.") {
    return cause.message
  }
  if (code) {
    const constraint = /^(UNIQUE|NOT NULL|FOREIGN KEY|CHECK) constraint failed(?:: ([A-Za-z0-9_., ()-]+))?$/i.exec(cause.message)
    if (constraint) return constraint[0]
    if (/database is (?:locked|busy)/i.test(cause.message)) {
      return 'SQLite could not serialize the operation because the database was busy or locked.'
    }
    return 'SQLite rejected the operation; arbitrary driver detail was withheld.'
  }
  if (cause instanceof AppModelPersistenceError && /^\[AppModel[A-Za-z.]+\]/.test(cause.message)) {
    return cause.message
  }
  return 'Internal cause detail was withheld.'
}

export function appModelPersistenceDiagnostic(
  stage: AppModelPersistenceStage,
  ...causes: unknown[]
): AppModelPersistenceDiagnostic {
  const causeChain: AppModelPersistenceCauseDiagnostic[] = []
  const seen = new Set<unknown>()
  const visit = (cause: unknown): void => {
    if (!(cause instanceof Error) || seen.has(cause) || causeChain.length >= 8) return
    seen.add(cause)
    const code = safeCauseCode(cause)
    causeChain.push({
      name: safeCauseName(cause),
      code,
      summary: safeCauseSummary(cause, code),
    })
    if (cause instanceof AggregateError) {
      for (const nested of cause.errors) visit(nested)
    }
    visit((cause as Error & { cause?: unknown }).cause)
  }
  for (const cause of causes) visit(cause)
  return { stage, causeChain }
}

export class AppModelPersistenceError extends Error {
  readonly diagnostic?: AppModelPersistenceDiagnostic

  constructor(
    message: string,
    options?: { cause?: unknown; diagnostic?: AppModelPersistenceDiagnostic },
  ) {
    super(message, options)
    this.name = 'AppModelPersistenceError'
    this.diagnostic = options?.diagnostic
  }
}

export class InvalidAppModelCandidateError extends AppModelPersistenceError {
  constructor(operation: string, cause: AppModelCanonicalCandidateError) {
    super(
      `[AppModelRepository.${operation}] App Model candidate failed canonical ` +
      `materialization or schema validation; no rows changed.`,
      {
        cause,
        diagnostic: {
          ...appModelPersistenceDiagnostic('candidate-materialization', cause),
          structuralIssues: cause.issues,
        },
      },
    )
    this.name = 'InvalidAppModelCandidateError'
  }
}

export class InvalidAppModelStateError extends AppModelPersistenceError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAppModelStateError'
  }
}

export class AppModelOperationConflictError extends AppModelPersistenceError {
  constructor(
    readonly appName: string,
    readonly operationId: string,
  ) {
    super(
      `[AppModelRepository.commitCandidate] Operation identity conflict for ` +
      `'${appName}' operation '${operationId}': the durable operation already ` +
      `contains a different validated candidate.`,
    )
    this.name = 'AppModelOperationConflictError'
  }
}

export class RetryableAppModelConflictError extends AppModelPersistenceError {
  readonly retryable = true

  constructor(
    message: string,
    options?: { cause?: unknown; diagnostic?: AppModelPersistenceDiagnostic },
  ) {
    super(message, options)
    this.name = 'RetryableAppModelConflictError'
  }
}

export class InvalidActiveRecoveryConflictError extends AppModelPersistenceError {
  constructor(
    readonly appName: string,
    readonly operationId: string,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(
      `[AppModelRepository.commitInvalidActiveRecovery] Recovery conflict for ` +
      `'${appName}' operation '${operationId}': ${reason}`,
      options,
    )
    this.name = 'InvalidActiveRecoveryConflictError'
  }
}

export class CommittedAppModelNotFoundError extends AppModelPersistenceError {
  constructor(readonly rowId: number) {
    super(`[AppModelRepository.getCommittedById] Committed App Model row ${rowId} does not exist.`)
    this.name = 'CommittedAppModelNotFoundError'
  }
}

export class AppModelProjectionError extends AppModelPersistenceError {
  constructor(
    message: string,
    readonly committed: CommittedAppModel,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AppModelProjectionError'
  }
}

function allocateNextVersion(
  history: Array<{ id: number; version: string }>,
  appName: string,
): string {
  if (history.length === 0) return '1.0.0'

  let maximum: [number, number, number] | null = null
  for (const row of history) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(row.version)
    const version = match
      ? [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
      : null
    if (!version || !version.every(Number.isSafeInteger)) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.commitCandidate] Cannot allocate the next version for ` +
        `'${appName}': SQLite row ${row.id} contains malformed modelVersion ` +
        `'${row.version}'; expected strict numeric major.minor.patch.`,
      )
    }
    if (
      maximum === null
      || version[0] > maximum[0]
      || (version[0] === maximum[0] && version[1] > maximum[1])
      || (version[0] === maximum[0] && version[1] === maximum[1] && version[2] > maximum[2])
    ) {
      maximum = version
    }
  }

  if (!maximum || maximum[2] === Number.MAX_SAFE_INTEGER) {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.commitCandidate] Cannot allocate the next version for ` +
      `'${appName}': maximum persisted patch version cannot be incremented safely.`,
    )
  }
  return `${maximum[0]}.${maximum[1]}.${maximum[2] + 1}`
}

function materializeCandidate(
  candidate: AppModelCandidate,
  operation: string,
): MaterializedAppModelCandidate {
  try {
    return materializeAppModelCandidate(candidate)
  } catch (cause) {
    if (cause instanceof AppModelCanonicalCandidateError) {
      throw new InvalidAppModelCandidateError(operation, cause)
    }
    throw cause
  }
}

function rowFromSnapshot(
  materialized: MaterializedAppModelSnapshot,
  operationId: string | null,
  candidateHash: string | null,
  recoverySource: {
    rowId: number
    fingerprint: string
  } | null = null,
): NewAppModel {
  const model = materialized.snapshot
  const validation = validateAppModelObject(model)
  if (!validation.valid) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.upsert] App Model '${model?.app?.name ?? 'unknown'}' failed schema validation: ${validation.errors.join('; ')}`,
    )
  }

  const isApiModel = model.app.appType === 'rest-api'
    || model.app.appType === 'graphql-api'
    || (model.endpoints?.length ?? 0) > 0

  return {
    app_name:          model.app.name,
    version:           model.app.modelVersion,
    base_url:          model.app.baseUrl,
    app_type:          model.app.appType,
    intake_mode:       isApiModel ? 'spec-driven' : 'crawl',
    crawl_config_hash: model.app.crawlMetadata?.crawlConfigHash ?? '',
    page_count:        isApiModel ? (model.endpoints?.length ?? 0) : (model.pages?.length ?? 0),
    flow_count:        model.flows?.length ?? 0,
    role_count:        model.roles.length,
    model_json:        materialized.canonicalJson,
    crawled_at:        model.app.crawlMetadata?.crawledAt ?? null,
    crawled_by:        model.app.crawlMetadata?.crawledBy ?? null,
    status:            'active',
    evidence_state:    model.app.evidenceState,
    operation_id:      operationId,
    candidate_hash:    candidateHash,
    recovery_source_row_id: recoverySource?.rowId ?? null,
    recovery_source_fingerprint: recoverySource?.fingerprint ?? null,
  }
}

function parseCommittedRow(row: StoredAppModel, operation: string): CommittedAppModel {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.model_json)
  } catch (cause) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.${operation}] App Model '${row.app_name}' row ${row.id} ` +
      `version '${row.version}' contains malformed model_json.`,
      { cause },
    )
  }

  const validation = validateAppModelObject(parsed)
  if (!validation.valid) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.${operation}] App Model '${row.app_name}' row ${row.id} ` +
      `version '${row.version}' contains schema-invalid model_json: ${validation.errors.join('; ')}`,
    )
  }
  const snapshot = parsed as AppModelSnapshot
  if (snapshot.app.name !== row.app_name || snapshot.app.modelVersion !== row.version) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.${operation}] App Model row ${row.id} identity does not match model_json: ` +
      `row='${row.app_name}' v${row.version}, json='${snapshot.app.name}' v${snapshot.app.modelVersion}.`,
    )
  }

  return {
    rowId: Number(row.id),
    appName: row.app_name,
    operationId: row.operation_id ?? null,
    candidateHash: row.candidate_hash ?? null,
    status: row.status,
    snapshot,
    recoverySourceRowId: row.recovery_source_row_id ?? null,
    recoverySourceFingerprint: row.recovery_source_fingerprint ?? null,
  }
}

function isSqliteBusy(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const code = (cause as { code?: unknown }).code
  const message = cause instanceof Error ? cause.message : String(cause)
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
    || /database is (?:locked|busy)/i.test(message)
}

function rawModelJsonFingerprint(modelJson: string): string {
  return crypto.createHash('sha256').update(modelJson).digest('hex')
}

function invalidRowValidationErrors(
  row: { app_name: string; version: string; model_json: string },
): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.model_json)
  } catch (cause) {
    return [
      `model_json JSON parse failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    ]
  }

  const validation = validateAppModelObject(parsed)
  const errors = [...validation.errors]
  if (validation.valid) {
    const snapshot = parsed as AppModelSnapshot
    if (snapshot.app.name !== row.app_name) {
      errors.push(
        `model_json app.name '${snapshot.app.name}' does not match row app_name '${row.app_name}'.`,
      )
    }
    if (snapshot.app.modelVersion !== row.version) {
      errors.push(
        `model_json app.modelVersion '${snapshot.app.modelVersion}' does not match row version '${row.version}'.`,
      )
    }
  }
  return errors
}

function validateRecoveryRequest(
  request: InvalidActiveRecoveryRequest,
  operation: string,
): void {
  if (request.app_name.trim() === '') {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.${operation}] app_name must be non-empty.`,
    )
  }
  if (request.operation_id.trim() === '') {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.${operation}] operation_id must be non-empty.`,
    )
  }
  if (!Number.isSafeInteger(request.expected_row_id) || request.expected_row_id <= 0) {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.${operation}] expected_row_id must be a positive safe integer.`,
    )
  }
  if (!/^[a-f0-9]{64}$/.test(request.expected_source_fingerprint)) {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.${operation}] expected_source_fingerprint must be a lowercase SHA-256 hex digest.`,
    )
  }
  if (request.operator_acknowledgement !== true) {
    throw new InvalidAppModelStateError(
      `[AppModelRepository.${operation}] explicit operator acknowledgement is required.`,
    )
  }
}

export class AppModelRepository {
  /**
   * Commit a canonical runtime candidate with orchestrator-owned operation
   * identity. Version allocation, superseding, insertion, and durable replay
   * enforcement all occur inside one SQLite transaction. The returned object is
   * always re-read from SQLite by exact row ID after the transaction completes.
   */
  async commitCandidate(
    candidate: AppModelCandidate,
    operationId: string,
  ): Promise<AppModelCommitResult> {
    const canonicalCandidate = materializeCandidate(candidate, 'commitCandidate')
    const appName = canonicalCandidate.candidate.app.name
    if (operationId.trim() === '') {
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitCandidate] '${appName}' requires a non-empty orchestrator operation ID.`,
      )
    }
    const candidateHash = canonicalCandidate.candidateHash
    const db = getDb()

    let identity: { outcome: AppModelCommitOutcome; rowId: number }
    try {
      identity = await db.transaction().execute(async trx => {
        const replay = await trx.selectFrom('app_models')
          .select(['id', 'candidate_hash'])
          .where('app_name', '=', appName)
          .where('operation_id', '=', operationId)
          .executeTakeFirst()

        if (replay?.candidate_hash !== undefined && replay.candidate_hash !== candidateHash) {
          throw new AppModelOperationConflictError(appName, operationId)
        }

        const activeRows = await trx.selectFrom('app_models')
          .select(['id'])
          .where('app_name', '=', appName)
          .where('status', '=', 'active')
          .orderBy('id', 'desc')
          .limit(2)
          .execute()
        if (activeRows.length > 1) {
          throw new InvalidAppModelStateError(
            `[AppModelRepository.commitCandidate] Invalid database state for ` +
            `'${appName}': multiple active rows (${activeRows.map(row => row.id).join(', ')}).`,
          )
        }
        if (replay) {
          return { outcome: 'replayed_existing' as const, rowId: Number(replay.id) }
        }

        const history = await trx.selectFrom('app_models')
          .select(['id', 'version'])
          .where('app_name', '=', appName)
          .execute()
        const version = allocateNextVersion(
          history.map(row => ({ id: Number(row.id), version: row.version })),
          appName,
        )
        const snapshot = materializeAppModelSnapshot(canonicalCandidate, version)
        const row = rowFromSnapshot(snapshot, operationId, candidateHash)

        if (activeRows.length === 1) {
          await trx.updateTable('app_models')
            .set({ status: 'superseded' })
            .where('id', '=', activeRows[0].id)
            .execute()
        }

        const inserted = await trx.insertInto('app_models')
          .values(row)
          .returning('id')
          .executeTakeFirstOrThrow()
        return { outcome: 'committed_new' as const, rowId: Number(inserted.id) }
      })
    } catch (cause) {
      if (cause instanceof AppModelPersistenceError) throw cause

      // A second connection may win the unique-index race after our initial
      // lookup. Resolve the durable operation identity instead of inserting a
      // second snapshot. The database partial unique index is final authority.
      try {
        const replay = await db.selectFrom('app_models')
          .select(['id', 'candidate_hash'])
          .where('app_name', '=', appName)
          .where('operation_id', '=', operationId)
          .executeTakeFirst()
        if (replay) {
          if (replay.candidate_hash !== candidateHash) {
            throw new AppModelOperationConflictError(appName, operationId)
          }
          identity = { outcome: 'replayed_existing', rowId: Number(replay.id) }
        } else if (isSqliteBusy(cause)) {
          throw new RetryableAppModelConflictError(
            `[AppModelRepository.commitCandidate] SQLite could not serialize ` +
            `'${appName}' operation '${operationId}'. Retry the same operation ID.`,
            { cause },
          )
        } else {
          throw new AppModelPersistenceError(
            `[AppModelRepository.commitCandidate] Failed to commit App Model ` +
            `candidate '${appName}' for operation '${operationId}'.`,
            { cause },
          )
        }
      } catch (resolutionCause) {
        if (resolutionCause instanceof AppModelPersistenceError) throw resolutionCause
        throw new AppModelPersistenceError(
          `[AppModelRepository.commitCandidate] Failed to resolve App Model ` +
          `operation '${operationId}' after a transactional conflict.`,
          { cause: resolutionCause },
        )
      }
    }

    const committed = await this.getCommittedById(identity.rowId)
    if (
      committed.appName !== appName
      || committed.operationId !== operationId
      || committed.candidateHash !== candidateHash
    ) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitCandidate] Re-read row ${identity.rowId} does not ` +
        `match '${appName}' operation '${operationId}' and its candidate hash.`,
      )
    }
    return { outcome: identity.outcome, committed }
  }

  /**
   * Replace one specifically acknowledged invalid active row. Every guard is
   * re-established inside the same transaction that supersedes the source and
   * inserts the fresh candidate. The invalid model_json is fingerprinted and
   * validated as raw evidence only; it is never parsed into a trusted model.
   */
  async commitInvalidActiveRecovery(
    candidate: AppModelCandidate,
    request: InvalidActiveRecoveryRequest,
  ): Promise<AppModelCommitResult> {
    validateRecoveryRequest(request, 'commitInvalidActiveRecovery')
    const canonicalCandidate = materializeCandidate(
      candidate,
      'commitInvalidActiveRecovery',
    )
    if (canonicalCandidate.candidate.app.name !== request.app_name) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitInvalidActiveRecovery] Fresh candidate app ` +
        `does not match the requested recovery identity.`,
      )
    }
    const candidateHash = canonicalCandidate.candidateHash
    const db = getDb()

    const assertReplay = (
      replay: {
        id: number
        candidate_hash: string | null
        recovery_source_row_id: number | null
        recovery_source_fingerprint: string | null
      },
    ): number => {
      if (
        replay.candidate_hash !== candidateHash
        || Number(replay.recovery_source_row_id) !== request.expected_row_id
        || replay.recovery_source_fingerprint !== request.expected_source_fingerprint
      ) {
        throw new AppModelOperationConflictError(request.app_name, request.operation_id)
      }
      return Number(replay.id)
    }

    let identity: { outcome: AppModelCommitOutcome; rowId: number }
    let transactionStage: AppModelPersistenceStage = 'transaction-replay-read'
    try {
      identity = await db.transaction().execute(async trx => {
        transactionStage = 'transaction-replay-read'
        const replay = await trx.selectFrom('app_models')
          .select([
            'id',
            'candidate_hash',
            'recovery_source_row_id',
            'recovery_source_fingerprint',
          ])
          .where('app_name', '=', request.app_name)
          .where('operation_id', '=', request.operation_id)
          .executeTakeFirst()
        if (replay) {
          return {
            outcome: 'replayed_existing' as const,
            rowId: assertReplay(replay),
          }
        }

        transactionStage = 'transaction-source-read'
        const expected = await trx.selectFrom('app_models')
          .select(['id', 'app_name', 'version', 'status', 'model_json'])
          .where('id', '=', request.expected_row_id)
          .executeTakeFirst()
        if (!expected) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `expected source row ${request.expected_row_id} no longer exists.`,
          )
        }
        if (expected.app_name !== request.app_name) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `expected row ${request.expected_row_id} belongs to ` +
            `'${expected.app_name}', not '${request.app_name}'.`,
          )
        }
        if (expected.status !== 'active') {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `expected source row ${request.expected_row_id} is now ` +
            `'${expected.status}', not active.`,
          )
        }

        transactionStage = 'transaction-active-read'
        const activeRows = await trx.selectFrom('app_models')
          .select(['id'])
          .where('app_name', '=', request.app_name)
          .where('status', '=', 'active')
          .orderBy('id', 'desc')
          .limit(2)
          .execute()
        if (
          activeRows.length !== 1
          || Number(activeRows[0].id) !== request.expected_row_id
        ) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `active row identity changed; expected only row ` +
            `${request.expected_row_id}, observed ` +
            `${activeRows.length === 0 ? 'none' : activeRows.map(row => row.id).join(', ')}.`,
          )
        }

        const fingerprint = rawModelJsonFingerprint(expected.model_json)
        if (fingerprint !== request.expected_source_fingerprint) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `source row ${request.expected_row_id} fingerprint changed.`,
          )
        }
        if (invalidRowValidationErrors(expected).length === 0) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `source row ${request.expected_row_id} is now a valid App Model.`,
          )
        }

        transactionStage = 'transaction-history-read'
        const history = await trx.selectFrom('app_models')
          .select(['id', 'version'])
          .where('app_name', '=', request.app_name)
          .execute()
        const version = allocateNextVersion(
          history.map(row => ({ id: Number(row.id), version: row.version })),
          request.app_name,
        )
        const snapshot = materializeAppModelSnapshot(canonicalCandidate, version)
        const row = rowFromSnapshot(
          snapshot,
          request.operation_id,
          candidateHash,
          {
            rowId: request.expected_row_id,
            fingerprint: request.expected_source_fingerprint,
          },
        )

        transactionStage = 'transaction-source-supersede'
        const superseded = await trx.updateTable('app_models')
          .set({ status: 'superseded' })
          .where('id', '=', request.expected_row_id)
          .where('app_name', '=', request.app_name)
          .where('status', '=', 'active')
          .where('model_json', '=', expected.model_json)
          .executeTakeFirst()
        if (Number(superseded.numUpdatedRows) !== 1) {
          throw new InvalidActiveRecoveryConflictError(
            request.app_name,
            request.operation_id,
            `source row ${request.expected_row_id} changed before supersede.`,
          )
        }

        transactionStage = 'transaction-replacement-insert'
        const inserted = await trx.insertInto('app_models')
          .values(row)
          .returning('id')
          .executeTakeFirstOrThrow()
        transactionStage = 'transaction-commit'
        return { outcome: 'committed_new' as const, rowId: Number(inserted.id) }
      })
    } catch (cause) {
      if (cause instanceof AppModelPersistenceError) throw cause

      const failedStage = transactionStage
      try {
        transactionStage = 'conflict-resolution-read'
        const replay = await db.selectFrom('app_models')
          .select([
            'id',
            'candidate_hash',
            'recovery_source_row_id',
            'recovery_source_fingerprint',
          ])
          .where('app_name', '=', request.app_name)
          .where('operation_id', '=', request.operation_id)
          .executeTakeFirst()
        if (replay) {
          identity = {
            outcome: 'replayed_existing',
            rowId: assertReplay(replay),
          }
        } else if (isSqliteBusy(cause)) {
          throw new RetryableAppModelConflictError(
            `[AppModelRepository.commitInvalidActiveRecovery] SQLite could not ` +
            `serialize '${request.app_name}' recovery '${request.operation_id}'. ` +
            `Retry the same operation ID.`,
            { cause, diagnostic: appModelPersistenceDiagnostic(failedStage, cause) },
          )
        } else {
          throw new AppModelPersistenceError(
            `[AppModelRepository.commitInvalidActiveRecovery] Failed to commit ` +
            `guarded recovery for '${request.app_name}' operation ` +
            `'${request.operation_id}' at stage '${failedStage}'. The ` +
            `transaction was rolled back.`,
            { cause, diagnostic: appModelPersistenceDiagnostic(failedStage, cause) },
          )
        }
      } catch (resolutionCause) {
        if (resolutionCause instanceof AppModelPersistenceError) throw resolutionCause
        throw new AppModelPersistenceError(
          `[AppModelRepository.commitInvalidActiveRecovery] Failed to resolve ` +
          `recovery operation '${request.operation_id}' after a transactional conflict.`,
          {
            cause: new AggregateError([cause, resolutionCause], 'Recovery transaction and conflict resolution both failed.'),
            diagnostic: appModelPersistenceDiagnostic('conflict-resolution-read', cause, resolutionCause),
          },
        )
      }
    }

    let committed: CommittedAppModel
    try {
      committed = await this.getCommittedById(identity.rowId)
    } catch (cause) {
      if (cause instanceof AppModelPersistenceError && cause.diagnostic) throw cause
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitInvalidActiveRecovery] Recovery committed row ` +
        `${identity.rowId}, but its authoritative re-read failed.`,
        { cause, diagnostic: appModelPersistenceDiagnostic('committed-row-read', cause) },
      )
    }
    if (
      committed.appName !== request.app_name
      || committed.operationId !== request.operation_id
      || committed.candidateHash !== candidateHash
      || committed.recoverySourceRowId !== request.expected_row_id
      || committed.recoverySourceFingerprint !== request.expected_source_fingerprint
    ) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitInvalidActiveRecovery] Re-read row ` +
        `${identity.rowId} does not match the requested recovery identity and provenance.`,
      )
    }
    return { outcome: identity.outcome, committed }
  }

  /** Legacy/fixture write boundary. Canonical runtime code uses commitCandidate. */
  async upsert(snapshot: AppModelSnapshot): Promise<StoredAppModel> {
    const row = rowFromSnapshot(
      { snapshot, canonicalJson: canonicalJson(snapshot) },
      null,
      null,
    )
    const db = getDb()
    try {
      return await db.transaction().execute(async trx => {
        await trx.updateTable('app_models')
          .set({ status: 'superseded' })
          .where('app_name', '=', row.app_name)
          .where('status', '=', 'active')
          .execute()

        return trx.insertInto('app_models')
          .values(row)
          .returningAll()
          .executeTakeFirstOrThrow()
      })
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.upsert] Failed to replace active App Model ` +
        `'${row.app_name}' version '${row.version}'.`,
        { cause },
      )
    }
  }

  async findActive(appName: string): Promise<StoredAppModel | null> {
    const db = getDb()
    let rows: StoredAppModel[]
    try {
      rows = await db.selectFrom('app_models')
        .selectAll()
        .where('app_name', '=', appName)
        .where('status', '=', 'active')
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.findActive] Failed to read active App Model '${appName}'.`,
        { cause },
      )
    }
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.findActive] Invalid database state for '${appName}': ` +
        `multiple active rows (${rows.map(row => row.id).join(', ')}).`,
      )
    }
    return rows[0] ?? null
  }

  /**
   * Bind a future guarded recovery operation to exact raw evidence from one
   * invalid active row. This method is read-only and never returns model_json,
   * parsed JSON, or a trusted AppModel.
   */
  async inspectInvalidActiveForRecovery(
    request: InvalidActiveRecoveryRequest,
  ): Promise<InvalidActiveInspection> {
    validateRecoveryRequest(request, 'inspectInvalidActiveForRecovery')

    const db = getDb()
    let rows: Array<{
      id: number
      app_name: string
      version: string
      status: string
      model_json: string
    }>
    try {
      rows = await db.selectFrom('app_models')
        .select(['id', 'app_name', 'version', 'status', 'model_json'])
        .where('app_name', '=', request.app_name)
        .where('status', '=', 'active')
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Failed to inspect ` +
        `active App Model '${request.app_name}'.`,
        { cause },
      )
    }

    if (rows.length === 0) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Active App Model ` +
        `'${request.app_name}' does not exist.`,
      )
    }
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Invalid database state ` +
        `for '${request.app_name}': multiple active rows ` +
        `(${rows.map(row => row.id).join(', ')}).`,
      )
    }

    const row = rows[0]
    const rowId = Number(row.id)
    const fingerprint = rawModelJsonFingerprint(row.model_json)
    if (rowId !== request.expected_row_id) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Active row changed for ` +
        `'${request.app_name}': expected row ${request.expected_row_id}, observed row ${rowId}.`,
      )
    }
    if (fingerprint !== request.expected_source_fingerprint) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Active row ${rowId} ` +
        `fingerprint mismatch for '${request.app_name}'.`,
      )
    }

    const validationErrors = invalidRowValidationErrors(row)
    if (validationErrors.length === 0) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.inspectInvalidActiveForRecovery] Active row ${rowId} ` +
        `for '${request.app_name}' is a valid App Model and is not eligible for invalid-active inspection.`,
      )
    }

    return {
      row_id: rowId,
      app_name: row.app_name,
      version: row.version,
      status: row.status,
      raw_model_json_fingerprint: fingerprint,
      validation_errors: validationErrors,
    }
  }

  /**
   * Read-only discovery for an explicitly forced guarded recovery. Returns only
   * identity, fingerprint, and deterministic validation diagnostics; raw
   * model_json remains inside SQLite and never crosses the trusted boundary.
   */
  async findInvalidActiveForRecovery(appName: string): Promise<InvalidActiveInspection | null> {
    if (appName.trim() === '') {
      throw new InvalidAppModelStateError(
        '[AppModelRepository.findInvalidActiveForRecovery] appName must be non-empty.',
      )
    }

    const db = getDb()
    let rows: Array<{
      id: number
      app_name: string
      version: string
      status: string
      model_json: string
    }>
    try {
      rows = await db.selectFrom('app_models')
        .select(['id', 'app_name', 'version', 'status', 'model_json'])
        .where('app_name', '=', appName)
        .where('status', '=', 'active')
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.findInvalidActiveForRecovery] Failed to inspect ` +
        `active App Model '${appName}'.`,
        { cause },
      )
    }
    if (rows.length === 0) return null
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.findInvalidActiveForRecovery] Invalid database state ` +
        `for '${appName}': multiple active rows ` +
        `(${rows.map(row => row.id).join(', ')}).`,
      )
    }

    const row = rows[0]
    const validationErrors = invalidRowValidationErrors(row)
    if (validationErrors.length === 0) return null
    return {
      row_id: Number(row.id),
      app_name: row.app_name,
      version: row.version,
      status: row.status,
      raw_model_json_fingerprint: rawModelJsonFingerprint(row.model_json),
      validation_errors: validationErrors,
    }
  }

  async findHistory(appName: string): Promise<StoredAppModel[]> {
    const db = getDb()
    return db.selectFrom('app_models')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('crawled_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
  }

  /**
   * Resolve an orchestrator-owned operation before expensive runtime work.
   * Exact app_name and operation_id identity is authoritative; the stored row
   * is parsed through the same validation boundary as every runtime read.
   */
  async findCommittedByOperation(
    appName: string,
    operationId: string,
  ): Promise<CommittedAppModel | null> {
    const db = getDb()
    let rows: StoredAppModel[]
    try {
      rows = await db.selectFrom('app_models')
        .selectAll()
        .where('app_name', '=', appName)
        .where('operation_id', '=', operationId)
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.findCommittedByOperation] Failed to resolve ` +
        `'${appName}' operation '${operationId}'.`,
        { cause },
      )
    }
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.findCommittedByOperation] Invalid database state for ` +
        `'${appName}' operation '${operationId}': multiple committed rows ` +
        `(${rows.map(row => row.id).join(', ')}).`,
      )
    }
    return rows[0] ? parseCommittedRow(rows[0], 'findCommittedByOperation') : null
  }

  /**
   * Resolve only a completed recovery replay whose durable source provenance
   * matches the operator's exact request. A normal operation or a recovery for
   * different evidence is an operation-identity conflict, never a replay.
   */
  async findCommittedRecoveryByOperation(
    request: InvalidActiveRecoveryRequest,
  ): Promise<CommittedAppModel | null> {
    validateRecoveryRequest(request, 'findCommittedRecoveryByOperation')
    const db = getDb()
    let rows: StoredAppModel[]
    try {
      rows = await db.selectFrom('app_models')
        .selectAll()
        .where('app_name', '=', request.app_name)
        .where('operation_id', '=', request.operation_id)
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.findCommittedRecoveryByOperation] Failed to resolve ` +
        `'${request.app_name}' recovery '${request.operation_id}'.`,
        { cause },
      )
    }
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.findCommittedRecoveryByOperation] Invalid database ` +
        `state for '${request.app_name}' recovery '${request.operation_id}': ` +
        `multiple committed rows (${rows.map(row => row.id).join(', ')}).`,
      )
    }
    if (!rows[0]) return null
    if (
      Number(rows[0].recovery_source_row_id) !== request.expected_row_id
      || rows[0].recovery_source_fingerprint !== request.expected_source_fingerprint
    ) {
      throw new AppModelOperationConflictError(
        request.app_name,
        request.operation_id,
      )
    }
    return parseCommittedRow(rows[0], 'findCommittedRecoveryByOperation')
  }

  async getCommittedById(rowId: number): Promise<CommittedAppModel> {
    const db = getDb()
    let row: StoredAppModel | undefined
    try {
      row = await db.selectFrom('app_models')
        .selectAll()
        .where('id', '=', rowId)
        .executeTakeFirst()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.getCommittedById] Failed to read committed App Model row ${rowId}.`,
        { cause },
      )
    }
    if (!row) throw new CommittedAppModelNotFoundError(rowId)
    return parseCommittedRow(row, 'getCommittedById')
  }

  async findAll(): Promise<StoredAppModel[]> {
    const db = getDb()
    return db.selectFrom('app_models')
      .selectAll()
      .where('status', '=', 'active')
      .orderBy('crawled_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
  }

  async getModelJson(appName: string): Promise<Record<string, unknown> | null> {
    return await this.getModel(appName) as unknown as Record<string, unknown> | null
  }

  async getModel(appName: string): Promise<AppModelSnapshot | null> {
    const row = await this.findActive(appName)
    return row ? parseCommittedRow(row, 'getModel').snapshot : null
  }
}
