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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import {
  BROKEN_ADAPTER_FAULTS,
  AtomicityFailureHostileM3Adapter,
  DeliberatelyBrokenM3Adapter,
  STALE_CERTIFICATION_SCENARIO_BY_FAULT,
  type BrokenAdapterFault,
  type StaleAcceptanceFault,
  type StaleSaveRevalidationDimension,
} from './m3-certification/broken-adapter';
import {
  cloneValue,
  CONTROLLED_PROMOTION_FAULT_CODE,
  ReferenceM3CertificationDriver,
  type AnalyzeResult,
  type AuthorityClass,
  type CertificationPersistenceInventory,
  type DefinitionObservation,
  type JsonObject,
  type ManualAnalysisResultV1,
  type ManualAutomationProposalV1,
  type ManualTestSourceV1,
  type SaveResult,
  type SharedM3Contracts,
} from './m3-certification/driver';
import { loadSharedContracts, sourceWithSharedRefusalAuthority } from './m3-certification/fixture-loader';
import {
  certifyGolden,
  certifyMalformedTransport,
  certifyOpaqueAuthority,
  certifyRefusal,
  certifySaveRefusesBody,
  certifyStaleSave,
  trailingUnsupportedHarnessSource,
  certifyWholeSourceRefusal,
  hostileAuthenticationSaveBody,
  hostileDefinitionSaveBody,
  STALE_SAVE_CASES,
  type CertificationReport,
} from './m3-certification/suite';

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function falsificationReport(fault: BrokenAdapterFault): Promise<CertificationReport> {
  const contracts = loadSharedContracts();
  const driver = new DeliberatelyBrokenM3Adapter(contracts, fault);
  if (fault === 'drop_unsupported_source_line' || fault === 'shorten_source_into_v3') {
    const source = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
    return certifyWholeSourceRefusal(driver, source, 'partial_unsupported_fill_between');
  }
  if (fault === 'ignore_trailing_unsupported_step') {
    return certifyWholeSourceRefusal(driver, trailingUnsupportedHarnessSource(contracts), 'partial_unsupported_trailing_step');
  }
  if (fault === 'accept_action_body_at_save') {
    return certifySaveRefusesBody(driver, contracts, { actions: [{ ordinal: 0 }] });
  }
  if (fault === 'accept_authentication_body_at_save') {
    return certifySaveRefusesBody(
      driver,
      contracts,
      { authentication: hostileAuthenticationSaveBody(contracts) },
      'SAVE_ACCEPTED_AUTHENTICATION_BODY',
    );
  }
  if (fault === 'accept_definition_body_at_save') {
    return certifySaveRefusesBody(
      driver,
      contracts,
      { definition: hostileDefinitionSaveBody(contracts) },
      'SAVE_ACCEPTED_DEFINITION_BODY',
    );
  }
  const staleScenario = STALE_CERTIFICATION_SCENARIO_BY_FAULT[fault as StaleAcceptanceFault];
  if (staleScenario) {
    const staleCase = STALE_SAVE_CASES.find(candidate => candidate.scenario === staleScenario);
    if (!staleCase) throw new Error(`Missing stale Save certification case: ${staleScenario}`);
    return certifyStaleSave(driver, contracts, staleCase);
  }
  if (fault === 'classify_corruption_as_semantic_refusal') {
    const malformed = cloneValue(contracts.positiveSource) as ManualTestSourceV1;
    malformed.steps[0]!.ordinal = 0;
    return certifyMalformedTransport(driver, malformed);
  }
  if (fault === 'semantic_refusal_persists_authority') {
    return certifyRefusal(driver, contracts, 'unsupported-fill.json', {}, 'unsupported_fill');
  }
  if (fault === 'require_reference_hash') {
    const arbitrary = cloneValue(contracts);
    arbitrary.positiveSource.contentHash = '1'.repeat(64);
    arbitrary.positiveProposal.proposalId = 'opaque-product-proposal-arbitrary-77';
    arbitrary.positiveProposal.sourceAuthority.sourceContentHash = '1'.repeat(64);
    arbitrary.positiveProposal.normalizedIntentContentHash = '2'.repeat(64);
    arbitrary.positiveProposal.proposalContentHash = '3'.repeat(64);
    arbitrary.positiveSaveResult.sourceAuthority.sourceContentHash = '1'.repeat(64);
    arbitrary.positiveSaveResult.proposalAuthority.proposalId = arbitrary.positiveProposal.proposalId;
    arbitrary.positiveSaveResult.proposalAuthority.proposalContentHash = '3'.repeat(64);
    return certifyOpaqueAuthority(new DeliberatelyBrokenM3Adapter(arbitrary, fault), arbitrary);
  }
  return certifyGolden(driver, contracts);
}

const PROPOSAL_REVALIDATION_DIMENSIONS = [
  'model_evidence',
  'governed_route',
  'data_test_selector',
  'app_area',
  'authentication',
  'deterministic_proposal',
] as const satisfies readonly StaleSaveRevalidationDimension[];

const TRUSTED_DIMENSION_BY_FAULT: Readonly<Record<StaleAcceptanceFault, StaleSaveRevalidationDimension>> = {
  accept_stale_model_evidence: 'model_evidence',
  accept_stale_route: 'governed_route',
  accept_stale_data_test: 'data_test_selector',
  accept_stale_app_area: 'app_area',
  accept_stale_auth: 'authentication',
  accept_changed_current_proposal: 'deterministic_proposal',
  accept_current_reanalysis_refusal: 'semantic_executability',
};

type InventoryMutator = (snapshot: CertificationPersistenceInventory, call: number) => void;

class InventoryHostileM3Driver extends ReferenceM3CertificationDriver {
  override readonly name = 'inventory-hostile-m3';
  override readonly authorityClass: AuthorityClass = 'product';
  private snapshotCall = 0;

  constructor(contracts: SharedM3Contracts, private readonly mutateInventory: InventoryMutator) {
    super(contracts);
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

  override async snapshot(projectId: string): Promise<CertificationPersistenceInventory> {
    const snapshot = await super.snapshot(projectId);
    this.snapshotCall += 1;
    this.mutateInventory(snapshot, this.snapshotCall);
    return snapshot;
  }
}

type PostValidationMutationPoint = 'analysis' | 'read';

class PostValidationInventoryMutationDriver extends ReferenceM3CertificationDriver {
  override readonly name = 'post-validation-inventory-hostile-m3';
  override readonly authorityClass: AuthorityClass = 'product';
  private lastReturnedSnapshot: CertificationPersistenceInventory | null = null;
  private mutated = false;

  constructor(
    contracts: SharedM3Contracts,
    private readonly mutationPoint: PostValidationMutationPoint,
    private readonly mutateReturnedSnapshot: (snapshot: CertificationPersistenceInventory) => void,
  ) {
    super(contracts);
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

  override async snapshot(projectId: string): Promise<CertificationPersistenceInventory> {
    const snapshot = await super.snapshot(projectId);
    this.lastReturnedSnapshot = snapshot;
    return snapshot;
  }

  private mutateOnce(point: PostValidationMutationPoint): void {
    if (!this.mutated && point === this.mutationPoint && this.lastReturnedSnapshot) {
      this.mutated = true;
      this.mutateReturnedSnapshot(this.lastReturnedSnapshot);
    }
  }

  override async analyzeManualTest(
    request: Parameters<ReferenceM3CertificationDriver['analyzeManualTest']>[0],
  ): Promise<AnalyzeResult> {
    this.mutateOnce('analysis');
    return super.analyzeManualTest(request);
  }

  override async readManualSource(
    projectId: string,
    sourceId: string,
  ): ReturnType<ReferenceM3CertificationDriver['readManualSource']> {
    this.mutateOnce('read');
    return super.readManualSource(projectId, sourceId);
  }
}

type ProductIdentityFault =
  | 'float_refusal_source_authority'
  | 'persist_wrong_source_authority'
  | 'persist_wrong_proposal_and_source_authority'
  | 'drift_source_title'
  | 'drift_source_steps'
  | 'drift_source_outcome'
  | 'drift_proposal_steps'
  | 'drift_proposal_selector'
  | 'drift_proposal_action_kind'
  | 'drift_proposal_outcome'
  | 'drift_proposal_oracle_kind'
  | 'drift_proposal_oracle_subject'
  | 'drift_proposal_oracle_support'
  | 'drift_proposal_explanation'
  | 'off_by_one_flow_step_index'
  | 'float_model_authority_definition'
  | 'float_evidence_authority_definition'
  | 'float_auth_authority_definition'
  | 'float_app_area_evidence_definition'
  | 'drift_definition_explanation'
  | 'wrong_grounding_evidence_ids'
  | 'wrong_app_area_evidence_ids'
  | 'wrong_app_area_source_subject'
  | 'drift_normalized_app_area_evidence'
  | 'drift_refusal_code'
  | 'drift_refusal_grounding';

function applyArbitraryProductDerivedAuthority(proposal: ManualAutomationProposalV1): void {
  const value = proposal as any;
  value.authority = {
    modelRowId: 901,
    modelVersion: 'product-model-revision-901',
    observationRunId: 'product-observation-run-901',
    supportSealHash: 'a'.repeat(64),
    routeEvidenceIdentityHash: 'b'.repeat(64),
    authenticationExpectationIdentityHash: 'c'.repeat(64),
  };
  value.appArea.sourceSubjectId = 'product-subject-cart';
  value.appArea.evidenceIds = ['product-app-area-evidence', 'product-subject-cart'];
  value.normalizedIntent.intentId = 'product-intent-derived-901';
  value.normalizedIntent.appArea = cloneValue(value.appArea);
  value.normalizedIntent.steps[0].stepId = 'product-step-derived-navigation';
  value.normalizedIntent.steps[0].subjectId = 'product-subject-cart';
  value.normalizedIntent.steps[1].stepId = 'product-step-derived-click';
  value.normalizedIntent.steps[1].subjectId = 'product-subject-cart';
  value.normalizedIntent.steps[1].elementId = 'product-element-checkout';
  value.normalizedIntent.steps[1].targetSubjectId = 'product-subject-checkout';
  value.normalizedIntent.expectedOutcomes[0].outcomeId = 'product-outcome-derived-checkout';
  value.normalizedIntent.expectedOutcomes[0].subjectId = 'product-subject-checkout';
  value.normalizedIntent.grounding.modelRowId = value.authority.modelRowId;
  value.normalizedIntent.grounding.modelVersion = value.authority.modelVersion;
  value.normalizedIntent.grounding.observationRunId = value.authority.observationRunId;
  value.normalizedIntent.grounding.supportSealHash = value.authority.supportSealHash;
  value.normalizedIntent.grounding.sourceFlowId = 'product-flow-derived-checkout';
  value.normalizedIntent.grounding.subjectSupport = [{
    canonicalSubjectId: 'product-subject-cart',
    supportingObservationIds: ['product-observation-cart-route', 'product-observation-checkout-control'],
    supportingGapIds: [],
  }, {
    canonicalSubjectId: 'product-subject-checkout',
    supportingObservationIds: ['product-observation-checkout-subject'],
    supportingGapIds: [],
  }];
  value.sourceGrounding[0].basis.evidenceIds = ['product-observation-cart-route'];
  value.sourceGrounding[1].basis.evidenceIds = ['product-observation-cart-route', 'product-observation-checkout-control'];
  value.sourceGrounding[2].basis.evidenceIds = ['product-observation-checkout-subject'];
  value.canonicalActions = cloneValue(value.normalizedIntent.steps);
  value.oracle.subjectId = 'product-subject-checkout';
  value.oracle.supportingObservationIds = ['product-observation-checkout-subject'];
  value.authenticationExpectation.bases[0].configurationDigest = 'd'.repeat(64);
  value.authenticationExpectation.identityHash = value.authority.authenticationExpectationIdentityHash;
}

class OpaqueProductIdentityM3Driver extends ReferenceM3CertificationDriver {
  override readonly name = 'opaque-product-identity-m3';
  override readonly authorityClass: AuthorityClass = 'product';

  constructor(contracts: SharedM3Contracts, private readonly identityFault: ProductIdentityFault | null = null) {
    super(contracts);
  }

  override async analyzeManualTest(
    request: Parameters<ReferenceM3CertificationDriver['analyzeManualTest']>[0],
  ): Promise<AnalyzeResult> {
    if (!request.source || typeof request.source !== 'object' || Array.isArray(request.source)) {
      return super.analyzeManualTest(request);
    }
    const input = cloneValue(request.source as ManualTestSourceV1);
    const source = input.sourceId.startsWith('product-source-')
      ? input
      : {
          ...input,
          sourceId: `product-source-${input.sourceId}`,
          contentHash: input.title.endsWith(' atomic control') ? '2'.repeat(64) : '1'.repeat(64),
        };
    if (this.identityFault === 'drift_source_title') source.title = `${source.title} drift`;
    if (this.identityFault === 'drift_source_steps') source.steps[0]!.text = `${source.steps[0]!.text} drift`;
    if (this.identityFault === 'drift_source_outcome') source.expectedOutcome = `${source.expectedOutcome} drift`;
    const result = await super.analyzeManualTest({ ...request, source });
    if (result.kind !== 'analysis') return result;
    result.source = cloneValue(source);
    if (result.result.outcome.kind === 'proposal') {
      const proposal = result.result.outcome.proposal;
      const priorProposalId = proposal.proposalId;
      applyArbitraryProductDerivedAuthority(proposal);
      proposal.proposalId = `product-proposal-${source.sourceId}`;
      proposal.normalizedIntentContentHash = '4'.repeat(64);
      proposal.proposalContentHash = '5'.repeat(64);
      if (this.identityFault === 'drift_proposal_steps') {
        proposal.canonicalActions[0]!.routePath = '/semantic-drift.html';
        (proposal.normalizedIntent.steps as JsonObject[])[0]!.routePath = '/semantic-drift.html';
      }
      if (this.identityFault === 'drift_proposal_selector') {
        proposal.canonicalActions[1]!.dataTestValue = 'semantic-drift-selector';
        (proposal.normalizedIntent.steps as JsonObject[])[1]!.dataTestValue = 'semantic-drift-selector';
      }
      if (this.identityFault === 'drift_proposal_action_kind') {
        proposal.canonicalActions[1]!.kind = 'semantic_drift_action';
        (proposal.normalizedIntent.steps as JsonObject[])[1]!.kind = 'semantic_drift_action';
      }
      if (this.identityFault === 'drift_proposal_outcome') {
        proposal.oracle.routePath = '/semantic-drift-outcome.html';
        (proposal.normalizedIntent.expectedOutcomes as JsonObject[])[0]!.routePath = '/semantic-drift-outcome.html';
      }
      if (this.identityFault === 'drift_proposal_oracle_kind') {
        proposal.oracle.kind = 'semantic_drift_oracle';
      }
      if (this.identityFault === 'drift_proposal_oracle_subject') {
        proposal.oracle.subjectId = 'semantic-drift-subject';
      }
      if (this.identityFault === 'drift_proposal_oracle_support') {
        proposal.oracle.supportingObservationIds = ['semantic-drift-observation'];
      }
      if (this.identityFault === 'drift_proposal_explanation') {
        proposal.oracle.explanation = 'The governed target subject is observable at the expected route.';
      }
      if (this.identityFault === 'off_by_one_flow_step_index') {
        (proposal.normalizedIntent.grounding as JsonObject).selectedFlowStepIndexes = [6];
        const sourceGrounding = proposal.sourceGrounding as JsonObject[];
        (sourceGrounding[1]!.basis as JsonObject).flowStepIndex = 6;
      }
      if (this.identityFault === 'wrong_grounding_evidence_ids') {
        const sourceGrounding = proposal.sourceGrounding as JsonObject[];
        (sourceGrounding[1]!.basis as JsonObject).evidenceIds = ['product-observation-floated'];
      }
      if (this.identityFault === 'wrong_app_area_evidence_ids') {
        proposal.appArea.evidenceIds = ['floated-app-area-evidence'];
        (proposal.normalizedIntent.appArea as JsonObject).evidenceIds = ['floated-app-area-evidence'];
      }
      if (this.identityFault === 'wrong_app_area_source_subject') {
        proposal.appArea.sourceSubjectId = 'product-subject-floated';
        (proposal.normalizedIntent.appArea as JsonObject).sourceSubjectId = 'product-subject-floated';
      }
      if (this.identityFault === 'drift_normalized_app_area_evidence') {
        (proposal.normalizedIntent.appArea as JsonObject).evidenceIds = ['floated-app-area-evidence'];
      }
      this.proposals.delete(priorProposalId);
      this.proposals.set(proposal.proposalId, cloneValue(proposal));
    } else {
      const refusal = result.result.outcome.refusal;
      refusal.sourceAuthority = { sourceId: source.sourceId, sourceContentHash: source.contentHash };
      if (this.identityFault === 'float_refusal_source_authority') {
        refusal.sourceAuthority = {
          sourceId: 'product-source-floated-other-request',
          sourceContentHash: '6'.repeat(64),
        };
      }
      if (this.identityFault === 'drift_refusal_code') refusal.code = 'ambiguous_evidence';
      if (this.identityFault === 'drift_refusal_grounding') {
        const basis = refusal.sourceGrounding[0]!.basis as JsonObject;
        basis.evidenceIds = ['obs-semantic-drift'];
      }
    }
    if (this.identityFault === 'persist_wrong_source_authority') {
      const row = this.persistedSources.get(source.sourceId);
      if (row) {
        const wrongSource = cloneValue(source);
        wrongSource.sourceId = 'product-source-wrong-persisted-authority';
        wrongSource.contentHash = '7'.repeat(64);
        this.persistedSources.delete(source.sourceId);
        this.persistedSources.set(wrongSource.sourceId, {
          ...row,
          sourceId: wrongSource.sourceId,
          contentHash: wrongSource.contentHash,
          payloadJson: JSON.stringify(wrongSource),
        });
      }
    }
    return result;
  }

  override async saveReviewedProposal(request: unknown): Promise<SaveResult> {
    const saved = await super.saveReviewedProposal(request);
    if (this.identityFault === 'persist_wrong_proposal_and_source_authority'
      && saved.kind === 'promoted' && !saved.replayed) {
      const row = this.persistedPromotions.at(-1);
      if (row) {
        const proposal = JSON.parse(row.proposalPayloadJson) as ManualAutomationProposalV1;
        proposal.proposalId = 'product-proposal-wrong-persisted-authority';
        proposal.proposalContentHash = '8'.repeat(64);
        proposal.sourceAuthority = {
          sourceId: 'product-source-wrong-promotion-authority',
          sourceContentHash: '9'.repeat(64),
        };
        row.proposalId = proposal.proposalId;
        row.proposalContentHash = proposal.proposalContentHash;
        row.sourceId = proposal.sourceAuthority.sourceId;
        row.sourceContentHash = proposal.sourceAuthority.sourceContentHash;
        row.proposalPayloadJson = JSON.stringify(proposal);
      }
    }
    return saved;
  }

  override async readDefinition(
    projectId: string,
    definitionId: string,
  ): ReturnType<ReferenceM3CertificationDriver['readDefinition']> {
    const definition = await super.readDefinition(projectId, definitionId);
    if (!definition) return null;
    const value = definition as any;
    value.oracle.explanation = 'Observe the sealed target subject at its governed final route after the directly observed click transition.';
    if (this.identityFault === 'float_model_authority_definition') {
      value.normalizedIntent.grounding.modelRowId += 1;
    }
    if (this.identityFault === 'float_evidence_authority_definition') {
      value.oracle.supportingObservationIds = ['product-observation-floated'];
    }
    if (this.identityFault === 'float_auth_authority_definition') {
      value.authenticationExpectation.bases[0].configurationDigest = 'e'.repeat(64);
    }
    if (this.identityFault === 'float_app_area_evidence_definition') {
      value.appArea.evidenceIds = ['floated-app-area-evidence'];
    }
    if (this.identityFault === 'drift_definition_explanation') {
      value.oracle.explanation = 'Semantically weakened v3 oracle explanation.';
    }
    return definition;
  }
}

function preFixPlainDataArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const expectedKeys = [...value.keys()].map(String);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return null;
  if (!isDeepStrictEqual([...keys].sort(), [...expectedKeys, 'length'].sort())) return null;
  return value;
}

async function certifyHostileDefinitionArray(
  contracts: SharedM3Contracts,
  definitions: unknown[],
): Promise<CertificationReport> {
  return certifyRefusal(
    new InventoryHostileM3Driver(contracts, snapshot => {
      snapshot.definitions = definitions as CertificationPersistenceInventory['definitions'];
    }),
    contracts,
    'unsupported-fill.json',
  );
}

function hiddenDefinitionRow(projectId: string) {
  return {
    projectId,
    testSetRowId: 9001,
    testSetId: 'hidden-test-set',
    testSetRevision: 1,
    definitionOrdinal: 0,
    definitionId: 'hidden-definition',
    definitionSchemaVersion: 3,
  };
}

function hiddenSourceRow(projectId: string) {
  return {
    sourceId: 'hidden-source',
    projectId,
    schemaVersion: 'forge-manual-test-source/v1',
    sourceKind: 'manual',
    payloadJson: '{}',
    contentHash: 'a'.repeat(64),
    admittedAt: '2026-08-27T12:00:00.000Z',
  };
}

function hiddenRevisionRow(projectId: string) {
  return {
    rowId: 9001,
    projectId,
    testSetId: 'hidden-test-set',
    revision: 1,
    generationId: 'hidden-generation',
    schemaVersion: 3,
    generatedAt: '2026-08-27T12:00:00.000Z',
    outcome: 'generated',
    definitionCount: 1,
    contentHash: 'b'.repeat(64),
  };
}

function hiddenPromotionRow(projectId: string) {
  return {
    proposalId: 'hidden-proposal',
    projectId,
    proposalSchemaVersion: 'forge-manual-automation-proposal/v1',
    sourceId: 'hidden-source',
    sourceContentHash: 'a'.repeat(64),
    proposalPayloadJson: '{}',
    proposalContentHash: 'b'.repeat(64),
    testSetRowId: 9001,
    testSetId: 'hidden-test-set',
    testSetRevision: 1,
    testSetContentHash: 'c'.repeat(64),
    definitionId: 'hidden-definition',
    promotedAt: '2026-08-27T12:00:00.000Z',
  };
}

function proposalDimension(
  proposal: ManualAutomationProposalV1,
  dimension: typeof PROPOSAL_REVALIDATION_DIMENSIONS[number],
): unknown {
  const grounding = proposal.normalizedIntent.grounding as JsonObject;
  if (dimension === 'model_evidence') return {
    authority: {
      modelRowId: proposal.authority.modelRowId,
      modelVersion: proposal.authority.modelVersion,
      supportSealHash: proposal.authority.supportSealHash,
    },
    grounding: {
      modelRowId: grounding.modelRowId,
      modelVersion: grounding.modelVersion,
      supportSealHash: grounding.supportSealHash,
      subjectSupport: grounding.subjectSupport,
    },
  };
  if (dimension === 'governed_route') return {
    routeEvidenceIdentityHash: proposal.authority.routeEvidenceIdentityHash,
    action: proposal.canonicalActions[0],
    normalizedStep: (proposal.normalizedIntent.steps as JsonObject[])[0],
    sourceGrounding: proposal.sourceGrounding[0],
  };
  if (dimension === 'data_test_selector') return {
    action: proposal.canonicalActions[1],
    normalizedStep: (proposal.normalizedIntent.steps as JsonObject[])[1],
    sourceGrounding: proposal.sourceGrounding[1],
  };
  if (dimension === 'app_area') return {
    appArea: proposal.appArea,
    normalizedAppArea: proposal.normalizedIntent.appArea,
  };
  if (dimension === 'authentication') return {
    authenticationExpectationIdentityHash: proposal.authority.authenticationExpectationIdentityHash,
    authenticationExpectation: proposal.authenticationExpectation,
    preconditions: proposal.normalizedIntent.preconditions,
  };
  return {
    limitations: proposal.limitations,
    evidenceAssessmentLimitations:
      (proposal.normalizedIntent.evidenceAssessment as JsonObject).limitations,
  };
}

function mutateSourcePayload(
  snapshot: CertificationPersistenceInventory,
  mutate: (payload: JsonObject) => void,
): void {
  for (const row of snapshot.manualTestSources) {
    const payload = JSON.parse(row.payloadJson) as JsonObject;
    mutate(payload);
    row.payloadJson = JSON.stringify(payload);
  }
}

function mutateProposalPayload(
  snapshot: CertificationPersistenceInventory,
  mutate: (payload: JsonObject) => void,
): void {
  for (const row of snapshot.manualTestPromotions) {
    const payload = JSON.parse(row.proposalPayloadJson) as JsonObject;
    mutate(payload);
    row.proposalPayloadJson = JSON.stringify(payload);
  }
}

function preFixGenericObjectPayloadAccepted(payloadJson: string): boolean {
  const parsed: unknown = JSON.parse(payloadJson);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
}

describe('M3 certification self-falsification', () => {
  test('freezes exactly thirty-two deliberately broken Product-class adapters', () => {
    assert.equal(BROKEN_ADAPTER_FAULTS.length, 32);
    assert.equal(new Set(BROKEN_ADAPTER_FAULTS).size, 32);
  });

  test('accepts an exact internally consistent persistence snapshot', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new ReferenceM3CertificationDriver(contracts),
      contracts,
      'unsupported-fill.json',
      { requireProductAuthority: false },
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
  });

  test('raw source payloadJson formatting remains diagnostic-only after semantic validation', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        for (const row of snapshot.manualTestSources) {
          row.payloadJson = JSON.stringify(JSON.parse(row.payloadJson), null, 2);
        }
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
  });

  test('raw proposalPayloadJson formatting remains diagnostic-only after semantic validation', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new InventoryHostileM3Driver(contracts, snapshot => {
        for (const row of snapshot.manualTestPromotions) {
          row.proposalPayloadJson = JSON.stringify(JSON.parse(row.proposalPayloadJson), null, 2);
        }
      }),
      contracts,
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
  });

  test('self-falsification: admitted source payload {} formerly passed but now fails persistence first', async () => {
    const contracts = loadSharedContracts();
    assert.equal(preFixGenericObjectPayloadAccepted('{}'), true);
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        for (const row of snapshot.manualTestSources) row.payloadJson = '{}';
      }),
      contracts,
      'unsupported-fill.json',
    );
    const after = report.observations.afterPersistence as CertificationPersistenceInventory;
    assert.equal(after.counts.manualTestSources, after.manualTestSources.length);
    assert.equal(after.manualTestSources[0]?.payloadJson, '{}');
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(Object.hasOwn(report.observations, 'readSource'), false);
  });

  test('self-falsification: persisted proposal payload {} formerly passed but now blocks golden Save before replay', async () => {
    const contracts = loadSharedContracts();
    assert.equal(preFixGenericObjectPayloadAccepted('{}'), true);
    const report = await certifyGolden(
      new InventoryHostileM3Driver(contracts, snapshot => {
        for (const row of snapshot.manualTestPromotions) row.proposalPayloadJson = '{}';
      }),
      contracts,
    );
    const after = report.observations.afterSavePersistence as CertificationPersistenceInventory;
    assert.equal(after.counts.manualTestPromotions, after.manualTestPromotions.length);
    assert.equal(after.manualTestPromotions[0]?.proposalPayloadJson, '{}');
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(Object.hasOwn(report.observations, 'replay'), false);
  });

  for (const hostile of [
    {
      name: 'wrong source schemaVersion',
      mutate: (payload: JsonObject) => { payload.schemaVersion = 'forge-manual-test-source/v2'; },
    },
    {
      name: 'wrong source projectId',
      mutate: (payload: JsonObject) => { payload.projectId = 'different-project'; },
    },
    {
      name: 'wrong sourceKind',
      mutate: (payload: JsonObject) => { payload.sourceKind = 'generated'; },
    },
    {
      name: 'altered source title',
      mutate: (payload: JsonObject) => { payload.title = `${String(payload.title)} changed`; },
    },
    {
      name: 'altered source objective',
      mutate: (payload: JsonObject) => { payload.objective = `${String(payload.objective)} changed`; },
    },
    {
      name: 'altered source step text',
      mutate: (payload: JsonObject) => {
        ((payload.steps as JsonObject[])[0]!).text = 'Substituted persisted step.';
      },
    },
    {
      name: 'altered source expectedOutcome',
      mutate: (payload: JsonObject) => { payload.expectedOutcome = 'Substituted persisted outcome.'; },
    },
    {
      name: 'noncontiguous source ordinal',
      mutate: (payload: JsonObject) => { ((payload.steps as JsonObject[])[0]!).ordinal = 2; },
    },
    {
      name: 'sparse source-step semantics',
      mutate: (payload: JsonObject) => { delete (payload.steps as JsonObject[])[0]; },
    },
    {
      name: 'extra source payload key',
      mutate: (payload: JsonObject) => { payload.hiddenAuthority = true; },
    },
  ] as const) {
    test(`rejects ${hostile.name} with otherwise truthful persistence inventory`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new InventoryHostileM3Driver(contracts, snapshot => mutateSourcePayload(snapshot, hostile.mutate)),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    });
  }

  for (const hostile of [
    {
      name: 'wrong proposal schemaVersion',
      mutate: (payload: JsonObject) => { payload.schemaVersion = 'forge-manual-automation-proposal/v2'; },
    },
    {
      name: 'wrong proposal projectId',
      mutate: (payload: JsonObject) => { payload.projectId = 'different-project'; },
    },
    {
      name: 'wrong proposal sourceAuthority',
      mutate: (payload: JsonObject) => {
        (payload.sourceAuthority as JsonObject).sourceContentHash = 'f'.repeat(64);
      },
    },
    {
      name: 'altered proposal action',
      mutate: (payload: JsonObject) => {
        ((payload.canonicalActions as JsonObject[])[0]!).routePath = '/substituted-route.html';
      },
    },
    {
      name: 'altered proposal selector',
      mutate: (payload: JsonObject) => {
        ((payload.canonicalActions as JsonObject[])[1]!).dataTestValue = 'substituted-selector';
      },
    },
    {
      name: 'altered proposal appArea',
      mutate: (payload: JsonObject) => { (payload.appArea as JsonObject).id = 'substituted-area'; },
    },
    {
      name: 'altered proposal oracle',
      mutate: (payload: JsonObject) => { (payload.oracle as JsonObject).routePath = '/substituted-oracle.html'; },
    },
    {
      name: 'altered proposal grounding',
      mutate: (payload: JsonObject) => {
        const first = (payload.sourceGrounding as JsonObject[])[0]!;
        (first.basis as JsonObject).evidenceIds = ['substituted-evidence'];
      },
    },
    {
      name: 'altered proposal authentication expectation',
      mutate: (payload: JsonObject) => {
        (payload.authenticationExpectation as JsonObject).mechanism = 'substituted-auth';
      },
    },
    {
      name: 'altered proposal limitations',
      mutate: (payload: JsonObject) => { payload.limitations = ['Substituted limitation.']; },
    },
    {
      name: 'extra proposal payload key',
      mutate: (payload: JsonObject) => { payload.hiddenAuthority = true; },
    },
    {
      name: 'another reviewed proposal payload',
      mutate: (payload: JsonObject) => {
        payload.proposalId = 'other-reviewed-proposal';
        payload.proposalContentHash = '8'.repeat(64);
        (payload.sourceAuthority as JsonObject).sourceId = 'other-reviewed-source';
        (payload.sourceAuthority as JsonObject).sourceContentHash = '9'.repeat(64);
      },
    },
  ] as const) {
    test(`rejects ${hostile.name} with otherwise truthful promotion inventory`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyGolden(
        new InventoryHostileM3Driver(contracts, snapshot => mutateProposalPayload(snapshot, hostile.mutate)),
        contracts,
      );
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    });
  }

  test('self-falsification: post-validation hostile filter executed on the original pre-fix array but not the validated copy', async () => {
    const contracts = loadSharedContracts();
    let preFixInvocations = 0;
    const preFixSnapshot = await new ReferenceM3CertificationDriver(contracts).snapshot(contracts.positiveSource.projectId);
    const preFixValidated = preFixSnapshot;
    Object.defineProperty(preFixSnapshot.manualTestSources, 'filter', {
      configurable: true,
      get() {
        preFixInvocations += 1;
        throw new Error('post-validation hostile filter accessor invoked');
      },
    });
    assert.throws(
      () => preFixValidated.manualTestSources.filter(() => true),
      /post-validation hostile filter accessor invoked/,
    );
    assert.equal(preFixInvocations, 1);

    let repairedInvocations = 0;
    const report = await certifyRefusal(
      new PostValidationInventoryMutationDriver(contracts, 'read', snapshot => {
        Object.defineProperty(snapshot.manualTestSources, 'filter', {
          configurable: true,
          get() {
            repairedInvocations += 1;
            throw new Error('post-validation hostile filter accessor invoked');
          },
        });
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    assert.equal(repairedInvocations, 0);
  });

  test('post-validation hostile some accessor on an original array is never executed', async () => {
    const contracts = loadSharedContracts();
    let invocations = 0;
    const report = await certifyRefusal(
      new PostValidationInventoryMutationDriver(contracts, 'analysis', snapshot => {
        Object.defineProperty(snapshot.manualTestSources, 'some', {
          configurable: true,
          get() {
            invocations += 1;
            throw new Error('post-validation hostile some accessor invoked');
          },
        });
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    assert.equal(invocations, 0);
  });

  for (const hostile of [
    {
      name: 'original array contents',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestSources.length = 0;
      },
      mutationObserved: (snapshot: CertificationPersistenceInventory) => snapshot.manualTestSources.length === 0,
    },
    {
      name: 'original row object',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestSources[0]!.sourceId = 'post-validation-mutated-source';
      },
      mutationObserved: (snapshot: CertificationPersistenceInventory) =>
        snapshot.manualTestSources[0]?.sourceId === 'post-validation-mutated-source',
    },
    {
      name: 'original payloadJson string',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestSources[0]!.payloadJson = '{}';
      },
      mutationObserved: (snapshot: CertificationPersistenceInventory) =>
        snapshot.manualTestSources[0]?.payloadJson === '{}',
    },
    {
      name: 'original counts object',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.counts.manualTestSources = 9001;
      },
      mutationObserved: (snapshot: CertificationPersistenceInventory) => snapshot.counts.manualTestSources === 9001,
    },
    {
      name: 'original top-level snapshot object',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestSources = [];
      },
      mutationObserved: (snapshot: CertificationPersistenceInventory) => snapshot.manualTestSources.length === 0,
    },
  ] as const) {
    test(`post-validation mutation of ${hostile.name} cannot change the validated snapshot`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new PostValidationInventoryMutationDriver(contracts, 'read', hostile.mutate),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, true, JSON.stringify(report.findings));
      assert.equal(
        hostile.mutationObserved(report.observations.afterPersistence as CertificationPersistenceInventory),
        true,
        'the driver-owned observation was not mutated after validation',
      );
    });
  }

  test('self-falsification: hostile own keys accessor leaked before repair and is now structurally rejected without reinvocation', async () => {
    const contracts = loadSharedContracts();
    const definitions: unknown[] = [];
    let invocations = 0;
    Object.defineProperty(definitions, 'keys', {
      get() {
        invocations += 1;
        throw new Error('hostile keys accessor invoked');
      },
    });
    assert.throws(() => preFixPlainDataArray(definitions), /hostile keys accessor invoked/);
    assert.equal(invocations, 1);

    const report = await certifyHostileDefinitionArray(contracts, definitions);
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(invocations, 1, 'Certification invoked the hostile keys accessor');
  });

  test('self-falsification: non-function own keys property leaked TypeError before repair and is now structurally rejected', async () => {
    const contracts = loadSharedContracts();
    const definitions: unknown[] = [];
    Object.defineProperty(definitions, 'keys', { value: 123 });
    assert.throws(() => preFixPlainDataArray(definitions), TypeError);

    const report = await certifyHostileDefinitionArray(contracts, definitions);
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
  });

  for (const hostile of [
    {
      name: 'function-valued own keys override',
      build: () => {
        const definitions: unknown[] = [];
        let invocations = 0;
        Object.defineProperty(definitions, 'keys', { value: () => { invocations += 1; } });
        return { definitions, invoked: () => invocations };
      },
    },
    {
      name: 'own Symbol.iterator override',
      build: () => {
        const definitions: unknown[] = [];
        let invocations = 0;
        Object.defineProperty(definitions, Symbol.iterator, { value: () => { invocations += 1; } });
        return { definitions, invoked: () => invocations };
      },
    },
    {
      name: 'numeric index accessor',
      build: () => {
        const definitions: unknown[] = [];
        let invocations = 0;
        Object.defineProperty(definitions, '0', {
          enumerable: true,
          configurable: true,
          get() {
            invocations += 1;
            throw new Error('hostile numeric getter invoked');
          },
        });
        return { definitions, invoked: () => invocations };
      },
    },
  ] as const) {
    test(`rejects ${hostile.name} without invocation`, async () => {
      const contracts = loadSharedContracts();
      const { definitions, invoked } = hostile.build();
      const report = await certifyHostileDefinitionArray(contracts, definitions);
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
      assert.equal(invoked(), 0);
    });
  }

  for (const hostile of [
    {
      name: 'sparse array',
      build: () => new Array(1),
    },
    {
      name: 'custom Array subclass',
      build: () => new (class HostileArray extends Array<unknown> {})(),
    },
    {
      name: 'Proxy-wrapped array',
      build: () => new Proxy([], {
        ownKeys() {
          throw new Error('proxy ownKeys trap invoked');
        },
      }),
    },
  ] as const) {
    test(`rejects ${hostile.name} through the structural finding channel`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyHostileDefinitionArray(contracts, hostile.build());
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    });
  }

  for (const hostile of [
    {
      name: 'sources',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestSources.push(hiddenSourceRow(snapshot.projectId));
      },
      detail: 'counts.manualTestSources=0 does not equal manualTestSources.length=1',
    },
    {
      name: 'definitions',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.definitions.push(hiddenDefinitionRow(snapshot.projectId));
      },
      detail: 'counts.definitions=0 does not equal definitions.length=1',
    },
    {
      name: 'revisions',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.testSetRevisions.push(hiddenRevisionRow(snapshot.projectId));
      },
      detail: 'counts.testSetRevisions=0 does not equal testSetRevisions.length=1',
    },
    {
      name: 'promotions',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        snapshot.manualTestPromotions.push(hiddenPromotionRow(snapshot.projectId));
      },
      detail: 'counts.manualTestPromotions=0 does not equal manualTestPromotions.length=1',
    },
  ] as const) {
    test(`rejects a hidden ${hostile.name} row concealed by its count`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new InventoryHostileM3Driver(contracts, hostile.mutate),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
      assert.match(report.findings[0]!.message, new RegExp(hostile.detail.replaceAll('.', '\\.')));
      assert.equal(Object.hasOwn(report.observations, 'analysis'), false, 'invalid inventory must fail before refusal semantics');
    });
  }

  test('rejects a count that invents an absent Definition row', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => { snapshot.counts.definitions = 1; }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.match(report.findings[0]!.message, /counts\.definitions=1 does not equal definitions\.length=0/);
  });

  for (const hostileCount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '1'] as const) {
    test(`rejects malformed persistence count ${String(hostileCount)}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new InventoryHostileM3Driver(contracts, snapshot => {
          (snapshot.counts as JsonObject).definitions = hostileCount;
        }),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
      assert.match(report.findings[0]!.message, /counts\.definitions must be a non-negative safe integer/);
    });
  }

  test('rejects a non-array inventory property', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        (snapshot as JsonObject).definitions = {};
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, false);
    assert.match(report.findings[0]!.message, /definitions must be an exact plain data array/);
  });

  for (const hostile of [
    {
      name: 'missing required inventory property',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        delete (snapshot as JsonObject).definitions;
      },
    },
    {
      name: 'extra top-level inventory property',
      mutate: (snapshot: CertificationPersistenceInventory) => {
        (snapshot as JsonObject).ignoredRows = [];
      },
    },
  ] as const) {
    test(`rejects ${hostile.name}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new InventoryHostileM3Driver(contracts, hostile.mutate),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, false);
      assert.match(report.findings[0]!.message, /top-level inventory fields must be exact/);
    });
  }

  test('rejects a malformed row that matches the reported count', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        snapshot.counts.definitions = 1;
        snapshot.definitions.push({} as never);
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, false);
    assert.match(report.findings[0]!.message, /definitions contains a malformed or cross-project row/);
  });

  test('rejects a row bound to a different project', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        snapshot.counts.definitions = 1;
        snapshot.definitions.push(hiddenDefinitionRow('different-project'));
      }),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, false);
    assert.match(report.findings[0]!.message, /definitions contains a malformed or cross-project row/);
  });

  test('self-falsification: the formerly false-PASS hidden Definition refusal is rejected before semantic non-authority', async () => {
    const contracts = loadSharedContracts();
    const source = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
    const preFixDriver = new InventoryHostileM3Driver(contracts, snapshot => {
      snapshot.definitions.push(hiddenDefinitionRow(snapshot.projectId));
    });
    await preFixDriver.configureCertificationScenario('unsupported_fill');
    const preFixBefore = await preFixDriver.snapshot(source.projectId);
    const preFixAnalysis = await preFixDriver.analyzeManualTest({ source, scenario: 'unsupported_fill' });
    const preFixAfter = await preFixDriver.snapshot(source.projectId);
    const preFixAdmittedSource = await preFixDriver.readManualSource(source.projectId, source.sourceId);
    const preFixRefusal = preFixAnalysis.kind === 'analysis' && preFixAnalysis.result.outcome.kind === 'refusal'
      ? preFixAnalysis.result.outcome.refusal
      : null;
    const preFixFalsePass = preFixRefusal !== null
      && isDeepStrictEqual(preFixAdmittedSource, source)
      && isDeepStrictEqual(preFixRefusal.sourceAuthority, {
        sourceId: source.sourceId,
        sourceContentHash: source.contentHash,
      })
      && preFixAfter.manualTestSources.filter(row => row.sourceId === source.sourceId
        && row.projectId === source.projectId
        && row.contentHash === source.contentHash).length === 1
      && preFixAfter.counts.manualTestSources - preFixBefore.counts.manualTestSources === 1
      && preFixAfter.counts.definitions - preFixBefore.counts.definitions === 0
      && preFixAfter.counts.testSetRevisions - preFixBefore.counts.testSetRevisions === 0
      && preFixAfter.counts.manualTestPromotions - preFixBefore.counts.manualTestPromotions === 0;
    assert.equal(preFixFalsePass, true, 'the original counts-only refusal predicate did not reproduce its false PASS');
    assert.equal(preFixBefore.counts.definitions, 0);
    assert.equal(preFixBefore.definitions.length, 1);

    const report = await certifyRefusal(
      new InventoryHostileM3Driver(contracts, snapshot => {
        snapshot.definitions.push(hiddenDefinitionRow(snapshot.projectId));
      }),
      contracts,
      'unsupported-fill.json',
    );
    const before = report.observations.beforePersistence as CertificationPersistenceInventory;
    assert.deepEqual(before, preFixBefore, 'repair proof did not reuse the identical malformed snapshot');
    assert.equal(before.counts.definitions, 0);
    assert.equal(before.definitions.length, 1);
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(Object.hasOwn(report.observations, 'analysis'), false);
  });

  test('replay rejects a hidden extra row with a lying count before comparing state', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new InventoryHostileM3Driver(contracts, (snapshot, call) => {
        if (call === 4) snapshot.definitions.push(hiddenDefinitionRow(snapshot.projectId));
      }),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(report.findings.some(finding => finding.code === 'SAVE_REPLAY_PERSISTED_HIDDEN_AUTHORITY'), false);
  });

  test('atomic rollback rejects hidden residue with a lying count before comparing state', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new InventoryHostileM3Driver(contracts, (snapshot, call) => {
        if (call === 6) snapshot.manualTestPromotions.push(hiddenPromotionRow(snapshot.projectId));
      }),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['PERSISTENCE_SNAPSHOT_INCONSISTENT']);
    assert.equal(report.findings.some(finding => finding.code === 'PROMOTION_FAULT_LEFT_PERSISTED_RESIDUE'), false);
  });

  test('clean unsupported-fill mechanics refuse the whole exact source and admit no authority', async () => {
    const contracts = loadSharedContracts();
    const source = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
    const report = await certifyWholeSourceRefusal(
      new ReferenceM3CertificationDriver(contracts),
      source,
      'partial_unsupported_fill_between',
      { requireProductAuthority: false },
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    assert.deepEqual(report.observations.readSource, source);
    assert.equal(report.observations.proposal, null);
    assert.equal(Object.hasOwn(report.observations, 'save'), false);
    assert.equal(Object.hasOwn(report.observations, 'definition'), false);
    const analysis = report.observations.analysis as { result: ManualAnalysisResultV1 };
    assert.deepEqual(
      analysis.result.outcome.kind === 'refusal'
        ? analysis.result.outcome.refusal.sourceGrounding.map(item => item.status)
        : [],
      ['grounded', 'unsupported_semantics', 'grounded', 'grounded'],
    );
  });

  test('an altered shared negative fixture is rejected by the physical-fixture identity check', async () => {
    const alteredContracts = cloneValue(loadSharedContracts());
    const altered = alteredContracts.refusals['unsupported-fill.json'];
    if (!altered || altered.outcome.kind !== 'refusal') throw new Error('Missing unsupported-fill refusal fixture.');
    altered.outcome.refusal.safeMessage = `${altered.outcome.refusal.safeMessage} rewritten`;
    const report = await certifyRefusal(
      new ReferenceM3CertificationDriver(alteredContracts),
      alteredContracts,
      'unsupported-fill.json',
      { requireProductAuthority: false },
    );
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['SHARED_REFUSAL_FIXTURE_DIVERGED']);
  });

  test('the pre-fix refusal checks accept source A with exact source-B refusal semantics, while repaired certification rejects the identical mismatch', async () => {
    const contracts = loadSharedContracts();
    const sourceA = cloneValue(contracts.positiveSource);
    const report = await certifyRefusal(
      new ReferenceM3CertificationDriver(contracts),
      contracts,
      'unsupported-fill.json',
      { requireProductAuthority: false, refusalHarnessSource: sourceA },
    );
    const analysis = report.observations.analysis as AnalyzeResult;
    if (analysis.kind !== 'analysis' || analysis.result.outcome.kind !== 'refusal') {
      throw new Error('Expected exact shared semantic refusal.');
    }
    const refusal = analysis.result.outcome.refusal;
    const admittedSource = report.observations.readSource as ManualTestSourceV1;
    const authorityMatches = refusal.projectId === admittedSource.projectId
      && refusal.sourceAuthority.sourceId === admittedSource.sourceId
      && refusal.sourceAuthority.sourceContentHash === admittedSource.contentHash;
    const preFixFindings = report.findings.filter(finding => finding.code !== 'REFUSAL_AUTHORITY_MISMATCH');
    assert.equal(authorityMatches, false);
    assert.deepEqual(preFixFindings, [], 'the identical cross-source case no longer reproduces the pre-fix false PASS');
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(finding => finding.code), ['REFUSAL_AUTHORITY_MISMATCH']);
  });

  for (const hostile of [
    {
      name: 'same project but wrong sourceId',
      mutate: (source: ManualTestSourceV1) => { source.sourceId = 'manual-source-wrong-id'; },
    },
    {
      name: 'same sourceId but wrong sourceContentHash',
      mutate: (source: ManualTestSourceV1) => { source.contentHash = 'f'.repeat(64); },
    },
    {
      name: 'wrong projectId with otherwise matching source authority',
      mutate: (source: ManualTestSourceV1) => { source.projectId = 'project-wrong'; },
    },
  ] as const) {
    test(`refusal authority rejects ${hostile.name}`, async () => {
      const contracts = loadSharedContracts();
      const source = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
      hostile.mutate(source);
      const report = await certifyRefusal(
        new ReferenceM3CertificationDriver(contracts),
        contracts,
        'unsupported-fill.json',
        { requireProductAuthority: false, refusalHarnessSource: source },
      );
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(finding => finding.code), ['REFUSAL_AUTHORITY_MISMATCH']);
    });
  }

  test('partial-automation adapters really promote shortened v3 Definitions before certification rejects them', async () => {
    const contracts = loadSharedContracts();
    const cases = [
      {
        fault: 'drop_unsupported_source_line' as const,
        source: sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json'),
        scenario: 'partial_unsupported_fill_between' as const,
        omittedOrdinal: 2,
      },
      {
        fault: 'shorten_source_into_v3' as const,
        source: sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json'),
        scenario: 'partial_unsupported_fill_between' as const,
        omittedOrdinal: null,
      },
      {
        fault: 'ignore_trailing_unsupported_step' as const,
        source: trailingUnsupportedHarnessSource(contracts),
        scenario: 'partial_unsupported_trailing_step' as const,
        omittedOrdinal: 3,
      },
    ];
    for (const item of cases) {
      const report = await certifyWholeSourceRefusal(
        new DeliberatelyBrokenM3Adapter(contracts, item.fault),
        item.source,
        item.scenario,
      );
      assert.equal(report.passed, false, `${item.fault} escaped certification`);
      assert.deepEqual(
        ['WHOLE_SOURCE_REFUSAL_MISSING', 'WHOLE_SOURCE_GROUNDING_DROPPED',
          'UNSUPPORTED_SOURCE_LINE_HIDDEN', 'PARTIAL_PROPOSAL_ADMITTED',
          'PARTIAL_PROMOTION_ADMITTED', 'PARTIAL_DEFINITION_ADMITTED']
          .filter(code => !report.findings.some(finding => finding.code === code)),
        [],
        `${item.fault} did not trigger every partial-automation authority finding`,
      );
      assert.deepEqual(report.observations.readSource, item.source);
      const save = report.observations.save as SaveResult;
      assert.equal(save.kind, 'promoted', `${item.fault} did not exercise promotion`);
      const definition = report.observations.definition as DefinitionObservation;
      assert.equal(definition.schemaVersion, 3);
      assert.equal(definition.canonicalActions.length, 2);
      assert.equal(definition.canonicalActions[0]?.routePath, '/checkout-step-one.html');
      assert.equal(definition.canonicalActions[1]?.dataTestValue, 'continue');
      assert.equal(definition.oracle.subjectId, 'subject-checkout-overview');
      assert.equal(item.source.steps.length, 3);
      if (item.omittedOrdinal !== null) {
        const proposal = report.observations.proposal as ManualAutomationProposalV1;
        assert.equal(proposal.sourceGrounding.some(item => {
          const sourceRef = item.sourceRef as JsonObject;
          return sourceRef.kind === 'step' && sourceRef.ordinal === item.omittedOrdinal;
        }), false);
      }
    }
  });

  test('each stale-save adapter accepts only its intended stale category and is caught by that category finding', async () => {
    const contracts = loadSharedContracts();
    const staleFaults = Object.entries(STALE_CERTIFICATION_SCENARIO_BY_FAULT) as Array<[StaleAcceptanceFault, typeof STALE_SAVE_CASES[number]['scenario']]>;
    assert.equal(staleFaults.length, 7);
    for (const [index, [fault, scenario]] of staleFaults.entries()) {
      const staleCase = STALE_SAVE_CASES.find(candidate => candidate.scenario === scenario);
      if (!staleCase) throw new Error(`Missing stale Save case for ${scenario}`);
      const adapter = new DeliberatelyBrokenM3Adapter(contracts, fault);
      const report = await certifyStaleSave(
        adapter,
        contracts,
        staleCase,
      );
      assert.equal(report.passed, false, `${fault} escaped its intended certification category`);
      assert.deepEqual(report.findings.map(finding => finding.code), [staleCase.findingCode]);
      assert.equal((report.observations.save as SaveResult).kind, 'promoted', `${fault} did not genuinely accept stale Save`);
      const reviewedProposal = report.observations.reviewedProposal as ManualAutomationProposalV1;
      assert.ok(reviewedProposal, `${fault} failed before a valid reviewed proposal existed`);

      const trace = adapter.readStaleSaveRevalidationTrace();
      assert.ok(trace, `${fault} did not expose current reanalysis and its category-specific intervention`);
      assert.equal(trace.scenario, scenario);
      assert.equal(trace.trustedDimension, TRUSTED_DIMENSION_BY_FAULT[fault]);
      assert.equal((report.observations.save as Extract<SaveResult, { kind: 'promoted' }>).reanalysisPerformed, true);

      if (fault === 'accept_current_reanalysis_refusal') {
        assert.equal(trace.currentAnalysis.outcome.kind, 'refusal');
        assert.equal(
          trace.currentAnalysis.outcome.kind === 'refusal'
            ? trace.currentAnalysis.outcome.refusal.code
            : null,
          'insufficient_evidence',
        );
        assert.deepEqual(trace.comparisonProposal, reviewedProposal);
      } else {
        assert.equal(trace.currentAnalysis.outcome.kind, 'proposal');
        if (trace.currentAnalysis.outcome.kind !== 'proposal') throw new Error('Expected current proposal trace.');
        const currentProposal = trace.currentAnalysis.outcome.proposal;
        const trustedDimension = TRUSTED_DIMENSION_BY_FAULT[fault] as typeof PROPOSAL_REVALIDATION_DIMENSIONS[number];
        for (const dimension of PROPOSAL_REVALIDATION_DIMENSIONS) {
          if (dimension === trustedDimension) {
            assert.notDeepEqual(
              proposalDimension(currentProposal, dimension),
              proposalDimension(reviewedProposal, dimension),
              `${fault} setup did not make its trusted authority dimension stale`,
            );
            assert.deepEqual(
              proposalDimension(trace.comparisonProposal, dimension),
              proposalDimension(reviewedProposal, dimension),
              `${fault} did not trust exactly its reviewed authority dimension`,
            );
          } else {
            assert.deepEqual(
              proposalDimension(currentProposal, dimension),
              proposalDimension(reviewedProposal, dimension),
              `${fault} setup unexpectedly changed neighboring authority dimension ${dimension}`,
            );
            assert.deepEqual(
              proposalDimension(trace.comparisonProposal, dimension),
              proposalDimension(currentProposal, dimension),
              `${fault} rewrote neighboring revalidated authority dimension ${dimension}`,
            );
          }
        }
        assert.equal(trace.comparisonProposal.proposalId, reviewedProposal.proposalId);
        assert.equal(
          trace.comparisonProposal.normalizedIntentContentHash,
          reviewedProposal.normalizedIntentContentHash,
        );
        assert.equal(trace.comparisonProposal.proposalContentHash, reviewedProposal.proposalContentHash);
      }

      const controlCase = STALE_SAVE_CASES[(index + 1) % STALE_SAVE_CASES.length]!;
      const controlAdapter = new DeliberatelyBrokenM3Adapter(contracts, fault);
      const control = await certifyStaleSave(
        controlAdapter,
        contracts,
        controlCase,
      );
      assert.equal(control.passed, true, `${fault} is a generic stale bypass instead of a category-specific defect`);
      assert.deepEqual(control.observations.save, { kind: 'refused', code: controlCase.expectedCode });
      assert.equal(
        controlAdapter.readStaleSaveRevalidationTrace(),
        null,
        `${fault} intervened in neighboring category ${controlCase.scenario}`,
      );
    }
  });

  test('authentication and Definition body bugs consume only their forbidden semantic class', async () => {
    const contracts = loadSharedContracts();
    const authentication = hostileAuthenticationSaveBody(contracts);
    const definition = hostileDefinitionSaveBody(contracts);

    const authenticationReport = await certifySaveRefusesBody(
      new DeliberatelyBrokenM3Adapter(contracts, 'accept_authentication_body_at_save'),
      contracts,
      { authentication },
      'SAVE_ACCEPTED_AUTHENTICATION_BODY',
    );
    assert.equal(authenticationReport.passed, false);
    assert.deepEqual(
      authenticationReport.findings.map(finding => finding.code),
      ['SAVE_ACCEPTED_AUTHENTICATION_BODY'],
    );
    assert.equal((authenticationReport.observations.save as SaveResult).kind, 'promoted');
    const authenticationDefinition = authenticationReport.observations.definition as DefinitionObservation;
    assert.deepEqual(authenticationDefinition.authenticationExpectation, authentication.expectation);
    assert.equal(
      authenticationDefinition.authenticationExpectation.identityHash,
      (authentication.authority as JsonObject).authenticationExpectationIdentityHash,
    );
    assert.deepEqual(authenticationDefinition.normalizedIntent.preconditions, authentication.preconditions);
    const authenticationControl = await certifySaveRefusesBody(
      new DeliberatelyBrokenM3Adapter(contracts, 'accept_authentication_body_at_save'),
      contracts,
      { definition },
      'SAVE_ACCEPTED_DEFINITION_BODY',
    );
    assert.equal(authenticationControl.passed, true);
    assert.deepEqual(authenticationControl.observations.save, {
      kind: 'refused',
      code: 'SAVE_REQUEST_NOT_IDENTITY_ONLY',
    });

    const definitionReport = await certifySaveRefusesBody(
      new DeliberatelyBrokenM3Adapter(contracts, 'accept_definition_body_at_save'),
      contracts,
      { definition },
      'SAVE_ACCEPTED_DEFINITION_BODY',
    );
    assert.equal(definitionReport.passed, false);
    assert.deepEqual(
      definitionReport.findings.map(finding => finding.code),
      ['SAVE_ACCEPTED_DEFINITION_BODY'],
    );
    assert.equal((definitionReport.observations.save as SaveResult).kind, 'promoted');
    assert.deepEqual(definitionReport.observations.definition, definition);
    const definitionControl = await certifySaveRefusesBody(
      new DeliberatelyBrokenM3Adapter(contracts, 'accept_definition_body_at_save'),
      contracts,
      { authentication },
      'SAVE_ACCEPTED_AUTHENTICATION_BODY',
    );
    assert.equal(definitionControl.passed, true);
    assert.deepEqual(definitionControl.observations.save, {
      kind: 'refused',
      code: 'SAVE_REQUEST_NOT_IDENTITY_ONLY',
    });

    const identityOnly = await certifyGolden(
      new ReferenceM3CertificationDriver(contracts),
      contracts,
      { requireProductAuthority: false },
    );
    assert.equal(identityOnly.passed, true, JSON.stringify(identityOnly.findings));
  });

  test('state observation rejects non-atomic hidden residue despite reported atomic success', async () => {
    const report = await falsificationReport('non_atomic_promotion_residue');
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(item => item.code === 'PROMOTION_FAULT_RETURNED_FROZEN_OUTCOME'));
    assert.ok(report.findings.some(item => item.code === 'PROMOTION_FAULT_LEFT_PERSISTED_RESIDUE'));
    const before = report.observations.beforeFaultPersistence as { counts: Record<string, number> };
    const after = report.observations.afterFaultPersistence as { counts: Record<string, number> };
    assert.equal(after.counts.definitions, before.counts.definitions + 1);
    assert.equal(after.counts.testSetRevisions, before.counts.testSetRevisions + 1);
    assert.equal(after.counts.manualTestPromotions, before.counts.manualTestPromotions);
  });

  test('the former any-throw atomicity predicate accepts an unrelated TypeError, while repaired certification rejects it', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new AtomicityFailureHostileM3Adapter(contracts, 'unrelated_type_error'),
      contracts,
    );
    const legacyAnyThrowPredicate = report.observations.faultOutcome !== null
      && JSON.stringify(report.observations.afterFaultPersistence)
        === JSON.stringify(report.observations.beforeFaultPersistence);
    assert.equal(legacyAnyThrowPredicate, true, 'adversarial driver no longer reproduces the pre-repair false PASS conditions');
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
    assert.deepEqual(report.observations.faultOutcome, {
      name: 'TypeError', message: 'unrelated adapter bug',
    });
    assert.deepEqual(report.observations.faultFailure, {
      kind: 'unexpected', name: 'TypeError', message: 'unrelated adapter bug',
    });
  });

  test('the former field-only predicate accepts an overbroad fault envelope, while exact certification rejects it', async () => {
    const contracts = loadSharedContracts();
    const overbroadObservation = {
      kind: 'internal',
      code: CONTROLLED_PROMOTION_FAULT_CODE,
      status: 418,
      name: 'WrongEnvelope',
    };
    const report = await certifyGolden(new AtomicityFailureHostileM3Adapter(
      contracts,
      'frozen_save_failure',
      overbroadObservation,
    ), contracts);
    const observed = report.observations.faultFailure as Record<string, unknown>;
    const legacyFieldOnlyPredicate = observed.kind === 'internal'
      && observed.code === CONTROLLED_PROMOTION_FAULT_CODE
      && JSON.stringify(report.observations.afterFaultPersistence)
        === JSON.stringify(report.observations.beforeFaultPersistence);
    assert.equal(legacyFieldOnlyPredicate, true, 'hostile observation must reproduce the pre-repair false PASS');
    assert.deepEqual(report.observations.faultFailure, overbroadObservation);
    assert.deepEqual(report.observations.afterFaultPersistence, report.observations.beforeFaultPersistence);
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
  });

  test('the pre-fix exact-envelope validator accepts Proxy-hidden extras, while repaired certification rejects the identical Proxy', async () => {
    const contracts = loadSharedContracts();
    const target = {
      kind: 'internal',
      code: CONTROLLED_PROMOTION_FAULT_CODE,
      status: 418,
      name: 'WrongEnvelope',
    };
    const hiddenExtrasProxy = new Proxy(target, {
      getPrototypeOf: () => Object.prototype,
      ownKeys: () => ['kind', 'code'],
      getOwnPropertyDescriptor: (value, key) => key === 'kind' || key === 'code'
        ? Reflect.getOwnPropertyDescriptor(value, key)
        : undefined,
    });
    const preFixExactEnvelopePredicate = (observation: unknown): boolean => {
      if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) return false;
      if (Object.getPrototypeOf(observation) !== Object.prototype) return false;
      const keys = Reflect.ownKeys(observation);
      if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('code')) return false;
      const kind = Object.getOwnPropertyDescriptor(observation, 'kind');
      const code = Object.getOwnPropertyDescriptor(observation, 'code');
      return kind !== undefined && 'value' in kind
        && code !== undefined && 'value' in code
        && isDeepStrictEqual(observation, {
          kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
        });
    };

    assert.deepEqual(Reflect.ownKeys(target), ['kind', 'code', 'status', 'name']);
    assert.equal(preFixExactEnvelopePredicate(hiddenExtrasProxy), true,
      'hostile Proxy must reproduce the pre-fix exact-envelope false PASS');
    const report = await certifyGolden(new AtomicityFailureHostileM3Adapter(
      contracts,
      'frozen_save_failure',
      hiddenExtrasProxy,
    ), contracts);
    assert.equal(report.observations.faultFailure, hiddenExtrasProxy);
    assert.deepEqual(report.observations.afterFaultPersistence, report.observations.beforeFaultPersistence);
    assert.equal(report.passed, false);
    assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
  });

  test('state observation rejects hidden replay rows when returned authority is unchanged', async () => {
    const report = await falsificationReport('hidden_replay_persistence');
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(item => item.code === 'SAVE_REPLAY_PERSISTED_HIDDEN_AUTHORITY'));
    assert.deepEqual(
      (report.observations.replay as Extract<SaveResult, { kind: 'promoted' }>).result.definitionAuthority,
      (report.observations.save as Extract<SaveResult, { kind: 'promoted' }>).result.definitionAuthority,
    );
    const before = report.observations.beforeReplayPersistence as { counts: Record<string, number> };
    const after = report.observations.afterReplayPersistence as { counts: Record<string, number> };
    assert.equal(after.counts.definitions, before.counts.definitions + 1);
    assert.equal(after.counts.testSetRevisions, before.counts.testSetRevisions + 1);
    assert.equal(after.counts.manualTestPromotions, before.counts.manualTestPromotions + 1);
  });

  test('state observation rejects semantic refusal that silently persists authority', async () => {
    const report = await falsificationReport('semantic_refusal_persists_authority');
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(item => item.code === 'SEMANTIC_REFUSAL_PERSISTED_DEFINITION'));
    assert.ok(report.findings.some(item => item.code === 'SEMANTIC_REFUSAL_PERSISTED_TEST_SET'));
    assert.ok(report.findings.some(item => item.code === 'SEMANTIC_REFUSAL_PERSISTED_PROMOTION'));
    const analysis = report.observations.analysis as AnalyzeResult;
    assert.equal(analysis.kind === 'analysis' && analysis.result.outcome.kind, 'refusal');
  });

  for (const fault of BROKEN_ADAPTER_FAULTS) {
    test(`rejects deliberately broken adapter: ${fault}`, async () => {
      const report = await falsificationReport(fault);
      assert.equal(report.driverAuthorityClass, 'product');
      assert.equal(report.passed, false, `${fault} escaped certification`);
      assert.ok(report.findings.length > 0, `${fault} produced no independent finding`);
    });
  }

  test('canonical v3 remains valid without embedded manualPromotion and binds separate provenance', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(new ReferenceM3CertificationDriver(contracts), contracts, { requireProductAuthority: false });
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    const definition = report.observations.definition as JsonObject;
    const promotion = report.observations.promotion as JsonObject;
    assert.equal(Object.hasOwn(definition, 'manualPromotion'), false);
    assert.deepEqual(promotion.definitionAuthority, definition.definitionAuthority);
  });

  test('M2 admission consumes exact Definition authority only', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(new ReferenceM3CertificationDriver(contracts), contracts, { requireProductAuthority: false });
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    const candidate = report.observations.candidate as JsonObject;
    const definition = report.observations.definition as JsonObject;
    assert.deepEqual(Object.keys(candidate).sort(), ['definitionAuthority', 'executable', 'projectId']);
    assert.deepEqual(candidate.definitionAuthority, definition.definitionAuthority);
  });

  test('accepts arbitrary internally consistent opaque IDs and hashes without a reference oracle', async () => {
    const contracts = cloneValue(loadSharedContracts());
    contracts.positiveSource.contentHash = '1'.repeat(64);
    contracts.positiveProposal.proposalId = 'product-emitted-arbitrary-proposal-09';
    contracts.positiveProposal.sourceAuthority.sourceContentHash = '1'.repeat(64);
    contracts.positiveProposal.normalizedIntentContentHash = '2'.repeat(64);
    contracts.positiveProposal.proposalContentHash = '3'.repeat(64);
    contracts.positiveSaveResult.sourceAuthority.sourceContentHash = '1'.repeat(64);
    contracts.positiveSaveResult.proposalAuthority.proposalId = contracts.positiveProposal.proposalId;
    contracts.positiveSaveResult.proposalAuthority.proposalContentHash = '3'.repeat(64);
    const cleanMechanics = new ReferenceM3CertificationDriver(contracts);
    assert.equal(cleanMechanics.authorityClass, 'reference');
    const report = await certifyOpaqueAuthority(cleanMechanics, contracts);
    assert.equal(report.passed, true, JSON.stringify(report.findings));
  });

  test('self-falsification: fixture literals reject Product-derived authority alone, while Product-mode binding accepts the same semantics', async () => {
    const contracts = loadSharedContracts();
    const preFixDriver = new OpaqueProductIdentityM3Driver(contracts);
    const analyzed = await preFixDriver.analyzeManualTest({ source: cloneValue(contracts.positiveSource) });
    if (analyzed.kind !== 'analysis') throw new Error('Opaque Product setup did not analyze.');
    const { sourceId: observedId, contentHash: observedHash, ...observedSemantics } = analyzed.source;
    const {
      sourceId: fixtureId,
      contentHash: fixtureHash,
      ...fixtureSemantics
    } = contracts.positiveSource;
    assert.notEqual(observedId, fixtureId);
    assert.notEqual(observedHash, fixtureHash);
    assert.deepEqual(observedSemantics, fixtureSemantics);
    assert.equal(
      await preFixDriver.readManualSource(contracts.positiveSource.projectId, fixtureId),
      null,
      'the pre-fix fixture-literal lookup must reproduce the blocker',
    );

    const report = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts), contracts);
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    const receipt = report.observations.analysis as Extract<AnalyzeResult, { kind: 'analysis' }>;
    assert.notEqual(receipt.source.sourceId, fixtureId);
    assert.notEqual(receipt.source.contentHash, fixtureHash);
    if (receipt.result.outcome.kind !== 'proposal') throw new Error('Expected Product proposal.');
    const productProposal = receipt.result.outcome.proposal as any;
    assert.notEqual(productProposal.proposalId, contracts.positiveProposal.proposalId);
    assert.notEqual(productProposal.proposalContentHash, contracts.positiveProposal.proposalContentHash);
    assert.notEqual(productProposal.authority.modelRowId, contracts.positiveProposal.authority.modelRowId);
    assert.notEqual(productProposal.authority.supportSealHash, contracts.positiveProposal.authority.supportSealHash);
    assert.notEqual(productProposal.normalizedIntent.intentId, contracts.positiveProposal.normalizedIntent.intentId);
    assert.notEqual(productProposal.normalizedIntent.steps[0].stepId, (contracts.positiveProposal.normalizedIntent.steps as JsonObject[])[0]!.stepId);
    assert.notEqual(productProposal.normalizedIntent.expectedOutcomes[0].outcomeId, (contracts.positiveProposal.normalizedIntent.expectedOutcomes as JsonObject[])[0]!.outcomeId);
    assert.deepEqual(productProposal.appArea.evidenceIds, ['product-app-area-evidence', 'product-subject-cart']);
    assert.ok(productProposal.appArea.evidenceIds.includes(productProposal.appArea.sourceSubjectId));
    assert.notEqual(productProposal.oracle.supportingObservationIds[0],
      (contracts.positiveProposal.oracle.supportingObservationIds as unknown[])[0]);
    assert.notEqual(productProposal.authenticationExpectation.bases[0].configurationDigest,
      (contracts.positiveProposal.authenticationExpectation.bases as JsonObject[])[0]!.configurationDigest);
  });

  test('Product-mode refusal substitutes only the observed source authority and preserves exact fixture semantics', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new OpaqueProductIdentityM3Driver(contracts),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    const receipt = report.observations.analysis as Extract<AnalyzeResult, { kind: 'analysis' }>;
    if (receipt.result.outcome.kind !== 'refusal') throw new Error('Expected Product refusal.');
    assert.deepEqual(receipt.result.outcome.refusal.sourceAuthority, {
      sourceId: receipt.source.sourceId,
      sourceContentHash: receipt.source.contentHash,
    });
    assert.notEqual(receipt.source.sourceId, sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json').sourceId);
  });

  test('Product-mode refusal rejects floated cross-source authority despite matching source semantics', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyRefusal(
      new OpaqueProductIdentityM3Driver(contracts, 'float_refusal_source_authority'),
      contracts,
      'unsupported-fill.json',
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.code === 'REFUSAL_AUTHORITY_MISMATCH'));
    const receipt = report.observations.analysis as Extract<AnalyzeResult, { kind: 'analysis' }>;
    if (receipt.result.outcome.kind !== 'refusal') throw new Error('Expected floated Product refusal.');
    assert.notEqual(receipt.result.outcome.refusal.sourceAuthority.sourceId, receipt.source.sourceId);
  });

  test('Product-mode persistence rejects wrong observed source authority', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'persist_wrong_source_authority'),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.code === 'PERSISTENCE_SNAPSHOT_INCONSISTENT'));
  });

  test('Product-mode persistence rejects wrong proposal and source authority in the persisted proposal payload', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'persist_wrong_proposal_and_source_authority'),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.code === 'PERSISTENCE_SNAPSHOT_INCONSISTENT'));
  });

  for (const fault of [
    'float_model_authority_definition',
    'float_evidence_authority_definition',
    'float_auth_authority_definition',
    'float_app_area_evidence_definition',
  ] as const) {
    test(`Product-mode rejects floated derived authority between proposal and Definition: ${fault}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts, fault), contracts);
      assert.equal(report.passed, false);
      assert.ok(report.findings.some(finding => finding.code === 'PROMOTED_V3_SEMANTICS_DRIFT'));
    });
  }

  test('self-falsification: actual observed Checkout index 7 passes while internally consistent off-by-one 6 fails', async () => {
    const contracts = loadSharedContracts();
    const corrected = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts), contracts);
    assert.equal(corrected.passed, true);

    const offByOne = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'off_by_one_flow_step_index'),
      contracts,
    );
    assert.equal(offByOne.passed, false);
    assert.ok(offByOne.findings.some(finding => finding.code === 'PROPOSAL_FIXTURE_SEMANTICS_DRIFT'));
    assert.equal(offByOne.findings.some(finding => finding.code === 'CLICK_NOT_OBSERVED'), false);
    const receipt = offByOne.observations.analysis as Extract<AnalyzeResult, { kind: 'analysis' }>;
    if (receipt.result.outcome.kind !== 'proposal') throw new Error('Expected off-by-one Product proposal.');
    const proposal = receipt.result.outcome.proposal;
    assert.ok(isJsonObject(proposal.normalizedIntent), 'Expected normalized Product intent object.');
    const normalizedGrounding = proposal.normalizedIntent.grounding;
    assert.ok(isJsonObject(normalizedGrounding), 'Expected normalized Product grounding object.');
    assert.deepEqual(normalizedGrounding.selectedFlowStepIndexes, [6]);
    assert.ok(Array.isArray(proposal.sourceGrounding), 'Expected Product source-grounding array.');
    const checkoutGrounding = proposal.sourceGrounding[1];
    assert.ok(isJsonObject(checkoutGrounding), 'Expected Checkout source-grounding object.');
    const checkoutBasis = checkoutGrounding.basis;
    assert.ok(isJsonObject(checkoutBasis), 'Expected Checkout source-grounding basis object.');
    assert.equal(checkoutBasis.flowStepIndex, 6);
  });

  test('self-falsification: the former Product oracle wording violates the frozen proposal literal', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'drift_proposal_explanation'),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.code === 'PROPOSAL_FIXTURE_SEMANTICS_DRIFT'));
    assert.ok(report.findings.some(finding => finding.code === 'ORACLE_SEMANTICS_DRIFT'));
  });

  for (const { fault, findingCode } of [
    { fault: 'drift_proposal_oracle_kind', findingCode: 'ORACLE_SEMANTICS_DRIFT' },
    { fault: 'drift_proposal_oracle_subject', findingCode: 'DERIVED_PRODUCT_AUTHORITY_FLOATED' },
    { fault: 'drift_proposal_outcome', findingCode: 'ORACLE_SEMANTICS_DRIFT' },
    { fault: 'drift_proposal_oracle_support', findingCode: 'DERIVED_PRODUCT_AUTHORITY_FLOATED' },
  ] as const) {
    test(`semantic oracle hostile remains strict: ${fault}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts, fault), contracts);
      assert.equal(report.passed, false);
      assert.ok(report.findings.some(finding => finding.code === findingCode));
    });
  }

  test('self-falsification: canonical v3 oracle explanation remains independently strict', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'drift_definition_explanation'),
      contracts,
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.code === 'PROMOTED_V3_SEMANTICS_DRIFT'));
  });

  test('self-falsification: unrelated appArea evidence formerly passed but now fails its source-page authority binding', async () => {
    const contracts = loadSharedContracts();
    const report = await certifyGolden(
      new OpaqueProductIdentityM3Driver(contracts, 'wrong_app_area_evidence_ids'),
      contracts,
    );
    assert.equal(report.passed, false);
    const finding = report.findings.find(item => item.code === 'DERIVED_PRODUCT_AUTHORITY_FLOATED');
    assert.match(finding?.message ?? '', /appArea source-page evidence/);
    const receipt = report.observations.analysis as Extract<AnalyzeResult, { kind: 'analysis' }>;
    if (receipt.result.outcome.kind !== 'proposal') throw new Error('Expected floated Product proposal.');
    const floatedProposal = receipt.result.outcome.proposal as any;
    assert.deepEqual(floatedProposal.appArea.evidenceIds, ['floated-app-area-evidence']);
    assert.deepEqual(floatedProposal.normalizedIntent.appArea.evidenceIds, ['floated-app-area-evidence']);
    assert.equal(
      isDeepStrictEqual(floatedProposal.appArea, floatedProposal.normalizedIntent.appArea)
        && floatedProposal.normalizedIntent.steps[0].subjectId === floatedProposal.appArea.sourceSubjectId
        && floatedProposal.normalizedIntent.grounding.subjectSupport.some(
          (support: JsonObject) => support.canonicalSubjectId === floatedProposal.appArea.sourceSubjectId,
        ),
      true,
      'the pre-repair appArea checks accepted this identical floated evidence payload',
    );
  });

  for (const fault of [
    'wrong_grounding_evidence_ids',
    'wrong_app_area_source_subject',
    'drift_normalized_app_area_evidence',
  ] as const) {
    test(`Product-mode rejects derived authority floated inside proposal binding: ${fault}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts, fault), contracts);
      assert.equal(report.passed, false);
      assert.ok(report.findings.some(finding => finding.code === 'DERIVED_PRODUCT_AUTHORITY_FLOATED'));
    });
  }

  for (const fault of [
    'drift_source_title',
    'drift_source_steps',
    'drift_source_outcome',
    'drift_proposal_steps',
    'drift_proposal_selector',
    'drift_proposal_action_kind',
    'drift_proposal_outcome',
  ] as const) {
    test(`Product-mode opaque authority cannot hide positive semantic drift: ${fault}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyGolden(new OpaqueProductIdentityM3Driver(contracts, fault), contracts);
      assert.equal(report.passed, false);
      assert.ok(report.findings.some(finding => finding.code === 'SOURCE_FIXTURE_SEMANTICS_DRIFT'
        || finding.code === 'PROPOSAL_FIXTURE_SEMANTICS_DRIFT'));
    });
  }

  for (const fault of ['drift_refusal_code', 'drift_refusal_grounding'] as const) {
    test(`Product-mode opaque authority cannot hide refusal semantic drift: ${fault}`, async () => {
      const contracts = loadSharedContracts();
      const report = await certifyRefusal(
        new OpaqueProductIdentityM3Driver(contracts, fault),
        contracts,
        'unsupported-fill.json',
      );
      assert.equal(report.passed, false);
      assert.ok(report.findings.some(finding => finding.code === 'SHARED_REFUSAL_FIXTURE_DIVERGED'));
    });
  }

  test('contains no certification-owned Product hash or proposal-ID algorithm', () => {
    const files = [
      path.resolve(__dirname, 'm3-certification', 'driver.ts'),
      path.resolve(__dirname, 'm3-certification', 'fixture-loader.ts'),
      path.resolve(__dirname, 'm3-certification', 'suite.ts'),
      path.resolve(__dirname, 'm3-certification', 'broken-adapter.ts'),
      path.resolve(__dirname, 'verify-m3-certification-contract.test.ts'),
      path.resolve(__dirname, 'verify-m3-certification-self-falsification.test.ts'),
    ];
    const source = files.map(file => readFileSync(file, 'utf8')).join('\n');
    assert.equal(/from\s+['"]node:crypto['"]/.test(source), false);
    assert.equal(/createHash\s*\(/.test(source), false);
    assert.equal(/derive(?:Product)?ProposalId|compute(?:Product)?(?:Source|Proposal|TestSet)Hash/i.test(source), false);
  });
});
