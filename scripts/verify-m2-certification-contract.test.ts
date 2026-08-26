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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { ReferenceM2Driver } from './m2-certification/driver';
import {
  isValidM2CertificationFixture,
  loadAllM2CertificationCases,
  loadM2CertificationCase,
  loadM2GoldenMatrix,
  m2CertificationFixtureRoot,
} from './m2-certification/fixture-loader';
import { assertM2CertificationPassed, certifyM2Case, UI_REQUIREMENTS } from './m2-certification/suite';

describe('M2 certification contract', () => {
  test('golden matrix covers all frozen certification sections', () => {
    const matrix = loadM2GoldenMatrix() as {
      certificationAuthority: string;
      referenceHarnessAuthority: string;
      items: Array<{ item: number; fixtures: string[] }>;
    };
    assert.equal(matrix.certificationAuthority, 'product_driver_required');
    assert.equal(matrix.referenceHarnessAuthority, 'mechanics_only');
    assert.deepEqual(matrix.items.map(item => item.item), [1, 2, 3, 4, 5, 6]);
    for (const fixture of matrix.items.flatMap(item => item.fixtures)) {
      assert.equal(existsSync(path.join(m2CertificationFixtureRoot(), 'cases', fixture)), true, fixture);
    }
  });

  test('all isolated fixtures satisfy the closed certification schema', () => {
    const cases = loadAllM2CertificationCases();
    assert.equal(cases.length, 6);
    assert.equal(new Set(cases.map(value => value.caseId)).size, 6);
    assert.deepEqual(cases.map(value => value.scenario).sort(), [
      'fail_fast_results', 'golden_v2', 'hostile_matrix', 'positive_v3', 'stale_authority', 'ui_contract',
    ]);
  });

  test('schema rejects v1 Test Set authority and competing Suite fields', () => {
    const fixture = structuredClone(loadM2CertificationCase('golden-v2.json')) as unknown as Record<string, unknown>;
    const testSets = fixture.testSets as Array<Record<string, unknown>>;
    testSets[0]!.definitionSchemaVersion = 1;
    assert.equal(isValidM2CertificationFixture(fixture), false);
    const competing = structuredClone(loadM2CertificationCase('golden-v2.json')) as unknown as Record<string, unknown>;
    competing.selectionAuthority = 'client_membership';
    assert.equal(isValidM2CertificationFixture(competing), false);
  });

  test('reference driver proves mechanics for every matrix fixture', async () => {
    for (const fixture of loadAllM2CertificationCases()) {
      const report = await certifyM2Case(new ReferenceM2Driver(), fixture, { requireProductAuthority: false });
      assertM2CertificationPassed(report);
    }
  });

  test('reference driver is categorically ineligible to certify Product', async () => {
    const report = await certifyM2Case(new ReferenceM2Driver(), loadM2CertificationCase('golden-v2.json'));
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(value => value.code === 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT'));
  });

  test('golden Start contains Suite identity/revision only and no membership', async () => {
    const report = await certifyM2Case(
      new ReferenceM2Driver(),
      loadM2CertificationCase('golden-v2.json'),
      { requireProductAuthority: false },
    );
    assertM2CertificationPassed(report);
    assert.deepEqual(report.observations.startRequest, {
      executionIntentKey: 'M2-01-checkout-sanity-v2-start',
      selection: { kind: 'suite_revision', suiteId: 'suite-project-storefront-1', suiteRevision: 1 },
    });
    assert.equal('members' in (report.observations.startRequest as Record<string, unknown>), false);
  });

  test('hostile matrix names every frozen hostile case exactly once', () => {
    const hostile = loadM2CertificationCase('hostile-matrix.json');
    assert.equal(hostile.hostileCases.length, 31);
    assert.equal(new Set(hostile.hostileCases).size, 31);
  });

  test('UI contract freezes all semantics without importing React or UI code', () => {
    const ui = loadM2CertificationCase('ui-contract.json');
    assert.deepEqual([...ui.uiRequirements].sort(), [...UI_REQUIREMENTS].sort());
    for (const file of ['driver.ts', 'fixture-loader.ts', 'suite.ts']) {
      const source = readFileSync(path.join(process.cwd(), 'scripts', 'm2-certification', file), 'utf8');
      assert.equal(source.includes('forge-ui'), false, file);
      assert.equal(source.includes('react'), false, file);
      assert.equal(source.includes('../src/core'), false, file);
    }
  });
});
