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

export const M3_MANUAL_REFUSAL_CODES = [
  'insufficient_evidence',
  'ambiguous_evidence',
  'unsupported_semantics',
  'app_area_unknown',
] as const

export const M3_PROMOTION_ERROR_CODES = [
  'SOURCE_PROPOSAL_MISMATCH',
  'MANUAL_PROMOTION_IDENTITY_CONFLICT',
  'STALE_REVIEWED_PROPOSAL',
  'MANUAL_PROPOSAL_NOT_EXECUTABLE',
] as const

export type M3ManualRefusalCode = typeof M3_MANUAL_REFUSAL_CODES[number]
export type M3PromotionErrorCode = typeof M3_PROMOTION_ERROR_CODES[number]

export interface M3ManualDraft {
  title: string
  objective: string
  steps: readonly string[]
  expectedOutcome: string
}

export interface ManualTestAnalyzeRequestDto {
  schemaVersion: 'forge-manual-test-source-input/v1'
  sourceKind: 'manual'
  title: string
  objective: string | null
  steps: Array<{ ordinal: number; text: string }>
  expectedOutcome: string
}

export interface ManualSourceAuthority {
  sourceId: string
  sourceContentHash: string
}

export interface ManualProposalAuthority {
  proposalId: string
  proposalContentHash: string
}

export interface ManualDefinitionAuthority {
  definitionId: string
  definitionSchemaVersion: 3
  testSetId: string
  testSetRevision: number
  testSetContentHash: string
}

export interface ManualTestSourceV1 {
  schemaVersion: 'forge-manual-test-source/v1'
  sourceId: string
  projectId: string
  sourceKind: 'manual'
  title: string
  objective: string | null
  steps: ReadonlyArray<{ ordinal: number; text: string }>
  expectedOutcome: string
  contentHash: string
}

export interface ManualAppAreaV1 {
  id: string
  sourceSubjectId: string
  confidence: 'high' | 'medium'
  method: string
  evidenceIds: readonly string[]
}

export type ManualCanonicalActionV1 =
  | { stepId: string; ordinal: 0; kind: 'navigate_to_observed_route'; subjectId: string; routePath: string }
  | { stepId: string; ordinal: 1; kind: 'click_observed_data_test'; subjectId: string; elementId: string; dataTestValue: string; targetSubjectId: string }

export type ManualSourceRefV1 = { kind: 'step'; ordinal: number } | { kind: 'expected_outcome' }
export type ManualCanonicalBindingV1 = { kind: 'action'; ordinal: 0 | 1 } | { kind: 'oracle'; oracleKind: 'subject_observable' }
export type ManualGroundingBasisV1 =
  | { kind: 'governed_route'; flowStepIndex: null; evidenceIds: readonly string[] }
  | { kind: 'observed_flow_step'; flowStepIndex: number; evidenceIds: readonly string[] }
  | { kind: 'governed_subject'; flowStepIndex: null; evidenceIds: readonly string[] }

export interface ManualSourceGroundingV1 {
  sourceRef: ManualSourceRefV1
  status: 'grounded' | 'insufficient_evidence' | 'ambiguous_evidence' | 'unsupported_semantics'
  canonicalBinding: ManualCanonicalBindingV1 | null
  basis: ManualGroundingBasisV1
}

export interface SupportedManualNormalizedIntentV1 {
  schemaVersion: 'forge-normalized-test-intent/v1'
  intentId: string
  projectId: string
  source: 'manual'
  appArea: ManualAppAreaV1
  title: string
  objective: string
  preconditions: ReadonlyArray<{ kind: 'authenticated_role'; roleId: string; mechanism: string }>
  steps: readonly ManualCanonicalActionV1[]
  expectedOutcomes: readonly [{ outcomeId: string; kind: 'subject_observable'; subjectId: string; routePath: string }]
  grounding: {
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    sourceFlowId: string
    selectedFlowStepIndexes: readonly [number]
    excludedFlowStepIndexes: readonly number[]
    subjectSupport: ReadonlyArray<{
      canonicalSubjectId: string
      supportingObservationIds: readonly string[]
      supportingGapIds: readonly string[]
    }>
  }
  evidenceAssessment: {
    state: 'sufficient'
    sourceFlowConfidence: 'observed' | 'partial'
    selectedStepGrounding: 'observed'
    limitations: readonly string[]
  }
  disposition: { state: 'supported' }
}

export interface ManualAutomationProposalV1 {
  schemaVersion: 'forge-manual-automation-proposal/v1'
  proposalId: string
  projectId: string
  sourceAuthority: ManualSourceAuthority
  authority: {
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    routeEvidenceIdentityHash: string
    authenticationExpectationIdentityHash: string
  }
  appArea: ManualAppAreaV1
  normalizedIntent: SupportedManualNormalizedIntentV1
  normalizedIntentContentHash: string
  sourceGrounding: readonly ManualSourceGroundingV1[]
  canonicalActions: readonly ManualCanonicalActionV1[]
  oracle: {
    kind: 'subject_observable'
    subjectId: string
    routePath: string
    supportingObservationIds: readonly string[]
    explanation: string
  }
  authenticationExpectation: {
    schemaVersion: 'forge-authentication-expectation/v1'
    state: 'required' | 'not_required' | 'unknown' | 'conflicted'
    mechanism: string | null
    bases: ReadonlyArray<{
      kind: 'declared_configuration'
      policyId: string
      policyVersion: string
      configurationDigest: string
      mechanism: string | null
    }>
    identityHash: string
  }
  limitations: readonly string[]
  disposition: { state: 'supported' }
  proposalContentHash: string
}

export interface ManualAutomationRefusalV1 {
  schemaVersion: 'forge-manual-automation-refusal/v1'
  projectId: string
  sourceAuthority: ManualSourceAuthority
  code: M3ManualRefusalCode
  evidenceState: 'insufficient' | 'ambiguous' | 'unsupported'
  safeMessage: string
  sourceGrounding: readonly ManualSourceGroundingV1[]
  limitations: readonly string[]
}

export type ManualAnalysisResultV1 = {
  schemaVersion: 'forge-manual-analysis-result/v1'
  outcome:
    | { kind: 'proposal'; proposal: ManualAutomationProposalV1 }
    | { kind: 'refusal'; refusal: ManualAutomationRefusalV1 }
}

export interface ManualTestSaveRequestDto {
  schemaVersion: 'forge-manual-promotion-request/v1'
  sourceAuthority: ManualSourceAuthority
  reviewedProposalAuthority: ManualProposalAuthority
}

export type ManualPromotionRequestV1 = ManualTestSaveRequestDto

export interface ManualPromotionResultV1 {
  schemaVersion: 'forge-manual-promotion-result/v1'
  outcome: 'promoted'
  sourceAuthority: ManualSourceAuthority
  proposalAuthority: ManualProposalAuthority
  definitionAuthority: ManualDefinitionAuthority
}

export type ManualTestSaveResponseDto = ManualPromotionResultV1

/** Future Results binding input. It must come from immutable Results transport, never current review state. */
export interface ManualResultsProvenanceV1 {
  origin: 'promoted_manual_source'
  sourceAuthority: ManualSourceAuthority
  proposalAuthority: ManualProposalAuthority
  definitionAuthority: ManualDefinitionAuthority
}

export interface ManualTestAnalyzeResponseDto {
  source: ManualTestSourceV1
  analysis: ManualAnalysisResultV1
}

export type M3ManualAnalysisReceipt = ManualTestAnalyzeResponseDto

export interface M3ManualTestAdapter {
  readonly mode: 'backend'
  analyze(projectId: string, draft: M3ManualDraft): Promise<M3ManualAnalysisReceipt>
  promote(projectId: string, request: ManualPromotionRequestV1): Promise<ManualPromotionResultV1>
}

export class M3ManualContractError extends Error {
  constructor(message = 'The manual-test authority payload is malformed.') {
    super(message)
    this.name = 'M3ManualContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const HASH = /^[a-f0-9]{64}$/

function fail(message?: string): never { throw new M3ManualContractError(message) }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`)
  const result = value as Record<string, unknown>
  const actual = Object.keys(result).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} has an unexpected shape.`)
  return result
}
function id(value: unknown, label: string): string { if (typeof value !== 'string' || !ID.test(value)) fail(`${label} is malformed.`); return value }
function hash(value: unknown, label: string): string { if (typeof value !== 'string' || !HASH.test(value)) fail(`${label} is malformed.`); return value }
function text(value: unknown, label: string, maximum = 2000): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(`${label} is malformed.`)
  return value
}
function positive(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} is malformed.`); return Number(value) }
function index(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} is malformed.`); return Number(value) }
function list<T>(value: unknown, decoder: (item: unknown, index: number) => T, label: string): readonly T[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`)
  return value.map(decoder)
}
function ids(value: unknown, label: string, minimum = 0): readonly string[] {
  const values = list(value, (item, itemIndex) => id(item, `${label}[${itemIndex}]`), label)
  if (values.length < minimum || new Set(values).size !== values.length) fail(`${label} is malformed.`)
  return values
}
function texts(value: unknown, label: string): readonly string[] { return list(value, (item, itemIndex) => text(item, `${label}[${itemIndex}]`), label) }
function indexes(value: unknown, label: string): readonly number[] {
  const values = list(value, (item, itemIndex) => index(item, `${label}[${itemIndex}]`), label)
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates.`)
  return values
}

function decodeSourceAuthority(value: unknown, label = 'sourceAuthority'): ManualSourceAuthority {
  const source = object(value, ['sourceId', 'sourceContentHash'], label)
  return { sourceId: id(source.sourceId, `${label}.sourceId`), sourceContentHash: hash(source.sourceContentHash, `${label}.sourceContentHash`) }
}

function decodeProposalAuthority(value: unknown, label = 'proposalAuthority'): ManualProposalAuthority {
  const source = object(value, ['proposalId', 'proposalContentHash'], label)
  return { proposalId: id(source.proposalId, `${label}.proposalId`), proposalContentHash: hash(source.proposalContentHash, `${label}.proposalContentHash`) }
}

function decodeDefinitionAuthority(value: unknown, label = 'definitionAuthority'): ManualDefinitionAuthority {
  const source = object(value, ['definitionId', 'definitionSchemaVersion', 'testSetId', 'testSetRevision', 'testSetContentHash'], label)
  if (source.definitionSchemaVersion !== 3) fail(`${label}.definitionSchemaVersion is unsupported.`)
  return {
    definitionId: id(source.definitionId, `${label}.definitionId`), definitionSchemaVersion: 3,
    testSetId: id(source.testSetId, `${label}.testSetId`), testSetRevision: positive(source.testSetRevision, `${label}.testSetRevision`),
    testSetContentHash: hash(source.testSetContentHash, `${label}.testSetContentHash`),
  }
}

function decodeAppArea(value: unknown, label: string): ManualAppAreaV1 {
  const source = object(value, ['id', 'sourceSubjectId', 'confidence', 'method', 'evidenceIds'], label)
  if (source.confidence !== 'high' && source.confidence !== 'medium') fail(`${label}.confidence is unsupported.`)
  return {
    id: id(source.id, `${label}.id`), sourceSubjectId: id(source.sourceSubjectId, `${label}.sourceSubjectId`),
    confidence: source.confidence, method: id(source.method, `${label}.method`), evidenceIds: ids(source.evidenceIds, `${label}.evidenceIds`, 1),
  }
}

function decodeAction(value: unknown, label: string): ManualCanonicalActionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an action.`)
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'navigate_to_observed_route') {
    const source = object(value, ['stepId', 'ordinal', 'kind', 'subjectId', 'routePath'], label)
    if (source.ordinal !== 0) fail(`${label}.ordinal must remain wire ordinal 0.`)
    return { stepId: id(source.stepId, `${label}.stepId`), ordinal: 0, kind: 'navigate_to_observed_route', subjectId: id(source.subjectId, `${label}.subjectId`), routePath: text(source.routePath, `${label}.routePath`, 500) }
  }
  if (candidate.kind === 'click_observed_data_test') {
    const source = object(value, ['stepId', 'ordinal', 'kind', 'subjectId', 'elementId', 'dataTestValue', 'targetSubjectId'], label)
    if (source.ordinal !== 1) fail(`${label}.ordinal must remain wire ordinal 1.`)
    return {
      stepId: id(source.stepId, `${label}.stepId`), ordinal: 1, kind: 'click_observed_data_test',
      subjectId: id(source.subjectId, `${label}.subjectId`), elementId: id(source.elementId, `${label}.elementId`),
      dataTestValue: id(source.dataTestValue, `${label}.dataTestValue`), targetSubjectId: id(source.targetSubjectId, `${label}.targetSubjectId`),
    }
  }
  return fail(`${label}.kind is unsupported.`)
}

function decodeActions(value: unknown, label: string): readonly ManualCanonicalActionV1[] {
  const actions = list(value, (item, itemIndex) => decodeAction(item, `${label}[${itemIndex}]`), label)
  if (actions.length !== 2 || actions[0].ordinal !== 0 || actions[1].ordinal !== 1) fail(`${label} must preserve wire ordinals 0,1.`)
  return actions
}

function decodeSourceGrounding(value: unknown, label: string): ManualSourceGroundingV1 {
  const source = object(value, ['sourceRef', 'status', 'canonicalBinding', 'basis'], label)
  const refSource = source.sourceRef as Record<string, unknown> | null
  let sourceRef: ManualSourceRefV1
  if (refSource?.kind === 'step') {
    const ref = object(source.sourceRef, ['kind', 'ordinal'], `${label}.sourceRef`)
    sourceRef = { kind: 'step', ordinal: positive(ref.ordinal, `${label}.sourceRef.ordinal`) }
  } else {
    const ref = object(source.sourceRef, ['kind'], `${label}.sourceRef`)
    if (ref.kind !== 'expected_outcome') fail(`${label}.sourceRef.kind is unsupported.`)
    sourceRef = { kind: 'expected_outcome' }
  }
  if (!['grounded', 'insufficient_evidence', 'ambiguous_evidence', 'unsupported_semantics'].includes(String(source.status))) fail(`${label}.status is unsupported.`)
  let canonicalBinding: ManualCanonicalBindingV1 | null = null
  if (source.canonicalBinding !== null) {
    const candidate = source.canonicalBinding as Record<string, unknown>
    if (candidate.kind === 'action') {
      const binding = object(source.canonicalBinding, ['kind', 'ordinal'], `${label}.canonicalBinding`)
      if (binding.ordinal !== 0 && binding.ordinal !== 1) fail(`${label}.canonicalBinding.ordinal is unsupported.`)
      canonicalBinding = { kind: 'action', ordinal: binding.ordinal }
    } else {
      const binding = object(source.canonicalBinding, ['kind', 'oracleKind'], `${label}.canonicalBinding`)
      if (binding.kind !== 'oracle' || binding.oracleKind !== 'subject_observable') fail(`${label}.canonicalBinding is unsupported.`)
      canonicalBinding = { kind: 'oracle', oracleKind: 'subject_observable' }
    }
  }
  if (source.status === 'grounded' && canonicalBinding === null || source.status !== 'grounded' && canonicalBinding !== null) fail(`${label} grounding status and binding disagree.`)
  const basisSource = source.basis as Record<string, unknown> | null
  let basis: ManualGroundingBasisV1
  if (basisSource?.kind === 'observed_flow_step') {
    const decoded = object(source.basis, ['kind', 'flowStepIndex', 'evidenceIds'], `${label}.basis`)
    basis = { kind: 'observed_flow_step', flowStepIndex: index(decoded.flowStepIndex, `${label}.basis.flowStepIndex`), evidenceIds: ids(decoded.evidenceIds, `${label}.basis.evidenceIds`) }
  } else {
    const decoded = object(source.basis, ['kind', 'flowStepIndex', 'evidenceIds'], `${label}.basis`)
    if (decoded.flowStepIndex !== null || decoded.kind !== 'governed_route' && decoded.kind !== 'governed_subject') fail(`${label}.basis is unsupported.`)
    basis = { kind: decoded.kind, flowStepIndex: null, evidenceIds: ids(decoded.evidenceIds, `${label}.basis.evidenceIds`) }
  }
  if (canonicalBinding?.kind === 'action' && canonicalBinding.ordinal === 0 && basis.kind !== 'governed_route'
    || canonicalBinding?.kind === 'action' && canonicalBinding.ordinal === 1 && basis.kind !== 'observed_flow_step'
    || canonicalBinding?.kind === 'oracle' && basis.kind !== 'governed_subject') {
    fail(`${label} canonical binding and basis disagree.`)
  }
  return { sourceRef, status: source.status as ManualSourceGroundingV1['status'], canonicalBinding, basis }
}

function decodeGroundingList(value: unknown, label: string): readonly ManualSourceGroundingV1[] {
  const grounding = list(value, (item, itemIndex) => decodeSourceGrounding(item, `${label}[${itemIndex}]`), label)
  if (grounding.length < 2 || grounding.length > 51) fail(`${label} has an unsupported size.`)
  const steps = grounding.filter(item => item.sourceRef.kind === 'step')
  if (grounding[grounding.length - 1].sourceRef.kind !== 'expected_outcome' || steps.length !== grounding.length - 1
    || steps.some((item, itemIndex) => item.sourceRef.kind !== 'step' || item.sourceRef.ordinal !== itemIndex + 1)) {
    fail(`${label} must cover contiguous one-based source steps followed by the expected outcome.`)
  }
  return grounding
}

function decodeNormalizedIntent(value: unknown): SupportedManualNormalizedIntentV1 {
  const source = object(value, ['schemaVersion', 'intentId', 'projectId', 'source', 'appArea', 'title', 'objective', 'preconditions', 'steps', 'expectedOutcomes', 'grounding', 'evidenceAssessment', 'disposition'], 'normalizedIntent')
  if (source.schemaVersion !== 'forge-normalized-test-intent/v1' || source.source !== 'manual') fail('normalizedIntent source or schema is unsupported.')
  const preconditions = list(source.preconditions, (item, itemIndex) => {
    const decoded = object(item, ['kind', 'roleId', 'mechanism'], `normalizedIntent.preconditions[${itemIndex}]`)
    if (decoded.kind !== 'authenticated_role') fail('normalizedIntent precondition is unsupported.')
    return { kind: 'authenticated_role' as const, roleId: id(decoded.roleId, 'normalizedIntent roleId'), mechanism: id(decoded.mechanism, 'normalizedIntent mechanism') }
  }, 'normalizedIntent.preconditions')
  const actions = decodeActions(source.steps, 'normalizedIntent.steps')
  const expectedOutcomes = list(source.expectedOutcomes, item => {
    const decoded = object(item, ['outcomeId', 'kind', 'subjectId', 'routePath'], 'normalizedIntent.expectedOutcome')
    if (decoded.kind !== 'subject_observable') fail('normalizedIntent expected outcome is unsupported.')
    return { outcomeId: id(decoded.outcomeId, 'normalizedIntent outcomeId'), kind: 'subject_observable' as const, subjectId: id(decoded.subjectId, 'normalizedIntent outcome subjectId'), routePath: text(decoded.routePath, 'normalizedIntent outcome routePath', 500) }
  }, 'normalizedIntent.expectedOutcomes')
  if (expectedOutcomes.length !== 1) fail('normalizedIntent must have one expected outcome.')
  const grounding = object(source.grounding, ['modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'sourceFlowId', 'selectedFlowStepIndexes', 'excludedFlowStepIndexes', 'subjectSupport'], 'normalizedIntent.grounding')
  const selected = indexes(grounding.selectedFlowStepIndexes, 'normalizedIntent selectedFlowStepIndexes')
  if (selected.length !== 1) fail('normalizedIntent must select one observed flow step.')
  const subjectSupport = list(grounding.subjectSupport, (item, itemIndex) => {
    const decoded = object(item, ['canonicalSubjectId', 'supportingObservationIds', 'supportingGapIds'], `normalizedIntent.subjectSupport[${itemIndex}]`)
    return { canonicalSubjectId: id(decoded.canonicalSubjectId, 'canonicalSubjectId'), supportingObservationIds: ids(decoded.supportingObservationIds, 'supportingObservationIds', 1), supportingGapIds: ids(decoded.supportingGapIds, 'supportingGapIds') }
  }, 'normalizedIntent.subjectSupport')
  if (subjectSupport.length < 1) fail('normalizedIntent subject support is empty.')
  const assessment = object(source.evidenceAssessment, ['state', 'sourceFlowConfidence', 'selectedStepGrounding', 'limitations'], 'normalizedIntent.evidenceAssessment')
  if (assessment.state !== 'sufficient' || assessment.sourceFlowConfidence !== 'observed' && assessment.sourceFlowConfidence !== 'partial' || assessment.selectedStepGrounding !== 'observed') fail('normalizedIntent evidence assessment is unsupported.')
  const disposition = object(source.disposition, ['state'], 'normalizedIntent.disposition')
  if (disposition.state !== 'supported') fail('normalizedIntent disposition is unsupported.')
  return {
    schemaVersion: 'forge-normalized-test-intent/v1', intentId: id(source.intentId, 'normalizedIntent.intentId'),
    projectId: id(source.projectId, 'normalizedIntent.projectId'), source: 'manual', appArea: decodeAppArea(source.appArea, 'normalizedIntent.appArea'),
    title: text(source.title, 'normalizedIntent.title', 500), objective: text(source.objective, 'normalizedIntent.objective'),
    preconditions, steps: actions, expectedOutcomes: expectedOutcomes as unknown as SupportedManualNormalizedIntentV1['expectedOutcomes'],
    grounding: {
      modelRowId: positive(grounding.modelRowId, 'normalizedIntent.modelRowId'), modelVersion: id(grounding.modelVersion, 'normalizedIntent.modelVersion'),
      observationRunId: id(grounding.observationRunId, 'normalizedIntent.observationRunId'), supportSealHash: hash(grounding.supportSealHash, 'normalizedIntent.supportSealHash'),
      sourceFlowId: id(grounding.sourceFlowId, 'normalizedIntent.sourceFlowId'), selectedFlowStepIndexes: selected as unknown as readonly [number],
      excludedFlowStepIndexes: indexes(grounding.excludedFlowStepIndexes, 'normalizedIntent.excludedFlowStepIndexes'), subjectSupport,
    },
    evidenceAssessment: { state: 'sufficient', sourceFlowConfidence: assessment.sourceFlowConfidence, selectedStepGrounding: 'observed', limitations: texts(assessment.limitations, 'normalizedIntent.limitations') },
    disposition: { state: 'supported' },
  }
}

export function decodeManualTestSourceV1(value: unknown): ManualTestSourceV1 {
  const source = object(value, ['schemaVersion', 'sourceId', 'projectId', 'sourceKind', 'title', 'objective', 'steps', 'expectedOutcome', 'contentHash'], 'manual source')
  if (source.schemaVersion !== 'forge-manual-test-source/v1' || source.sourceKind !== 'manual') fail('Manual source schema or kind is unsupported.')
  const steps = list(source.steps, (item, itemIndex) => {
    const step = object(item, ['ordinal', 'text'], `manual source steps[${itemIndex}]`)
    const ordinal = positive(step.ordinal, `manual source steps[${itemIndex}].ordinal`)
    if (ordinal !== itemIndex + 1) fail('Manual source ordinals must be contiguous and one-based.')
    return { ordinal, text: text(step.text, `manual source steps[${itemIndex}].text`) }
  }, 'manual source steps')
  if (steps.length < 1 || steps.length > 50) fail('Manual source step count is unsupported.')
  if (source.objective !== null && (typeof source.objective !== 'string' || source.objective.length < 1 || source.objective.length > 2000)) fail('Manual source objective is malformed.')
  return {
    schemaVersion: 'forge-manual-test-source/v1', sourceId: id(source.sourceId, 'manual sourceId'), projectId: id(source.projectId, 'manual projectId'),
    sourceKind: 'manual', title: text(source.title, 'manual title', 500), objective: source.objective as string | null, steps,
    expectedOutcome: text(source.expectedOutcome, 'manual expectedOutcome'), contentHash: hash(source.contentHash, 'manual contentHash'),
  }
}

export function decodeManualAutomationProposalV1(value: unknown): ManualAutomationProposalV1 {
  const source = object(value, ['schemaVersion', 'proposalId', 'projectId', 'sourceAuthority', 'authority', 'appArea', 'normalizedIntent', 'normalizedIntentContentHash', 'sourceGrounding', 'canonicalActions', 'oracle', 'authenticationExpectation', 'limitations', 'disposition', 'proposalContentHash'], 'manual proposal')
  if (source.schemaVersion !== 'forge-manual-automation-proposal/v1') fail('Manual proposal schema is unsupported.')
  const authority = object(source.authority, ['modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'routeEvidenceIdentityHash', 'authenticationExpectationIdentityHash'], 'manual proposal authority')
  const appArea = decodeAppArea(source.appArea, 'manual proposal appArea')
  const normalizedIntent = decodeNormalizedIntent(source.normalizedIntent)
  const canonicalActions = decodeActions(source.canonicalActions, 'manual proposal canonicalActions')
  if (JSON.stringify(canonicalActions) !== JSON.stringify(normalizedIntent.steps) || JSON.stringify(appArea) !== JSON.stringify(normalizedIntent.appArea)) fail('Manual proposal duplicates disagree with normalized intent authority.')
  const oracle = object(source.oracle, ['kind', 'subjectId', 'routePath', 'supportingObservationIds', 'explanation'], 'manual proposal oracle')
  if (oracle.kind !== 'subject_observable') fail('Manual proposal oracle is unsupported.')
  const auth = object(source.authenticationExpectation, ['schemaVersion', 'state', 'mechanism', 'bases', 'identityHash'], 'manual proposal authenticationExpectation')
  if (auth.schemaVersion !== 'forge-authentication-expectation/v1' || !['required', 'not_required', 'unknown', 'conflicted'].includes(String(auth.state))) fail('Manual proposal authentication expectation is unsupported.')
  if (auth.mechanism !== null && typeof auth.mechanism !== 'string') fail('Manual proposal authentication mechanism is malformed.')
  const bases = list(auth.bases, (item, itemIndex) => {
    const decoded = object(item, ['kind', 'policyId', 'policyVersion', 'configurationDigest', 'mechanism'], `authentication bases[${itemIndex}]`)
    if (decoded.kind !== 'declared_configuration' || decoded.mechanism !== null && typeof decoded.mechanism !== 'string') fail('Authentication basis is unsupported.')
    return { kind: 'declared_configuration' as const, policyId: id(decoded.policyId, 'authentication policyId'), policyVersion: id(decoded.policyVersion, 'authentication policyVersion'), configurationDigest: hash(decoded.configurationDigest, 'authentication configurationDigest'), mechanism: decoded.mechanism as string | null }
  }, 'authentication bases')
  const disposition = object(source.disposition, ['state'], 'manual proposal disposition')
  if (disposition.state !== 'supported') fail('Manual proposal disposition is unsupported.')
  const projectId = id(source.projectId, 'manual proposal projectId')
  if (normalizedIntent.projectId !== projectId) fail('Manual proposal project identity disagrees with normalized intent.')
  const authenticationIdentityHash = hash(authority.authenticationExpectationIdentityHash, 'authenticationExpectationIdentityHash')
  const authIdentityHash = hash(auth.identityHash, 'authentication identityHash')
  if (authenticationIdentityHash !== authIdentityHash) fail('Authentication expectation identity disagrees with proposal authority.')
  return {
    schemaVersion: 'forge-manual-automation-proposal/v1', proposalId: id(source.proposalId, 'manual proposalId'), projectId,
    sourceAuthority: decodeSourceAuthority(source.sourceAuthority),
    authority: {
      modelRowId: positive(authority.modelRowId, 'manual proposal modelRowId'), modelVersion: id(authority.modelVersion, 'manual proposal modelVersion'),
      observationRunId: id(authority.observationRunId, 'manual proposal observationRunId'), supportSealHash: hash(authority.supportSealHash, 'manual proposal supportSealHash'),
      routeEvidenceIdentityHash: hash(authority.routeEvidenceIdentityHash, 'routeEvidenceIdentityHash'), authenticationExpectationIdentityHash: authenticationIdentityHash,
    },
    appArea, normalizedIntent, normalizedIntentContentHash: hash(source.normalizedIntentContentHash, 'normalizedIntentContentHash'),
    sourceGrounding: decodeGroundingList(source.sourceGrounding, 'manual proposal sourceGrounding'), canonicalActions,
    oracle: { kind: 'subject_observable', subjectId: id(oracle.subjectId, 'manual proposal oracle subjectId'), routePath: text(oracle.routePath, 'manual proposal oracle routePath', 500), supportingObservationIds: ids(oracle.supportingObservationIds, 'manual proposal oracle supportingObservationIds', 1), explanation: text(oracle.explanation, 'manual proposal oracle explanation') },
    authenticationExpectation: { schemaVersion: 'forge-authentication-expectation/v1', state: auth.state as ManualAutomationProposalV1['authenticationExpectation']['state'], mechanism: auth.mechanism as string | null, bases, identityHash: authIdentityHash },
    limitations: texts(source.limitations, 'manual proposal limitations'), disposition: { state: 'supported' }, proposalContentHash: hash(source.proposalContentHash, 'proposalContentHash'),
  }
}

function decodeManualRefusal(value: unknown): ManualAutomationRefusalV1 {
  const source = object(value, ['schemaVersion', 'projectId', 'sourceAuthority', 'code', 'evidenceState', 'safeMessage', 'sourceGrounding', 'limitations'], 'manual refusal')
  if (source.schemaVersion !== 'forge-manual-automation-refusal/v1' || !M3_MANUAL_REFUSAL_CODES.includes(source.code as M3ManualRefusalCode)) fail('Manual refusal code or schema is unsupported.')
  if (!['insufficient', 'ambiguous', 'unsupported'].includes(String(source.evidenceState))) fail('Manual refusal evidence state is unsupported.')
  return {
    schemaVersion: 'forge-manual-automation-refusal/v1', projectId: id(source.projectId, 'manual refusal projectId'), sourceAuthority: decodeSourceAuthority(source.sourceAuthority),
    code: source.code as M3ManualRefusalCode, evidenceState: source.evidenceState as ManualAutomationRefusalV1['evidenceState'], safeMessage: text(source.safeMessage, 'manual refusal safeMessage'),
    sourceGrounding: decodeGroundingList(source.sourceGrounding, 'manual refusal sourceGrounding'), limitations: texts(source.limitations, 'manual refusal limitations'),
  }
}

export function decodeManualAnalysisResultV1(value: unknown): ManualAnalysisResultV1 {
  const source = object(value, ['schemaVersion', 'outcome'], 'manual analysis result')
  if (source.schemaVersion !== 'forge-manual-analysis-result/v1') fail('Manual analysis result schema is unsupported.')
  const outcomeCandidate = source.outcome as Record<string, unknown> | null
  if (outcomeCandidate?.kind === 'proposal') {
    const outcome = object(source.outcome, ['kind', 'proposal'], 'manual analysis proposal outcome')
    return { schemaVersion: 'forge-manual-analysis-result/v1', outcome: { kind: 'proposal', proposal: decodeManualAutomationProposalV1(outcome.proposal) } }
  }
  const outcome = object(source.outcome, ['kind', 'refusal'], 'manual analysis refusal outcome')
  if (outcome.kind !== 'refusal') fail('Manual analysis outcome is unsupported.')
  return { schemaVersion: 'forge-manual-analysis-result/v1', outcome: { kind: 'refusal', refusal: decodeManualRefusal(outcome.refusal) } }
}

function sameSourceAuthority(source: ManualTestSourceV1, authority: ManualSourceAuthority): boolean {
  return source.sourceId === authority.sourceId && source.contentHash === authority.sourceContentHash
}

export function decodeManualTestAnalyzeResponseDto(value: unknown): ManualTestAnalyzeResponseDto {
  const response = object(value, ['source', 'analysis'], 'manual Analyze response')
  const source = decodeManualTestSourceV1(response.source)
  const analysis = decodeManualAnalysisResultV1(response.analysis)
  const outcome = analysis.outcome.kind === 'proposal' ? analysis.outcome.proposal : analysis.outcome.refusal
  if (source.projectId !== outcome.projectId || !sameSourceAuthority(source, outcome.sourceAuthority)
    || outcome.sourceGrounding.length !== source.steps.length + 1
    || outcome.sourceGrounding.some((item, itemIndex) => itemIndex < source.steps.length
      ? item.sourceRef.kind !== 'step' || item.sourceRef.ordinal !== itemIndex + 1
      : item.sourceRef.kind !== 'expected_outcome')) {
    fail('Manual Analyze response source and analysis authority disagree.')
  }
  return { source, analysis }
}

export function decodeManualPromotionResultV1(value: unknown): ManualPromotionResultV1 {
  const source = object(value, ['schemaVersion', 'outcome', 'sourceAuthority', 'proposalAuthority', 'definitionAuthority'], 'manual promotion result')
  if (source.schemaVersion !== 'forge-manual-promotion-result/v1' || source.outcome !== 'promoted') fail('Manual promotion outcome or schema is unsupported.')
  return { schemaVersion: 'forge-manual-promotion-result/v1', outcome: 'promoted', sourceAuthority: decodeSourceAuthority(source.sourceAuthority), proposalAuthority: decodeProposalAuthority(source.proposalAuthority), definitionAuthority: decodeDefinitionAuthority(source.definitionAuthority) }
}

export function decodeManualResultsProvenanceV1(value: unknown): ManualResultsProvenanceV1 {
  const source = object(value, ['origin', 'sourceAuthority', 'proposalAuthority', 'definitionAuthority'], 'manual Results provenance')
  if (source.origin !== 'promoted_manual_source') fail('Manual Results provenance origin is unsupported.')
  return { origin: 'promoted_manual_source', sourceAuthority: decodeSourceAuthority(source.sourceAuthority), proposalAuthority: decodeProposalAuthority(source.proposalAuthority), definitionAuthority: decodeDefinitionAuthority(source.definitionAuthority) }
}

export function buildManualPromotionRequest(proposal: ManualAutomationProposalV1): ManualPromotionRequestV1 {
  return Object.freeze({
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: Object.freeze({ ...proposal.sourceAuthority }),
    reviewedProposalAuthority: Object.freeze({ proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash }),
  })
}

export function buildManualAnalyzeRequest(draft: M3ManualDraft): ManualTestAnalyzeRequestDto {
  return {
    schemaVersion: 'forge-manual-test-source-input/v1',
    sourceKind: 'manual',
    title: draft.title,
    objective: draft.objective === '' ? null : draft.objective,
    steps: draft.steps.map((step, itemIndex) => ({ ordinal: itemIndex + 1, text: step })),
    expectedOutcome: draft.expectedOutcome,
  }
}

export function manualSourceToDraft(source: ManualTestSourceV1): M3ManualDraft {
  return {
    title: source.title,
    objective: source.objective ?? '',
    steps: source.steps.map(step => step.text),
    expectedOutcome: source.expectedOutcome,
  }
}

export function sourceAuthorityOf(result: ManualAnalysisResultV1): ManualSourceAuthority {
  return result.outcome.kind === 'proposal' ? result.outcome.proposal.sourceAuthority : result.outcome.refusal.sourceAuthority
}

export function manualDraftSnapshot(draft: M3ManualDraft): string { return JSON.stringify(draft) }

export function validateManualDraft(draft: M3ManualDraft): readonly string[] {
  const errors: string[] = []
  if (!draft.title.trim() || draft.title.length > 500) errors.push('Enter a title from 1 through 500 characters.')
  if (draft.objective.length > 2000 || draft.objective.length > 0 && !draft.objective.trim()) errors.push('The optional objective must contain text when provided and cannot exceed 2000 characters.')
  if (draft.steps.length < 1 || draft.steps.length > 50) errors.push('Provide from 1 through 50 ordered steps.')
  draft.steps.forEach((step, itemIndex) => { if (!step.trim() || step.length > 2000) errors.push(`Step ${itemIndex + 1} must contain from 1 through 2000 characters.`) })
  if (!draft.expectedOutcome.trim() || draft.expectedOutcome.length > 2000) errors.push('Enter an expected outcome from 1 through 2000 characters.')
  return errors
}
