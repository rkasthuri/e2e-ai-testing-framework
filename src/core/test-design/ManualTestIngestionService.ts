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
import type { AppModel, ElementDefinition, FlowDefinition, PageDefinition } from '../onboarding/types'
import { AppModelService } from '../storage/AppModelService'
import { assertProductDatabaseAuthority } from '../storage/db'
import { runMigrations } from '../storage/migrate'
import { ManualTestSourceRepository } from '../storage/repositories/ManualTestSourceRepository'
import { TestSetRepository } from '../storage/repositories/TestSetRepository'
import { AuthenticationExpectationProjectionService, type AuthenticationExpectationProjection } from './AuthenticationExpectationProjection'
import { CanonicalRouteEvidenceProjection, type CanonicalRouteEvidence } from './CanonicalRouteEvidenceProjection'
import {
  assertManualProposalIdentity,
  materializeManualAutomationProposalV1,
  parseManualPromotionRequestV1,
  type ManualAnalysisResultV1,
  type ManualAutomationProposalV1,
  type ManualAutomationRefusalV1,
  type ManualPromotionRequestV1,
  type ManualPromotionResultV1,
  type ManualSourceGroundingV1,
} from './ManualAutomationProposalContract'
import {
  manualSourceAsInput,
  parseManualTestSourceInputV1,
  type ManualTestSourceInputV1,
  type ManualTestSourceV1,
} from './ManualTestSourceContract'
import {
  materializeSupportedNormalizedTestIntentV1,
  type NormalizedTestIntentRefusalCode,
  type NormalizedIntentSubjectSupportV1,
  type SupportedNormalizedTestIntentV1,
} from './NormalizedTestIntentContract'
import { TestDefinitionContractError } from './TestDefinitionContract'
import { TestDefinitionAuthorityProjectionService, type CanonicalTestDefinitionAuthority } from './TestDefinitionAuthorityProjectionService'

const PROCESS_INSTANCE_ID = `m3-manual-${process.pid}-${crypto.randomUUID()}`
const UNSUPPORTED_ACTION = /^(?:Enter|Fill|Select|Choose|Drag|Drop|Type|Assert|Verify text|Check text)\b/u

export type ManualPromotionFailureCode =
  | 'SOURCE_PROPOSAL_MISMATCH'
  | 'MANUAL_PROMOTION_IDENTITY_CONFLICT'
  | 'STALE_REVIEWED_PROPOSAL'
  | 'MANUAL_PROPOSAL_NOT_EXECUTABLE'

export class ManualTestPromotionError extends Error {
  constructor(readonly code: ManualPromotionFailureCode) {
    super(code === 'SOURCE_PROPOSAL_MISMATCH'
      ? 'The supplied source authority does not match the persisted manual source.'
      : code === 'MANUAL_PROMOTION_IDENTITY_CONFLICT'
        ? 'The supplied proposal ID and content hash are internally inconsistent.'
        : code === 'STALE_REVIEWED_PROPOSAL'
          ? 'Current canonical evidence produces a different manual automation proposal.'
          : 'Current canonical evidence does not produce an executable manual automation proposal.')
    this.name = 'ManualTestPromotionError'
  }
}

export interface ManualAnalysisEvidenceV1 {
  model: AppModel
  authority: CanonicalTestDefinitionAuthority
  routeEvidence: CanonicalRouteEvidence
  authenticationExpectation: AuthenticationExpectationProjection
}

export interface ManualAnalysisEvidenceReader {
  read(projectId: string, workspaceRoot: string): Promise<ManualAnalysisEvidenceV1 | null>
}

class CanonicalManualAnalysisEvidenceReader implements ManualAnalysisEvidenceReader {
  constructor(
    private readonly authorities = new TestDefinitionAuthorityProjectionService(),
    private readonly routes = new CanonicalRouteEvidenceProjection(),
    private readonly authentication = new AuthenticationExpectationProjectionService(),
    private readonly appModels = new AppModelService(),
  ) {}

  async read(projectId: string, workspaceRoot: string): Promise<ManualAnalysisEvidenceV1 | null> {
    const admitted = await this.authorities.read(projectId)
    if (admitted.kind !== 'ok') return null
    const route = await this.routes.read(projectId, admitted.authority)
    if (route.kind !== 'ok') return null
    const model = await this.appModels.findActive(projectId)
    if (!model) return null
    return {
      model,
      authority: admitted.authority,
      routeEvidence: route.evidence,
      authenticationExpectation: this.authentication.read(projectId, workspaceRoot),
    }
  }
}

function digestId(prefix: string, ...parts: Array<string | number>): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
  return `${prefix}-${hash.slice(0, 24)}`
}

function matchingText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim()
}

function pageTerm(text: string): string | null {
  return /^(?:Open|Navigate to) the (.+) page\.$/u.exec(text)?.[1] ?? null
}

function clickTerm(text: string): string | null {
  return /^Click (?:the )?(.+?)(?: button)?\.$/u.exec(text)?.[1] ?? null
}

function outcomeTerm(text: string): string | null {
  return /^(.+) page is displayed\.$/u.exec(text)?.[1] ?? null
}

function pageMatches(page: PageDefinition, term: string): boolean {
  const expected = matchingText(term)
  return [page.id, page.displayName].some(value => matchingText(value) === expected)
}

function elementMatches(element: ElementDefinition, term: string): boolean {
  const expected = matchingText(term)
  const localId = element.id.includes(':') ? element.id.slice(element.id.lastIndexOf(':') + 1) : element.id
  return [element.id, localId, element.name, element.label].some(value => matchingText(value) === expected)
}

function isEligibleObservedControl(element: ElementDefinition): boolean {
  return element.cardinality?.kind === 'single' && element.observedState === 'visible'
}

function refusalState(code: NormalizedTestIntentRefusalCode): ManualAutomationRefusalV1['evidenceState'] {
  if (code === 'ambiguous_evidence') return 'ambiguous'
  if (code === 'unsupported_semantics') return 'unsupported'
  return 'insufficient'
}

function refusalGrounding(
  source: ManualTestSourceV1,
  code: NormalizedTestIntentRefusalCode,
  failingOrdinal: number | null,
): ManualSourceGroundingV1[] {
  const failureStatus = code === 'ambiguous_evidence' ? 'ambiguous_evidence'
    : code === 'unsupported_semantics' ? 'unsupported_semantics' : 'insufficient_evidence'
  return [
    ...source.steps.map((step, index): ManualSourceGroundingV1 => ({
      sourceRef: { kind: 'step', ordinal: step.ordinal },
      status: failingOrdinal === null || failingOrdinal === step.ordinal ? failureStatus : 'insufficient_evidence',
      canonicalBinding: null,
      basis: index === 0
        ? { kind: 'governed_route', flowStepIndex: null, evidenceIds: [] }
        : { kind: 'observed_flow_step', flowStepIndex: Math.max(0, index - 1), evidenceIds: [] },
    })),
    {
      sourceRef: { kind: 'expected_outcome' },
      status: failingOrdinal === null ? failureStatus : 'insufficient_evidence',
      canonicalBinding: null,
      basis: { kind: 'governed_subject', flowStepIndex: null, evidenceIds: [] },
    },
  ]
}

function refused(
  source: ManualTestSourceV1,
  code: NormalizedTestIntentRefusalCode,
  safeMessage: string,
  limitation: string,
  failingOrdinal: number | null = null,
  grounding?: ManualSourceGroundingV1[],
): ManualAnalysisResultV1 {
  return {
    schemaVersion: 'forge-manual-analysis-result/v1',
    outcome: {
      kind: 'refusal',
      refusal: {
        schemaVersion: 'forge-manual-automation-refusal/v1',
        projectId: source.projectId,
        sourceAuthority: { sourceId: source.sourceId, sourceContentHash: source.contentHash },
        code,
        evidenceState: refusalState(code),
        safeMessage,
        sourceGrounding: grounding ?? refusalGrounding(source, code, failingOrdinal),
        limitations: [limitation],
      },
    },
  }
}

function subjectSupport(
  authority: CanonicalTestDefinitionAuthority,
  subjectIds: string[],
): NormalizedIntentSubjectSupportV1[] | null {
  const support = [...new Set(subjectIds)].sort().map(subjectId => {
    const item = authority.subjectSupport.find(candidate => candidate.canonicalSubjectId === subjectId)
    return item && item.supportingObservationIds.length > 0 ? {
      canonicalSubjectId: item.canonicalSubjectId,
      supportingObservationIds: [...item.supportingObservationIds],
      supportingGapIds: [...item.supportingGapIds],
    } : null
  })
  return support.some(item => item === null) ? null : support as NormalizedIntentSubjectSupportV1[]
}

function findObservedTransitions(
  flows: readonly FlowDefinition[],
  sourcePage: PageDefinition,
  targetPage: PageDefinition,
  element: ElementDefinition,
) {
  return flows.flatMap(flow => flow.steps
    .filter(step => step.pageId === sourcePage.id && step.targetPageId === targetPage.id && step.elementId === element.id
      && step.action === 'click' && step.value === null)
    .map(step => ({ flow, step })))
}

export function analyzeManualTestSourceV1(
  source: ManualTestSourceV1,
  evidence: ManualAnalysisEvidenceV1 | null,
): ManualAnalysisResultV1 {
  const unsupported = source.steps.find(step => UNSUPPORTED_ACTION.test(step.text))
  if (unsupported) return refused(
    source, 'unsupported_semantics',
    'The manual source requires an action outside the frozen canonical action set.',
    'No partial Definition is created when any authored source step requires unsupported semantics.',
    unsupported.ordinal,
  )
  if (source.steps.length !== 2 || !pageTerm(source.steps[0].text) || !clickTerm(source.steps[1].text)
    || !outcomeTerm(source.expectedOutcome)) return refused(
      source, 'unsupported_semantics',
      'The manual source is outside the bounded navigate, click, and subject-observable language.',
      'M3 accepts only one entry navigation, one click, and one page-observable expected outcome.',
    )
  if (!evidence || evidence.model.app.name !== source.projectId
    || evidence.authority.projectId !== source.projectId || evidence.routeEvidence.projectId !== source.projectId) {
    return refused(source, 'insufficient_evidence', 'Current canonical evidence is unavailable for this source.', 'Analyze again after current sealed App Model evidence is available.')
  }
  const pages = evidence.model.pages ?? []
  const sourcePages = pages.filter(page => pageMatches(page, pageTerm(source.steps[0].text)!))
  if (sourcePages.length !== 1) return refused(
    source, sourcePages.length > 1 ? 'ambiguous_evidence' : 'insufficient_evidence',
    sourcePages.length > 1 ? 'More than one canonical page matches the authored entry page.' : 'No canonical page matches the authored entry page.',
    'The authored entry page must resolve to exactly one current canonical subject.', 1,
  )
  const targetPages = pages.filter(page => pageMatches(page, outcomeTerm(source.expectedOutcome)!))
  if (targetPages.length !== 1) return refused(
    source, targetPages.length > 1 ? 'ambiguous_evidence' : 'insufficient_evidence',
    targetPages.length > 1 ? 'More than one canonical subject matches the expected page.' : 'No canonical target subject supports the expected page.',
    'The expected outcome must resolve to exactly one current governed subject.', null,
  )
  const sourcePage = sourcePages[0]
  const targetPage = targetPages[0]
  const area = sourcePage.module
  if (!area || !area.name || !['high', 'medium'].includes(area.confidence)
    || !['rule', 'ai', 'manual'].includes(area.method) || !area.evidenceIds.includes(sourcePage.id)) {
    return refused(source, 'app_area_unknown', 'The source page has no unambiguous persisted application-area classification.', 'Grounded actions and an oracle cannot substitute for missing persisted PageDefinition.module authority.')
  }
  const eligibleElements = sourcePage.elements.filter(isEligibleObservedControl)
  const elements = eligibleElements.filter(element => elementMatches(element, clickTerm(source.steps[1].text)!))
  if (elements.length !== 1) return refused(
    source, elements.length > 1 ? 'ambiguous_evidence' : 'insufficient_evidence',
    elements.length > 1 ? 'More than one observed control satisfies the authored click step.' : 'No observed control satisfies the authored click step.',
    'The click source must identify exactly one observed control.', 2,
  )
  const element = elements[0]
  const dataTests = element.strategies.filter(strategy => strategy.type === 'data-test')
  if (dataTests.length === 0) return refused(source, 'unsupported_semantics', 'The observed control has no supported data-test strategy.', 'M3 never invents a selector for an observed control.', 2)
  if (dataTests.length !== 1) return refused(source, 'ambiguous_evidence', 'The observed control has multiple data-test strategies.', 'The executable click requires exactly one supported data-test authority.', 2)
  const selectorOwners = eligibleElements.filter(candidate => candidate.strategies
    .some(strategy => strategy.type === 'data-test' && strategy.value === dataTests[0].value))
  if (selectorOwners.length !== 1) return refused(
    source, 'ambiguous_evidence',
    'The selected data-test strategy does not uniquely identify one eligible observed control.',
    'The executable click requires a data-test value uniquely owned in the current source-page authority.', 2,
  )
  const transitions = findObservedTransitions(evidence.model.flows ?? [], sourcePage, targetPage, element)
  if (transitions.length !== 1) return refused(
    source, transitions.length > 1 ? 'ambiguous_evidence' : 'insufficient_evidence',
    transitions.length > 1 ? 'More than one App Model flow step grounds the authored click.' : 'No App Model flow step grounds the authored click.',
    'The authored click must map to exactly one current App Model transition.', 2,
  )
  const { flow, step } = transitions[0]
  if (step.grounding !== 'observed' || !['observed', 'partial'].includes(flow.confidence)) {
    return refused(source, 'insufficient_evidence', 'The matching App Model click transition is not directly observed.', 'Inferred flow behavior cannot become executable M3 authority.', 2)
  }
  const sourceRoute = evidence.routeEvidence.subjects.find(item => item.canonicalSubjectId === sourcePage.id)
  const targetRoute = evidence.routeEvidence.subjects.find(item => item.canonicalSubjectId === targetPage.id)
  if (!sourceRoute || !targetRoute) return refused(source, 'insufficient_evidence', 'Governed route evidence is missing for the entry or target subject.', 'Observe the missing route before re-analysis.')
  const support = subjectSupport(evidence.authority, [sourcePage.id, targetPage.id])
  if (!support) return refused(source, 'insufficient_evidence', 'Canonical subject support is incomplete.', 'Establish sealed subject support before re-analysis.')
  const authentication = evidence.authenticationExpectation
  if (authentication.state === 'unknown') return refused(source, 'insufficient_evidence', 'Authentication expectation is unknown.', 'Establish governed authentication expectation before re-analysis.')
  if (authentication.state === 'conflicted') return refused(source, 'ambiguous_evidence', 'Authentication expectation is conflicted.', 'Resolve the conflicting authentication declarations before re-analysis.')
  if (authentication.state === 'required' && authentication.mechanism !== 'form-login') {
    return refused(source, 'unsupported_semantics', 'The required authentication mechanism is outside frozen runner compatibility.', 'Use a separately governed runner capability before promotion.')
  }
  const role = evidence.model.roles.find(candidate => candidate.id === flow.roleId)
  if (authentication.state === 'required'
    && (!role || role.authOutcome !== 'succeeded' || role.authFlow !== authentication.mechanism)) {
    return refused(source, 'insufficient_evidence', 'The required authenticated role is not established by current App Model evidence.', 'Establish the required role before re-analysis.')
  }

  const intentId = digestId('manual-intent', source.projectId, source.contentHash, evidence.authority.supportSealHash, flow.id, step.stepIndex)
  const excluded = flow.steps.map(item => item.stepIndex).filter(index => index !== step.stepIndex)
  const limitations = excluded.length === 0 ? [] : [`App Model flow step indexes ${excluded.join(', ')} are context outside this complete manual source.`]
  const normalizedIntent: SupportedNormalizedTestIntentV1 = {
    schemaVersion: 'forge-normalized-test-intent/v1',
    intentId,
    projectId: source.projectId,
    source: 'manual',
    appArea: {
      id: area.name,
      sourceSubjectId: sourcePage.id,
      confidence: area.confidence as 'high' | 'medium',
      method: area.method as 'rule' | 'ai' | 'manual',
      evidenceIds: [...area.evidenceIds].sort(),
    },
    title: source.title,
    objective: source.objective ?? `Reach ${targetPage.id} through the directly observed ${element.id} interaction.`,
    preconditions: authentication.state === 'required'
      ? [{ kind: 'authenticated_role', roleId: flow.roleId, mechanism: authentication.mechanism! }]
      : [],
    steps: [{
      stepId: digestId('intent-step', intentId, 0, 'navigate'), ordinal: 0,
      kind: 'navigate_to_observed_route', subjectId: sourcePage.id, routePath: sourceRoute.normalizedPath,
    }, {
      stepId: digestId('intent-step', intentId, 1, 'click'), ordinal: 1,
      kind: 'click_observed_data_test', subjectId: sourcePage.id, elementId: element.id,
      dataTestValue: dataTests[0].value, targetSubjectId: targetPage.id,
    }],
    expectedOutcomes: [{
      outcomeId: digestId('manual-outcome', intentId, targetPage.id), kind: 'subject_observable',
      subjectId: targetPage.id, routePath: targetRoute.normalizedPath,
    }],
    grounding: {
      modelRowId: evidence.authority.modelRowId,
      modelVersion: evidence.authority.modelVersion,
      observationRunId: evidence.authority.observationRunId,
      supportSealHash: evidence.authority.supportSealHash,
      sourceFlowId: flow.id,
      selectedFlowStepIndexes: [step.stepIndex],
      excludedFlowStepIndexes: excluded,
      subjectSupport: support,
    },
    evidenceAssessment: {
      state: 'sufficient', sourceFlowConfidence: flow.confidence as 'observed' | 'partial',
      selectedStepGrounding: 'observed', limitations,
    },
    disposition: { state: 'supported' },
  }
  const normalized = materializeSupportedNormalizedTestIntentV1(normalizedIntent)
  const sourceSubjectSupport = support.find(item => item.canonicalSubjectId === sourcePage.id)!
  const proposal = materializeManualAutomationProposalV1({
    schemaVersion: 'forge-manual-automation-proposal/v1',
    projectId: source.projectId,
    sourceAuthority: { sourceId: source.sourceId, sourceContentHash: source.contentHash },
    authority: {
      modelRowId: evidence.authority.modelRowId,
      modelVersion: evidence.authority.modelVersion,
      observationRunId: evidence.authority.observationRunId,
      supportSealHash: evidence.authority.supportSealHash,
      routeEvidenceIdentityHash: evidence.routeEvidence.identityHash,
      authenticationExpectationIdentityHash: authentication.identityHash,
    },
    appArea: { ...normalized.value.appArea, evidenceIds: [...normalized.value.appArea.evidenceIds] },
    normalizedIntent: normalized.value,
    normalizedIntentContentHash: normalized.fingerprint,
    sourceGrounding: [{
      sourceRef: { kind: 'step', ordinal: 1 }, status: 'grounded',
      canonicalBinding: { kind: 'action', ordinal: 0 },
      basis: { kind: 'governed_route', flowStepIndex: null, evidenceIds: [...sourceRoute.supportingObservationIds] },
    }, {
      sourceRef: { kind: 'step', ordinal: 2 }, status: 'grounded',
      canonicalBinding: { kind: 'action', ordinal: 1 },
      basis: { kind: 'observed_flow_step', flowStepIndex: step.stepIndex, evidenceIds: [...sourceSubjectSupport.supportingObservationIds] },
    }, {
      sourceRef: { kind: 'expected_outcome' }, status: 'grounded',
      canonicalBinding: { kind: 'oracle', oracleKind: 'subject_observable' },
      basis: { kind: 'governed_subject', flowStepIndex: null, evidenceIds: [...targetRoute.supportingObservationIds] },
    }],
    canonicalActions: normalized.value.steps.map(action => ({ ...action })),
    oracle: {
      kind: 'subject_observable', subjectId: targetPage.id, routePath: targetRoute.normalizedPath,
      supportingObservationIds: [...targetRoute.supportingObservationIds],
      explanation: `The governed target subject is observable at the expected ${area.name} route.`,
    },
    authenticationExpectation: {
      ...authentication,
      bases: authentication.bases.map(basis => ({ ...basis })),
    },
    limitations,
    disposition: { state: 'supported' },
  })
  return { schemaVersion: 'forge-manual-analysis-result/v1', outcome: { kind: 'proposal', proposal } }
}

export class ManualTestIngestionService {
  constructor(
    private readonly sources = new ManualTestSourceRepository(),
    private readonly testSets = new TestSetRepository(),
    private readonly evidence = new CanonicalManualAnalysisEvidenceReader(),
    private readonly now = () => new Date().toISOString(),
    private readonly prepare = async () => { assertProductDatabaseAuthority(); await runMigrations() },
    private readonly generationId = () => crypto.randomUUID(),
    private readonly readAuthenticationIdentity = (projectId: string, workspaceRoot: string) =>
      new AuthenticationExpectationProjectionService().read(projectId, workspaceRoot).identityHash,
  ) {}

  async analyze(projectId: string, workspaceRoot: string, input: unknown): Promise<{ source: ManualTestSourceV1; analysis: ManualAnalysisResultV1 }> {
    await this.prepare()
    const parsed = parseManualTestSourceInputV1(input)
    const source = await this.sources.admit(projectId, parsed, this.now())
    const evidence = await this.evidence.read(projectId, workspaceRoot)
    return { source, analysis: analyzeManualTestSourceV1(source, evidence) }
  }

  async save(projectId: string, workspaceRoot: string, requestValue: unknown): Promise<ManualPromotionResultV1> {
    await this.prepare()
    const request = parseManualPromotionRequestV1(requestValue)
    try {
      assertManualProposalIdentity(projectId, request.reviewedProposalAuthority.proposalId, request.reviewedProposalAuthority.proposalContentHash)
    } catch {
      throw new ManualTestPromotionError('MANUAL_PROMOTION_IDENTITY_CONFLICT')
    }
    const source = await this.sources.read(projectId, request.sourceAuthority.sourceId)
    if (!source || source.contentHash !== request.sourceAuthority.sourceContentHash) {
      throw new ManualTestPromotionError('SOURCE_PROPOSAL_MISMATCH')
    }
    const replay = await this.testSets.findManualPromotion(projectId, request.reviewedProposalAuthority.proposalId)
    if (replay) {
      if (replay.sourceAuthority.sourceId !== source.sourceId
        || replay.sourceAuthority.sourceContentHash !== source.contentHash
        || replay.proposalAuthority.proposalContentHash !== request.reviewedProposalAuthority.proposalContentHash) {
        throw new ManualTestPromotionError('MANUAL_PROMOTION_IDENTITY_CONFLICT')
      }
      return replay
    }
    const currentEvidence = await this.evidence.read(projectId, workspaceRoot)
    const current = analyzeManualTestSourceV1(source, currentEvidence)
    if (current.outcome.kind !== 'proposal') throw new ManualTestPromotionError('MANUAL_PROPOSAL_NOT_EXECUTABLE')
    const proposal = current.outcome.proposal
    if (proposal.proposalId !== request.reviewedProposalAuthority.proposalId
      || proposal.proposalContentHash !== request.reviewedProposalAuthority.proposalContentHash) {
      throw new ManualTestPromotionError('STALE_REVIEWED_PROPOSAL')
    }
    if (!currentEvidence) throw new ManualTestPromotionError('MANUAL_PROPOSAL_NOT_EXECUTABLE')
    const generationId = this.generationId()
    const startedAt = this.now()
    await this.testSets.beginGeneration(projectId, generationId, PROCESS_INSTANCE_ID, startedAt)
    try {
      const recheckedEvidence = await this.evidence.read(projectId, workspaceRoot)
      const rechecked = analyzeManualTestSourceV1(source, recheckedEvidence)
      if (rechecked.outcome.kind !== 'proposal') throw new ManualTestPromotionError('MANUAL_PROPOSAL_NOT_EXECUTABLE')
      if (rechecked.outcome.proposal.proposalId !== proposal.proposalId
        || rechecked.outcome.proposal.proposalContentHash !== proposal.proposalContentHash) {
        throw new ManualTestPromotionError('STALE_REVIEWED_PROPOSAL')
      }
      const normalized = materializeSupportedNormalizedTestIntentV1(proposal.normalizedIntent)
      const committed = await this.testSets.commitCanonicalV3ManualPromotion({
        projectId,
        generatedAt: startedAt,
        authority: recheckedEvidence!.authority,
        routeEvidence: recheckedEvidence!.routeEvidence,
        authenticationExpectation: recheckedEvidence!.authenticationExpectation,
        normalizedIntent: normalized,
      }, generationId, PROCESS_INSTANCE_ID, proposal, () =>
        this.readAuthenticationIdentity(projectId, workspaceRoot)
          === proposal.authority.authenticationExpectationIdentityHash)
      return committed.result
    } catch (cause) {
      const failure = cause instanceof TestDefinitionContractError && cause.code === 'STALE_AUTHORITY'
        ? new ManualTestPromotionError('STALE_REVIEWED_PROPOSAL')
        : cause
      const code = failure instanceof ManualTestPromotionError || failure instanceof TestDefinitionContractError
        ? failure.code : 'PERSISTENCE_FAILED'
      await this.testSets.failGeneration(projectId, generationId, PROCESS_INSTANCE_ID, this.now(), code, failure instanceof Error ? failure.message : 'Manual promotion failed.')
      throw failure
    }
  }
}

export const manualTestIngestionService = new ManualTestIngestionService()
