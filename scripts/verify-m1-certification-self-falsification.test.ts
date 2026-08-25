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
import { describe, test } from 'node:test';

import {
  cloneTrace,
  type M1CertificationCase,
  type M1CertificationDriver,
  type M1ObservableTrace,
  ReferenceHarnessDriver,
} from './m1-certification/driver';
import { loadM1CertificationCase } from './m1-certification/fixture-loader';
import { certifyM1Case } from './m1-certification/suite';

type TraceMutation = (trace: M1ObservableTrace) => void;

async function brokenProductDriver(
  caseFixture: M1CertificationCase,
  mutate: TraceMutation,
): Promise<M1CertificationDriver> {
  const reference = new ReferenceHarnessDriver();
  const cleanTrace = await reference.observe(caseFixture);
  return {
    name: 'deliberately-broken-product-adapter',
    authorityClass: 'product',
    async observe(): Promise<M1ObservableTrace> {
      const trace = cloneTrace(cleanTrace);
      mutate(trace);
      return trace;
    },
  };
}

async function expectFinding(
  fixtureName: string,
  expectedCode: string,
  mutate: TraceMutation,
): Promise<void> {
  const fixture = loadM1CertificationCase(fixtureName);
  const report = await certifyM1Case(await brokenProductDriver(fixture, mutate), fixture);
  assert.equal(report.passed, false, `Broken adapter unexpectedly passed ${fixtureName}`);
  assert.ok(
    report.findings.some(finding => finding.code === expectedCode),
    `Expected ${expectedCode}; observed ${report.findings.map(finding => finding.code).join(', ')}`,
  );
}

describe('M1 certification self-falsification', () => {
  test('a mechanics-only mock cannot be mistaken for production wiring', async () => {
    const fixture = loadM1CertificationCase('happy-path.json');
    const report = await certifyM1Case(new ReferenceHarnessDriver(), fixture);
    assert.ok(report.findings.some(finding => finding.code === 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT'));
  });

  test('missing grounding is detected even if downstream objects look runnable', async () => {
    await expectFinding('happy-path.json', 'INTENT_GROUNDING_DROPPED', trace => {
      if (trace.intent?.state === 'accepted') trace.intent.intent.grounding.subjectSupport = [];
    });
  });

  test('false-positive app categorization is detected at its source', async () => {
    await expectFinding('app-area-correctness.json', 'APP_AREA_RECLASSIFIED', trace => {
      if (trace.intent?.state === 'accepted') trace.intent.intent.appArea.name = 'account';
    });
  });

  test('reordered, missing, and duplicate plan steps are independently detected', async () => {
    await expectFinding('step-order-hostiles.json', 'PLAN_STEP_REORDERED', trace => {
      trace.plan!.steps.reverse();
    });
    await expectFinding('step-order-hostiles.json', 'PLAN_STEP_MISSING', trace => {
      trace.plan!.steps.pop();
    });
    await expectFinding('step-order-hostiles.json', 'PLAN_STEP_DUPLICATED', trace => {
      trace.plan!.steps.push({ ...trace.plan!.steps[0]! });
    });
    await expectFinding('step-order-hostiles.json', 'INVALID_TEST_RUNNABLE', trace => {
      trace.plan!.steps.pop();
    });
  });

  test('dropped Definition provenance is detected independently of step content', async () => {
    await expectFinding('provenance-hostiles.json', 'DEFINITION_PROVENANCE_DROPPED', trace => {
      trace.definition!.subjectSupport = [];
    });
  });

  test('richer future actions still refuse closed as unsupported semantics', async () => {
    for (const unsupportedSemantic of ['fill', 'select', 'assert_text', 'drag_and_drop']) {
      const fixture = JSON.parse(
        JSON.stringify(loadM1CertificationCase('unsupported-action.json')),
      ) as M1CertificationCase;
      fixture.caseId = `M1-03-unsupported-${unsupportedSemantic}`;
      fixture.input.requestedUnsupportedSemantic = unsupportedSemantic;
      const report = await certifyM1Case(new ReferenceHarnessDriver(), fixture, {
        requireProductAuthority: false,
      });
      assert.equal(report.passed, true, unsupportedSemantic);
      assert.equal(
        report.trace?.intent?.state === 'refused' ? report.trace.intent.refusal.code : null,
        'unsupported_semantics',
      );
    }
  });

  test('a richer action injected into a positive plan is rejected', async () => {
    await expectFinding('happy-path.json', 'PLAN_UNSUPPORTED_SEMANTICS', trace => {
      (trace.plan!.steps[1] as { kind: string }).kind = 'fill';
    });
  });

  test('generated source text and legacy fallback cannot satisfy canonical Definition authority', async () => {
    await expectFinding('end-to-end-case.json', 'GENERATED_SOURCE_AS_DEFINITION', trace => {
      trace.definition!.authority = 'generated_source';
    });
    await expectFinding('end-to-end-case.json', 'LEGACY_FALLBACK_SATISFIED_CONTRACT', trace => {
      trace.definition!.authority = 'legacy_v1_fallback';
    });
  });

  test('a Result without actual Execution evidence is rejected', async () => {
    await expectFinding('end-to-end-case.json', 'RESULT_WITHOUT_EXECUTION', trace => {
      trace.execution = null;
    });
  });

  test('infrastructure completion cannot rewrite a failed business assertion', async () => {
    await expectFinding('assertion-failure.json', 'RESULT_TRUTH_REWRITTEN', trace => {
      trace.result!.outcome = 'passed';
      trace.result!.businessAssertion = 'passed';
      trace.result!.reasonCode = 'verified';
    });
  });

  test('silent Definition, plan, and Result mutation is detected', async () => {
    for (const target of ['definition', 'plan', 'result'] as const) {
      await expectFinding(
        'immutability-hostiles.json',
        `${target.toUpperCase()}_MUTATION_ACCEPTED`,
        trace => {
          const observation = trace.mutationObservations.find(entry => entry.target === target)!;
          observation.refused = false;
          observation.afterFingerprint = 'f'.repeat(64);
        },
      );
    }
  });

  test('a v2 Definition cannot pass by silently adopting v3 fields', async () => {
    const v3Fixture = loadM1CertificationCase('happy-path.json');
    const v3Trace = await new ReferenceHarnessDriver().observe(v3Fixture);
    await expectFinding('navigation-backward-compatible.json', 'V2_SEMANTICS_REDEFINED', trace => {
      trace.definition!.intentId = 'silently-upgraded';
      trace.definition!.normalizedIntent =
        v3Trace.intent?.state === 'accepted' ? v3Trace.intent.intent : null;
    });
  });

  test('UI-only success cannot hide backend shape drift or make refusal runnable', async () => {
    await expectFinding('ui-contract-cases.json', 'UI_BACKEND_CONTRACT_DRIFT', trace => {
      trace.ui.backendContractVersion = null;
    });
    await expectFinding('insufficient-evidence.json', 'REFUSED_UI_RUNNABLE', trace => {
      trace.ui.canRun = true;
    });
    await expectFinding('app-area-unknown.json', 'UI_INFERRED_REFUSAL_STATE', trace => {
      trace.ui.appArea = 'miscellaneous';
    });
  });

  test('a refusal cannot leak synthetic Definition or plan authority', async () => {
    const accepted = await new ReferenceHarnessDriver().observe(
      loadM1CertificationCase('happy-path.json'),
    );
    await expectFinding('unsupported-action.json', 'RUNNABLE_FICTION_AFTER_REFUSAL', trace => {
      trace.definition = cloneTrace(accepted).definition;
      trace.plan = cloneTrace(accepted).plan;
    });
  });
});
