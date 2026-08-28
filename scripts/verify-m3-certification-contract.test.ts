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
import Ajv from 'ajv';

import {
  AtomicityFailureHostileM3Adapter,
  DeliberatelyBrokenM3Adapter,
} from './m3-certification/broken-adapter';
import {
  cloneValue,
  CONTROLLED_PROMOTION_FAULT_CODE,
  ReferenceM3CertificationDriver,
  type AnalyzeResult,
  type CertificationPersistenceInventory,
  type CertificationSaveFailureObservation,
  type JsonObject,
  type ManualTestSourceV1,
} from './m3-certification/driver';
import {
  CERTIFICATION_FIXTURE_ROOT,
  loadJson,
  loadSharedContracts,
  SHARED_CONTRACT_ROOT,
  SHARED_FIXTURE_FILES,
  sourceWithSharedRefusalAuthority,
} from './m3-certification/fixture-loader';
import {
  certifyGolden,
  certifyMalformedTransport,
  certifyRefusal,
  certifySaveRefusesBody,
  certifyStaleSave,
  certifyWholeSourceRefusal,
  exactSaveRequest,
  hostileAuthenticationSaveBody,
  hostileDefinitionSaveBody,
  STALE_SAVE_CASES,
} from './m3-certification/suite';

interface GoldenMatrix {
  schemaVersion: string;
  certificationAuthority: string;
  referenceHarnessAuthority: string;
  sharedFixtures: string[];
  items: Array<{ item: number; name: string; requiredTruth: string }>;
}

interface HostileItem {
  id: string;
  category: 'source_integrity' | 'grounding' | 'partial_automation' | 'save_authority';
  expected: string;
}

interface HostileMatrix {
  schemaVersion: string;
  items: HostileItem[];
}

const EXPECTED_GOLDEN_NAMES = [
  'analyze_authored_source',
  'immutable_source_admission',
  'source_round_trip',
  'reviewable_proposal',
  'identity_only_save',
  'current_reanalysis',
  'exact_reviewed_promotion',
  'canonical_v3_unchanged',
  'm2_candidate_exact',
  'run_result_unchanged',
  'presentation_provenance',
  'historical_provenance',
] as const;

const EXPECTED_HOSTILE_IDS = [
  'source_property_order_changed', 'source_title_changed', 'source_objective_changed',
  'source_step_text_changed', 'source_step_order_changed', 'source_bad_ordinals',
  'source_missing_outcome', 'source_identity_hash_mismatch',
  'grounding_navigation_claims_flow_step', 'grounding_click_missing_observed_step',
  'grounding_click_inferred_only', 'grounding_missing_data_test',
  'grounding_multiple_data_test', 'grounding_two_matching_controls',
  'grounding_target_page_missing', 'grounding_target_page_ambiguous',
  'grounding_app_area_missing', 'grounding_app_area_ambiguous',
  'grounding_auth_unknown', 'grounding_auth_conflicted', 'grounding_auth_unsupported',
  'partial_unsupported_fill_between', 'partial_unsupported_trailing_step',
  'partial_product_drops_source_line', 'partial_product_shortens_v3',
  'save_accepts_actions', 'save_accepts_selector', 'save_accepts_app_area_oracle_body',
  'save_accepts_authentication_body', 'save_accepts_definition_body',
  'save_proposal_id_hash_pair_mismatch', 'save_changed_source_old_proposal',
  'save_model_drift', 'save_route_drift', 'save_data_test_drift', 'save_app_area_drift',
  'save_auth_drift', 'save_reanalysis_different_proposal', 'save_reanalysis_refuses',
  'save_exact_replay_new_revision', 'save_promotion_non_atomic',
] as const;

const SEMANTIC_CHANGE_HASHES: Readonly<Record<string, string>> = {
  source_title_changed: '1'.repeat(64),
  source_objective_changed: '2'.repeat(64),
  source_step_text_changed: '3'.repeat(64),
  source_step_order_changed: '4'.repeat(64),
};

function sharedSchemaValidator(): ReturnType<Ajv['compile']> {
  const schema = loadJson<JsonObject>(path.join(SHARED_CONTRACT_ROOT, 'contract.schema.json'));
  return new Ajv({ allErrors: true, strict: true }).compile(schema);
}

function mutateSource(source: ManualTestSourceV1, hostileId: string): ManualTestSourceV1 {
  const changed = cloneValue(source);
  changed.contentHash = SEMANTIC_CHANGE_HASHES[hostileId] ?? changed.contentHash;
  if (hostileId === 'source_title_changed') changed.title = `${changed.title}!`;
  if (hostileId === 'source_objective_changed') changed.objective = `${changed.objective}!`;
  if (hostileId === 'source_step_text_changed') changed.steps[0]!.text = `${changed.steps[0]!.text}!`;
  if (hostileId === 'source_step_order_changed') {
    changed.steps.reverse();
    changed.steps.forEach((step, index) => { step.ordinal = index + 1; });
  }
  return changed;
}

async function exerciseHostile(item: HostileItem): Promise<void> {
  const contracts = loadSharedContracts();
  const driver = new ReferenceM3CertificationDriver(contracts);
  const source = cloneValue(contracts.positiveSource);
  if (item.id === 'source_property_order_changed') {
    const reordered = {
      contentHash: source.contentHash,
      expectedOutcome: source.expectedOutcome,
      steps: source.steps,
      objective: source.objective,
      title: source.title,
      sourceKind: source.sourceKind,
      projectId: source.projectId,
      sourceId: source.sourceId,
      schemaVersion: source.schemaVersion,
    };
    const analyzed = await driver.analyzeManualTest({ source: reordered });
    assert.equal(analyzed.kind, 'analysis');
    assert.deepEqual(await driver.readManualSource(source.projectId, source.sourceId), source);
    return;
  }
  if (item.id in SEMANTIC_CHANGE_HASHES) {
    const changed = mutateSource(source, item.id);
    const analyzed = await driver.analyzeManualTest({ source: changed, scenario: 'source_semantic_change' });
    assert.equal(analyzed.kind, 'analysis');
    assert.notEqual(changed.contentHash, source.contentHash);
    assert.deepEqual(await driver.readManualSource(changed.projectId, changed.sourceId), changed);
    if (analyzed.kind === 'analysis' && analyzed.result.outcome.kind === 'proposal') {
      assert.equal(analyzed.result.outcome.proposal.sourceAuthority.sourceContentHash, changed.contentHash);
      assert.notEqual(analyzed.result.outcome.proposal.proposalContentHash, contracts.positiveProposal.proposalContentHash);
    }
    return;
  }
  if (item.id === 'source_bad_ordinals') {
    source.steps[0]!.ordinal = 0;
    assert.equal((await certifyMalformedTransport(driver, source)).passed, true);
    return;
  }
  if (item.id === 'source_missing_outcome') {
    const malformed = cloneValue(source) as unknown as JsonObject;
    delete malformed.expectedOutcome;
    assert.equal((await certifyMalformedTransport(driver, malformed)).passed, true);
    return;
  }
  if (item.id === 'source_identity_hash_mismatch') {
    const analyzed = await driver.analyzeManualTest({ source });
    assert.equal(analyzed.kind, 'analysis');
    if (analyzed.kind === 'analysis' && analyzed.result.outcome.kind === 'proposal') {
      const request = exactSaveRequest(source, analyzed.result.outcome.proposal);
      (request.sourceAuthority as JsonObject).sourceContentHash = 'f'.repeat(64);
      assert.equal((await driver.saveReviewedProposal(request)).kind, 'refused');
    }
    return;
  }
  if (item.category === 'grounding' || item.id.startsWith('partial_unsupported_')) {
    const codeFile = item.id.includes('app_area')
      ? 'app-area-unknown.json'
      : item.id.includes('ambiguous') || item.id.includes('multiple') || item.id.includes('two_matching') || item.id.includes('conflicted')
        ? 'ambiguous-control.json'
        : item.id.includes('unsupported') || item.id.includes('missing_data_test')
          ? 'unsupported-fill.json'
          : 'insufficient-outcome.json';
    const report = await certifyRefusal(driver, contracts, codeFile, { requireProductAuthority: false }, item.id);
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    return;
  }
  if (item.id === 'partial_product_drops_source_line' || item.id === 'partial_product_shortens_v3') {
    const fault = item.id === 'partial_product_drops_source_line'
      ? 'drop_unsupported_source_line'
      : 'shorten_source_into_v3';
    const unsupportedSource = sourceWithSharedRefusalAuthority(contracts, 'unsupported-fill.json');
    const report = await certifyWholeSourceRefusal(
      new DeliberatelyBrokenM3Adapter(contracts, fault),
      unsupportedSource,
      'partial_unsupported_fill_between',
    );
    assert.equal(report.passed, false, `${item.id} escaped certification`);
    assert.deepEqual(report.observations.readSource, unsupportedSource);
    assert.equal((report.observations.save as { kind: string }).kind, 'promoted');
    assert.equal((report.observations.definition as { schemaVersion: number }).schemaVersion, 3);
    return;
  }
  if (item.id === 'save_accepts_actions') {
    assert.equal((await certifySaveRefusesBody(driver, contracts, { actions: [] })).passed, true);
    return;
  }
  if (item.id === 'save_accepts_selector') {
    assert.equal((await certifySaveRefusesBody(driver, contracts, { selector: '[data-test=checkout]' })).passed, true);
    return;
  }
  if (item.id === 'save_accepts_app_area_oracle_body') {
    assert.equal((await certifySaveRefusesBody(driver, contracts, { appArea: {}, oracle: {} })).passed, true);
    return;
  }
  if (item.id === 'save_accepts_authentication_body') {
    const report = await certifySaveRefusesBody(
      driver,
      contracts,
      { authentication: hostileAuthenticationSaveBody(contracts) },
      'SAVE_ACCEPTED_AUTHENTICATION_BODY',
    );
    assert.equal(report.passed, true);
    return;
  }
  if (item.id === 'save_accepts_definition_body') {
    const report = await certifySaveRefusesBody(
      driver,
      contracts,
      { definition: hostileDefinitionSaveBody(contracts) },
      'SAVE_ACCEPTED_DEFINITION_BODY',
    );
    assert.equal(report.passed, true);
    return;
  }
  if (item.id === 'save_proposal_id_hash_pair_mismatch' || item.id === 'save_changed_source_old_proposal') {
    const analyzed = await driver.analyzeManualTest({ source });
    assert.equal(analyzed.kind, 'analysis');
    if (analyzed.kind === 'analysis' && analyzed.result.outcome.kind === 'proposal') {
      const request = exactSaveRequest(source, analyzed.result.outcome.proposal);
      if (item.id === 'save_proposal_id_hash_pair_mismatch') {
        (request.proposalAuthority as JsonObject).proposalContentHash = 'f'.repeat(64);
      } else {
        (request.sourceAuthority as JsonObject).sourceContentHash = 'f'.repeat(64);
      }
      assert.equal((await driver.saveReviewedProposal(request)).kind, 'refused');
    }
    return;
  }
  const staleCase = STALE_SAVE_CASES.find(candidate => candidate.scenario === item.id);
  if (staleCase) {
    const report = await certifyStaleSave(driver, contracts, staleCase);
    assert.equal(report.passed, true, JSON.stringify(report.findings));
    assert.deepEqual(report.observations.save, { kind: 'refused', code: staleCase.expectedCode });
    return;
  }
  const golden = await certifyGolden(driver, contracts, { requireProductAuthority: false });
  assert.equal(golden.passed, true, JSON.stringify(golden.findings));
  if (item.id === 'save_exact_replay_new_revision') {
    const replay = golden.observations.replay as JsonObject;
    assert.equal(replay.replayed, true);
  }
  if (item.id === 'save_promotion_non_atomic') {
    const save = golden.observations.save as JsonObject;
    assert.equal(save.atomic, true);
  }
}

describe('M3 independent certification contract', () => {
  test('loads and validates the exact seven physical shared fixtures', () => {
    const validate = sharedSchemaValidator();
    for (const file of SHARED_FIXTURE_FILES) {
      const value = loadJson<unknown>(path.join(SHARED_CONTRACT_ROOT, file));
      assert.equal(validate(value), true, `${file}: ${JSON.stringify(validate.errors)}`);
    }
    const golden = loadJson<GoldenMatrix>(path.join(CERTIFICATION_FIXTURE_ROOT, 'golden-matrix.json'));
    assert.deepEqual(golden.sharedFixtures, [...SHARED_FIXTURE_FILES]);
    assert.equal(readFileSync(path.join(CERTIFICATION_FIXTURE_ROOT, 'golden-matrix.json'), 'utf8').includes('../m3-contract'), false);
  });

  test('validates the two closed certification matrices against Draft-07', () => {
    const schema = loadJson<JsonObject>(path.join(CERTIFICATION_FIXTURE_ROOT, 'contract.schema.json'));
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
    for (const file of ['golden-matrix.json', 'hostile-matrix.json']) {
      assert.equal(validate(loadJson(path.join(CERTIFICATION_FIXTURE_ROOT, file))), true, `${file}: ${JSON.stringify(validate.errors)}`);
    }
  });

  test('freezes exactly twelve golden truths and forty-one hostiles', () => {
    const golden = loadJson<GoldenMatrix>(path.join(CERTIFICATION_FIXTURE_ROOT, 'golden-matrix.json'));
    const hostile = loadJson<HostileMatrix>(path.join(CERTIFICATION_FIXTURE_ROOT, 'hostile-matrix.json'));
    assert.equal(golden.certificationAuthority, 'product_driver_required');
    assert.equal(golden.referenceHarnessAuthority, 'mechanics_only');
    assert.deepEqual(golden.items.map(item => item.item), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.deepEqual(golden.items.map(item => item.name), [...EXPECTED_GOLDEN_NAMES]);
    assert.deepEqual(hostile.items.map(item => item.id), [...EXPECTED_HOSTILE_IDS]);
  });

  test('reference mechanics pass all golden invariants but cannot issue Product PASS', async () => {
    const contracts = loadSharedContracts();
    const mechanics = await certifyGolden(new ReferenceM3CertificationDriver(contracts), contracts, { requireProductAuthority: false });
    assert.equal(mechanics.passed, true, JSON.stringify(mechanics.findings));
    const productCertification = await certifyGolden(new ReferenceM3CertificationDriver(contracts), contracts);
    assert.equal(productCertification.passed, false);
    assert.ok(productCertification.findings.some(finding => finding.code === 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT'));
  });

  test('persistence observation proves refusal non-authority, exact replay, and atomic rollback', async () => {
    const contracts = loadSharedContracts();
    const golden = await certifyGolden(
      new ReferenceM3CertificationDriver(contracts),
      contracts,
      { requireProductAuthority: false },
    );
    assert.equal(golden.passed, true, JSON.stringify(golden.findings));
    const beforeSave = golden.observations.beforeSavePersistence as CertificationPersistenceInventory;
    const afterSave = golden.observations.afterSavePersistence as CertificationPersistenceInventory;
    assert.deepEqual(beforeSave.counts, {
      manualTestSources: 1, definitions: 0, testSetRevisions: 0, manualTestPromotions: 0,
    });
    assert.deepEqual(afterSave.counts, {
      manualTestSources: 1, definitions: 1, testSetRevisions: 1, manualTestPromotions: 1,
    });
    assert.deepEqual(golden.observations.afterReplayPersistence, golden.observations.beforeReplayPersistence);
    assert.deepEqual(golden.observations.afterFaultPersistence, golden.observations.beforeFaultPersistence);
    assert.deepEqual(golden.observations.faultFailure, {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    });
    const afterControl = golden.observations.afterDisarmedPersistence as CertificationPersistenceInventory;
    assert.deepEqual(afterControl.counts, {
      manualTestSources: 2, definitions: 2, testSetRevisions: 2, manualTestPromotions: 2,
    });

    const refusal = await certifyRefusal(
      new ReferenceM3CertificationDriver(contracts),
      contracts,
      'unsupported-fill.json',
      { requireProductAuthority: false },
      'unsupported_fill',
    );
    assert.equal(refusal.passed, true, JSON.stringify(refusal.findings));
    const refusedAfter = refusal.observations.afterPersistence as CertificationPersistenceInventory;
    assert.deepEqual(refusedAfter.counts, {
      manualTestSources: 1, definitions: 0, testSetRevisions: 0, manualTestPromotions: 0,
    });
  });

  test('atomicity requires the exact controlled failure class in addition to rollback equality', async () => {
    const contracts = loadSharedContracts();
    const exact = await certifyGolden(new AtomicityFailureHostileM3Adapter(
      contracts,
      'frozen_save_failure',
      { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE },
    ), contracts);
    assert.equal(exact.passed, true, JSON.stringify(exact.findings));
    assert.deepEqual(exact.observations.afterFaultPersistence, exact.observations.beforeFaultPersistence);
    const exactAfterFault = exact.observations.afterFaultPersistence as CertificationPersistenceInventory;
    const exactAfterControl = exact.observations.afterDisarmedPersistence as CertificationPersistenceInventory;
    assert.equal(exactAfterControl.counts.definitions, exactAfterFault.counts.definitions + 1);
    assert.equal(exactAfterControl.counts.testSetRevisions, exactAfterFault.counts.testSetRevisions + 1);
    assert.equal(exactAfterControl.counts.manualTestPromotions, exactAfterFault.counts.manualTestPromotions + 1);

    const inheritedEnvelope = Object.create({
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    }) as Record<string, unknown>;
    const customPrototypeEnvelope = Object.assign(Object.create({ hostile: true }) as Record<string, unknown>, {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    });
    const nullPrototypeEnvelope = Object.assign(Object.create(null) as Record<string, unknown>, {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    });
    const symbolExtraEnvelope: Record<PropertyKey, unknown> = {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    };
    symbolExtraEnvelope[Symbol('hidden-extra')] = true;
    const nonEnumerableExtraEnvelope = {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    };
    Object.defineProperty(nonEnumerableExtraEnvelope, 'status', { value: 418 });
    const accessorEnvelope = {
      get kind(): string { return 'internal'; },
      code: CONTROLLED_PROMOTION_FAULT_CODE,
    };
    const proxyHiddenExtrasTarget = {
      kind: 'internal',
      code: CONTROLLED_PROMOTION_FAULT_CODE,
      status: 418,
      name: 'WrongEnvelope',
    };
    const proxyHiddenExtrasEnvelope = new Proxy(proxyHiddenExtrasTarget, {
      getPrototypeOf: () => Object.prototype,
      ownKeys: () => ['kind', 'code'],
      getOwnPropertyDescriptor: (target, key) => key === 'kind' || key === 'code'
        ? Reflect.getOwnPropertyDescriptor(target, key)
        : undefined,
    });
    const exactProxyEnvelope = new Proxy({
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    }, {});
    const { proxy: revocableProxyEnvelope } = Proxy.revocable({
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    }, {});
    const malformedObservations: unknown[] = [
      { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE, status: 418 },
      { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE, name: 'WrongEnvelope' },
      { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE, extra: { nested: true } },
      { kind: 'internal' },
      { code: CONTROLLED_PROMOTION_FAULT_CODE },
      { kind: 'transport', code: CONTROLLED_PROMOTION_FAULT_CODE },
      { kind: 'internal', code: 'WRONG_FAULT' },
      ['internal', CONTROLLED_PROMOTION_FAULT_CODE],
      null,
      inheritedEnvelope,
      customPrototypeEnvelope,
      nullPrototypeEnvelope,
      symbolExtraEnvelope,
      nonEnumerableExtraEnvelope,
      accessorEnvelope,
      proxyHiddenExtrasEnvelope,
      exactProxyEnvelope,
      revocableProxyEnvelope,
    ];
    for (const observation of malformedObservations) {
      const report = await certifyGolden(new AtomicityFailureHostileM3Adapter(
        contracts,
        'frozen_save_failure',
        observation,
      ), contracts);
      assert.equal(report.passed, false, JSON.stringify(observation));
      assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
      assert.deepEqual(report.observations.afterFaultPersistence, report.observations.beforeFaultPersistence);
    }

    const wrongExceptions = [
      new AtomicityFailureHostileM3Adapter(contracts, 'unrelated_type_error'),
      new AtomicityFailureHostileM3Adapter(contracts, 'arbitrary_error'),
    ];
    for (const driver of wrongExceptions) {
      const report = await certifyGolden(driver, contracts);
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
      assert.deepEqual(report.observations.afterFaultPersistence, report.observations.beforeFaultPersistence);
    }

    for (const code of [
      'SOURCE_PROPOSAL_MISMATCH',
      'MANUAL_PROMOTION_IDENTITY_CONFLICT',
      'STALE_REVIEWED_PROPOSAL',
      'MANUAL_PROPOSAL_NOT_EXECUTABLE',
    ]) {
      const report = await certifyGolden(new AtomicityFailureHostileM3Adapter(
        contracts,
        'frozen_save_failure',
        { kind: 'save_failure', code },
      ), contracts);
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
    }

    for (const status of [400, 409, 422]) {
      const report = await certifyGolden(new AtomicityFailureHostileM3Adapter(
        contracts,
        'transport_failure',
        { kind: 'transport', status, code: `HTTP_${status}` },
      ), contracts);
      assert.equal(report.passed, false);
      assert.deepEqual(report.findings.map(item => item.code), ['PROMOTION_FAULT_WRONG_FAILURE_CLASS']);
    }
  });

  test('atomicity rejects armed success and persistence change independently', async () => {
    const contracts = loadSharedContracts();
    const returned = await certifyGolden(
      new AtomicityFailureHostileM3Adapter(contracts, 'no_throw'),
      contracts,
    );
    assert.equal(returned.passed, false);
    assert.ok(returned.findings.some(item => item.code === 'PROMOTION_FAULT_RETURNED_FROZEN_OUTCOME'));

    const residue = await certifyGolden(
      new AtomicityFailureHostileM3Adapter(contracts, 'internal_with_residue'),
      contracts,
    );
    assert.equal(residue.passed, false);
    assert.deepEqual(residue.observations.faultFailure, {
      kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE,
    } satisfies CertificationSaveFailureObservation);
    assert.ok(residue.findings.some(item => item.code === 'PROMOTION_FAULT_LEFT_PERSISTED_RESIDUE'));
    assert.ok(!residue.findings.some(item => item.code === 'PROMOTION_FAULT_WRONG_FAILURE_CLASS'));
  });

  test('all seven stale Save categories use materially distinct current Product setup paths', async () => {
    const contracts = loadSharedContracts();
    const observedKinds = new Set<string>();
    for (const staleCase of STALE_SAVE_CASES) {
      const driver = new ReferenceM3CertificationDriver(contracts);
      const source = cloneValue(contracts.positiveSource);
      const current = await driver.analyzeManualTest({ source, scenario: staleCase.scenario });
      if (staleCase.scenario === 'save_reanalysis_refuses') {
        assert.equal(current.kind === 'analysis' && current.result.outcome.kind, 'refusal');
        observedKinds.add('semantic-refusal');
        continue;
      }
      assert.equal(current.kind, 'analysis');
      assert.equal(current.kind === 'analysis' && current.result.outcome.kind, 'proposal');
      if (current.kind !== 'analysis' || current.result.outcome.kind !== 'proposal') continue;
      const proposal = current.result.outcome.proposal;
      if (staleCase.scenario === 'save_model_drift') {
        assert.notEqual(proposal.authority.modelRowId, contracts.positiveProposal.authority.modelRowId);
        observedKinds.add('selected-model-evidence');
      } else if (staleCase.scenario === 'save_route_drift') {
        assert.notEqual(proposal.canonicalActions[0]?.routePath, contracts.positiveProposal.canonicalActions[0]?.routePath);
        observedKinds.add('governed-route');
      } else if (staleCase.scenario === 'save_data_test_drift') {
        assert.notEqual(proposal.canonicalActions[1]?.dataTestValue, contracts.positiveProposal.canonicalActions[1]?.dataTestValue);
        observedKinds.add('selector-data-test');
      } else if (staleCase.scenario === 'save_app_area_drift') {
        assert.notDeepEqual(proposal.appArea, contracts.positiveProposal.appArea);
        observedKinds.add('page-module-app-area');
      } else if (staleCase.scenario === 'save_auth_drift') {
        assert.notDeepEqual(proposal.authenticationExpectation, contracts.positiveProposal.authenticationExpectation);
        observedKinds.add('authentication-runtime');
      } else {
        assert.notDeepEqual(proposal.limitations, contracts.positiveProposal.limitations);
        assert.deepEqual(proposal.authority, contracts.positiveProposal.authority);
        observedKinds.add('deterministic-proposal');
      }
    }
    assert.deepEqual([...observedKinds].sort(), [
      'authentication-runtime',
      'deterministic-proposal',
      'governed-route',
      'page-module-app-area',
      'selected-model-evidence',
      'selector-data-test',
      'semantic-refusal',
    ]);
  });

  for (const file of ['unsupported-fill.json', 'ambiguous-control.json', 'insufficient-outcome.json', 'app-area-unknown.json'] as const) {
    test(`certifies frozen refusal ${file} without partial promotion`, async () => {
      const contracts = loadSharedContracts();
      const expectedSource = sourceWithSharedRefusalAuthority(contracts, file);
      const result = await certifyRefusal(new ReferenceM3CertificationDriver(contracts), contracts, file, { requireProductAuthority: false });
      assert.equal(result.passed, true, JSON.stringify(result.findings));
      assert.deepEqual(result.observations.readSource, expectedSource);
      const analysis = result.observations.analysis as AnalyzeResult;
      assert.equal(analysis.kind, 'analysis');
      if (analysis.kind !== 'analysis' || analysis.result.outcome.kind !== 'refusal') {
        throw new Error(`Expected frozen refusal: ${file}`);
      }
      assert.equal(analysis.result.outcome.refusal.projectId, expectedSource.projectId);
      assert.deepEqual(analysis.result.outcome.refusal.sourceAuthority, {
        sourceId: expectedSource.sourceId,
        sourceContentHash: expectedSource.contentHash,
      });
    });
  }

  const hostile = loadJson<HostileMatrix>(path.join(CERTIFICATION_FIXTURE_ROOT, 'hostile-matrix.json'));
  for (const item of hostile.items) {
    test(`hostile ${item.id}: ${item.expected}`, async () => {
      await exerciseHostile(item);
    });
  }
});
