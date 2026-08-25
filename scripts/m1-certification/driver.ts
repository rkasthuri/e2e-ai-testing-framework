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

import { createHash } from 'node:crypto';

export const M1_REFUSAL_CODES = [
  'insufficient_evidence',
  'ambiguous_evidence',
  'unsupported_semantics',
  'app_area_unknown',
] as const;

export type M1RefusalCode = (typeof M1_REFUSAL_CODES)[number];

export const M1_STEP_KINDS = [
  'navigate_to_observed_route',
  'click_observed_data_test',
] as const;

export type M1StepKind = (typeof M1_STEP_KINDS)[number];
export type M1IntentSource = 'discovered' | 'manual' | 'natural-language';
export type M1EvidenceSufficiency = 'sufficient' | 'insufficient' | 'ambiguous';
export type M1ResultOutcome = 'passed' | 'failed' | 'could_not_verify';

export interface M1NavigateStep {
  stepId: string;
  ordinal: 0;
  kind: 'navigate_to_observed_route';
  subjectId: string;
  routePath: string;
}

export interface M1ClickStep {
  stepId: string;
  ordinal: 1;
  kind: 'click_observed_data_test';
  subjectId: string;
  elementId: string;
  dataTestValue: string;
  targetSubjectId: string;
}

export type M1CertificationStep = M1NavigateStep | M1ClickStep;
export type M1ObservedStep = M1CertificationStep;

export type M1FixtureStep = M1CertificationStep & { evidenceObservationIds: string[] };

export interface M1FinalOracle {
  kind: 'subject_observable';
  subjectId: string;
  routePath: string;
}

export interface M1SubjectSupport {
  canonicalSubjectId: string;
  supportingObservationIds: string[];
  supportingGapIds: string[];
}

export interface M1AppModelPage {
  pageId: string;
  module: string | null;
}

export interface M1CertificationInput {
  projectId: string;
  source: M1IntentSource;
  appModel: {
    modelId: string;
    modelVersion: number;
    classifier: 'ModuleClassifier';
    pages: M1AppModelPage[];
    supportObservationIds: string[];
  };
  flow: {
    flowId: string;
    title: string;
    objective: string;
    pageIds: string[];
    preconditions: Array<{ kind: 'authenticated_role'; roleId: string; mechanism: string }>;
    steps: M1FixtureStep[];
    finalOracle: M1FinalOracle & { evidenceObservationIds: string[] };
  };
  evidenceSufficiency: M1EvidenceSufficiency;
  requestedUnsupportedSemantic: string | null;
}

export type M1Attack =
  | 'accept_definition_mutation'
  | 'accept_plan_mutation'
  | 'accept_result_mutation'
  | 'app_area_reclassified'
  | 'duplicate_step'
  | 'generated_source_as_definition'
  | 'legacy_fallback'
  | 'missing_step'
  | 'provenance_dropped'
  | 'reordered_steps'
  | 'result_without_execution'
  | 'rewrite_assertion_failure'
  | 'ui_backend_shape_drift';

export interface M1CertificationCase {
  schemaVersion: 'forge-m1-certification-case/v1';
  caseId: string;
  matrixItem: number;
  title: string;
  input: M1CertificationInput;
  expected: {
    disposition: 'accepted' | 'refused';
    refusalCode: M1RefusalCode | null;
    definitionSchemaVersion: 2 | 3 | null;
    resultOutcome: M1ResultOutcome | null;
    businessAssertion: 'passed' | 'failed' | null;
    uiState: 'generated_review' | 'refused';
    canRun: boolean;
  };
  attacks: M1Attack[];
  tags: string[];
}

export interface M1AppAreaSemanticView {
  name: string;
  sourceSubjectId: string;
  confidence: 'high' | 'medium';
  method: 'rule' | 'ai' | 'manual';
  evidenceIds: string[];
}

export interface NormalizedTestIntentV1 {
  schemaVersion: 'forge-normalized-test-intent/v1';
  intentId: string;
  intentContentHash: string;
  projectId: string;
  source: M1IntentSource;
  appArea: M1AppAreaSemanticView;
  title: string;
  objective: string;
  preconditions: Array<{ kind: 'authenticated_role'; roleId: string; mechanism: string }>;
  steps: M1CertificationStep[];
  finalOracle: M1FinalOracle;
  grounding: {
    flowId: string;
    modelRowId: number;
    modelVersion: string;
    observationRunId: string;
    supportSealHash: string;
    selectedFlowStepIndexes: number[];
    excludedFlowStepIndexes: number[];
    subjectSupport: M1SubjectSupport[];
  };
  confidence: {
    evidenceSufficiency: 'sufficient';
  };
  refusal: null;
}

export type M1IntentObservation =
  | {
      state: 'accepted';
      intent: NormalizedTestIntentV1;
    }
  | {
      state: 'refused';
      refusal: {
        code: M1RefusalCode;
        reason: string;
      };
    };

export interface M1ObservedDefinition {
  authority: 'canonical_product' | 'generated_source' | 'legacy_v1_fallback';
  schemaVersion: 1 | 2 | 3;
  definitionId: string;
  revision: number;
  projectId: string;
  appArea: string | null;
  intentId: string | null;
  intentContentHash: string | null;
  normalizedIntent: NormalizedTestIntentV1 | null;
  steps: M1ObservedStep[];
  finalOracle: M1FinalOracle;
  subjectSupport: M1SubjectSupport[];
  executable: boolean;
  quarantine: boolean;
  legacySemantics: 'navigation_only' | null;
  fingerprint: string;
}

export interface M1ObservedPlan {
  planId: string;
  definitionSchemaVersion: 2 | 3;
  definitionId: string;
  definitionRevision: number;
  projectId: string;
  intentId: string | null;
  intentContentHash: string | null;
  appArea: string | null;
  steps: M1ObservedStep[];
  finalOracle: M1FinalOracle;
  semanticHash: string;
}

export interface M1ObservedExecution {
  executionId: string;
  planId: string;
  planSemanticHash: string;
  lifecycle: 'completed';
  infrastructureOutcome: 'completed';
}

export interface M1ObservedRun {
  runId: string;
  executionId: string;
  definitionId: string;
  planId: string;
}

export interface M1ObservedResult {
  resultId: string;
  runId: string;
  executionId: string;
  definitionId: string;
  planId: string;
  outcome: M1ResultOutcome;
  businessAssertion: 'passed' | 'failed' | null;
  reasonCode: 'oracle_failed' | 'completed' | 'could_not_verify';
  fingerprint: string;
}

export interface M1UiProjection {
  state: 'generated_review' | 'refused';
  appArea: string | null;
  steps: M1ObservedStep[];
  finalOracle: M1FinalOracle | null;
  refusalCode: M1RefusalCode | null;
  canRun: boolean;
  backendContractVersion: 2 | 3 | null;
}

export interface M1MutationObservation {
  target: 'definition' | 'plan' | 'result';
  identity: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  refused: boolean;
}

export interface M1ObservableTrace {
  scenarioId: string;
  stages: Array<
    | 'observation'
    | 'app_model'
    | 'intent'
    | 'definition'
    | 'plan'
    | 'execution'
    | 'run'
    | 'result'
  >;
  intent: M1IntentObservation | null;
  definition: M1ObservedDefinition | null;
  plan: M1ObservedPlan | null;
  execution: M1ObservedExecution | null;
  run: M1ObservedRun | null;
  result: M1ObservedResult | null;
  ui: M1UiProjection;
  mutationObservations: M1MutationObservation[];
  compatibility: {
    v2: {
      schemaVersion: 2;
      semantics: 'navigation_only';
      executable: true;
      silentlyUpgraded: false;
    };
    v1: {
      schemaVersion: 1;
      readable: true;
      executable: false;
      quarantine: true;
      silentlyUpgraded: false;
    };
  };
}

export interface M1CertificationDriver {
  readonly name: string;
  readonly authorityClass: 'product' | 'reference_harness';
  observe(caseFixture: M1CertificationCase): Promise<M1ObservableTrace>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }

  return value;
}

export function certificationFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function cloneTrace(trace: M1ObservableTrace): M1ObservableTrace {
  return JSON.parse(JSON.stringify(trace)) as M1ObservableTrace;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Product ${label} is malformed`);
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Product ${label} is malformed`);
  }
  return [...value];
}

function groundingIndexes(value: unknown, label: string): number[] {
  if (!Array.isArray(value)
    || value.some(item => typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0)
    || new Set(value).size !== value.length) {
    throw new Error(`Product ${label} is malformed`);
  }
  return [...value] as number[];
}

/**
 * Certification-owned decoder for the canonical Product intent. It deliberately

 * imports no Core types: every semantic value is copied from observable Product
 * authority and the canonical content hash is recomputed independently.
 */
export function normalizeProductIntentAuthority(value: unknown): NormalizedTestIntentV1 {
  const intent = record(value, 'normalized intent');
  if (intent.schemaVersion !== 'forge-normalized-test-intent/v1'
    || typeof intent.intentId !== 'string' || typeof intent.projectId !== 'string'
    || !['discovered', 'manual', 'natural-language'].includes(String(intent.source))
    || typeof intent.title !== 'string' || typeof intent.objective !== 'string') {
    throw new Error('Product normalized intent identity is malformed');
  }
  const area = record(intent.appArea, 'intent appArea');
  const evidenceIds = strings(area.evidenceIds, 'intent appArea evidenceIds');
  if (typeof area.id !== 'string' || typeof area.sourceSubjectId !== 'string'
    || !['high', 'medium'].includes(String(area.confidence))
    || !['rule', 'ai', 'manual'].includes(String(area.method)) || evidenceIds.length === 0) {
    throw new Error('Product intent appArea evidence is malformed');
  }
  if (!Array.isArray(intent.preconditions) || !Array.isArray(intent.steps)
    || !Array.isArray(intent.expectedOutcomes) || intent.expectedOutcomes.length !== 1) {
    throw new Error('Product normalized intent content is malformed');
  }
  const preconditions = intent.preconditions.map((item, index) => {
    const precondition = record(item, `intent precondition ${index}`);
    if (precondition.kind !== 'authenticated_role' || typeof precondition.roleId !== 'string'
      || typeof precondition.mechanism !== 'string') throw new Error('Product intent precondition is malformed');
    return { kind: 'authenticated_role' as const, roleId: precondition.roleId, mechanism: precondition.mechanism };
  });
  const steps = intent.steps.map((item, index): M1CertificationStep => {
    const step = record(item, `intent step ${index}`);
    if (step.kind === 'navigate_to_observed_route' && step.ordinal === 0
      && typeof step.stepId === 'string' && typeof step.subjectId === 'string' && typeof step.routePath === 'string') {
      return { stepId: step.stepId, ordinal: 0, kind: step.kind, subjectId: step.subjectId, routePath: step.routePath };
    }
    if (step.kind === 'click_observed_data_test' && step.ordinal === 1
      && typeof step.stepId === 'string' && typeof step.subjectId === 'string'
      && typeof step.elementId === 'string' && typeof step.dataTestValue === 'string'
      && typeof step.targetSubjectId === 'string') {
      return {
        stepId: step.stepId, ordinal: 1, kind: step.kind, subjectId: step.subjectId,
        elementId: step.elementId, dataTestValue: step.dataTestValue, targetSubjectId: step.targetSubjectId,
      };
    }
    throw new Error(`Product intent step ${index} is malformed`);
  });
  const outcome = record(intent.expectedOutcomes[0], 'intent final oracle');
  if (outcome.kind !== 'subject_observable' || typeof outcome.subjectId !== 'string'
    || typeof outcome.routePath !== 'string') throw new Error('Product intent final oracle is malformed');
  const grounding = record(intent.grounding, 'intent grounding');
  if (!Array.isArray(grounding.subjectSupport)) throw new Error('Product intent subject support is malformed');
  const subjectSupport = grounding.subjectSupport.map((item, index): M1SubjectSupport => {
    const support = record(item, `intent subject support ${index}`);
    if (typeof support.canonicalSubjectId !== 'string') throw new Error('Product intent subject support is malformed');
    return {
      canonicalSubjectId: support.canonicalSubjectId,
      supportingObservationIds: strings(support.supportingObservationIds, 'subject observations'),
      supportingGapIds: strings(support.supportingGapIds, 'subject gaps'),
    };
  });
  const assessment = record(intent.evidenceAssessment, 'intent evidence assessment');
  const disposition = record(intent.disposition, 'intent disposition');
  if (assessment.state !== 'sufficient' || disposition.state !== 'supported') {
    throw new Error('Product normalized intent is not supported');
  }
  if (!Number.isSafeInteger(grounding.modelRowId) || typeof grounding.modelVersion !== 'string'
    || typeof grounding.observationRunId !== 'string' || typeof grounding.supportSealHash !== 'string'
    || typeof grounding.sourceFlowId !== 'string') throw new Error('Product intent grounding identity is malformed');
  const selectedFlowStepIndexes = groundingIndexes(
    grounding.selectedFlowStepIndexes,
    'intent selected flow step indexes',
  );
  const excludedFlowStepIndexes = groundingIndexes(
    grounding.excludedFlowStepIndexes,
    'intent excluded flow step indexes',
  );
  const selectedIndexSet = new Set(selectedFlowStepIndexes);
  if (excludedFlowStepIndexes.some(index => selectedIndexSet.has(index))) {
    throw new Error('Product intent grounding step indexes overlap');
  }
  const canonicalHash = certificationFingerprint(value);
  return {
    schemaVersion: 'forge-normalized-test-intent/v1', intentId: intent.intentId, intentContentHash: canonicalHash,
    projectId: intent.projectId, source: intent.source as M1IntentSource,
    appArea: {
      name: area.id, sourceSubjectId: area.sourceSubjectId,
      confidence: area.confidence as M1AppAreaSemanticView['confidence'],
      method: area.method as M1AppAreaSemanticView['method'], evidenceIds,
    },
    title: intent.title, objective: intent.objective, preconditions, steps,
    finalOracle: { kind: 'subject_observable', subjectId: outcome.subjectId, routePath: outcome.routePath },
    grounding: {
      flowId: grounding.sourceFlowId, modelRowId: grounding.modelRowId as number,
      modelVersion: grounding.modelVersion, observationRunId: grounding.observationRunId,
      supportSealHash: grounding.supportSealHash, selectedFlowStepIndexes, excludedFlowStepIndexes, subjectSupport,
    },
    confidence: { evidenceSufficiency: 'sufficient' }, refusal: null,
  };
}

function selectedPages(caseFixture: M1CertificationCase): M1AppModelPage[] {
  const selected = new Set(caseFixture.input.flow.pageIds);
  return caseFixture.input.appModel.pages.filter(page => selected.has(page.pageId));
}

function appAreaForReferenceHarness(caseFixture: M1CertificationCase): string | null {
  const modules = new Set(selectedPages(caseFixture).map(page => page.module));
  return modules.size === 1 ? [...modules][0] : null;
}

function referenceIntent(caseFixture: M1CertificationCase, appArea: string): NormalizedTestIntentV1 {
  const input = caseFixture.input;
  const steps = input.flow.steps.map(({ evidenceObservationIds: _evidence, ...step }) => ({ ...step }));
  const finalOracle = (({ evidenceObservationIds: _evidence, ...oracle }) => oracle)(input.flow.finalOracle);
  const sourceSubjectId = steps[0]?.subjectId ?? input.flow.pageIds[0]!;
  const targetSubjectId = finalOracle.subjectId;
  const subjectSupport: M1SubjectSupport[] = [
    {
      canonicalSubjectId: sourceSubjectId,
      supportingObservationIds: [...new Set(input.flow.steps.flatMap(step => step.subjectId === sourceSubjectId ? step.evidenceObservationIds : []))].sort(),
      supportingGapIds: [],
    },
    {
      canonicalSubjectId: targetSubjectId,
      supportingObservationIds: [...input.flow.finalOracle.evidenceObservationIds].sort(),
      supportingGapIds: [],
    },
  ].filter((support, index, all) => all.findIndex(item => item.canonicalSubjectId === support.canonicalSubjectId) === index);
  const canonical = {
    schemaVersion: 'forge-normalized-test-intent/v1' as const,
    intentId: `intent-${caseFixture.caseId}`,
    projectId: input.projectId,
    source: input.source,
    appArea: {
      name: appArea,
      sourceSubjectId,
      confidence: 'high' as const,
      method: 'rule' as const,
      evidenceIds: [...subjectSupport[0]!.supportingObservationIds],
    },
    title: input.flow.title,
    objective: input.flow.objective,
    preconditions: input.flow.preconditions.map(precondition => ({ ...precondition })),
    steps,
    finalOracle,
    grounding: {
      flowId: input.flow.flowId,
      modelRowId: input.appModel.modelVersion,
      modelVersion: String(input.appModel.modelVersion),
      observationRunId: input.appModel.modelId,
      supportSealHash: certificationFingerprint(input.appModel.supportObservationIds),
      selectedFlowStepIndexes: [0],
      excludedFlowStepIndexes: [],
      subjectSupport,
    },
    confidence: {
      evidenceSufficiency: 'sufficient' as const,
    },
    refusal: null,
  };
  return { ...canonical, intentContentHash: certificationFingerprint(canonical) };
}

function referenceRefusal(caseFixture: M1CertificationCase): M1RefusalCode {
  if (caseFixture.input.requestedUnsupportedSemantic !== null) {
    return 'unsupported_semantics';
  }

  if (caseFixture.input.evidenceSufficiency === 'insufficient') {
    return 'insufficient_evidence';
  }

  if (caseFixture.input.evidenceSufficiency === 'ambiguous') {
    return 'ambiguous_evidence';
  }

  const pages = selectedPages(caseFixture);
  if (pages.some(page => page.module === null)) {
    return 'app_area_unknown';
  }

  if (new Set(pages.map(page => page.module)).size !== 1) {
    return 'ambiguous_evidence';
  }

  throw new Error(`Reference harness cannot derive a refusal for ${caseFixture.caseId}`);
}

function compatibilityObservation(): M1ObservableTrace['compatibility'] {
  return {
    v2: {
      schemaVersion: 2,
      semantics: 'navigation_only',
      executable: true,
      silentlyUpgraded: false,
    },
    v1: {
      schemaVersion: 1,
      readable: true,
      executable: false,
      quarantine: true,
      silentlyUpgraded: false,
    },
  };
}

/**
 * This adapter proves only that the certification harness can consume its own
 * observable boundary. It is deliberately ineligible to certify Product.
 */
export class ReferenceHarnessDriver implements M1CertificationDriver {
  public readonly name = 'm1-reference-harness';
  public readonly authorityClass = 'reference_harness' as const;

  public async observe(caseFixture: M1CertificationCase): Promise<M1ObservableTrace> {
    if (caseFixture.expected.disposition === 'refused') {
      const code = referenceRefusal(caseFixture);
      return {
        scenarioId: caseFixture.caseId,
        stages: ['observation', 'app_model', 'intent'],
        intent: {
          state: 'refused',
          refusal: {
            code,
            reason: `Reference refusal: ${code}`,
          },
        },
        definition: null,
        plan: null,
        execution: null,
        run: null,
        result: null,
        ui: {
          state: 'refused',
          appArea: null,
          steps: [],
          finalOracle: null,
          refusalCode: code,
          canRun: false,
          backendContractVersion: null,
        },
        mutationObservations: [],
        compatibility: compatibilityObservation(),
      };
    }

    const input = caseFixture.input;
    const appArea = appAreaForReferenceHarness(caseFixture);
    if (appArea === null) {
      throw new Error(`Accepted reference fixture ${caseFixture.caseId} has no single app area`);
    }

    const intent = referenceIntent(caseFixture, appArea);
    const schemaVersion = caseFixture.expected.definitionSchemaVersion;
    if (schemaVersion !== 2 && schemaVersion !== 3) {
      throw new Error(`Accepted reference fixture ${caseFixture.caseId} needs v2 or v3`);
    }
    const isV3 = schemaVersion === 3;

    const definitionSteps: M1ObservedStep[] = intent.steps;
    const definitionContent = {
      schemaVersion,
      definitionId: `definition-${caseFixture.caseId}`,
      revision: 1,
      projectId: input.projectId,
      appArea: isV3 ? appArea : null,
      intentId: isV3 ? intent.intentId : null,
      intentContentHash: isV3 ? intent.intentContentHash : null,
      normalizedIntent: isV3 ? intent : null,
      steps: definitionSteps,
      finalOracle: intent.finalOracle,
      subjectSupport: intent.grounding.subjectSupport.map(support => ({
        ...support,
        supportingObservationIds: [...support.supportingObservationIds],
        supportingGapIds: [...support.supportingGapIds],
      })),
      executable: true,
      quarantine: false,
      legacySemantics: isV3 ? null : ('navigation_only' as const),
    };
    const definition: M1ObservedDefinition = {
      authority: 'canonical_product',
      ...definitionContent,
      fingerprint: certificationFingerprint(definitionContent),
    };

    const semanticHash = certificationFingerprint({
      definitionId: definition.definitionId,
      definitionRevision: definition.revision,
      steps: definition.steps,
      finalOracle: definition.finalOracle,
      appArea: definition.appArea,
      intentContentHash: definition.intentContentHash,
    });
    const planContent = {
      planId: `plan-${caseFixture.caseId}`,
      definitionSchemaVersion: schemaVersion,
      definitionId: definition.definitionId,
      definitionRevision: definition.revision,
      projectId: input.projectId,
      intentId: isV3 ? intent.intentId : null,
      intentContentHash: isV3 ? intent.intentContentHash : null,
      appArea: isV3 ? appArea : null,
      steps: definition.steps,
      finalOracle: definition.finalOracle,
      semanticHash,
    };
    const plan: M1ObservedPlan = {
      ...planContent,
    };

    const execution: M1ObservedExecution = {
      executionId: `execution-${caseFixture.caseId}`,
      planId: plan.planId,
      planSemanticHash: plan.semanticHash,
      lifecycle: 'completed',
      infrastructureOutcome: 'completed',
    };
    const run: M1ObservedRun = {
      runId: `run-${caseFixture.caseId}`,
      executionId: execution.executionId,
      definitionId: definition.definitionId,
      planId: plan.planId,
    };
    const outcome = caseFixture.expected.resultOutcome ?? 'passed';
    const businessAssertion = caseFixture.expected.businessAssertion;
    const resultBase = {
      resultId: `result-${caseFixture.caseId}`,
      runId: run.runId,
      executionId: execution.executionId,
      definitionId: definition.definitionId,
      planId: plan.planId,
      outcome,
      businessAssertion,
      reasonCode:
        outcome === 'failed'
          ? ('oracle_failed' as const)
          : outcome === 'passed'
            ? ('completed' as const)
            : ('could_not_verify' as const),
    };
    const result: M1ObservedResult = {
      ...resultBase,
      fingerprint: certificationFingerprint(resultBase),
    };

    const mutationObservations: M1MutationObservation[] = [];
    const mutationTargets: Array<M1MutationObservation['target']> = ['definition', 'plan', 'result'];
    for (const target of mutationTargets) {
      const attackName = `accept_${target}_mutation` as M1Attack;
      if (caseFixture.attacks.includes(attackName)) {
        const immutableFingerprint =
          target === 'definition'
            ? definition.fingerprint
            : target === 'plan'
              ? plan.semanticHash
              : result.fingerprint;
        mutationObservations.push({
          target,
          identity:
            target === 'definition'
              ? definition.definitionId
              : target === 'plan'
                ? plan.planId
                : result.resultId,
          beforeFingerprint: immutableFingerprint,
          afterFingerprint: immutableFingerprint,
          refused: true,
        });
      }
    }

    return {
      scenarioId: caseFixture.caseId,
      stages: isV3
        ? [
            'observation',
            'app_model',
            'intent',
            'definition',
            'plan',
            'execution',
            'run',
            'result',
          ]
        : ['definition', 'plan', 'execution', 'run', 'result'],
      intent: isV3 ? { state: 'accepted', intent } : null,
      definition,
      plan,
      execution,
      run,
      result,
      ui: {
        state: 'generated_review',
        appArea: isV3 ? appArea : null,
        steps: definition.steps,
        finalOracle: intent.finalOracle,
        refusalCode: null,
        canRun: true,
        backendContractVersion: schemaVersion,
      },
      mutationObservations,
      compatibility: compatibilityObservation(),
    };
  }
}
