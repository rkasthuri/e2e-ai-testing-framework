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
  CanonicalTestDefinitionV3,
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
import { materializeSupportedNormalizedTestIntentV1 } from '../test-design/NormalizedTestIntentContract'
import type { AppModel } from '../onboarding/types'

export type { ProjectionFailureCode }

export interface ProjectionFailure { code: ProjectionFailureCode; explanation: string }
export type ProjectionResult = { kind: 'ok'; plan: MaterializedExecutablePlan } | { kind: 'failed'; failure: ProjectionFailure }

export interface ProjectionRequest {
  definition: CanonicalTestDefinitionV1 | CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
  definitionSchemaVersion?: 1 | 2 | 3
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
  /** Required only for v3 observed-flow projection; v2 remains unchanged. */
  activeAppModel?: {
    rowId: number
    modelVersion: string
    snapshot: AppModel
  }
}

function fail(code: ProjectionFailureCode, explanation: string): ProjectionResult {
  return { kind: 'failed', failure: { code, explanation } }
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function routeEvidenceIdentity(definition: CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3): string | null {
  if ('flowRouteEvidence' in definition) {
    return hash({
      intentId: definition.normalizedIntent.intentId,
      routes: definition.flowRouteEvidence,
    })
  }
  if (!definition.routeEvidence || definition.canonicalSubjects.length !== 1) return null
  return hash({
    subjectId: definition.canonicalSubjects[0],
    normalizedPath: definition.routeEvidence.normalizedPath,
    normalizationPolicy: definition.routeEvidence.normalizationPolicy,
    supportingObservationIds: definition.routeEvidence.supportingObservationIds,
  })
}

export function authenticationExpectationIdentity(definition: CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3): string | null {
  return definition.authenticationExpectation ? hash(definition.authenticationExpectation) : null
}

function projectFlowV3(
  request: ProjectionRequest,
  authority: CurrentV2ProjectionAuthority,
  definition: CanonicalTestDefinitionV3,
  projectedAt: string,
): ProjectionResult {
  let intentHash: string
  try {
    intentHash = materializeSupportedNormalizedTestIntentV1(definition.normalizedIntent).fingerprint
  } catch {
    return fail('projection_failure', 'The embedded normalized intent is malformed.')
  }
  if (intentHash !== definition.provenance.intentContentHash
    || definition.normalizedIntent.intentId !== definition.provenance.intentId
    || definition.normalizedIntent.appArea.id !== definition.appArea) {
    return fail('conflicting_evidence', 'The embedded normalized intent does not match Definition provenance.')
  }
  const active = authority.activeAppModel
  const model = active?.snapshot
  if (!active || !model
    || active.rowId !== authority.sealedAuthority.modelRowId
    || active.modelVersion !== authority.sealedAuthority.modelVersion
    || model.app.name !== authority.sealedAuthority.projectId
    || model.app.modelVersion !== active.modelVersion) {
    return fail('conflicting_evidence', 'The active App Model snapshot does not form one coherent revision with current sealed support.')
  }

  const sourceFlowId = definition.normalizedIntent.grounding.sourceFlowId
  const flows = (model.flows ?? []).filter(flow => flow.id === sourceFlowId)
  if (flows.length === 0) return fail('stale_definition', 'The source observed flow no longer exists in the active App Model.')
  if (flows.length !== 1) return fail('conflicting_evidence', 'The source observed flow is ambiguous in the active App Model.')
  const flow = flows[0]
  if (flow.confidence !== 'observed' && flow.confidence !== 'partial') {
    return fail('stale_definition', 'The source flow no longer has runnable observed evidence.')
  }
  const currentIndexes = flow.steps.map(step => step.stepIndex)
  if (new Set(currentIndexes).size !== currentIndexes.length
    || currentIndexes.some((index, position) => position > 0 && index <= currentIndexes[position - 1])) {
    return fail('conflicting_evidence', 'The active source flow step ordering is ambiguous or non-canonical.')
  }
  const selectedIndexes = definition.normalizedIntent.grounding.selectedFlowStepIndexes
  if (selectedIndexes.length !== 1) return fail('projection_failure', 'The v3 selected flow segment is outside the bounded M1 shape.')
  const selectedIndex = selectedIndexes[0]
  const selected = flow.steps.filter(step => step.stepIndex === selectedIndex)
  if (selected.length === 0) return fail('stale_definition', 'The selected observed flow step no longer exists in the active App Model.')
  if (selected.length !== 1) return fail('conflicting_evidence', 'The selected observed flow step is ambiguous in the active App Model.')
  const currentExcluded = flow.steps.filter(step => step.stepIndex !== selectedIndex).map(step => step.stepIndex)
  if (JSON.stringify(currentExcluded) !== JSON.stringify(definition.normalizedIntent.grounding.excludedFlowStepIndexes)) {
    return fail('stale_definition', 'The source flow ordering or excluded non-runnable scope changed in the active App Model.')
  }
  const navigate = definition.actions[0]
  const click = definition.actions[1]
  const step = selected[0]
  if (navigate?.ordinal !== 0 || navigate.kind !== 'navigate_to_observed_route'
    || click?.ordinal !== 1 || click.kind !== 'click_observed_data_test'
    || JSON.stringify(definition.actions) !== JSON.stringify(definition.normalizedIntent.steps)) {
    return fail('projection_failure', 'The v3 Definition action identity or ordering differs from its normalized intent.')
  }
  if (step.grounding !== 'observed') {
    return fail('stale_definition', 'The selected runnable flow step is no longer directly observed.')
  }
  if (step.action !== 'click' || step.pageId !== navigate.subjectId || step.pageId !== click.subjectId
    || step.elementId !== click.elementId || step.targetPageId !== click.targetSubjectId || step.value !== null) {
    return fail('stale_definition', 'The selected active App Model flow step no longer matches the persisted runnable action.')
  }

  const entryPages = (model.pages ?? []).filter(page => page.id === navigate.subjectId)
  const outcomePages = (model.pages ?? []).filter(page => page.id === click.targetSubjectId)
  if (entryPages.length === 0 || outcomePages.length === 0) {
    return fail('stale_definition', 'An entry or outcome subject no longer exists in the active App Model.')
  }
  if (entryPages.length !== 1 || outcomePages.length !== 1) {
    return fail('conflicting_evidence', 'An entry or outcome subject is ambiguous in the active App Model.')
  }
  const entryPage = entryPages[0]
  const area = entryPage.module
  if (!area || !area.name || !['high', 'medium'].includes(area.confidence)
    || !['rule', 'ai', 'manual'].includes(area.method) || !area.evidenceIds.includes(entryPage.id)) {
    return fail('stale_definition', 'The current entry subject has no unambiguous persisted app-area classification.')
  }
  if (area.name !== definition.appArea || area.name !== definition.normalizedIntent.appArea.id) {
    return fail('stale_definition', 'The current persisted app-area classification differs from the v3 Definition.')
  }

  const elementLocations = (model.pages ?? []).flatMap(page =>
    page.elements.filter(element => element.id === click.elementId).map(element => ({ pageId: page.id, element })))
  if (elementLocations.length === 0) return fail('stale_definition', 'The observed click element no longer exists in the active App Model.')
  if (elementLocations.length !== 1 || elementLocations[0].pageId !== entryPage.id) {
    return fail('conflicting_evidence', 'The observed click element is ambiguous or belongs to a different active subject.')
  }
  const element = elementLocations[0].element
  if (element.cardinality?.kind !== 'single' || element.observedState !== 'visible') {
    return fail('stale_definition', 'The observed click element is no longer visible and single-cardinality.')
  }
  const dataTests = element.strategies.filter(strategy => strategy.type === 'data-test')
  if (dataTests.length !== 1) {
    return fail('conflicting_evidence', 'The observed click element no longer has one unambiguous data-test locator.')
  }
  if (dataTests[0].value !== click.dataTestValue) {
    return fail('stale_definition', 'The observed click element data-test value changed in the active App Model.')
  }

  if (expectedAuthState(definition) === 'required') {
    const precondition = definition.normalizedIntent.preconditions[0]
    const roles = model.roles.filter(role => role.id === flow.roleId)
    if (!precondition || precondition.kind !== 'authenticated_role' || precondition.roleId !== flow.roleId
      || roles.length !== 1 || roles[0].authOutcome !== 'succeeded'
      || roles[0].authFlow !== definition.authenticationExpectation.mechanism) {
      return fail('stale_definition', 'Current App Model authentication evidence no longer establishes the required role precondition.')
    }
  } else if (definition.normalizedIntent.preconditions.length !== 0) {
    return fail('conflicting_evidence', 'The v3 intent carries an authentication precondition for a non-authenticated current expectation.')
  }
  for (const route of definition.flowRouteEvidence) {
    const live = authority.routeEvidence.subjects.find(subject => subject.canonicalSubjectId === route.subjectId)
    if (!live) return fail('route_unknown', 'A selected observed-flow subject has no current canonical route.')
    if (route.normalizedPath !== live.normalizedPath
      || JSON.stringify(route.supportingObservationIds) !== JSON.stringify(live.supportingObservationIds)
      || JSON.stringify(route.normalizationPolicy) !== JSON.stringify(authority.routeEvidence.normalizationPolicy)) {
      return fail('stale_definition', 'Observed-flow route semantics differ from current canonical route evidence.')
    }
  }
  const expectedAuth = authority.authenticationExpectation
  if (definition.authenticationExpectation.state !== expectedAuth.state
    || definition.authenticationExpectation.mechanism !== expectedAuth.mechanism
    || JSON.stringify(definition.authenticationExpectation.bases) !== JSON.stringify(expectedAuth.bases)) {
    return fail('stale_definition', 'Persisted authentication expectation differs from current governed provenance.')
  }
  const intrinsic = evaluateIntrinsicCompatibility({
    steps: definition.actions.map(action => action.kind === 'click_observed_data_test'
      ? { kind: action.kind, subjectId: action.subjectId, targetSubjectId: action.targetSubjectId, dataTestValue: action.dataTestValue }
      : { kind: action.kind, subjectId: action.subjectId }),
    oracle: { kind: definition.oracle.kind, subjectId: definition.oracle.subjectId },
    authenticationRequired: undefined,
    authenticationExpectation: { state: expectedAuth.state, mechanism: expectedAuth.mechanism },
  })
  if (intrinsic.state === 'blocked') return fail(intrinsic.reason, intrinsic.explanation)
  const routeHash = routeEvidenceIdentity(definition)
  const authHash = expectedAuth.identityHash
  if (!routeHash || !authHash || expectedAuth.state === 'unknown' || expectedAuth.state === 'conflicted') {
    return fail(expectedAuth.state === 'conflicted' ? 'authentication_conflicted' : 'authentication_unknown', 'Authentication expectation does not permit execution.')
  }
  const outcome = definition.normalizedIntent.expectedOutcomes[0]
  try {
    return { kind: 'ok', plan: materializeExecutablePlan({
      schemaVersion: 2,
      planId: buildExecutablePlanId(definition.id, request.definitionTestSetId, request.definitionRevision),
      definitionId: definition.id,
      title: definition.title,
      category: 'observed_flow',
      appArea: definition.appArea,
      steps: definition.actions.map(action => ({ ...action })),
      oracle: {
        kind: definition.oracle.kind,
        subjectId: definition.oracle.subjectId,
        assertion: 'final_url_matches_route_no_navigation_error',
        routePath: outcome.routePath,
      },
      provenance: {
        definitionId: definition.id,
        testSetId: request.definitionTestSetId,
        revision: request.definitionRevision,
        testSetContentHash: request.testSetContentHash!,
        modelRowId: authority.sealedAuthority.modelRowId,
        modelVersion: authority.sealedAuthority.modelVersion,
        supportSealHash: authority.sealedAuthority.supportSealHash,
        routeEvidenceIdentityHash: routeHash,
        authenticationExpectationIdentityHash: authHash,
        intentId: definition.provenance.intentId,
        intentContentHash: definition.provenance.intentContentHash,
      },
      routeEvidence: { normalizationPolicy: { ...authority.routeEvidence.normalizationPolicy } },
      authenticationExpectation: { state: expectedAuth.state, mechanism: expectedAuth.mechanism },
      projectedAt,
    }) }
  } catch (cause) {
    if (cause instanceof ExecutablePlanContractError) return fail('projection_failure', 'The projected observed-flow plan did not satisfy its canonical contract.')
    throw cause
  }
}

function expectedAuthState(definition: CanonicalTestDefinitionV3): CanonicalTestDefinitionV3['authenticationExpectation']['state'] {
  return definition.authenticationExpectation.state
}

function projectV2(request: ProjectionRequest, authority: CurrentV2ProjectionAuthority, projectedAt: string): ProjectionResult {
  if ('actions' in request.definition || 'normalizedIntent' in request.definition) {
    return fail('projection_failure', 'A v3 observed-flow definition cannot enter the v2 projection path.')
  }
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
  if (definition.provenance.subjectSupport.length !== definition.canonicalSubjects.length) {
    return fail('support_seal_mismatch', 'The definition subject support does not exactly cover its canonical subjects.')
  }
  for (const subjectSupport of definition.provenance.subjectSupport) {
    const liveSubject = sealed.subjectSupport.find(item => item.canonicalSubjectId === subjectSupport.canonicalSubjectId)
    if (!liveSubject
      || JSON.stringify(subjectSupport.supportingObservationIds) !== JSON.stringify(liveSubject.supportingObservationIds)
      || JSON.stringify(subjectSupport.supportingGapIds) !== JSON.stringify(liveSubject.supportingGapIds)) {
      return fail('support_seal_mismatch', 'The definition subject support does not exactly match sealed authority.')
    }
  }
  const subject = definition.provenance.subjectSupport[0]
  if (!subject || definition.provenance.subjectSupport.length !== 1) {
    return fail('support_seal_mismatch', 'Legacy navigation v2 requires exactly one supported subject.')
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

function projectV3(request: ProjectionRequest, authority: CurrentV2ProjectionAuthority, projectedAt: string): ProjectionResult {
  if (!('actions' in request.definition) || !('normalizedIntent' in request.definition)) {
    return fail('projection_failure', 'Only an explicit v3 observed-flow definition can enter the v3 projection path.')
  }
  const definition = request.definition as CanonicalTestDefinitionV3
  if (authority.currentRevision.revision !== request.definitionRevision
    || authority.currentRevision.testSetId !== request.definitionTestSetId
    || authority.currentRevision.contentHash !== request.testSetContentHash) {
    return fail('stale_definition', 'This v3 definition does not belong to the current immutable Test Set revision.')
  }
  const sealed = authority.sealedAuthority
  if (definition.provenance.modelRowId !== sealed.modelRowId
    || definition.provenance.modelVersion !== sealed.modelVersion
    || definition.provenance.supportSealHash !== sealed.supportSealHash
    || definition.provenance.subjectSupport.length !== definition.canonicalSubjects.length) {
    return fail('support_seal_mismatch', 'The v3 definition no longer agrees with active sealed App Model authority.')
  }
  for (const subjectSupport of definition.provenance.subjectSupport) {
    const liveSubject = sealed.subjectSupport.find(item => item.canonicalSubjectId === subjectSupport.canonicalSubjectId)
    if (!liveSubject
      || JSON.stringify(subjectSupport.supportingObservationIds) !== JSON.stringify(liveSubject.supportingObservationIds)
      || JSON.stringify(subjectSupport.supportingGapIds) !== JSON.stringify(liveSubject.supportingGapIds)) {
      return fail('support_seal_mismatch', 'The v3 definition subject support does not exactly match sealed authority.')
    }
  }
  return projectFlowV3(request, authority, definition, projectedAt)
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
  if (request.definitionSchemaVersion === 3) {
    return projectV3(request, authority as CurrentV2ProjectionAuthority, projectedAt)
  }
  if (request.definitionSchemaVersion === 2) {
    return projectV2(request, authority as CurrentV2ProjectionAuthority, projectedAt)
  }
  return projectV1(request, authority as CurrentProjectionAuthority, projectedAt)
}
