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
import { bootstrapEvidenceReader, type BootstrapEvidenceReader } from '../registry/BootstrapEvidenceReader'
import {
  presentEvidenceLedger,
  type EvidenceIntegrityState,
  type EvidenceLedgerQuery,
  type EvidenceSourceClass,
  type EvidenceSupportPosition,
  type SafeModelUsageInput,
} from '../registry/EvidenceLedgerPresenter'
import { presentApplicationModelHistory } from '../registry/ApplicationModelHistoryPresenter'
import { observationStore, type ObservationHistoryItem, type ObservationStore } from '../registry/ObservationStore'
import { executionContext, type ExecutionContext } from './ExecutionContext'

export interface EvidenceLedgerHttpResult {
  status: number
  body: unknown
}

type ParsedQuery = { ok: true; value: EvidenceLedgerQuery } | { ok: false; message: string }
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,2048}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_OBSERVATION_ID = /^[A-Za-z0-9-]{1,128}$/

function exactIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value
}

function enumQuery<T extends string>(value: unknown, allowed: readonly T[]): T | null | false {
  if (value === undefined) return null
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : false
}

export function parseEvidenceLedgerQuery(query: Record<string, unknown>): ParsedQuery {
  const limitRaw = query.limit
  if (limitRaw !== undefined && (typeof limitRaw !== 'string' || !/^\d{1,2}$/.test(limitRaw))) {
    return { ok: false, message: 'limit must be an integer from 1 through 50.' }
  }
  const limit = limitRaw === undefined ? 25 : Number(limitRaw)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, message: 'limit must be an integer from 1 through 50.' }
  }
  const sourceClass = enumQuery<EvidenceSourceClass>(query.sourceClass, ['onboarding', 'crawl_observation'])
  const support = enumQuery<EvidenceSupportPosition>(query.support, ['current', 'historical'])
  const integrity = enumQuery<EvidenceIntegrityState>(query.integrity, ['verified', 'failed', 'not_evaluated'])
  if (sourceClass === false || support === false || integrity === false) {
    return { ok: false, message: 'An evidence filter value is unsupported.' }
  }
  const capturedFrom = query.capturedFrom
  const capturedThrough = query.capturedThrough
  if ((capturedFrom !== undefined && (typeof capturedFrom !== 'string' || !exactIso(capturedFrom)))
    || (capturedThrough !== undefined && (typeof capturedThrough !== 'string' || !exactIso(capturedThrough)))) {
    return { ok: false, message: 'Evidence date filters must be exact ISO timestamps.' }
  }
  if (typeof capturedFrom === 'string' && typeof capturedThrough === 'string' && capturedFrom > capturedThrough) {
    return { ok: false, message: 'capturedFrom must not be later than capturedThrough.' }
  }
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !SAFE_CURSOR.test(query.cursor))) {
    return { ok: false, message: 'cursor is malformed.' }
  }
  if (query.observation !== undefined
    && (typeof query.observation !== 'string' || !SAFE_OBSERVATION_ID.test(query.observation))) {
    return { ok: false, message: 'observation is malformed.' }
  }
  if (query.evidence !== undefined && (typeof query.evidence !== 'string' || !SAFE_ID.test(query.evidence))) {
    return { ok: false, message: 'evidence is malformed.' }
  }
  return {
    ok: true,
    value: {
      limit,
      cursor: typeof query.cursor === 'string' ? query.cursor : null,
      sourceClass,
      support,
      integrity,
      observationId: typeof query.observation === 'string' ? query.observation : null,
      capturedFrom: typeof capturedFrom === 'string' ? capturedFrom : null,
      capturedThrough: typeof capturedThrough === 'string' ? capturedThrough : null,
      requestedEvidenceId: typeof query.evidence === 'string' ? query.evidence : null,
    },
  }
}

async function readAllObservations(
  projectId: string,
  store: Pick<ObservationStore, 'history'>,
): Promise<{ kind: 'ok'; observations: ObservationHistoryItem[] } | { kind: string }> {
  const observations: ObservationHistoryItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < 201; page += 1) {
    const result = store.history(projectId, { limit: 50, cursor })
    if (result.kind !== 'ok') return result
    observations.push(...result.observations)
    if (observations.length > 10_000) return { kind: 'malformed' }
    cursor = result.nextCursor
    if (!cursor) return { kind: 'ok', observations }
  }
  return { kind: 'malformed' }
}

async function readAllModels(
  projectId: string,
  projectName: string,
  engine: Pick<ExecutionContext, 'readAppModelHistory'>,
  store: Pick<ObservationStore, 'resolve' | 'latest'>,
): Promise<{ kind: 'ok'; models: SafeModelUsageInput[] } | { kind: string }> {
  const models: SafeModelUsageInput[] = []
  let cursor: string | null = null
  for (let page = 0; page < 201; page += 1) {
    const raw = await engine.readAppModelHistory(projectId, { limit: 50, cursor, requestedRowId: null })
    const presented = presentApplicationModelHistory(raw, { id: projectId, name: projectName }, {
      limit: 50,
      projection: { runs: [], observations: [] },
    })
    if (presented.kind !== 'ok') return presented
    for (const model of presented.value.models) {
      models.push({
        rowId: model.rowId,
        version: model.version,
        lifecycle: model.lifecycle,
        sourceObservationId: model.sourceObservation?.id ?? null,
        subjects: model.subjects.map(subject => ({ id: subject.id, evidenceId: subject.evidenceId })),
      })
    }
    if (models.length > 10_000) return { kind: 'malformed' }
    cursor = presented.value.page.nextCursor
    if (!cursor) return { kind: 'ok', models }
  }
  return { kind: 'malformed' }
}

/**
 * Read path only: every request re-reads immutable observations, bootstrap
 * evidence, and authoritative model history. No ledger state is cached or
 * persisted, and model references are joined only by exact persisted identity.
 */
export async function readEvidenceLedger(
  appName: string,
  query: Record<string, unknown>,
  resolveProject: (appName: string) => Promise<{ appName: string } | undefined>,
  dependencies: {
    observations?: Pick<ObservationStore, 'history' | 'resolve' | 'latest'>
    bootstrap?: Pick<BootstrapEvidenceReader, 'read'>
    engine?: Pick<ExecutionContext, 'readAppModelHistory'>
  } = {},
): Promise<EvidenceLedgerHttpResult> {
  const parsed = parseEvidenceLedgerQuery(query)
  if (!parsed.ok) return { status: 400, body: fail(parsed.message, 'INVALID_EVIDENCE_QUERY') }
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const observations = dependencies.observations ?? observationStore
  const bootstrap = dependencies.bootstrap ?? bootstrapEvidenceReader
  const engine = dependencies.engine ?? executionContext
  try {
    const [observationRead, modelRead] = await Promise.all([
      readAllObservations(appName, observations),
      readAllModels(appName, project.appName, engine, observations),
    ])
    if (observationRead.kind === 'ownership_mismatch') {
      return { status: 409, body: fail('Persisted evidence contains a project ownership conflict.', 'EVIDENCE_OWNERSHIP_CONFLICT') }
    }
    if (!('observations' in observationRead)) {
      return { status: 422, body: fail('Persisted observation evidence could not be validated safely.', 'EVIDENCE_HISTORY_INVALID') }
    }
    if (!('models' in modelRead)) {
      return { status: 422, body: fail('Persisted model evidence references could not be validated safely.', 'EVIDENCE_MODEL_REFERENCE_INVALID') }
    }
    const bootstrapRead = bootstrap.read(appName)
    if (bootstrapRead.kind === 'malformed') {
      return { status: 422, body: fail('Persisted onboarding evidence could not be validated safely.', 'EVIDENCE_BOOTSTRAP_INVALID') }
    }
    const presented = presentEvidenceLedger({
      project: { id: appName, name: project.appName },
      observations: observationRead.observations,
      bootstrapEvidence: bootstrapRead.kind === 'ok' ? bootstrapRead.evidence : [],
      models: modelRead.models,
      query: parsed.value,
    })
    if (presented.kind === 'invalid_cursor') {
      return { status: 400, body: fail('The evidence cursor is invalid for this project and filter set.', 'INVALID_EVIDENCE_QUERY') }
    }
    if (presented.kind === 'ownership_mismatch') {
      return { status: 409, body: fail('Persisted evidence contains a project ownership conflict.', 'EVIDENCE_OWNERSHIP_CONFLICT') }
    }
    if (presented.kind !== 'ok') {
      return { status: 422, body: fail('Evidence identities or references could not be validated safely.', 'EVIDENCE_LEDGER_INVALID') }
    }
    return { status: 200, body: ok(presented.value) }
  } catch {
    return { status: 500, body: fail('Evidence data is unavailable from the authoritative stores.', 'EVIDENCE_READ_UNAVAILABLE') }
  }
}
