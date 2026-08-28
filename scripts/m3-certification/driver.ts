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

export type JsonObject = Record<string, unknown>;
export type AuthorityClass = 'reference' | 'product';
export type RefusalCode =
  | 'insufficient_evidence'
  | 'ambiguous_evidence'
  | 'unsupported_semantics'
  | 'app_area_unknown';

export interface ManualStepV1 {
  ordinal: number;
  text: string;
}

export interface ManualTestSourceV1 extends JsonObject {
  schemaVersion: 'forge-manual-test-source/v1';
  sourceId: string;
  projectId: string;
  sourceKind: 'manual';
  title: string;
  objective: string | null;
  steps: ManualStepV1[];
  expectedOutcome: string;
  contentHash: string;
}

export interface SourceAuthority extends JsonObject {
  sourceId: string;
  sourceContentHash: string;
}

export interface ProposalIdentity extends JsonObject {
  proposalId: string;
  proposalContentHash: string;
}

export interface ManualAutomationProposalV1 extends JsonObject {
  schemaVersion: 'forge-manual-automation-proposal/v1';
  proposalId: string;
  projectId: string;
  sourceAuthority: SourceAuthority;
  authority: JsonObject;
  appArea: JsonObject;
  normalizedIntent: JsonObject;
  normalizedIntentContentHash: string;
  sourceGrounding: JsonObject[];
  canonicalActions: JsonObject[];
  oracle: JsonObject;
  authenticationExpectation: JsonObject;
  limitations: string[];
  disposition: { state: 'supported' };
  proposalContentHash: string;
}

export interface ManualAutomationRefusalV1 extends JsonObject {
  schemaVersion: 'forge-manual-automation-refusal/v1';
  projectId: string;
  sourceAuthority: SourceAuthority;
  code: RefusalCode;
  evidenceState: string;
  safeMessage: string;
  sourceGrounding: JsonObject[];
  limitations: string[];
}

export type ManualAnalysisResultV1 = {
  schemaVersion: 'forge-manual-analysis-result/v1';
  outcome:
    | { kind: 'proposal'; proposal: ManualAutomationProposalV1 }
    | { kind: 'refusal'; refusal: ManualAutomationRefusalV1 };
};

export interface DefinitionAuthority extends JsonObject {
  definitionId: string;
  definitionSchemaVersion: 3;
  testSetId: string;
  testSetRevision: number;
  testSetContentHash: string;
}

export interface ManualPromotionResultV1 extends JsonObject {
  schemaVersion: 'forge-manual-promotion-result/v1';
  outcome: 'promoted';
  sourceAuthority: SourceAuthority;
  proposalAuthority: ProposalIdentity;
  definitionAuthority: DefinitionAuthority;
}

export interface SharedM3Contracts {
  positiveSource: ManualTestSourceV1;
  positiveProposal: ManualAutomationProposalV1;
  positiveSaveResult: ManualPromotionResultV1;
  refusals: Readonly<Record<string, ManualAnalysisResultV1>>;
}

export type AnalyzeResult =
  | { kind: 'analysis'; source: ManualTestSourceV1; result: ManualAnalysisResultV1 }
  | { kind: 'transport_error'; code: 'MANUAL_SOURCE_INVALID' };

export type SaveResult =
  | {
      kind: 'promoted';
      result: ManualPromotionResultV1;
      reanalysisPerformed: boolean;
      replayed: boolean;
      atomic: boolean;
    }
  | { kind: 'refused'; code: string };

export type CertificationSaveFailureKind = 'internal' | 'transport' | 'save_failure' | 'unexpected';

export interface CertificationSaveFailureObservation extends JsonObject {
  kind: CertificationSaveFailureKind;
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

export const CONTROLLED_PROMOTION_FAULT_CODE = 'CERTIFICATION_PROMOTION_FAULT';

export interface DefinitionObservation extends JsonObject {
  schemaVersion: 3;
  projectId: string;
  definitionAuthority: DefinitionAuthority;
  normalizedIntent: JsonObject;
  appArea: JsonObject;
  canonicalActions: JsonObject[];
  oracle: JsonObject;
  authenticationExpectation: JsonObject;
}

export interface DefinitionPresentation extends JsonObject {
  definitionAuthority: DefinitionAuthority;
  promotion: ManualPromotionResultV1;
}

export interface M2Candidate extends JsonObject {
  projectId: string;
  executable: boolean;
  definitionAuthority: DefinitionAuthority;
}

export interface ExecutionObservation extends JsonObject {
  executionId: string;
  definitionAuthority: DefinitionAuthority;
  promotion: ManualPromotionResultV1;
}

export interface ResultsObservation extends JsonObject {
  executionId: string;
  outcome: 'passed';
  definitionAuthority: DefinitionAuthority;
  promotion: ManualPromotionResultV1;
}

export interface CertificationPersistenceCounts extends JsonObject {
  manualTestSources: number;
  definitions: number;
  testSetRevisions: number;
  manualTestPromotions: number;
}

export interface CertificationManualSourceRow extends JsonObject {
  sourceId: string;
  projectId: string;
  schemaVersion: string;
  sourceKind: string;
  payloadJson: string;
  payload?: ManualTestSourceV1;
  contentHash: string;
  admittedAt: string;
}

export interface CertificationDefinitionRow extends JsonObject {
  projectId: string;
  testSetRowId: number;
  testSetId: string;
  testSetRevision: number;
  definitionOrdinal: number;
  definitionId: string;
  definitionSchemaVersion: number;
}

export interface CertificationTestSetRevisionRow extends JsonObject {
  rowId: number;
  projectId: string;
  testSetId: string;
  revision: number;
  generationId: string;
  schemaVersion: number;
  generatedAt: string;
  outcome: string;
  definitionCount: number;
  contentHash: string;
}

export interface CertificationManualPromotionRow extends JsonObject {
  proposalId: string;
  projectId: string;
  proposalSchemaVersion: string;
  sourceId: string;
  sourceContentHash: string;
  proposalPayloadJson: string;
  proposalPayload?: ManualAutomationProposalV1;
  proposalContentHash: string;
  testSetRowId: number;
  testSetId: string;
  testSetRevision: number;
  testSetContentHash: string;
  definitionId: string;
  promotedAt: string;
}

export interface CertificationPersistenceInventory extends JsonObject {
  projectId: string;
  counts: CertificationPersistenceCounts;
  manualTestSources: CertificationManualSourceRow[];
  definitions: CertificationDefinitionRow[];
  testSetRevisions: CertificationTestSetRevisionRow[];
  manualTestPromotions: CertificationManualPromotionRow[];
}

export class CertificationPromotionFault extends Error {
  constructor() {
    super('Certification-injected internal promotion failure.');
    this.name = 'CertificationPromotionFault';
  }
}

export class CertificationObservedSaveFailure extends Error {
  constructor(readonly observation: CertificationSaveFailureObservation) {
    super(observation.message ?? observation.code ?? 'Observed Save failure.');
    this.name = 'CertificationObservedSaveFailure';
  }
}

export interface AnalyzeRequest {
  source: unknown;
  scenario?: string;
}

export const STALE_SAVE_SCENARIOS = Object.freeze([
  'save_model_drift',
  'save_route_drift',
  'save_data_test_drift',
  'save_app_area_drift',
  'save_auth_drift',
  'save_reanalysis_different_proposal',
  'save_reanalysis_refuses',
] as const);

export type StaleSaveScenario = typeof STALE_SAVE_SCENARIOS[number];

export interface M3CertificationDriver {
  readonly name: string;
  readonly authorityClass: AuthorityClass;
  configureCertificationScenario(scenario: string | null): Promise<void>;
  snapshot(projectId: string): Promise<CertificationPersistenceInventory>;
  armPromotionFaultOnce(): Promise<void>;
  disarmPromotionFault(): Promise<void>;
  classifySaveFailure(error: unknown): Promise<CertificationSaveFailureObservation>;
  analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult>;
  readManualSource(projectId: string, sourceId: string): Promise<ManualTestSourceV1 | null>;
  saveReviewedProposal(request: unknown): Promise<SaveResult>;
  readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null>;
  readManualPromotion(projectId: string, definitionAuthority: DefinitionAuthority): Promise<ManualPromotionResultV1 | null>;
  readDefinitionPresentation(projectId: string, definitionId: string): Promise<DefinitionPresentation | null>;
  addDefinitionToSuite(projectId: string, definitionAuthority: DefinitionAuthority): Promise<M2Candidate | null>;
  startExecution(projectId: string, definitionAuthority: DefinitionAuthority): Promise<{ kind: 'accepted'; executionId: string } | { kind: 'refused' }>;
  readResults(projectId: string, executionId: string): Promise<ResultsObservation | null>;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validManualSource(value: unknown): value is ManualTestSourceV1 {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== 'forge-manual-test-source/v1' || value.sourceKind !== 'manual') return false;
  if (typeof value.sourceId !== 'string' || typeof value.projectId !== 'string') return false;
  if (typeof value.title !== 'string' || value.title.length === 0) return false;
  if (!(value.objective === null || (typeof value.objective === 'string' && value.objective.length > 0))) return false;
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 50) return false;
  if (typeof value.expectedOutcome !== 'string' || value.expectedOutcome.length === 0) return false;
  if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)) return false;
  return value.steps.every((step, index) => isObject(step)
    && step.ordinal === index + 1
    && typeof step.text === 'string'
    && step.text.length > 0);
}

const REFUSAL_BY_SCENARIO: Readonly<Record<string, string>> = {
  unsupported_fill: 'unsupported-fill.json',
  ambiguous_control: 'ambiguous-control.json',
  insufficient_outcome: 'insufficient-outcome.json',
  app_area_unknown: 'app-area-unknown.json',
  grounding_navigation_claims_flow_step: 'insufficient-outcome.json',
  grounding_click_missing_observed_step: 'insufficient-outcome.json',
  grounding_click_inferred_only: 'insufficient-outcome.json',
  grounding_missing_data_test: 'unsupported-fill.json',
  grounding_multiple_data_test: 'ambiguous-control.json',
  grounding_two_matching_controls: 'ambiguous-control.json',
  grounding_target_page_missing: 'insufficient-outcome.json',
  grounding_target_page_ambiguous: 'ambiguous-control.json',
  grounding_app_area_missing: 'app-area-unknown.json',
  grounding_app_area_ambiguous: 'app-area-unknown.json',
  grounding_auth_unknown: 'insufficient-outcome.json',
  grounding_auth_conflicted: 'ambiguous-control.json',
  grounding_auth_unsupported: 'unsupported-fill.json',
  partial_unsupported_fill_between: 'unsupported-fill.json',
  partial_unsupported_trailing_step: 'unsupported-fill.json',
  save_reanalysis_refuses: 'insufficient-outcome.json',
};

type SupportedStaleSaveScenario = Exclude<StaleSaveScenario, 'save_reanalysis_refuses'>;

function changedProposal(
  proposal: ManualAutomationProposalV1,
  scenario: SupportedStaleSaveScenario,
  normalizedHashDigit: string,
  proposalHashDigit: string,
  change: (value: ManualAutomationProposalV1) => void,
): void {
  change(proposal);
  proposal.proposalId = `current-${scenario.replaceAll('_', '-')}`;
  proposal.normalizedIntentContentHash = normalizedHashDigit.repeat(64);
  proposal.proposalContentHash = proposalHashDigit.repeat(64);
}

const CURRENT_PROPOSAL_SETUP: Readonly<Record<SupportedStaleSaveScenario, (proposal: ManualAutomationProposalV1) => void>> = {
  save_model_drift: proposal => changedProposal(proposal, 'save_model_drift', '1', '2', value => {
    value.authority.modelRowId = Number(value.authority.modelRowId) + 1;
    value.authority.modelVersion = 'app-model-current-revision-02';
    value.authority.supportSealHash = '1'.repeat(64);
    const grounding = value.normalizedIntent.grounding as JsonObject;
    grounding.modelRowId = value.authority.modelRowId;
    grounding.modelVersion = value.authority.modelVersion;
    grounding.supportSealHash = value.authority.supportSealHash;
    const subjectSupport = grounding.subjectSupport as JsonObject[];
    subjectSupport[0]!.supportingObservationIds = ['obs-current-selected-control'];
  }),
  save_route_drift: proposal => changedProposal(proposal, 'save_route_drift', '2', '3', value => {
    value.authority.routeEvidenceIdentityHash = '2'.repeat(64);
    value.canonicalActions[0]!.routePath = '/cart-current.html';
    (value.normalizedIntent.steps as JsonObject[])[0]!.routePath = '/cart-current.html';
    value.sourceGrounding[0]!.basis = {
      kind: 'governed_route',
      flowStepIndex: null,
      evidenceIds: ['obs-current-cart-route'],
    };
  }),
  save_data_test_drift: proposal => changedProposal(proposal, 'save_data_test_drift', '3', '4', value => {
    value.canonicalActions[1]!.dataTestValue = 'checkout-current';
    (value.normalizedIntent.steps as JsonObject[])[1]!.dataTestValue = 'checkout-current';
    value.sourceGrounding[1]!.basis = {
      kind: 'observed_flow_step',
      flowStepIndex: 7,
      evidenceIds: ['obs-current-checkout-data-test'],
    };
  }),
  save_app_area_drift: proposal => changedProposal(proposal, 'save_app_area_drift', '4', '5', value => {
    const currentAppArea = {
      ...cloneValue(value.appArea),
      id: 'checkout-current-module',
      method: 'page-definition-module-current',
      evidenceIds: ['obs-current-page-module'],
    };
    value.appArea = currentAppArea;
    value.normalizedIntent.appArea = cloneValue(currentAppArea);
  }),
  save_auth_drift: proposal => changedProposal(proposal, 'save_auth_drift', '5', '6', value => {
    value.authority.authenticationExpectationIdentityHash = '5'.repeat(64);
    value.authenticationExpectation.mechanism = 'form-current';
    value.authenticationExpectation.identityHash = '5'.repeat(64);
    const bases = value.authenticationExpectation.bases as JsonObject[];
    bases[0]!.policyVersion = 'auth-policy-current';
    bases[0]!.configurationDigest = '5'.repeat(64);
    bases[0]!.mechanism = 'form-current';
    value.normalizedIntent.preconditions = [{
      kind: 'authenticated_role',
      roleId: 'standard-user',
      mechanism: 'form-current',
    }];
  }),
  save_reanalysis_different_proposal: proposal => changedProposal(proposal, 'save_reanalysis_different_proposal', '6', '7', value => {
    value.limitations = ['Current deterministic analysis emits changed proposal material for the same source.'];
    const evidenceAssessment = value.normalizedIntent.evidenceAssessment as JsonObject;
    evidenceAssessment.limitations = cloneValue(value.limitations);
  }),
};

export class ReferenceM3CertificationDriver implements M3CertificationDriver {
  readonly name: string = 'm3-reference-mechanics';
  readonly authorityClass: AuthorityClass = 'reference';
  protected readonly sources = new Map<string, ManualTestSourceV1>();
  protected readonly proposals = new Map<string, ManualAutomationProposalV1>();
  protected readonly definitions = new Map<string, DefinitionObservation>();
  protected readonly promotions = new Map<string, ManualPromotionResultV1>();
  protected readonly results = new Map<string, ResultsObservation>();
  protected readonly persistedSources = new Map<string, CertificationManualSourceRow>();
  protected readonly persistedDefinitions: CertificationDefinitionRow[] = [];
  protected readonly persistedTestSetRevisions: CertificationTestSetRevisionRow[] = [];
  protected readonly persistedPromotions: CertificationManualPromotionRow[] = [];
  protected readonly savedByProposal = new Map<string, ManualPromotionResultV1>();
  protected scenario: string | null = null;
  protected promotionFaultArmed = false;

  constructor(protected readonly contracts: SharedM3Contracts) {}

  async configureCertificationScenario(scenario: string | null): Promise<void> {
    this.scenario = scenario;
  }

  async snapshot(projectId: string): Promise<CertificationPersistenceInventory> {
    const manualTestSources = [...this.persistedSources.values()].filter(row => row.projectId === projectId);
    const definitions = this.persistedDefinitions.filter(row => row.projectId === projectId);
    const testSetRevisions = this.persistedTestSetRevisions.filter(row => row.projectId === projectId);
    const manualTestPromotions = this.persistedPromotions.filter(row => row.projectId === projectId);
    return cloneValue({
      projectId,
      counts: {
        manualTestSources: manualTestSources.length,
        definitions: definitions.length,
        testSetRevisions: testSetRevisions.length,
        manualTestPromotions: manualTestPromotions.length,
      },
      manualTestSources,
      definitions,
      testSetRevisions,
      manualTestPromotions,
    });
  }

  async armPromotionFaultOnce(): Promise<void> {
    this.promotionFaultArmed = true;
  }

  async disarmPromotionFault(): Promise<void> {
    this.promotionFaultArmed = false;
  }

  async classifySaveFailure(error: unknown): Promise<CertificationSaveFailureObservation> {
    if (error instanceof CertificationPromotionFault) {
      return { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE };
    }
    if (error instanceof CertificationObservedSaveFailure) return cloneValue(error.observation);
    if (error instanceof Error) {
      return { kind: 'unexpected', name: error.name, message: error.message };
    }
    return { kind: 'unexpected', message: String(error) };
  }

  async analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult> {
    if (!validManualSource(request.source)) return { kind: 'transport_error', code: 'MANUAL_SOURCE_INVALID' };
    const source = cloneValue(request.source);
    this.sources.set(source.sourceId, source);
    if (!this.persistedSources.has(source.sourceId)) {
      this.persistedSources.set(source.sourceId, {
        sourceId: source.sourceId,
        projectId: source.projectId,
        schemaVersion: source.schemaVersion,
        sourceKind: source.sourceKind,
        payloadJson: JSON.stringify(source),
        contentHash: source.contentHash,
        admittedAt: '2026-08-27T12:00:00.000Z',
      });
    }
    const scenario = request.scenario ?? this.scenario;
    const refusalFile = scenario ? REFUSAL_BY_SCENARIO[scenario] : undefined;
    if (refusalFile) {
      const frozen = this.contracts.refusals[refusalFile];
      if (!frozen) throw new Error(`Missing shared refusal fixture: ${refusalFile}`);
      return { kind: 'analysis', source: cloneValue(source), result: cloneValue(frozen) };
    }
    const proposal = cloneValue(this.contracts.positiveProposal);
    proposal.projectId = source.projectId;
    proposal.sourceAuthority = { sourceId: source.sourceId, sourceContentHash: source.contentHash };
    proposal.normalizedIntent.projectId = source.projectId;
    proposal.normalizedIntent.source = 'manual';
    proposal.normalizedIntent.title = source.title;
    proposal.normalizedIntent.objective = source.objective;
    if (scenario === 'source_semantic_change') {
      proposal.proposalId = 'opaque-product-emitted-proposal-change';
      proposal.normalizedIntentContentHash = '6'.repeat(64);
      proposal.proposalContentHash = '7'.repeat(64);
    }
    const currentProposalSetup = scenario && scenario !== 'save_reanalysis_refuses'
      ? CURRENT_PROPOSAL_SETUP[scenario as SupportedStaleSaveScenario]
      : undefined;
    currentProposalSetup?.(proposal);
    this.proposals.set(proposal.proposalId, cloneValue(proposal));
    return {
      kind: 'analysis',
      source: cloneValue(source),
      result: {
        schemaVersion: 'forge-manual-analysis-result/v1',
        outcome: { kind: 'proposal', proposal },
      },
    };
  }

  async readManualSource(projectId: string, sourceId: string): Promise<ManualTestSourceV1 | null> {
    const source = this.sources.get(sourceId);
    return source?.projectId === projectId ? cloneValue(source) : null;
  }

  async saveReviewedProposal(request: unknown): Promise<SaveResult> {
    if (!isObject(request)) return { kind: 'refused', code: 'SAVE_REQUEST_INVALID' };
    const keys = Object.keys(request).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['projectId', 'proposalAuthority', 'sourceAuthority'])) {
      return { kind: 'refused', code: 'SAVE_REQUEST_NOT_IDENTITY_ONLY' };
    }
    if (!isObject(request.sourceAuthority) || !isObject(request.proposalAuthority)) {
      return { kind: 'refused', code: 'SAVE_REQUEST_INVALID' };
    }
    const source = this.sources.get(String(request.sourceAuthority.sourceId));
    const proposal = this.proposals.get(String(request.proposalAuthority.proposalId));
    const identityMatches = source
      && proposal
      && request.projectId === source.projectId
      && request.sourceAuthority.sourceContentHash === source.contentHash
      && proposal.sourceAuthority.sourceId === source.sourceId
      && proposal.sourceAuthority.sourceContentHash === source.contentHash
      && request.proposalAuthority.proposalContentHash === proposal.proposalContentHash;
    if (!identityMatches) return { kind: 'refused', code: 'REVIEW_AUTHORITY_MISMATCH' };
    const currentAnalysis = await this.analyzeManualTest({ source: cloneValue(source), scenario: this.scenario ?? undefined });
    if (currentAnalysis.kind !== 'analysis' || currentAnalysis.result.outcome.kind !== 'proposal') {
      return { kind: 'refused', code: 'MANUAL_PROPOSAL_NOT_EXECUTABLE' };
    }
    const currentProposal = currentAnalysis.result.outcome.proposal;
    if (currentProposal.proposalId !== proposal.proposalId
      || currentProposal.proposalContentHash !== proposal.proposalContentHash) {
      return { kind: 'refused', code: 'STALE_REVIEWED_PROPOSAL' };
    }
    const proposalKey = `${source.projectId}\u0000${source.sourceId}\u0000${proposal.proposalId}\u0000${proposal.proposalContentHash}`;
    const replay = this.savedByProposal.get(proposalKey);
    if (replay) {
      return { kind: 'promoted', result: cloneValue(replay), reanalysisPerformed: true, replayed: true, atomic: true };
    }
    const result = cloneValue(this.contracts.positiveSaveResult);
    result.sourceAuthority = cloneValue(request.sourceAuthority as SourceAuthority);
    result.proposalAuthority = cloneValue(request.proposalAuthority as ProposalIdentity);
    if (this.savedByProposal.size > 0) {
      const ordinal = this.savedByProposal.size + 1;
      result.definitionAuthority.definitionId = `reference-definition-${ordinal}`;
      result.definitionAuthority.testSetId = `reference-test-set-${ordinal}`;
      result.definitionAuthority.testSetRevision = ordinal;
      result.definitionAuthority.testSetContentHash = `${ordinal % 10}`.repeat(64);
    }
    const definition: DefinitionObservation = {
      schemaVersion: 3,
      projectId: source.projectId,
      definitionAuthority: cloneValue(result.definitionAuthority),
      normalizedIntent: cloneValue(proposal.normalizedIntent),
      appArea: cloneValue(proposal.appArea),
      canonicalActions: cloneValue(proposal.canonicalActions),
      oracle: cloneValue(proposal.oracle),
      authenticationExpectation: cloneValue(proposal.authenticationExpectation),
    };
    if (this.promotionFaultArmed) {
      this.promotionFaultArmed = false;
      await this.onPromotionFault(source, proposal, result, definition);
    }
    const rowId = this.persistedTestSetRevisions.length + 1;
    this.definitions.set(result.definitionAuthority.definitionId, definition);
    this.promotions.set(result.definitionAuthority.definitionId, cloneValue(result));
    this.persistedDefinitions.push({
      projectId: source.projectId,
      testSetRowId: rowId,
      testSetId: result.definitionAuthority.testSetId,
      testSetRevision: result.definitionAuthority.testSetRevision,
      definitionOrdinal: 1,
      definitionId: result.definitionAuthority.definitionId,
      definitionSchemaVersion: result.definitionAuthority.definitionSchemaVersion,
    });
    this.persistedTestSetRevisions.push({
      rowId,
      projectId: source.projectId,
      testSetId: result.definitionAuthority.testSetId,
      revision: result.definitionAuthority.testSetRevision,
      generationId: `reference-generation-${rowId}`,
      schemaVersion: 3,
      generatedAt: '2026-08-27T12:00:00.000Z',
      outcome: 'generated',
      definitionCount: 1,
      contentHash: result.definitionAuthority.testSetContentHash,
    });
    this.persistedPromotions.push({
      proposalId: proposal.proposalId,
      projectId: source.projectId,
      proposalSchemaVersion: proposal.schemaVersion,
      sourceId: source.sourceId,
      sourceContentHash: source.contentHash,
      proposalPayloadJson: JSON.stringify(proposal),
      proposalContentHash: proposal.proposalContentHash,
      testSetRowId: rowId,
      testSetId: result.definitionAuthority.testSetId,
      testSetRevision: result.definitionAuthority.testSetRevision,
      testSetContentHash: result.definitionAuthority.testSetContentHash,
      definitionId: result.definitionAuthority.definitionId,
      promotedAt: '2026-08-27T12:00:00.000Z',
    });
    this.savedByProposal.set(proposalKey, cloneValue(result));
    return { kind: 'promoted', result, reanalysisPerformed: true, replayed: false, atomic: true };
  }

  protected async onPromotionFault(
    _source: ManualTestSourceV1,
    _proposal: ManualAutomationProposalV1,
    _result: ManualPromotionResultV1,
    _definition: DefinitionObservation,
  ): Promise<never> {
    throw new CertificationPromotionFault();
  }

  async readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null> {
    const definition = this.definitions.get(definitionId);
    return definition?.projectId === projectId ? cloneValue(definition) : null;
  }

  async readManualPromotion(projectId: string, definitionAuthority: DefinitionAuthority): Promise<ManualPromotionResultV1 | null> {
    const definition = await this.readDefinition(projectId, definitionAuthority.definitionId);
    const promotion = this.promotions.get(definitionAuthority.definitionId);
    return definition
      && promotion
      && JSON.stringify(definition.definitionAuthority) === JSON.stringify(definitionAuthority)
      && JSON.stringify(promotion.definitionAuthority) === JSON.stringify(definitionAuthority)
      ? cloneValue(promotion)
      : null;
  }

  async readDefinitionPresentation(projectId: string, definitionId: string): Promise<DefinitionPresentation | null> {
    const definition = await this.readDefinition(projectId, definitionId);
    const promotion = definition && await this.readManualPromotion(projectId, definition.definitionAuthority);
    return definition && promotion ? {
      definitionAuthority: cloneValue(definition.definitionAuthority),
      promotion,
    } : null;
  }

  async addDefinitionToSuite(projectId: string, definitionAuthority: DefinitionAuthority): Promise<M2Candidate | null> {
    const definition = await this.readDefinition(projectId, definitionAuthority.definitionId);
    return definition && JSON.stringify(definition.definitionAuthority) === JSON.stringify(definitionAuthority)
      ? { projectId, executable: true, definitionAuthority: cloneValue(definitionAuthority) }
      : null;
  }

  async startExecution(projectId: string, definitionAuthority: DefinitionAuthority): Promise<{ kind: 'accepted'; executionId: string } | { kind: 'refused' }> {
    const candidate = await this.addDefinitionToSuite(projectId, definitionAuthority);
    if (!candidate) return { kind: 'refused' };
    const definition = await this.readDefinition(projectId, definitionAuthority.definitionId);
    if (!definition) return { kind: 'refused' };
    const promotion = await this.readManualPromotion(projectId, definitionAuthority);
    if (!promotion) return { kind: 'refused' };
    const executionId = 'm3-reference-execution-01';
    this.results.set(executionId, {
      executionId,
      outcome: 'passed',
      definitionAuthority: cloneValue(definitionAuthority),
      promotion: cloneValue(promotion),
    });
    return { kind: 'accepted', executionId };
  }

  async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const result = this.results.get(executionId);
    const definition = result && await this.readDefinition(projectId, result.definitionAuthority.definitionId);
    return result && definition ? cloneValue(result) : null;
  }
}
