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

/**
 * TD-UI-062B domain contract.
 *
 * Pure vocabulary and deterministic rules for project lifecycle, evidence, and
 * Truth Confidence. This module deliberately has no UI, persistence, engine,
 * credential, or AI dependencies.
 */

export type ProjectId = string & { readonly __brand: 'ProjectId' }
export type ObservationContextId = string & { readonly __brand: 'ObservationContextId' }
export type EvidenceId = string & { readonly __brand: 'TDUI062BEvidenceId' }

export type ProjectLifecycle =
  | 'created' | 'configuring' | 'ready_to_observe' | 'observing'
  | 'understood' | 'needs_attention' | 'stale' | 'archived'
export type TruthConfidence = 'unknown' | 'low' | 'medium' | 'high'
export type EvidenceIntegrity = 'valid' | 'failed' | 'unknown'
export type EvidenceFreshness = 'current' | 'stale' | 'expired' | 'unknown'
export type UnknownSeverity = 'informational' | 'material' | 'critical'
export type BlockerKind = 'access' | 'integrity' | 'currency' | 'coverage' | 'agreement' | 'policy'
export type RecommendationPriority = 'next' | 'important' | 'optional'

export interface UnknownRecord {
  id: string
  subject: string
  reason: string
  severity: UnknownSeverity
  evidenceIds: EvidenceId[]
}

export interface BlockerRecord {
  id: string
  kind: BlockerKind
  subject: string
  reason: string
  evidenceIds: EvidenceId[]
}

export interface RecommendationRecord {
  id: string
  action: string
  reason: string
  priority: RecommendationPriority
  evidenceIds: EvidenceId[]
  unknownIds: string[]
  blockerIds: string[]
}

export interface EvidenceRecord {
  id: EvidenceId
  projectId: ProjectId
  observationContextId: ObservationContextId
  source: string
  subject: string
  observation: string
  capturedAt: string
  provenance: { kind: string; reference: string }
  integrity: EvidenceIntegrity
  freshness: EvidenceFreshness
}

export interface ExplainableState {
  meaning: string
  why: string
  impact: string
  evidenceIds: EvidenceId[]
  unknowns: UnknownRecord[]
  blockers: BlockerRecord[]
  preventedHigherState: string | null
  recommendedNextStep: RecommendationRecord | null
  /** A conclusion is invalid without at least one supporting evidence ID. */
  conclusion?: string
}

export type ProjectApplicationKind = 'web' | 'api' | 'desktop' | 'mobile' | 'unknown'

export interface ProjectIdentity {
  projectId: ProjectId
  displayName: string
  applicationKind: ProjectApplicationKind
  observationBoundary: string
  createdAt: string
  updatedAt: string
  lifecycleState: ProjectLifecycle
  stateRevision: number
}

export type LifecycleEventType =
  | 'begin_configuration' | 'configuration_ready' | 'observation_started'
  | 'understanding_established' | 'attention_required' | 'evidence_became_stale'
  | 'archive' | 'restore'

export interface LifecycleTransitionEvent {
  eventId: string
  projectId: ProjectId
  type: LifecycleEventType
  occurredAt: string
  expectedRevision: number
  reason: string
  evidenceIds: EvidenceId[]
}

export interface LifecycleTransition {
  event: LifecycleTransitionEvent
  from: ProjectLifecycle
  to: ProjectLifecycle
  stateRevision: number
}

export interface LifecycleEventLog {
  events: readonly LifecycleTransitionEvent[]
}

export interface ConfidenceDimensions {
  currency: 'current' | 'stale' | 'missing'
  coverage: 'complete' | 'partial' | 'missing'
  access: 'verified' | 'partial' | 'blocked' | 'missing'
  integrity: 'valid' | 'failed' | 'unknown'
  agreement: 'agreed' | 'conflicting' | 'unknown'
}

export interface TruthConfidenceEvaluation extends ExplainableState {
  level: TruthConfidence
  dimensions: ConfidenceDimensions
}

export class InvalidDomainContractError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidDomainContractError' }
}

export class InvalidLifecycleTransitionError extends InvalidDomainContractError {
  constructor(
    readonly currentState: ProjectLifecycle,
    readonly attemptedEvent: LifecycleTransitionEvent,
    readonly requiredNextAction: string,
  ) {
    super(`Invalid lifecycle transition from '${currentState}' via '${attemptedEvent.type}'. Required next action: ${requiredNextAction}`)
    this.name = 'InvalidLifecycleTransitionError'
  }
}

const transitions: Record<ProjectLifecycle, Partial<Record<LifecycleEventType, ProjectLifecycle>>> = {
  created: { begin_configuration: 'configuring', archive: 'archived' },
  configuring: { configuration_ready: 'ready_to_observe', attention_required: 'needs_attention', archive: 'archived' },
  ready_to_observe: { observation_started: 'observing', archive: 'archived' },
  observing: { understanding_established: 'understood', attention_required: 'needs_attention', evidence_became_stale: 'stale', archive: 'archived' },
  understood: { observation_started: 'observing', attention_required: 'needs_attention', evidence_became_stale: 'stale', archive: 'archived' },
  needs_attention: { begin_configuration: 'configuring', configuration_ready: 'ready_to_observe', observation_started: 'observing', archive: 'archived' },
  stale: { observation_started: 'observing', archive: 'archived' },
  archived: { restore: 'created' },
}

function requireText(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new InvalidDomainContractError(`${field} must be a non-empty string`)
}
function requireIso(value: string, field: string): void {
  requireText(value, field)
  if (Number.isNaN(Date.parse(value))) throw new InvalidDomainContractError(`${field} must be an ISO date`)
}
function requireEvidenceIds(ids: EvidenceId[], field: string): void {
  if (!Array.isArray(ids)) throw new InvalidDomainContractError(`${field} must be an array`)
  for (const id of ids) requireText(id, `${field} item`)
}
function containsCredentialKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsCredentialKey)
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    /(password|secret|token|credential)/i.test(key) || containsCredentialKey(child),
  )
}

export function asProjectId(value: string): ProjectId { requireText(value, 'projectId'); return value as ProjectId }
export function asObservationContextId(value: string): ObservationContextId { requireText(value, 'observationContextId'); return value as ObservationContextId }
export function asEvidenceId(value: string): EvidenceId { requireText(value, 'evidenceId'); return value as EvidenceId }

export function validateEvidence(record: EvidenceRecord): EvidenceRecord {
  requireText(record.id, 'evidence.id'); requireText(record.projectId, 'evidence.projectId')
  requireText(record.observationContextId, 'evidence.observationContextId'); requireText(record.source, 'evidence.source')
  requireText(record.subject, 'evidence.subject'); requireText(record.observation, 'evidence.observation')
  requireIso(record.capturedAt, 'evidence.capturedAt'); requireText(record.provenance.kind, 'evidence.provenance.kind')
  requireText(record.provenance.reference, 'evidence.provenance.reference')
  if (containsCredentialKey(record)) {
    throw new InvalidDomainContractError('evidence must not contain credential material')
  }
  return record
}

export function validateExplainableState(state: ExplainableState): ExplainableState {
  requireText(state.meaning, 'state.meaning'); requireText(state.why, 'state.why'); requireText(state.impact, 'state.impact')
  requireEvidenceIds(state.evidenceIds, 'state.evidenceIds')
  if (state.conclusion && state.evidenceIds.length === 0) throw new InvalidDomainContractError('a conclusion requires at least one evidence ID')
  for (const unknown of state.unknowns) requireEvidenceIds(unknown.evidenceIds, `unknown[${unknown.id}].evidenceIds`)
  for (const blocker of state.blockers) requireEvidenceIds(blocker.evidenceIds, `blocker[${blocker.id}].evidenceIds`)
  if (state.recommendedNextStep) requireEvidenceIds(state.recommendedNextStep.evidenceIds, 'recommendation.evidenceIds')
  return state
}

export function validateProjectIdentity(project: ProjectIdentity): ProjectIdentity {
  requireText(project.projectId, 'project.projectId'); requireText(project.displayName, 'project.displayName')
  requireText(project.observationBoundary, 'project.observationBoundary'); requireIso(project.createdAt, 'project.createdAt'); requireIso(project.updatedAt, 'project.updatedAt')
  if (!Number.isInteger(project.stateRevision) || project.stateRevision < 0) throw new InvalidDomainContractError('project.stateRevision must be a non-negative integer')
  return project
}

export function validateLifecycleTransition(project: ProjectIdentity, event: LifecycleTransitionEvent): ProjectLifecycle {
  validateProjectIdentity(project); requireText(event.eventId, 'event.eventId'); requireText(event.projectId, 'event.projectId'); requireIso(event.occurredAt, 'event.occurredAt'); requireText(event.reason, 'event.reason'); requireEvidenceIds(event.evidenceIds, 'event.evidenceIds')
  if (event.projectId !== project.projectId) throw new InvalidDomainContractError('lifecycle event projectId does not match project identity')
  if (event.expectedRevision !== project.stateRevision) throw new InvalidDomainContractError(`lifecycle event revision ${event.expectedRevision} does not match current revision ${project.stateRevision}`)
  const next = transitions[project.lifecycleState][event.type]
  if (!next) throw new InvalidLifecycleTransitionError(project.lifecycleState, event, project.lifecycleState === 'archived' ? "issue an explicit 'restore' event before any active transition" : 'use an allowed lifecycle event from the current state')
  return next
}

export function applyLifecycleTransition(project: ProjectIdentity, event: LifecycleTransitionEvent): { project: ProjectIdentity; transition: LifecycleTransition } {
  const next = validateLifecycleTransition(project, event)
  const updated: ProjectIdentity = { ...project, lifecycleState: next, updatedAt: event.occurredAt, stateRevision: project.stateRevision + 1 }
  return { project: updated, transition: { event, from: project.lifecycleState, to: next, stateRevision: updated.stateRevision } }
}

/** Validate and append one event without mutating the existing event log. */
export function appendLifecycleTransition(
  project: ProjectIdentity,
  log: LifecycleEventLog,
  event: LifecycleTransitionEvent,
): { project: ProjectIdentity; log: LifecycleEventLog; transition: LifecycleTransition } {
  const applied = applyLifecycleTransition(project, event)
  return { ...applied, log: { events: [...log.events, event] } }
}

export function evaluateTruthConfidence(dimensions: ConfidenceDimensions, evidence: EvidenceRecord[], unknowns: UnknownRecord[] = [], blockers: BlockerRecord[] = []): TruthConfidenceEvaluation {
  for (const item of evidence) validateEvidence(item)
  const evidenceIds = evidence.map(item => item.id)
  const usable = evidence.filter(item => item.integrity === 'valid' && item.freshness === 'current')
  const stale = evidence.some(item => item.freshness === 'stale' || item.freshness === 'expired')
  const integrityFailed = dimensions.integrity === 'failed' || evidence.some(item => item.integrity === 'failed')
  const criticalUnknown = unknowns.some(item => item.severity === 'critical')
  const reasons: string[] = []
  const derivedBlockers = [...blockers]
  if (evidence.length === 0) reasons.push('no evidence was supplied')
  if (stale || dimensions.currency !== 'current') reasons.push('current evidence is stale or incomplete')
  if (integrityFailed) reasons.push('one or more evidence items failed integrity')
  if (criticalUnknown) reasons.push('a critical unknown remains unresolved')
  if (dimensions.coverage !== 'complete') reasons.push('coverage is not complete')
  if (dimensions.access !== 'verified') reasons.push('access is not fully verified')
  if (dimensions.agreement !== 'agreed') reasons.push('evidence sources do not fully agree')
  if (integrityFailed && !derivedBlockers.some(item => item.kind === 'integrity')) derivedBlockers.push({ id: 'integrity-failed', kind: 'integrity', subject: 'evidence', reason: 'Evidence integrity failed', evidenceIds })
  if ((stale || dimensions.currency !== 'current') && !derivedBlockers.some(item => item.kind === 'currency')) derivedBlockers.push({ id: 'evidence-stale', kind: 'currency', subject: 'evidence', reason: 'Current claim lacks current evidence', evidenceIds })
  const allHighDimensions = dimensions.currency === 'current' && dimensions.coverage === 'complete' && dimensions.access === 'verified' && dimensions.integrity === 'valid' && dimensions.agreement === 'agreed'
  const level: TruthConfidence = allHighDimensions && usable.length > 0 && !criticalUnknown && !stale ? 'high' : usable.length === 0 ? 'unknown' : integrityFailed || dimensions.access === 'blocked' || dimensions.coverage === 'missing' ? 'low' : 'medium'
  const preventedHigherState = level === 'high' ? null : level === 'unknown' ? 'current truth cannot be asserted without valid, current evidence' : 'high confidence is prevented until all dimensions are current, complete, verified, valid, and agreed'
  const result: TruthConfidenceEvaluation = {
    level, dimensions,
    meaning: `Truth Confidence is ${level}; it describes trust in FORGE's current understanding, not application health.`,
    why: reasons.length > 0 ? reasons.join('; ') : 'all required evidence dimensions are satisfied',
    impact: level === 'high' ? 'Current conclusions may be used within the declared observation boundary.' : 'Claims must remain bounded by the listed unknowns, blockers, and evidence freshness.',
    evidenceIds, unknowns, blockers: derivedBlockers, preventedHigherState,
    recommendedNextStep: level === 'high' ? null : { id: 'improve-truth-confidence', action: 'Collect or refresh evidence for the limiting dimensions before making a stronger claim.', reason: reasons.join('; ') || 'the current evidence set is insufficient for a higher level', priority: 'next', evidenceIds, unknownIds: unknowns.map(item => item.id), blockerIds: derivedBlockers.map(item => item.id) },
  }
  return validateExplainableState(result) as TruthConfidenceEvaluation
}
