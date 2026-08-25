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

import type {
  M1CertificationCase,
  M1CertificationDriver,
  M1ObservableTrace,
  M1ObservedDefinition,
  M1ObservedPlan,
  NormalizedTestIntentV1,
} from './driver';
import { M1_STEP_KINDS } from './driver';

export interface M1CertificationFinding {
  code: string;
  message: string;
}

export interface M1CertificationReport {
  caseId: string;
  driverName: string;
  driverAuthorityClass: M1CertificationDriver['authorityClass'];
  passed: boolean;
  findings: M1CertificationFinding[];
  trace: M1ObservableTrace | null;
}

export interface M1CertificationOptions {
  requireProductAuthority?: boolean;
}

const SHA_256 = /^[a-f0-9]{64}$/;
const COMPLETE_STAGES: M1ObservableTrace['stages'] = [
  'observation',
  'app_model',
  'intent',
  'definition',
  'plan',
  'execution',
  'run',
  'result',
];
const LEGACY_V2_STAGES: M1ObservableTrace['stages'] = [
  'definition',
  'plan',
  'execution',
  'run',
  'result',
];

function sameValue(left: unknown, right: unknown): boolean {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function stepSignature(steps: Array<{ stepId: string; kind: string }>): string[] {
  return steps.map(step => `${step.stepId}:${step.kind}`);
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function fixtureSteps(caseFixture: M1CertificationCase): NormalizedTestIntentV1['steps'] {
  return caseFixture.input.flow.steps.map(({ evidenceObservationIds: _evidence, ...step }) => step);
}

function stepContent(step: NormalizedTestIntentV1['steps'][number]): Omit<NormalizedTestIntentV1['steps'][number], 'stepId'> {
  const { stepId: _stepId, ...content } = step;
  return content;
}

function fixtureOracle(caseFixture: M1CertificationCase): NormalizedTestIntentV1['finalOracle'] {
  const { evidenceObservationIds: _evidence, ...oracle } = caseFixture.input.flow.finalOracle;
  return oracle;
}

function supportObservationIds(intent: NormalizedTestIntentV1): string[] {
  return intent.grounding.subjectSupport.flatMap(support => support.supportingObservationIds);
}

function semanticIntentBinding(left: NormalizedTestIntentV1, right: NormalizedTestIntentV1): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.intentId === right.intentId
    && left.intentContentHash === right.intentContentHash
    && left.appArea.name === right.appArea.name
    && sameValue(left.appArea, right.appArea)
    && sameValue(left.steps, right.steps)
    && sameValue(left.finalOracle, right.finalOracle)
    && sameValue(left.grounding, right.grounding);
}

function selectedModules(caseFixture: M1CertificationCase): Array<string | null> {
  const selectedPageIds = new Set(caseFixture.input.flow.pageIds);
  return caseFixture.input.appModel.pages
    .filter(page => selectedPageIds.has(page.pageId))
    .map(page => page.module);
}

function expectedAppArea(caseFixture: M1CertificationCase): string | null {
  const modules = new Set(selectedModules(caseFixture));
  if (selectedModules(caseFixture).length !== caseFixture.input.flow.pageIds.length) {
    return null;
  }
  return modules.size === 1 ? [...modules][0] : null;
}

function finding(
  findings: M1CertificationFinding[],
  condition: boolean,
  code: string,
  message: string,
): void {
  if (!condition) {
    findings.push({ code, message });
  }
}

function checkCompatibility(
  trace: M1ObservableTrace,
  findings: M1CertificationFinding[],
): void {
  finding(
    findings,
    sameValue(trace.compatibility.v2, {
      schemaVersion: 2,
      semantics: 'navigation_only',
      executable: true,
      silentlyUpgraded: false,
    }),
    'V2_COMPATIBILITY_CHANGED',
    'Definition v2 must remain executable with unchanged navigation-only semantics.',
  );
  finding(
    findings,
    sameValue(trace.compatibility.v1, {
      schemaVersion: 1,
      readable: true,
      executable: false,
      quarantine: true,
      silentlyUpgraded: false,
    }),
    'V1_QUARANTINE_CHANGED',
    'Definition v1 must remain readable, quarantined, and non-executable without silent upgrade.',
  );
}

function checkRefusal(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  findings: M1CertificationFinding[],
): void {
  finding(
    findings,
    trace.intent?.state === 'refused',
    'REFUSAL_NOT_OBSERVED',
    'The normalized-intent boundary accepted a fixture that must refuse.',
  );

  if (trace.intent?.state === 'refused') {
    finding(
      findings,
      trace.intent.refusal.code === caseFixture.expected.refusalCode,
      'WRONG_REFUSAL_CODE',
      `Expected refusal ${caseFixture.expected.refusalCode}, observed ${trace.intent.refusal.code}.`,
    );
  }

  const downstream = [trace.definition, trace.plan, trace.execution, trace.run, trace.result];
  finding(
    findings,
    downstream.every(value => value === null),
    'RUNNABLE_FICTION_AFTER_REFUSAL',
    'A refused intent must not produce a Definition, plan, Execution, Run, or Result.',
  );
  finding(
    findings,
    trace.ui.state === 'refused' && !trace.ui.canRun,
    'REFUSED_UI_RUNNABLE',
    'The UI must present refusal and disable Run.',
  );
  finding(
    findings,
    trace.ui.refusalCode === caseFixture.expected.refusalCode,
    'UI_REFUSAL_DRIFT',
    'The UI refusal must carry the backend refusal code unchanged.',
  );
  finding(
    findings,
    trace.ui.steps.length === 0 && trace.ui.finalOracle === null,
    'UI_SYNTHETIC_STEPS_AFTER_REFUSAL',
    'The UI must not display invented runnable steps or a final oracle for a refusal.',
  );
  finding(
    findings,
    trace.ui.appArea === null && trace.ui.backendContractVersion === null,
    'UI_INFERRED_REFUSAL_STATE',
    'The UI must not invent appArea or a runnable backend version after refusal.',
  );
  finding(
    findings,
    sameValue(trace.stages, ['observation', 'app_model', 'intent']),
    'REFUSAL_STAGE_CHAIN_DRIFT',
    'Refusal must stop at normalized intent without downstream canonical stages.',
  );
}

function checkIntent(
  caseFixture: M1CertificationCase,
  intent: NormalizedTestIntentV1,
  appArea: string,
  findings: M1CertificationFinding[],
): void {
  const input = caseFixture.input;
  finding(
    findings,
    intent.schemaVersion === 'forge-normalized-test-intent/v1',
    'INTENT_SCHEMA_DRIFT',
    'Accepted rich intent must retain the canonical Core schema identity.',
  );
  finding(
    findings,
    intent.intentId.length > 0 && intent.projectId === input.projectId,
    'INTENT_IDENTITY_DRIFT',
    'Intent identity and project identity must be present and retained.',
  );
  finding(
    findings,
    intent.source === input.source,
    'INTENT_SOURCE_DRIFT',
    'Intent source must be carried without reinterpretation.',
  );
  finding(
    findings,
    intent.appArea.name === appArea,
    'APP_AREA_RECLASSIFIED',
    'Intent appArea must equal the persisted App Model PageDefinition.module.',
  );
  finding(
    findings,
    intent.appArea.sourceSubjectId === intent.steps[0]?.subjectId
      && intent.appArea.evidenceIds.length > 0,
    'APP_AREA_PROVENANCE_DRIFT',
    'Intent appArea semantic name must retain its canonical source-subject and evidence identity.',
  );
  finding(
    findings,
    intent.title.length > 0 && intent.objective.length > 0,
    'INTENT_PURPOSE_DRIFT',
    'Intent must retain non-empty canonical purpose text produced from the evidence-backed flow.',
  );
  finding(
    findings,
    sameValue(intent.preconditions, input.flow.preconditions),
    'PRECONDITIONS_DROPPED',
    'Intent must retain prerequisite setup.',
  );
  finding(
    findings,
    sameValue(intent.steps.map(stepContent), fixtureSteps(caseFixture).map(stepContent))
      && intent.steps.every(step => step.stepId.length > 0)
      && new Set(intent.steps.map(step => step.stepId)).size === intent.steps.length,
    'INTENT_STEP_ORDER_DRIFT',
    'Intent steps must retain exact evidence order/content and canonical unique step identities.',
  );
  finding(
    findings,
    sameValue(intent.finalOracle, fixtureOracle(caseFixture)),
    'FINAL_ORACLE_DRIFT',
    'The final subject-observable oracle must be retained without synthesis.',
  );
  finding(
    findings,
    sameValue(intent.steps.map(step => step.kind), [
      'navigate_to_observed_route',
      'click_observed_data_test',
    ]) &&
      intent.steps[1]?.kind === 'click_observed_data_test' &&
      intent.steps[1].subjectId === intent.steps[0]?.subjectId &&
      intent.steps[1].elementId.length > 0 &&
      intent.steps[1].targetSubjectId === intent.finalOracle.subjectId &&
      intent.finalOracle.kind === 'subject_observable',
    'M1_SCOPE_SEMANTICS_DRIFT',
    'A positive M1 v3 flow is exactly observed-route navigation, one directly observed single-cardinality data-test click, and a subject-observable final oracle.',
  );
  finding(
    findings,
    intent.confidence.evidenceSufficiency === 'sufficient' && intent.refusal === null,
    'INTENT_EVIDENCE_STATE_DRIFT',
    'An accepted intent must explicitly record sufficient evidence and no refusal.',
  );
  finding(
    findings,
    sameValue(sorted(supportObservationIds(intent)), sorted(input.appModel.supportObservationIds)),
    'INTENT_GROUNDING_DROPPED',
    'Intent grounding must retain the supporting observations.',
  );
  finding(
    findings,
    intent.grounding.subjectSupport.length > 0
      && intent.grounding.subjectSupport.every(support => support.supportingObservationIds.length > 0)
      && intent.grounding.subjectSupport.some(support => support.canonicalSubjectId === intent.steps[0]?.subjectId)
      && intent.grounding.subjectSupport.some(support => support.canonicalSubjectId === intent.finalOracle.subjectId),
    'STEP_SUPPORT_NOT_GROUNDED',
    'Canonical source and final subjects must carry sealed observation support; step-specific observation IDs are not invented.',
  );
}

function checkDefinition(
  caseFixture: M1CertificationCase,
  intent: NormalizedTestIntentV1,
  definition: M1ObservedDefinition,
  appArea: string,
  findings: M1CertificationFinding[],
): void {
  const expectedVersion = caseFixture.expected.definitionSchemaVersion;
  finding(
    findings,
    definition.authority === 'canonical_product',
    definition.authority === 'generated_source'
      ? 'GENERATED_SOURCE_AS_DEFINITION'
      : 'LEGACY_FALLBACK_SATISFIED_CONTRACT',
    'The accepted Definition must be canonical Product authority, not source text or legacy fallback.',
  );
  finding(
    findings,
    definition.schemaVersion === expectedVersion,
    'DEFINITION_VERSION_DRIFT',
    `Expected Definition v${expectedVersion}, observed v${definition.schemaVersion}.`,
  );
  finding(
    findings,
    definition.definitionId.length > 0 && definition.revision > 0,
    'DEFINITION_IDENTITY_MISSING',
    'Definition identity and positive revision are required.',
  );
  finding(
    findings,
    definition.executable && !definition.quarantine,
    'DEFINITION_NOT_EXECUTABLE',
    'An accepted v2/v3 Definition must be executable and not quarantined.',
  );
  finding(
    findings,
    SHA_256.test(definition.fingerprint),
    'DEFINITION_FINGERPRINT_MISSING',
    'Definition must expose an immutable content fingerprint.',
  );
  finding(
    findings,
    sameValue(definition.steps, intent.steps),
    'DEFINITION_STEP_ORDER_DRIFT',
    'Definition steps must preserve normalized intent order exactly.',
  );
  finding(
    findings,
    sameValue(definition.finalOracle, intent.finalOracle),
    'DEFINITION_ORACLE_DROPPED',
    'Definition must retain the evidence-backed final oracle.',
  );
  finding(
    findings,
    sameValue(definition.subjectSupport, intent.grounding.subjectSupport),
    'DEFINITION_PROVENANCE_DROPPED',
    'Definition must retain the intent support observations.',
  );

  if (expectedVersion === 3) {
    finding(
      findings,
      definition.intentId === intent.intentId
        && definition.intentContentHash === intent.intentContentHash
        && definition.normalizedIntent !== null
        && semanticIntentBinding(definition.normalizedIntent, intent),
      'INTENT_SNAPSHOT_NOT_EMBEDDED',
      'Definition v3 must bind the canonical schema, intent identity/hash, app-area identity, ordered actions, oracle, and grounding.',
    );
    finding(
      findings,
      definition.appArea === appArea && definition.appArea === intent.appArea.name,
      'DEFINITION_APP_AREA_DRIFT',
      'Definition v3 must carry the canonical appArea semantic identity unchanged.',
    );
    finding(
      findings,
      definition.legacySemantics === null,
      'V3_MARKED_AS_LEGACY',
      'Definition v3 must not masquerade as navigation-only v2.',
    );
  } else {
    finding(
      findings,
      definition.legacySemantics === 'navigation_only' &&
        definition.steps.length === 1 &&
        definition.steps[0]?.kind === 'navigate_to_observed_route' &&
        definition.intentId === null &&
        definition.normalizedIntent === null,
      'V2_SEMANTICS_REDEFINED',
      'Definition v2 must remain one navigation step and must not be silently upgraded to v3 intent semantics.',
    );
  }
}

function checkPlan(
  caseFixture: M1CertificationCase,
  intent: NormalizedTestIntentV1,
  definition: M1ObservedDefinition,
  plan: M1ObservedPlan,
  appArea: string,
  findings: M1CertificationFinding[],
): void {
  finding(
    findings,
    plan.definitionId === definition.definitionId &&
      plan.definitionRevision === definition.revision &&
      plan.projectId === definition.projectId,
    'PLAN_DEFINITION_IDENTITY_DRIFT',
    'Plan must bind the exact Definition identity, revision, and project.',
  );
  finding(
    findings,
    SHA_256.test(plan.semanticHash),
    'PLAN_HASH_AUTHORITY_MISSING',
    'Plan must expose its existing immutable semantic-hash authority.',
  );
  const expectedSteps = stepSignature(intent.steps);
  const actualSteps = stepSignature(plan.steps);
  finding(
    findings,
    sameValue(actualSteps, expectedSteps),
    actualSteps.length < expectedSteps.length
      ? 'PLAN_STEP_MISSING'
      : actualSteps.length > expectedSteps.length
        ? 'PLAN_STEP_DUPLICATED'
        : 'PLAN_STEP_REORDERED',
    'Plan must preserve every step exactly once and in order.',
  );
  finding(
    findings,
    new Set(plan.steps.map(step => step.stepId)).size === plan.steps.length,
    'PLAN_STEP_DUPLICATED',
    'Plan step identities must be unique.',
  );
  finding(
    findings,
    sameValue(plan.steps, intent.steps),
    'PLAN_STEP_CONTENT_DRIFT',
    'Plan must retain observed route, page/control identities, data-test target, and order.',
  );
  finding(
    findings,
    plan.steps.every(step => (M1_STEP_KINDS as readonly string[]).includes(step.kind)),
    'PLAN_UNSUPPORTED_SEMANTICS',
    'Plan contains a step outside the bounded M1 semantic set.',
  );
  finding(
    findings,
    sameValue(plan.finalOracle, intent.finalOracle),
    'PLAN_ORACLE_DROPPED',
    'Plan must retain the Definition final oracle.',
  );

  if (caseFixture.expected.definitionSchemaVersion === 3) {
    finding(
      findings,
      plan.definitionSchemaVersion === 3 &&
        plan.intentId === intent.intentId &&
        plan.intentContentHash === intent.intentContentHash &&
        plan.appArea === appArea,
      'PLAN_V3_CONTEXT_DRIFT',
      'A v3 plan must carry the canonical intent identity/hash and appArea unchanged.',
    );
  } else {
    finding(
      findings,
      plan.definitionSchemaVersion === 2 && plan.intentId === null
        && plan.intentContentHash === null && plan.appArea === null,
      'V2_PLAN_SEMANTICS_REDEFINED',
      'A v2 plan must retain existing navigation-only semantics without v3 context injection.',
    );
  }
}

function checkExecutionTruth(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  definition: M1ObservedDefinition,
  plan: M1ObservedPlan,
  findings: M1CertificationFinding[],
): void {
  const { execution, run, result } = trace;
  finding(
    findings,
    execution !== null && run !== null && result !== null,
    result !== null ? 'RESULT_WITHOUT_EXECUTION' : 'EXECUTION_CHAIN_INCOMPLETE',
    'Accepted runnable flow must produce distinct Execution, Run, and Result records.',
  );
  if (execution === null || run === null || result === null) {
    return;
  }

  finding(
    findings,
    execution.planId === plan.planId && execution.planSemanticHash === plan.semanticHash,
    'EXECUTION_PLAN_DRIFT',
    'Execution must bind the exact immutable plan identity and semantic hash.',
  );
  finding(
    findings,
    run.executionId === execution.executionId &&
      run.definitionId === definition.definitionId &&
      run.planId === plan.planId,
    'RUN_IDENTITY_DRIFT',
    'Product Run must link the observed Execution, Definition, and plan identities.',
  );
  finding(
    findings,
    result.runId === run.runId &&
      result.executionId === execution.executionId &&
      result.definitionId === definition.definitionId &&
      result.planId === plan.planId,
    'RESULT_IDENTITY_DRIFT',
    'Product Result must link the actual Run and Execution chain.',
  );
  finding(
    findings,
    new Set([
      definition.definitionId,
      plan.planId,
      execution.executionId,
      run.runId,
      result.resultId,
    ]).size === 5,
    'CANONICAL_IDENTITIES_COLLAPSED',
    'Definition, plan, Execution, Run, and Result identities must remain distinct.',
  );
  finding(
    findings,
    result.outcome === caseFixture.expected.resultOutcome &&
      result.businessAssertion === caseFixture.expected.businessAssertion,
    'RESULT_TRUTH_REWRITTEN',
    'Product Result must preserve the expected business assertion truth.',
  );
  finding(
    findings,
    SHA_256.test(result.fingerprint),
    'RESULT_FINGERPRINT_MISSING',
    'Product Result must expose an immutable content fingerprint.',
  );

  if (caseFixture.expected.businessAssertion === 'failed') {
    finding(
      findings,
      execution.infrastructureOutcome === 'completed' &&
        result.outcome === 'failed' &&
        result.reasonCode === 'oracle_failed',
      'ASSERTION_FAILURE_REWRITTEN_AS_INFRA_SUCCESS',
      'Completed infrastructure must not rewrite a failed business assertion as Product success.',
    );
  }
}

function checkUi(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  intent: NormalizedTestIntentV1,
  appArea: string,
  findings: M1CertificationFinding[],
): void {
  const expectedVersion = caseFixture.expected.definitionSchemaVersion;
  finding(
    findings,
    trace.ui.state === caseFixture.expected.uiState && trace.ui.canRun === caseFixture.expected.canRun,
    'UI_REVIEW_STATE_DRIFT',
    'UI must expose the expected generated/review state and Run eligibility.',
  );
  finding(
    findings,
    trace.ui.backendContractVersion === expectedVersion,
    'UI_BACKEND_CONTRACT_DRIFT',
    'UI projection must identify the backend contract version it renders.',
  );
  finding(
    findings,
    sameValue(trace.ui.steps, intent.steps),
    'UI_STEP_ORDER_DRIFT',
    'UI must render backend-ordered steps without reordering or omission.',
  );
  finding(
    findings,
    sameValue(trace.ui.finalOracle, intent.finalOracle),
    'UI_ORACLE_DRIFT',
    'UI must render the backend subject-observable final oracle unchanged.',
  );
  if (expectedVersion === 3) {
    finding(
      findings,
      trace.ui.appArea === appArea,
      'UI_APP_AREA_RECLASSIFIED',
      'UI must display canonical appArea without inferring a replacement.',
    );
  }
}

function checkMutationEvidence(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  findings: M1CertificationFinding[],
): void {
  const targets: Array<'definition' | 'plan' | 'result'> = ['definition', 'plan', 'result'];
  for (const target of targets) {
    if (!caseFixture.attacks.includes(`accept_${target}_mutation`)) {
      continue;
    }
    const observation = trace.mutationObservations.find(entry => entry.target === target);
    finding(
      findings,
      observation !== undefined &&
        observation.refused &&
        observation.beforeFingerprint === observation.afterFingerprint,
      `${target.toUpperCase()}_MUTATION_ACCEPTED`,
      `${target} identity must refuse in-place mutation and retain its fingerprint.`,
    );
  }
}

function checkLegacyV2(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  findings: M1CertificationFinding[],
): void {
  finding(
    findings,
    trace.intent === null,
    'V2_SILENT_INTENT_UPGRADE',
    'Existing v2 execution must not be silently routed through or rewritten as v3 intent semantics.',
  );
  finding(
    findings,
    trace.definition !== null && trace.plan !== null,
    'V2_CANONICAL_PATH_INCOMPLETE',
    'Existing v2 Definition must remain executable through its canonical plan path.',
  );
  if (trace.definition === null || trace.plan === null) {
    return;
  }

  const definition = trace.definition;
  const plan = trace.plan;
  const expectedLegacySteps = fixtureSteps(caseFixture);
  finding(
    findings,
    definition.authority === 'canonical_product' &&
      definition.schemaVersion === 2 &&
      definition.executable &&
      !definition.quarantine &&
      definition.legacySemantics === 'navigation_only' &&
      definition.intentId === null &&
      definition.normalizedIntent === null &&
      definition.appArea === null &&
      definition.intentContentHash === null,
    'V2_SEMANTICS_REDEFINED',
    'Definition v2 must retain existing executable navigation-only meaning with no v3 fields injected.',
  );
  finding(
    findings,
    definition.steps.length === 1 &&
      definition.steps[0]?.kind === 'navigate_to_observed_route' &&
      sameValue(definition.steps, expectedLegacySteps) &&
      sameValue(definition.finalOracle, fixtureOracle(caseFixture)),
    'V2_NAVIGATION_CHANGED',
    'Definition v2 must retain its single navigation behavior unchanged.',
  );
  finding(
    findings,
    plan.definitionSchemaVersion === 2 &&
      plan.definitionId === definition.definitionId &&
      plan.definitionRevision === definition.revision &&
      plan.intentId === null &&
      plan.intentContentHash === null &&
      plan.appArea === null &&
      sameValue(plan.steps, definition.steps) &&
      sameValue(plan.finalOracle, definition.finalOracle) &&
      SHA_256.test(plan.semanticHash),
    'V2_PLAN_SEMANTICS_REDEFINED',
    'Existing v2 plan must remain navigation-only, identity-linked, and executable unchanged.',
  );
  checkExecutionTruth(caseFixture, trace, definition, plan, findings);
  finding(
    findings,
    trace.ui.state === 'generated_review' &&
      trace.ui.canRun &&
      trace.ui.backendContractVersion === 2 &&
      trace.ui.appArea === null &&
      sameValue(trace.ui.steps, definition.steps) &&
      sameValue(trace.ui.finalOracle, definition.finalOracle),
    'V2_UI_COMPATIBILITY_DRIFT',
    'UI contract must continue to render and run existing v2 navigation without inventing v3 context.',
  );
  finding(
    findings,
    sameValue(trace.stages, LEGACY_V2_STAGES),
    'V2_PATH_REWRITTEN',
    'Backward-compatibility evidence must observe the existing Definition-to-Result path without a synthetic v3 stage.',
  );
}

function checkAccepted(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
  findings: M1CertificationFinding[],
): void {
  if (caseFixture.expected.definitionSchemaVersion === 2) {
    checkLegacyV2(caseFixture, trace, findings);
    return;
  }

  finding(
    findings,
    trace.intent?.state === 'accepted',
    'ACCEPTED_INTENT_MISSING',
    'The accepted fixture did not produce a normalized intent.',
  );
  if (trace.intent?.state !== 'accepted') {
    return;
  }

  const appArea = expectedAppArea(caseFixture);
  finding(
    findings,
    appArea !== null,
    'FIXTURE_APP_AREA_NOT_CANONICAL',
    'Accepted fixture must stay within one known App Model app area.',
  );
  if (appArea === null) {
    return;
  }

  const intent = trace.intent.intent;
  checkIntent(caseFixture, intent, appArea, findings);
  finding(
    findings,
    trace.definition !== null && trace.plan !== null,
    'CANONICAL_PATH_INCOMPLETE',
    'Accepted intent must produce canonical Definition and plan.',
  );
  if (trace.definition === null || trace.plan === null) {
    return;
  }

  checkDefinition(caseFixture, intent, trace.definition, appArea, findings);
  checkPlan(caseFixture, intent, trace.definition, trace.plan, appArea, findings);
  checkExecutionTruth(caseFixture, trace, trace.definition, trace.plan, findings);
  checkUi(caseFixture, trace, intent, appArea, findings);
  checkMutationEvidence(caseFixture, trace, findings);
  finding(
    findings,
    sameValue(trace.stages, COMPLETE_STAGES),
    'E2E_STAGE_CHAIN_INCOMPLETE',
    'Observable Product path must include observation through immutable Result with no synthetic shortcut.',
  );
}

export function evaluateM1Trace(
  caseFixture: M1CertificationCase,
  trace: M1ObservableTrace,
): M1CertificationFinding[] {
  const findings: M1CertificationFinding[] = [];
  finding(
    findings,
    trace.scenarioId === caseFixture.caseId,
    'SCENARIO_ID_DRIFT',
    'Driver returned observations for a different scenario identity.',
  );
  checkCompatibility(trace, findings);

  if (caseFixture.expected.disposition === 'refused') {
    checkRefusal(caseFixture, trace, findings);
  } else {
    checkAccepted(caseFixture, trace, findings);
    if (trace.ui.canRun && findings.length > 0) {
      findings.push({
        code: 'INVALID_TEST_RUNNABLE',
        message: 'A contract-invalid generated test must not remain eligible for Run.',
      });
    }
  }

  return findings;
}

export async function certifyM1Case(
  driver: M1CertificationDriver,
  caseFixture: M1CertificationCase,
  options: M1CertificationOptions = {},
): Promise<M1CertificationReport> {
  const requireProductAuthority = options.requireProductAuthority ?? true;
  const findings: M1CertificationFinding[] = [];
  if (requireProductAuthority && driver.authorityClass !== 'product') {
    findings.push({
      code: 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT',
      message: 'Reference harness mechanics are not Product evidence; bind a real observable Product driver.',
    });
  }

  let trace: M1ObservableTrace | null = null;
  try {
    trace = await driver.observe(caseFixture);
    findings.push(...evaluateM1Trace(caseFixture, trace));
  } catch (error) {
    findings.push({
      code: 'DRIVER_OBSERVATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    caseId: caseFixture.caseId,
    driverName: driver.name,
    driverAuthorityClass: driver.authorityClass,
    passed: findings.length === 0,
    findings,
    trace,
  };
}

export function assertM1CertificationPassed(report: M1CertificationReport): void {
  assert.equal(
    report.passed,
    true,
    `${report.caseId} failed certification:\n${report.findings
      .map(entry => `- ${entry.code}: ${entry.message}`)
      .join('\n')}`,
  );
}
