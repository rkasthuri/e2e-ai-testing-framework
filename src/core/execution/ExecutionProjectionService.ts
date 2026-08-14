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
import type {
  CanonicalTestDefinitionV1,
  CanonicalTestDefinitionV2,
} from '../test-design/TestDefinitionContract'
import type { CanonicalTestDefinitionAuthority } from '../test-design/TestDefinitionAuthorityProjectionService'
import type { CanonicalRouteEvidence } from '../test-design/CanonicalRouteEvidenceProjection'
import type { AuthenticationExpectationProjection } from '../test-design/AuthenticationExpectationProjection'
import {
  buildExecutablePlanId,
  ExecutablePlanContractError,
  materializeExecutablePlan,
  type MaterializedExecutablePlan,
} from './ExecutablePlanContract'
import { evaluateIntrinsicCompatibility, type ProjectionFailureCode } from './DefinitionCompatibilityEvaluator'

export type { ProjectionFailureCode }

export interface ProjectionFailure { code: ProjectionFailureCode; explanation: string }
export type ProjectionResult = { kind: 'ok'; plan: MaterializedExecutablePlan } | { kind: 'failed'; failure: ProjectionFailure }

export interface ProjectionRequest {
  definition: CanonicalTestDefinitionV1 | CanonicalTestDefinitionV2
  definitionSchemaVersion?: 1 | 2
  definitionTestSetId: string
  definitionRevision: number
  testSetContentHash?: string
}

/** Compatibility-only input retained for historical projector callers. */
export interface CurrentProjectionAuthority {
  currentRevision: { revision: number; testSetId: string } | null
  sourceObservation: { id: string; authenticationExpectation: string; authenticationOutcome: 'succeeded' | 'failed' | 'not_evaluated' | 'not_required' | null } | null
  model: { rowId: number; version: string } | null
  currentSupportEvidenceIds: string[]
}

export interface CurrentV2ProjectionAuthority {
  currentRevision: { revision: number; testSetId: string; contentHash: string }
  sealedAuthority: CanonicalTestDefinitionAuthority
  routeEvidence: CanonicalRouteEvidence
  authenticationExpectation: AuthenticationExpectationProjection
}

function fail(code: ProjectionFailureCode, explanation: string): ProjectionResult {
  return { kind: 'failed', failure: { code, explanation } }
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function routeEvidenceIdentity(definition: CanonicalTestDefinitionV2): string | null {
  if (!definition.routeEvidence || definition.canonicalSubjects.length !== 1) return null
  return hash({
    subjectId: definition.canonicalSubjects[0],
    normalizedPath: definition.routeEvidence.normalizedPath,
    normalizationPolicy: definition.routeEvidence.normalizationPolicy,
    supportingObservationIds: definition.routeEvidence.supportingObservationIds,
  })
}

export function authenticationExpectationIdentity(definition: CanonicalTestDefinitionV2): string | null {
  return definition.authenticationExpectation ? hash(definition.authenticationExpectation) : null
}

function projectV2(request: ProjectionRequest, authority: CurrentV2ProjectionAuthority, projectedAt: string): ProjectionResult {
  const definition = request.definition as CanonicalTestDefinitionV2
  if (authority.currentRevision.revision !== request.definitionRevision
    || authority.currentRevision.testSetId !== request.definitionTestSetId
    || authority.currentRevision.contentHash !== request.testSetContentHash) {
    return fail('stale_definition', 'This definition does not belong to the current immutable Test Set revision.')
  }
  const sealed = authority.sealedAuthority
  if (definition.provenance.modelRowId !== sealed.modelRowId
    || definition.provenance.modelVersion !== sealed.modelVersion
    || definition.provenance.supportSealHash !== sealed.supportSealHash) {
    return fail('support_seal_mismatch', 'The definition no longer agrees with the active sealed App Model authority.')
  }
  const subject = definition.provenance.subjectSupport[0]
  const liveSubject = sealed.subjectSupport.find(item => item.canonicalSubjectId === subject?.canonicalSubjectId)
  if (!subject || definition.provenance.subjectSupport.length !== 1 || !liveSubject
    || JSON.stringify(subject.supportingObservationIds) !== JSON.stringify(liveSubject.supportingObservationIds)
    || JSON.stringify(subject.supportingGapIds) !== JSON.stringify(liveSubject.supportingGapIds)) {
    return fail('support_seal_mismatch', 'The definition subject support does not exactly match sealed authority.')
  }
  if (!definition.routeEvidence || !definition.action || !definition.oracle || !definition.authenticationExpectation) {
    return fail('route_unknown', 'The v2 definition predates governed route/authentication semantics and is not executable.')
  }
  const liveRoute = authority.routeEvidence.subjects.find(item => item.canonicalSubjectId === subject.canonicalSubjectId)
  if (!liveRoute) return fail('route_unknown', 'No current canonical route evidence supports this definition subject.')
  if (definition.routeEvidence.normalizedPath !== liveRoute.normalizedPath
    || JSON.stringify(definition.routeEvidence.supportingObservationIds) !== JSON.stringify(liveRoute.supportingObservationIds)
    || JSON.stringify(definition.routeEvidence.normalizationPolicy) !== JSON.stringify(authority.routeEvidence.normalizationPolicy)
    || definition.action.routePath !== definition.routeEvidence.normalizedPath) {
    return fail('stale_definition', 'Persisted v2 route semantics differ from current canonical route evidence.')
  }
  const expectedAuth = authority.authenticationExpectation
  if (definition.authenticationExpectation.state !== expectedAuth.state
    || definition.authenticationExpectation.mechanism !== expectedAuth.mechanism
    || JSON.stringify(definition.authenticationExpectation.bases) !== JSON.stringify(expectedAuth.bases)) {
    return fail('stale_definition', 'Persisted authentication expectation differs from current governed provenance.')
  }
  const intrinsic = evaluateIntrinsicCompatibility({
    steps: [{ kind: definition.action.kind, subjectId: definition.action.subjectId }],
    oracle: { kind: definition.oracle.kind, subjectId: definition.oracle.subjectId },
    authenticationRequired: undefined,
    authenticationExpectation: { state: definition.authenticationExpectation.state, mechanism: definition.authenticationExpectation.mechanism },
  })
  if (intrinsic.state === 'blocked') return fail(intrinsic.reason, intrinsic.explanation)
  const routeHash = routeEvidenceIdentity(definition)
  const authHash = authority.authenticationExpectation.identityHash
  if (!routeHash || !authHash || expectedAuth.state === 'unknown' || expectedAuth.state === 'conflicted') {
    return fail(expectedAuth.state === 'conflicted' ? 'authentication_conflicted' : 'authentication_unknown', 'Authentication expectation does not permit execution.')
  }
  try {
    return { kind: 'ok', plan: materializeExecutablePlan({
      schemaVersion: 2,
      planId: buildExecutablePlanId(definition.id, request.definitionTestSetId, request.definitionRevision),
      definitionId: definition.id,
      title: definition.title,
      category: 'navigation',
      steps: [{ kind: definition.action.kind, subjectId: definition.action.subjectId, routePath: definition.routeEvidence.normalizedPath }],
      oracle: { kind: definition.oracle.kind, subjectId: definition.oracle.subjectId, assertion: 'final_url_matches_route_no_navigation_error' },
      provenance: {
        definitionId: definition.id,
        testSetId: request.definitionTestSetId,
        revision: request.definitionRevision,
        testSetContentHash: request.testSetContentHash,
        modelRowId: sealed.modelRowId,
        modelVersion: sealed.modelVersion,
        supportSealHash: sealed.supportSealHash,
        routeEvidenceIdentityHash: routeHash,
        authenticationExpectationIdentityHash: authHash,
      },
      routeEvidence: { normalizationPolicy: { ...definition.routeEvidence.normalizationPolicy } },
      authenticationExpectation: { state: expectedAuth.state, mechanism: expectedAuth.mechanism },
      projectedAt,
    }) }
  } catch (cause) {
    if (cause instanceof ExecutablePlanContractError) return fail('projection_failure', 'The projected v2 plan did not satisfy its canonical contract.')
    throw cause
  }
}

function projectV1(request: ProjectionRequest, authority: CurrentProjectionAuthority, projectedAt: string): ProjectionResult {
  const definition = request.definition as CanonicalTestDefinitionV1
  if (!authority.currentRevision || authority.currentRevision.revision !== request.definitionRevision
    || authority.currentRevision.testSetId !== request.definitionTestSetId) return fail('stale_definition', 'This legacy definition is not current.')
  if (!authority.sourceObservation || !authority.model
    || definition.provenance.sourceObservationId !== authority.sourceObservation.id
    || definition.provenance.modelRowId !== authority.model.rowId
    || definition.provenance.modelVersion !== authority.model.version
    || definition.provenance.supportingEvidenceIds.some(id => !authority.currentSupportEvidenceIds.includes(id))) {
    return fail('conflicting_evidence', 'Legacy singular provenance does not match its compatibility authority.')
  }
  const intrinsic = evaluateIntrinsicCompatibility({
    steps: definition.steps,
    oracle: { kind: definition.oracle.kind, subjectId: definition.oracle.subjectId },
    authenticationRequired: definition.authenticationRequired,
    authenticationSetup: definition.authenticationSetup ? { mechanism: definition.authenticationSetup.mechanism } : undefined,
  })
  if (intrinsic.state === 'blocked') return fail(intrinsic.reason, intrinsic.explanation)
  if (definition.authenticationRequired && (definition.authenticationSetup!.provenance.sourceObservationId !== authority.sourceObservation.id
    || definition.authenticationSetup!.mechanism !== authority.sourceObservation.authenticationExpectation)) {
    return fail('conflicting_evidence', 'Legacy authentication setup no longer matches compatibility authority.')
  }
  try {
    return { kind: 'ok', plan: materializeExecutablePlan({
      schemaVersion: 1,
      planId: buildExecutablePlanId(definition.id, request.definitionTestSetId, request.definitionRevision),
      definitionId: definition.id, title: definition.title, category: 'navigation',
      steps: [{ kind: 'navigate_to_observed_route', subjectId: definition.steps[0].subjectId, routePath: definition.steps[0].routePath }],
      oracle: { kind: 'subject_observable', subjectId: definition.oracle.subjectId, assertion: 'final_url_matches_route_no_navigation_error' },
      provenance: { definitionId: definition.id, sourceObservationId: definition.provenance.sourceObservationId,
        modelRowId: definition.provenance.modelRowId, modelVersion: definition.provenance.modelVersion,
        supportingEvidenceIds: [...definition.provenance.supportingEvidenceIds], testSetId: request.definitionTestSetId, revision: request.definitionRevision },
      authenticationRequired: definition.authenticationRequired!,
      ...(definition.authenticationSetup ? { authenticationSetup: { mechanism: definition.authenticationSetup.mechanism,
        credentialReference: { ...definition.authenticationSetup.credentialReference }, provenance: { sourceObservationId: definition.authenticationSetup.provenance.sourceObservationId } } } : {}),
      projectedAt,
    }) }
  } catch (cause) {
    if (cause instanceof ExecutablePlanContractError) return fail('projection_failure', 'The legacy compatibility plan is malformed.')
    throw cause
  }
}

export function projectExecutablePlan(
  request: ProjectionRequest,
  authority: CurrentProjectionAuthority | CurrentV2ProjectionAuthority,
  projectedAt: string,
): ProjectionResult {
  return request.definitionSchemaVersion === 2
    ? projectV2(request, authority as CurrentV2ProjectionAuthority, projectedAt)
    : projectV1(request, authority as CurrentProjectionAuthority, projectedAt)
}
