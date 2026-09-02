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

import type { DiagnosticEvidenceRow } from '../storage/types'
import {
  DiagnosticEvidenceRepository,
  type DiagnosticEvidenceIdentity,
} from '../storage/repositories/DiagnosticEvidenceRepository'
import {
  parseDiagnosticClassifierVersion,
  type DiagnosticClassifierVersion,
  type DiagnosticOutcome,
} from './DiagnosticClassificationContract'
import {
  DiagnosticClassificationService,
  type DiagnosticClassificationReadModel,
  type DiagnosticClassificationRequest,
} from './DiagnosticClassificationService'
import { DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION } from './DiagnosticEvidenceContract'

export const DIAGNOSTIC_FAILURE_MODES = [
  'executor_failure',
  'authentication_not_established',
  'navigation_not_completed',
  'target_not_observed',
  'action_not_completed',
  'oracle_mismatch',
] as const

export type DiagnosticFailureMode = typeof DIAGNOSTIC_FAILURE_MODES[number]

export interface DiagnosticInsightsRequest {
  projectId: string
  evidenceSchemaVersion: string
  classifierVersion: string
}

export interface DiagnosticInsightsReadModel {
  projectId: string
  evidenceSchemaVersion: typeof DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
  classifierVersion: DiagnosticClassifierVersion
  totalDiagnostics: number
  classifiedFailureCount: number
  refusalCount: number
  countsByFailureMode: Readonly<Record<DiagnosticFailureMode, number>>
  insufficientEvidenceCount: number
  integrityInvalidCount: number
}

export class UnsupportedDiagnosticEvidenceSchemaVersionError extends Error {
  constructor(version: string) {
    super(`Unsupported diagnostic evidence schema version: ${version}`)
    this.name = 'UnsupportedDiagnosticEvidenceSchemaVersionError'
  }
}

export class InvalidDiagnosticInsightsProjectIdError extends Error {
  constructor() {
    super('Diagnostic Insights projectId must be a canonical project identifier.')
    this.name = 'InvalidDiagnosticInsightsProjectIdError'
  }
}

export class DiagnosticInsightsIntegrityError extends Error {
  constructor(message = 'Diagnostic Insights source rows or classifier outcomes violated the closed aggregation contract.') {
    super(message)
    this.name = 'DiagnosticInsightsIntegrityError'
  }
}

interface DiagnosticInsightsRepository {
  readProjectPartition(projectId: string, evidenceSchemaVersion: string): Promise<DiagnosticEvidenceRow[]>
  readExact(identity: DiagnosticEvidenceIdentity): Promise<DiagnosticEvidenceRow | null>
}

interface DiagnosticInsightsClassifier {
  classify(request: DiagnosticClassificationRequest): Promise<DiagnosticClassificationReadModel>
}

// Matches the established Core execution and diagnostic-evidence identifier grammar.
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function identityOf(row: DiagnosticEvidenceRow): DiagnosticEvidenceIdentity {
  return {
    projectId: row.project_id,
    executionId: row.execution_id,
    runId: row.run_id,
    itemOrdinal: Number(row.item_ordinal),
    evidenceSchemaVersion: row.evidence_schema_version,
  }
}

function identityKey(identity: DiagnosticEvidenceIdentity): string {
  return JSON.stringify([
    identity.projectId,
    identity.executionId,
    identity.runId,
    identity.itemOrdinal,
    identity.evidenceSchemaVersion,
  ])
}

function sameIdentity(left: DiagnosticEvidenceIdentity, right: DiagnosticEvidenceIdentity): boolean {
  return identityKey(left) === identityKey(right)
}

function sameSourceRow(left: DiagnosticEvidenceRow, right: DiagnosticEvidenceRow): boolean {
  return left.evidence_hash === right.evidence_hash
    && left.result_id === right.result_id
    && left.definition_id === right.definition_id
    && left.executable_plan_hash === right.executable_plan_hash
    && left.accepted_definition_authority_json === right.accepted_definition_authority_json
    && left.suite_authority_json === right.suite_authority_json
    && left.evidence_json === right.evidence_json
}

function emptyFailureCounts(): Record<DiagnosticFailureMode, number> {
  return {
    executor_failure: 0,
    authentication_not_established: 0,
    navigation_not_completed: 0,
    target_not_observed: 0,
    action_not_completed: 0,
    oracle_mismatch: 0,
  }
}

function validateOutcome(
  read: DiagnosticClassificationReadModel,
  identity: DiagnosticEvidenceIdentity,
  row: DiagnosticEvidenceRow,
  classifierVersion: DiagnosticClassifierVersion,
): DiagnosticOutcome {
  if (!sameIdentity(read.identity, identity)
    || read.evidenceHash !== row.evidence_hash
    || read.evidenceSchemaVersion !== DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
    || read.classifierVersion !== classifierVersion
    || read.outcome.evidenceHash !== row.evidence_hash
    || read.outcome.evidenceSchemaVersion !== DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
    || read.outcome.classifierVersion !== classifierVersion) {
    throw new DiagnosticInsightsIntegrityError()
  }
  if (read.outcome.kind === 'classified_failure') {
    if (!DIAGNOSTIC_FAILURE_MODES.includes(read.outcome.failureMode)) {
      throw new DiagnosticInsightsIntegrityError()
    }
    return read.outcome
  }
  if (read.outcome.kind === 'refusal'
    && (read.outcome.refusalCode === 'insufficient_evidence' || read.outcome.refusalCode === 'integrity_invalid')) {
    return read.outcome
  }
  throw new DiagnosticInsightsIntegrityError()
}

export class DiagnosticInsightsService {
  private readonly classifier: DiagnosticInsightsClassifier

  constructor(
    private readonly repository: DiagnosticInsightsRepository = new DiagnosticEvidenceRepository(),
    classifier?: DiagnosticInsightsClassifier,
  ) {
    this.classifier = classifier ?? new DiagnosticClassificationService(repository)
  }

  async read(request: DiagnosticInsightsRequest): Promise<DiagnosticInsightsReadModel> {
    if (typeof request?.projectId !== 'string' || !PROJECT_ID.test(request.projectId)) {
      throw new InvalidDiagnosticInsightsProjectIdError()
    }
    if (request.evidenceSchemaVersion !== DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION) {
      throw new UnsupportedDiagnosticEvidenceSchemaVersionError(request.evidenceSchemaVersion)
    }
    const classifierVersion = parseDiagnosticClassifierVersion(request.classifierVersion)
    const rows = await this.repository.readProjectPartition(request.projectId, request.evidenceSchemaVersion)
    const uniqueRows = new Map<string, DiagnosticEvidenceRow>()
    for (const row of rows) {
      const identity = identityOf(row)
      if (identity.projectId !== request.projectId
        || identity.evidenceSchemaVersion !== request.evidenceSchemaVersion
        || !Number.isSafeInteger(identity.itemOrdinal)
        || identity.itemOrdinal < 1) {
        throw new DiagnosticInsightsIntegrityError()
      }
      const key = identityKey(identity)
      const existing = uniqueRows.get(key)
      if (existing && !sameSourceRow(existing, row)) {
        throw new DiagnosticInsightsIntegrityError('Duplicate diagnostic identity carries conflicting persisted evidence.')
      }
      if (!existing) uniqueRows.set(key, row)
    }

    const countsByFailureMode = emptyFailureCounts()
    let classifiedFailureCount = 0
    let refusalCount = 0
    let insufficientEvidenceCount = 0
    let integrityInvalidCount = 0
    for (const row of uniqueRows.values()) {
      const identity = identityOf(row)
      const read = await this.classifier.classify({
        ...identity,
        evidenceHash: row.evidence_hash,
        classifierVersion,
      })
      const outcome = validateOutcome(read, identity, row, classifierVersion)
      if (outcome.kind === 'classified_failure') {
        classifiedFailureCount += 1
        countsByFailureMode[outcome.failureMode] += 1
      } else {
        refusalCount += 1
        if (outcome.refusalCode === 'insufficient_evidence') insufficientEvidenceCount += 1
        else integrityInvalidCount += 1
      }
    }

    return {
      projectId: request.projectId,
      evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
      classifierVersion,
      totalDiagnostics: uniqueRows.size,
      classifiedFailureCount,
      refusalCount,
      countsByFailureMode: Object.freeze(countsByFailureMode),
      insufficientEvidenceCount,
      integrityInvalidCount,
    }
  }
}
