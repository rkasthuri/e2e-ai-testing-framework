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

export type ReadinessState = 'supported' | 'supported_with_constraints' | 'blocked' | 'unknown'
export type ReadinessDecisionId = 'observe_application' | 'design_evidence_backed_tests' | 'execute_existing_tests' | 'interpret_results'

type ObservationOutcome = 'completed' | 'partially_completed' | 'blocked' | 'failed' | 'unknown' | 'interrupted'
type AuthenticationOutcome = 'succeeded' | 'failed' | 'not_evaluated' | 'not_required' | null
type IntegrityState = 'verified' | 'failed' | 'not_evaluated'

export interface ReadinessObservationInput {
  id: string
  projectId: string
  startedAt: string
  completedAt: string | null
  outcome: ObservationOutcome
  authentication: {
    expectation: string
    credentialAvailability: 'available' | 'missing' | 'not_required' | 'unknown'
    outcome: AuthenticationOutcome
  }
  subjectIds: string[]
  evidence: Array<{ id: string; integrity: 'valid' | 'failed' | 'unknown'; capturedAt: string }>
  blockerCount: number
  unknownCount: number
  limitationCount: number
}

export interface ReadinessModelInput {
  rowId: number
  version: string
  lifecycle: 'active' | 'superseded' | 'unknown'
  createdAt: string | null
  sourceObservationId: string | null
  validation: 'valid' | 'invalid' | 'malformed'
  integrity: IntegrityState
  projection: 'current' | 'unavailable' | 'invalid' | 'mismatched' | 'not_evaluated' | 'not_applicable'
  subjects: Array<{
    id: string
    basis: 'direct_observation' | 'unknown'
    evidenceId: string | null
    derivedMethod: 'rule' | 'ai' | 'manual' | 'unknown' | null
  }>
}

export interface ReadinessEvidenceInput {
  projectTotal: number
  currentSupportTotal: number
  historicalSupportTotal: number
  filteredTotal: number
  currentRecords: Array<{
    id: string
    canonicalSubjectId: string
    support: 'current' | 'historical'
    integrity: IntegrityState
    freshness: 'not_evaluated'
    access: 'available'
    conflict: 'not_evaluated' | 'conflicting'
    sourceObservationId: string | null
    sourceModelRows: number[]
  }>
}

export type ReadinessTestDefinitionAuthorityInput =
  | {
      kind: 'ok'
      authorityClass: 'canonical_v2'
      modelRowId: number
      modelVersion: string
      observationRunId: string
      supportSealHash: string
      characterizationPolicy: { id: string; version: string }
      supportingObservationIds: string[]
      supportingGapIds: string[]
      subjectIds: string[]
    }
  | {
      kind: 'refused'
      authorityClass: 'canonical_v2' | 'legacy_v1'
      code: string
    }

export interface ApplicationReadinessInput {
  project: { id: string; name: string }
  observation: ReadinessObservationInput | null
  model: ReadinessModelInput | null
  modelTotal: number
  activeModelCount: number
  evidence: ReadinessEvidenceInput
  testDefinitionAuthority: ReadinessTestDefinitionAuthorityInput
  testDefinitionSemanticAdmission?: {
    kind: 'ok' | 'refused'
    routeState: 'ready' | 'unknown' | 'conflicted' | 'refused'
    authenticationExpectation: 'required' | 'not_required' | 'unknown' | 'conflicted'
    generationAvailable: boolean
    code: string | null
  }
}

export type ApplicationReadinessPresentation =
  | { kind: 'ok'; value: ReturnType<typeof buildReadModel> }
  | { kind: 'malformed' }
  | { kind: 'ownership_mismatch' }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const MAX_REFERENCES_PER_DECISION = 12

function exactIso(value: string | null): boolean {
  return value === null || (Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value)
}

function projectHref(projectId: string, path: string, extra?: Record<string, string | number>): string {
  const query = new URLSearchParams({ project: projectId })
  for (const [key, value] of Object.entries(extra ?? {})) query.set(key, String(value))
  return `${path}?${query.toString()}`
}

function evidenceReference(projectId: string, item: ReadinessEvidenceInput['currentRecords'][number]) {
  return {
    kind: 'evidence' as const,
    id: item.id,
    label: `Evidence ${item.id}`,
    href: projectHref(projectId, '/application/evidence', { evidence: item.id, support: 'current' }),
    integrity: item.integrity,
    freshness: item.freshness,
  }
}

function observationEvidenceReference(
  projectId: string,
  observationId: string,
  item: ReadinessObservationInput['evidence'][number],
) {
  return {
    kind: 'evidence' as const,
    id: item.id,
    label: `Evidence ${item.id}`,
    href: projectHref(projectId, '/application/evidence', { evidence: item.id, observation: observationId }),
    integrity: item.integrity === 'valid'
      ? 'verified' as const
      : item.integrity === 'failed'
        ? 'failed' as const
        : 'not_evaluated' as const,
    freshness: 'not_evaluated' as const,
  }
}

function observationReference(projectId: string, observation: ReadinessObservationInput) {
  return {
    kind: 'observation' as const,
    id: observation.id,
    label: `Observation ${observation.id}`,
    href: projectHref(projectId, '/application/observations', { observation: observation.id }),
    integrity: 'not_evaluated' as const,
    freshness: 'not_evaluated' as const,
  }
}

function modelReference(projectId: string, model: ReadinessModelInput) {
  return {
    kind: 'model' as const,
    id: String(model.rowId),
    label: `Model ${model.version}, row ${model.rowId}`,
    href: projectHref(projectId, '/application/model', { model: model.rowId }),
    integrity: model.integrity,
    freshness: 'not_evaluated' as const,
  }
}

type ReadinessReference = ReturnType<typeof evidenceReference>
  | ReturnType<typeof observationEvidenceReference>
  | ReturnType<typeof observationReference>
  | ReturnType<typeof modelReference>

interface DecisionDraft {
  id: ReadinessDecisionId
  label: string
  state: ReadinessState
  explanation: string
  supportingEvidence: ReadinessReference[]
  blockers: string[]
  unknowns: string[]
  limitations: string[]
  preventedStrongerState: string
  safeNextAction: { label: string; explanation: string; href: string } | null
}

function observeDecision(input: ApplicationReadinessInput): DecisionDraft {
  const observation = input.observation
  const defaultAction = {
    label: 'Open Crawl',
    explanation: 'Crawl owns observation prerequisites and any future observation action.',
    href: projectHref(input.project.id, '/crawl'),
  }
  if (!observation) return {
    id: 'observe_application', label: 'Observe the application', state: 'unknown',
    explanation: 'No persisted project-owned observation establishes whether FORGE can currently observe this application.',
    supportingEvidence: [], blockers: [],
    unknowns: ['Authentication acceptance, target accessibility, and observable scope are unknown.'],
    limitations: ['Project existence does not establish observation readiness.'],
    preventedStrongerState: 'A persisted observation with explicit authentication and observed evidence is required.',
    safeNextAction: defaultAction,
  }
  const reference = observationReference(input.project.id, observation)
  const authBlocked = observation.authentication.outcome === 'failed'
    || (observation.authentication.credentialAvailability === 'missing'
      && observation.authentication.expectation !== 'none')
  if (authBlocked || observation.outcome === 'blocked' || observation.outcome === 'failed') return {
    id: 'observe_application', label: 'Observe the application', state: 'blocked',
    explanation: authBlocked
      ? 'The latest observation contains established authentication or credential-prerequisite evidence that prevented reliable application access.'
      : 'The latest observation ended in a blocked or failed state and does not establish a reliable observation path.',
    supportingEvidence: [reference],
    blockers: [authBlocked ? 'Authentication did not establish accepted application access.' : 'The latest observation recorded a blocking outcome.'],
    unknowns: ['The external cause and the outcome of a future observation are not inferred.'],
    limitations: ['Credential availability and credential acceptance are separate facts.'],
    preventedStrongerState: 'A later successful, evidence-producing observation is required before observation readiness can be supported.',
    safeNextAction: defaultAction,
  }
  const authSupported = observation.authentication.outcome === 'succeeded'
    || observation.authentication.outcome === 'not_required'
  if (!authSupported || ['unknown', 'interrupted'].includes(observation.outcome) || observation.evidence.length === 0) return {
    id: 'observe_application', label: 'Observe the application', state: 'unknown',
    explanation: 'The latest observation does not contain enough terminal, authentication, and evidence state to support another observation decision.',
    supportingEvidence: [reference], blockers: [],
    unknowns: ['Current authentication acceptance or evidence-producing access remains unestablished.'],
    limitations: ['A URL change or credential reference alone is not proof of authenticated access.'],
    preventedStrongerState: 'Explicit post-submit authentication evidence and at least one observed evidence record are required.',
    safeNextAction: defaultAction,
  }
  return {
    id: 'observe_application', label: 'Observe the application', state: 'supported_with_constraints',
    explanation: `The latest ${observation.outcome === 'completed' ? 'completed' : 'partial'} observation established authenticated or non-authenticated access and retained bounded evidence.`,
    supportingEvidence: [reference, ...observation.evidence.slice(0, MAX_REFERENCES_PER_DECISION - 1)
      .map(item => observationEvidenceReference(input.project.id, observation.id, item))],
    blockers: [],
    unknowns: ['Future process-scoped credential resolution and target availability are not guaranteed by historical success.'],
    limitations: [
      'Freshness is not evaluated.',
      'Observed subjects do not establish all application scope.',
      ...(observation.outcome === 'partially_completed' ? ['The latest observation was only partially completed.'] : []),
    ],
    preventedStrongerState: 'Freshness, the entire observation scope, and future access are not established.',
    safeNextAction: {
      label: 'Review the source observation',
      explanation: 'Inspect the bounded evidence before deciding whether another observation is warranted.',
      href: reference.href,
    },
  }
}

function designDecision(input: ApplicationReadinessInput): DecisionDraft {
  const model = input.model
  const currentEvidence = input.evidence.currentRecords.filter(item => item.support === 'current')
  if (!model) return {
    id: 'design_evidence_backed_tests', label: 'Design evidence-backed tests', state: 'unknown',
    explanation: 'No active authoritative Application Model is available to define testable subjects and their observation basis.',
    supportingEvidence: [], blockers: [],
    unknowns: ['Current model subjects and exact supporting evidence are unavailable.'],
    limitations: ['Historical evidence is not substituted for current model support.'],
    preventedStrongerState: 'A valid active model with exact current-support evidence is required.',
    safeNextAction: { label: 'Review Application Model', explanation: 'Inspect the authoritative model state and its blockers.', href: projectHref(input.project.id, '/application/model') },
  }
  const modelRef = modelReference(input.project.id, model)
  const authority = input.testDefinitionAuthority
  if (authority.kind === 'refused') {
    const integrityFailure = ['invalid_model', 'support_seal_mismatch', 'missing_observation', 'missing_gap',
      'duplicate_support', 'subject_support_conflict', 'characterization_policy_mismatch']
      .includes(authority.code)
    return {
      id: 'design_evidence_backed_tests', label: 'Design evidence-backed tests',
      state: integrityFailure ? 'blocked' : 'unknown',
      explanation: integrityFailure
        ? 'Core refused Test Definition authority because persisted model support failed canonical integrity admission.'
        : 'Core could not establish a sealed canonical v2 Test Definition authority package.',
      supportingEvidence: [modelRef],
      blockers: integrityFailure ? ['Canonical Test Definition support authority failed closed.'] : [],
      unknowns: integrityFailure ? [] : ['Sealed model, Observation, Gap, or exact subject support remains unavailable.'],
      limitations: ['Legacy singular provenance and operation identity cannot substitute for sealed canonical support.'],
      preventedStrongerState: `Core authority admission refused with ${authority.code}.`,
      safeNextAction: { label: 'Review Application Model', explanation: 'Inspect the active model and canonical support integrity.', href: modelRef.href },
    }
  }
  const semantics = input.testDefinitionSemanticAdmission
  if (semantics?.kind === 'refused') {
    return {
      id: 'design_evidence_backed_tests', label: 'Design evidence-backed tests',
      state: semantics.routeState === 'conflicted' || semantics.routeState === 'refused' ? 'blocked' : 'unknown',
      explanation: 'Sealed support authority is valid, but governed route semantics refused v2 generation admission.',
      supportingEvidence: [modelReference(input.project.id, model)],
      blockers: semantics.routeState === 'conflicted' || semantics.routeState === 'refused' ? ['Canonical route evidence failed closed.'] : [],
      unknowns: semantics.routeState === 'unknown' ? ['Canonical route evidence is unavailable.'] : [],
      limitations: ['Authentication and execution readiness cannot substitute for missing route evidence.'],
      preventedStrongerState: semantics.code ?? 'Route admission was refused.',
      safeNextAction: { label: 'Review observations', explanation: 'Inspect canonical subject route evidence.', href: projectHref(input.project.id, '/application/observations') },
    }
  }
  const expectedSubjectIds = model.subjects.map(subject => subject.id).sort()
  if (authority.modelRowId !== model.rowId || authority.modelVersion !== model.version
    || model.validation !== 'valid' || model.integrity !== 'verified'
    || authority.subjectIds.length !== expectedSubjectIds.length
    || authority.subjectIds.some((id, index) => id !== expectedSubjectIds[index])) {
    return {
      id: 'design_evidence_backed_tests', label: 'Design evidence-backed tests', state: 'blocked',
      explanation: 'Readiness model identity disagrees with the core-owned Test Definition authority projection.',
      supportingEvidence: [modelRef], blockers: ['Canonical authority projections disagree.'], unknowns: [],
      limitations: ['Readiness never normalizes disagreement between authority projections.'],
      preventedStrongerState: 'The active model and sealed Test Definition authority must agree exactly.',
      safeNextAction: { label: 'Review Application Model', explanation: 'Inspect the active model and its support seal.', href: modelRef.href },
    }
  }
  const notEvaluatedIntegrity = currentEvidence.some(item => item.integrity === 'not_evaluated')
  const aiDerived = model.subjects.some(subject => subject.derivedMethod === 'ai')
  const unknownBasis = model.subjects.some(subject => subject.basis === 'unknown')
  return {
    id: 'design_evidence_backed_tests', label: 'Design evidence-backed tests', state: 'supported_with_constraints',
    explanation: semantics?.kind === 'ok'
      ? `Core verified sealed authority and canonical routes; authentication expectation is ${semantics.authenticationExpectation}, and v2 generation is available${semantics.authenticationExpectation === 'unknown' || semantics.authenticationExpectation === 'conflicted' ? ' as blocked definitions' : ''}.`
      : 'Core verified the active model support seal, exact Observation/Gap membership, subject support, and characterization policy for bounded test design.',
    supportingEvidence: [modelRef, ...currentEvidence.slice(0, MAX_REFERENCES_PER_DECISION - 1).map(item => evidenceReference(input.project.id, item))],
    blockers: [],
    unknowns: ['Coverage, unobserved application scope, freshness, and evidence conflict are unknown.'],
    limitations: [
      'Design is bounded to the exact observed subjects and current-support evidence.',
      ...(notEvaluatedIntegrity ? ['Some current-support evidence integrity was not evaluated.'] : []),
      ...(unknownBasis ? ['Some model subjects do not have a direct-observation basis.'] : []),
      ...(aiDerived ? ['AI-derived classification is interpretation and does not replace direct observation evidence.'] : ['AI enrichment sufficiency is not evaluated.']),
    ],
    preventedStrongerState: 'Freshness, all application scope, conflict evaluation, and unobserved scope are not established.',
    safeNextAction: { label: 'Review evidence-backed model subjects', explanation: 'Use only the exact observed model subjects when designing tests.', href: modelRef.href },
  }
}

function unsupportedDownstreamDecision(input: ApplicationReadinessInput, id: 'execute_existing_tests' | 'interpret_results'): DecisionDraft {
  const executing = id === 'execute_existing_tests'
  return {
    id,
    label: executing ? 'Execute existing tests' : 'Interpret results confidently',
    state: 'unknown',
    explanation: executing
      ? 'The current readiness authorities do not establish a validated current test inventory or execution preflight.'
      : 'The current readiness authorities do not include a current completed execution and result evidence with assessed input health.',
    supportingEvidence: [], blockers: [],
    unknowns: executing
      ? ['Runnable test identity, execution configuration, credentials, target availability, and preconditions are unknown.']
      : ['Run identity, result evidence, input health, and result freshness are unknown.'],
    limitations: [executing
      ? 'Observation and model evidence cannot substitute for execution readiness evidence.'
      : 'Observation success and model validity cannot substitute for result evidence.'],
    preventedStrongerState: executing
      ? 'A bounded current test inventory and execution preflight are required.'
      : 'A current completed run with project-owned result evidence and input-health provenance is required.',
    safeNextAction: {
      label: executing ? 'Review existing tests' : 'Review results',
      explanation: executing ? 'The Tests workflow owns test inventory and generation state.' : 'The Results workflow owns persisted run outcomes.',
      href: projectHref(input.project.id, executing ? '/tests' : '/results'),
    },
  }
}

function validateInput(input: ApplicationReadinessInput): 'ok' | 'malformed' | 'ownership_mismatch' {
  if (!SAFE_ID.test(input.project.id) || typeof input.project.name !== 'string'
    || input.project.name.length < 1 || input.project.name.length > 255 || /[\u0000-\u001f\u007f]/.test(input.project.name)
    || !Number.isSafeInteger(input.modelTotal) || input.modelTotal < 0
    || !Number.isSafeInteger(input.activeModelCount) || input.activeModelCount < 0 || input.activeModelCount > 1) return 'malformed'
  const evidence = input.evidence
  if (![evidence.projectTotal, evidence.currentSupportTotal, evidence.historicalSupportTotal, evidence.filteredTotal]
    .every(value => Number.isSafeInteger(value) && value >= 0)
    || evidence.currentRecords.length > 50
    || evidence.currentSupportTotal + evidence.historicalSupportTotal !== evidence.projectTotal
    || evidence.filteredTotal !== evidence.currentSupportTotal) return 'malformed'
  if (new Set(evidence.currentRecords.map(item => item.id)).size !== evidence.currentRecords.length) return 'malformed'
  for (const item of evidence.currentRecords) {
    if (!SAFE_ID.test(item.id) || !SAFE_ID.test(item.canonicalSubjectId)
      || !['current', 'historical'].includes(item.support)
      || !['verified', 'failed', 'not_evaluated'].includes(item.integrity)
      || item.freshness !== 'not_evaluated' || item.access !== 'available'
      || !['not_evaluated', 'conflicting'].includes(item.conflict)
      || (item.sourceObservationId !== null && !SAFE_ID.test(item.sourceObservationId))
      || item.sourceModelRows.some(row => !Number.isSafeInteger(row) || row < 1)) return 'malformed'
  }
  if (input.observation) {
    const observation = input.observation
    if (observation.projectId !== input.project.id) return 'ownership_mismatch'
    if (!SAFE_ID.test(observation.id) || !exactIso(observation.startedAt) || !exactIso(observation.completedAt)
      || observation.subjectIds.length > 100 || observation.evidence.length > 100
      || new Set(observation.subjectIds).size !== observation.subjectIds.length
      || new Set(observation.evidence.map(item => item.id)).size !== observation.evidence.length
      || !['completed', 'partially_completed', 'blocked', 'failed', 'unknown', 'interrupted'].includes(observation.outcome)
      || !['available', 'missing', 'not_required', 'unknown'].includes(observation.authentication.credentialAvailability)
      || ![null, 'succeeded', 'failed', 'not_evaluated', 'not_required'].includes(observation.authentication.outcome)
      || observation.subjectIds.some(id => !SAFE_ID.test(id))
      || observation.evidence.some(item => !SAFE_ID.test(item.id) || !exactIso(item.capturedAt)
        || !['valid', 'failed', 'unknown'].includes(item.integrity))
      || [observation.blockerCount, observation.unknownCount, observation.limitationCount]
        .some(value => !Number.isSafeInteger(value) || value < 0)) return 'malformed'
  }
  if (input.model) {
    const model = input.model
    if (!Number.isSafeInteger(model.rowId) || model.rowId < 1 || !SAFE_VERSION.test(model.version)
      || model.lifecycle !== 'active' || model.subjects.length > 100 || !exactIso(model.createdAt)
      || (model.sourceObservationId !== null && !SAFE_ID.test(model.sourceObservationId))
      || !['valid', 'invalid', 'malformed'].includes(model.validation)
      || !['verified', 'failed', 'not_evaluated'].includes(model.integrity)
      || !['current', 'unavailable', 'invalid', 'mismatched', 'not_evaluated', 'not_applicable'].includes(model.projection)
      || new Set(model.subjects.map(item => item.id)).size !== model.subjects.length
      || model.subjects.some(subject => !SAFE_ID.test(subject.id)
        || !['direct_observation', 'unknown'].includes(subject.basis)
        || (subject.evidenceId !== null && !SAFE_ID.test(subject.evidenceId))
        || ![null, 'rule', 'ai', 'manual', 'unknown'].includes(subject.derivedMethod))) return 'malformed'
  }
  const authority = input.testDefinitionAuthority
  if (!authority || !['ok', 'refused'].includes(authority.kind)
    || !['canonical_v2', 'legacy_v1'].includes(authority.authorityClass)) return 'malformed'
  if (authority.kind === 'refused') {
    if (!SAFE_ID.test(authority.code)) return 'malformed'
  } else if (authority.authorityClass !== 'canonical_v2'
    || !Number.isSafeInteger(authority.modelRowId) || authority.modelRowId < 1
    || !SAFE_VERSION.test(authority.modelVersion)
    || !SAFE_ID.test(authority.observationRunId)
    || !/^[a-f0-9]{64}$/.test(authority.supportSealHash)
    || !SAFE_ID.test(authority.characterizationPolicy.id)
    || !SAFE_ID.test(authority.characterizationPolicy.version)
    || [authority.supportingObservationIds, authority.supportingGapIds, authority.subjectIds]
      .some(ids => ids.some(id => !SAFE_ID.test(id)) || new Set(ids).size !== ids.length
        || ids.some((id, index) => index > 0 && ids[index - 1] >= id))) return 'malformed'
  return 'ok'
}

function buildReadModel(input: ApplicationReadinessInput) {
  const decisions = [
    observeDecision(input),
    designDecision(input),
    unsupportedDownstreamDecision(input, 'execute_existing_tests'),
    unsupportedDownstreamDecision(input, 'interpret_results'),
  ]
  const times = [input.observation?.completedAt, input.observation?.startedAt, input.model?.createdAt,
    ...input.evidence.currentRecords.map(item => input.observation?.evidence.find(evidence => evidence.id === item.id)?.capturedAt ?? null)]
    .filter((value): value is string => value !== null && value !== undefined && exactIso(value))
  const asOf = times.sort().at(-1) ?? null
  const subjectIds = input.model?.subjects.map(subject => subject.id) ?? []
  const aiDerivedCount = input.model?.subjects.filter(subject => subject.derivedMethod === 'ai').length ?? 0
  return {
    project: input.project,
    asOf,
    vocabulary: ['supported', 'supported_with_constraints', 'blocked', 'unknown'] as const,
    authoritySnapshot: {
      projectStatus: {
        evaluated: false,
        explanation: 'Project identity resolved, but readiness does not reconstruct the separate lifecycle-event authority.',
        href: projectHref(input.project.id, '/application/overview'),
      },
      truthConfidence: {
        evaluated: false,
        explanation: 'Readiness does not recalculate Truth Confidence from this bounded projection. Review the separate Overview conclusion.',
        href: projectHref(input.project.id, '/application/overview'),
      },
      latestObservation: input.observation ? {
        id: input.observation.id,
        outcome: input.observation.outcome,
        authenticationOutcome: input.observation.authentication.outcome,
        credentialAvailability: input.observation.authentication.credentialAvailability,
        subjectIds: input.observation.subjectIds,
        evidenceCount: input.observation.evidence.length,
        startedAt: input.observation.startedAt,
        completedAt: input.observation.completedAt,
        href: projectHref(input.project.id, '/application/observations', { observation: input.observation.id }),
      } : null,
      activeModel: input.model ? {
        rowId: input.model.rowId,
        version: input.model.version,
        validation: input.model.validation,
        integrity: input.model.integrity,
        projection: input.model.projection,
        sourceObservationId: input.model.sourceObservationId,
        subjectIds,
        href: projectHref(input.project.id, '/application/model', { model: input.model.rowId }),
      } : null,
      evidence: {
        total: input.evidence.projectTotal,
        currentSupport: input.evidence.currentSupportTotal,
        historicalSupport: input.evidence.historicalSupportTotal,
        inspectedCurrentSupport: input.evidence.currentRecords.length,
        href: projectHref(input.project.id, '/application/evidence'),
      },
      testDefinitionAuthority: input.testDefinitionAuthority.kind === 'ok' ? {
        state: 'verified' as const,
        modelRowId: input.testDefinitionAuthority.modelRowId,
        observationRunId: input.testDefinitionAuthority.observationRunId,
        supportSealHash: input.testDefinitionAuthority.supportSealHash,
        characterizationPolicy: input.testDefinitionAuthority.characterizationPolicy,
        supportingObservationIds: input.testDefinitionAuthority.supportingObservationIds,
        supportingGapIds: input.testDefinitionAuthority.supportingGapIds,
        subjectIds: input.testDefinitionAuthority.subjectIds,
      } : {
        state: 'refused' as const,
        authorityClass: input.testDefinitionAuthority.authorityClass,
        code: input.testDefinitionAuthority.code,
      },
      testDefinitionSemantics: input.testDefinitionSemanticAdmission ?? {
        kind: 'refused' as const,
        routeState: 'unknown' as const,
        authenticationExpectation: 'unknown' as const,
        generationAvailable: false,
        code: 'not_evaluated',
      },
      boundaries: {
        freshness: 'not_evaluated' as const,
        coverage: 'unknown' as const,
        unobservedScope: 'unknown' as const,
        conflict: input.evidence.currentRecords.some(item => item.conflict === 'conflicting')
          ? 'conflicting' as const
          : 'not_evaluated' as const,
        aiEnrichment: aiDerivedCount > 0 ? 'limited' as const : 'not_evaluated' as const,
        explanation: aiDerivedCount > 0
          ? 'AI-derived classification is interpretation and cannot replace direct observation evidence.'
          : 'AI enrichment sufficiency is not established by the current readiness authorities.',
      },
    },
    decisions,
    provenance: {
      sources: ['immutable_observation_history', 'authoritative_app_model_history', 'canonical_test_definition_authority'] as const,
      explanation: 'Readiness is derived on demand from existing read-only authorities and is not persisted as application truth.',
    },
    limitations: [
      'Readiness is decision-specific and does not summarize application-wide condition, coverage, quality, or deployment suitability.',
      'Record counts are inventory facts and never determine a readiness state by themselves.',
      'Freshness, total observation coverage, unobserved scope, and evidence conflict are not evaluated.',
    ],
  }
}

/**
 * The presenter is the sole decision-policy owner. Inputs are already
 * presentation-safe, but are revalidated so an authority mismatch cannot turn
 * into a plausible readiness claim.
 */
export function presentApplicationReadiness(input: ApplicationReadinessInput): ApplicationReadinessPresentation {
  const validation = validateInput(input)
  if (validation !== 'ok') return { kind: validation }
  return { kind: 'ok', value: buildReadModel(input) }
}
