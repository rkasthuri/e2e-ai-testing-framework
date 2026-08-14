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

import { getDb } from '../storage/db'
import type { ObservationBoundary } from './ObservationTypes'

export type ObservationProjectionWarningCode =
  | 'missing_observation'
  | 'missing_gap'
  | 'broken_support'
  | 'missing_artifact'
  | 'orphan_artifact'
  | 'unknown_support_role'
  | 'conflicting_support'
  | 'legacy_only_provenance'

export interface ObservationProjectionWarning {
  code: ObservationProjectionWarningCode
  modelRowId: number | null
  referenceId: string | null
  safeMessage: string
}

export interface CanonicalObservationReadProjection {
  schemaVersion: 'forge-observation-read-projection/v1'
  authority: 'canonical_product'
  projectId: string
  runs: Array<{
    runId: string
    lifecycle: string
    completeness: string | null
    reason: { code: string | null; message: string | null }
    producer: { id: string; version: string }
    acquisitionKind: string
    methods: Array<{ method: string; version: string; count: number }>
    startedAt: string
    terminalAt: string | null
  }>
  observations: Array<{
    observationId: string
    runId: string
    outcome: string
    subject: string
    predicate: string
    method: { id: string; version: string }
    boundary: ObservationBoundary
    capturedAt: string
    provenanceClass: string
    reasonCode: string | null
    artifactIds: string[]
  }>
  gaps: Array<{
    gapId: string
    runId: string
    reason: string
    intendedSubject: string
    intendedPredicate: string
    intendedMethod: { id: string; version: string }
    boundary: ObservationBoundary
    occurredAt: string
    artifactIds: string[]
  }>
  support: Array<{
    modelRowId: number
    modelVersion: string
    modelLifecycle: string
    observationRunId: string
    supportSealHash: string
    characterizationPolicy: { id: string; version: string }
    observations: Array<{ observationId: string; claimKey: string; role: string }>
    subjects: Array<{ canonicalSubjectId: string; observationId: string; claimKey: string; role: string }>
    gaps: Array<{ gapId: string; claimKey: string; role: string }>
  }>
  artifacts: Array<{
    artifactId: string
    runId: string
    sha256: string
    mediaType: string
    byteSize: number
    sensitivityClass: string
    redactionState: string
    capturedAt: string
    retentionClass: string
    retentionPolicy: { id: string; version: string }
    expiresAt: string | null
  }>
  historicalImports: Array<{
    sourceKind: string
    sourceSchema: string
    sourcePathState: string
    originalId: string | null
    originalIdState: string
    contentHash: string
    captureTimestamp: string | null
    producerIdentity: string | null
    producerIdentityState: string
    classification: string
    legacyProvenanceClass: string
    reasonCode: string
    importedObservationId: string | null
    importedObservationRunId: string | null
    importedAt: string
    importPolicy: { id: string; version: string }
  }>
  warnings: ObservationProjectionWarning[]
}

function boundary(value: string): ObservationBoundary {
  return JSON.parse(value) as ObservationBoundary
}

function warning(
  code: ObservationProjectionWarningCode,
  modelRowId: number | null,
  referenceId: string | null,
): ObservationProjectionWarning {
  const messages: Record<ObservationProjectionWarningCode, string> = {
    missing_observation: 'Canonical App Model support references an unavailable Observation.',
    missing_gap: 'Canonical App Model support references an unavailable ObservationGap.',
    broken_support: 'Canonical App Model support is incomplete or does not match its sealed run.',
    missing_artifact: 'Canonical fact linkage references unavailable artifact metadata.',
    orphan_artifact: 'Canonical artifact metadata is not linked to an Observation or ObservationGap.',
    unknown_support_role: 'Canonical support contains a role outside the adopted read contract.',
    conflicting_support: 'Canonical support contains incompatible roles for one claim identity.',
    legacy_only_provenance: 'This App Model has legacy operation provenance but no canonical Observation support.',
  }
  return { code, modelRowId, referenceId, safeMessage: messages[code] }
}

/**
 * Sole read-model owner for canonical crawl Observation truth.
 *
 * This service performs SELECTs only. It never invokes recovery, writes a
 * compatibility file, opens artifact bytes, or exposes artifact storage keys.
 */
export class ObservationReadProjectionService {
  async readOperation(projectId: string, operationId: string): Promise<CanonicalObservationReadProjection | null> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(operationId)) {
      throw new Error('Observation operation projection query is invalid.')
    }
    const row = await getDb().selectFrom('observation_runs')
      .select('observation_run_id')
      .where('project_id', '=', projectId)
      .where('producer', '=', 'forge.crawler')
      .where('operation_id', '=', operationId)
      .executeTakeFirst()
    return row ? this.readProject(projectId, { runId: row.observation_run_id, limit: 1 }) : null
  }

  async readProject(
    projectId: string,
    options: { runId?: string | null; limit?: number } = {},
  ): Promise<CanonicalObservationReadProjection> {
    const limit = options.limit ?? 50
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(projectId)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Observation projection query is invalid.')
    }
    const db = getDb()
    let runQuery = db.selectFrom('observation_runs').selectAll()
      .where('project_id', '=', projectId)
    if (options.runId) runQuery = runQuery.where('observation_run_id', '=', options.runId)
    const runRows = await runQuery.orderBy('started_at', 'desc').limit(limit).execute()
    const runIds = runRows.map(row => row.observation_run_id)

    const observationRows = runIds.length === 0 ? [] : await db.selectFrom('observations').selectAll()
      .where('project_id', '=', projectId).where('observation_run_id', 'in', runIds)
      .orderBy('captured_at').orderBy('observation_id').execute()
    const gapRows = runIds.length === 0 ? [] : await db.selectFrom('observation_gaps').selectAll()
      .where('project_id', '=', projectId).where('observation_run_id', 'in', runIds)
      .orderBy('occurred_at').orderBy('gap_id').execute()
    const artifactRows = runIds.length === 0 ? [] : await db.selectFrom('observation_artifacts').selectAll()
      .where('project_id', '=', projectId).where('observation_run_id', 'in', runIds)
      .orderBy('captured_at').orderBy('artifact_id').execute()
    const artifactIds = new Set(artifactRows.map(row => row.artifact_id))
    const observationIds = new Set(observationRows.map(row => row.observation_id))
    const gapIds = new Set(gapRows.map(row => row.gap_id))
    const allProjectLinks = runIds.length === 0 ? [] : await db.selectFrom('observation_artifact_links')
      .select(['artifact_id', 'observation_id', 'gap_id', 'ordinal'])
      .where('project_id', '=', projectId).orderBy('ordinal').execute()
    const links = allProjectLinks.filter(row => artifactIds.has(row.artifact_id)
      || (row.observation_id !== null && observationIds.has(row.observation_id))
      || (row.gap_id !== null && gapIds.has(row.gap_id)))

    const modelRows = await db.selectFrom('app_models')
      .select(['id', 'version', 'status', 'operation_id'])
      .where('app_name', '=', projectId).orderBy('id', 'desc').limit(50).execute()
    const modelIds = modelRows.map(row => Number(row.id))
    const seals = modelIds.length === 0 ? [] : await db.selectFrom('app_model_support_seals').selectAll()
      .where('model_row_id', 'in', modelIds).execute()
    const modelSupport = modelIds.length === 0 ? [] : await db.selectFrom('app_model_observation_support')
      .selectAll().where('model_row_id', 'in', modelIds).execute()
    const subjectSupport = modelIds.length === 0 ? [] : await db.selectFrom('app_model_subject_support')
      .selectAll().where('model_row_id', 'in', modelIds).execute()
    const gapSupport = modelIds.length === 0 ? [] : await db.selectFrom('app_model_gap_support')
      .selectAll().where('model_row_id', 'in', modelIds).execute()
    const historicalImports = await db.selectFrom('observation_import_sources').select([
      'source_kind', 'source_schema', 'source_path_state', 'original_id', 'original_id_state', 'content_hash',
      'capture_timestamp', 'producer_identity', 'producer_identity_state', 'classification',
      'legacy_provenance_class', 'reason_code', 'imported_observation_id',
      'imported_observation_run_id', 'imported_at', 'import_policy_id', 'import_policy_version',
    ]).where('project_id', '=', projectId)
      .orderBy('source_kind').orderBy('content_hash').execute()

    const warnings: ObservationProjectionWarning[] = []
    const linkedArtifactIds = new Set(links.map(row => row.artifact_id))
    for (const link of links) {
      if (!artifactIds.has(link.artifact_id)) warnings.push(warning('missing_artifact', null, link.artifact_id))
    }
    for (const artifact of artifactRows) {
      if (!linkedArtifactIds.has(artifact.artifact_id)) warnings.push(warning('orphan_artifact', null, artifact.artifact_id))
    }
    for (const row of modelSupport) {
      if (!observationIds.has(row.observation_id)) warnings.push(warning('missing_observation', Number(row.model_row_id), row.observation_id))
      if (row.support_role !== 'basis' && row.support_role !== 'bounds') {
        warnings.push(warning('unknown_support_role', Number(row.model_row_id), row.observation_id))
      }
    }
    for (const row of subjectSupport) {
      if (!observationIds.has(row.observation_id)) warnings.push(warning('missing_observation', Number(row.model_row_id), row.observation_id))
      if (row.support_role !== 'basis') warnings.push(warning('unknown_support_role', Number(row.model_row_id), row.observation_id))
    }
    for (const row of gapSupport) {
      if (!gapIds.has(row.gap_id)) warnings.push(warning('missing_gap', Number(row.model_row_id), row.gap_id))
      if (row.support_role !== 'bounds') warnings.push(warning('unknown_support_role', Number(row.model_row_id), row.gap_id))
    }

    const supports = seals.map(seal => {
      const model = modelRows.find(row => Number(row.id) === Number(seal.model_row_id))
      const observations = modelSupport.filter(row => Number(row.model_row_id) === Number(seal.model_row_id))
      const subjects = subjectSupport.filter(row => Number(row.model_row_id) === Number(seal.model_row_id))
      const gaps = gapSupport.filter(row => Number(row.model_row_id) === Number(seal.model_row_id))
      if (!model || [...observations, ...subjects, ...gaps].some(row => row.project_id !== projectId)
        || observations.some(row => !observationRows.some(item => item.observation_id === row.observation_id
          && item.observation_run_id === seal.observation_run_id))
        || gaps.some(row => !gapRows.some(item => item.gap_id === row.gap_id
          && item.observation_run_id === seal.observation_run_id))) {
        warnings.push(warning('broken_support', Number(seal.model_row_id), seal.observation_run_id))
      }
      const roles = new Map<string, Set<string>>()
      for (const row of observations) {
        const key = `${row.observation_id}|${row.claim_key}`
        const set = roles.get(key) ?? new Set<string>()
        set.add(row.support_role)
        roles.set(key, set)
      }
      for (const [key, values] of roles) {
        if (values.size > 1) warnings.push(warning('conflicting_support', Number(seal.model_row_id), key.split('|')[0]))
      }
      return {
        modelRowId: Number(seal.model_row_id),
        modelVersion: model?.version ?? 'unavailable',
        modelLifecycle: model?.status ?? 'unknown',
        observationRunId: seal.observation_run_id,
        supportSealHash: seal.support_hash,
        characterizationPolicy: {
          id: seal.characterization_policy_id,
          version: seal.characterization_policy_version,
        },
        observations: observations.map(row => ({
          observationId: row.observation_id, claimKey: row.claim_key, role: row.support_role,
        })).sort((left, right) => `${left.observationId}\u0000${left.claimKey}\u0000${left.role}`
          .localeCompare(`${right.observationId}\u0000${right.claimKey}\u0000${right.role}`)),
        subjects: subjects.map(row => ({
          canonicalSubjectId: row.canonical_subject_id,
          observationId: row.observation_id,
          claimKey: row.claim_key,
          role: row.support_role,
        })).sort((left, right) => `${left.canonicalSubjectId}\u0000${left.observationId}\u0000${left.claimKey}\u0000${left.role}`
          .localeCompare(`${right.canonicalSubjectId}\u0000${right.observationId}\u0000${right.claimKey}\u0000${right.role}`)),
        gaps: gaps.map(row => ({ gapId: row.gap_id, claimKey: row.claim_key, role: row.support_role }))
          .sort((left, right) => `${left.gapId}\u0000${left.claimKey}\u0000${left.role}`
            .localeCompare(`${right.gapId}\u0000${right.claimKey}\u0000${right.role}`)),
      }
    })
    for (const model of modelRows) {
      if (model.operation_id && !seals.some(seal => Number(seal.model_row_id) === Number(model.id))) {
        warnings.push(warning('legacy_only_provenance', Number(model.id), null))
      }
    }

    const methodsByRun = new Map<string, Map<string, { method: string; version: string; count: number }>>()
    for (const row of observationRows) {
      const methods = methodsByRun.get(row.observation_run_id) ?? new Map()
      const key = `${row.method}|${row.method_version}`
      const item = methods.get(key) ?? { method: row.method, version: row.method_version, count: 0 }
      item.count += 1
      methods.set(key, item)
      methodsByRun.set(row.observation_run_id, methods)
    }
    const artifactIdsFor = (kind: 'observation' | 'gap', id: string) => links
      .filter(row => kind === 'observation' ? row.observation_id === id : row.gap_id === id)
      .map(row => row.artifact_id)

    return {
      schemaVersion: 'forge-observation-read-projection/v1',
      authority: 'canonical_product',
      projectId,
      runs: runRows.map(row => ({
        runId: row.observation_run_id,
        lifecycle: row.lifecycle,
        completeness: row.completeness,
        reason: { code: row.safe_reason_code, message: row.safe_message },
        producer: { id: row.producer, version: row.producer_version },
        acquisitionKind: row.acquisition_kind,
        methods: [...(methodsByRun.get(row.observation_run_id)?.values() ?? [])],
        startedAt: row.started_at,
        terminalAt: row.terminal_at,
      })),
      observations: observationRows.map(row => ({
        observationId: row.observation_id,
        runId: row.observation_run_id,
        outcome: row.outcome,
        subject: row.subject_id,
        predicate: row.predicate,
        method: { id: row.method, version: row.method_version },
        boundary: boundary(row.boundary_json),
        capturedAt: row.captured_at,
        provenanceClass: row.provenance_class,
        reasonCode: row.safe_reason_code,
        artifactIds: artifactIdsFor('observation', row.observation_id),
      })),
      gaps: gapRows.map(row => ({
        gapId: row.gap_id,
        runId: row.observation_run_id,
        reason: row.reason,
        intendedSubject: row.intended_subject_id,
        intendedPredicate: row.intended_predicate,
        intendedMethod: { id: row.intended_method, version: row.intended_method_version },
        boundary: boundary(row.boundary_json),
        occurredAt: row.occurred_at,
        artifactIds: artifactIdsFor('gap', row.gap_id),
      })),
      support: supports,
      artifacts: artifactRows.map(row => ({
        artifactId: row.artifact_id,
        runId: row.observation_run_id,
        sha256: row.sha256,
        mediaType: row.media_type,
        byteSize: Number(row.byte_size),
        sensitivityClass: row.sensitivity_class,
        redactionState: row.redaction_state,
        capturedAt: row.captured_at,
        retentionClass: row.retention_class,
        retentionPolicy: { id: row.retention_policy_id, version: row.retention_policy_version },
        expiresAt: row.expires_at,
      })),
      // Import source paths are deliberately withheld. Historical metadata is
      // visible, but filesystem location and artifact bytes remain core-only.
      historicalImports: historicalImports.map(row => ({
        sourceKind: row.source_kind,
        sourceSchema: row.source_schema,
        sourcePathState: row.source_path_state,
        originalId: row.original_id,
        originalIdState: row.original_id_state,
        contentHash: row.content_hash,
        captureTimestamp: row.capture_timestamp,
        producerIdentity: row.producer_identity,
        producerIdentityState: row.producer_identity_state,
        classification: row.classification,
        legacyProvenanceClass: row.legacy_provenance_class,
        reasonCode: row.reason_code,
        importedObservationId: row.imported_observation_id,
        importedObservationRunId: row.imported_observation_run_id,
        importedAt: row.imported_at,
        importPolicy: { id: row.import_policy_id, version: row.import_policy_version },
      })),
      warnings,
    }
  }

  /** Existing Observation-history HTTP shape, derived entirely inside core. */
  async readHistoryView(projectId: string, options: {
    limit?: number
    requestedObservationId?: string | null
    startedFrom?: string | null
    startedThrough?: string | null
  } = {}) {
    const projection = await this.readProject(projectId, { limit: 50 })
    const from = options.startedFrom ?? null
    const through = options.startedThrough ?? null
    const filteredRuns = projection.runs.filter(run =>
      (!from || run.startedAt >= from) && (!through || run.startedAt <= through))
    const limit = options.limit ?? 25
    const runs = filteredRuns.slice(0, limit)
    const shown = new Set(runs.map(run => run.runId))
    const observationsByRun = new Map<string, typeof projection.observations>()
    for (const item of projection.observations) {
      const list = observationsByRun.get(item.runId) ?? []
      list.push(item)
      observationsByRun.set(item.runId, list)
    }
    const gapsByRun = new Map<string, typeof projection.gaps>()
    for (const item of projection.gaps) {
      const list = gapsByRun.get(item.runId) ?? []
      list.push(item)
      gapsByRun.set(item.runId, list)
    }
    const requested = options.requestedObservationId ?? null
    const requestedRun = requested
      ? projection.runs.find(run => run.runId === requested)
        ?? projection.runs.find(run => projection.observations.some(item =>
          item.observationId === requested && item.runId === run.runId))
      : null
    return {
      schemaVersion: projection.schemaVersion,
      authority: projection.authority,
      project: { id: projectId, name: projectId },
      observations: runs.map((run, index) => {
        const facts = observationsByRun.get(run.runId) ?? []
        const gaps = gapsByRun.get(run.runId) ?? []
        const terminalState = run.lifecycle === 'completed'
          ? run.completeness === 'complete' ? 'completed' : 'partially_completed'
          : run.lifecycle
        return {
          observationId: run.runId,
          projectId,
          projectName: projectId,
          observationContext: {
            id: run.runId,
            label: 'Canonical crawl ObservationRun',
            declaredScope: run.acquisitionKind,
            strategy: 'canonical',
          },
          sourceKind: 'crawl-engine' as const,
          position: index === 0 ? 'latest' as const : 'historical' as const,
          orderingTimestamp: run.terminalAt ?? run.startedAt,
          startedAt: run.startedAt,
          completedAt: run.terminalAt,
          terminalState,
          stateExplanation: run.reason.message
            ?? `Canonical run is ${run.lifecycle} with ${run.completeness ?? 'undetermined'} completeness.`,
          authentication: {
            expectation: 'unknown',
            credentialAvailability: 'unknown',
            outcome: null,
            explanation: 'Authentication detail is not part of the adopted canonical Observation read contract.',
            attempts: [],
          },
          observedSubjects: facts.map(item => ({
            id: item.subject,
            kind: 'page' as const,
            routePath: typeof item.boundary.scope.route === 'string' ? item.boundary.scope.route : null,
            evidenceId: item.observationId,
          })),
          unobservedScope: gaps.map(item => ({
            category: 'observation-scope',
            explanation: item.reason,
            count: 1,
          })),
          unknowns: projection.warnings.filter(item => item.referenceId === run.runId).map(item => ({
            category: 'observation-outcome-unknown',
            explanation: item.safeMessage,
            count: 1,
          })),
          blockers: run.lifecycle === 'blocked' || run.lifecycle === 'failed'
            ? [{ category: run.lifecycle === 'blocked' ? 'observation-blocked' : 'observation-failed', explanation: run.reason.code ?? run.lifecycle, count: 1 }]
            : [],
          limitations: gaps.map(item => ({ category: 'observation-scope', explanation: item.reason, count: 1 })),
          evidence: facts.map(item => ({
            id: item.observationId,
            subjectPath: typeof item.boundary.scope.route === 'string' ? item.boundary.scope.route : null,
            summary: `${item.predicate}: ${item.outcome} via ${item.method.id}.`,
            capturedAt: item.capturedAt,
            provenance: { kind: 'crawl-run' as const, reference: run.runId },
            integrity: 'valid' as const,
          })),
          recommendation: null,
          modelRecovery: null,
          modelRecoveryFailure: null,
        }
      }),
      page: {
        limit,
        nextCursor: null,
        previousCursor: null,
        hasPrevious: false,
        filteredTotal: filteredRuns.length,
        projectTotal: projection.runs.length,
      },
      filter: { startedFrom: from, startedThrough: through },
      requestedObservation: requested
        ? {
            observationId: requestedRun?.runId ?? requested,
            status: requestedRun
              ? shown.has(requestedRun.runId) ? 'on_page' as const : 'outside_page' as const
              : 'not_found' as const,
          }
        : null,
      warnings: projection.warnings,
    }
  }

  /** Existing latest-Observation UI shape, derived from canonical rows only. */
  async readLatestView(projectId: string) {
    const projection = await this.readProject(projectId, { limit: 50 })
    const run = projection.runs.find(item => item.lifecycle !== 'running') ?? null
    if (!run) return null
    const facts = projection.observations.filter(item => item.runId === run.runId)
    const gaps = projection.gaps.filter(item => item.runId === run.runId)
    const terminalState = run.lifecycle === 'completed'
      ? run.completeness === 'complete' ? 'completed' : 'partially_completed'
      : run.lifecycle
    return {
      schemaVersion: 1 as const,
      observationId: run.runId,
      projectId,
      projectName: projectId,
      observationContext: {
        id: run.runId,
        label: 'Canonical crawl ObservationRun',
        target: '[withheld]',
        declaredScope: run.acquisitionKind,
        strategy: 'canonical',
      },
      sourceKind: 'crawl-engine' as const,
      startedAt: run.startedAt,
      completedAt: run.terminalAt,
      terminalState,
      stateReason: run.reason.message ?? `Canonical run completed with ${run.completeness ?? 'undetermined'} completeness.`,
      credentialAvailability: 'unknown' as const,
      authenticationExpectation: 'unknown',
      authentication: {
        expectation: 'unknown', credentialAvailability: 'unknown' as const,
        outcome: 'not_evaluated' as const,
        reason: 'Authentication detail is not part of the adopted canonical Observation read contract.',
        attempts: [],
      },
      observedSubjects: facts.map(item => ({
        id: item.subject,
        kind: 'page' as const,
        value: typeof item.boundary.scope.route === 'string' ? item.boundary.scope.route : '/',
        evidenceId: item.observationId,
      })),
      unobservedScope: gaps.map(item => item.intendedSubject),
      unknowns: gaps.map(item => ({ id: item.gapId, subject: item.intendedSubject, reason: item.reason })),
      blockers: run.lifecycle === 'blocked' || run.lifecycle === 'failed'
        ? [{ id: run.runId, kind: run.lifecycle, subject: projectId, reason: run.reason.code ?? run.lifecycle }]
        : [],
      evidence: facts.map(item => ({
        id: item.observationId,
        subject: item.subject,
        summary: `${item.predicate}: ${item.outcome} via ${item.method.id}.`,
        capturedAt: item.capturedAt,
        provenance: { kind: 'crawl-run' as const, reference: run.runId },
        integrity: 'valid' as const,
      })),
      errors: run.lifecycle === 'failed' ? [run.reason.code ?? 'acquisition_failed'] : [],
      recommendation: null,
    }
  }
}

/**
 * Read-only evidence inventory view over the canonical projection. It owns no
 * evidence authority and never persists or creates Observation identities.
 */
export class ApplicationEvidenceInventoryProjection {
  constructor(private readonly observations = new ObservationReadProjectionService()) {}

  async read(projectId: string, options: {
    limit?: number
    sourceClass?: string | null
    support?: string | null
    integrity?: string | null
    observationId?: string | null
    capturedFrom?: string | null
    capturedThrough?: string | null
    requestedEvidenceId?: string | null
  } = {}) {
    const projection = await this.observations.readProject(projectId, { limit: 50 })
    const currentSupport = projection.support.find(item => item.modelLifecycle === 'active') ?? null
    const all = projection.observations.map(item => {
      const modelUses = projection.support.filter(model =>
        model.observations.some(row => row.observationId === item.observationId))
      const current = currentSupport?.observations.some(row => row.observationId === item.observationId) ?? false
      return {
        id: item.observationId,
        identityOrigin: 'persisted' as const,
        sourceClass: 'crawl_observation' as const,
        projectId,
        canonicalSubjectId: item.subject,
        routePath: typeof item.boundary.scope.route === 'string' ? item.boundary.scope.route : null,
        capturedAt: item.capturedAt,
        sourceObservation: {
          id: item.observationId,
          outcome: projection.runs.find(run => run.runId === item.runId)?.lifecycle ?? 'unknown',
          position: projection.runs[0]?.runId === item.runId ? 'latest' as const : 'historical' as const,
          href: `/application/observations?project=${encodeURIComponent(projectId)}&observation=${encodeURIComponent(item.observationId)}`,
        },
        sourceModels: modelUses.map(model => ({
          rowId: model.modelRowId,
          version: model.modelVersion,
          lifecycle: model.modelLifecycle,
          href: `/application/model?project=${encodeURIComponent(projectId)}&model=${model.modelRowId}`,
        })),
        support: current ? 'current' as const : 'historical' as const,
        usageReferences: current
          ? ['application_model' as const, 'application_overview' as const]
          : modelUses.length ? ['application_model' as const] : [],
        integrity: 'verified' as const,
        freshness: 'not_evaluated' as const,
        access: 'available' as const,
        conflict: 'not_evaluated' as const,
        status: 'available' as const,
        summary: 'A canonical crawl Observation recorded this subject predicate.',
        provenanceSummary: `Canonical Observation ${item.observationId} in run ${item.runId}.`,
        limitations: ['This bounded Observation does not establish complete application coverage.'],
        unknowns: ['Freshness and cross-run conflict are not evaluated in the adopted crawl slice.'],
      }
    })
    const filters = {
      sourceClass: options.sourceClass ?? null,
      support: options.support ?? null,
      integrity: options.integrity ?? null,
      observationId: options.observationId ?? null,
      capturedFrom: options.capturedFrom ?? null,
      capturedThrough: options.capturedThrough ?? null,
    }
    const filtered = all.filter(item =>
      (!filters.sourceClass || item.sourceClass === filters.sourceClass)
      && (!filters.support || item.support === filters.support)
      && (!filters.integrity || item.integrity === filters.integrity)
      && (!filters.observationId || item.sourceObservation.id === filters.observationId)
      && (!filters.capturedFrom || item.capturedAt >= filters.capturedFrom)
      && (!filters.capturedThrough || item.capturedAt <= filters.capturedThrough))
    const limit = options.limit ?? 25
    const page = filtered.slice(0, limit)
    const requested = options.requestedEvidenceId ?? null
    return {
      schemaVersion: 'forge-application-evidence-inventory/v1' as const,
      authority: projection.authority,
      canonicalRunCount: projection.runs.length,
      project: { id: projectId, name: projectId },
      evidence: page,
      page: {
        limit, nextCursor: null, previousCursor: null, hasPrevious: false,
        projectTotal: all.length, filteredTotal: filtered.length,
        currentSupportTotal: all.filter(item => item.support === 'current').length,
        historicalSupportTotal: all.filter(item => item.support === 'historical').length,
      },
      filters,
      ordering: 'captured-desc-id-asc-v1' as const,
      requestedEvidence: requested ? {
        evidenceId: requested,
        status: page.some(item => item.id === requested) ? 'on_page' as const
          : filtered.some(item => item.id === requested) ? 'outside_page' as const
            : all.some(item => item.id === requested) ? 'outside_filter' as const : 'not_found' as const,
      } : null,
      boundaries: {
        freshness: 'not_evaluated' as const,
        coverage: 'unknown' as const,
        explanation: 'Canonical evidence inventory does not establish application completeness, coverage, health, quality, or freshness.',
      },
      warnings: projection.warnings,
    }
  }
}

export const observationReadProjectionService = new ObservationReadProjectionService()
export const applicationEvidenceInventoryProjection = new ApplicationEvidenceInventoryProjection(
  observationReadProjectionService,
)
