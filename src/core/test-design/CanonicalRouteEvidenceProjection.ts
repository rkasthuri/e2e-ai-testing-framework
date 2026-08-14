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

import * as crypto from 'crypto'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationRecord } from '../observation/ObservationTypes'
import { canonicalObservationIntegrityHash } from '../observation/ObservationIntegrity'
import { ObservationRepository } from '../storage/repositories/ObservationRepository'
import { AppModelRepository } from '../storage/repositories/AppModelRepository'
import type { CanonicalTestDefinitionAuthority } from './TestDefinitionAuthorityProjectionService'

export const ROUTE_NORMALIZATION_POLICY = Object.freeze({
  id: 'forge.canonical-route-normalization',
  version: '1',
})

export type CanonicalRouteRefusalCode =
  | 'route_unknown'
  | 'route_conflicted'
  | 'route_malformed'
  | 'route_unsafe'
  | 'route_model_disagreement'
  | 'route_observation_integrity_failed'
  | 'route_authority_mismatch'

export interface CanonicalSubjectRouteEvidence {
  canonicalSubjectId: string
  normalizedPath: string
  supportingObservationIds: string[]
}

export interface CanonicalRouteEvidence {
  schemaVersion: 'forge-canonical-route-evidence/v1'
  projectId: string
  modelRowId: number
  supportSealHash: string
  normalizationPolicy: { id: string; version: string }
  subjects: CanonicalSubjectRouteEvidence[]
  identityHash: string
}

export type CanonicalRouteEvidenceResult =
  | { kind: 'ok'; evidence: CanonicalRouteEvidence }
  | { kind: 'refused'; code: CanonicalRouteRefusalCode; subjectId: string | null; safeMessage: string }

const REFUSAL_MESSAGES: Readonly<Record<CanonicalRouteRefusalCode, string>> = Object.freeze({
  route_unknown: 'No sealed canonical route Observation supports the App Model subject.',
  route_conflicted: 'Sealed canonical Observations support conflicting routes for the same subject.',
  route_malformed: 'Canonical route evidence could not be parsed under the governed normalization policy.',
  route_unsafe: 'Canonical route evidence contains a prohibited or sensitive path form.',
  route_model_disagreement: 'Canonical route evidence does not agree with the current App Model subject route.',
  route_observation_integrity_failed: 'A route-supporting Observation failed integrity verification.',
  route_authority_mismatch: 'Route evidence does not belong to the supplied sealed App Model authority.',
})

function refused(code: CanonicalRouteRefusalCode, subjectId: string | null = null): CanonicalRouteEvidenceResult {
  return { kind: 'refused', code, subjectId, safeMessage: REFUSAL_MESSAGES[code] }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export type RouteNormalizationResult =
  | { kind: 'ok'; normalizedPath: string }
  | { kind: 'refused'; code: 'route_malformed' | 'route_unsafe' }

export function normalizeCanonicalRoute(value: unknown): RouteNormalizationResult {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
    || /[\u0000-\u001f\u007f\\]/.test(value) || value.startsWith('//')) {
    return { kind: 'refused', code: 'route_unsafe' }
  }
  let pathname: string
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        return { kind: 'refused', code: 'route_unsafe' }
      }
      pathname = parsed.pathname
    } else {
      const parsed = new URL(value, 'https://route.invalid')
      if (parsed.origin !== 'https://route.invalid') return { kind: 'refused', code: 'route_unsafe' }
      pathname = parsed.pathname
    }
    const decoded = decodeURIComponent(pathname)
    if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.length > 500
      || /[\u0000-\u001f\u007f\\]/.test(decoded)
      || decoded.split('/').some(segment => segment === '.' || segment === '..' || /[@=]/.test(segment))
      || /%(?:2f|5c|00|0d|0a)/i.test(pathname)) {
      return { kind: 'refused', code: 'route_unsafe' }
    }
    return { kind: 'ok', normalizedPath: pathname || '/' }
  } catch {
    return { kind: 'refused', code: 'route_malformed' }
  }
}

function isRouteObservation(observation: ObservationRecord): boolean {
  return observation.method === 'browser_dom_inspection'
    && observation.methodVersion === CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection
    && observation.predicate === 'page.discovered'
    && observation.outcome === 'present'
    && observation.boundary.kind === 'document'
    && observation.boundary.completion === 'complete'
}

export class CanonicalRouteEvidenceProjection {
  constructor(
    private readonly appModels = new AppModelRepository(),
    private readonly observations = (projectId: string) => new ObservationRepository(projectId),
  ) {}

  async read(projectId: string, authority: CanonicalTestDefinitionAuthority): Promise<CanonicalRouteEvidenceResult> {
    if (authority.projectId !== projectId || authority.authorityClass !== 'canonical_v2') {
      return refused('route_authority_mismatch')
    }
    const history = await this.appModels.readHistory(projectId, { limit: 1 })
    const model = history.kind === 'ok' ? history.activeModel : null
    if (!model || model.rowId !== authority.modelRowId || model.version !== authority.modelVersion
      || model.integrity !== 'verified' || model.validation !== 'valid') {
      return refused('route_authority_mismatch')
    }
    const snapshot = await this.observations(projectId).readRun(projectId, authority.observationRunId)
    if (!snapshot) return refused('route_authority_mismatch')
    const observationById = new Map(snapshot.observations.map(observation => [observation.observationId, observation]))
    const artifactById = new Map(snapshot.artifacts.map(artifact => [artifact.artifactId, artifact]))
    const modelRouteBySubject = new Map(model.subjects.map(subject => [subject.id, subject.routePath]))
    const subjects: CanonicalSubjectRouteEvidence[] = []

    for (const subject of authority.subjectSupport) {
      const routes = new Map<string, string[]>()
      for (const observationId of subject.supportingObservationIds) {
        const observation = observationById.get(observationId)
        if (!observation || observation.subjectId !== subject.canonicalSubjectId) {
          return refused('route_authority_mismatch', subject.canonicalSubjectId)
        }
        if (!isRouteObservation(observation)) continue
        const artifacts = observation.artifactIds.map(artifactId => artifactById.get(artifactId))
        if (artifacts.some(artifact => !artifact)
          || canonicalObservationIntegrityHash(observation, artifacts.map(artifact => ({
            artifactId: artifact!.artifactId,
            sha256: artifact!.sha256,
          }))) !== observation.integrityHash) {
          return refused('route_observation_integrity_failed', subject.canonicalSubjectId)
        }
        const observedValue = observation.observedValue as Record<string, unknown> | null
        const normalized = normalizeCanonicalRoute(observedValue?.urlPattern)
        if (normalized.kind === 'refused') return refused(normalized.code, subject.canonicalSubjectId)
        const ids = routes.get(normalized.normalizedPath) ?? []
        ids.push(observationId)
        routes.set(normalized.normalizedPath, ids)
      }
      if (routes.size === 0) return refused('route_unknown', subject.canonicalSubjectId)
      if (routes.size !== 1) return refused('route_conflicted', subject.canonicalSubjectId)
      const [[normalizedPath, observationIds]] = [...routes.entries()]
      const modelRoute = normalizeCanonicalRoute(modelRouteBySubject.get(subject.canonicalSubjectId))
      if (modelRoute.kind !== 'ok' || modelRoute.normalizedPath !== normalizedPath) {
        return refused('route_model_disagreement', subject.canonicalSubjectId)
      }
      subjects.push({
        canonicalSubjectId: subject.canonicalSubjectId,
        normalizedPath,
        supportingObservationIds: [...observationIds].sort(),
      })
    }
    subjects.sort((left, right) => left.canonicalSubjectId.localeCompare(right.canonicalSubjectId))
    const identity = {
      projectId,
      modelRowId: authority.modelRowId,
      supportSealHash: authority.supportSealHash,
      normalizationPolicy: ROUTE_NORMALIZATION_POLICY,
      subjects,
    }
    return {
      kind: 'ok',
      evidence: {
        schemaVersion: 'forge-canonical-route-evidence/v1',
        ...identity,
        normalizationPolicy: { ...ROUTE_NORMALIZATION_POLICY },
        identityHash: crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex'),
      },
    }
  }
}
