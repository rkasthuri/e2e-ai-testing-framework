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
 * TD-UI-062C UI-neutral Truth Board read model.
 *
 * Pure projection over the TD-UI-062B domain contract. No UI, transport,
 * persistence, credential, AI, or engine dependencies are allowed here.
 */
import {
  evaluateTruthConfidence, validateEvidence, validateExplainableState,
  validateProjectIdentity,
  type BlockerRecord, type ConfidenceDimensions, type EvidenceId,
  type EvidenceRecord, type ExplainableState, type ProjectIdentity,
  type TruthConfidence, type TruthConfidenceEvaluation, type UnknownRecord,
} from './tdUi062b'

export const truthBoardSectionKeys = [
  'project-status', 'truth-confidence', 'crawl', 'app-model',
  'test-readiness', 'execution', 'results', 'insights',
] as const
export type TruthBoardSectionKey = typeof truthBoardSectionKeys[number]

const sectionLabels: Record<TruthBoardSectionKey, string> = {
  'project-status': 'Project Status', 'truth-confidence': 'Truth Confidence',
  crawl: 'Crawl', 'app-model': 'App Model', 'test-readiness': 'Test Readiness',
  execution: 'Execution', results: 'Results', insights: 'Insights',
}

export interface TruthBoardSection extends ExplainableState {
  key: TruthBoardSectionKey
  label: string
  confidence: TruthConfidence
}
export interface TruthBoardReadModel {
  project: ProjectIdentity
  asOf: string
  evidenceIds: EvidenceId[]
  truthConfidence: TruthConfidenceEvaluation
  sections: TruthBoardSection[]
}
export interface TruthBoardReadModelInput {
  project: ProjectIdentity
  evidence: EvidenceRecord[]
  confidenceDimensions: ConfidenceDimensions
  unknowns?: UnknownRecord[]
  blockers?: BlockerRecord[]
  sections?: Partial<Record<TruthBoardSectionKey, ExplainableState>>
  asOf?: string
}

function invalid(message: string): never {
  throw new Error(`Invalid TD-UI-062C read model input: ${message}`)
}

function unknownSection(key: TruthBoardSectionKey, evidenceIds: EvidenceId[], unknowns: UnknownRecord[], blockers: BlockerRecord[]): TruthBoardSection {
  const item: UnknownRecord = { id: `${key}-unknown`, subject: sectionLabels[key], reason: 'No section-specific evidence was supplied.', severity: 'material', evidenceIds: [] }
  return {
    key, label: sectionLabels[key], confidence: 'unknown', meaning: `${sectionLabels[key]} is unknown.`,
    why: 'No section-specific evidence was supplied.',
    impact: 'Claims about this area must remain bounded until evidence is collected.',
    evidenceIds, unknowns: [...unknowns, item], blockers,
    preventedHigherState: 'a current conclusion cannot be asserted without section-specific evidence',
    recommendedNextStep: { id: `${key}-collect-evidence`, action: `Collect current evidence for ${sectionLabels[key]}.`, reason: 'The section has no supporting evidence.', priority: 'next', evidenceIds: [], unknownIds: [...unknowns.map(value => value.id), item.id], blockerIds: blockers.map(value => value.id) },
  }
}

function validateReferences(state: ExplainableState, known: Set<EvidenceId>, location: string): void {
  validateExplainableState(state)
  const ids = [...state.evidenceIds, ...state.unknowns.flatMap(value => value.evidenceIds), ...state.blockers.flatMap(value => value.evidenceIds), ...(state.recommendedNextStep?.evidenceIds ?? [])]
  for (const id of ids) if (!known.has(id)) invalid(`${location} references evidence '${id}' that is not in the read model input`)
}

/** Build a deterministic, immutable Truth Board projection from domain data. */
export function buildTruthBoardReadModel(input: TruthBoardReadModelInput): TruthBoardReadModel {
  validateProjectIdentity(input.project)
  if (!Array.isArray(input.evidence)) invalid('evidence must be an array')
  const known = new Set<EvidenceId>()
  for (const item of input.evidence) {
    validateEvidence(item)
    if (item.projectId !== input.project.projectId) invalid(`evidence '${item.id}' belongs to another project`)
    if (known.has(item.id)) invalid(`evidence '${item.id}' is duplicated`)
    known.add(item.id)
  }
  const evidence = input.evidence.map(item => ({ ...item, provenance: { ...item.provenance } }))
  const evidenceIds = evidence.map(item => item.id)
  const unknowns = [...(input.unknowns ?? [])]
  const blockers = [...(input.blockers ?? [])]
  const truthConfidence = evaluateTruthConfidence(input.confidenceDimensions, evidence, unknowns, blockers)
  const projectStatus: ExplainableState = {
    meaning: `Project '${input.project.displayName}' is ${input.project.lifecycleState}.`,
    why: `The project lifecycle is currently '${input.project.lifecycleState}'.`,
    impact: 'This status describes FORGE project progress within the declared observation boundary.',
    evidenceIds, unknowns, blockers, preventedHigherState: null, recommendedNextStep: null,
  }
  validateReferences(projectStatus, known, 'project-status')
  const supplied = input.sections ?? {}
  const sections = truthBoardSectionKeys.map(key => {
    if (key === 'project-status') return { ...projectStatus, key, label: sectionLabels[key], confidence: truthConfidence.level }
    if (key === 'truth-confidence') return { ...truthConfidence, key, label: sectionLabels[key], confidence: truthConfidence.level }
    const state = supplied[key]
    if (!state) return unknownSection(key, evidenceIds, unknowns, blockers)
    validateReferences(state, known, `section '${key}'`)
    return { ...state, key, label: sectionLabels[key], confidence: truthConfidence.level }
  })
  const asOf = input.asOf ?? evidence.reduce((latest, item) => item.capturedAt > latest ? item.capturedAt : latest, input.project.updatedAt)
  if (Number.isNaN(Date.parse(asOf))) invalid('asOf must be an ISO date')
  return { project: { ...input.project }, asOf, evidenceIds: [...evidenceIds], truthConfidence: { ...truthConfidence, evidenceIds: [...truthConfidence.evidenceIds] }, sections }
}

export const createTruthBoardReadModel = buildTruthBoardReadModel
