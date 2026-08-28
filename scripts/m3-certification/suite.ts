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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, types } from 'node:util';

import Ajv from 'ajv';

import {
  cloneValue,
  type AnalyzeResult,
  CONTROLLED_PROMOTION_FAULT_CODE,
  type CertificationPersistenceInventory,
  type CertificationDefinitionRow,
  type CertificationManualPromotionRow,
  type CertificationManualSourceRow,
  type CertificationTestSetRevisionRow,
  type CertificationSaveFailureObservation,
  type DefinitionAuthority,
  type DefinitionObservation,
  type JsonObject,
  type M3CertificationDriver,
  type ManualAnalysisResultV1,
  type ManualAutomationProposalV1,
  type ManualAutomationRefusalV1,
  type ManualTestSourceV1,
  type SharedM3Contracts,
  type SourceAuthority,
  type StaleSaveScenario,
} from './driver';
import {
  loadSharedRefusal,
  SHARED_CONTRACT_ROOT,
  sourceWithSharedRefusalAuthority,
  type RefusalFixtureFile,
} from './fixture-loader';

const HASH = /^[a-f0-9]{64}$/;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const sharedContractSchema = JSON.parse(
  readFileSync(path.join(SHARED_CONTRACT_ROOT, 'contract.schema.json'), 'utf8'),
) as JsonObject;
const validateSharedContract = new Ajv({ allErrors: true, strict: true }).compile(sharedContractSchema);
const CONTROLLED_PROMOTION_FAULT_OBSERVATION = Object.freeze({
  kind: 'internal',
  code: CONTROLLED_PROMOTION_FAULT_CODE,
});
const DEFINITION_OBSERVATION_KEYS = [
  'appArea',
  'authenticationExpectation',
  'canonicalActions',
  'definitionAuthority',
  'normalizedIntent',
  'oracle',
  'projectId',
  'schemaVersion',
] as const;
const M2_CANDIDATE_KEYS = ['definitionAuthority', 'executable', 'projectId'] as const;
const PERSISTENCE_SNAPSHOT_KEYS = [
  'counts',
  'definitions',
  'manualTestPromotions',
  'manualTestSources',
  'projectId',
  'testSetRevisions',
] as const;
const PERSISTENCE_COUNT_KEYS = [
  'definitions',
  'manualTestPromotions',
  'manualTestSources',
  'testSetRevisions',
] as const;
const MANUAL_SOURCE_ROW_KEYS = [
  'admittedAt',
  'contentHash',
  'payloadJson',
  'projectId',
  'schemaVersion',
  'sourceId',
  'sourceKind',
] as const;
const DEFINITION_ROW_KEYS = [
  'definitionId',
  'definitionOrdinal',
  'definitionSchemaVersion',
  'projectId',
  'testSetId',
  'testSetRevision',
  'testSetRowId',
] as const;
const TEST_SET_REVISION_ROW_KEYS = [
  'contentHash',
  'definitionCount',
  'generatedAt',
  'generationId',
  'outcome',
  'projectId',
  'revision',
  'rowId',
  'schemaVersion',
  'testSetId',
] as const;
const MANUAL_PROMOTION_ROW_KEYS = [
  'definitionId',
  'projectId',
  'promotedAt',
  'proposalContentHash',
  'proposalId',
  'proposalPayloadJson',
  'proposalSchemaVersion',
  'sourceContentHash',
  'sourceId',
  'testSetContentHash',
  'testSetId',
  'testSetRevision',
  'testSetRowId',
] as const;

function isExactControlledPromotionFaultObservation(observation: unknown): boolean {
  if (types.isProxy(observation)) return false;
  if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) return false;
  if (Object.getPrototypeOf(observation) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(observation);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('code')) return false;
  const kind = Object.getOwnPropertyDescriptor(observation, 'kind');
  const code = Object.getOwnPropertyDescriptor(observation, 'code');
  return kind !== undefined && 'value' in kind
    && code !== undefined && 'value' in code
    && isDeepStrictEqual(observation, CONTROLLED_PROMOTION_FAULT_OBSERVATION);
}

export interface CertificationFinding {
  code: string;
  message: string;
}

export interface CertificationReport {
  driverName: string;
  driverAuthorityClass: M3CertificationDriver['authorityClass'];
  passed: boolean;
  findings: CertificationFinding[];
  observations: Record<string, unknown>;
}

export interface CertificationOptions {
  requireProductAuthority?: boolean;
  refusalHarnessSource?: ManualTestSourceV1;
}

export interface StaleSaveCase {
  scenario: StaleSaveScenario;
  expectedCode: 'STALE_REVIEWED_PROPOSAL' | 'MANUAL_PROPOSAL_NOT_EXECUTABLE';
  findingCode: string;
}

export const STALE_SAVE_CASES: readonly StaleSaveCase[] = Object.freeze([
  { scenario: 'save_model_drift', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'STALE_MODEL_EVIDENCE_ACCEPTED' },
  { scenario: 'save_route_drift', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'STALE_GOVERNED_ROUTE_ACCEPTED' },
  { scenario: 'save_data_test_drift', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'STALE_SELECTOR_AUTHORITY_ACCEPTED' },
  { scenario: 'save_app_area_drift', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'STALE_APP_AREA_AUTHORITY_ACCEPTED' },
  { scenario: 'save_auth_drift', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'STALE_AUTH_RUNTIME_AUTHORITY_ACCEPTED' },
  { scenario: 'save_reanalysis_different_proposal', expectedCode: 'STALE_REVIEWED_PROPOSAL', findingCode: 'CHANGED_CURRENT_PROPOSAL_ACCEPTED' },
  { scenario: 'save_reanalysis_refuses', expectedCode: 'MANUAL_PROPOSAL_NOT_EXECUTABLE', findingCode: 'NON_EXECUTABLE_CURRENT_REANALYSIS_ACCEPTED' },
]);

function finding(list: CertificationFinding[], condition: boolean, code: string, message: string): void {
  if (!condition) list.push({ code, message });
}

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function exactPlainObject(value: unknown, expectedKeys: readonly string[]): JsonObject | null {
  if (types.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return null;
  if (!isDeepStrictEqual([...keys].sort(), [...expectedKeys].sort())) return null;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
  }
  return value as JsonObject;
}

function plainDataArray(value: unknown): unknown[] | null {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor
    || !('value' in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.writable !== true
    || lengthDescriptor.enumerable !== false
    || lengthDescriptor.configurable !== false
    || keys.length !== lengthDescriptor.value + 1) return null;
  const rows = new Array<unknown>(lengthDescriptor.value);
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor
      || !('value' in descriptor)
      || descriptor.writable !== true
      || descriptor.enumerable !== true
      || descriptor.configurable !== true) return null;
    rows[index] = descriptor.value;
  }
  return rows;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parsedSharedPayload<T extends ManualTestSourceV1 | ManualAutomationProposalV1>(
  value: unknown,
  schemaVersion: T['schemaVersion'],
): T | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (object(parsed)?.schemaVersion !== schemaVersion || !validateSharedContract(parsed)) return null;
    return cloneValue(parsed as T);
  } catch {
    return null;
  }
}

function validatedManualSourceRow(value: unknown, projectId: string): CertificationManualSourceRow | null {
  const row = exactPlainObject(value, MANUAL_SOURCE_ROW_KEYS);
  const payload = parsedSharedPayload<ManualTestSourceV1>(
    row?.payloadJson,
    'forge-manual-test-source/v1',
  );
  if (!(row !== null
    && payload !== null
    && row.projectId === projectId
    && nonEmptyString(row.sourceId)
    && row.schemaVersion === 'forge-manual-test-source/v1'
    && row.sourceKind === 'manual'
    && typeof row.contentHash === 'string' && HASH.test(row.contentHash)
    && nonEmptyString(row.admittedAt)
    && payload.schemaVersion === row.schemaVersion
    && payload.projectId === row.projectId
    && payload.sourceKind === row.sourceKind
    && payload.sourceId === row.sourceId
    && payload.contentHash === row.contentHash)) return null;
  return {
    sourceId: row.sourceId,
    projectId: row.projectId,
    schemaVersion: row.schemaVersion,
    sourceKind: row.sourceKind,
    payloadJson: JSON.stringify(payload),
    payload,
    contentHash: row.contentHash,
    admittedAt: row.admittedAt,
  } as CertificationManualSourceRow;
}

function validatedDefinitionRow(value: unknown, projectId: string): CertificationDefinitionRow | null {
  const row = exactPlainObject(value, DEFINITION_ROW_KEYS);
  if (!(row !== null
    && row.projectId === projectId
    && nonNegativeSafeInteger(row.testSetRowId)
    && nonEmptyString(row.testSetId)
    && nonNegativeSafeInteger(row.testSetRevision)
    && nonNegativeSafeInteger(row.definitionOrdinal)
    && nonEmptyString(row.definitionId)
    && row.definitionSchemaVersion === 3)) return null;
  return {
    projectId: row.projectId,
    testSetRowId: row.testSetRowId,
    testSetId: row.testSetId,
    testSetRevision: row.testSetRevision,
    definitionOrdinal: row.definitionOrdinal,
    definitionId: row.definitionId,
    definitionSchemaVersion: row.definitionSchemaVersion,
  } as CertificationDefinitionRow;
}

function validatedTestSetRevisionRow(value: unknown, projectId: string): CertificationTestSetRevisionRow | null {
  const row = exactPlainObject(value, TEST_SET_REVISION_ROW_KEYS);
  if (!(row !== null
    && row.projectId === projectId
    && nonNegativeSafeInteger(row.rowId)
    && nonEmptyString(row.testSetId)
    && nonNegativeSafeInteger(row.revision)
    && nonEmptyString(row.generationId)
    && nonNegativeSafeInteger(row.schemaVersion)
    && nonEmptyString(row.generatedAt)
    && nonEmptyString(row.outcome)
    && nonNegativeSafeInteger(row.definitionCount)
    && typeof row.contentHash === 'string' && HASH.test(row.contentHash))) return null;
  return {
    rowId: row.rowId,
    projectId: row.projectId,
    testSetId: row.testSetId,
    revision: row.revision,
    generationId: row.generationId,
    schemaVersion: row.schemaVersion,
    generatedAt: row.generatedAt,
    outcome: row.outcome,
    definitionCount: row.definitionCount,
    contentHash: row.contentHash,
  } as CertificationTestSetRevisionRow;
}

function validatedManualPromotionRow(value: unknown, projectId: string): CertificationManualPromotionRow | null {
  const row = exactPlainObject(value, MANUAL_PROMOTION_ROW_KEYS);
  const proposalPayload = parsedSharedPayload<ManualAutomationProposalV1>(
    row?.proposalPayloadJson,
    'forge-manual-automation-proposal/v1',
  );
  if (!(row !== null
    && proposalPayload !== null
    && row.projectId === projectId
    && nonEmptyString(row.proposalId) && SAFE_OPAQUE_ID.test(row.proposalId)
    && row.proposalSchemaVersion === 'forge-manual-automation-proposal/v1'
    && nonEmptyString(row.sourceId) && SAFE_OPAQUE_ID.test(row.sourceId)
    && typeof row.sourceContentHash === 'string' && HASH.test(row.sourceContentHash)
    && typeof row.proposalContentHash === 'string' && HASH.test(row.proposalContentHash)
    && nonNegativeSafeInteger(row.testSetRowId)
    && nonEmptyString(row.testSetId)
    && nonNegativeSafeInteger(row.testSetRevision)
    && typeof row.testSetContentHash === 'string' && HASH.test(row.testSetContentHash)
    && nonEmptyString(row.definitionId)
    && nonEmptyString(row.promotedAt)
    && proposalPayload.schemaVersion === row.proposalSchemaVersion
    && proposalPayload.projectId === row.projectId
    && proposalPayload.proposalId === row.proposalId
    && proposalPayload.proposalContentHash === row.proposalContentHash
    && proposalPayload.sourceAuthority.sourceId === row.sourceId
    && proposalPayload.sourceAuthority.sourceContentHash === row.sourceContentHash)) return null;
  return {
    proposalId: row.proposalId,
    projectId: row.projectId,
    proposalSchemaVersion: row.proposalSchemaVersion,
    sourceId: row.sourceId,
    sourceContentHash: row.sourceContentHash,
    proposalPayloadJson: JSON.stringify(proposalPayload),
    proposalPayload,
    proposalContentHash: row.proposalContentHash,
    testSetRowId: row.testSetRowId,
    testSetId: row.testSetId,
    testSetRevision: row.testSetRevision,
    testSetContentHash: row.testSetContentHash,
    definitionId: row.definitionId,
    promotedAt: row.promotedAt,
  } as CertificationManualPromotionRow;
}

interface PersistencePayloadBindings {
  sources?: readonly ManualTestSourceV1[];
  proposals?: readonly ManualAutomationProposalV1[];
}

function validatePersistenceSnapshot(
  value: unknown,
  expectedProjectId: string,
  findings: CertificationFinding[],
  bindings: PersistencePayloadBindings = {},
): CertificationPersistenceInventory | null {
  const invalid = (detail: string): null => {
    findings.push({
      code: 'PERSISTENCE_SNAPSHOT_INCONSISTENT',
      message: `Persistence observation is malformed or internally inconsistent: ${detail}.`,
    });
    return null;
  };
  const snapshot = exactPlainObject(value, PERSISTENCE_SNAPSHOT_KEYS);
  if (!snapshot) return invalid('top-level inventory fields must be exact plain data properties');
  if (snapshot.projectId !== expectedProjectId) return invalid('snapshot.projectId does not match the requested project');
  const counts = exactPlainObject(snapshot.counts, PERSISTENCE_COUNT_KEYS);
  if (!counts) return invalid('counts fields must be exact plain data properties');
  for (const key of PERSISTENCE_COUNT_KEYS) {
    if (!nonNegativeSafeInteger(counts[key])) return invalid(`counts.${key} must be a non-negative safe integer`);
  }
  const arrays = {
    manualTestSources: plainDataArray(snapshot.manualTestSources),
    definitions: plainDataArray(snapshot.definitions),
    testSetRevisions: plainDataArray(snapshot.testSetRevisions),
    manualTestPromotions: plainDataArray(snapshot.manualTestPromotions),
  };
  for (const key of PERSISTENCE_COUNT_KEYS) {
    const rows = arrays[key];
    if (!rows) return invalid(`${key} must be an exact plain data array`);
    if (counts[key] !== rows.length) {
      return invalid(`counts.${key}=${String(counts[key])} does not equal ${key}.length=${rows.length}`);
    }
  }
  const manualTestSources: CertificationManualSourceRow[] = [];
  for (const row of arrays.manualTestSources as unknown[]) {
    const validated = validatedManualSourceRow(row, expectedProjectId);
    if (!validated) return invalid('manualTestSources contains a malformed or cross-project row');
    manualTestSources.push(validated);
  }
  const definitions: CertificationDefinitionRow[] = [];
  for (const row of arrays.definitions as unknown[]) {
    const validated = validatedDefinitionRow(row, expectedProjectId);
    if (!validated) return invalid('definitions contains a malformed or cross-project row');
    definitions.push(validated);
  }
  const testSetRevisions: CertificationTestSetRevisionRow[] = [];
  for (const row of arrays.testSetRevisions as unknown[]) {
    const validated = validatedTestSetRevisionRow(row, expectedProjectId);
    if (!validated) return invalid('testSetRevisions contains a malformed or cross-project row');
    testSetRevisions.push(validated);
  }
  const manualTestPromotions: CertificationManualPromotionRow[] = [];
  for (const row of arrays.manualTestPromotions as unknown[]) {
    const validated = validatedManualPromotionRow(row, expectedProjectId);
    if (!validated) return invalid('manualTestPromotions contains a malformed or cross-project row');
    manualTestPromotions.push(validated);
  }
  for (const expected of bindings.sources ?? []) {
    const matches = manualTestSources.filter(row => row.sourceId === expected.sourceId);
    if (matches.length !== 1 || !isDeepStrictEqual(matches[0]!.payload, expected)) {
      return invalid(`persisted source payload does not equal Product-observed source ${expected.sourceId}`);
    }
  }
  for (const expected of bindings.proposals ?? []) {
    const matches = manualTestPromotions.filter(row => row.proposalId === expected.proposalId
      && row.sourceId === expected.sourceAuthority.sourceId
      && row.sourceContentHash === expected.sourceAuthority.sourceContentHash);
    if (matches.length < 1 || matches.some(row => !isDeepStrictEqual(row.proposalPayload, expected))) {
      return invalid(`persisted proposal payload does not equal Product-observed proposal ${expected.proposalId}`);
    }
  }
  return {
    projectId: snapshot.projectId,
    counts: {
      manualTestSources: counts.manualTestSources,
      definitions: counts.definitions,
      testSetRevisions: counts.testSetRevisions,
      manualTestPromotions: counts.manualTestPromotions,
    },
    manualTestSources,
    definitions,
    testSetRevisions,
    manualTestPromotions,
  } as CertificationPersistenceInventory;
}

async function takePersistenceSnapshot(
  driver: M3CertificationDriver,
  projectId: string,
  findings: CertificationFinding[],
  bindings: PersistencePayloadBindings = {},
): Promise<{ observation: unknown; validated: CertificationPersistenceInventory | null }> {
  const observation: unknown = await driver.snapshot(projectId);
  return { observation, validated: validatePersistenceSnapshot(observation, projectId, findings, bindings) };
}

function proposalFrom(result: AnalyzeResult): ManualAutomationProposalV1 | null {
  if (result.kind !== 'analysis' || result.result.outcome.kind !== 'proposal') return null;
  return result.result.outcome.proposal;
}

function sourceSemantics(source: ManualTestSourceV1): JsonObject {
  const semantics = cloneValue(source) as JsonObject;
  delete semantics.sourceId;
  delete semantics.contentHash;
  return semantics;
}

function productBoundProposalFixture(
  fixture: ManualAutomationProposalV1,
  observed: ManualAutomationProposalV1,
): ManualAutomationProposalV1 {
  const expected = cloneValue(fixture);
  const expectedValue = expected as any;
  const observedValue = observed as any;
  const copyObserved = (value: any): any => value === undefined ? undefined : cloneValue(value);
  expectedValue.proposalId = observedValue.proposalId;
  expectedValue.sourceAuthority = copyObserved(observedValue.sourceAuthority);
  expectedValue.authority.modelRowId = observedValue.authority?.modelRowId;
  expectedValue.authority.modelVersion = observedValue.authority?.modelVersion;
  expectedValue.authority.observationRunId = observedValue.authority?.observationRunId;
  expectedValue.authority.supportSealHash = observedValue.authority?.supportSealHash;
  expectedValue.authority.routeEvidenceIdentityHash = observedValue.authority?.routeEvidenceIdentityHash;
  expectedValue.authority.authenticationExpectationIdentityHash = observedValue.authority?.authenticationExpectationIdentityHash;
  expectedValue.appArea.sourceSubjectId = observedValue.appArea?.sourceSubjectId;
  expectedValue.appArea.evidenceIds = copyObserved(observedValue.appArea?.evidenceIds);
  expectedValue.normalizedIntent.intentId = observedValue.normalizedIntent?.intentId;
  expectedValue.normalizedIntent.appArea.sourceSubjectId = observedValue.normalizedIntent?.appArea?.sourceSubjectId;
  expectedValue.normalizedIntent.appArea.evidenceIds = copyObserved(observedValue.normalizedIntent?.appArea?.evidenceIds);
  expectedValue.normalizedIntent.steps.forEach((step: any, index: number) => {
    const observedStep = observedValue.normalizedIntent?.steps?.[index];
    if (!observedStep) return;
    step.stepId = observedStep.stepId;
    step.subjectId = observedStep.subjectId;
    if ('elementId' in step && 'elementId' in observedStep) step.elementId = observedStep.elementId;
    if ('targetSubjectId' in step && 'targetSubjectId' in observedStep) step.targetSubjectId = observedStep.targetSubjectId;
  });
  expectedValue.normalizedIntent.expectedOutcomes.forEach((outcome: any, index: number) => {
    const observedOutcome = observedValue.normalizedIntent?.expectedOutcomes?.[index];
    if (!observedOutcome) return;
    outcome.outcomeId = observedOutcome.outcomeId;
    outcome.subjectId = observedOutcome.subjectId;
  });
  expectedValue.normalizedIntent.grounding.modelRowId = observedValue.normalizedIntent?.grounding?.modelRowId;
  expectedValue.normalizedIntent.grounding.modelVersion = observedValue.normalizedIntent?.grounding?.modelVersion;
  expectedValue.normalizedIntent.grounding.observationRunId = observedValue.normalizedIntent?.grounding?.observationRunId;
  expectedValue.normalizedIntent.grounding.supportSealHash = observedValue.normalizedIntent?.grounding?.supportSealHash;
  expectedValue.normalizedIntent.grounding.sourceFlowId = observedValue.normalizedIntent?.grounding?.sourceFlowId;
  expectedValue.normalizedIntent.grounding.subjectSupport.forEach((subject: any, index: number) => {
    const observedSubject = observedValue.normalizedIntent?.grounding?.subjectSupport?.[index];
    if (!observedSubject) return;
    subject.canonicalSubjectId = observedSubject.canonicalSubjectId;
    subject.supportingObservationIds = copyObserved(observedSubject.supportingObservationIds);
    subject.supportingGapIds = copyObserved(observedSubject.supportingGapIds);
  });
  expectedValue.normalizedIntentContentHash = observedValue.normalizedIntentContentHash;
  expectedValue.sourceGrounding.forEach((grounding: any, index: number) => {
    const observedGrounding = observedValue.sourceGrounding?.[index];
    if (observedGrounding) grounding.basis.evidenceIds = copyObserved(observedGrounding.basis?.evidenceIds);
  });
  expectedValue.canonicalActions.forEach((action: any, index: number) => {
    const observedAction = observedValue.canonicalActions?.[index];
    if (!observedAction) return;
    action.stepId = observedAction.stepId;
    action.subjectId = observedAction.subjectId;
    if ('elementId' in action && 'elementId' in observedAction) action.elementId = observedAction.elementId;
    if ('targetSubjectId' in action && 'targetSubjectId' in observedAction) action.targetSubjectId = observedAction.targetSubjectId;
  });
  expectedValue.oracle.subjectId = observedValue.oracle?.subjectId;
  expectedValue.oracle.supportingObservationIds = copyObserved(observedValue.oracle?.supportingObservationIds);
  expectedValue.authenticationExpectation.bases.forEach((basis: any, index: number) => {
    const observedBasis = observedValue.authenticationExpectation?.bases?.[index];
    if (observedBasis) basis.configurationDigest = observedBasis.configurationDigest;
  });
  expectedValue.authenticationExpectation.identityHash = observedValue.authenticationExpectation?.identityHash;
  expectedValue.proposalContentHash = observedValue.proposalContentHash;
  return expected;
}

function sourceMatchesFixtureAuthorityRule(
  driver: M3CertificationDriver,
  observed: ManualTestSourceV1,
  fixture: ManualTestSourceV1,
): boolean {
  return driver.authorityClass === 'reference'
    ? isDeepStrictEqual(observed, fixture)
    : isDeepStrictEqual(sourceSemantics(observed), sourceSemantics(fixture));
}

function proposalMatchesFixtureAuthorityRule(
  driver: M3CertificationDriver,
  observed: ManualAutomationProposalV1,
  fixture: ManualAutomationProposalV1,
): boolean {
  return driver.authorityClass === 'reference'
    ? isDeepStrictEqual(observed, fixture)
    : isDeepStrictEqual(observed, productBoundProposalFixture(fixture, observed));
}

function nonEmptySubset(values: unknown, authority: unknown): boolean {
  return Array.isArray(values) && values.length > 0 && Array.isArray(authority)
    && values.every(value => typeof value === 'string' && authority.includes(value));
}

function productDerivedAuthorityBindingsHold(proposal: ManualAutomationProposalV1): boolean {
  const value = proposal as any;
  const intent = value.normalizedIntent;
  const grounding = intent?.grounding;
  const actions = intent?.steps;
  const outcomes = intent?.expectedOutcomes;
  const subjectSupport = grounding?.subjectSupport;
  if (!intent || !grounding || !Array.isArray(actions) || actions.length !== 2
    || !Array.isArray(outcomes) || outcomes.length !== 1 || !Array.isArray(subjectSupport)) return false;
  const sourceSubjectId = value.appArea?.sourceSubjectId;
  const appAreaEvidenceIds = value.appArea?.evidenceIds;
  const targetSubjectId = outcomes[0]?.subjectId;
  const sourceSupport = subjectSupport.find((subject: any) => subject?.canonicalSubjectId === sourceSubjectId);
  const targetSupport = subjectSupport.find((subject: any) => subject?.canonicalSubjectId === targetSubjectId);
  const sourceGrounding = value.sourceGrounding;
  return grounding.modelRowId === value.authority.modelRowId
    && grounding.modelVersion === value.authority.modelVersion
    && grounding.observationRunId === value.authority.observationRunId
    && grounding.supportSealHash === value.authority.supportSealHash
    && value.authenticationExpectation?.identityHash === value.authority.authenticationExpectationIdentityHash
    && typeof sourceSubjectId === 'string' && sourceSubjectId.length > 0
    && Array.isArray(appAreaEvidenceIds) && appAreaEvidenceIds.includes(sourceSubjectId)
    && isDeepStrictEqual(intent.appArea, value.appArea)
    && intent.appArea?.sourceSubjectId === sourceSubjectId
    && actions[0]?.subjectId === sourceSubjectId
    && actions[1]?.subjectId === sourceSubjectId
    && actions[1]?.targetSubjectId === targetSubjectId
    && value.oracle?.subjectId === targetSubjectId
    && sourceSupport !== undefined && targetSupport !== undefined
    && nonEmptySubset(sourceGrounding?.[0]?.basis?.evidenceIds, sourceSupport.supportingObservationIds)
    && nonEmptySubset(sourceGrounding?.[1]?.basis?.evidenceIds, sourceSupport.supportingObservationIds)
    && nonEmptySubset(sourceGrounding?.[2]?.basis?.evidenceIds, targetSupport.supportingObservationIds)
    && isDeepStrictEqual(sourceGrounding?.[2]?.basis?.evidenceIds, value.oracle?.supportingObservationIds)
    && nonEmptySubset(value.oracle?.supportingObservationIds, targetSupport.supportingObservationIds);
}

function promotedDefinitionPreservesProposal(
  driver: M3CertificationDriver,
  definition: DefinitionObservation,
  proposal: ManualAutomationProposalV1,
): boolean {
  if (driver.authorityClass === 'reference') {
    return isDeepStrictEqual(definition.normalizedIntent, proposal.normalizedIntent)
      && isDeepStrictEqual(definition.appArea, proposal.appArea)
      && isDeepStrictEqual(definition.canonicalActions, proposal.canonicalActions)
      && isDeepStrictEqual(definition.oracle, proposal.oracle)
      && isDeepStrictEqual(definition.authenticationExpectation, proposal.authenticationExpectation);
  }
  const definitionValue = definition as any;
  const proposalValue = proposal as any;
  const appAreaMatches = isDeepStrictEqual(definitionValue.appArea, proposalValue.appArea)
    || definitionValue.appArea === proposalValue.appArea.id;
  const oracleMatches = definitionValue.oracle?.kind === proposalValue.oracle.kind
    && definitionValue.oracle?.subjectId === proposalValue.oracle.subjectId
    && isDeepStrictEqual(definitionValue.oracle?.supportingObservationIds, proposalValue.oracle.supportingObservationIds)
    && definitionValue.oracle?.explanation
      === 'Observe the sealed target subject at its governed final route after the directly observed click transition.';
  const authenticationMatches = isDeepStrictEqual(definitionValue.authenticationExpectation, proposalValue.authenticationExpectation)
    || definitionValue.authenticationExpectation?.state === proposalValue.authenticationExpectation.state
      && definitionValue.authenticationExpectation?.mechanism === proposalValue.authenticationExpectation.mechanism
      && isDeepStrictEqual(definitionValue.authenticationExpectation?.bases, proposalValue.authenticationExpectation.bases);
  return isDeepStrictEqual(definitionValue.normalizedIntent, proposalValue.normalizedIntent)
    && appAreaMatches
    && isDeepStrictEqual(definitionValue.canonicalActions, proposalValue.canonicalActions)
    && oracleMatches
    && authenticationMatches;
}

function refusalFixtureWithObservedAuthority(
  driver: M3CertificationDriver,
  fixture: ManualAnalysisResultV1,
  observedSource: ManualTestSourceV1,
): ManualAnalysisResultV1 {
  const expected = cloneValue(fixture);
  if (driver.authorityClass === 'product' && expected.outcome.kind === 'refusal') {
    expected.outcome.refusal.sourceAuthority = sourceAuthority(observedSource);
  }
  return expected;
}

function sourceAuthority(source: ManualTestSourceV1): SourceAuthority {
  return { sourceId: source.sourceId, sourceContentHash: source.contentHash };
}

function proposalIdentity(proposal: ManualAutomationProposalV1): JsonObject {
  return { proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash };
}

function countDelta(
  before: CertificationPersistenceInventory,
  after: CertificationPersistenceInventory,
  key: 'manualTestSources' | 'definitions' | 'testSetRevisions' | 'manualTestPromotions',
): number {
  return after.counts[key] - before.counts[key];
}

function assertRefusalPersistence(
  source: ManualTestSourceV1,
  before: CertificationPersistenceInventory,
  after: CertificationPersistenceInventory,
  findings: CertificationFinding[],
): void {
  const matchingSources = after.manualTestSources.filter(row => row.sourceId === source.sourceId
    && row.projectId === source.projectId
    && row.contentHash === source.contentHash);
  const existedBefore = before.manualTestSources.some(row => row.sourceId === source.sourceId
    && row.projectId === source.projectId
    && row.contentHash === source.contentHash);
  finding(findings, matchingSources.length === 1
    && countDelta(before, after, 'manualTestSources') === (existedBefore ? 0 : 1),
  'SEMANTIC_REFUSAL_SOURCE_PERSISTENCE_DRIFT', 'Semantic refusal must admit the exact immutable source row once.');
  finding(findings, countDelta(before, after, 'definitions') === 0,
    'SEMANTIC_REFUSAL_PERSISTED_DEFINITION', 'Semantic refusal must persist no Definition authority.');
  finding(findings, countDelta(before, after, 'testSetRevisions') === 0,
    'SEMANTIC_REFUSAL_PERSISTED_TEST_SET', 'Semantic refusal must persist no Test Set revision authority.');
  finding(findings, countDelta(before, after, 'manualTestPromotions') === 0,
    'SEMANTIC_REFUSAL_PERSISTED_PROMOTION', 'Semantic refusal must persist no promotion authority.');
}

function assertRefusalAuthority(
  refusal: ManualAutomationRefusalV1 | null,
  requestedProjectId: string,
  admittedSource: ManualTestSourceV1 | null,
  findings: CertificationFinding[],
): void {
  const authorityMatches = admittedSource !== null
    && refusal?.projectId === requestedProjectId
    && admittedSource.projectId === requestedProjectId
    && isDeepStrictEqual(refusal.sourceAuthority, sourceAuthority(admittedSource));
  finding(findings, authorityMatches, 'REFUSAL_AUTHORITY_MISMATCH',
    'Semantic refusal authority must equal the project and immutable source admitted for the same Analyze request.');
}

function saveRequest(source: ManualTestSourceV1, proposal: ManualAutomationProposalV1): JsonObject {
  return {
    projectId: source.projectId,
    sourceAuthority: sourceAuthority(source),
    proposalAuthority: proposalIdentity(proposal),
  };
}

export function hostileAuthenticationSaveBody(contracts: SharedM3Contracts): JsonObject {
  const expectation = cloneValue(contracts.positiveProposal.authenticationExpectation);
  expectation.identityHash = '9'.repeat(64);
  expectation.mechanism = 'caller-supplied-form';
  const bases = expectation.bases as JsonObject[];
  bases[0] = {
    ...bases[0],
    policyVersion: 'caller-supplied-auth-policy',
    configurationDigest: '8'.repeat(64),
    mechanism: 'caller-supplied-form',
  };
  return {
    authority: { authenticationExpectationIdentityHash: '9'.repeat(64) },
    expectation,
    preconditions: [{
      kind: 'authenticated_role',
      roleId: 'caller-supplied-role',
      mechanism: 'caller-supplied-form',
    }],
  };
}

export function hostileDefinitionSaveBody(contracts: SharedM3Contracts): DefinitionObservation {
  const proposal = contracts.positiveProposal;
  const appArea: JsonObject = {
    ...cloneValue(proposal.appArea),
    id: 'caller-supplied-app-area',
    method: 'caller-supplied-page-module',
    evidenceIds: ['caller-supplied-app-area-evidence'],
  };
  const canonicalActions = cloneValue(proposal.canonicalActions);
  canonicalActions[0] = {
    ...canonicalActions[0],
    routePath: '/caller-supplied-route.html',
  };
  canonicalActions[1] = {
    ...canonicalActions[1],
    dataTestValue: 'caller-supplied-control',
    targetSubjectId: 'caller-supplied-outcome-subject',
  };
  const oracle: JsonObject = {
    ...cloneValue(proposal.oracle),
    subjectId: 'caller-supplied-outcome-subject',
    routePath: '/caller-supplied-outcome.html',
    supportingObservationIds: ['caller-supplied-outcome-evidence'],
  };
  const normalizedIntent = cloneValue(proposal.normalizedIntent);
  normalizedIntent.title = 'Caller-supplied Definition body';
  normalizedIntent.appArea = cloneValue(appArea);
  normalizedIntent.steps = cloneValue(canonicalActions);
  normalizedIntent.expectedOutcomes = [{
    outcomeId: 'caller-supplied-outcome',
    kind: 'subject_observable',
    subjectId: oracle.subjectId,
    routePath: oracle.routePath,
  }];
  return {
    schemaVersion: 3,
    projectId: contracts.positiveSource.projectId,
    definitionAuthority: cloneValue(contracts.positiveSaveResult.definitionAuthority),
    normalizedIntent,
    appArea,
    canonicalActions,
    oracle,
    authenticationExpectation: cloneValue(proposal.authenticationExpectation),
  };
}

function assertProposalShape(
  driver: M3CertificationDriver,
  proposal: ManualAutomationProposalV1,
  expected: ManualAutomationProposalV1,
  source: ManualTestSourceV1,
  findings: CertificationFinding[],
): void {
  const fixtureProposal = driver.authorityClass === 'product'
    ? productBoundProposalFixture(expected, proposal)
    : expected;
  finding(findings, proposalMatchesFixtureAuthorityRule(driver, proposal, expected),
    'PROPOSAL_FIXTURE_SEMANTICS_DRIFT',
    'Proposal must equal the shared fixture semantics while Product-owned opaque authority remains observed and bound.');
  finding(findings, proposal.schemaVersion === 'forge-manual-automation-proposal/v1', 'PROPOSAL_SCHEMA_DRIFT', 'Proposal discriminator must remain exact.');
  finding(findings, proposal.projectId === source.projectId, 'PROPOSAL_PROJECT_DRIFT', 'Proposal project must match authored source.');
  finding(findings, isDeepStrictEqual(proposal.sourceAuthority, sourceAuthority(source)), 'PROPOSAL_SOURCE_AUTHORITY_DRIFT', 'Proposal must bind the exact admitted source authority.');
  finding(findings, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(proposal.proposalId), 'PROPOSAL_ID_SHAPE_INVALID', 'Product-emitted proposalId must be an opaque SafeOpaqueId.');
  finding(findings, HASH.test(proposal.normalizedIntentContentHash), 'INTENT_HASH_SHAPE_INVALID', 'Normalized intent hash must be opaque lowercase 64-hex.');
  finding(findings, HASH.test(proposal.proposalContentHash), 'PROPOSAL_HASH_SHAPE_INVALID', 'Proposal hash must be opaque lowercase 64-hex.');
  const intent = object(proposal.normalizedIntent);
  finding(findings, intent?.schemaVersion === 'forge-normalized-test-intent/v1' && intent.source === 'manual', 'NORMALIZED_SOURCE_DRIFT', 'Supported normalized source must be exactly manual.');
  finding(findings, isDeepStrictEqual(proposal.appArea, intent?.appArea) && object(proposal.appArea) !== null, 'APP_AREA_DRIFT', 'appArea must remain one equal object at proposal and intent boundaries.');
  finding(findings, isDeepStrictEqual(proposal.canonicalActions, intent?.steps), 'CANONICAL_ACTION_DRIFT', 'Canonical actions must equal normalized steps.');
  finding(findings, isDeepStrictEqual(proposal.canonicalActions, fixtureProposal.canonicalActions), 'CANONICAL_ACTION_VOCABULARY_DRIFT', 'Golden actions must retain the frozen navigation and click vocabulary while Product-derived identities remain observed and bound.');
  finding(findings, isDeepStrictEqual(proposal.appArea, fixtureProposal.appArea), 'APP_AREA_SEMANTICS_DRIFT', 'Golden appArea semantics must remain exact while Product-derived subject authority remains observed and bound.');
  finding(findings, isDeepStrictEqual(proposal.oracle, fixtureProposal.oracle), 'ORACLE_SEMANTICS_DRIFT', 'Golden subject-observable oracle must remain exact while Product-derived evidence authority remains observed and bound.');
  finding(findings, isDeepStrictEqual(proposal.authenticationExpectation, fixtureProposal.authenticationExpectation), 'AUTHENTICATION_SEMANTICS_DRIFT', 'Golden authentication semantics must remain exact while Product-derived configuration authority remains observed and bound.');
  finding(findings, driver.authorityClass !== 'product' || productDerivedAuthorityBindingsHold(proposal), 'DERIVED_PRODUCT_AUTHORITY_FLOATED', 'Product-derived model, subject, evidence, appArea source-page evidence, and authentication authority must remain internally exact without Certification recomputation.');
  const actions = proposal.canonicalActions;
  finding(findings, actions.length === 2 && actions[0]?.ordinal === 0 && actions[1]?.ordinal === 1, 'CANONICAL_ORDINAL_DRIFT', 'Canonical action ordinals must be exactly 0 and 1.');
  finding(findings, actions[0]?.kind === 'navigate_to_observed_route' && actions[1]?.kind === 'click_observed_data_test', 'CANONICAL_KIND_DRIFT', 'Canonical action kinds must be navigation then observed data-test click.');
  const grounding = proposal.sourceGrounding;
  finding(findings, grounding.length === source.steps.length + 1, 'GROUNDING_COVERAGE_DRIFT', 'Grounding must cover every source step and the outcome.');
  finding(findings, grounding.every((item, index) => index < source.steps.length
    ? isDeepStrictEqual(item.sourceRef, { kind: 'step', ordinal: index + 1 })
    : isDeepStrictEqual(item.sourceRef, { kind: 'expected_outcome' })), 'GROUNDING_ORDER_DRIFT', 'Grounding refs must follow one-based source order then outcome.');
  finding(findings, grounding.every(item => item.status === 'grounded'), 'SUPPORTED_GROUNDING_NOT_TOTAL', 'A supported proposal may contain only grounded source grounding.');
  const navBasis = object(grounding[0]?.basis);
  const clickBasis = object(grounding[1]?.basis);
  const normalizedGrounding = object(intent?.grounding);
  const observed = Array.isArray(normalizedGrounding?.selectedFlowStepIndexes)
    ? normalizedGrounding.selectedFlowStepIndexes
    : [];
  finding(findings, navBasis?.kind === 'governed_route' && navBasis.flowStepIndex === null, 'NAVIGATION_FLOW_STEP_INVENTED', 'Navigation grounding must have null flowStepIndex.');
  finding(findings, clickBasis?.kind === 'observed_flow_step' && observed.includes(clickBasis.flowStepIndex), 'CLICK_NOT_OBSERVED', 'Click grounding must reference an observed flow step.');
  const expectedOutcome = Array.isArray(intent?.expectedOutcomes) ? object(intent.expectedOutcomes[0]) : null;
  finding(findings, proposal.oracle.kind === expectedOutcome?.kind
    && proposal.oracle.subjectId === expectedOutcome?.subjectId
    && proposal.oracle.routePath === expectedOutcome?.routePath, 'ORACLE_NORMALIZATION_DRIFT', 'Proposal oracle must match the normalized expected outcome.');
  finding(findings, proposal.authenticationExpectation.identityHash === proposal.authority.authenticationExpectationIdentityHash, 'AUTHORITY_AUTH_IDENTITY_DRIFT', 'Proposal authentication identity must match proposal authority.');
}

export async function certifyGolden(
  driver: M3CertificationDriver,
  contracts: SharedM3Contracts,
  options: CertificationOptions = {},
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const observations: Record<string, unknown> = {};
  if (options.requireProductAuthority !== false) {
    finding(findings, driver.authorityClass === 'product', 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT', 'Only an authorityClass product driver may certify Product.');
  }
  await driver.configureCertificationScenario(null);
  const authored = cloneValue(contracts.positiveSource);
  const analyzed = await driver.analyzeManualTest({ source: authored });
  observations.analysis = analyzed;
  const proposal = proposalFrom(analyzed);
  finding(findings, proposal !== null, 'GOLDEN_PROPOSAL_MISSING', 'Golden source must produce a reviewable proposal.');
  const admittedSource = analyzed.kind === 'analysis' ? analyzed.source : null;
  finding(findings, admittedSource !== null, 'ADMITTED_SOURCE_RECEIPT_MISSING', 'Analyze must expose the exact admitted source receipt.');
  finding(findings, admittedSource !== null && sourceMatchesFixtureAuthorityRule(driver, admittedSource, authored),
    'SOURCE_FIXTURE_SEMANTICS_DRIFT',
    'Admitted source must equal shared fixture semantics while Product-owned source identity remains opaque.');
  const readSource = admittedSource
    ? await driver.readManualSource(admittedSource.projectId, admittedSource.sourceId)
    : null;
  observations.readSource = readSource;
  finding(findings, admittedSource !== null && isDeepStrictEqual(readSource, admittedSource), 'AUTHORED_SOURCE_REWRITTEN', 'Immutable admitted Product source must round-trip exactly, including authored strings and observed opaque authority.');
  finding(findings, readSource?.steps.every((step, index) => step.ordinal === index + 1) === true, 'MANUAL_ORDINAL_DRIFT', 'Manual source ordinals must remain contiguous 1..N.');
  if (!proposal || !admittedSource) return report(driver, findings, observations);
  assertProposalShape(driver, proposal, contracts.positiveProposal, admittedSource, findings);

  const repeated = proposalFrom(await driver.analyzeManualTest({ source: authored }));
  finding(findings, repeated?.proposalId === proposal.proposalId && repeated?.proposalContentHash === proposal.proposalContentHash, 'PROPOSAL_AUTHORITY_UNSTABLE', 'Unchanged source and evidence must preserve opaque proposal authority.');
  const request = saveRequest(admittedSource, proposal);
  finding(findings, isDeepStrictEqual(Object.keys(request).sort(), ['projectId', 'proposalAuthority', 'sourceAuthority']), 'SAVE_BODY_EMITTED', 'Save request must contain identities only.');
  const sourceBindings = readSource ? [readSource] : [];
  const beforeSaveSnapshot = await takePersistenceSnapshot(
    driver,
    admittedSource.projectId,
    findings,
    { sources: sourceBindings },
  );
  observations.beforeSavePersistence = beforeSaveSnapshot.observation;
  if (!beforeSaveSnapshot.validated) return report(driver, findings, observations);
  const beforeSave = beforeSaveSnapshot.validated;
  const saved = await driver.saveReviewedProposal(request);
  const afterSaveSnapshot = await takePersistenceSnapshot(
    driver,
    admittedSource.projectId,
    findings,
    { sources: sourceBindings, proposals: [proposal] },
  );
  observations.afterSavePersistence = afterSaveSnapshot.observation;
  observations.save = saved;
  if (!afterSaveSnapshot.validated) return report(driver, findings, observations);
  const afterSave = afterSaveSnapshot.validated;
  finding(findings, saved.kind === 'promoted', 'GOLDEN_PROMOTION_REFUSED', 'Exact reviewed current proposal must promote.');
  if (saved.kind !== 'promoted') return report(driver, findings, observations);
  finding(findings, saved.reanalysisPerformed, 'SAVE_SKIPPED_REANALYSIS', 'Save must reanalyze current evidence.');
  finding(findings, saved.atomic, 'PROMOTION_METADATA_NOT_ATOMIC', 'Promotion metadata must not deny atomicity.');
  finding(findings, countDelta(beforeSave, afterSave, 'definitions') === 1
    && countDelta(beforeSave, afterSave, 'testSetRevisions') === 1
    && countDelta(beforeSave, afterSave, 'manualTestPromotions') === 1,
  'PROMOTION_PERSISTENCE_INCOMPLETE', 'First Save must persist exactly one Definition, Test Set revision, and promotion row.');
  finding(findings, isDeepStrictEqual(saved.result.sourceAuthority, sourceAuthority(admittedSource)), 'PROMOTION_SOURCE_AUTHORITY_DRIFT', 'Promotion must preserve exact observed source authority.');
  finding(findings, isDeepStrictEqual(saved.result.proposalAuthority, proposalIdentity(proposal)), 'PROMOTION_PROPOSAL_AUTHORITY_DRIFT', 'Promotion must preserve exact reviewed proposal authority.');
  const authority = saved.result.definitionAuthority;
  finding(findings, authority.definitionSchemaVersion === 3 && HASH.test(authority.testSetContentHash), 'CANONICAL_V3_AUTHORITY_INVALID', 'Promotion must expose valid opaque canonical v3 authority.');
  const promotion = await driver.readManualPromotion(admittedSource.projectId, authority);
  observations.promotion = promotion;
  finding(findings, promotion !== null, 'PROMOTION_PROVENANCE_MISSING', 'Promoted manual certification requires separately readable promotion provenance.');
  finding(findings, isDeepStrictEqual(promotion, saved.result), 'PROMOTION_PROVENANCE_DRIFT', 'External promotion provenance must preserve the exact Save result.');
  finding(findings, isDeepStrictEqual(promotion?.definitionAuthority, authority), 'PROMOTION_DEFINITION_AUTHORITY_DRIFT', 'External promotion provenance must bind the exact observed Definition authority.');
  const definition = await driver.readDefinition(admittedSource.projectId, authority.definitionId);
  observations.definition = definition;
  finding(findings, definition !== null, 'PROMOTED_DEFINITION_MISSING', 'Promoted Definition must be readable.');
  if (definition) {
    finding(findings, definition.schemaVersion === 3, 'DEFINITION_SCHEMA_DRIFT', 'Promoted Definition schema must remain v3.');
    finding(findings, isDeepStrictEqual(Object.keys(definition).sort(), [...DEFINITION_OBSERVATION_KEYS]), 'DEFINITION_V3_EXTRA_OR_MISSING_FIELD', 'Canonical v3 observation must preserve its exact key set and reject embedded manual promotion provenance.');
    finding(findings, isDeepStrictEqual(definition.definitionAuthority, authority), 'DEFINITION_AUTHORITY_DRIFT', 'Canonical v3 must expose the exact promoted Definition authority.');
    finding(findings, promotedDefinitionPreservesProposal(driver, definition, proposal), 'PROMOTED_V3_SEMANTICS_DRIFT', 'Canonical v3 must preserve reviewed proposal semantics and exposed Product-derived authority under the frozen v3 projection.');
    finding(findings, object(definition.normalizedIntent)?.source === 'manual', 'DEFINITION_MANUAL_SOURCE_DRIFT', 'Canonical v3 normalized intent source must remain manual.');
  }
  const candidate = await driver.addDefinitionToSuite(admittedSource.projectId, authority);
  observations.candidate = candidate;
  finding(findings, candidate !== null && candidate.executable && isDeepStrictEqual(candidate.definitionAuthority, authority), 'M2_AUTHORITY_TRANSLATED', 'M2 must receive exact executable Definition/Test Set authority without translation.');
  finding(findings, candidate !== null && isDeepStrictEqual(Object.keys(candidate).sort(), [...M2_CANDIDATE_KEYS]), 'M2_MANUAL_PROVENANCE_TRANSLATED', 'M2 admission must consume Definition authority only, without manual-provenance translation.');
  const started = await driver.startExecution(admittedSource.projectId, authority);
  finding(findings, started.kind === 'accepted', 'M2_EXECUTION_REFUSED', 'Existing execution boundary must accept the promoted candidate.');
  if (started.kind === 'accepted') {
    const results = await driver.readResults(admittedSource.projectId, started.executionId);
    observations.results = results;
    finding(findings, results?.outcome === 'passed' && isDeepStrictEqual(results.definitionAuthority, authority), 'M2_RESULTS_DRIFT', 'Existing Results must preserve exact accepted v3 authority.');
    finding(findings, isDeepStrictEqual(results?.promotion, promotion), 'RESULTS_PROVENANCE_FLOATED', 'Historical Results must retain the accepted external manual promotion provenance.');
  }
  const presentation = await driver.readDefinitionPresentation(admittedSource.projectId, authority.definitionId);
  observations.presentation = presentation;
  finding(findings, isDeepStrictEqual(presentation?.definitionAuthority, authority)
    && isDeepStrictEqual(presentation?.promotion, promotion), 'PRESENTATION_PROVENANCE_DRIFT', 'Definition presentation must preserve immutable external promotion provenance.');
  const beforeReplaySnapshot = await takePersistenceSnapshot(
    driver,
    admittedSource.projectId,
    findings,
    { sources: sourceBindings, proposals: [proposal] },
  );
  observations.beforeReplayPersistence = beforeReplaySnapshot.observation;
  if (!beforeReplaySnapshot.validated) return report(driver, findings, observations);
  const beforeReplay = beforeReplaySnapshot.validated;
  const replay = await driver.saveReviewedProposal(request);
  const afterReplaySnapshot = await takePersistenceSnapshot(
    driver,
    admittedSource.projectId,
    findings,
    { sources: sourceBindings, proposals: [proposal] },
  );
  observations.afterReplayPersistence = afterReplaySnapshot.observation;
  observations.replay = replay;
  if (!afterReplaySnapshot.validated) return report(driver, findings, observations);
  const afterReplay = afterReplaySnapshot.validated;
  finding(findings, replay.kind === 'promoted' && replay.replayed
    && isDeepStrictEqual(replay.result.definitionAuthority, authority), 'SAVE_REPLAY_CREATED_REVISION', 'Exact Save replay must not create another Test Set revision or Definition.');
  finding(findings, isDeepStrictEqual(afterReplay, beforeReplay),
    'SAVE_REPLAY_PERSISTED_HIDDEN_AUTHORITY', 'Exact Save replay must leave the complete persisted inventory unchanged.');

  const atomicSource = cloneValue(authored);
  atomicSource.sourceId = `${authored.sourceId}-atomic-control`;
  atomicSource.title = `${authored.title} atomic control`;
  atomicSource.contentHash = '4'.repeat(64);
  await driver.configureCertificationScenario(null);
  const atomicAnalysis = await driver.analyzeManualTest({ source: atomicSource });
  const atomicProposal = proposalFrom(atomicAnalysis);
  const admittedAtomicSource = atomicAnalysis.kind === 'analysis' ? atomicAnalysis.source : null;
  finding(findings, atomicProposal !== null, 'ATOMICITY_SETUP_PROPOSAL_MISSING', 'Atomicity proof requires a second valid reviewed proposal.');
  finding(findings, admittedAtomicSource !== null && sourceMatchesFixtureAuthorityRule(driver, admittedAtomicSource, atomicSource),
    'ATOMICITY_SOURCE_SEMANTICS_DRIFT', 'Atomicity control must preserve fixture-derived source semantics under observed Product authority.');
  if (atomicProposal && admittedAtomicSource) {
    const readAtomicSource = await driver.readManualSource(admittedAtomicSource.projectId, admittedAtomicSource.sourceId);
    observations.readAtomicSource = readAtomicSource;
    finding(findings, isDeepStrictEqual(readAtomicSource, admittedAtomicSource), 'ATOMICITY_SOURCE_REWRITTEN', 'Atomicity control source must round-trip with exact observed authority.');
    const atomicSourceBindings = readAtomicSource
      ? [...sourceBindings, readAtomicSource]
      : sourceBindings;
    const atomicRequest = saveRequest(admittedAtomicSource, atomicProposal);
    const beforeFaultSnapshot = await takePersistenceSnapshot(
      driver,
      admittedSource.projectId,
      findings,
      { sources: atomicSourceBindings, proposals: [proposal] },
    );
    observations.beforeFaultPersistence = beforeFaultSnapshot.observation;
    if (!beforeFaultSnapshot.validated) return report(driver, findings, observations);
    const beforeFault = beforeFaultSnapshot.validated;
    await driver.armPromotionFaultOnce();
    let faultOutcome: unknown = null;
    let faultFailure: CertificationSaveFailureObservation | null = null;
    let faultThrew = false;
    try {
      faultOutcome = await driver.saveReviewedProposal(atomicRequest);
    } catch (error) {
      faultThrew = true;
      faultOutcome = error instanceof Error ? { name: error.name, message: error.message } : { thrown: String(error) };
      faultFailure = await driver.classifySaveFailure(error);
    } finally {
      await driver.disarmPromotionFault();
    }
    const afterFaultSnapshot = await takePersistenceSnapshot(
      driver,
      admittedSource.projectId,
      findings,
      { sources: atomicSourceBindings, proposals: [proposal] },
    );
    observations.faultOutcome = faultOutcome;
    observations.faultFailure = faultFailure;
    observations.afterFaultPersistence = afterFaultSnapshot.observation;
    if (!afterFaultSnapshot.validated) return report(driver, findings, observations);
    const afterFault = afterFaultSnapshot.validated;
    finding(findings, faultThrew, 'PROMOTION_FAULT_RETURNED_FROZEN_OUTCOME', 'Injected intra-transaction failure must throw as an internal/integrity failure.');
    if (faultThrew) {
      finding(findings, isExactControlledPromotionFaultObservation(faultFailure),
      'PROMOTION_FAULT_WRONG_FAILURE_CLASS', 'Injected promotion failure must expose the exact controlled internal/integrity failure classification.');
    }
    finding(findings, isDeepStrictEqual(afterFault, beforeFault),
      'PROMOTION_FAULT_LEFT_PERSISTED_RESIDUE', 'Injected promotion failure must leave no Definition, Test Set revision, or promotion residue and preserve prior authority.');
    const controlled = await driver.saveReviewedProposal(atomicRequest);
    const afterControlSnapshot = await takePersistenceSnapshot(
      driver,
      admittedSource.projectId,
      findings,
      { sources: atomicSourceBindings, proposals: [proposal, atomicProposal] },
    );
    observations.disarmedSave = controlled;
    observations.afterDisarmedPersistence = afterControlSnapshot.observation;
    if (!afterControlSnapshot.validated) return report(driver, findings, observations);
    const afterControl = afterControlSnapshot.validated;
    finding(findings, controlled.kind === 'promoted', 'DISARMED_PROMOTION_FAILED', 'The same Save must succeed after the certification-only fault is disarmed.');
    finding(findings, countDelta(afterFault, afterControl, 'definitions') === 1
      && countDelta(afterFault, afterControl, 'testSetRevisions') === 1
      && countDelta(afterFault, afterControl, 'manualTestPromotions') === 1,
    'DISARMED_PROMOTION_PERSISTENCE_INCOMPLETE', 'Disarmed Save must persist exactly one complete promotion authority set.');
  }
  return report(driver, findings, observations);
}

export async function certifyRefusal(
  driver: M3CertificationDriver,
  contracts: SharedM3Contracts,
  file: RefusalFixtureFile,
  options: CertificationOptions = {},
  scenario = file.replace('.json', '').replaceAll('-', '_'),
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const observations: Record<string, unknown> = {};
  if (options.requireProductAuthority !== false) finding(findings, driver.authorityClass === 'product', 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT', 'Only Product authority may certify a refusal.');
  const source = cloneValue(options.refusalHarnessSource ?? sourceWithSharedRefusalAuthority(contracts, file));
  const frozen = loadSharedRefusal(file);
  await driver.configureCertificationScenario(scenario);
  const beforePersistenceSnapshot = await takePersistenceSnapshot(driver, source.projectId, findings);
  observations.beforePersistence = beforePersistenceSnapshot.observation;
  if (!beforePersistenceSnapshot.validated) return report(driver, findings, observations);
  const beforePersistence = beforePersistenceSnapshot.validated;
  const analyzed = await driver.analyzeManualTest({ source, scenario });
  observations.analysis = analyzed;
  const admittedSource = analyzed.kind === 'analysis' ? analyzed.source : null;
  finding(findings, admittedSource !== null && sourceMatchesFixtureAuthorityRule(driver, admittedSource, source),
    'REFUSAL_SOURCE_FIXTURE_SEMANTICS_DRIFT',
    'Refusal source must preserve shared fixture semantics under its observed Product authority.');
  const afterPersistenceSnapshot = await takePersistenceSnapshot(
    driver,
    source.projectId,
    findings,
    { sources: admittedSource ? [admittedSource] : [] },
  );
  observations.afterPersistence = afterPersistenceSnapshot.observation;
  if (!afterPersistenceSnapshot.validated) return report(driver, findings, observations);
  const afterPersistence = afterPersistenceSnapshot.validated;
  const readSource = admittedSource
    ? await driver.readManualSource(admittedSource.projectId, admittedSource.sourceId)
    : null;
  observations.readSource = readSource;
  const refusal = analyzed.kind === 'analysis' && analyzed.result.outcome.kind === 'refusal'
    ? analyzed.result.outcome.refusal
    : null;
  const expectedRefusal = admittedSource
    ? refusalFixtureWithObservedAuthority(driver, frozen, admittedSource)
    : frozen;
  finding(findings, analyzed.kind === 'analysis' && isDeepStrictEqual(analyzed.result, expectedRefusal),
    'SHARED_REFUSAL_FIXTURE_DIVERGED',
    `Refusal ${file} must equal shared physical fixture semantics with only observed Product source authority substituted.`);
  finding(findings, admittedSource !== null && isDeepStrictEqual(readSource, admittedSource), 'REFUSAL_HARNESS_SOURCE_REWRITTEN', 'The admitted refusal source must round-trip with exact observed authority.');
  assertRefusalAuthority(refusal, source.projectId, readSource, findings);
  finding(findings, refusal?.schemaVersion === 'forge-manual-automation-refusal/v1', 'REFUSAL_SCHEMA_DRIFT', 'Refusal discriminator must remain exact.');
  finding(findings, analyzed.kind !== 'analysis' || analyzed.result.outcome.kind !== 'proposal', 'PARTIAL_AUTOMATION_EMITTED', 'Refusal must expose no partial proposal.');
  const frozenRefusal = frozen?.outcome.kind === 'refusal' ? frozen.outcome.refusal : null;
  if (frozenRefusal) {
    finding(findings, isDeepStrictEqual(refusal?.sourceGrounding, frozenRefusal.sourceGrounding), 'REFUSAL_GROUNDING_INVENTED', 'Affected grounding must equal the frozen shared evidence decision.');
  }
  if (admittedSource) assertRefusalPersistence(admittedSource, beforePersistence, afterPersistence, findings);
  return report(driver, findings, observations);
}

export function trailingUnsupportedHarnessSource(contracts: SharedM3Contracts): ManualTestSourceV1 {
  const source = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
  source.sourceId = 'manual-source-unsupported-trailing-01';
  source.steps = [source.steps[0]!, source.steps[2]!, source.steps[1]!]
    .map((step, index) => ({ ordinal: index + 1, text: step.text }));
  source.contentHash = '8'.repeat(64);
  return source;
}

export async function certifyWholeSourceRefusal(
  driver: M3CertificationDriver,
  source: ManualTestSourceV1,
  scenario: 'partial_unsupported_fill_between' | 'partial_unsupported_trailing_step',
  options: CertificationOptions = {},
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const observations: Record<string, unknown> = {};
  if (options.requireProductAuthority !== false) {
    finding(findings, driver.authorityClass === 'product', 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT', 'Only Product authority may certify whole-source refusal.');
  }
  await driver.configureCertificationScenario(scenario);
  const beforePersistenceSnapshot = await takePersistenceSnapshot(driver, source.projectId, findings);
  observations.beforePersistence = beforePersistenceSnapshot.observation;
  if (!beforePersistenceSnapshot.validated) return report(driver, findings, observations);
  const beforePersistence = beforePersistenceSnapshot.validated;
  const analyzed = await driver.analyzeManualTest({ source: cloneValue(source), scenario });
  observations.analysis = analyzed;
  const admittedSource = analyzed.kind === 'analysis' ? analyzed.source : null;
  finding(findings, admittedSource !== null && sourceMatchesFixtureAuthorityRule(driver, admittedSource, source),
    'PARTIAL_SOURCE_FIXTURE_SEMANTICS_DRIFT',
    'Whole-source refusal must preserve exact fixture-derived source semantics under observed Product authority.');
  const afterPersistenceSnapshot = await takePersistenceSnapshot(
    driver,
    source.projectId,
    findings,
    { sources: admittedSource ? [admittedSource] : [] },
  );
  observations.afterPersistence = afterPersistenceSnapshot.observation;
  if (!afterPersistenceSnapshot.validated) return report(driver, findings, observations);
  const afterPersistence = afterPersistenceSnapshot.validated;
  const readSource = admittedSource
    ? await driver.readManualSource(admittedSource.projectId, admittedSource.sourceId)
    : null;
  observations.readSource = readSource;
  finding(findings, admittedSource !== null && isDeepStrictEqual(readSource, admittedSource), 'PARTIAL_SOURCE_REWRITTEN', 'Partial-automation certification must retain exact admitted source authority, text, and ordinals.');
  const refusal = analyzed.kind === 'analysis' && analyzed.result.outcome.kind === 'refusal'
    ? analyzed.result.outcome.refusal
    : null;
  finding(findings, refusal?.code === 'unsupported_semantics', 'WHOLE_SOURCE_REFUSAL_MISSING', 'Any unsupported required source step must refuse the whole source.');
  finding(findings, refusal?.sourceGrounding.length === source.steps.length + 1, 'WHOLE_SOURCE_GROUNDING_DROPPED', 'Whole-source refusal must retain grounding for every source line and outcome.');
  finding(findings, refusal?.sourceGrounding.some(item => item.status === 'unsupported_semantics') === true, 'UNSUPPORTED_SOURCE_LINE_HIDDEN', 'Whole-source refusal must expose the unsupported required source line.');

  const proposal = proposalFrom(analyzed);
  observations.proposal = proposal;
  finding(findings, proposal === null, 'PARTIAL_PROPOSAL_ADMITTED', 'Unsupported source must admit no shortened proposal authority.');
  assertRefusalAuthority(refusal, source.projectId, readSource, findings);
  if (!proposal && admittedSource) assertRefusalPersistence(admittedSource, beforePersistence, afterPersistence, findings);
  if (proposal && admittedSource) {
    const saved = await driver.saveReviewedProposal(saveRequest(admittedSource, proposal));
    observations.save = saved;
    finding(findings, saved.kind !== 'promoted', 'PARTIAL_PROMOTION_ADMITTED', 'Unsupported source must admit no Definition/Test Set promotion authority.');
    if (saved.kind === 'promoted') {
      const definition = await driver.readDefinition(source.projectId, saved.result.definitionAuthority.definitionId);
      observations.definition = definition;
      finding(findings, definition === null, 'PARTIAL_DEFINITION_ADMITTED', 'Unsupported source must materialize no executable v3 Definition.');
    }
  }
  return report(driver, findings, observations);
}

export async function certifyMalformedTransport(
  driver: M3CertificationDriver,
  malformedSource: unknown,
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const observations: Record<string, unknown> = {};
  const analyzed = await driver.analyzeManualTest({ source: malformedSource });
  observations.analysis = analyzed;
  finding(findings, analyzed.kind === 'transport_error' && analyzed.code === 'MANUAL_SOURCE_INVALID', 'CORRUPTION_CLASSIFIED_AS_SEMANTIC_REFUSAL', 'Malformed source must be transport-level MANUAL_SOURCE_INVALID, never a semantic refusal.');
  return report(driver, findings, observations);
}

export async function certifySaveRefusesBody(
  driver: M3CertificationDriver,
  contracts: SharedM3Contracts,
  extra: JsonObject,
  acceptedFindingCode = 'SAVE_ACCEPTED_SEMANTIC_BODY',
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const source = cloneValue(contracts.positiveSource);
  await driver.configureCertificationScenario(null);
  const analyzed = await driver.analyzeManualTest({ source });
  const proposal = proposalFrom(analyzed);
  const admittedSource = analyzed.kind === 'analysis' ? analyzed.source : null;
  if (!proposal || !admittedSource) {
    finding(findings, false, 'SETUP_PROPOSAL_MISSING', 'Save hostile requires proposal setup.');
    return report(driver, findings, {});
  }
  const result = await driver.saveReviewedProposal({ ...saveRequest(admittedSource, proposal), ...extra });
  finding(findings, result.kind === 'refused', acceptedFindingCode, 'Save must reject semantic bodies and accept identities only.');
  const definition = result.kind === 'promoted'
    ? await driver.readDefinition(source.projectId, result.result.definitionAuthority.definitionId)
    : null;
  return report(driver, findings, { save: result, definition });
}

export async function certifyStaleSave(
  driver: M3CertificationDriver,
  contracts: SharedM3Contracts,
  staleCase: StaleSaveCase,
): Promise<CertificationReport> {
  const findings: CertificationFinding[] = [];
  const source = cloneValue(contracts.positiveSource);
  await driver.configureCertificationScenario(null);
  const analyzed = await driver.analyzeManualTest({ source });
  const proposal = proposalFrom(analyzed);
  const admittedSource = analyzed.kind === 'analysis' ? analyzed.source : null;
  if (!proposal || !admittedSource) return report(driver, [{ code: 'SETUP_PROPOSAL_MISSING', message: 'Stale save requires proposal setup.' }], {});
  await driver.configureCertificationScenario(staleCase.scenario);
  const saved = await driver.saveReviewedProposal(saveRequest(admittedSource, proposal));
  finding(
    findings,
    saved.kind === 'refused' && saved.code === staleCase.expectedCode,
    staleCase.findingCode,
    staleCase.expectedCode === 'MANUAL_PROPOSAL_NOT_EXECUTABLE'
      ? 'Save must preserve the frozen non-executable distinction when current reanalysis semantically refuses.'
      : `Save must reject the specifically stale reviewed proposal for ${staleCase.scenario}.`,
  );
  return report(driver, findings, { reviewedProposal: proposal, save: saved });
}

export async function certifyOpaqueAuthority(
  driver: M3CertificationDriver,
  contracts: SharedM3Contracts,
): Promise<CertificationReport> {
  const reportValue = await certifyGolden(driver, contracts, { requireProductAuthority: false });
  const sourceHash = contracts.positiveSource.contentHash;
  const proposalHash = contracts.positiveProposal.proposalContentHash;
  finding(reportValue.findings, HASH.test(sourceHash) && HASH.test(proposalHash), 'OPAQUE_HASH_SHAPE_INVALID', 'Arbitrary observed authority must satisfy shape only.');
  reportValue.passed = reportValue.findings.length === 0;
  return reportValue;
}

function report(
  driver: M3CertificationDriver,
  findings: CertificationFinding[],
  observations: Record<string, unknown>,
): CertificationReport {
  return {
    driverName: driver.name,
    driverAuthorityClass: driver.authorityClass,
    passed: findings.length === 0,
    findings,
    observations,
  };
}

export function exactSaveRequest(source: ManualTestSourceV1, proposal: ManualAutomationProposalV1): JsonObject {
  return saveRequest(source, proposal);
}

export function definitionAuthorityOf(value: unknown): DefinitionAuthority | null {
  const candidate = object(value);
  return candidate && candidate.definitionSchemaVersion === 3 ? candidate as DefinitionAuthority : null;
}
