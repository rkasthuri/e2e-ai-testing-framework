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

import {
  cloneValue,
  CertificationObservedSaveFailure,
  ReferenceM3CertificationDriver,
  type AnalyzeRequest,
  type AnalyzeResult,
  type AuthorityClass,
  type CertificationSaveFailureObservation,
  type DefinitionAuthority,
  type DefinitionObservation,
  type JsonObject,
  type M2Candidate,
  type ManualAnalysisResultV1,
  type ManualAutomationProposalV1,
  type ManualPromotionResultV1,
  type ManualTestSourceV1,
  type ResultsObservation,
  type SaveResult,
  type SharedM3Contracts,
  type StaleSaveScenario,
} from './driver';

export type AtomicityFailureHostile =
  | 'unrelated_type_error'
  | 'arbitrary_error'
  | 'frozen_save_failure'
  | 'transport_failure'
  | 'no_throw'
  | 'internal_with_residue';

export class AtomicityFailureHostileM3Adapter extends ReferenceM3CertificationDriver {
  override readonly name: string;
  override readonly authorityClass: AuthorityClass = 'product';

  constructor(
    contracts: SharedM3Contracts,
    readonly atomicityFault: AtomicityFailureHostile,
    private readonly failureObservation?: unknown,
  ) {
    super(contracts);
    this.name = `atomicity-failure-hostile-${atomicityFault}`;
  }

  override async readDefinition(
    projectId: string,
    definitionId: string,
  ): ReturnType<ReferenceM3CertificationDriver['readDefinition']> {
    const definition = await super.readDefinition(projectId, definitionId);
    if (definition) {
      (definition as any).oracle.explanation = 'Observe the sealed target subject at its governed final route after the directly observed click transition.';
    }
    return definition;
  }

  protected override async onPromotionFault(
    source: ManualTestSourceV1,
    proposal: ManualAutomationProposalV1,
    result: ManualPromotionResultV1,
    definition: DefinitionObservation,
  ): Promise<never> {
    if (this.atomicityFault === 'unrelated_type_error') throw new TypeError('unrelated adapter bug');
    if (this.atomicityFault === 'arbitrary_error') throw new Error('boom');
    if (this.atomicityFault === 'frozen_save_failure' || this.atomicityFault === 'transport_failure') {
      if (this.failureObservation === undefined) throw new Error('Hostile failure observation is required.');
      throw new CertificationObservedSaveFailure(
        this.failureObservation as CertificationSaveFailureObservation,
      );
    }
    if (this.atomicityFault === 'no_throw') return undefined as never;
    if (this.atomicityFault === 'internal_with_residue') {
      const rowId = this.persistedTestSetRevisions.length + 1;
      this.persistedDefinitions.push({
        projectId: source.projectId,
        testSetRowId: rowId,
        testSetId: result.definitionAuthority.testSetId,
        testSetRevision: result.definitionAuthority.testSetRevision,
        definitionOrdinal: 1,
        definitionId: `${result.definitionAuthority.definitionId}-fault-residue`,
        definitionSchemaVersion: 3,
      });
      this.persistedTestSetRevisions.push({
        rowId,
        projectId: source.projectId,
        testSetId: result.definitionAuthority.testSetId,
        revision: result.definitionAuthority.testSetRevision,
        generationId: 'fault-residue-generation',
        schemaVersion: 3,
        generatedAt: '2026-08-27T12:00:00.000Z',
        outcome: 'generated',
        definitionCount: 1,
        contentHash: result.definitionAuthority.testSetContentHash,
      });
    }
    return super.onPromotionFault(source, proposal, result, definition);
  }

  override async classifySaveFailure(error: unknown): Promise<CertificationSaveFailureObservation> {
    if (error instanceof CertificationObservedSaveFailure) {
      return this.failureObservation as CertificationSaveFailureObservation;
    }
    return super.classifySaveFailure(error);
  }
}

export const BROKEN_ADAPTER_FAULTS = Object.freeze([
  'rewrite_source',
  'zero_base_manual_ordinals',
  'one_base_canonical_actions',
  'stringify_app_area',
  'use_discovered_source',
  'drop_unsupported_source_line',
  'shorten_source_into_v3',
  'ignore_trailing_unsupported_step',
  'accept_action_body_at_save',
  'accept_authentication_body_at_save',
  'accept_definition_body_at_save',
  'skip_reanalysis',
  'accept_stale_model_evidence',
  'accept_stale_route',
  'accept_stale_data_test',
  'accept_stale_app_area',
  'accept_stale_auth',
  'accept_changed_current_proposal',
  'accept_current_reanalysis_refusal',
  'duplicate_definition_on_replay',
  'non_atomic_promotion_residue',
  'hidden_replay_persistence',
  'semantic_refusal_persists_authority',
  'embed_manual_promotion_in_v3',
  'promotion_wrong_definition_id',
  'promotion_wrong_test_set_revision',
  'promotion_wrong_test_set_hash',
  'missing_manual_promotion',
  'm2_translates_manual_provenance',
  'require_reference_hash',
  'float_results_provenance',
  'classify_corruption_as_semantic_refusal',
] as const);

export type BrokenAdapterFault = typeof BROKEN_ADAPTER_FAULTS[number];

export const STALE_CERTIFICATION_SCENARIO_BY_FAULT = Object.freeze({
  accept_stale_model_evidence: 'save_model_drift',
  accept_stale_route: 'save_route_drift',
  accept_stale_data_test: 'save_data_test_drift',
  accept_stale_app_area: 'save_app_area_drift',
  accept_stale_auth: 'save_auth_drift',
  accept_changed_current_proposal: 'save_reanalysis_different_proposal',
  accept_current_reanalysis_refusal: 'save_reanalysis_refuses',
} satisfies Readonly<Record<string, StaleSaveScenario>>);

export type StaleAcceptanceFault = keyof typeof STALE_CERTIFICATION_SCENARIO_BY_FAULT;

export type StaleSaveRevalidationDimension =
  | 'model_evidence'
  | 'governed_route'
  | 'data_test_selector'
  | 'app_area'
  | 'authentication'
  | 'deterministic_proposal'
  | 'semantic_executability';

export interface StaleSaveRevalidationTrace {
  fault: StaleAcceptanceFault;
  scenario: StaleSaveScenario;
  trustedDimension: StaleSaveRevalidationDimension;
  currentAnalysis: ManualAnalysisResultV1;
  comparisonProposal: ManualAutomationProposalV1;
}

export class DeliberatelyBrokenM3Adapter extends ReferenceM3CertificationDriver {
  override readonly name: string;
  override readonly authorityClass: AuthorityClass = 'product';
  private reviewedProposalDuringSave: ManualAutomationProposalV1 | null = null;
  private staleSaveTrace: StaleSaveRevalidationTrace | null = null;

  constructor(contracts: SharedM3Contracts, readonly fault: BrokenAdapterFault) {
    super(contracts);
    this.name = `deliberately-broken-m3-${fault}`;
  }

  override async analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult> {
    const activeScenario = request.scenario ?? this.scenario;
    const partialFault = this.fault === 'drop_unsupported_source_line'
      || this.fault === 'shorten_source_into_v3'
      || this.fault === 'ignore_trailing_unsupported_step';
    const matchingPartialScenario = activeScenario === 'partial_unsupported_fill_between'
      && this.fault !== 'ignore_trailing_unsupported_step'
      || activeScenario === 'partial_unsupported_trailing_step'
      && this.fault === 'ignore_trailing_unsupported_step';
    if (partialFault && matchingPartialScenario) {
      const retainedScenario = this.scenario;
      this.scenario = null;
      const clean = await super.analyzeManualTest({ source: request.source });
      this.scenario = retainedScenario;
      if (clean.kind !== 'analysis' || clean.result.outcome.kind !== 'proposal') return clean;
      const source = request.source as ManualTestSourceV1;
      const proposal = clean.result.outcome.proposal;
      proposal.proposalId = `partial-${this.fault}`;
      proposal.normalizedIntentContentHash = this.fault === 'drop_unsupported_source_line'
        ? '3'.repeat(64)
        : this.fault === 'shorten_source_into_v3' ? '4'.repeat(64) : '5'.repeat(64);
      proposal.proposalContentHash = this.fault === 'drop_unsupported_source_line'
        ? '6'.repeat(64)
        : this.fault === 'shorten_source_into_v3' ? '7'.repeat(64) : '8'.repeat(64);
      proposal.normalizedIntent.title = source.title;
      proposal.normalizedIntent.objective = source.objective;
      proposal.canonicalActions = [
        {
          stepId: 'partial-intent-checkout-nav',
          ordinal: 0,
          kind: 'navigate_to_observed_route',
          subjectId: 'subject-checkout-step-one',
          routePath: '/checkout-step-one.html',
        },
        {
          stepId: 'partial-intent-continue-click',
          ordinal: 1,
          kind: 'click_observed_data_test',
          subjectId: 'subject-checkout-step-one',
          elementId: 'subject-continue-control',
          dataTestValue: 'continue',
          targetSubjectId: 'subject-checkout-overview',
        },
      ];
      proposal.normalizedIntent.steps = cloneValue(proposal.canonicalActions);
      proposal.oracle = {
        kind: 'subject_observable',
        subjectId: 'subject-checkout-overview',
        routePath: '/checkout-step-two.html',
        supportingObservationIds: ['obs-overview-subject'],
        explanation: 'The governed checkout overview subject is observable.',
      };
      proposal.normalizedIntent.expectedOutcomes = [{
        outcomeId: 'partial-outcome-checkout-overview',
        kind: 'subject_observable',
        subjectId: 'subject-checkout-overview',
        routePath: '/checkout-step-two.html',
      }];
      const normalizedGrounding = proposal.normalizedIntent.grounding as JsonObject;
      normalizedGrounding.sourceFlowId = 'flow-checkout-continue';
      normalizedGrounding.selectedFlowStepIndexes = [1];

      if (this.fault === 'ignore_trailing_unsupported_step') {
        proposal.sourceGrounding = cloneValue(this.contracts.positiveProposal.sourceGrounding);
      } else {
        const frozen = this.contracts.refusals['unsupported-fill.json'];
        if (!frozen || frozen.outcome.kind !== 'refusal') throw new Error('Missing unsupported-fill refusal.');
        const grounding = cloneValue(frozen.outcome.refusal.sourceGrounding);
        if (this.fault === 'drop_unsupported_source_line') {
          proposal.sourceGrounding = [grounding[0]!, grounding[2]!, grounding[3]!];
        } else {
          const falselyGroundedFill = grounding[1]!;
          falselyGroundedFill.status = 'grounded';
          falselyGroundedFill.canonicalBinding = { kind: 'action', ordinal: 1 };
          proposal.sourceGrounding = grounding;
        }
      }
      this.proposals.set(proposal.proposalId, cloneValue(proposal));
      return clean;
    }
    const result = await super.analyzeManualTest(request);
    if (this.fault === 'semantic_refusal_persists_authority'
      && result.kind === 'analysis'
      && result.result.outcome.kind === 'refusal') {
      this.persistHiddenAuthority(request.source as ManualTestSourceV1, 'hidden-semantic-refusal');
    }
    if (this.reviewedProposalDuringSave) {
      return this.applyCategorySpecificStaleSaveDefect(result);
    }
    if (this.fault === 'classify_corruption_as_semantic_refusal' && result.kind === 'transport_error') {
      const refusal = cloneValue(this.contracts.refusals['insufficient-outcome.json']);
      return {
        kind: 'analysis',
        source: cloneValue(this.contracts.positiveSource),
        result: refusal,
      };
    }
    if (result.kind !== 'analysis') return result;
    if (result.result.outcome.kind !== 'proposal') return result;
    const proposal = result.result.outcome.proposal;
    if (this.fault === 'one_base_canonical_actions') {
      proposal.canonicalActions.forEach(action => { action.ordinal = Number(action.ordinal) + 1; });
      const steps = proposal.normalizedIntent.steps;
      if (Array.isArray(steps)) steps.forEach(step => {
        if (typeof step === 'object' && step !== null && 'ordinal' in step) {
          (step as Record<string, unknown>).ordinal = Number((step as Record<string, unknown>).ordinal) + 1;
        }
      });
    }
    if (this.fault === 'stringify_app_area') {
      (proposal as unknown as Record<string, unknown>).appArea = 'checkout';
      proposal.normalizedIntent.appArea = 'checkout';
    }
    if (this.fault === 'use_discovered_source') proposal.normalizedIntent.source = 'discovered';
    return result;
  }

  readStaleSaveRevalidationTrace(): StaleSaveRevalidationTrace | null {
    return this.staleSaveTrace ? cloneValue(this.staleSaveTrace) : null;
  }

  private applyCategorySpecificStaleSaveDefect(current: AnalyzeResult): AnalyzeResult {
    const reviewed = this.reviewedProposalDuringSave;
    if (!reviewed || !this.scenario) return current;

    if (this.fault === 'accept_current_reanalysis_refusal'
      && this.scenario === 'save_reanalysis_refuses'
      && current.kind === 'analysis'
      && current.result.outcome.kind === 'refusal') {
      const comparisonProposal = cloneValue(reviewed);
      this.recordStaleSaveTrace('semantic_executability', current.result, comparisonProposal);
      return {
        kind: 'analysis',
        source: cloneValue(current.source),
        result: proposalResult(comparisonProposal),
      };
    }

    if (current.kind !== 'analysis' || current.result.outcome.kind !== 'proposal') return current;
    const currentResult = cloneValue(current.result);
    const comparisonProposal = current.result.outcome.proposal;

    if (this.fault === 'accept_stale_model_evidence' && this.scenario === 'save_model_drift') {
      this.trustReviewedModelEvidence(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('model_evidence', currentResult, comparisonProposal);
    } else if (this.fault === 'accept_stale_route' && this.scenario === 'save_route_drift') {
      this.trustReviewedGovernedRoute(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('governed_route', currentResult, comparisonProposal);
    } else if (this.fault === 'accept_stale_data_test' && this.scenario === 'save_data_test_drift') {
      this.trustReviewedDataTestSelector(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('data_test_selector', currentResult, comparisonProposal);
    } else if (this.fault === 'accept_stale_app_area' && this.scenario === 'save_app_area_drift') {
      this.trustReviewedAppArea(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('app_area', currentResult, comparisonProposal);
    } else if (this.fault === 'accept_stale_auth' && this.scenario === 'save_auth_drift') {
      this.trustReviewedAuthentication(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('authentication', currentResult, comparisonProposal);
    } else if (this.fault === 'accept_changed_current_proposal'
      && this.scenario === 'save_reanalysis_different_proposal') {
      this.trustReviewedDeterministicProposalMaterial(comparisonProposal, reviewed);
      this.acceptReviewedProposalIdentity(comparisonProposal, reviewed);
      this.recordStaleSaveTrace('deterministic_proposal', currentResult, comparisonProposal);
    }
    return current;
  }

  private acceptReviewedProposalIdentity(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.proposalId = reviewed.proposalId;
    comparison.normalizedIntentContentHash = reviewed.normalizedIntentContentHash;
    comparison.proposalContentHash = reviewed.proposalContentHash;
  }

  private trustReviewedModelEvidence(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.authority.modelRowId = reviewed.authority.modelRowId;
    comparison.authority.modelVersion = reviewed.authority.modelVersion;
    comparison.authority.supportSealHash = reviewed.authority.supportSealHash;
    const comparisonGrounding = comparison.normalizedIntent.grounding as JsonObject;
    const reviewedGrounding = reviewed.normalizedIntent.grounding as JsonObject;
    comparisonGrounding.modelRowId = reviewedGrounding.modelRowId;
    comparisonGrounding.modelVersion = reviewedGrounding.modelVersion;
    comparisonGrounding.supportSealHash = reviewedGrounding.supportSealHash;
    comparisonGrounding.subjectSupport = cloneValue(reviewedGrounding.subjectSupport);
  }

  private trustReviewedGovernedRoute(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.authority.routeEvidenceIdentityHash = reviewed.authority.routeEvidenceIdentityHash;
    comparison.canonicalActions[0] = cloneValue(reviewed.canonicalActions[0]!);
    (comparison.normalizedIntent.steps as JsonObject[])[0] = cloneValue(
      (reviewed.normalizedIntent.steps as JsonObject[])[0]!,
    );
    comparison.sourceGrounding[0] = cloneValue(reviewed.sourceGrounding[0]!);
  }

  private trustReviewedDataTestSelector(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.canonicalActions[1] = cloneValue(reviewed.canonicalActions[1]!);
    (comparison.normalizedIntent.steps as JsonObject[])[1] = cloneValue(
      (reviewed.normalizedIntent.steps as JsonObject[])[1]!,
    );
    comparison.sourceGrounding[1] = cloneValue(reviewed.sourceGrounding[1]!);
  }

  private trustReviewedAppArea(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.appArea = cloneValue(reviewed.appArea);
    comparison.normalizedIntent.appArea = cloneValue(reviewed.normalizedIntent.appArea);
  }

  private trustReviewedAuthentication(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.authority.authenticationExpectationIdentityHash =
      reviewed.authority.authenticationExpectationIdentityHash;
    comparison.authenticationExpectation = cloneValue(reviewed.authenticationExpectation);
    comparison.normalizedIntent.preconditions = cloneValue(reviewed.normalizedIntent.preconditions);
  }

  private trustReviewedDeterministicProposalMaterial(
    comparison: ManualAutomationProposalV1,
    reviewed: ManualAutomationProposalV1,
  ): void {
    comparison.limitations = cloneValue(reviewed.limitations);
    const comparisonAssessment = comparison.normalizedIntent.evidenceAssessment as JsonObject;
    const reviewedAssessment = reviewed.normalizedIntent.evidenceAssessment as JsonObject;
    comparisonAssessment.limitations = cloneValue(reviewedAssessment.limitations);
  }

  private recordStaleSaveTrace(
    trustedDimension: StaleSaveRevalidationDimension,
    currentAnalysis: ManualAnalysisResultV1,
    comparisonProposal: ManualAutomationProposalV1,
  ): void {
    this.staleSaveTrace = {
      fault: this.fault as StaleAcceptanceFault,
      scenario: this.scenario as StaleSaveScenario,
      trustedDimension,
      currentAnalysis: cloneValue(currentAnalysis),
      comparisonProposal: cloneValue(comparisonProposal),
    };
  }

  override async readManualSource(projectId: string, sourceId: string): Promise<ManualTestSourceV1 | null> {
    const source = await super.readManualSource(projectId, sourceId);
    if (!source) return null;
    if (this.fault === 'rewrite_source') source.title = source.title.trim().toLowerCase();
    if (this.fault === 'zero_base_manual_ordinals') {
      source.steps.forEach((step, index) => { step.ordinal = index; });
    }
    return source;
  }

  override async saveReviewedProposal(request: unknown): Promise<SaveResult> {
    let effective = request;
    let injectedAuthentication: JsonObject | null = null;
    let injectedDefinition: DefinitionObservation | null = null;
    if (this.fault === 'accept_action_body_at_save' && typeof request === 'object' && request !== null) {
      const { actions: _actions, selector: _selector, appArea: _appArea, oracle: _oracle, ...identities } = request as Record<string, unknown>;
      effective = identities;
    }
    if (this.fault === 'accept_authentication_body_at_save' && typeof request === 'object' && request !== null) {
      const { authentication, ...identities } = request as Record<string, unknown>;
      effective = identities;
      if (typeof authentication === 'object' && authentication !== null && !Array.isArray(authentication)) {
        injectedAuthentication = cloneValue(authentication as JsonObject);
      }
    }
    if (this.fault === 'accept_definition_body_at_save' && typeof request === 'object' && request !== null) {
      const { definition, ...identities } = request as Record<string, unknown>;
      effective = identities;
      if (typeof definition === 'object' && definition !== null && !Array.isArray(definition)) {
        injectedDefinition = cloneValue(definition as DefinitionObservation);
      }
    }
    if (this.fault === 'require_reference_hash' && typeof request === 'object' && request !== null) {
      const proposalAuthority = (request as Record<string, unknown>).proposalAuthority as Record<string, unknown> | undefined;
      const sourceAuthority = (request as Record<string, unknown>).sourceAuthority as Record<string, unknown> | undefined;
      if (sourceAuthority?.sourceContentHash !== 'a'.repeat(64) || proposalAuthority?.proposalContentHash !== 'b'.repeat(64)) {
        return { kind: 'refused', code: 'REFERENCE_HASH_REQUIRED' };
      }
    }
    this.staleSaveTrace = null;
    this.reviewedProposalDuringSave = this.reviewedProposalForSave(effective);
    let saved: SaveResult;
    try {
      saved = await super.saveReviewedProposal(effective);
    } catch (error) {
      if (error instanceof BrokenAtomicSuccess) saved = error.reported;
      else throw error;
    } finally {
      this.reviewedProposalDuringSave = null;
    }
    if (saved.kind !== 'promoted') return saved;
    if (injectedAuthentication) {
      const definition = this.definitions.get(saved.result.definitionAuthority.definitionId);
      const authority = injectedAuthentication.authority;
      const expectation = injectedAuthentication.expectation;
      const preconditions = injectedAuthentication.preconditions;
      if (definition
        && typeof authority === 'object' && authority !== null && !Array.isArray(authority)
        && typeof expectation === 'object' && expectation !== null && !Array.isArray(expectation)
        && Array.isArray(preconditions)) {
        const trustedExpectation = cloneValue(expectation as JsonObject);
        trustedExpectation.identityHash = (authority as JsonObject).authenticationExpectationIdentityHash;
        definition.authenticationExpectation = trustedExpectation;
        definition.normalizedIntent.preconditions = cloneValue(preconditions);
      }
    }
    if (injectedDefinition) {
      this.definitions.set(
        saved.result.definitionAuthority.definitionId,
        cloneValue(injectedDefinition),
      );
    }
    if (this.fault === 'skip_reanalysis') saved.reanalysisPerformed = false;
    if (this.fault === 'duplicate_definition_on_replay' && saved.replayed) {
      saved.result.definitionAuthority.testSetRevision += 1;
      saved.result.definitionAuthority.definitionId = 'duplicate-definition-on-replay';
    }
    if (this.fault === 'hidden_replay_persistence' && saved.replayed) {
      this.persistHiddenAuthorityForResult(saved.result, 'hidden-replay');
    }
    if (this.fault === 'embed_manual_promotion_in_v3') {
      const definition = this.definitions.get(saved.result.definitionAuthority.definitionId);
      if (definition) {
        definition.manualPromotion = {
          sourceAuthority: cloneValue(saved.result.sourceAuthority),
          proposalAuthority: cloneValue(saved.result.proposalAuthority),
        };
      }
    }
    const promotion = this.promotions.get(saved.result.definitionAuthority.definitionId);
    if (promotion && this.fault === 'promotion_wrong_definition_id') {
      promotion.definitionAuthority.definitionId = 'wrong-definition-id';
    }
    if (promotion && this.fault === 'promotion_wrong_test_set_revision') {
      promotion.definitionAuthority.testSetRevision += 1;
    }
    if (promotion && this.fault === 'promotion_wrong_test_set_hash') {
      promotion.definitionAuthority.testSetContentHash = 'f'.repeat(64);
    }
    if (this.fault === 'missing_manual_promotion') {
      this.promotions.delete(saved.result.definitionAuthority.definitionId);
    }
    return saved;
  }

  protected override async onPromotionFault(
    source: ManualTestSourceV1,
    proposal: ManualAutomationProposalV1,
    result: ManualPromotionResultV1,
    _definition: DefinitionObservation,
  ): Promise<never> {
    if (this.fault !== 'non_atomic_promotion_residue') {
      return super.onPromotionFault(source, proposal, result, _definition);
    }
    this.persistHiddenAuthorityForResult(result, 'hidden-non-atomic', false);
    throw new BrokenAtomicSuccess({
      kind: 'promoted',
      result: cloneValue(result),
      reanalysisPerformed: true,
      replayed: false,
      atomic: true,
    });
  }

  private persistHiddenAuthority(source: ManualTestSourceV1, label: string): void {
    const result = cloneValue(this.contracts.positiveSaveResult);
    result.sourceAuthority = { sourceId: source.sourceId, sourceContentHash: source.contentHash };
    result.proposalAuthority = { proposalId: label, proposalContentHash: '9'.repeat(64) };
    result.definitionAuthority.definitionId = `${label}-definition`;
    result.definitionAuthority.testSetId = `${label}-test-set`;
    result.definitionAuthority.testSetContentHash = '8'.repeat(64);
    this.persistHiddenAuthorityForResult(result, label);
  }

  private persistHiddenAuthorityForResult(
    result: ManualPromotionResultV1,
    label: string,
    includePromotion = true,
  ): void {
    const rowId = this.persistedTestSetRevisions.length + 1;
    this.persistedDefinitions.push({
      projectId: this.contracts.positiveSource.projectId,
      testSetRowId: rowId,
      testSetId: result.definitionAuthority.testSetId,
      testSetRevision: result.definitionAuthority.testSetRevision,
      definitionOrdinal: 1,
      definitionId: `${result.definitionAuthority.definitionId}-${label}`,
      definitionSchemaVersion: 3,
    });
    this.persistedTestSetRevisions.push({
      rowId,
      projectId: this.contracts.positiveSource.projectId,
      testSetId: result.definitionAuthority.testSetId,
      revision: result.definitionAuthority.testSetRevision,
      generationId: `${label}-generation`,
      schemaVersion: 3,
      generatedAt: '2026-08-27T12:00:00.000Z',
      outcome: 'generated',
      definitionCount: 1,
      contentHash: result.definitionAuthority.testSetContentHash,
    });
    if (includePromotion) {
      const hiddenProposal = cloneValue(this.contracts.positiveProposal);
      hiddenProposal.proposalId = result.proposalAuthority.proposalId;
      hiddenProposal.projectId = this.contracts.positiveSource.projectId;
      hiddenProposal.normalizedIntent.projectId = this.contracts.positiveSource.projectId;
      hiddenProposal.sourceAuthority = cloneValue(result.sourceAuthority);
      hiddenProposal.proposalContentHash = result.proposalAuthority.proposalContentHash;
      this.persistedPromotions.push({
        proposalId: result.proposalAuthority.proposalId,
        projectId: this.contracts.positiveSource.projectId,
        proposalSchemaVersion: 'forge-manual-automation-proposal/v1',
        sourceId: result.sourceAuthority.sourceId,
        sourceContentHash: result.sourceAuthority.sourceContentHash,
        proposalPayloadJson: JSON.stringify(hiddenProposal),
        proposalContentHash: result.proposalAuthority.proposalContentHash,
        testSetRowId: rowId,
        testSetId: result.definitionAuthority.testSetId,
        testSetRevision: result.definitionAuthority.testSetRevision,
        testSetContentHash: result.definitionAuthority.testSetContentHash,
        definitionId: result.definitionAuthority.definitionId,
        promotedAt: '2026-08-27T12:00:00.000Z',
      });
    }
  }

  private reviewedProposalForSave(request: unknown): ManualAutomationProposalV1 | null {
    if (typeof request !== 'object' || request === null) return null;
    const proposalAuthority = (request as Record<string, unknown>).proposalAuthority;
    if (typeof proposalAuthority !== 'object' || proposalAuthority === null) return null;
    const proposalId = (proposalAuthority as Record<string, unknown>).proposalId;
    return typeof proposalId === 'string'
      ? cloneValue(this.proposals.get(proposalId) ?? null)
      : null;
  }

  override async readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null> {
    return super.readDefinition(projectId, definitionId);
  }

  override async addDefinitionToSuite(projectId: string, definitionAuthority: DefinitionAuthority): Promise<M2Candidate | null> {
    const candidate = await super.addDefinitionToSuite(projectId, definitionAuthority);
    if (candidate && this.fault === 'm2_translates_manual_provenance') {
      candidate.manualPromotion = cloneValue(this.promotions.get(definitionAuthority.definitionId));
    }
    return candidate;
  }

  override async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const results = await super.readResults(projectId, executionId);
    if (results && this.fault === 'float_results_provenance') {
      results.promotion.proposalAuthority.proposalContentHash = '0'.repeat(64);
    }
    return results;
  }
}

class BrokenAtomicSuccess extends Error {
  constructor(readonly reported: Extract<SaveResult, { kind: 'promoted' }>) {
    super('Broken Product converted an intra-transaction failure into reported atomic success.');
    this.name = 'BrokenAtomicSuccess';
  }
}

export function proposalResult(proposal: ManualAutomationProposalV1): ManualAnalysisResultV1 {
  return {
    schemaVersion: 'forge-manual-analysis-result/v1',
    outcome: { kind: 'proposal', proposal: cloneValue(proposal) },
  };
}
