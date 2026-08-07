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

import { fail, ok } from '../http'
import { projectObservationHistoryItem } from '../registry/ObservationHistoryPresenter'
import { observationStore, type ObservationStore } from '../registry/ObservationStore'
import {
  presentApplicationReadiness,
  type ApplicationReadinessInput,
  type ReadinessEvidenceInput,
  type ReadinessModelInput,
  type ReadinessObservationInput,
} from '../registry/ApplicationReadinessPresenter'
import { readApplicationModelHistory, type ApplicationModelHttpResult } from './ApplicationModelHistoryController'
import { readEvidenceLedger, type EvidenceLedgerHttpResult } from './EvidenceLedgerController'

export interface ApplicationReadinessHttpResult {
  status: number
  body: unknown
}

interface Dependencies {
  observations?: Pick<ObservationStore, 'history'>
  modelReader?: typeof readApplicationModelHistory
  evidenceReader?: typeof readEvidenceLedger
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function envelopeData(result: ApplicationModelHttpResult | EvidenceLedgerHttpResult): Record<string, unknown> | null {
  if (result.status !== 200 || !isRecord(result.body) || !isRecord(result.body.data)) return null
  return result.body.data
}

function safeCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : -1
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function observationInput(value: ReturnType<typeof projectObservationHistoryItem>): ReadinessObservationInput {
  return {
    id: value.observationId,
    projectId: value.projectId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    outcome: value.terminalState,
    authentication: {
      expectation: value.authentication.expectation,
      credentialAvailability: value.authentication.credentialAvailability,
      outcome: value.authentication.outcome,
    },
    subjectIds: value.observedSubjects.map(subject => subject.id),
    evidence: value.evidence.map(item => ({
      id: item.id,
      integrity: item.integrity,
      capturedAt: item.capturedAt,
    })),
    blockerCount: value.blockers.length,
    unknownCount: value.unknowns.length,
    limitationCount: value.limitations.length,
  }
}

function modelInput(data: Record<string, unknown>): {
  current: ReadinessModelInput | null
  total: number
  activeCount: number
} | null {
  if (!isRecord(data.page)) return null
  const total = safeCount(data.page.total)
  const activeCount = safeCount(data.page.activeCount)
  if (total < 0 || activeCount < 0) return null
  if (data.currentModel === null) return { current: null, total, activeCount }
  if (!isRecord(data.currentModel) || !Array.isArray(data.currentModel.subjects)) return null
  const model = data.currentModel
  const rawSubjects = model.subjects as unknown[]
  const subjects = rawSubjects.map((subject: unknown) => {
    if (!isRecord(subject)) return null
    const classification = isRecord(subject.derivedClassification) ? subject.derivedClassification : null
    return {
      id: safeString(subject.id) ?? '',
      basis: subject.basis as ReadinessModelInput['subjects'][number]['basis'],
      evidenceId: subject.evidenceId === null ? null : safeString(subject.evidenceId),
      derivedMethod: classification
        ? classification.method as ReadinessModelInput['subjects'][number]['derivedMethod']
        : null,
    }
  })
  if (subjects.some((subject: unknown) => subject === null)) return null
  return {
    total,
    activeCount,
    current: {
      rowId: Number(model.rowId),
      version: safeString(model.version) ?? '',
      lifecycle: model.lifecycle as ReadinessModelInput['lifecycle'],
      createdAt: model.createdAt === null ? null : safeString(model.createdAt),
      sourceObservationId: isRecord(model.sourceObservation) ? safeString(model.sourceObservation.id) : null,
      validation: model.validation as ReadinessModelInput['validation'],
      integrity: model.integrity as ReadinessModelInput['integrity'],
      projection: model.projection as ReadinessModelInput['projection'],
      subjects: subjects as ReadinessModelInput['subjects'],
    },
  }
}

function evidenceInput(data: Record<string, unknown>): ReadinessEvidenceInput | null {
  if (!isRecord(data.page) || !Array.isArray(data.evidence)) return null
  const records = data.evidence.map(item => {
    if (!isRecord(item) || !Array.isArray(item.sourceModels)) return null
    return {
      id: safeString(item.id) ?? '',
      canonicalSubjectId: safeString(item.canonicalSubjectId) ?? '',
      support: item.support as ReadinessEvidenceInput['currentRecords'][number]['support'],
      integrity: item.integrity as ReadinessEvidenceInput['currentRecords'][number]['integrity'],
      freshness: item.freshness as ReadinessEvidenceInput['currentRecords'][number]['freshness'],
      access: item.access as ReadinessEvidenceInput['currentRecords'][number]['access'],
      conflict: item.conflict as ReadinessEvidenceInput['currentRecords'][number]['conflict'],
      sourceObservationId: isRecord(item.sourceObservation) ? safeString(item.sourceObservation.id) : null,
      sourceModelRows: item.sourceModels.map(model => isRecord(model) ? Number(model.rowId) : Number.NaN),
    }
  })
  if (records.some(item => item === null)) return null
  return {
    projectTotal: safeCount(data.page.projectTotal),
    currentSupportTotal: safeCount(data.page.currentSupportTotal),
    historicalSupportTotal: safeCount(data.page.historicalSupportTotal),
    filteredTotal: safeCount(data.page.filteredTotal),
    currentRecords: records as ReadinessEvidenceInput['currentRecords'],
  }
}

function dependencyFailure(result: ApplicationModelHttpResult | EvidenceLedgerHttpResult): ApplicationReadinessHttpResult {
  if (result.status === 404) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (result.status === 409) {
    return { status: 409, body: fail('A readiness authority contains an ownership or active-state conflict.', 'READINESS_AUTHORITY_CONFLICT') }
  }
  if (result.status === 422) {
    return { status: 422, body: fail('A readiness authority could not be validated safely.', 'READINESS_SOURCE_INVALID') }
  }
  return { status: 503, body: fail('Readiness authorities are temporarily unavailable.', 'READINESS_UNAVAILABLE') }
}

/**
 * Composes existing presentation-safe authorities without persisting a second
 * truth source. Dependency errors are deliberately recategorized so arbitrary
 * model, evidence, database, or diagnostic text cannot cross this endpoint.
 */
export async function readApplicationReadiness(
  appName: string,
  resolveProject: (appName: string) => Promise<{ appName: string } | undefined>,
  dependencies: Dependencies = {},
): Promise<ApplicationReadinessHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const observations = dependencies.observations ?? observationStore
  const modelReader = dependencies.modelReader ?? readApplicationModelHistory
  const evidenceReader = dependencies.evidenceReader ?? readEvidenceLedger
  const resolvedProject = async () => project
  try {
    const observationRead = observations.history(appName, { limit: 1, cursor: null })
    if (observationRead.kind === 'ownership_mismatch') {
      return { status: 409, body: fail('A readiness authority contains a project ownership conflict.', 'READINESS_AUTHORITY_CONFLICT') }
    }
    if (observationRead.kind !== 'ok') {
      return { status: 422, body: fail('Observation history could not be validated safely.', 'READINESS_SOURCE_INVALID') }
    }
    const [modelResult, evidenceResult] = await Promise.all([
      modelReader(appName, { limit: '25' }, resolvedProject),
      evidenceReader(appName, { limit: '50', support: 'current' }, resolvedProject),
    ])
    if (modelResult.status !== 200) return dependencyFailure(modelResult)
    if (evidenceResult.status !== 200) return dependencyFailure(evidenceResult)
    const modelData = envelopeData(modelResult)
    const evidenceData = envelopeData(evidenceResult)
    const model = modelData ? modelInput(modelData) : null
    const evidence = evidenceData ? evidenceInput(evidenceData) : null
    if (!model || !evidence) {
      return { status: 422, body: fail('Readiness authority projections could not be validated safely.', 'READINESS_SOURCE_INVALID') }
    }
    const latest = observationRead.observations[0]
      ? observationInput(projectObservationHistoryItem(observationRead.observations[0]))
      : null
    const input: ApplicationReadinessInput = {
      project: { id: appName, name: project.appName },
      observation: latest,
      model: model.current,
      modelTotal: model.total,
      activeModelCount: model.activeCount,
      evidence,
    }
    const presented = presentApplicationReadiness(input)
    if (presented.kind === 'ownership_mismatch') {
      return { status: 409, body: fail('A readiness authority contains a project ownership conflict.', 'READINESS_AUTHORITY_CONFLICT') }
    }
    if (presented.kind !== 'ok') {
      return { status: 422, body: fail('Readiness authority projections could not be validated safely.', 'READINESS_SOURCE_INVALID') }
    }
    return { status: 200, body: ok(presented.value) }
  } catch {
    return { status: 503, body: fail('Readiness authorities are temporarily unavailable.', 'READINESS_UNAVAILABLE') }
  }
}
