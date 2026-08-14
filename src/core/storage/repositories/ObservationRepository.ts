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
import { getProductDb } from '../db'
import type {
  Database,
  NewObservationArtifactRow,
  NewObservationGapRow,
  NewObservationRow,
  NewObservationRunRow,
  ObservationArtifactRow,
  ObservationGapRow,
  ObservationRow,
  ObservationRunRow,
} from '../types'
import {
  ObservationAuthorityError,
  ObservationContractError,
  ObservationReplayConflictError,
} from '../../observation/ObservationErrors'
import type {
  ArtifactReferenceRecord,
  ObservationGapRecord,
  ObservationRecord,
  ObservationRunRecord,
  ObservationRunSnapshot,
  PersistedValue,
} from '../../observation/ObservationTypes'

type ObservationDb = Kysely<Database> | Transaction<Database>

function processIsAlive(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (cause) {
    return !!cause && typeof cause === 'object' && (cause as { code?: unknown }).code === 'EPERM'
  }
}

function parseJson(value: string, label: string): any {
  try {
    return JSON.parse(value)
  } catch (cause) {
    throw new ObservationContractError(
      'OBSERVATION_PERSISTENCE_MALFORMED',
      `Persisted ${label} JSON is malformed.`,
      { cause },
    )
  }
}

function runRecord(row: ObservationRunRow): ObservationRunRecord {
  return {
    schemaVersion: 'forge-observation-run/v1',
    observationRunId: row.observation_run_id,
    projectId: row.project_id,
    workspaceAuthority: 'PRODUCT_WORKSPACE',
    operationId: row.operation_id,
    producer: row.producer,
    producerVersion: row.producer_version,
    producerInstanceId: row.producer_instance_id,
    producerProcessId: Number(row.producer_process_id),
    acquisitionKind: row.acquisition_kind as ObservationRunRecord['acquisitionKind'],
    startedAt: row.started_at,
    terminalAt: row.terminal_at,
    lifecycle: row.lifecycle as ObservationRunRecord['lifecycle'],
    completeness: row.completeness as ObservationRunRecord['completeness'],
    safeReasonCode: row.safe_reason_code,
    safeMessage: row.safe_message,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    acquisitionPlanHash: row.acquisition_plan_hash,
  }
}

function observationRecord(row: ObservationRow, artifactIds: string[]): ObservationRecord {
  return {
    schemaVersion: 'forge-observation/v1',
    observationId: row.observation_id,
    observationRunId: row.observation_run_id,
    projectId: row.project_id,
    producer: row.producer,
    producerVersion: row.producer_version,
    method: row.method as ObservationRecord['method'],
    methodVersion: row.method_version,
    subjectId: row.subject_id,
    predicate: row.predicate,
    outcome: row.outcome as ObservationRecord['outcome'],
    observedValue: row.observed_value_json === null
      ? null
      : parseJson(row.observed_value_json, 'Observation value'),
    boundary: parseJson(row.boundary_json, 'Observation boundary'),
    capturedAt: row.captured_at,
    idempotencyKey: row.idempotency_key,
    integrityHash: row.integrity_hash,
    artifactIds,
    provenanceClass: row.provenance_class as ObservationRecord['provenanceClass'],
    safeReasonCode: row.safe_reason_code,
    safeMessage: row.safe_message,
  }
}

function gapRecord(row: ObservationGapRow, artifactIds: string[]): ObservationGapRecord {
  return {
    schemaVersion: 'forge-observation-gap/v1',
    gapId: row.gap_id,
    observationRunId: row.observation_run_id,
    projectId: row.project_id,
    producer: row.producer,
    producerVersion: row.producer_version,
    intendedMethod: row.intended_method,
    intendedMethodVersion: row.intended_method_version,
    intendedSubjectId: row.intended_subject_id,
    intendedPredicate: row.intended_predicate,
    boundary: parseJson(row.boundary_json, 'ObservationGap boundary'),
    reason: row.reason as ObservationGapRecord['reason'],
    occurredAt: row.occurred_at,
    idempotencyKey: row.idempotency_key,
    integrityHash: row.integrity_hash,
    artifactIds,
    safeMessage: row.safe_message,
  }
}

function artifactRecord(row: ObservationArtifactRow): ArtifactReferenceRecord {
  return {
    schemaVersion: 'forge-observation-artifact/v1',
    artifactId: row.artifact_id,
    observationRunId: row.observation_run_id,
    projectId: row.project_id,
    storageKey: row.storage_key,
    sha256: row.sha256,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    sensitivityClass: row.sensitivity_class as ArtifactReferenceRecord['sensitivityClass'],
    redactionState: row.redaction_state as ArtifactReferenceRecord['redactionState'],
    capturedAt: row.captured_at,
    retentionClass: row.retention_class as ArtifactReferenceRecord['retentionClass'],
    retentionPolicyId: row.retention_policy_id,
    retentionPolicyVersion: row.retention_policy_version,
    expiresAt: row.expires_at,
    retentionState: 'active',
  }
}

export class ObservationRepository {
  constructor(
    readonly projectId: string,
    private readonly dbProvider: () => Kysely<Database> = getProductDb,
  ) {}

  private assertProject(projectId: string): void {
    if (projectId !== this.projectId) {
      throw new ObservationAuthorityError(
        `Observation repository for '${this.projectId}' refused cross-project access for '${projectId}'.`,
      )
    }
  }

  async startRun(row: NewObservationRunRow): Promise<PersistedValue<ObservationRunRecord>> {
    this.assertProject(row.project_id)
    const db = this.dbProvider()
    const existing = await db.selectFrom('observation_runs')
      .selectAll()
      .where('project_id', '=', this.projectId)
      .where('producer', '=', row.producer)
      .where('operation_id', '=', row.operation_id)
      .executeTakeFirst()
    if (existing) {
      if (existing.acquisition_plan_hash !== row.acquisition_plan_hash
        || existing.acquisition_kind !== row.acquisition_kind
        || existing.producer_version !== row.producer_version) {
        throw new ObservationReplayConflictError('run', row.operation_id)
      }
      return { outcome: 'replayed_existing', value: runRecord(existing) }
    }
    const active = await db.selectFrom('observation_runs').select(['observation_run_id', 'producer_process_id'])
      .where('project_id', '=', this.projectId).where('lifecycle', '=', 'running').executeTakeFirst()
    if (active) {
      throw new ObservationAuthorityError(
        `Product workspace already has active ObservationRun '${active.observation_run_id}' owned by process ${active.producer_process_id}.`,
      )
    }
    try {
      await db.insertInto('observation_runs').values(row).execute()
    } catch (cause) {
      const replay = await db.selectFrom('observation_runs')
        .selectAll()
        .where('project_id', '=', this.projectId)
        .where('producer', '=', row.producer)
        .where('operation_id', '=', row.operation_id)
        .executeTakeFirst()
      if (!replay) throw cause
      if (replay.acquisition_plan_hash !== row.acquisition_plan_hash) {
        throw new ObservationReplayConflictError('run', row.operation_id)
      }
      return { outcome: 'replayed_existing', value: runRecord(replay) }
    }
    return { outcome: 'committed_new', value: runRecord(row as ObservationRunRow) }
  }

  async findRun(projectId: string, observationRunId: string): Promise<ObservationRunRecord | null> {
    this.assertProject(projectId)
    const row = await this.dbProvider().selectFrom('observation_runs')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('observation_run_id', '=', observationRunId)
      .executeTakeFirst()
    return row ? runRecord(row) : null
  }

  async findRunByOperation(projectId: string, producer: string, operationId: string): Promise<ObservationRunRecord | null> {
    this.assertProject(projectId)
    const row = await this.dbProvider().selectFrom('observation_runs')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('producer', '=', producer)
      .where('operation_id', '=', operationId)
      .executeTakeFirst()
    return row ? runRecord(row) : null
  }

  async terminalizeRun(input: {
    projectId: string
    observationRunId: string
    terminalAt: string
    lifecycle: Exclude<ObservationRunRecord['lifecycle'], 'running'>
    completeness: NonNullable<ObservationRunRecord['completeness']>
    safeReasonCode: string | null
    safeMessage: string | null
  }): Promise<ObservationRunRecord> {
    this.assertProject(input.projectId)
    const db = this.dbProvider()
    const existing = await db.selectFrom('observation_runs').selectAll()
      .where('project_id', '=', input.projectId)
      .where('observation_run_id', '=', input.observationRunId)
      .executeTakeFirst()
    if (!existing) {
      throw new ObservationContractError('OBSERVATION_RUN_NOT_FOUND', 'ObservationRun does not exist in this Product workspace.')
    }
    if (existing.lifecycle !== 'running') {
      if (existing.lifecycle === input.lifecycle
        && existing.completeness === input.completeness
        && existing.safe_reason_code === input.safeReasonCode) return runRecord(existing)
      throw new ObservationReplayConflictError('run', input.observationRunId)
    }
    await db.updateTable('observation_runs').set({
      terminal_at: input.terminalAt,
      lifecycle: input.lifecycle,
      completeness: input.completeness,
      safe_reason_code: input.safeReasonCode,
      safe_message: input.safeMessage,
    }).where('project_id', '=', input.projectId)
      .where('observation_run_id', '=', input.observationRunId)
      .executeTakeFirstOrThrow()
    return (await this.findRun(input.projectId, input.observationRunId))!
  }

  async recoverInterruptedRuns(projectId: string, currentProducerInstanceId: string, currentProcessId: number, terminalAt: string): Promise<string[]> {
    this.assertProject(projectId)
    const db = this.dbProvider()
    const rows = await db.selectFrom('observation_runs')
      .select(['observation_run_id', 'producer_process_id'])
      .where('project_id', '=', projectId)
      .where('lifecycle', '=', 'running')
      .where('producer_instance_id', '!=', currentProducerInstanceId)
      .execute()
    for (const row of rows) {
      if (row.producer_process_id === currentProcessId || processIsAlive(Number(row.producer_process_id))) {
        throw new ObservationAuthorityError(
          `Active ObservationRun '${row.observation_run_id}' still has live process ownership; recovery refused.`,
        )
      }
      const observed = await db.selectFrom('observations')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('project_id', '=', projectId)
        .where('observation_run_id', '=', row.observation_run_id)
        .executeTakeFirstOrThrow()
      await this.terminalizeRun({
        projectId,
        observationRunId: row.observation_run_id,
        terminalAt,
        lifecycle: 'interrupted',
        completeness: Number(observed.count) > 0 ? 'partial' : 'unobserved',
        safeReasonCode: 'backend_restart',
        safeMessage: 'The producer process ended before the ObservationRun reached a terminal acquisition decision.',
      })
    }
    return rows.map(row => row.observation_run_id)
  }

  async insertArtifact(row: NewObservationArtifactRow): Promise<PersistedValue<ArtifactReferenceRecord>> {
    this.assertProject(row.project_id)
    const db = this.dbProvider()
    const existing = await db.selectFrom('observation_artifacts').selectAll()
      .where('project_id', '=', row.project_id)
      .where('artifact_id', '=', row.artifact_id)
      .executeTakeFirst()
    if (existing) {
      if (existing.sha256 !== row.sha256 || existing.storage_key !== row.storage_key) {
        throw new ObservationReplayConflictError('artifact', row.artifact_id)
      }
      return { outcome: 'replayed_existing', value: artifactRecord(existing) }
    }
    await db.insertInto('observation_artifacts').values(row).execute()
    return { outcome: 'committed_new', value: artifactRecord(row as ObservationArtifactRow) }
  }

  async getArtifacts(projectId: string, artifactIds: string[], db: ObservationDb = this.dbProvider()): Promise<ArtifactReferenceRecord[]> {
    this.assertProject(projectId)
    if (artifactIds.length === 0) return []
    const rows = await db.selectFrom('observation_artifacts').selectAll()
      .where('project_id', '=', projectId)
      .where('artifact_id', 'in', artifactIds)
      .execute()
    const byId = new Map(rows.map(row => [row.artifact_id, artifactRecord(row)]))
    return artifactIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  }

  private async artifactIds(owner: { observationId?: string; gapId?: string }, db: ObservationDb): Promise<string[]> {
    let query = db.selectFrom('observation_artifact_links')
      .select(['artifact_id', 'ordinal'])
      .where('project_id', '=', this.projectId)
    query = owner.observationId
      ? query.where('observation_id', '=', owner.observationId)
      : query.where('gap_id', '=', owner.gapId!)
    return (await query.orderBy('ordinal').execute()).map(row => row.artifact_id)
  }

  async insertObservation(row: NewObservationRow, artifactIds: string[]): Promise<PersistedValue<ObservationRecord>> {
    this.assertProject(row.project_id)
    const db = this.dbProvider()
    return db.transaction().execute(async trx => {
      const existing = await trx.selectFrom('observations').selectAll()
        .where('project_id', '=', row.project_id)
        .where('producer', '=', row.producer)
        .where('idempotency_key', '=', row.idempotency_key)
        .executeTakeFirst()
      if (existing) {
        if (existing.integrity_hash !== row.integrity_hash) {
          throw new ObservationReplayConflictError('observation', row.idempotency_key)
        }
        const existingArtifacts = await this.artifactIds({ observationId: existing.observation_id }, trx)
        if (existingArtifacts.join('\u001f') !== artifactIds.join('\u001f')) {
          throw new ObservationReplayConflictError('observation', row.idempotency_key)
        }
        return { outcome: 'replayed_existing', value: observationRecord(existing, existingArtifacts) }
      }
      const artifacts = await this.getArtifacts(row.project_id, artifactIds, trx)
      if (artifacts.length !== artifactIds.length) {
        throw new ObservationContractError('OBSERVATION_ARTIFACT_NOT_FOUND', 'Observation references an artifact outside its committed Product workspace authority.')
      }
      await trx.insertInto('observations').values(row).execute()
      if (artifactIds.length > 0) {
        await trx.insertInto('observation_artifact_links').values(artifactIds.map((artifactId, ordinal) => ({
          artifact_id: artifactId,
          project_id: row.project_id,
          observation_id: row.observation_id,
          gap_id: null,
          ordinal,
        }))).execute()
      }
      await trx.updateTable('observations').set({ artifact_links_sealed: 1 })
        .where('observation_id', '=', row.observation_id).executeTakeFirstOrThrow()
      return { outcome: 'committed_new', value: observationRecord(row as ObservationRow, artifactIds) }
    })
  }

  async insertGap(row: NewObservationGapRow, artifactIds: string[]): Promise<PersistedValue<ObservationGapRecord>> {
    this.assertProject(row.project_id)
    const db = this.dbProvider()
    return db.transaction().execute(async trx => {
      const existing = await trx.selectFrom('observation_gaps').selectAll()
        .where('project_id', '=', row.project_id)
        .where('producer', '=', row.producer)
        .where('idempotency_key', '=', row.idempotency_key)
        .executeTakeFirst()
      if (existing) {
        if (existing.integrity_hash !== row.integrity_hash) {
          throw new ObservationReplayConflictError('gap', row.idempotency_key)
        }
        const existingArtifacts = await this.artifactIds({ gapId: existing.gap_id }, trx)
        if (existingArtifacts.join('\u001f') !== artifactIds.join('\u001f')) {
          throw new ObservationReplayConflictError('gap', row.idempotency_key)
        }
        return { outcome: 'replayed_existing', value: gapRecord(existing, existingArtifacts) }
      }
      const artifacts = await this.getArtifacts(row.project_id, artifactIds, trx)
      if (artifacts.length !== artifactIds.length) {
        throw new ObservationContractError('OBSERVATION_ARTIFACT_NOT_FOUND', 'ObservationGap references an artifact outside its committed Product workspace authority.')
      }
      await trx.insertInto('observation_gaps').values(row).execute()
      if (artifactIds.length > 0) {
        await trx.insertInto('observation_artifact_links').values(artifactIds.map((artifactId, ordinal) => ({
          artifact_id: artifactId,
          project_id: row.project_id,
          observation_id: null,
          gap_id: row.gap_id,
          ordinal,
        }))).execute()
      }
      return { outcome: 'committed_new', value: gapRecord(row as ObservationGapRow, artifactIds) }
    })
  }

  async getObservation(projectId: string, observationId: string): Promise<ObservationRecord | null> {
    this.assertProject(projectId)
    const db = this.dbProvider()
    const row = await db.selectFrom('observations').selectAll()
      .where('project_id', '=', projectId)
      .where('observation_id', '=', observationId)
      .executeTakeFirst()
    return row ? observationRecord(row, await this.artifactIds({ observationId }, db)) : null
  }

  async findSubjectPredicate(
    projectId: string,
    subjectId: string,
    predicate: string,
  ): Promise<ObservationRecord[]> {
    this.assertProject(projectId)
    const db = this.dbProvider()
    const rows = await db.selectFrom('observations').selectAll()
      .where('project_id', '=', projectId)
      .where('subject_id', '=', subjectId)
      .where('predicate', '=', predicate)
      .orderBy('captured_at', 'asc')
      .orderBy('observation_id', 'asc')
      .execute()
    return Promise.all(rows.map(async row => observationRecord(
      row,
      await this.artifactIds({ observationId: row.observation_id }, db),
    )))
  }

  async getGap(projectId: string, gapId: string): Promise<ObservationGapRecord | null> {
    this.assertProject(projectId)
    const db = this.dbProvider()
    const row = await db.selectFrom('observation_gaps').selectAll()
      .where('project_id', '=', projectId)
      .where('gap_id', '=', gapId)
      .executeTakeFirst()
    return row ? gapRecord(row, await this.artifactIds({ gapId }, db)) : null
  }

  async readRun(projectId: string, observationRunId: string): Promise<ObservationRunSnapshot | null> {
    this.assertProject(projectId)
    const db = this.dbProvider()
    const run = await this.findRun(projectId, observationRunId)
    if (!run) return null
    const observationRows = await db.selectFrom('observations').selectAll()
      .where('project_id', '=', projectId)
      .where('observation_run_id', '=', observationRunId)
      .orderBy('captured_at').orderBy('observation_id').execute()
    const gapRows = await db.selectFrom('observation_gaps').selectAll()
      .where('project_id', '=', projectId)
      .where('observation_run_id', '=', observationRunId)
      .orderBy('occurred_at').orderBy('gap_id').execute()
    const artifactRows = await db.selectFrom('observation_artifacts').selectAll()
      .where('project_id', '=', projectId)
      .where('observation_run_id', '=', observationRunId)
      .orderBy('captured_at').orderBy('artifact_id').execute()
    const observations = await Promise.all(observationRows.map(async row => observationRecord(
      row,
      await this.artifactIds({ observationId: row.observation_id }, db),
    )))
    const gaps = await Promise.all(gapRows.map(async row => gapRecord(
      row,
      await this.artifactIds({ gapId: row.gap_id }, db),
    )))
    return { run, observations, gaps, artifacts: artifactRows.map(artifactRecord) }
  }
}
