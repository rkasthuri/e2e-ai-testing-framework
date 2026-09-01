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

import { createHash } from 'node:crypto'
import {
  DiagnosticEvidenceRepository,
  type DiagnosticEvidenceIdentity,
} from '../storage/repositories/DiagnosticEvidenceRepository'
import {
  canonicalDiagnosticJson,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  parseDiagnosticEvidenceV1,
} from './DiagnosticEvidenceContract'
import {
  classifyDiagnosticEvidence,
  parseDiagnosticClassifierVersion,
  type DiagnosticClassifierVersion,
  type DiagnosticIntegrityFinding,
  type DiagnosticOutcome,
} from './DiagnosticClassificationContract'
import { presentDiagnosticOutcome } from './DiagnosticOutcomePresenter'

export interface DiagnosticClassificationRequest extends DiagnosticEvidenceIdentity {
  evidenceHash: string
  classifierVersion: string
}

export interface DiagnosticClassificationReadModel {
  identity: DiagnosticEvidenceIdentity
  evidenceHash: string
  evidenceSchemaVersion: typeof DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
  classifierVersion: DiagnosticClassifierVersion
  outcome: DiagnosticOutcome
  displayString: string
}

export class DiagnosticEvidenceNotFoundError extends Error {
  constructor() {
    super('No diagnostic evidence exists for the exact requested identity.')
    this.name = 'DiagnosticEvidenceNotFoundError'
  }
}

export class DiagnosticEvidenceUnreadableError extends Error {
  constructor() {
    super('Persisted diagnostic evidence is malformed and cannot be classified.')
    this.name = 'DiagnosticEvidenceUnreadableError'
  }
}

interface DiagnosticEvidenceReader {
  readExact(identity: DiagnosticEvidenceIdentity): ReturnType<DiagnosticEvidenceRepository['readExact']>
}

function same(left: unknown, right: unknown): boolean {
  return canonicalDiagnosticJson(left) === canonicalDiagnosticJson(right)
}

export class DiagnosticClassificationService {
  constructor(private readonly repository: DiagnosticEvidenceReader = new DiagnosticEvidenceRepository()) {}

  async classify(request: DiagnosticClassificationRequest): Promise<DiagnosticClassificationReadModel> {
    parseDiagnosticClassifierVersion(request.classifierVersion)
    const identity: DiagnosticEvidenceIdentity = {
      projectId: request.projectId,
      executionId: request.executionId,
      runId: request.runId,
      itemOrdinal: request.itemOrdinal,
      evidenceSchemaVersion: request.evidenceSchemaVersion,
    }
    const row = await this.repository.readExact(identity)
    if (!row) throw new DiagnosticEvidenceNotFoundError()

    const findings = new Set<DiagnosticIntegrityFinding>()
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(row.evidence_json)
    } catch {
      parsedJson = null
      findings.add('diagnostic_authority_binding_invalid')
    }
    let evidence
    try {
      evidence = parseDiagnosticEvidenceV1(parsedJson)
    } catch {
      findings.add('diagnostic_authority_binding_invalid')
      evidence = null
    }
    const recomputedHash = createHash('sha256').update(canonicalDiagnosticJson(parsedJson)).digest('hex')
    if (row.evidence_hash !== recomputedHash || request.evidenceHash !== row.evidence_hash) {
      findings.add('diagnostic_authority_binding_invalid')
    }
    if (!evidence) {
      throw new DiagnosticEvidenceUnreadableError()
    }
    let acceptedAuthority: unknown = null
    let suiteAuthority: unknown = null
    try {
      acceptedAuthority = JSON.parse(row.accepted_definition_authority_json)
      suiteAuthority = row.suite_authority_json === null ? null : JSON.parse(row.suite_authority_json)
    } catch {
      findings.add('diagnostic_authority_binding_invalid')
    }
    if (!same(evidence.authority.acceptedDefinitionAuthority, acceptedAuthority)) {
      findings.add('diagnostic_historical_authority_substitution')
    }
    if (evidence.schemaVersion !== row.evidence_schema_version
      || evidence.authority.projectId !== row.project_id
      || evidence.authority.executionId !== row.execution_id
      || evidence.authority.runId !== row.run_id
      || evidence.authority.itemOrdinal !== Number(row.item_ordinal)
      || evidence.authority.resultId !== row.result_id
      || evidence.authority.definitionId !== row.definition_id
      || evidence.authority.executablePlanHash !== row.executable_plan_hash
      || !same(evidence.authority.suiteAuthority, suiteAuthority)) {
      findings.add('diagnostic_authority_binding_invalid')
    }

    const outcome = classifyDiagnosticEvidence(evidence, row.evidence_hash, request.classifierVersion, [...findings])
    return {
      identity,
      evidenceHash: row.evidence_hash,
      evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
      classifierVersion: outcome.classifierVersion,
      outcome,
      displayString: presentDiagnosticOutcome(outcome),
    }
  }
}
