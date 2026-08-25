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
  certificationFingerprint,
  normalizeProductIntentAuthority,
  type M1CertificationCase,
  type M1CertificationDriver,
  type M1CertificationStep,
  type M1FinalOracle,
  type M1MutationObservation,
  type M1ObservableTrace,
  type M1RefusalCode,
} from './driver';

type CompatibilityObservation = M1ObservableTrace['compatibility'];
type StageObservation = M1ObservableTrace['stages'][number];

export interface ProductAcceptedV3Observation {
  kind: 'accepted_v3';
  scenarioId: string;
  stages: StageObservation[];
  intent: unknown;
  testSet: { value: unknown; contentHash: string };
  plan: { value: unknown; semanticHash: string };
  execution: { executionId: string; lifecycle: 'completed'; infrastructureOutcome: 'completed' };
  run: { runId: string; executionId: string; lifecycle: 'completed' };
  result: {
    resultId: string;
    runId: string;
    outcome: 'passed' | 'failed' | 'could_not_verify';
    reasonCode: 'oracle_failed' | 'completed' | 'could_not_verify';
    durationMs: number;
    oracleKind: 'subject_observable' | null;
    observedSubjectId: string | null;
  };
  ui: {
    state: 'generated_review';
    appArea: string;
    steps: M1CertificationStep[];
    finalOracle: M1FinalOracle;
    canRun: boolean;
    backendContractVersion: 3;
  };
  mutationObservations: M1MutationObservation[];
  compatibility: CompatibilityObservation;
}

export interface ProductRefusalObservation {
  kind: 'refused';
  scenarioId: string;
  stages: StageObservation[];
  refusal: { code: M1RefusalCode; reason: string };
  ui: {
    state: 'refused';
    refusalCode: M1RefusalCode;
    canRun: false;
  };
  compatibility: CompatibilityObservation;
}

export type ProductM1Observation = ProductAcceptedV3Observation | ProductRefusalObservation;

export interface ProductM1ObservationPort {
  observe(caseFixture: M1CertificationCase): Promise<ProductM1Observation>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Observed Product ${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Observed Product ${label} is malformed.`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`Observed Product ${label} is malformed.`);
  return Number(value);
}

function duration(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Observed Product ${label} is malformed.`);
  return Number(value);
}

function semanticStep(value: unknown): M1CertificationStep {
  const step = record(value, 'step');
  if (step.kind === 'navigate_to_observed_route' && step.ordinal === 0) {
    const routePath = step.routePath ?? step.normalizedPath;
    return {
      stepId: text(step.stepId, 'navigate stepId'), ordinal: 0, kind: step.kind,
      subjectId: text(step.subjectId, 'navigate subjectId'), routePath: text(routePath, 'navigate routePath'),
    };
  }
  if (step.kind === 'click_observed_data_test' && step.ordinal === 1) {
    return {
      stepId: text(step.stepId, 'click stepId'), ordinal: 1, kind: step.kind,
      subjectId: text(step.subjectId, 'click subjectId'), elementId: text(step.elementId, 'click elementId'),
      dataTestValue: text(step.dataTestValue, 'click dataTestValue'),
      targetSubjectId: text(step.targetSubjectId, 'click targetSubjectId'),
    };
  }
  throw new Error('Observed Product step is outside the frozen M1 semantic contract.');
}

function compatible(value: CompatibilityObservation): CompatibilityObservation {
  return JSON.parse(JSON.stringify(value)) as CompatibilityObservation;
}

/**
 * Certification-owned Product adapter. Product/Core types are intentionally
 * absent: the port exposes observable runtime values and this class decodes
 * them into certification semantics without becoming a second Product oracle.
 */
export class ProductM1CertificationDriver implements M1CertificationDriver {
  public readonly name = 'm1-product-observation-driver';
  public readonly authorityClass = 'product' as const;

  constructor(private readonly product: ProductM1ObservationPort) {}

  async observe(caseFixture: M1CertificationCase): Promise<M1ObservableTrace> {
    const observed = await this.product.observe(caseFixture);
    if (observed.kind === 'refused') {
      return {
        scenarioId: observed.scenarioId,
        stages: [...observed.stages],
        intent: { state: 'refused', refusal: { ...observed.refusal } },
        definition: null, plan: null, execution: null, run: null, result: null,
        ui: {
          state: observed.ui.state, appArea: null, steps: [], finalOracle: null,
          refusalCode: observed.ui.refusalCode, canRun: observed.ui.canRun, backendContractVersion: null,
        },
        mutationObservations: [],
        compatibility: compatible(observed.compatibility),
      };
    }

    const intent = normalizeProductIntentAuthority(observed.intent);
    const set = record(observed.testSet.value, 'Test Set');
    if (set.schemaVersion !== 3 || set.projectId !== intent.projectId || !Array.isArray(set.definitions)
      || set.definitions.length !== 1 || set.revision === undefined) {
      throw new Error('Observed Product v3 Test Set is malformed.');
    }
    const definition = record(set.definitions[0], 'Definition');
    const provenance = record(definition.provenance, 'Definition provenance');
    if (!Array.isArray(definition.actions) || !Array.isArray(provenance.subjectSupport)) {
      throw new Error('Observed Product Definition semantic authority is malformed.');
    }
    const embeddedIntent = normalizeProductIntentAuthority(definition.normalizedIntent);
    const plan = record(observed.plan.value, 'ExecutablePlan');
    const planProvenance = record(plan.provenance, 'ExecutablePlan provenance');
    const planOracle = record(plan.oracle, 'ExecutablePlan oracle');
    if (plan.schemaVersion !== 2 || plan.category !== 'observed_flow' || !Array.isArray(plan.steps)
      || planProvenance.intentId !== intent.intentId || planProvenance.intentContentHash !== intent.intentContentHash) {
      throw new Error('Observed Product ExecutablePlan is not bound to the canonical intent.');
    }
    const semanticPlanSteps = plan.steps.map(semanticStep);
    const planFinalOracle: M1FinalOracle = {
      kind: 'subject_observable',
      subjectId: text(planOracle.subjectId, 'plan oracle subjectId'),
      routePath: text(planOracle.routePath, 'plan oracle routePath'),
    };
    const definitionOracle = record(definition.oracle, 'Definition oracle');
    const definitionFinalOracle: M1FinalOracle = {
      kind: 'subject_observable',
      subjectId: text(definitionOracle.subjectId, 'Definition oracle subjectId'),
      routePath: embeddedIntent.finalOracle.routePath,
    };
    const definitionId = text(definition.id, 'Definition identity');
    const planId = text(plan.planId, 'ExecutablePlan identity');
    const revision = integer(set.revision, 'Test Set revision');
    const resultFingerprint = certificationFingerprint(observed.result);
    duration(observed.result.durationMs, 'Result duration');

    return {
      scenarioId: observed.scenarioId,
      stages: [...observed.stages],
      intent: { state: 'accepted', intent },
      definition: {
        authority: 'canonical_product', schemaVersion: 3, definitionId, revision,
        projectId: text(set.projectId, 'Test Set project identity'), appArea: text(definition.appArea, 'Definition appArea'),
        intentId: text(provenance.intentId, 'Definition intent identity'),
        intentContentHash: text(provenance.intentContentHash, 'Definition intent hash'),
        normalizedIntent: embeddedIntent, steps: definition.actions.map(semanticStep), finalOracle: definitionFinalOracle,
        subjectSupport: JSON.parse(JSON.stringify(provenance.subjectSupport)),
        executable: record(definition.runnerCompatibility, 'Definition compatibility').state === 'compatible',
        quarantine: false, legacySemantics: null, fingerprint: certificationFingerprint(definition),
      },
      plan: {
        planId, definitionSchemaVersion: 3, definitionId, definitionRevision: revision,
        projectId: text(set.projectId, 'Test Set project identity'), intentId: text(planProvenance.intentId, 'plan intent identity'),
        intentContentHash: text(planProvenance.intentContentHash, 'plan intent hash'),
        appArea: text(plan.appArea, 'plan appArea'), steps: semanticPlanSteps, finalOracle: planFinalOracle,
        semanticHash: observed.plan.semanticHash,
      },
      execution: {
        executionId: observed.execution.executionId, planId, planSemanticHash: observed.plan.semanticHash,
        lifecycle: observed.execution.lifecycle, infrastructureOutcome: observed.execution.infrastructureOutcome,
      },
      run: {
        runId: observed.run.runId, executionId: observed.run.executionId, definitionId, planId,
      },
      result: {
        resultId: observed.result.resultId, runId: observed.result.runId,
        executionId: observed.execution.executionId, definitionId, planId,
        outcome: observed.result.outcome,
        businessAssertion: observed.result.outcome === 'passed' ? 'passed' : observed.result.outcome === 'failed' ? 'failed' : null,
        reasonCode: observed.result.reasonCode, fingerprint: resultFingerprint,
      },
      ui: {
        state: observed.ui.state, appArea: observed.ui.appArea,
        steps: observed.ui.steps.map(step => ({ ...step })), finalOracle: { ...observed.ui.finalOracle },
        refusalCode: null, canRun: observed.ui.canRun, backendContractVersion: observed.ui.backendContractVersion,
      },
      mutationObservations: observed.mutationObservations.map(item => ({ ...item })),
      compatibility: compatible(observed.compatibility),
    };
  }
}
