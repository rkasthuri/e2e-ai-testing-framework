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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import Ajv from 'ajv';

const ROOT = path.resolve(__dirname, '..', 'fixtures', 'm4-contract');
const EVIDENCE_VERSION = 'forge.m4.diagnostic-evidence/v1';
const OUTCOME_VERSION = 'forge.m4.diagnostic-outcome/v1';
const CLASSIFIER_VERSION = 'forge.m4.diagnostic-classifier/v1';

type JsonObject = Record<string, any>;
type IntegrityFinding =
  | 'diagnostic_evidence_contradiction'
  | 'diagnostic_authority_binding_invalid'
  | 'diagnostic_historical_authority_substitution';

function load(relativePath: string): JsonObject {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8')) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function applyOperations(value: JsonObject, operations: JsonObject[]): JsonObject {
  const result = clone(value);
  for (const operation of operations) {
    const segments = String(operation.path)
      .slice(1)
      .split('/')
      .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    const key = segments.pop();
    assert.ok(key);
    let parent: JsonObject = result;
    for (const segment of segments) {
      assert.ok(parent[segment] && typeof parent[segment] === 'object');
      parent = parent[segment] as JsonObject;
    }
    if (operation.op === 'remove') delete parent[key];
    else parent[key] = clone(operation.value);
  }
  return result;
}

function materialize(manifest: JsonObject, fixture: JsonObject): {
  evidence: JsonObject;
  expectedAuthority: JsonObject;
} {
  const base = clone(manifest.evidenceBases[fixture.base]) as JsonObject;
  const authority = clone(manifest.authorityTemplates[base.authorityTemplate]) as JsonObject;
  delete base.authorityTemplate;
  return {
    evidence: applyOperations({ schemaVersion: EVIDENCE_VERSION, authority, ...base }, fixture.operations),
    expectedAuthority: clone(manifest.authorityTemplates[base.authorityTemplate] ?? authority),
  };
}

function performed(phase: JsonObject, discriminator: 'outcome' | 'state' = 'outcome'): boolean {
  return !['not_performed', 'not_started'].includes(String(phase[discriminator]));
}

function contradiction(evidence: JsonObject): boolean {
  const downstreamOfExecutor = [evidence.authentication, evidence.navigation, evidence.targetObservation, evidence.action, evidence.oracle];
  if (['failed', 'not_started'].includes(evidence.executor.outcome)
    && downstreamOfExecutor.some((phase, index) => performed(phase, index === 0 ? 'state' : 'outcome'))) return true;

  const authBlocks = ['not_established', 'not_performed'].includes(evidence.authentication.state);
  if (authBlocks && [evidence.navigation, evidence.targetObservation, evidence.action, evidence.oracle].some(phase => performed(phase))) return true;

  if (['not_completed', 'not_performed'].includes(evidence.navigation.outcome)
    && [evidence.targetObservation, evidence.action, evidence.oracle].some(phase => performed(phase))) return true;

  if (['not_observed', 'not_performed'].includes(evidence.targetObservation.outcome)
    && [evidence.action, evidence.oracle].some(phase => performed(phase))) return true;

  if (['not_completed', 'not_performed'].includes(evidence.action.outcome) && performed(evidence.oracle)) return true;
  if (evidence.oracle.outcome === 'matched' && evidence.oracle.expected !== evidence.oracle.actual) return true;
  if (evidence.oracle.outcome === 'mismatched' && evidence.oracle.expected === evidence.oracle.actual) return true;
  return false;
}

function integrityFindings(
  evidence: JsonObject,
  expectedAuthority: JsonObject,
  currentHeadDefinitionAuthority: JsonObject,
): IntegrityFinding[] {
  const findings = new Set<IntegrityFinding>();
  if (contradiction(evidence)) findings.add('diagnostic_evidence_contradiction');

  const accepted = evidence.authority.acceptedDefinitionAuthority;
  const historicalSubstitution = same(accepted, currentHeadDefinitionAuthority)
    && !same(accepted, expectedAuthority.acceptedDefinitionAuthority);
  if (historicalSubstitution) findings.add('diagnostic_historical_authority_substitution');

  const internalDefinitionMismatch = evidence.authority.definitionId !== accepted.definitionId;
  const authorityMismatch = !same(evidence.authority, expectedAuthority);
  const nullResultWithoutProductBasis = evidence.authority.resultId === null && expectedAuthority.resultId !== null;
  if (internalDefinitionMismatch || nullResultWithoutProductBasis || (authorityMismatch && !historicalSubstitution)) {
    findings.add('diagnostic_authority_binding_invalid');
  }
  return [...findings].sort();
}

function common(evidence: JsonObject): JsonObject {
  return {
    schemaVersion: OUTCOME_VERSION,
    evidenceSchemaVersion: EVIDENCE_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    evidenceHash: createHash('sha256').update(canonical(evidence)).digest('hex'),
  };
}

function classify(
  evidence: JsonObject,
  expectedAuthority: JsonObject,
  currentHeadDefinitionAuthority: JsonObject,
): JsonObject {
  const findings = integrityFindings(evidence, expectedAuthority, currentHeadDefinitionAuthority);
  if (findings.length > 0) {
    return {
      ...common(evidence), kind: 'refusal', refusalCode: 'integrity_invalid', integrityFindings: findings,
      explanationCode: 'diagnostic_integrity_validation_failed', explanationParameters: {},
    };
  }
  if (evidence.executor.outcome === 'failed') {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'executor_failure',
      explanationCode: 'executor_failed_before_completion',
      explanationParameters: { failureClass: evidence.executor.failureClass },
    };
  }
  if (evidence.authentication.state === 'not_established' && evidence.authentication.attemptOccurred === true) {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'authentication_not_established',
      explanationCode: 'authentication_attempt_not_established', explanationParameters: {},
    };
  }
  const authEstablished = ['established', 'not_required'].includes(evidence.authentication.state);
  if (authEstablished && evidence.navigation.outcome === 'not_completed') {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'navigation_not_completed',
      explanationCode: 'governed_navigation_not_completed',
      explanationParameters: {
        failureClass: evidence.navigation.failureClass,
        expectedRoute: evidence.navigation.intendedRoute,
        actualRoute: evidence.navigation.observedRoute,
      },
    };
  }
  if (authEstablished && evidence.navigation.outcome === 'completed'
    && evidence.targetObservation.outcome === 'not_observed'
    && evidence.action.outcome === 'not_performed' && evidence.oracle.outcome === 'not_performed') {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'target_not_observed',
      explanationCode: 'governed_target_not_observed',
      explanationParameters: {
        subjectId: evidence.targetObservation.targetAuthority.subjectId,
        elementId: evidence.targetObservation.targetAuthority.elementId,
        observedCardinality: evidence.targetObservation.cardinality,
      },
    };
  }
  if (authEstablished && evidence.navigation.outcome === 'completed'
    && evidence.targetObservation.outcome === 'observed'
    && evidence.action.outcome === 'not_completed' && evidence.action.interactionAttempted === true
    && evidence.oracle.outcome === 'not_performed') {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'action_not_completed',
      explanationCode: 'governed_action_not_completed',
      explanationParameters: {
        subjectId: evidence.targetObservation.targetAuthority.subjectId,
        elementId: evidence.targetObservation.targetAuthority.elementId,
        failureClass: evidence.action.failureClass,
      },
    };
  }
  if (evidence.executor.outcome === 'completed' && authEstablished
    && evidence.navigation.outcome === 'completed' && evidence.targetObservation.outcome === 'observed'
    && evidence.action.outcome === 'completed' && evidence.oracle.outcome === 'mismatched'
    && evidence.oracle.expected !== evidence.oracle.actual) {
    return {
      ...common(evidence), kind: 'classified_failure', failureMode: 'oracle_mismatch',
      explanationCode: 'governed_oracle_mismatch',
      explanationParameters: {
        subjectId: evidence.oracle.oracleAuthority.subjectId,
        expectedRoute: evidence.oracle.expected,
        actualRoute: evidence.oracle.actual,
      },
    };
  }
  return {
    ...common(evidence), kind: 'refusal', refusalCode: 'insufficient_evidence',
    explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {},
  };
}

function present(outcome: JsonObject): string {
  const parameters = outcome.explanationParameters as JsonObject;
  switch (outcome.explanationCode) {
    case 'executor_failed_before_completion':
      return `The executor did not complete (${parameters.failureClass}).`;
    case 'authentication_attempt_not_established':
      return 'An authentication attempt occurred, but authentication was not established.';
    case 'governed_navigation_not_completed':
      return `Navigation to ${parameters.expectedRoute} did not complete; observed route: ${parameters.actualRoute ?? 'none'} (${parameters.failureClass}).`;
    case 'governed_target_not_observed':
      return `Governed target ${parameters.subjectId}/${parameters.elementId} was observed with cardinality ${parameters.observedCardinality}.`;
    case 'governed_action_not_completed':
      return `The governed action on ${parameters.subjectId}/${parameters.elementId} did not complete (${parameters.failureClass}).`;
    case 'governed_oracle_mismatch':
      return `For ${parameters.subjectId}, expected ${parameters.expectedRoute}; observed ${parameters.actualRoute}.`;
    case 'diagnostic_predicates_not_satisfied':
      return 'The available diagnostic evidence does not satisfy a classified-failure predicate.';
    case 'diagnostic_integrity_validation_failed':
      return 'Diagnostic evidence did not pass integrity validation.';
    default:
      throw new Error(`Unsupported explanation code: ${String(outcome.explanationCode)}`);
  }
}

describe('M4 physical evidence contract candidate', () => {
  const manifest = load('manifest.json');
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateEvidence = ajv.compile(load(manifest.evidenceSchema));
  const validateOutcome = ajv.compile(load(manifest.outcomeSchema));
  const validateFixture = ajv.compile(load(manifest.fixtureCaseSchema));
  const fixturePaths = [...manifest.cases, ...manifest.hostile] as string[];

  test('the pack contains eight semantic cases and eighteen hostile cases under one closed fixture schema', () => {
    assert.equal(manifest.cases.length, 8);
    assert.equal(manifest.hostile.length, 18);
    for (const fixturePath of fixturePaths) {
      const fixture = load(fixturePath);
      assert.equal(validateFixture(fixture), true, `${fixturePath}: ${JSON.stringify(validateFixture.errors)}`);
    }
  });

  test('all materialized cases enforce schema, authority, precedence, exclusions, and mandatory fallback', () => {
    const results: JsonObject[] = [];
    for (const fixturePath of fixturePaths) {
      const fixture = load(fixturePath);
      const { evidence, expectedAuthority } = materialize(manifest, fixture);
      const evidenceValid = validateEvidence(evidence);
      if (fixture.expected.stage === 'evidence_schema_rejected') {
        assert.equal(evidenceValid, false, fixturePath);
        results.push({ fixturePath, stage: fixture.expected.stage });
        continue;
      }
      assert.equal(evidenceValid, true, `${fixturePath}: ${JSON.stringify(validateEvidence.errors)}`);
      if (fixture.expected.stage === 'outcome_schema_rejected') {
        assert.equal(validateOutcome(fixture.assertedOutcome), false, fixturePath);
        results.push({ fixturePath, stage: fixture.expected.stage });
        continue;
      }
      const outcome = classify(evidence, expectedAuthority, manifest.currentHeadDefinitionAuthority);
      assert.equal(validateOutcome(outcome), true, `${fixturePath}: ${JSON.stringify(validateOutcome.errors)}`);
      assert.equal(outcome.kind, fixture.expected.kind, fixturePath);
      assert.equal(outcome.failureMode ?? outcome.refusalCode, fixture.expected.code, fixturePath);
      results.push({ fixturePath, stage: fixture.expected.stage, code: fixture.expected.code });
    }
    assert.equal(results.length, 26);
  });

  test('runId is mandatory and exact even when resultId is legitimately absent', () => {
    for (const authority of Object.values(manifest.authorityTemplates) as JsonObject[]) {
      assert.equal(typeof authority.runId, 'string');
      assert.ok(authority.runId.length > 0);
      assert.equal(authority.definitionId, authority.acceptedDefinitionAuthority.definitionId);
    }
    assert.equal(manifest.authorityTemplates.absent_result.resultId, null);
    assert.equal(manifest.authorityTemplates.absent_result.runId, 'run-product-owned-no-result');
    const floated = load('hostile/floated-run-authority.json');
    const materialized = materialize(manifest, floated);
    const outcome = classify(materialized.evidence, materialized.expectedAuthority, manifest.currentHeadDefinitionAuthority);
    assert.equal(outcome.refusalCode, 'integrity_invalid');
    assert.deepEqual(outcome.integrityFindings, ['diagnostic_authority_binding_invalid']);
  });

  test('current-head Definition substitution is distinguishable from an ordinary floated binding', () => {
    const fixture = load('hostile/historical-current-head-leakage.json');
    const materialized = materialize(manifest, fixture);
    const outcome = classify(materialized.evidence, materialized.expectedAuthority, manifest.currentHeadDefinitionAuthority);
    assert.deepEqual(outcome.integrityFindings, ['diagnostic_historical_authority_substitution']);
  });

  test('outcome vocabulary has two branches, no contradiction classification, confidence, LLM, or root-cause aliases', () => {
    const serialized = JSON.stringify(load(manifest.outcomeSchema));
    for (const forbidden of ['"explanation"', 'contradictory_evidence', 'confidence', 'llm', 'selector_drift', 'bad_credentials', 'app-bug', 'test-defect', 'flaky', 'rootcause']) {
      assert.equal(serialized.toLowerCase().includes(forbidden), false, forbidden);
    }
    assert.ok(serialized.includes('classified_failure'));
    assert.ok(serialized.includes('refusal'));
    assert.ok(serialized.includes('diagnostic_evidence_contradiction'));
  });

  test('canonical outcomes carry only the exact code and bounded parameters for their mode', () => {
    const expectedByBase: Record<string, JsonObject> = {
      executor_failure: { explanationCode: 'executor_failed_before_completion', explanationParameters: { failureClass: 'browser_session_unavailable' } },
      authentication_not_established: { explanationCode: 'authentication_attempt_not_established', explanationParameters: {} },
      navigation_not_completed: { explanationCode: 'governed_navigation_not_completed', explanationParameters: { failureClass: 'destination_unavailable', expectedRoute: '/cart.html', actualRoute: null } },
      target_not_observed: { explanationCode: 'governed_target_not_observed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', observedCardinality: 'zero' } },
      action_not_completed: { explanationCode: 'governed_action_not_completed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', failureClass: 'target_not_actionable' } },
      oracle_mismatch: { explanationCode: 'governed_oracle_mismatch', explanationParameters: { subjectId: 'subject-checkout', expectedRoute: '/checkout-step-one.html', actualRoute: '/wrong.html' } },
      insufficient_evidence: { explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {} },
    };
    for (const [base, expected] of Object.entries(expectedByBase)) {
      const fixture = { base, operations: [] };
      const materialized = materialize(manifest, fixture);
      const outcome = classify(materialized.evidence, materialized.expectedAuthority, manifest.currentHeadDefinitionAuthority);
      assert.equal(validateOutcome(outcome), true, `${base}: ${JSON.stringify(validateOutcome.errors)}`);
      assert.deepEqual(
        { explanationCode: outcome.explanationCode, explanationParameters: outcome.explanationParameters },
        expected,
        base,
      );
      assert.equal(Object.hasOwn(outcome, 'explanation'), false, base);
    }
  });

  test('the deterministic presenter derives truthful text from code and bounded parameters only', () => {
    const fixture = load('cases/oracle-mismatch.json');
    const materialized = materialize(manifest, fixture);
    const outcome = classify(materialized.evidence, materialized.expectedAuthority, manifest.currentHeadDefinitionAuthority);
    assert.equal(validateOutcome(outcome), true, JSON.stringify(validateOutcome.errors));
    assert.equal(
      present(outcome),
      'For subject-checkout, expected /checkout-step-one.html; observed /wrong.html.',
    );
    assert.equal(Object.hasOwn(outcome, 'explanation'), false);
  });

  test('the replay map keeps six full-browser Product cases distinct from two controlled failures', () => {
    assert.equal(manifest.corpus.length, 8);
    assert.equal(manifest.corpus.filter((item: JsonObject) => item.pathKind === 'full_browser_real_product').length, 6);
    assert.equal(manifest.corpus.filter((item: JsonObject) => item.pathKind === 'controlled_executor_session_failure').length, 1);
    assert.equal(manifest.corpus.filter((item: JsonObject) => item.pathKind === 'controlled_unstructured_adapter_failure').length, 1);
    assert.deepEqual(
      manifest.corpus.slice(1).map((item: JsonObject) => item.contractMapping),
      ['oracle_mismatch', 'target_not_observed', 'action_not_completed', 'navigation_not_completed', 'authentication_not_established', 'executor_failure', 'insufficient_evidence'],
    );
  });

  test('history and Insights freeze recomputation, version partitioning, and no current-head joins', () => {
    assert.deepEqual(manifest.authorityModel, {
      diagnosticEvidence: 'append_only_versioned',
      classification: 'deterministic_version_pinned_recomputable_read_model',
      persistedClassificationRecord: 'not_frozen',
      optionalDisposableCacheKey: ['evidenceHash', 'classifierVersion'],
    });
    assert.deepEqual(manifest.historyAndInsightsRules, {
      groupBy: ['evidenceSchemaVersion', 'classifierVersion'],
      dimensions: ['classified_failure', 'insufficient_evidence', 'integrity_invalid'],
      historicalAuthorityLookup: 'accepted_snapshot_only',
      currentHeadJoinAllowed: false,
    });
    assert.deepEqual(manifest.presentationModel, {
      authoritativeOutcomeFields: ['failureMode_or_refusalCode', 'explanationCode', 'explanationParameters', 'integrityFindings_when_applicable'],
      persistedFreeFormExplanation: false,
      optionalDisplayString: {
        authority: 'derived_non_authoritative',
        producer: 'same_version_pinned_classifier_presenter',
        reproducibleFrom: ['explanationCode', 'explanationParameters'],
        transportRule: 'may_cross_transport_only_as_derived_non_authoritative',
      },
    });
    assert.deepEqual(manifest.suiteAuthorityGate, {
      status: 'mandatory_before_writer_integration',
      contractFreezeImpact: 'non_blocking_pre_writer_proof_gate',
      requirements: [
        'real_suite_originated_product_execution',
        'derive_suite_authority_from_accepted_execution_only',
        'exact_results_round_trip_binding',
        'reject_floated_suite_id_revision_or_content_hash',
        'reject_current_head_suite_substitution',
        'reject_suite_authority_on_direct_definition_execution',
      ],
    });
  });
});
