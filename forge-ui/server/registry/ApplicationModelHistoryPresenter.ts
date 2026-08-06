/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { observationStore, type ObservationStore } from './ObservationStore'

type ProjectionState = 'current' | 'unavailable' | 'invalid' | 'mismatched' | 'not_evaluated'
type ValidationState = 'valid' | 'invalid' | 'malformed'
type IntegrityState = 'verified' | 'failed' | 'not_evaluated'

interface SafeEngineSubject {
  id: string
  kind: 'page' | 'endpoint'
  routePath: string | null
  derivedClassification: {
    label: string
    confidence: 'high' | 'medium' | 'low' | 'unknown'
    method: 'rule' | 'ai' | 'manual' | 'unknown'
  } | null
}

interface SafeEngineModel {
  rowId: number
  appName: string
  version: string
  lifecycle: 'active' | 'superseded' | 'unknown'
  generatedAt: string | null
  crawledAt: string | null
  evidenceState: 'crawled' | 'crawled-empty' | 'unsupported-platform' | 'unknown'
  sourceObservationId: string | null
  validation: ValidationState
  integrity: IntegrityState
  modelFingerprint: string
  subjects: SafeEngineSubject[]
  recovery: {
    sourceRowId: number
    sourceVersion: string | null
    sourceFingerprint: string
    sourceFingerprintMatches: boolean
  } | null
}

interface SafeEngineHistory {
  kind: 'ok'
  models: SafeEngineModel[]
  activeModel: SafeEngineModel | null
  total: number
  activeCount: number
  nextCursor: string | null
  previousCursor: string | null
  hasPrevious: boolean
  requestedModel: {
    rowId: number
    status: 'on_page' | 'outside_page' | 'not_found'
  } | null
  projectionState: ProjectionState
}

export type ApplicationModelPresentationResult =
  | { kind: 'ok'; value: ReturnType<typeof buildPresentation> }
  | { kind: 'malformed' }
  | { kind: 'active_missing' }
  | { kind: 'multiple_active' }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const SAFE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const SAFE_SHA = /^[a-f0-9]{64}$/
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,1024}$/
const SAFE_ROUTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactIsoOrNull(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null
}

function isSafeEngineSubject(value: unknown): value is SafeEngineSubject {
  if (!isRecord(value) || typeof value.id !== 'string' || !SAFE_SUBJECT_ID.test(value.id)) return false
  if (value.kind !== 'page' && value.kind !== 'endpoint') return false
  if (value.routePath !== null && (typeof value.routePath !== 'string' || !SAFE_ROUTE.test(value.routePath))) {
    return false
  }
  if (value.derivedClassification === null) return true
  if (!isRecord(value.derivedClassification)) return false
  return typeof value.derivedClassification.label === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(value.derivedClassification.label)
    && ['high', 'medium', 'low', 'unknown'].includes(String(value.derivedClassification.confidence))
    && ['rule', 'ai', 'manual', 'unknown'].includes(String(value.derivedClassification.method))
}

function isSafeEngineModel(value: unknown, projectId: string): value is SafeEngineModel {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.rowId) || Number(value.rowId) <= 0
    || value.appName !== projectId
    || typeof value.version !== 'string' || !SAFE_VERSION.test(value.version)
    || !['active', 'superseded', 'unknown'].includes(String(value.lifecycle))
    || !['valid', 'invalid', 'malformed'].includes(String(value.validation))
    || !['verified', 'failed', 'not_evaluated'].includes(String(value.integrity))
    || typeof value.modelFingerprint !== 'string' || !SAFE_SHA.test(value.modelFingerprint)
    || !Array.isArray(value.subjects) || value.subjects.length > 100
    || !value.subjects.every(isSafeEngineSubject)) return false
  if (value.generatedAt !== null && exactIsoOrNull(value.generatedAt) === null) return false
  if (value.crawledAt !== null && exactIsoOrNull(value.crawledAt) === null) return false
  if (value.sourceObservationId !== null
    && (typeof value.sourceObservationId !== 'string' || !SAFE_ID.test(value.sourceObservationId))) return false
  if (!['crawled', 'crawled-empty', 'unsupported-platform', 'unknown'].includes(String(value.evidenceState))) {
    return false
  }
  if (value.recovery !== null) {
    if (!isRecord(value.recovery)
      || !Number.isSafeInteger(value.recovery.sourceRowId) || Number(value.recovery.sourceRowId) <= 0
      || (value.recovery.sourceVersion !== null
        && (typeof value.recovery.sourceVersion !== 'string' || !SAFE_VERSION.test(value.recovery.sourceVersion)))
      || typeof value.recovery.sourceFingerprint !== 'string'
      || !SAFE_SHA.test(value.recovery.sourceFingerprint)
      || typeof value.recovery.sourceFingerprintMatches !== 'boolean') return false
  }
  return true
}

function parseEngineHistory(value: unknown, projectId: string): SafeEngineHistory | null {
  if (!isRecord(value) || value.kind !== 'ok') return null
  if (!Array.isArray(value.models) || value.models.length > 50
    || !value.models.every(item => isSafeEngineModel(item, projectId))
    || (value.activeModel !== null && !isSafeEngineModel(value.activeModel, projectId))
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0
    || !Number.isSafeInteger(value.activeCount) || Number(value.activeCount) < 0
    || (value.nextCursor !== null
      && (typeof value.nextCursor !== 'string' || !SAFE_CURSOR.test(value.nextCursor)))
    || (value.previousCursor !== null
      && (typeof value.previousCursor !== 'string' || !SAFE_CURSOR.test(value.previousCursor)))
    || typeof value.hasPrevious !== 'boolean'
    || !['current', 'unavailable', 'invalid', 'mismatched', 'not_evaluated'].includes(String(value.projectionState))) {
    return null
  }
  const models = value.models as SafeEngineModel[]
  if (new Set(models.map(model => model.rowId)).size !== models.length
    || new Set(models.map(model => model.version)).size !== models.length
    || models.filter(model => model.lifecycle === 'active').length > 1) return null
  if (value.requestedModel !== null) {
    if (!isRecord(value.requestedModel)
      || !Number.isSafeInteger(value.requestedModel.rowId)
      || !['on_page', 'outside_page', 'not_found'].includes(String(value.requestedModel.status))) return null
  }
  return value as unknown as SafeEngineHistory
}

function sourceObservation(
  projectId: string,
  observationId: string | null,
  observations: Pick<ObservationStore, 'resolve'>,
) {
  if (!observationId) return null
  const resolved = observations.resolve(observationId, projectId)
  if (resolved.kind !== 'terminal') {
    return {
      id: observationId,
      available: false,
      outcome: null,
      startedAt: null,
      completedAt: null,
      subjectEvidence: new Map<string, string>(),
    }
  }
  return {
    id: observationId,
    available: true,
    outcome: resolved.terminal.terminalState,
    startedAt: resolved.terminal.startedAt,
    completedAt: resolved.terminal.completedAt,
    subjectEvidence: new Map(resolved.terminal.observedSubjects.map(subject => [subject.id, subject.evidenceId])),
  }
}

function presentModel(
  model: SafeEngineModel,
  projectId: string,
  projectionState: ProjectionState,
  observations: Pick<ObservationStore, 'resolve'>,
) {
  const source = sourceObservation(projectId, model.sourceObservationId, observations)
  const subjects = model.subjects.map(subject => ({
    id: subject.id,
    kind: subject.kind,
    routePath: subject.routePath,
    basis: source?.subjectEvidence.has(subject.id)
      ? 'direct_observation' as const
      : 'unknown' as const,
    evidenceId: source?.subjectEvidence.get(subject.id) ?? null,
    derivedClassification: subject.derivedClassification,
  }))
  const limitations = [
    'Model existence, active lifecycle, version, and subject counts do not establish application completeness.',
    'Freshness has no approved evaluation policy.',
    'Coverage and unobserved application scope are not established by this persisted model.',
  ]
  const unknowns: string[] = []
  const blockers: string[] = []
  if (!source?.available) unknowns.push('The source observation is unavailable for this model version.')
  if (model.integrity === 'not_evaluated') unknowns.push('Canonical candidate integrity was not recorded for this legacy model version.')
  if (model.validation === 'invalid') blockers.push('This model version is incompatible with the current schema.')
  if (model.validation === 'malformed') blockers.push('This model version could not be parsed safely.')
  if (model.integrity === 'failed') blockers.push('Persisted model identity or canonical integrity validation failed.')
  if (model.lifecycle === 'active' && projectionState === 'unavailable') {
    unknowns.push('The compatibility projection is unavailable; SQLite remains authoritative.')
  }
  if (model.lifecycle === 'active' && (projectionState === 'invalid' || projectionState === 'mismatched')) {
    blockers.push('The compatibility projection does not match the active SQLite authority.')
  }
  return {
    rowId: model.rowId,
    version: model.version,
    lifecycle: model.lifecycle,
    createdAt: model.generatedAt,
    sourceCrawlAt: model.crawledAt,
    sourceObservation: source
      ? {
          id: source.id,
          available: source.available,
          outcome: source.outcome,
          startedAt: source.startedAt,
          completedAt: source.completedAt,
          href: source.available
            ? `/application/observations?project=${encodeURIComponent(projectId)}&observation=${encodeURIComponent(source.id)}`
            : null,
        }
      : null,
    evidenceState: model.evidenceState,
    validation: model.validation,
    integrity: model.integrity,
    modelFingerprint: model.modelFingerprint,
    projection: model.lifecycle === 'active' ? projectionState : 'not_applicable' as const,
    freshness: 'not_evaluated' as const,
    coverage: 'unknown' as const,
    subjects,
    recovery: model.recovery,
    limitations,
    unknowns,
    blockers,
    recommendation: source?.available
      ? {
          action: 'Review the source observation',
          because: 'The observation contains the bounded evidence used to interpret this model version.',
          destination: source.id,
          href: `/application/observations?project=${encodeURIComponent(projectId)}&observation=${encodeURIComponent(source.id)}`,
        }
      : null,
  }
}

function buildPresentation(
  history: SafeEngineHistory,
  projectId: string,
  projectName: string,
  latestObservationId: string | null,
  observations: Pick<ObservationStore, 'resolve'>,
) {
  return {
    project: { id: projectId, name: projectName },
    currentModel: history.activeModel
      ? presentModel(history.activeModel, projectId, history.projectionState, observations)
      : null,
    models: history.models.map(model => presentModel(model, projectId, history.projectionState, observations)),
    page: {
      limit: 25,
      nextCursor: history.nextCursor,
      previousCursor: history.previousCursor,
      hasPrevious: history.hasPrevious,
      total: history.total,
      activeCount: history.activeCount,
    },
    latestObservationId,
    requestedModel: history.requestedModel,
  }
}

export function presentApplicationModelHistory(
  rawHistory: unknown,
  project: { id: string; name: string },
  options: {
    limit: number
    observations?: Pick<ObservationStore, 'resolve' | 'latest'>
  },
): ApplicationModelPresentationResult {
  const history = parseEngineHistory(rawHistory, project.id)
  if (!history) return { kind: 'malformed' }
  if (history.activeCount > 1) return { kind: 'multiple_active' }
  if (history.total > 0 && (history.activeCount === 0 || history.activeModel === null)) {
    return { kind: 'active_missing' }
  }
  if (history.activeCount === 1 && history.activeModel?.lifecycle !== 'active') {
    return { kind: 'malformed' }
  }
  const observations = options.observations ?? observationStore
  const latest = observations.latest(project.id)
  const value = buildPresentation(
    history,
    project.id,
    project.name,
    latest?.observationId ?? null,
    observations,
  )
  value.page.limit = options.limit
  return { kind: 'ok', value }
}
