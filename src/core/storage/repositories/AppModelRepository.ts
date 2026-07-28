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

import { getDb } from '../db'
import { AppModel as StoredAppModel, NewAppModel } from '../types'
import type {
  AppModel as AppModelSnapshot,
  AppModelCandidate,
} from '../../onboarding/types'
import { validateAppModelObject } from '../../onboarding/ModelValidator'
import { canonicalJsonSha256 } from '../JsonAppModelMigrationPlanner'

export type AppModelCommitOutcome = 'committed_new' | 'replayed_existing'

export interface CommittedAppModel {
  rowId: number
  appName: string
  operationId: string | null
  candidateHash: string | null
  status: string
  snapshot: AppModelSnapshot
}

export interface AppModelCommitResult {
  outcome: AppModelCommitOutcome
  committed: CommittedAppModel
}

export class AppModelPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AppModelPersistenceError'
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

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RetryableAppModelConflictError'
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

function validateCandidate(candidate: AppModelCandidate): void {
  const validationSnapshot: AppModelSnapshot = {
    ...candidate,
    app: {
      ...candidate.app,
      modelVersion: '0.0.0',
    },
  }
  const validation = validateAppModelObject(validationSnapshot)
  if (!validation.valid) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.commitCandidate] App Model candidate ` +
      `'${candidate?.app?.name ?? 'unknown'}' failed schema validation: ${validation.errors.join('; ')}`,
    )
  }
}

function rowFromSnapshot(
  model: AppModelSnapshot,
  operationId: string | null,
  candidateHash: string | null,
): NewAppModel {
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
    model_json:        JSON.stringify(model),
    crawled_at:        model.app.crawlMetadata?.crawledAt ?? null,
    crawled_by:        model.app.crawlMetadata?.crawledBy ?? null,
    status:            'active',
    evidence_state:    model.app.evidenceState,
    operation_id:      operationId,
    candidate_hash:    candidateHash,
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
  }
}

function isSqliteBusy(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const code = (cause as { code?: unknown }).code
  const message = cause instanceof Error ? cause.message : String(cause)
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
    || /database is (?:locked|busy)/i.test(message)
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
    const appName = candidate.app.name
    if (operationId.trim() === '') {
      throw new AppModelPersistenceError(
        `[AppModelRepository.commitCandidate] '${appName}' requires a non-empty orchestrator operation ID.`,
      )
    }
    validateCandidate(candidate)
    const candidateHash = canonicalJsonSha256(candidate)
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
        const snapshot: AppModelSnapshot = {
          ...candidate,
          app: {
            ...candidate.app,
            modelVersion: version,
          },
        }
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

  /** Legacy/fixture write boundary. Canonical runtime code uses commitCandidate. */
  async upsert(snapshot: AppModelSnapshot): Promise<StoredAppModel> {
    const row = rowFromSnapshot(snapshot, null, null)
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
