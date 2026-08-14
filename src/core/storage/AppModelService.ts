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

import type { AppModel, AppModelCandidate } from '../onboarding/types'
import { ModelNotFoundError } from '../errors/OperatorFacingError'
import type {
  InvalidActiveInspection,
  InvalidActiveRecoveryRequest,
} from './AppModelRecoveryContract'
import type { AppModelObservationSupportInput } from '../observation/ObservationTypes'
import {
  AppModelCommitResult,
  AppModelHistoryReadOptions,
  AppModelHistoryReadResult,
  AppModelPersistenceError,
  AppModelProjectionError,
  AppModelRepository,
  CommittedAppModel,
  appModelPersistenceDiagnostic,
} from './repositories/AppModelRepository'

export type AppModelProjector = (snapshot: AppModel) => Promise<void>

export type AppModelCommitProjectionResult =
  | {
      status: 'commit_and_projection_succeeded'
      commit: AppModelCommitResult
    }
  | {
      status: 'commit_succeeded_projection_failed'
      commit: AppModelCommitResult
      error: AppModelProjectionError
    }
  | {
      status: 'commit_failed'
      error: AppModelPersistenceError
    }

export class AppModelProjectionAuthorityError extends AppModelPersistenceError {
  constructor(message: string) {
    super(message)
    this.name = 'AppModelProjectionAuthorityError'
  }
}

/**
 * Convert the structured service result into the committed snapshot for runtime
 * orchestrators that must fail the operation on either persistence or
 * compatibility-projection failure.
 */
export function requireProjectedCommit(
  result: AppModelCommitProjectionResult,
): AppModelCommitResult {
  if (result.status === 'commit_and_projection_succeeded') return result.commit
  throw result.error
}

/**
 * TD-181 runtime ownership boundary.
 *
 * Runtime consumers read through this SQLite-backed service. Runtime producers
 * commit an unversioned candidate first, then project the exact committed row
 * re-read by SQLite identity. Compatibility JSON never becomes authority.
 */
export class AppModelService {
  constructor(private readonly repository = new AppModelRepository()) {}

  async inspectInvalidActiveForRecovery(
    request: InvalidActiveRecoveryRequest,
  ): Promise<InvalidActiveInspection> {
    return this.repository.inspectInvalidActiveForRecovery(request)
  }

  async findInvalidActiveForRecovery(appName: string): Promise<InvalidActiveInspection | null> {
    return this.repository.findInvalidActiveForRecovery(appName)
  }

  async findActive(appName: string): Promise<AppModel | null> {
    return this.repository.getModel(appName)
  }

  /** Read-only bounded history. Raw model payloads remain repository-private. */
  async readHistory(
    appName: string,
    options: AppModelHistoryReadOptions = {},
  ): Promise<AppModelHistoryReadResult> {
    return this.repository.readHistory(appName, options)
  }

  async requireActive(appName: string): Promise<AppModel> {
    const model = await this.findActive(appName)
    if (!model) throw new ModelNotFoundError(appName)
    return model
  }

  /**
   * Orchestrator preflight for a durable operation retry. A hit projects only
   * the already committed SQLite authority; it never rebuilds or recommits a
   * candidate. A miss returns null so the caller may perform the operation.
   */
  async replayCommittedOperation(
    appName: string,
    operationId: string,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult | null> {
    const existing = await this.repository.findCommittedByOperation(appName, operationId)
    if (!existing) return null

    const commit: AppModelCommitResult = {
      outcome: 'replayed_existing',
      committed: existing,
    }
    try {
      const projected = await this.projectCommittedSnapshot(
        existing.rowId,
        appName,
        project,
      )
      return {
        status: 'commit_and_projection_succeeded',
        commit: { outcome: 'replayed_existing', committed: projected },
      }
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: cause instanceof AppModelProjectionError
          ? cause
          : new AppModelProjectionError(
              `[AppModelService.replayCommittedOperation] SQLite operation ` +
              `'${operationId}' already committed row ${existing.rowId} for ` +
              `'${appName}', but compatibility projection could not be retried. ` +
              `SQLite remains authoritative.`,
              existing,
              { cause },
            ),
      }
    }
  }

  /**
   * Recovery-specific durable replay. The repository verifies that operation
   * identity and source provenance both match before projection is attempted.
   */
  async replayCommittedRecoveryOperation(
    request: InvalidActiveRecoveryRequest,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult | null> {
    const existing = await this.repository.findCommittedRecoveryByOperation(request)
    if (!existing) return null

    const commit: AppModelCommitResult = {
      outcome: 'replayed_existing',
      committed: existing,
    }
    try {
      const projected = await this.projectCommittedSnapshot(
        existing.rowId,
        request.app_name,
        project,
      )
      return {
        status: 'commit_and_projection_succeeded',
        commit: { outcome: 'replayed_existing', committed: projected },
      }
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: cause instanceof AppModelProjectionError
          ? cause
          : new AppModelProjectionError(
              `[AppModelService.replayCommittedRecoveryOperation] SQLite recovery ` +
              `'${request.operation_id}' already committed row ${existing.rowId} ` +
              `for '${request.app_name}', but compatibility projection could not ` +
              `be retried. SQLite remains authoritative.`,
              existing,
              { cause },
            ),
      }
    }
  }

  async commitAndProject(
    candidate: AppModelCandidate,
    operationId: string,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult> {
    let commit: AppModelCommitResult
    try {
      commit = await this.repository.commitCandidate(candidate, operationId)
    } catch (cause) {
      const error = cause instanceof AppModelPersistenceError
        ? cause
        : new AppModelPersistenceError(
            `[AppModelService.commitAndProject] SQLite commit failed for ` +
            `'${candidate.app.name}' operation '${operationId}'.`,
            { cause },
          )
      return { status: 'commit_failed', error }
    }

    const committed = commit.committed
    let activeRowId: number | null = null
    try {
      activeRowId = Number((await this.repository.findActive(committed.appName))?.id ?? 0) || null
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitAndProject] SQLite row ${committed.rowId} was ` +
          `committed, but the active authority for '${committed.appName}' could ` +
          `not be established. Compatibility JSON was not changed.`,
          committed,
          { cause },
        ),
      }
    }
    if (committed.status !== 'active' || activeRowId !== committed.rowId) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitAndProject] SQLite operation '${operationId}' ` +
          `resolved to row ${committed.rowId}, but that snapshot is ` +
          `'${committed.status}' and active row identity is ` +
          `${activeRowId ?? 'absent'}, not the current exact authority. Compatibility ` +
          `JSON was not changed.`,
          committed,
        ),
      }
    }

    try {
      await project(committed.snapshot)
      return { status: 'commit_and_projection_succeeded', commit }
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitAndProject] SQLite committed App Model ` +
          `'${committed.appName}' row ${committed.rowId} version ` +
          `'${committed.snapshot.app.modelVersion}', but the compatibility JSON ` +
          `projection failed. SQLite remains authoritative.`,
          committed,
          { cause },
        ),
      }
    }
  }

  async commitWithObservationSupportAndProject(
    candidate: AppModelCandidate,
    operationId: string,
    support: AppModelObservationSupportInput,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult> {
    return this.commitAndProjectInternal(candidate, operationId, support, project)
  }

  private async commitAndProjectInternal(
    candidate: AppModelCandidate,
    operationId: string,
    support: AppModelObservationSupportInput | undefined,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult> {
    let commit: AppModelCommitResult
    try {
      commit = await this.repository.commitCandidate(candidate, operationId, support)
    } catch (cause) {
      return { status: 'commit_failed', error: cause instanceof AppModelPersistenceError ? cause : new AppModelPersistenceError('Canonical App Model and Observation support commit failed.', { cause }) }
    }
    const committed = commit.committed
    try {
      const active = await this.repository.findActive(committed.appName)
      if (committed.status !== 'active' || Number(active?.id) !== committed.rowId) throw new AppModelProjectionAuthorityError('Committed row is not the exact active App Model authority.')
      await project(committed.snapshot)
      return { status: 'commit_and_projection_succeeded', commit }
    } catch (cause) {
      return { status: 'commit_succeeded_projection_failed', commit, error: cause instanceof AppModelProjectionError ? cause : new AppModelProjectionError('Canonical App Model committed atomically with Observation support, but compatibility projection failed.', committed, { cause }) }
    }
  }

  async commitRecoveryAndProject(
    candidate: AppModelCandidate,
    request: InvalidActiveRecoveryRequest,
    project: AppModelProjector,
    support?: AppModelObservationSupportInput,
  ): Promise<AppModelCommitProjectionResult> {
    let commit: AppModelCommitResult
    try {
      commit = await this.repository.commitInvalidActiveRecovery(candidate, request, support)
    } catch (cause) {
      const error = cause instanceof AppModelPersistenceError
        ? cause
        : new AppModelPersistenceError(
            `[AppModelService.commitRecoveryAndProject] SQLite recovery commit ` +
            `failed for '${request.app_name}' operation '${request.operation_id}'.`,
            {
              cause,
              diagnostic: appModelPersistenceDiagnostic('service-boundary', cause),
            },
          )
      return { status: 'commit_failed', error }
    }

    const committed = commit.committed
    let activeRowId: number | null = null
    try {
      activeRowId = Number((await this.repository.findActive(committed.appName))?.id ?? 0) || null
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitRecoveryAndProject] SQLite recovery row ` +
          `${committed.rowId} was committed, but the active authority for ` +
          `'${committed.appName}' could not be established. Compatibility JSON ` +
          `was not changed.`,
          committed,
          { cause },
        ),
      }
    }
    if (committed.status !== 'active' || activeRowId !== committed.rowId) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitRecoveryAndProject] SQLite recovery operation ` +
          `'${request.operation_id}' resolved to row ${committed.rowId}, but that ` +
          `snapshot is '${committed.status}' and active row identity is ` +
          `${activeRowId ?? 'absent'}, not the current exact authority. ` +
          `Compatibility JSON was not changed.`,
          committed,
        ),
      }
    }

    try {
      await project(committed.snapshot)
      return { status: 'commit_and_projection_succeeded', commit }
    } catch (cause) {
      return {
        status: 'commit_succeeded_projection_failed',
        commit,
        error: new AppModelProjectionError(
          `[AppModelService.commitRecoveryAndProject] SQLite committed guarded ` +
          `recovery '${committed.appName}' row ${committed.rowId} version ` +
          `'${committed.snapshot.app.modelVersion}', but compatibility JSON ` +
          `projection failed. SQLite remains authoritative.`,
          committed,
          { cause },
        ),
      }
    }
  }

  /**
   * Projection-only retry. The exact committed row is re-read and validated;
   * no version allocation, supersede, insert, crawl, generation, or verification
   * occurs. Only the current active authority may refresh compatibility JSON.
   */
  async projectCommittedSnapshot(
    rowId: number,
    expectedAppName: string,
    project: AppModelProjector,
  ): Promise<CommittedAppModel> {
    const committed = await this.repository.getCommittedById(rowId)
    if (committed.appName !== expectedAppName) {
      throw new AppModelProjectionAuthorityError(
        `[AppModelService.projectCommittedSnapshot] Row ${rowId} belongs to ` +
        `'${committed.appName}', not expected workspace/app '${expectedAppName}'.`,
      )
    }
    const active = await this.repository.findActive(expectedAppName)
    if (committed.status !== 'active' || active?.id !== rowId) {
      throw new AppModelProjectionAuthorityError(
        `[AppModelService.projectCommittedSnapshot] Row ${rowId} is ` +
        `'${committed.status}' and active row identity is ${active?.id ?? 'absent'}, ` +
        `not the exact active SQLite authority for '${expectedAppName}'. ` +
        `Compatibility JSON was not changed.`,
      )
    }
    try {
      await project(committed.snapshot)
    } catch (cause) {
      throw new AppModelProjectionError(
        `[AppModelService.projectCommittedSnapshot] SQLite row ${rowId} remains ` +
        `authoritative, but compatibility JSON projection failed.`,
        committed,
        { cause },
      )
    }
    return committed
  }
}
