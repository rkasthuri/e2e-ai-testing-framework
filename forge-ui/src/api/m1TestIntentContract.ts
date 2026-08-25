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

export const M1_REFUSAL_CODES = [
  'insufficient_evidence',
  'ambiguous_evidence',
  'unsupported_semantics',
  'app_area_unknown',
] as const

export type M1RefusalCode = typeof M1_REFUSAL_CODES[number]

export interface DiscoveredAppArea {
  /** Persisted App Model PageDefinition.module. Null is never promoted or inferred. */
  appArea: string | null
  sourceSubjectId: string | null
  observedRoute: string | null
  evidenceSummary: string
  confidence: 'high' | 'medium' | 'unknown'
  availability: 'available' | 'app_area_unknown'
  refusal: RefusedNormalizedTestIntentV1 | null
}

export interface NormalizedIntentAppAreaV1 {
  id: string
  sourceSubjectId: string
  confidence: 'high' | 'medium'
  method: 'rule' | 'ai' | 'manual'
  evidenceIds: readonly string[]
}

export interface NormalizedIntentSubjectSupportV1 {
  canonicalSubjectId: string
  supportingObservationIds: readonly string[]
  supportingGapIds: readonly string[]
}

export type NormalizedIntentPreconditionV1 = {
  kind: 'authenticated_role'
  roleId: string
  mechanism: string
}

export type NormalizedIntentStepV1 =
  | { stepId: string; ordinal: 0; kind: 'navigate_to_observed_route'; subjectId: string; routePath: string }
  | { stepId: string; ordinal: 1; kind: 'click_observed_data_test'; subjectId: string; elementId: string; dataTestValue: string; targetSubjectId: string }

export interface NormalizedIntentExpectedOutcomeV1 {
  outcomeId: string
  kind: 'subject_observable'
  subjectId: string
  routePath: string
}

interface NormalizedTestIntentBaseV1 {
  schemaVersion: 'forge-normalized-test-intent/v1'
  intentId: string
  projectId: string
  source: 'discovered'
  title: string
  objective: string
}

export interface SupportedNormalizedTestIntentV1 extends NormalizedTestIntentBaseV1 {
  appArea: NormalizedIntentAppAreaV1
  preconditions: readonly NormalizedIntentPreconditionV1[]
  steps: readonly NormalizedIntentStepV1[]
  expectedOutcomes: readonly [NormalizedIntentExpectedOutcomeV1]
  grounding: {
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    sourceFlowId: string
    selectedFlowStepIndexes: readonly [number]
    excludedFlowStepIndexes: readonly number[]
    subjectSupport: readonly NormalizedIntentSubjectSupportV1[]
  }
  evidenceAssessment: {
    state: 'sufficient'
    sourceFlowConfidence: 'observed' | 'partial'
    selectedStepGrounding: 'observed'
    limitations: readonly string[]
  }
  disposition: { state: 'supported' }
}

export interface RefusedNormalizedTestIntentV1 extends NormalizedTestIntentBaseV1 {
  appArea: null
  preconditions: readonly []
  steps: readonly []
  expectedOutcomes: readonly []
  grounding: { sourceFlowId: string; selectedFlowStepIndexes: readonly number[] }
  evidenceAssessment: { state: 'insufficient' | 'ambiguous' | 'unsupported'; limitations: readonly string[] }
  disposition: { state: 'refused'; code: M1RefusalCode; safeMessage: string }
}

export type NormalizedTestIntentV1 = SupportedNormalizedTestIntentV1 | RefusedNormalizedTestIntentV1

export interface CanonicalDefinitionSaveResultV3 {
  schemaVersion: 3
  testSetId: string
  definitionId: string
  revision: number
}

export interface M1TestIntentAdapter {
  readonly mode: 'mock' | 'backend'
  listDiscoveredAreas(projectId: string): Promise<readonly DiscoveredAppArea[]>
  generate(projectId: string, appArea: string): Promise<NormalizedTestIntentV1>
  save(projectId: string, intent: SupportedNormalizedTestIntentV1): Promise<CanonicalDefinitionSaveResultV3>
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/
const SHA256 = /^[a-f0-9]{64}$/

function id(value: unknown): value is string { return typeof value === 'string' && SAFE_ID.test(value) }
function text(value: unknown, max = 2000): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function ids(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every(id) }
function canonicalIds(value: unknown, minimum = 0): value is readonly string[] {
  return ids(value) && value.length >= minimum && new Set(value).size === value.length
    && [...value].sort().every((item, index) => item === value[index])
}
function texts(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 50 && value.every(item => text(item, 500)) }
function indexes(value: unknown): value is readonly number[] { return Array.isArray(value) && value.every(item => Number.isSafeInteger(item) && item >= 0) && new Set(value).size === value.length }
function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
}

function isBase(value: unknown): value is NormalizedTestIntentBaseV1 {
  if (!exactKeys(value, ['schemaVersion', 'intentId', 'projectId', 'source', 'appArea', 'title', 'objective', 'preconditions', 'steps', 'expectedOutcomes', 'grounding', 'evidenceAssessment', 'disposition'])) return false
  const item = value as Partial<NormalizedTestIntentBaseV1>
  return item.schemaVersion === 'forge-normalized-test-intent/v1' && item.source === 'discovered'
    && id(item.intentId) && id(item.projectId) && text(item.title, 500) && text(item.objective, 500)
}

export function isSupportedNormalizedTestIntentV1(value: unknown): value is SupportedNormalizedTestIntentV1 {
  if (!isBase(value)) return false
  const intent = value as Partial<SupportedNormalizedTestIntentV1>
  const area = intent.appArea
  const grounding = intent.grounding
  const assessment = intent.evidenceAssessment
  if (!exactKeys(area, ['id', 'sourceSubjectId', 'confidence', 'method', 'evidenceIds'])
    || !id(area?.id) || !id(area.sourceSubjectId) || !['high', 'medium'].includes(area.confidence)
    || !['rule', 'ai', 'manual'].includes(area.method) || !canonicalIds(area.evidenceIds, 1)
    || !Array.isArray(intent.preconditions) || intent.preconditions.length > 1 || !Array.isArray(intent.steps) || intent.steps.length !== 2
    || !Array.isArray(intent.expectedOutcomes) || intent.expectedOutcomes.length !== 1
    || !exactKeys(intent.disposition, ['state']) || intent.disposition?.state !== 'supported') return false
  if (!intent.preconditions.every(item => exactKeys(item, ['kind', 'roleId', 'mechanism']) && item.kind === 'authenticated_role' && id(item.roleId) && id(item.mechanism))) return false
  const [navigate, click] = intent.steps
  if (!exactKeys(navigate, ['stepId', 'ordinal', 'kind', 'subjectId', 'routePath'])
    || navigate?.ordinal !== 0 || navigate.kind !== 'navigate_to_observed_route' || !id(navigate.stepId) || !id(navigate.subjectId) || !ROUTE.test(navigate.routePath)
    || !exactKeys(click, ['stepId', 'ordinal', 'kind', 'subjectId', 'elementId', 'dataTestValue', 'targetSubjectId'])
    || click?.ordinal !== 1 || click.kind !== 'click_observed_data_test' || !id(click.stepId) || click.stepId === navigate.stepId
    || !id(click.subjectId) || click.subjectId !== navigate.subjectId || !id(click.elementId) || !id(click.dataTestValue) || !id(click.targetSubjectId)) return false
  const outcome = intent.expectedOutcomes[0]
  if (!exactKeys(outcome, ['outcomeId', 'kind', 'subjectId', 'routePath']) || outcome?.kind !== 'subject_observable' || !id(outcome.outcomeId) || !id(outcome.subjectId) || !ROUTE.test(outcome.routePath)
    || outcome.subjectId !== click.targetSubjectId) return false
  if (!exactKeys(grounding, ['modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'sourceFlowId', 'selectedFlowStepIndexes', 'excludedFlowStepIndexes', 'subjectSupport'])
    || !grounding || !Number.isSafeInteger(grounding.modelRowId) || grounding.modelRowId < 1
    || !id(grounding.modelVersion) || !id(grounding.observationRunId) || !SHA256.test(grounding.supportSealHash)
    || !id(grounding.sourceFlowId) || !indexes(grounding.selectedFlowStepIndexes) || grounding.selectedFlowStepIndexes.length !== 1
    || !indexes(grounding.excludedFlowStepIndexes) || !Array.isArray(grounding.subjectSupport)
    || grounding.subjectSupport.length < 1 || grounding.subjectSupport.length > 2) return false
  const subjectIds = grounding.subjectSupport.map(item => item.canonicalSubjectId)
  return grounding.subjectSupport.every(item => exactKeys(item, ['canonicalSubjectId', 'supportingObservationIds', 'supportingGapIds'])
      && id(item.canonicalSubjectId) && canonicalIds(item.supportingObservationIds, 1) && canonicalIds(item.supportingGapIds))
    && canonicalIds(subjectIds, 1) && subjectIds.includes(navigate.subjectId) && subjectIds.includes(outcome.subjectId)
    && exactKeys(assessment, ['state', 'sourceFlowConfidence', 'selectedStepGrounding', 'limitations'])
    && !!assessment && assessment.state === 'sufficient' && ['observed', 'partial'].includes(assessment.sourceFlowConfidence)
    && assessment.selectedStepGrounding === 'observed' && texts(assessment.limitations)
}

export function isRefusedNormalizedTestIntentV1(value: unknown): value is RefusedNormalizedTestIntentV1 {
  if (!isBase(value)) return false
  const intent = value as Partial<RefusedNormalizedTestIntentV1>
  return intent.appArea === null && Array.isArray(intent.preconditions) && intent.preconditions.length === 0
    && Array.isArray(intent.steps) && intent.steps.length === 0 && Array.isArray(intent.expectedOutcomes) && intent.expectedOutcomes.length === 0
    && exactKeys(intent.grounding, ['sourceFlowId', 'selectedFlowStepIndexes']) && !!intent.grounding && id(intent.grounding.sourceFlowId) && indexes(intent.grounding.selectedFlowStepIndexes)
    && exactKeys(intent.evidenceAssessment, ['state', 'limitations']) && !!intent.evidenceAssessment && ['insufficient', 'ambiguous', 'unsupported'].includes(intent.evidenceAssessment.state)
    && texts(intent.evidenceAssessment.limitations) && intent.disposition?.state === 'refused'
    && exactKeys(intent.disposition, ['state', 'code', 'safeMessage'])
    && M1_REFUSAL_CODES.includes(intent.disposition.code) && text(intent.disposition.safeMessage)
}

export function isNormalizedTestIntentV1(value: unknown): value is NormalizedTestIntentV1 {
  return isSupportedNormalizedTestIntentV1(value) || isRefusedNormalizedTestIntentV1(value)
}

export function decodeDiscoveredAppAreas(value: unknown): readonly DiscoveredAppArea[] {
  if (!Array.isArray(value)) throw new Error('The discovered application-area response is malformed.')
  for (const item of value) {
    if (!exactKeys(item, ['appArea', 'sourceSubjectId', 'observedRoute', 'evidenceSummary', 'confidence', 'availability', 'refusal'])) {
      throw new Error('The discovered application-area response is malformed.')
    }
    const area = item as Partial<DiscoveredAppArea>
    if (!(area.appArea === null || id(area.appArea)) || !(area.sourceSubjectId === null || id(area.sourceSubjectId))
      || !(area.observedRoute === null || (typeof area.observedRoute === 'string' && ROUTE.test(area.observedRoute))) || !text(area.evidenceSummary)
      || !['high', 'medium', 'unknown'].includes(area.confidence ?? '')
      || !['available', 'app_area_unknown'].includes(area.availability ?? '')
      || !(area.refusal === null || isRefusedNormalizedTestIntentV1(area.refusal))) {
      throw new Error('The discovered application-area response is malformed.')
    }
  }
  return value as DiscoveredAppArea[]
}

export function decodeCanonicalDefinitionSaveResultV3(value: unknown): CanonicalDefinitionSaveResultV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The canonical v3 promotion response is malformed.')
  const result = value as Partial<CanonicalDefinitionSaveResultV3> & Record<string, unknown>
  const keys = Object.keys(result)
  if (keys.length !== 4 || !['schemaVersion', 'testSetId', 'definitionId', 'revision'].every(key => keys.includes(key))
    || result.schemaVersion !== 3 || !id(result.testSetId) || !id(result.definitionId)
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1) {
    throw new Error('The canonical v3 promotion response is malformed.')
  }
  return result as CanonicalDefinitionSaveResultV3
}

export function exactIntentContent(intent: SupportedNormalizedTestIntentV1): string { return JSON.stringify(intent) }
