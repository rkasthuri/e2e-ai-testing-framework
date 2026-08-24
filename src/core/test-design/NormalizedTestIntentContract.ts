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
import type { AppModel } from '../onboarding/types'
import type { AuthenticationExpectationProjection } from './AuthenticationExpectationProjection'
import type { CanonicalRouteEvidence } from './CanonicalRouteEvidenceProjection'
import type {
  CanonicalSubjectAuthority,
  CanonicalTestDefinitionAuthority,
} from './TestDefinitionAuthorityProjectionService'

export type NormalizedTestIntentSource = 'discovered' | 'manual' | 'natural-language'

export const NORMALIZED_TEST_INTENT_REFUSAL_CODES = Object.freeze([
  'insufficient_evidence',
  'ambiguous_evidence',
  'unsupported_semantics',
  'app_area_unknown',
] as const)

export type NormalizedTestIntentRefusalCode = typeof NORMALIZED_TEST_INTENT_REFUSAL_CODES[number]

type NormalizedTestIntentRefusalDiagnostic =
  | 'missing_flow'
  | 'ambiguous_flow'
  | 'invalid_segment'
  | 'insufficient_evidence'
  | 'unsupported_semantics'
  | 'missing_subject_support'
  | 'route_unknown'
  | 'authentication_unknown'
  | 'authentication_conflicted'
  | 'authentication_not_established'
  | 'app_area_unknown'
  | 'app_area_ambiguous'
  | 'missing_element'
  | 'ambiguous_element'
  | 'unsupported_locator'
  | 'ambiguous_locator'
  | 'project_mismatch'

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
  | {
      stepId: string
      ordinal: 0
      kind: 'navigate_to_observed_route'
      subjectId: string
      routePath: string
    }
  | {
      stepId: string
      ordinal: 1
      kind: 'click_observed_data_test'
      subjectId: string
      elementId: string
      dataTestValue: string
      targetSubjectId: string
    }

export interface NormalizedIntentExpectedOutcomeV1 {
  outcomeId: string
  kind: 'subject_observable'
  subjectId: string
  routePath: string
}

export interface SupportedNormalizedTestIntentV1 {
  schemaVersion: 'forge-normalized-test-intent/v1'
  intentId: string
  projectId: string
  source: NormalizedTestIntentSource
  appArea: NormalizedIntentAppAreaV1
  title: string
  objective: string
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

export interface RefusedNormalizedTestIntentV1 {
  schemaVersion: 'forge-normalized-test-intent/v1'
  intentId: string
  projectId: string
  source: 'discovered'
  appArea: null
  title: string
  objective: string
  preconditions: readonly []
  steps: readonly []
  expectedOutcomes: readonly []
  grounding: {
    sourceFlowId: string
    selectedFlowStepIndexes: readonly number[]
  }
  evidenceAssessment: {
    state: 'insufficient' | 'ambiguous' | 'unsupported'
    limitations: readonly string[]
  }
  disposition: {
    state: 'refused'
    code: NormalizedTestIntentRefusalCode
    safeMessage: string
  }
}

export type NormalizedTestIntentV1 = SupportedNormalizedTestIntentV1 | RefusedNormalizedTestIntentV1

export interface MaterializedNormalizedTestIntentV1 {
  value: SupportedNormalizedTestIntentV1
  json: string
  fingerprint: string
}

export interface DiscoveredIntentSelectionV1 {
  flowId: string
  selectedFlowStepIndexes: readonly number[]
}

export interface DiscoveredIntentNormalizationInputV1 {
  projectId: string
  model: AppModel
  authority: CanonicalTestDefinitionAuthority
  routeEvidence: CanonicalRouteEvidence
  authenticationExpectation: AuthenticationExpectationProjection
  selection: DiscoveredIntentSelectionV1
}

export type DiscoveredIntentNormalizationResultV1 =
  | { kind: 'supported'; materialized: MaterializedNormalizedTestIntentV1 }
  | { kind: 'refused'; intent: RefusedNormalizedTestIntentV1 }

export class NormalizedTestIntentContractError extends Error {
  constructor() {
    super('The normalized test intent is malformed.')
    this.name = 'NormalizedTestIntentContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/
const SHA256 = /^[a-f0-9]{64}$/
const DATA_TEST = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

interface RefusalDiagnosticMapping {
  publicCode: NormalizedTestIntentRefusalCode
  evidenceState: 'insufficient' | 'ambiguous' | 'unsupported'
  safeMessage: string
}

const REFUSAL_DIAGNOSTICS: Readonly<Record<NormalizedTestIntentRefusalDiagnostic, RefusalDiagnosticMapping>> = Object.freeze({
  missing_flow: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The selected App Model flow does not exist.',
  },
  ambiguous_flow: {
    publicCode: 'ambiguous_evidence', evidenceState: 'ambiguous', safeMessage: 'The selected App Model flow identity is not unique.',
  },
  invalid_segment: {
    publicCode: 'unsupported_semantics', evidenceState: 'unsupported', safeMessage: 'The selected flow segment is malformed or outside the supported M1 shape.',
  },
  insufficient_evidence: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'Every selected action must be directly observed in the canonical App Model flow.',
  },
  unsupported_semantics: {
    publicCode: 'unsupported_semantics', evidenceState: 'unsupported', safeMessage: 'The selected flow segment contains semantics outside the bounded M1 action set.',
  },
  missing_subject_support: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The selected flow subjects do not have exact sealed canonical support.',
  },
  route_unknown: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The selected flow subjects do not have exact governed route evidence.',
  },
  authentication_unknown: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'Authentication expectation is unknown.',
  },
  authentication_conflicted: {
    publicCode: 'ambiguous_evidence', evidenceState: 'ambiguous', safeMessage: 'Authentication expectation is conflicted.',
  },
  authentication_not_established: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The selected role does not carry established authentication evidence.',
  },
  app_area_unknown: {
    publicCode: 'app_area_unknown', evidenceState: 'insufficient', safeMessage: 'The selected source subject has no persisted canonical App Model classification.',
  },
  app_area_ambiguous: {
    publicCode: 'app_area_unknown', evidenceState: 'ambiguous', safeMessage: 'The persisted App Model classification is ambiguous.',
  },
  missing_element: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The selected observed element is unavailable on its source subject.',
  },
  ambiguous_element: {
    publicCode: 'ambiguous_evidence', evidenceState: 'ambiguous', safeMessage: 'The selected observed element identity is not unique or is not single-cardinality and visible.',
  },
  unsupported_locator: {
    publicCode: 'unsupported_semantics', evidenceState: 'unsupported', safeMessage: 'The selected element has no bounded observed data-test locator.',
  },
  ambiguous_locator: {
    publicCode: 'ambiguous_evidence', evidenceState: 'ambiguous', safeMessage: 'The selected element has more than one observed data-test locator.',
  },
  project_mismatch: {
    publicCode: 'insufficient_evidence', evidenceState: 'insufficient', safeMessage: 'The App Model, route evidence, and sealed authority do not belong to one project identity.',
  },
})

function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)}`
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new NormalizedTestIntentContractError()
  }
}

function assertText(value: unknown, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new NormalizedTestIntentContractError()
}

function assertCanonicalIds(value: unknown, minimum = 0): asserts value is string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || !ID.test(item))) {
    throw new NormalizedTestIntentContractError()
  }
  if (new Set(value).size !== value.length || [...value].sort().some((item, index) => item !== value[index])) {
    throw new NormalizedTestIntentContractError()
  }
}

function assertLimitations(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 50) throw new NormalizedTestIntentContractError()
  for (const item of value) assertText(item)
}

export function validateSupportedNormalizedTestIntentV1(value: SupportedNormalizedTestIntentV1): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NormalizedTestIntentContractError()
  exactKeys(value as unknown as Record<string, unknown>, [
    'schemaVersion', 'intentId', 'projectId', 'source', 'appArea', 'title', 'objective',
    'preconditions', 'steps', 'expectedOutcomes', 'grounding', 'evidenceAssessment', 'disposition',
  ])
  if (value.schemaVersion !== 'forge-normalized-test-intent/v1' || !ID.test(value.intentId)
    || !ID.test(value.projectId) || !['discovered', 'manual', 'natural-language'].includes(value.source)) {
    throw new NormalizedTestIntentContractError()
  }
  assertText(value.title)
  assertText(value.objective)
  const area = value.appArea
  exactKeys(area as unknown as Record<string, unknown>, ['id', 'sourceSubjectId', 'confidence', 'method', 'evidenceIds'])
  if (!ID.test(area.id) || !ID.test(area.sourceSubjectId) || !['high', 'medium'].includes(area.confidence)
    || !['rule', 'ai', 'manual'].includes(area.method)) throw new NormalizedTestIntentContractError()
  assertCanonicalIds(area.evidenceIds, 1)

  if (!Array.isArray(value.preconditions) || value.preconditions.length > 1) throw new NormalizedTestIntentContractError()
  if (value.preconditions.length === 1) {
    const precondition = value.preconditions[0]
    exactKeys(precondition as unknown as Record<string, unknown>, ['kind', 'roleId', 'mechanism'])
    if (precondition.kind !== 'authenticated_role' || !ID.test(precondition.roleId) || !ID.test(precondition.mechanism)) {
      throw new NormalizedTestIntentContractError()
    }
  }
  if (!Array.isArray(value.steps) || value.steps.length !== 2) throw new NormalizedTestIntentContractError()
  const [navigate, click] = value.steps
  exactKeys(navigate as unknown as Record<string, unknown>, ['stepId', 'ordinal', 'kind', 'subjectId', 'routePath'])
  if (!ID.test(navigate.stepId) || navigate.ordinal !== 0 || navigate.kind !== 'navigate_to_observed_route'
    || !ID.test(navigate.subjectId) || !ROUTE.test(navigate.routePath)) throw new NormalizedTestIntentContractError()
  exactKeys(click as unknown as Record<string, unknown>, ['stepId', 'ordinal', 'kind', 'subjectId', 'elementId', 'dataTestValue', 'targetSubjectId'])
  if (!ID.test(click.stepId) || click.ordinal !== 1 || click.kind !== 'click_observed_data_test'
    || click.subjectId !== navigate.subjectId || !ID.test(click.elementId) || !DATA_TEST.test(click.dataTestValue)
    || !ID.test(click.targetSubjectId) || navigate.stepId === click.stepId) throw new NormalizedTestIntentContractError()

  if (!Array.isArray(value.expectedOutcomes) || value.expectedOutcomes.length !== 1) throw new NormalizedTestIntentContractError()
  const outcome = value.expectedOutcomes[0]
  exactKeys(outcome as unknown as Record<string, unknown>, ['outcomeId', 'kind', 'subjectId', 'routePath'])
  if (!ID.test(outcome.outcomeId) || outcome.kind !== 'subject_observable' || !ID.test(outcome.subjectId)
    || !ROUTE.test(outcome.routePath) || outcome.subjectId !== click.targetSubjectId) throw new NormalizedTestIntentContractError()

  const grounding = value.grounding
  exactKeys(grounding as unknown as Record<string, unknown>, [
    'modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'sourceFlowId',
    'selectedFlowStepIndexes', 'excludedFlowStepIndexes', 'subjectSupport',
  ])
  if (!Number.isSafeInteger(grounding.modelRowId) || grounding.modelRowId < 1 || !ID.test(grounding.modelVersion)
    || !ID.test(grounding.observationRunId) || !SHA256.test(grounding.supportSealHash) || !ID.test(grounding.sourceFlowId)
    || !Array.isArray(grounding.selectedFlowStepIndexes) || grounding.selectedFlowStepIndexes.length !== 1
    || !Number.isSafeInteger(grounding.selectedFlowStepIndexes[0]) || grounding.selectedFlowStepIndexes[0] < 0
    || !Array.isArray(grounding.excludedFlowStepIndexes)
    || grounding.excludedFlowStepIndexes.some(index => !Number.isSafeInteger(index) || index < 0)
    || new Set(grounding.excludedFlowStepIndexes).size !== grounding.excludedFlowStepIndexes.length) {
    throw new NormalizedTestIntentContractError()
  }
  if (!Array.isArray(grounding.subjectSupport) || grounding.subjectSupport.length < 1 || grounding.subjectSupport.length > 2) {
    throw new NormalizedTestIntentContractError()
  }
  const subjectIds: string[] = []
  for (const support of grounding.subjectSupport) {
    exactKeys(support as unknown as Record<string, unknown>, ['canonicalSubjectId', 'supportingObservationIds', 'supportingGapIds'])
    if (!ID.test(support.canonicalSubjectId)) throw new NormalizedTestIntentContractError()
    assertCanonicalIds(support.supportingObservationIds, 1)
    assertCanonicalIds(support.supportingGapIds)
    subjectIds.push(support.canonicalSubjectId)
  }
  assertCanonicalIds(subjectIds, 1)
  if (!subjectIds.includes(navigate.subjectId) || !subjectIds.includes(outcome.subjectId)) {
    throw new NormalizedTestIntentContractError()
  }

  const assessment = value.evidenceAssessment
  exactKeys(assessment as unknown as Record<string, unknown>, ['state', 'sourceFlowConfidence', 'selectedStepGrounding', 'limitations'])
  if (assessment.state !== 'sufficient' || !['observed', 'partial'].includes(assessment.sourceFlowConfidence)
    || assessment.selectedStepGrounding !== 'observed') throw new NormalizedTestIntentContractError()
  assertLimitations(assessment.limitations)
  exactKeys(value.disposition as unknown as Record<string, unknown>, ['state'])
  if (value.disposition.state !== 'supported') throw new NormalizedTestIntentContractError()
}

export function materializeSupportedNormalizedTestIntentV1(
  value: SupportedNormalizedTestIntentV1,
): MaterializedNormalizedTestIntentV1 {
  validateSupportedNormalizedTestIntentV1(value)
  const canonicalJson = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonicalJson).join(',')}]`
    if (item && typeof item === 'object') {
      return `{${Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
    }
    return JSON.stringify(item)
  }
  const json = canonicalJson(value)
  const reparsed = JSON.parse(json) as SupportedNormalizedTestIntentV1
  validateSupportedNormalizedTestIntentV1(reparsed)
  return { value: reparsed, json, fingerprint: crypto.createHash('sha256').update(json).digest('hex') }
}

function refusalState(code: NormalizedTestIntentRefusalCode): 'insufficient' | 'ambiguous' | 'unsupported' {
  if (code === 'ambiguous_evidence') return 'ambiguous'
  if (code === 'unsupported_semantics') return 'unsupported'
  return 'insufficient'
}

function buildRefusedNormalizedTestIntentV1(
  projectId: string,
  selection: DiscoveredIntentSelectionV1,
  code: NormalizedTestIntentRefusalCode,
  evidenceState: 'insufficient' | 'ambiguous' | 'unsupported',
  message: string,
): RefusedNormalizedTestIntentV1 {
  const safeProject = ID.test(projectId) ? projectId : 'invalid-project'
  const safeFlow = ID.test(selection.flowId) ? selection.flowId : 'invalid-flow'
  const indexes = Array.isArray(selection.selectedFlowStepIndexes)
    ? selection.selectedFlowStepIndexes.filter(index => Number.isSafeInteger(index) && index >= 0)
    : []
  return {
    schemaVersion: 'forge-normalized-test-intent/v1',
    intentId: stableId('intent-v1', safeProject, safeFlow, ...indexes),
    projectId: safeProject,
    source: 'discovered',
    appArea: null,
    title: `Discovered flow ${safeFlow}`,
    objective: 'Normalize only directly observed, supported application behavior.',
    preconditions: [],
    steps: [],
    expectedOutcomes: [],
    grounding: { sourceFlowId: safeFlow, selectedFlowStepIndexes: indexes },
    evidenceAssessment: { state: evidenceState, limitations: [message] },
    disposition: { state: 'refused', code, safeMessage: message },
  }
}

export function refusedNormalizedTestIntentV1(
  projectId: string,
  selection: DiscoveredIntentSelectionV1,
  code: NormalizedTestIntentRefusalCode,
): RefusedNormalizedTestIntentV1 {
  if (!(NORMALIZED_TEST_INTENT_REFUSAL_CODES as readonly unknown[]).includes(code)) {
    throw new NormalizedTestIntentContractError()
  }
  const message = code === 'insufficient_evidence'
    ? 'Canonical evidence is insufficient to construct the selected observed flow.'
    : code === 'ambiguous_evidence'
      ? 'Canonical evidence is ambiguous for the selected observed flow.'
      : code === 'unsupported_semantics'
        ? 'The selected flow requires semantics outside the bounded M1 action set.'
        : 'The selected source subject has no unambiguous persisted canonical App Model classification.'
  return buildRefusedNormalizedTestIntentV1(projectId, selection, code, refusalState(code), message)
}

function refuse(
  input: Pick<DiscoveredIntentNormalizationInputV1, 'projectId' | 'selection'>,
  diagnostic: NormalizedTestIntentRefusalDiagnostic,
): DiscoveredIntentNormalizationResultV1 {
  const mapping = REFUSAL_DIAGNOSTICS[diagnostic]
  return {
    kind: 'refused',
    intent: buildRefusedNormalizedTestIntentV1(
      input.projectId,
      input.selection,
      mapping.publicCode,
      mapping.evidenceState,
      mapping.safeMessage,
    ),
  }
}

function exactSubjectSupport(
  subject: CanonicalSubjectAuthority | undefined,
): NormalizedIntentSubjectSupportV1 | null {
  if (!subject || subject.supportingObservationIds.length === 0) return null
  return {
    canonicalSubjectId: subject.canonicalSubjectId,
    supportingObservationIds: [...subject.supportingObservationIds],
    supportingGapIds: [...subject.supportingGapIds],
  }
}

/**
 * The only M1 discovered producer. It accepts exactly one observed click edge
 * and supplies its entry navigation and final oracle from governed route
 * evidence. Excluded flow steps remain limitations and never become actions.
 */
export function normalizeDiscoveredIntentV1(
  input: DiscoveredIntentNormalizationInputV1,
): DiscoveredIntentNormalizationResultV1 {
  const { projectId, model, authority, routeEvidence, authenticationExpectation, selection } = input
  if (!ID.test(projectId) || model.app.name !== projectId || authority.projectId !== projectId
    || routeEvidence.projectId !== projectId || authority.modelRowId !== routeEvidence.modelRowId
    || authority.modelVersion !== model.app.modelVersion
    || authority.supportSealHash !== routeEvidence.supportSealHash) return refuse(input, 'project_mismatch')
  if (!ID.test(selection.flowId) || !Array.isArray(selection.selectedFlowStepIndexes)
    || selection.selectedFlowStepIndexes.length !== 1 || !Number.isSafeInteger(selection.selectedFlowStepIndexes[0])
    || selection.selectedFlowStepIndexes[0] < 0) return refuse(input, 'invalid_segment')

  const flows = (model.flows ?? []).filter(flow => flow.id === selection.flowId)
  if (flows.length === 0) return refuse(input, 'missing_flow')
  if (flows.length !== 1) return refuse(input, 'ambiguous_flow')
  const flow = flows[0]
  if (flow.confidence !== 'observed' && flow.confidence !== 'partial') return refuse(input, 'insufficient_evidence')
  const selectedIndex = selection.selectedFlowStepIndexes[0]
  const selected = flow.steps.filter(step => step.stepIndex === selectedIndex)
  if (selected.length !== 1) return refuse(input, selected.length === 0 ? 'invalid_segment' : 'ambiguous_flow')
  const step = selected[0]
  if (step.grounding !== 'observed') return refuse(input, 'insufficient_evidence')
  if (step.action !== 'click' || !step.pageId || !step.targetPageId || !step.elementId || step.value !== null) {
    return refuse(input, 'unsupported_semantics')
  }

  const sourcePages = (model.pages ?? []).filter(page => page.id === step.pageId)
  const targetPages = (model.pages ?? []).filter(page => page.id === step.targetPageId)
  if (sourcePages.length !== 1 || targetPages.length !== 1) return refuse(input, 'missing_subject_support')
  const sourcePage = sourcePages[0]
  const targetPage = targetPages[0]
  if (sourcePage.id === targetPage.id) return refuse(input, 'unsupported_semantics')
  const area = sourcePage.module
  if (!area || !area.name || area.confidence === 'unknown' || area.method === 'unknown') return refuse(input, 'app_area_unknown')
  if (area.confidence === 'low') return refuse(input, 'app_area_ambiguous')
  if (!ID.test(area.name) || !area.evidenceIds.includes(sourcePage.id)) return refuse(input, 'app_area_unknown')

  const elements = sourcePage.elements.filter(element => element.id === step.elementId)
  if (elements.length === 0) return refuse(input, 'missing_element')
  if (elements.length !== 1 || elements[0].cardinality?.kind !== 'single' || elements[0].observedState !== 'visible') {
    return refuse(input, 'ambiguous_element')
  }
  const dataTests = elements[0].strategies.filter(strategy => strategy.type === 'data-test')
  if (dataTests.length === 0 || !DATA_TEST.test(dataTests[0].value)) return refuse(input, 'unsupported_locator')
  if (dataTests.length !== 1) return refuse(input, 'ambiguous_locator')

  const sourceRoute = routeEvidence.subjects.find(subject => subject.canonicalSubjectId === sourcePage.id)
  const targetRoute = routeEvidence.subjects.find(subject => subject.canonicalSubjectId === targetPage.id)
  if (!sourceRoute || !targetRoute) return refuse(input, 'route_unknown')
  const subjectSupport = [sourcePage.id, targetPage.id].sort().map(subjectId =>
    exactSubjectSupport(authority.subjectSupport.find(subject => subject.canonicalSubjectId === subjectId)))
  if (subjectSupport.some(item => item === null)) return refuse(input, 'missing_subject_support')

  if (authenticationExpectation.state === 'unknown') return refuse(input, 'authentication_unknown')
  if (authenticationExpectation.state === 'conflicted') return refuse(input, 'authentication_conflicted')
  const role = model.roles.find(item => item.id === flow.roleId)
  if (authenticationExpectation.state === 'required'
    && (!role || role.authOutcome !== 'succeeded' || role.authFlow !== authenticationExpectation.mechanism)) {
    return refuse(input, 'authentication_not_established')
  }

  const excluded = flow.steps.map(item => item.stepIndex).filter(index => index !== selectedIndex)
  const limitations = excluded.length === 0
    ? []
    : [`Source flow steps ${excluded.join(', ')} were excluded and are not executable M1 semantics.`]
  if (flow.confidence === 'partial') {
    limitations.push('The source flow is partial; only the directly observed selected transition is runnable.')
  }
  const intentId = stableId('intent-v1', projectId, authority.supportSealHash, flow.id, selectedIndex)
  const title = `${flow.displayName}: ${sourcePage.displayName} to ${targetPage.displayName}`
  const value: SupportedNormalizedTestIntentV1 = {
    schemaVersion: 'forge-normalized-test-intent/v1',
    intentId,
    projectId,
    source: 'discovered',
    appArea: {
      id: area.name,
      sourceSubjectId: sourcePage.id,
      confidence: area.confidence,
      method: area.method,
      evidenceIds: [...area.evidenceIds].sort(),
    },
    title,
    objective: `Reach ${targetPage.id} through the directly observed ${elements[0].id} interaction.`,
    preconditions: authenticationExpectation.state === 'required'
      ? [{ kind: 'authenticated_role', roleId: flow.roleId, mechanism: authenticationExpectation.mechanism! }]
      : [],
    steps: [
      {
        stepId: stableId('intent-step', intentId, 0, 'navigate'),
        ordinal: 0,
        kind: 'navigate_to_observed_route',
        subjectId: sourcePage.id,
        routePath: sourceRoute.normalizedPath,
      },
      {
        stepId: stableId('intent-step', intentId, 1, 'click'),
        ordinal: 1,
        kind: 'click_observed_data_test',
        subjectId: sourcePage.id,
        elementId: elements[0].id,
        dataTestValue: dataTests[0].value,
        targetSubjectId: targetPage.id,
      },
    ],
    expectedOutcomes: [{
      outcomeId: stableId('intent-outcome', intentId, targetPage.id),
      kind: 'subject_observable',
      subjectId: targetPage.id,
      routePath: targetRoute.normalizedPath,
    }],
    grounding: {
      modelRowId: authority.modelRowId,
      modelVersion: authority.modelVersion,
      observationRunId: authority.observationRunId,
      supportSealHash: authority.supportSealHash,
      sourceFlowId: flow.id,
      selectedFlowStepIndexes: [selectedIndex],
      excludedFlowStepIndexes: excluded,
      subjectSupport: subjectSupport as NormalizedIntentSubjectSupportV1[],
    },
    evidenceAssessment: {
      state: 'sufficient',
      sourceFlowConfidence: flow.confidence,
      selectedStepGrounding: 'observed',
      limitations,
    },
    disposition: { state: 'supported' },
  }
  return { kind: 'supported', materialized: materializeSupportedNormalizedTestIntentV1(value) }
}
