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

import type { ObservationHistoryItem, ObservationTerminalState } from './ObservationStore'
import type { SafeBootstrapEvidence } from './BootstrapEvidenceReader'

export type EvidenceSourceClass = 'onboarding' | 'crawl_observation'
export type EvidenceSupportPosition = 'current' | 'historical'
export type EvidenceIntegrityState = 'verified' | 'failed' | 'not_evaluated'

export interface EvidenceLedgerFilters {
  sourceClass: EvidenceSourceClass | null
  support: EvidenceSupportPosition | null
  integrity: EvidenceIntegrityState | null
  observationId: string | null
  capturedFrom: string | null
  capturedThrough: string | null
}

export interface EvidenceLedgerQuery extends EvidenceLedgerFilters {
  limit: number
  cursor: string | null
  requestedEvidenceId: string | null
}

export interface SafeModelUsageInput {
  rowId: number
  version: string
  lifecycle: 'active' | 'superseded' | 'unknown'
  sourceObservationId: string | null
  subjects: Array<{ id: string; evidenceId: string | null }>
}

export type EvidenceLedgerPresentation =
  | { kind: 'ok'; value: ReturnType<typeof buildReadModel> }
  | { kind: 'invalid_cursor' }
  | { kind: 'malformed' }
  | { kind: 'ownership_mismatch' }

const ORDERING = 'captured-desc-id-asc-v1'
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_OBSERVATION_ID = /^[A-Za-z0-9-]{1,128}$/
const SAFE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const SAFE_ROUTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/

interface CursorPayload {
  version: 1
  projectId: string
  ordering: typeof ORDERING
  filters: EvidenceLedgerFilters
  afterEvidenceId: string
}

interface EvidenceItem {
  id: string
  identityOrigin: 'persisted' | 'projection_derived'
  sourceClass: EvidenceSourceClass
  projectId: string
  canonicalSubjectId: string
  routePath: string | null
  capturedAt: string
  sourceObservation: {
    id: string
    outcome: ObservationTerminalState
    position: 'latest' | 'historical'
    href: string
  } | null
  sourceModels: Array<{
    rowId: number
    version: string
    lifecycle: 'active' | 'superseded' | 'unknown'
    href: string
  }>
  support: EvidenceSupportPosition
  usageReferences: Array<'application_model' | 'application_overview'>
  integrity: EvidenceIntegrityState
  freshness: 'not_evaluated'
  access: 'available'
  conflict: 'not_evaluated'
  status: 'available' | 'integrity_failed'
  summary: string
  provenanceSummary: string
  limitations: string[]
  unknowns: string[]
}

function exactIso(value: string | null): boolean {
  return value === null || (Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value)
}

function encodeCursor(value: CursorPayload): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string): CursorPayload | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || parsed.ordering !== ORDERING
      || typeof parsed.projectId !== 'string' || typeof parsed.afterEvidenceId !== 'string'
      || !parsed.filters || typeof parsed.filters !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function sameFilters(left: EvidenceLedgerFilters, right: EvidenceLedgerFilters): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function safeRoute(value: string): string | null {
  return SAFE_ROUTE.test(value) ? value : null
}

function mapIntegrity(value: 'valid' | 'failed' | 'unknown'): EvidenceIntegrityState {
  return value === 'valid' ? 'verified' : value === 'failed' ? 'failed' : 'not_evaluated'
}

function buildReadModel(
  project: { id: string; name: string },
  page: EvidenceItem[],
  all: EvidenceItem[],
  filtered: EvidenceItem[],
  query: EvidenceLedgerQuery,
  startIndex: number,
) {
  const filters: EvidenceLedgerFilters = {
    sourceClass: query.sourceClass,
    support: query.support,
    integrity: query.integrity,
    observationId: query.observationId,
    capturedFrom: query.capturedFrom,
    capturedThrough: query.capturedThrough,
  }
  const hasNext = startIndex + page.length < filtered.length
  const previousStart = Math.max(0, startIndex - query.limit)
  const previousCursor = startIndex === 0 || previousStart === 0
    ? null
    : encodeCursor({
        version: 1,
        projectId: project.id,
        ordering: ORDERING,
        filters,
        afterEvidenceId: filtered[previousStart - 1].id,
      })
  const requested = query.requestedEvidenceId === null
    ? null
    : {
        evidenceId: query.requestedEvidenceId,
        status: page.some(item => item.id === query.requestedEvidenceId)
          ? 'on_page' as const
          : filtered.some(item => item.id === query.requestedEvidenceId)
            ? 'outside_page' as const
            : all.some(item => item.id === query.requestedEvidenceId)
              ? 'outside_filter' as const
              : 'not_found' as const,
      }
  return {
    project,
    evidence: page,
    page: {
      limit: query.limit,
      nextCursor: hasNext ? encodeCursor({
        version: 1,
        projectId: project.id,
        ordering: ORDERING,
        filters,
        afterEvidenceId: page[page.length - 1].id,
      }) : null,
      previousCursor,
      hasPrevious: startIndex > 0,
      projectTotal: all.length,
      filteredTotal: filtered.length,
      currentSupportTotal: all.filter(item => item.support === 'current').length,
      historicalSupportTotal: all.filter(item => item.support === 'historical').length,
    },
    filters,
    ordering: ORDERING,
    requestedEvidence: requested,
    boundaries: {
      freshness: 'not_evaluated' as const,
      coverage: 'unknown' as const,
      explanation: 'Evidence inventory and usage do not establish application completeness, coverage, health, quality, or freshness.',
    },
  }
}

/**
 * Composes a read-only ledger from existing authorities. Persisted diagnostic,
 * recommendation, model-payload, bootstrap-value, and free-text fields are not
 * parameters of this function and therefore cannot cross its allowlist.
 */
export function presentEvidenceLedger(input: {
  project: { id: string; name: string }
  observations: ObservationHistoryItem[]
  bootstrapEvidence: SafeBootstrapEvidence[]
  models: SafeModelUsageInput[]
  query: EvidenceLedgerQuery
}): EvidenceLedgerPresentation {
  const { project, observations, bootstrapEvidence, models, query } = input
  const filters: EvidenceLedgerFilters = {
    sourceClass: query.sourceClass,
    support: query.support,
    integrity: query.integrity,
    observationId: query.observationId,
    capturedFrom: query.capturedFrom,
    capturedThrough: query.capturedThrough,
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50
    || !exactIso(query.capturedFrom) || !exactIso(query.capturedThrough)
    || (query.capturedFrom !== null && query.capturedThrough !== null && query.capturedFrom > query.capturedThrough)) {
    return { kind: 'malformed' }
  }

  const items: EvidenceItem[] = []
  const observationIds = new Set<string>()
  for (const observation of observations) {
    if (observation.start.projectId !== project.id || observation.observationId !== observation.start.observationId) {
      return { kind: 'ownership_mismatch' }
    }
    if (observationIds.has(observation.observationId) || !SAFE_OBSERVATION_ID.test(observation.observationId)) {
      return { kind: 'malformed' }
    }
    observationIds.add(observation.observationId)
    if (!observation.terminal) continue
    const subjects = new Map(observation.terminal.observedSubjects.map(subject => [subject.evidenceId, subject]))
    for (const evidence of observation.terminal.evidence) {
      const subject = subjects.get(evidence.id)
      if (!subject || !SAFE_ID.test(evidence.id) || !SAFE_ID.test(subject.id)
        || !exactIso(evidence.capturedAt) || evidence.provenance.reference !== observation.observationId) {
        return { kind: 'malformed' }
      }
      items.push({
        id: evidence.id,
        identityOrigin: 'persisted',
        sourceClass: 'crawl_observation',
        projectId: project.id,
        canonicalSubjectId: subject.id,
        routePath: safeRoute(subject.value) ?? safeRoute(evidence.subject),
        capturedAt: evidence.capturedAt,
        sourceObservation: {
          id: observation.observationId,
          outcome: observation.terminal.terminalState,
          position: observation.position,
          href: `/application/observations?project=${encodeURIComponent(project.id)}&observation=${encodeURIComponent(observation.observationId)}`,
        },
        sourceModels: [],
        support: 'historical',
        usageReferences: [],
        integrity: mapIntegrity(evidence.integrity),
        freshness: 'not_evaluated',
        access: 'available',
        conflict: 'not_evaluated',
        status: evidence.integrity === 'failed' ? 'integrity_failed' : 'available',
        summary: 'A crawl observation recorded evidence for this canonical subject.',
        provenanceSummary: 'Captured by an immutable crawl observation record.',
        limitations: ['This evidence record does not establish complete application coverage.'],
        unknowns: ['Freshness and evidence conflict have not been evaluated.'],
      })
    }
  }

  for (const evidence of bootstrapEvidence) {
    if (!SAFE_ID.test(evidence.id) || !SAFE_ID.test(evidence.canonicalSubjectId) || !exactIso(evidence.capturedAt)) {
      return { kind: 'malformed' }
    }
    items.push({
      id: evidence.id,
      identityOrigin: 'projection_derived',
      sourceClass: 'onboarding',
      projectId: project.id,
      canonicalSubjectId: evidence.canonicalSubjectId,
      routePath: null,
      capturedAt: evidence.capturedAt,
      sourceObservation: null,
      sourceModels: [],
      support: 'historical',
      usageReferences: [],
      integrity: 'not_evaluated',
      freshness: 'not_evaluated',
      access: 'available',
      conflict: 'not_evaluated',
      status: 'available',
      summary: `An onboarding ${evidence.observationType.replaceAll('_', ' ')} record was retained for this subject.`,
      provenanceSummary: `Produced by a ${evidence.goalOrigin} onboarding goal with ${evidence.confidence} recorded confidence.`,
      limitations: ['The unrestricted observed value and source diagnostic are intentionally omitted from this presentation.'],
      unknowns: ['Freshness, integrity, and evidence conflict have not been evaluated.'],
    })
  }

  if (new Set(items.map(item => item.id)).size !== items.length) return { kind: 'malformed' }
  const byId = new Map(items.map(item => [item.id, item]))
  for (const model of models) {
    if (!Number.isSafeInteger(model.rowId) || model.rowId < 1 || !SAFE_VERSION.test(model.version)
      || !['active', 'superseded', 'unknown'].includes(model.lifecycle)) return { kind: 'malformed' }
    for (const subject of model.subjects) {
      if (!SAFE_ID.test(subject.id)) return { kind: 'malformed' }
      if (subject.evidenceId === null) {
        if (model.lifecycle === 'active') return { kind: 'malformed' }
        continue
      }
      const item = byId.get(subject.evidenceId)
      if (!item || item.canonicalSubjectId !== subject.id
        || item.sourceObservation?.id !== model.sourceObservationId) return { kind: 'malformed' }
      item.sourceModels.push({
        rowId: model.rowId,
        version: model.version,
        lifecycle: model.lifecycle,
        href: `/application/model?project=${encodeURIComponent(project.id)}&model=${model.rowId}`,
      })
      if (model.lifecycle === 'active') {
        item.support = 'current'
        item.usageReferences = ['application_model', 'application_overview']
      } else if (!item.usageReferences.includes('application_model')) {
        item.usageReferences.push('application_model')
      }
    }
  }

  items.sort((left, right) => {
    const byTime = right.capturedAt.localeCompare(left.capturedAt)
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id)
  })
  const filtered = items.filter(item => (
    (query.sourceClass === null || item.sourceClass === query.sourceClass)
    && (query.support === null || item.support === query.support)
    && (query.integrity === null || item.integrity === query.integrity)
    && (query.observationId === null || item.sourceObservation?.id === query.observationId)
    && (query.capturedFrom === null || item.capturedAt >= query.capturedFrom)
    && (query.capturedThrough === null || item.capturedAt <= query.capturedThrough)
  ))
  const decoded = query.cursor === null ? null : decodeCursor(query.cursor)
  if (query.cursor !== null && (!decoded || decoded.projectId !== project.id
    || decoded.ordering !== ORDERING || !sameFilters(decoded.filters, filters))) return { kind: 'invalid_cursor' }
  const startIndex = decoded === null ? 0 : filtered.findIndex(item => item.id === decoded.afterEvidenceId) + 1
  if (decoded !== null && startIndex === 0) return { kind: 'invalid_cursor' }
  const page = filtered.slice(startIndex, startIndex + query.limit)
  return { kind: 'ok', value: buildReadModel(project, page, items, filtered, query, startIndex) }
}
