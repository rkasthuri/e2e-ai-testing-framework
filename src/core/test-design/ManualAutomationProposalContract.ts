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
import type { AuthenticationExpectationProjection } from './AuthenticationExpectationProjection'
import {
  materializeSupportedNormalizedTestIntentV1,
  type NormalizedIntentAppAreaV1,
  type NormalizedIntentStepV1,
  type SupportedNormalizedTestIntentV1,
  type NormalizedTestIntentRefusalCode,
} from './NormalizedTestIntentContract'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/

export type ManualSourceRefV1 = { kind: 'step'; ordinal: number } | { kind: 'expected_outcome' }
export type ManualSourceGroundingStatusV1 = 'grounded' | 'insufficient_evidence' | 'ambiguous_evidence' | 'unsupported_semantics'

export interface ManualSourceGroundingV1 {
  sourceRef: ManualSourceRefV1
  status: ManualSourceGroundingStatusV1
  canonicalBinding:
    | { kind: 'action'; ordinal: 0 | 1 }
    | { kind: 'oracle'; oracleKind: 'subject_observable' }
    | null
  basis:
    | { kind: 'governed_route'; flowStepIndex: null; evidenceIds: string[] }
    | { kind: 'observed_flow_step'; flowStepIndex: number; evidenceIds: string[] }
    | { kind: 'governed_subject'; flowStepIndex: null; evidenceIds: string[] }
}

export interface ManualAutomationProposalV1 {
  schemaVersion: 'forge-manual-automation-proposal/v1'
  proposalId: string
  projectId: string
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  authority: {
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    routeEvidenceIdentityHash: string
    authenticationExpectationIdentityHash: string
  }
  appArea: NormalizedIntentAppAreaV1
  normalizedIntent: SupportedNormalizedTestIntentV1
  normalizedIntentContentHash: string
  sourceGrounding: ManualSourceGroundingV1[]
  canonicalActions: readonly NormalizedIntentStepV1[]
  oracle: {
    kind: 'subject_observable'
    subjectId: string
    routePath: string
    supportingObservationIds: readonly string[]
    explanation: string
  }
  authenticationExpectation: AuthenticationExpectationProjection
  limitations: readonly string[]
  disposition: { state: 'supported' }
  proposalContentHash: string
}

export interface ManualAutomationRefusalV1 {
  schemaVersion: 'forge-manual-automation-refusal/v1'
  projectId: string
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  code: NormalizedTestIntentRefusalCode
  evidenceState: 'insufficient' | 'ambiguous' | 'unsupported'
  safeMessage: string
  sourceGrounding: ManualSourceGroundingV1[]
  limitations: string[]
}

export type ManualAnalysisResultV1 = {
  schemaVersion: 'forge-manual-analysis-result/v1'
  outcome:
    | { kind: 'proposal'; proposal: ManualAutomationProposalV1 }
    | { kind: 'refusal'; refusal: ManualAutomationRefusalV1 }
}

export interface ManualPromotionRequestV1 {
  schemaVersion: 'forge-manual-promotion-request/v1'
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  reviewedProposalAuthority: { proposalId: string; proposalContentHash: string }
}

export interface ManualPromotionResultV1 {
  schemaVersion: 'forge-manual-promotion-result/v1'
  outcome: 'promoted'
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  proposalAuthority: { proposalId: string; proposalContentHash: string }
  definitionAuthority: {
    definitionId: string
    definitionSchemaVersion: 3
    testSetId: string
    testSetRevision: number
    testSetContentHash: string
  }
}

export class ManualAutomationProposalContractError extends Error {
  constructor(readonly code:
    | 'MANUAL_PROPOSAL_INVALID'
    | 'INVALID_MANUAL_PROMOTION_REQUEST'
    | 'MANUAL_PROMOTION_IDENTITY_CONFLICT') {
    super(code === 'INVALID_MANUAL_PROMOTION_REQUEST'
      ? 'The manual promotion request is malformed.'
      : code === 'MANUAL_PROMOTION_IDENTITY_CONFLICT'
        ? 'The proposal identity does not agree with its content hash.'
        : 'The manual automation proposal is malformed.')
    this.name = 'ManualAutomationProposalContractError'
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: ManualAutomationProposalContractError['code'] = 'MANUAL_PROPOSAL_INVALID'): void {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new ManualAutomationProposalContractError(code)
  }
}

function assertId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
}

function assertHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
}

function assertText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
}

function groundingMaterial(value: ManualSourceGroundingV1) {
  return {
    sourceRef: value.sourceRef.kind === 'step'
      ? { kind: 'step' as const, ordinal: value.sourceRef.ordinal }
      : { kind: 'expected_outcome' as const },
    status: value.status,
    canonicalBinding: value.canonicalBinding === null
      ? null
      : value.canonicalBinding.kind === 'action'
        ? { kind: 'action' as const, ordinal: value.canonicalBinding.ordinal }
        : { kind: 'oracle' as const, oracleKind: 'subject_observable' as const },
    basis: value.basis.kind === 'observed_flow_step'
      ? { kind: 'observed_flow_step' as const, flowStepIndex: value.basis.flowStepIndex, evidenceIds: [...value.basis.evidenceIds] }
      : value.basis.kind === 'governed_route'
        ? { kind: 'governed_route' as const, flowStepIndex: null, evidenceIds: [...value.basis.evidenceIds] }
        : { kind: 'governed_subject' as const, flowStepIndex: null, evidenceIds: [...value.basis.evidenceIds] },
  }
}

function appAreaMaterial(value: NormalizedIntentAppAreaV1) {
  return {
    id: value.id,
    sourceSubjectId: value.sourceSubjectId,
    confidence: value.confidence,
    method: value.method,
    evidenceIds: [...value.evidenceIds],
  }
}

function actionMaterial(value: NormalizedIntentStepV1) {
  return value.kind === 'navigate_to_observed_route'
    ? { stepId: value.stepId, ordinal: value.ordinal, kind: value.kind, subjectId: value.subjectId, routePath: value.routePath }
    : {
        stepId: value.stepId, ordinal: value.ordinal, kind: value.kind, subjectId: value.subjectId,
        elementId: value.elementId, dataTestValue: value.dataTestValue, targetSubjectId: value.targetSubjectId,
      }
}

function authenticationMaterial(value: AuthenticationExpectationProjection) {
  return {
    schemaVersion: value.schemaVersion,
    state: value.state,
    mechanism: value.mechanism,
    bases: value.bases.map(basis => ({
      kind: basis.kind,
      policyId: basis.policyId,
      policyVersion: basis.policyVersion,
      configurationDigest: basis.configurationDigest,
      mechanism: basis.mechanism,
    })),
    identityHash: value.identityHash,
  }
}

function normalizedIntentMaterial(value: SupportedNormalizedTestIntentV1): SupportedNormalizedTestIntentV1 {
  return materializeSupportedNormalizedTestIntentV1(value).value
}

export function manualProposalSemanticMaterial(value: Omit<ManualAutomationProposalV1, 'proposalId' | 'proposalContentHash'>) {
  return {
    schemaVersion: 'forge-manual-automation-proposal/v1' as const,
    projectId: value.projectId,
    sourceAuthority: {
      sourceId: value.sourceAuthority.sourceId,
      sourceContentHash: value.sourceAuthority.sourceContentHash,
    },
    authority: {
      modelRowId: value.authority.modelRowId,
      modelVersion: value.authority.modelVersion,
      observationRunId: value.authority.observationRunId,
      supportSealHash: value.authority.supportSealHash,
      routeEvidenceIdentityHash: value.authority.routeEvidenceIdentityHash,
      authenticationExpectationIdentityHash: value.authority.authenticationExpectationIdentityHash,
    },
    appArea: appAreaMaterial(value.appArea),
    normalizedIntent: normalizedIntentMaterial(value.normalizedIntent),
    normalizedIntentContentHash: value.normalizedIntentContentHash,
    sourceGrounding: value.sourceGrounding.map(groundingMaterial),
    canonicalActions: value.canonicalActions.map(actionMaterial),
    oracle: {
      kind: 'subject_observable' as const,
      subjectId: value.oracle.subjectId,
      routePath: value.oracle.routePath,
      supportingObservationIds: [...value.oracle.supportingObservationIds],
      explanation: value.oracle.explanation,
    },
    authenticationExpectation: authenticationMaterial(value.authenticationExpectation),
    limitations: [...value.limitations],
    disposition: { state: 'supported' as const },
  }
}

export function manualProposalContentHash(value: Omit<ManualAutomationProposalV1, 'proposalId' | 'proposalContentHash'>): string {
  return crypto.createHash('sha256').update(JSON.stringify(manualProposalSemanticMaterial(value)), 'utf8').digest('hex')
}

export function deterministicManualProposalId(projectId: string, proposalContentHash: string): string {
  if (!SAFE_ID.test(projectId) || !SHA256.test(proposalContentHash)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROMOTION_IDENTITY_CONFLICT')
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify({ projectId, proposalContentHash }), 'utf8').digest('hex')
  return `manual-proposal-${digest.slice(0, 24)}`
}

function validateGrounding(value: unknown): asserts value is ManualSourceGroundingV1[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 51) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    const grounding = item as ManualSourceGroundingV1
    exactKeys(item as Record<string, unknown>, ['sourceRef', 'status', 'canonicalBinding', 'basis'])
    if (!grounding.sourceRef || typeof grounding.sourceRef !== 'object' || Array.isArray(grounding.sourceRef)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    if (grounding.sourceRef.kind === 'step') {
      exactKeys(grounding.sourceRef as unknown as Record<string, unknown>, ['kind', 'ordinal'])
      if (!Number.isSafeInteger(grounding.sourceRef.ordinal) || grounding.sourceRef.ordinal < 1) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    } else {
      exactKeys(grounding.sourceRef as unknown as Record<string, unknown>, ['kind'])
      if (grounding.sourceRef.kind !== 'expected_outcome') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
    if (!['grounded', 'insufficient_evidence', 'ambiguous_evidence', 'unsupported_semantics'].includes(grounding.status)) {
      throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
    if (grounding.canonicalBinding !== null) {
      if (!grounding.canonicalBinding || typeof grounding.canonicalBinding !== 'object' || Array.isArray(grounding.canonicalBinding)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
      if (grounding.canonicalBinding.kind === 'action') {
        exactKeys(grounding.canonicalBinding as unknown as Record<string, unknown>, ['kind', 'ordinal'])
        if (![0, 1].includes(grounding.canonicalBinding.ordinal)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
      } else {
        exactKeys(grounding.canonicalBinding as unknown as Record<string, unknown>, ['kind', 'oracleKind'])
        if (grounding.canonicalBinding.kind !== 'oracle' || grounding.canonicalBinding.oracleKind !== 'subject_observable') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
      }
    }
    if (!grounding.basis || typeof grounding.basis !== 'object' || Array.isArray(grounding.basis)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    exactKeys(grounding.basis as unknown as Record<string, unknown>, ['kind', 'flowStepIndex', 'evidenceIds'])
    if (!['governed_route', 'observed_flow_step', 'governed_subject'].includes(grounding.basis.kind)
      || grounding.basis.kind === 'observed_flow_step' && (!Number.isSafeInteger(grounding.basis.flowStepIndex) || grounding.basis.flowStepIndex < 0)
      || grounding.basis.kind !== 'observed_flow_step' && grounding.basis.flowStepIndex !== null
      || !Array.isArray(grounding.basis.evidenceIds) || grounding.basis.evidenceIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))) {
      throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
    validateGroundingCoupling(grounding)
  }
}

function validateGroundingCoupling(value: ManualSourceGroundingV1): void {
  if (value.canonicalBinding === null) return
  if (value.canonicalBinding.kind === 'action') {
    if (value.canonicalBinding.ordinal === 0
      ? value.basis.kind !== 'governed_route' || value.basis.flowStepIndex !== null
      : value.basis.kind !== 'observed_flow_step'
        || !Number.isSafeInteger(value.basis.flowStepIndex)
        || value.basis.flowStepIndex < 0) {
      throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
    return
  }
  if (value.basis.kind !== 'governed_subject' || value.basis.flowStepIndex !== null) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
}

function validateAuthenticationExpectation(value: unknown): asserts value is AuthenticationExpectationProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  const authentication = value as AuthenticationExpectationProjection
  exactKeys(value as Record<string, unknown>, ['schemaVersion', 'state', 'mechanism', 'bases', 'identityHash'])
  if (authentication.schemaVersion !== 'forge-authentication-expectation/v1'
    || !['required', 'not_required'].includes(authentication.state)
    || authentication.state === 'required' && (typeof authentication.mechanism !== 'string' || !SAFE_ID.test(authentication.mechanism))
    || authentication.state === 'not_required' && authentication.mechanism !== null
    || !Array.isArray(authentication.bases) || authentication.bases.length < 1
    || !SHA256.test(authentication.identityHash)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  for (const basis of authentication.bases) {
    if (!basis || typeof basis !== 'object' || Array.isArray(basis)) {
      throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
    exactKeys(basis as unknown as Record<string, unknown>, [
      'kind', 'policyId', 'policyVersion', 'configurationDigest', 'mechanism',
    ])
    if (basis.kind !== 'declared_configuration' || !SAFE_ID.test(basis.policyId)
      || !SAFE_ID.test(basis.policyVersion) || !SHA256.test(basis.configurationDigest)
      || !(basis.mechanism === null || typeof basis.mechanism === 'string' && SAFE_ID.test(basis.mechanism))) {
      throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
    }
  }
}

function validateSupportedGroundingPairings(value: ManualSourceGroundingV1[]): void {
  if (value.length !== 3) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  const [navigation, click, oracle] = value
  if (navigation.canonicalBinding?.kind !== 'action' || navigation.canonicalBinding.ordinal !== 0
    || click.canonicalBinding?.kind !== 'action' || click.canonicalBinding.ordinal !== 1
    || oracle.canonicalBinding?.kind !== 'oracle' || oracle.canonicalBinding.oracleKind !== 'subject_observable') {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
}

export function parseManualAutomationProposalV1(value: unknown, verifyComputedAuthority = false): ManualAutomationProposalV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  const proposal = value as unknown as ManualAutomationProposalV1
  exactKeys(value as Record<string, unknown>, [
    'schemaVersion', 'proposalId', 'projectId', 'sourceAuthority', 'authority', 'appArea',
    'normalizedIntent', 'normalizedIntentContentHash', 'sourceGrounding', 'canonicalActions',
    'oracle', 'authenticationExpectation', 'limitations', 'disposition', 'proposalContentHash',
  ])
  if (proposal.schemaVersion !== 'forge-manual-automation-proposal/v1') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  assertId(proposal.proposalId); assertId(proposal.projectId)
  if (!proposal.sourceAuthority || typeof proposal.sourceAuthority !== 'object' || Array.isArray(proposal.sourceAuthority)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  exactKeys(proposal.sourceAuthority as unknown as Record<string, unknown>, ['sourceId', 'sourceContentHash'])
  assertId(proposal.sourceAuthority.sourceId); assertHash(proposal.sourceAuthority.sourceContentHash)
  if (!proposal.authority || typeof proposal.authority !== 'object' || Array.isArray(proposal.authority)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  exactKeys(proposal.authority as unknown as Record<string, unknown>, ['modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'routeEvidenceIdentityHash', 'authenticationExpectationIdentityHash'])
  if (!Number.isSafeInteger(proposal.authority.modelRowId) || proposal.authority.modelRowId < 1) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  assertId(proposal.authority.modelVersion); assertId(proposal.authority.observationRunId)
  assertHash(proposal.authority.supportSealHash); assertHash(proposal.authority.routeEvidenceIdentityHash); assertHash(proposal.authority.authenticationExpectationIdentityHash)
  const normalized = materializeSupportedNormalizedTestIntentV1(proposal.normalizedIntent)
  if (normalized.value.source !== 'manual' || normalized.value.projectId !== proposal.projectId
    || normalized.value.grounding.modelRowId !== proposal.authority.modelRowId
    || normalized.value.grounding.modelVersion !== proposal.authority.modelVersion
    || normalized.value.grounding.observationRunId !== proposal.authority.observationRunId
    || normalized.value.grounding.supportSealHash !== proposal.authority.supportSealHash) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  if (!proposal.appArea || typeof proposal.appArea !== 'object' || Array.isArray(proposal.appArea)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(proposal.appArea as unknown as Record<string, unknown>, ['id', 'sourceSubjectId', 'confidence', 'method', 'evidenceIds'])
  if (JSON.stringify(appAreaMaterial(proposal.appArea)) !== JSON.stringify(appAreaMaterial(normalized.value.appArea))) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  assertHash(proposal.normalizedIntentContentHash); assertHash(proposal.proposalContentHash)
  validateGrounding(proposal.sourceGrounding)
  validateSupportedGroundingPairings(proposal.sourceGrounding)
  if (proposal.sourceGrounding.some((item, index) => item.status !== 'grounded'
    || index < proposal.sourceGrounding.length - 1 && (item.sourceRef.kind !== 'step' || item.sourceRef.ordinal !== index + 1)
    || index === proposal.sourceGrounding.length - 1 && item.sourceRef.kind !== 'expected_outcome')) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  if (!Array.isArray(proposal.canonicalActions) || proposal.canonicalActions.length !== 2
    || JSON.stringify(proposal.canonicalActions.map(actionMaterial))
      !== JSON.stringify(normalized.value.steps.map(actionMaterial))) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  if (!proposal.oracle || typeof proposal.oracle !== 'object' || Array.isArray(proposal.oracle)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  exactKeys(proposal.oracle as unknown as Record<string, unknown>, ['kind', 'subjectId', 'routePath', 'supportingObservationIds', 'explanation'])
  if (proposal.oracle.kind !== 'subject_observable'
    || proposal.oracle.subjectId !== normalized.value.expectedOutcomes[0].subjectId
    || proposal.oracle.routePath !== normalized.value.expectedOutcomes[0].routePath) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  assertId(proposal.oracle.subjectId); assertText(proposal.oracle.routePath); assertText(proposal.oracle.explanation)
  if (!Array.isArray(proposal.oracle.supportingObservationIds) || proposal.oracle.supportingObservationIds.length < 1
    || proposal.oracle.supportingObservationIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  validateAuthenticationExpectation(proposal.authenticationExpectation)
  if (proposal.authority.authenticationExpectationIdentityHash !== proposal.authenticationExpectation.identityHash) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  if (!Array.isArray(proposal.limitations) || proposal.limitations.some(item => typeof item !== 'string' || item.length < 1)
    || !proposal.disposition || typeof proposal.disposition !== 'object' || Array.isArray(proposal.disposition)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(proposal.disposition as unknown as Record<string, unknown>, ['state'])
  if (proposal.disposition.state !== 'supported') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  if (verifyComputedAuthority) {
    const withoutIdentity = { ...proposal } as ManualAutomationProposalV1
    delete (withoutIdentity as Partial<ManualAutomationProposalV1>).proposalId
    delete (withoutIdentity as Partial<ManualAutomationProposalV1>).proposalContentHash
    const hash = manualProposalContentHash(withoutIdentity as Omit<ManualAutomationProposalV1, 'proposalId' | 'proposalContentHash'>)
    if (hash !== proposal.proposalContentHash || deterministicManualProposalId(proposal.projectId, hash) !== proposal.proposalId
      || normalized.fingerprint !== proposal.normalizedIntentContentHash) throw new ManualAutomationProposalContractError('MANUAL_PROMOTION_IDENTITY_CONFLICT')
  }
  return proposal
}

export function materializeManualAutomationProposalV1(
  value: Omit<ManualAutomationProposalV1, 'proposalId' | 'proposalContentHash'>,
): ManualAutomationProposalV1 {
  const proposalContentHash = manualProposalContentHash(value)
  const proposal: ManualAutomationProposalV1 = {
    ...manualProposalSemanticMaterial(value),
    proposalId: deterministicManualProposalId(value.projectId, proposalContentHash),
    proposalContentHash,
  }
  parseManualAutomationProposalV1(proposal, true)
  return proposal
}

export function parseManualPromotionRequestV1(value: unknown): ManualPromotionRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualAutomationProposalContractError('INVALID_MANUAL_PROMOTION_REQUEST')
  const request = value as unknown as ManualPromotionRequestV1
  exactKeys(value as Record<string, unknown>, ['schemaVersion', 'sourceAuthority', 'reviewedProposalAuthority'], 'INVALID_MANUAL_PROMOTION_REQUEST')
  if (request.schemaVersion !== 'forge-manual-promotion-request/v1') throw new ManualAutomationProposalContractError('INVALID_MANUAL_PROMOTION_REQUEST')
  for (const [authority, keys] of [[request.sourceAuthority, ['sourceId', 'sourceContentHash']], [request.reviewedProposalAuthority, ['proposalId', 'proposalContentHash']]] as const) {
    if (!authority || typeof authority !== 'object' || Array.isArray(authority)) throw new ManualAutomationProposalContractError('INVALID_MANUAL_PROMOTION_REQUEST')
    exactKeys(authority as unknown as Record<string, unknown>, keys, 'INVALID_MANUAL_PROMOTION_REQUEST')
  }
  if (!SAFE_ID.test(request.sourceAuthority.sourceId) || !SHA256.test(request.sourceAuthority.sourceContentHash)
    || !SAFE_ID.test(request.reviewedProposalAuthority.proposalId) || !SHA256.test(request.reviewedProposalAuthority.proposalContentHash)) {
    throw new ManualAutomationProposalContractError('INVALID_MANUAL_PROMOTION_REQUEST')
  }
  return request
}

export function assertManualProposalIdentity(projectId: string, proposalId: string, proposalContentHash: string): void {
  if (deterministicManualProposalId(projectId, proposalContentHash) !== proposalId) {
    throw new ManualAutomationProposalContractError('MANUAL_PROMOTION_IDENTITY_CONFLICT')
  }
}

export function parseManualAnalysisResultV1(value: unknown): ManualAnalysisResultV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  const result = value as unknown as ManualAnalysisResultV1
  exactKeys(value as Record<string, unknown>, ['schemaVersion', 'outcome'])
  if (result.schemaVersion !== 'forge-manual-analysis-result/v1' || !result.outcome || typeof result.outcome !== 'object') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  if (result.outcome.kind === 'proposal') {
    exactKeys(result.outcome as unknown as Record<string, unknown>, ['kind', 'proposal'])
    parseManualAutomationProposalV1(result.outcome.proposal)
    return result
  }
  exactKeys(result.outcome as unknown as Record<string, unknown>, ['kind', 'refusal'])
  const refusal = result.outcome.refusal
  if (result.outcome.kind !== 'refusal' || !refusal || typeof refusal !== 'object' || Array.isArray(refusal)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  exactKeys(refusal as unknown as Record<string, unknown>, ['schemaVersion', 'projectId', 'sourceAuthority', 'code', 'evidenceState', 'safeMessage', 'sourceGrounding', 'limitations'])
  if (refusal.schemaVersion !== 'forge-manual-automation-refusal/v1' || !['insufficient_evidence', 'ambiguous_evidence', 'unsupported_semantics', 'app_area_unknown'].includes(refusal.code)
    || !['insufficient', 'ambiguous', 'unsupported'].includes(refusal.evidenceState)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  assertId(refusal.projectId); assertText(refusal.safeMessage)
  if (!refusal.sourceAuthority || typeof refusal.sourceAuthority !== 'object' || Array.isArray(refusal.sourceAuthority)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(refusal.sourceAuthority as unknown as Record<string, unknown>, ['sourceId', 'sourceContentHash'])
  assertId(refusal.sourceAuthority.sourceId); assertHash(refusal.sourceAuthority.sourceContentHash)
  validateGrounding(refusal.sourceGrounding)
  if (!Array.isArray(refusal.limitations) || refusal.limitations.some(item => typeof item !== 'string' || item.length < 1)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  return result
}

export function parseManualPromotionResultV1(value: unknown): ManualPromotionResultV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  const result = value as unknown as ManualPromotionResultV1
  exactKeys(value as Record<string, unknown>, ['schemaVersion', 'outcome', 'sourceAuthority', 'proposalAuthority', 'definitionAuthority'])
  if (result.schemaVersion !== 'forge-manual-promotion-result/v1' || result.outcome !== 'promoted') throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')

  if (!result.sourceAuthority || typeof result.sourceAuthority !== 'object' || Array.isArray(result.sourceAuthority)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(result.sourceAuthority as unknown as Record<string, unknown>, ['sourceId', 'sourceContentHash'])
  assertId(result.sourceAuthority.sourceId)
  assertHash(result.sourceAuthority.sourceContentHash)

  if (!result.proposalAuthority || typeof result.proposalAuthority !== 'object' || Array.isArray(result.proposalAuthority)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(result.proposalAuthority as unknown as Record<string, unknown>, ['proposalId', 'proposalContentHash'])
  assertId(result.proposalAuthority.proposalId)
  assertHash(result.proposalAuthority.proposalContentHash)

  if (!result.definitionAuthority || typeof result.definitionAuthority !== 'object' || Array.isArray(result.definitionAuthority)) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  exactKeys(result.definitionAuthority as unknown as Record<string, unknown>, [
    'definitionId', 'definitionSchemaVersion', 'testSetId', 'testSetRevision', 'testSetContentHash',
  ])
  assertId(result.definitionAuthority.definitionId)
  if (result.definitionAuthority.definitionSchemaVersion !== 3) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  assertId(result.definitionAuthority.testSetId)
  if (!Number.isSafeInteger(result.definitionAuthority.testSetRevision) || result.definitionAuthority.testSetRevision < 1) {
    throw new ManualAutomationProposalContractError('MANUAL_PROPOSAL_INVALID')
  }
  assertHash(result.definitionAuthority.testSetContentHash)
  return result
}
