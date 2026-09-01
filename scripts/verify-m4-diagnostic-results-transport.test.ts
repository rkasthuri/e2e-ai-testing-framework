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

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  CanonicalResultsContractError,
  decodeCanonicalExecutionResultsDetail,
  serializeCanonicalExecutionResultsRead,
  type CanonicalDiagnosticOutcome,
} from '../forge-ui/src/api/resultsContract'
import { readExecutionResults } from '../forge-ui/server/context/ExecutionResultsController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const PROJECT = 'project-m4'
const EXECUTION = 'execution-m4'
const RUN = 'run-m4'
const HASH = 'a'.repeat(64)
const TIME = '2026-08-30T12:00:00.000Z'
const LATER = '2026-08-30T12:00:01.000Z'
const common = {
  schemaVersion: 'forge.m4.diagnostic-outcome/v1' as const,
  evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1' as const,
  classifierVersion: 'forge.m4.diagnostic-classifier/v1' as const,
  evidenceHash: HASH,
}

const outcomes: CanonicalDiagnosticOutcome[] = [
  { ...common, kind: 'classified_failure', failureMode: 'executor_failure', explanationCode: 'executor_failed_before_completion', explanationParameters: { failureClass: 'browser_session_unavailable' } },
  { ...common, kind: 'classified_failure', failureMode: 'authentication_not_established', explanationCode: 'authentication_attempt_not_established', explanationParameters: {} },
  { ...common, kind: 'classified_failure', failureMode: 'navigation_not_completed', explanationCode: 'governed_navigation_not_completed', explanationParameters: { failureClass: 'destination_unavailable', expectedRoute: '/cart.html', actualRoute: null } },
  { ...common, kind: 'classified_failure', failureMode: 'target_not_observed', explanationCode: 'governed_target_not_observed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', observedCardinality: 'zero' } },
  { ...common, kind: 'classified_failure', failureMode: 'action_not_completed', explanationCode: 'governed_action_not_completed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', failureClass: 'target_not_actionable' } },
  { ...common, kind: 'classified_failure', failureMode: 'oracle_mismatch', explanationCode: 'governed_oracle_mismatch', explanationParameters: { subjectId: 'subject-checkout', expectedRoute: '/checkout-step-one.html', actualRoute: '/wrong.html' } },
  { ...common, kind: 'refusal', refusalCode: 'insufficient_evidence', explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {} },
  { ...common, kind: 'refusal', refusalCode: 'integrity_invalid', integrityFindings: ['diagnostic_evidence_contradiction'], explanationCode: 'diagnostic_integrity_validation_failed', explanationParameters: {} },
]

function diagnostic(outcome: CanonicalDiagnosticOutcome, displayString = 'Derived diagnostic display.') {
  return {
    state: 'available',
    identity: { projectId: PROJECT, executionId: EXECUTION, runId: RUN, itemOrdinal: 1, evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1' },
    evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1', evidenceHash: HASH,
    classifierVersion: 'forge.m4.diagnostic-classifier/v1', outcome, displayString,
  }
}

function detail(diagnosticValue: unknown, authority: unknown = {
  schemaVersion: 3, testSetId: 'test-set-m4', revision: 7, modelRowId: 12, modelVersion: '12.0',
  supportSealHash: 'b'.repeat(64), routeEvidenceIdentityHash: 'c'.repeat(64),
  authenticationExpectationIdentityHash: 'd'.repeat(64),
}) {
  return {
    kind: 'canonical_execution_results', evidenceHeadlineOutcome: 'failed',
    execution: {
      executionId: EXECUTION, lifecycle: 'completed', terminalOutcome: 'failed', authorityReasonCode: 'oracle_failed',
      acceptedAt: TIME, terminalAt: LATER, expectedResultCount: 1, definitionAuthority: authority,
    },
    run: {
      runId: RUN, lifecycle: 'completed', evidenceOutcome: 'failed', evidenceReasonCode: 'oracle_failed',
      startedAt: TIME, terminalAt: LATER, expectedResultCount: 1, observedResultCount: 1,
      evidenceCounts: { passed: 0, failed: 1, couldNotVerify: 0, missing: 0 },
    },
    items: [{
      manifestOrdinal: 1, definitionId: 'definition-m4', executablePlanHash: HASH,
      evidence: { kind: 'observed_result', resultId: 'result-m4', outcome: 'failed', reasonCode: 'oracle_failed', safeMessage: null, durationMs: 10, oracleKind: null, observedSubjectId: null },
      diagnostic: diagnosticValue,
    }],
    integrityWarnings: [],
  }
}

function coreRead(diagnosticValue: unknown, authority: unknown = {
  schemaVersion: 3, testSetId: 'test-set-m4', revision: 7, modelRowId: 12, modelVersion: '12.0',
  supportSealHash: 'b'.repeat(64), routeEvidenceIdentityHash: 'c'.repeat(64),
  authenticationExpectationIdentityHash: 'd'.repeat(64),
}) {
  return {
    kind: 'ok', projection: {
      availability: 'available', headlineOutcome: 'failed',
      execution: {
        executionId: EXECUTION, lifecycle: 'completed', outcome: 'failed', reasonCode: 'oracle_failed', acceptedAt: TIME,
        terminalAt: LATER, manifestCount: 1, definitionAuthority: authority,
      },
      run: {
        runId: RUN, lifecycle: 'completed', outcome: 'failed', reasonCode: 'oracle_failed', startedAt: TIME,
        terminalAt: LATER, expectedResultCount: 1, observedResultCount: 1,
        aggregateCounts: { passed: 0, failed: 1, couldNotVerify: 0 },
      },
      items: [{
        itemOrdinal: 1, definitionId: 'definition-m4', executablePlanHash: HASH,
        result: { state: 'result_observed', resultId: 'result-m4', outcome: 'failed', reasonCode: 'oracle_failed', safeMessage: null, durationMs: 10, oracleKind: null, observedSubjectId: null },
        diagnostic: diagnosticValue,
      }],
      integrityWarnings: [],
    },
  }
}

test('M4 Chunk 3 positive transport matrix preserves every deterministic outcome exactly', () => {
  for (const outcome of outcomes) {
    const decoded = decodeCanonicalExecutionResultsDetail(detail(diagnostic(outcome)), PROJECT)
    const transported = decoded.items[0]!.diagnostic
    assert.equal(transported?.state, 'available')
    if (transported?.state !== 'available') continue
    assert.deepEqual(transported.outcome, outcome)
    assert.equal(transported.evidenceHash, HASH)
    assert.equal(transported.evidenceSchemaVersion, 'forge.m4.diagnostic-evidence/v1')
    assert.equal(transported.classifierVersion, 'forge.m4.diagnostic-classifier/v1')
    assert.deepEqual(transported.identity, {
      projectId: PROJECT,
      executionId: EXECUTION,
      runId: RUN,
      itemOrdinal: 1,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
    })
  }
})

test('M4 Chunk 3 hard-failure envelopes remain bounded and contain no raw failure detail', () => {
  for (const reason of ['not_found', 'unreadable', 'unsupported_classifier_version'] as const) {
    const unavailable = { state: 'unavailable', reason, identity: { projectId: PROJECT, executionId: EXECUTION, runId: RUN, itemOrdinal: 1, evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1' } }
    const decoded = decodeCanonicalExecutionResultsDetail(detail(unavailable), PROJECT)
    assert.deepEqual(decoded.items[0]!.diagnostic, unavailable)
    assert.equal(JSON.stringify(decoded.items[0]!.diagnostic).includes('stack'), false)
    assert.throws(() => decodeCanonicalExecutionResultsDetail(detail({ ...unavailable, message: 'SQLITE_CORRUPT raw storage detail' }), PROJECT), CanonicalResultsContractError)
  }
})

test('M4 Chunk 3 decoder rejects identity substitution, malformed output, legacy triage, causal and extra fields', () => {
  const oracle = diagnostic(outcomes[5]!)
  const attacks = [
    { ...oracle, identity: { ...oracle.identity, projectId: 'other-project' } },
    { ...oracle, identity: { ...oracle.identity, executionId: 'other-execution' } },
    { ...oracle, identity: { ...oracle.identity, runId: 'other-run' } },
    { ...oracle, identity: { ...oracle.identity, itemOrdinal: 2 } },
    { ...oracle, evidenceHash: 'e'.repeat(64) },
    { ...oracle, outcome: { ...outcomes[5]!, legacyTriage: 'app-bug' } },
    { ...oracle, outcome: { ...outcomes[5]!, confidence: 0.99 } },
    { ...oracle, outcome: { ...outcomes[5]!, rootCause: 'selector drift' } },
    { ...oracle, outcome: { ...outcomes[5]!, explanationCode: 'diagnostic_predicates_not_satisfied' } },
    { ...oracle, prebuiltAuthority: outcomes[5] },
  ]
  for (const attack of attacks) assert.throws(() => decodeCanonicalExecutionResultsDetail(detail(attack), PROJECT), CanonicalResultsContractError)
})

test('M4 Chunk 3 displayString is derived non-authority and mutation cannot alter authoritative fields', () => {
  const first = decodeCanonicalExecutionResultsDetail(detail(diagnostic(outcomes[5]!, 'Original display.')), PROJECT).items[0]!.diagnostic
  const second = decodeCanonicalExecutionResultsDetail(detail(diagnostic(outcomes[5]!, 'Mutated display.')), PROJECT).items[0]!.diagnostic
  assert.equal(first?.state, 'available')
  assert.equal(second?.state, 'available')
  if (first?.state === 'available' && second?.state === 'available') {
    assert.notEqual(first.displayString, second.displayString)
    assert.deepEqual(first.outcome, second.outcome)
    assert.deepEqual(first.identity, second.identity)
    assert.equal(first.evidenceHash, second.evidenceHash)
  }
})

test('M4 Chunk 3 core adapter preserves Suite v2 per-item boundary and rejects unknown diagnostic output', () => {
  const serialized = serializeCanonicalExecutionResultsRead(coreRead(diagnostic(outcomes[0]!), { scope: 'per_item' }), PROJECT)
  assert.equal(serialized.kind, 'ok')
  if (serialized.kind === 'ok') {
    assert.deepEqual(serialized.projection.execution.definitionAuthority, { scope: 'per_item' })
    assert.deepEqual(serialized.projection.items[0]!.diagnostic?.state, 'available')
  }
  assert.throws(() => serializeCanonicalExecutionResultsRead(coreRead({ ...diagnostic(outcomes[0]!), unknown: true }), PROJECT), CanonicalResultsContractError)
})

test('M4 Chunk 3 project-scoped controller transports diagnostics and rejects malformed core output', async () => {
  const original = executionContext.readProductExecutionResults.bind(executionContext)
  const project = async () => ({ appName: PROJECT, url: 'https://example.invalid' })
  try {
    ;(executionContext as unknown as { readProductExecutionResults: typeof original }).readProductExecutionResults = async () => coreRead(diagnostic(outcomes[5]!))
    const accepted = await readExecutionResults(PROJECT, EXECUTION, project)
    assert.equal(accepted.status, 200)
    assert.equal(JSON.stringify(accepted.body).includes('oracle_mismatch'), true)
    ;(executionContext as unknown as { readProductExecutionResults: typeof original }).readProductExecutionResults = async () => coreRead({ ...diagnostic(outcomes[5]!), rawError: 'do not leak' })
    const rejected = await readExecutionResults(PROJECT, EXECUTION, project)
    assert.equal(rejected.status, 503)
    assert.equal(JSON.stringify(rejected.body).includes('do not leak'), false)
  } finally {
    ;(executionContext as unknown as { readProductExecutionResults: typeof original }).readProductExecutionResults = original
  }
})

test('M4 Chunk 3 source boundary stays project-scoped, GET-only, service-owned, and free of legacy authority', () => {
  const controller = fs.readFileSync(path.resolve('forge-ui/server/context/ExecutionResultsController.ts'), 'utf8')
  const routes = fs.readFileSync(path.resolve('forge-ui/server/routes/projects.ts'), 'utf8')
  const projection = fs.readFileSync(path.resolve('src/core/execution/ExecutionResultProjectionService.ts'), 'utf8')
  const client = fs.readFileSync(path.resolve('forge-ui/src/api/resultsClient.ts'), 'utf8')
  assert.match(routes, /router\.get\('\/:appName\/executions\/:executionId\/results'/)
  assert.doesNotMatch(routes, /router\.post\('\/:appName\/executions\/:executionId\/results'/)
  assert.match(projection, /DiagnosticClassificationService/)
  for (const field of ['projectId', 'executionId', 'runId', 'itemOrdinal', 'evidenceSchemaVersion', 'evidenceHash', 'classifierVersion']) {
    assert.match(projection, new RegExp(field))
  }
  assert.doesNotMatch(`${controller}\n${client}`, /\/api\/v1\/(?:results|runs)(?:\/|['"`])/)
  assert.doesNotMatch(`${controller}\n${client}`, /legacyTriage|app-bug|test-defect|rootCause|confidence/)
  assert.doesNotMatch(controller, /req\.body|classification|classifyDiagnosticEvidence/)
})
