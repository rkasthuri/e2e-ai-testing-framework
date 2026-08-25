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
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  M1_REFUSAL_CODES,
  M1_STEP_KINDS,
  certificationFingerprint,
  normalizeProductIntentAuthority,
  ReferenceHarnessDriver,
} from './m1-certification/driver';
import {
  loadAllM1CertificationCases,
  loadGoldenMatrix,
  loadM1CertificationCase,
  isValidM1CertificationFixture,
  m1CertificationFixtureRoot,
} from './m1-certification/fixture-loader';
import {
  assertM1CertificationPassed,
  certifyM1Case,
} from './m1-certification/suite';

describe('M1 certification contract fixtures', () => {
  test('golden matrix covers every frozen acceptance item', () => {
    const matrix = loadGoldenMatrix() as {
      certificationAuthority: string;
      referenceHarnessAuthority: string;
      items: Array<{ item: number; fixtures: string[] }>;
    };
    assert.equal(matrix.certificationAuthority, 'product_driver_required');
    assert.equal(matrix.referenceHarnessAuthority, 'mechanics_only');
    assert.deepEqual(
      matrix.items.map(item => item.item),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );

    const fixtureNames = new Set(
      loadAllM1CertificationCases().map(caseFixture => caseFixture.caseId),
    );
    assert.equal(fixtureNames.size, 13);
    assert.ok(matrix.items.every(item => item.fixtures.length > 0));
    for (const fileName of matrix.items.flatMap(item => item.fixtures)) {
      assert.equal(
        existsSync(path.join(m1CertificationFixtureRoot(), 'cases', fileName)),
        true,
        `Golden matrix fixture does not exist: ${fileName}`,
      );
    }
  });

  test('all isolated fixtures satisfy the certification-owned semantic schema', () => {
    const cases = loadAllM1CertificationCases();
    assert.equal(cases.length, 13);
    assert.equal(new Set(cases.map(caseFixture => caseFixture.caseId)).size, cases.length);

    for (const caseFixture of cases) {
      assert.equal(caseFixture.input.appModel.classifier, 'ModuleClassifier');
      assert.ok(caseFixture.tags.length > 0);
      assert.equal(
        new Set(caseFixture.input.flow.steps.map(step => step.stepId)).size,
        caseFixture.input.flow.steps.length,
      );
      assert.ok(caseFixture.input.flow.steps.every(step => step.evidenceObservationIds.length > 0));
      assert.ok(caseFixture.input.flow.finalOracle.evidenceObservationIds.length > 0);
      if (caseFixture.expected.disposition === 'accepted') {
        assert.equal(caseFixture.expected.refusalCode, null);
        assert.ok(caseFixture.expected.definitionSchemaVersion === 2 || caseFixture.expected.definitionSchemaVersion === 3);
      } else {
        assert.ok(M1_REFUSAL_CODES.includes(caseFixture.expected.refusalCode!));
        assert.equal(caseFixture.expected.definitionSchemaVersion, null);
        assert.equal(caseFixture.expected.canRun, false);
      }
    }
  });

  test('reference driver proves harness mechanics for every matrix fixture', async () => {
    const driver = new ReferenceHarnessDriver();
    for (const caseFixture of loadAllM1CertificationCases()) {
      const report = await certifyM1Case(driver, caseFixture, {
        requireProductAuthority: false,
      });
      assertM1CertificationPassed(report);
    }
  });

  test('reference harness is categorically ineligible to certify Product', async () => {
    const report = await certifyM1Case(
      new ReferenceHarnessDriver(),
      loadM1CertificationCase('happy-path.json'),
    );
    assert.equal(report.passed, false);
    assert.ok(
      report.findings.some(finding => finding.code === 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT'),
    );
  });

  test('happy path matches the exact frozen navigation, click, and final-oracle scope', async () => {
    const fixture = loadM1CertificationCase('happy-path.json');
    const report = await certifyM1Case(new ReferenceHarnessDriver(), fixture, {
      requireProductAuthority: false,
    });
    assertM1CertificationPassed(report);
    assert.deepEqual(
      fixture.input.flow.steps.map(step => step.kind),
      ['navigate_to_observed_route', 'click_observed_data_test'],
    );
    assert.ok(fixture.input.flow.preconditions.some(value => value.kind === 'authenticated_role'));
    assert.equal(fixture.input.flow.steps[0]?.kind === 'navigate_to_observed_route' ? fixture.input.flow.steps[0].routePath : null, '/cart.html');
    assert.equal(fixture.input.flow.steps[1]?.kind === 'click_observed_data_test' ? fixture.input.flow.steps[1].subjectId : null, 'subject-cart');
    assert.equal(fixture.input.flow.steps[1]?.kind === 'click_observed_data_test' ? fixture.input.flow.steps[1].elementId : null, 'subject-checkout-control');
    assert.equal(fixture.input.flow.steps[1]?.kind === 'click_observed_data_test' ? fixture.input.flow.steps[1].dataTestValue : null, 'checkout');
    assert.deepEqual(fixture.input.flow.finalOracle, {
      kind: 'subject_observable',
      subjectId: 'subject-checkout-step-one',
      routePath: '/checkout-step-one.html',
      evidenceObservationIds: ['obs-checkout-step-one-subject'],
    });
    assert.equal(report.trace?.definition?.schemaVersion, 3);
    assert.deepEqual(
      report.trace?.definition?.normalizedIntent,
      report.trace?.intent?.state === 'accepted' ? report.trace.intent.intent : null,
    );
  });

  test('every positive v3 case is satisfiable by the frozen M1 semantic capability alone', async () => {
    const positiveV3Cases = loadAllM1CertificationCases().filter(
      caseFixture =>
        caseFixture.expected.disposition === 'accepted' &&
        caseFixture.expected.definitionSchemaVersion === 3,
    );
    const driver = new ReferenceHarnessDriver();
    for (const caseFixture of positiveV3Cases) {
      assert.deepEqual(
        caseFixture.input.flow.steps.map(step => step.kind),
        ['navigate_to_observed_route', 'click_observed_data_test'],
      );
      assert.equal(caseFixture.input.flow.finalOracle.kind, 'subject_observable');
      const report = await certifyM1Case(driver, caseFixture, {
        requireProductAuthority: false,
      });
      assertM1CertificationPassed(report);
    }
  });

  test('future richer action vocabulary cannot enter a positive M1 fixture', () => {
    assert.deepEqual([...M1_STEP_KINDS], [
      'navigate_to_observed_route',
      'click_observed_data_test',
    ]);
    for (const unsupportedKind of ['fill', 'select', 'assert_text']) {
      const candidate = JSON.parse(
        JSON.stringify(loadM1CertificationCase('happy-path.json')),
      ) as { input: { flow: { steps: unknown[] } } };
      candidate.input.flow.steps[1] = {
        stepId: 'step-2',
        kind: unsupportedKind,
        subjectId: 'future-subject',
        value: 'future-value',
        ordinal: 1,
        evidenceObservationIds: ['obs-checkout-data-test'],
      };
      assert.equal(isValidM1CertificationFixture(candidate), false, unsupportedKind);
    }
  });

  test('certification independently normalizes canonical Product intent without inventing step provenance', () => {
    const canonical = {
      schemaVersion: 'forge-normalized-test-intent/v1', intentId: 'intent-product', projectId: 'project-storefront', source: 'discovered',
      appArea: { id: 'checkout', sourceSubjectId: 'subject-cart', confidence: 'high', method: 'rule', evidenceIds: ['obs-cart-route'] },
      title: 'Open checkout', objective: 'Observe checkout',
      preconditions: [{ kind: 'authenticated_role', roleId: 'shopper', mechanism: 'form-login' }],
      steps: [
        { stepId: 'step-1', ordinal: 0, kind: 'navigate_to_observed_route', subjectId: 'subject-cart', routePath: '/cart.html' },
        { stepId: 'step-2', ordinal: 1, kind: 'click_observed_data_test', subjectId: 'subject-cart', elementId: 'checkout-control', dataTestValue: 'checkout', targetSubjectId: 'subject-checkout' },
      ],
      expectedOutcomes: [{ outcomeId: 'outcome-1', kind: 'subject_observable', subjectId: 'subject-checkout', routePath: '/checkout.html' }],
      grounding: {
        modelRowId: 7, modelVersion: '7', observationRunId: 'observation-run-7', supportSealHash: 'a'.repeat(64), sourceFlowId: 'flow-checkout',
        selectedFlowStepIndexes: [0], excludedFlowStepIndexes: [],
        subjectSupport: [
          { canonicalSubjectId: 'subject-cart', supportingObservationIds: ['obs-cart-route', 'obs-checkout-control'], supportingGapIds: [] },
          { canonicalSubjectId: 'subject-checkout', supportingObservationIds: ['obs-checkout'], supportingGapIds: [] },
        ],
      },
      evidenceAssessment: { state: 'sufficient', sourceFlowConfidence: 'observed', selectedStepGrounding: 'observed', limitations: [] },
      disposition: { state: 'supported' },
    };
    const semantic = normalizeProductIntentAuthority(canonical);
    assert.equal(semantic.schemaVersion, canonical.schemaVersion);
    assert.equal(semantic.intentContentHash, certificationFingerprint(canonical));
    assert.deepEqual(semantic.appArea, { name: 'checkout', sourceSubjectId: 'subject-cart', confidence: 'high', method: 'rule', evidenceIds: ['obs-cart-route'] });
    assert.deepEqual(semantic.steps, canonical.steps);
    assert.deepEqual(semantic.finalOracle, { kind: 'subject_observable', subjectId: 'subject-checkout', routePath: '/checkout.html' });
    assert.deepEqual(semantic.grounding.subjectSupport, canonical.grounding.subjectSupport);
    assert.equal('observationIds' in semantic.steps[0]!, false);
    const withIndexes = (selectedFlowStepIndexes: unknown[], excludedFlowStepIndexes: unknown[] = []) => ({
      ...canonical,
      grounding: { ...canonical.grounding, selectedFlowStepIndexes, excludedFlowStepIndexes },
    });
    const invalidIndexes: Array<[string, unknown[], unknown[]?]> = [
      ['numeric string', ['0']],
      ['whitespace string', [' ']],
      ['hex-like string', ['0x1']],
      ['null', [null]],
      ['undefined', [undefined]],
      ['boolean', [true]],
      ['fraction', [0.5]],
      ['negative', [-1]],
      ['NaN', [Number.NaN]],
      ['positive infinity', [Number.POSITIVE_INFINITY]],
      ['negative infinity', [Number.NEGATIVE_INFINITY]],
      ['unsafe integer', [Number.MAX_SAFE_INTEGER + 1]],
      ['duplicate selected indexes', [2, 2]],
      ['duplicate excluded indexes', [3], [1, 1]],
    ];
    for (const [label, selected, excluded] of invalidIndexes) {
      assert.throws(
        () => normalizeProductIntentAuthority(withIndexes(selected, excluded)),
        /Product intent (selected|excluded) flow step indexes is malformed/,
        label,
      );
    }
    assert.throws(
      () => normalizeProductIntentAuthority(withIndexes([2], [1, 2])),
      /Product intent grounding step indexes overlap/,
    );
    const ordered = normalizeProductIntentAuthority(withIndexes([3], [4, 2, 0]));
    assert.deepEqual(ordered.grounding.selectedFlowStepIndexes, [3]);
    assert.deepEqual(ordered.grounding.excludedFlowStepIndexes, [4, 2, 0]);
  });

  test('future E2E binding uses the same frozen cart flow as the golden happy path', () => {
    const happy = loadM1CertificationCase('happy-path.json');
    const endToEnd = loadM1CertificationCase('end-to-end-case.json');
    assert.deepEqual(endToEnd.input.flow.steps, happy.input.flow.steps);
    assert.deepEqual(endToEnd.input.flow.finalOracle, happy.input.flow.finalOracle);
    assert.deepEqual(endToEnd.input.flow.preconditions, happy.input.flow.preconditions);
  });

  test('all four frozen refusal codes have hostile fixture coverage', async () => {
    const refused = loadAllM1CertificationCases().filter(
      caseFixture => caseFixture.expected.disposition === 'refused',
    );
    assert.deepEqual(
      [...new Set(refused.map(caseFixture => caseFixture.expected.refusalCode))].sort(),
      [...M1_REFUSAL_CODES].sort(),
    );
  });

  test('backward compatibility observes v2 directly and quarantines v1', async () => {
    const report = await certifyM1Case(
      new ReferenceHarnessDriver(),
      loadM1CertificationCase('navigation-backward-compatible.json'),
      { requireProductAuthority: false },
    );
    assertM1CertificationPassed(report);
    assert.equal(report.trace?.intent, null);
    assert.equal(report.trace?.definition?.schemaVersion, 2);
    assert.equal(report.trace?.definition?.legacySemantics, 'navigation_only');
    assert.equal(report.trace?.compatibility.v1.executable, false);
    assert.equal(report.trace?.compatibility.v1.quarantine, true);
    assert.equal(report.trace?.compatibility.v1.silentlyUpgraded, false);
  });

  test('UI cases are backend contract projections, not independent UI inference', async () => {
    const fixtureNames = [
      'ui-contract-cases.json',
      'insufficient-evidence.json',
      'unsupported-action.json',
      'app-area-unknown.json',
    ];
    for (const fileName of fixtureNames) {
      const report = await certifyM1Case(
        new ReferenceHarnessDriver(),
        loadM1CertificationCase(fileName),
        { requireProductAuthority: false },
      );
      assertM1CertificationPassed(report);
    }
  });
});
