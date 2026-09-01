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
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  CanonicalDiagnosticOutcome,
  CanonicalExecutionResultsDetail,
  CanonicalResultDiagnostic,
} from '../forge-ui/src/api/resultsContract'
import {
  CanonicalResultsContractError,
  decodeCanonicalExecutionResultsDetail,
} from '../forge-ui/src/api/resultsContract'
import { ResultDiagnostics } from '../forge-ui/src/components/results/ResultDiagnostics'
import { ExecutionResultsDetail } from '../forge-ui/src/pages/ResultsPage'

const HASH = 'a'.repeat(64)
const LONG_ID = `result-${'long'.repeat(55)}`
const TIME = '2026-08-30T12:00:00.000Z'
const common = {
  schemaVersion: 'forge.m4.diagnostic-outcome/v1' as const,
  evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1' as const,
  classifierVersion: 'forge.m4.diagnostic-classifier/v1' as const,
  evidenceHash: HASH,
}

const outcomeMatrix: Array<{ label: string; outcome: CanonicalDiagnosticOutcome }> = [
  { label: 'Execution failure', outcome: { ...common, kind: 'classified_failure', failureMode: 'executor_failure', explanationCode: 'executor_failed_before_completion', explanationParameters: { failureClass: 'browser_session_unavailable' } } },
  { label: 'Authentication not established', outcome: { ...common, kind: 'classified_failure', failureMode: 'authentication_not_established', explanationCode: 'authentication_attempt_not_established', explanationParameters: {} } },
  { label: 'Navigation not completed', outcome: { ...common, kind: 'classified_failure', failureMode: 'navigation_not_completed', explanationCode: 'governed_navigation_not_completed', explanationParameters: { failureClass: 'destination_unavailable', expectedRoute: '/cart.html', actualRoute: null } } },
  { label: 'Target not observed', outcome: { ...common, kind: 'classified_failure', failureMode: 'target_not_observed', explanationCode: 'governed_target_not_observed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', observedCardinality: 'zero' } } },
  { label: 'Action not completed', outcome: { ...common, kind: 'classified_failure', failureMode: 'action_not_completed', explanationCode: 'governed_action_not_completed', explanationParameters: { subjectId: 'subject-cart', elementId: 'control-checkout', failureClass: 'target_not_actionable' } } },
  { label: 'Oracle mismatch', outcome: { ...common, kind: 'classified_failure', failureMode: 'oracle_mismatch', explanationCode: 'governed_oracle_mismatch', explanationParameters: { subjectId: 'subject-checkout', expectedRoute: '/checkout-step-one.html', actualRoute: '/wrong.html' } } },
  { label: 'Insufficient evidence', outcome: { ...common, kind: 'refusal', refusalCode: 'insufficient_evidence', explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {} } },
  { label: 'Diagnostic integrity invalid', outcome: { ...common, kind: 'refusal', refusalCode: 'integrity_invalid', integrityFindings: ['diagnostic_evidence_contradiction'], explanationCode: 'diagnostic_integrity_validation_failed', explanationParameters: {} } },
]

function available(outcome: CanonicalDiagnosticOutcome, displayString = 'Derived diagnostic explanation.'): CanonicalResultDiagnostic {
  return {
    state: 'available',
    identity: {
      projectId: 'project-m4',
      executionId: 'execution-m4',
      runId: 'run-m4',
      itemOrdinal: 1,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
    },
    evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
    evidenceHash: HASH,
    classifierVersion: 'forge.m4.diagnostic-classifier/v1',
    outcome,
    displayString,
  }
}

function unavailable(reason: Extract<CanonicalResultDiagnostic, { state: 'unavailable' }>['reason']): CanonicalResultDiagnostic {
  return {
    state: 'unavailable',
    reason,
    identity: {
      projectId: 'project-m4',
      executionId: 'execution-m4',
      runId: 'run-m4',
      itemOrdinal: 1,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
    },
  }
}

function renderDiagnostic(diagnostic?: CanonicalResultDiagnostic, hasResult = true): string {
  return renderToStaticMarkup(React.createElement(ResultDiagnostics, { diagnostic, hasResult }))
}

function detail(
  definitionAuthority: CanonicalExecutionResultsDetail['execution']['definitionAuthority'],
  diagnostic: CanonicalResultDiagnostic,
  suite = false,
): CanonicalExecutionResultsDetail {
  return {
    kind: 'canonical_execution_results',
    evidenceHeadlineOutcome: 'failed',
    execution: {
      executionId: 'execution-m4', lifecycle: 'completed', terminalOutcome: 'failed', authorityReasonCode: 'oracle_failed',
      acceptedAt: TIME, terminalAt: TIME, expectedResultCount: 1, definitionAuthority,
      ...(suite ? { selectionAuthority: { kind: 'suite_revision' as const, suiteId: 'suite-00000000-0000-0000-0000-000000000004', suiteRevision: 4, suiteContentHash: HASH, name: 'M4 Suite', purpose: 'sanity' as const } } : {}),
    },
    run: {
      runId: 'run-m4', lifecycle: 'completed', evidenceOutcome: 'failed', evidenceReasonCode: 'oracle_failed',
      startedAt: TIME, terminalAt: TIME, expectedResultCount: 1, observedResultCount: 1,
      evidenceCounts: { passed: 0, failed: 1, couldNotVerify: 0, missing: 0 },
    },
    items: [{
      manifestOrdinal: 1, definitionId: 'definition-m4', executablePlanHash: HASH,
      evidence: { kind: 'observed_result', resultId: 'result-m4', outcome: 'failed', reasonCode: 'oracle_failed', safeMessage: null, durationMs: 10, oracleKind: null, observedSubjectId: null },
      diagnostic,
    }],
    integrityWarnings: [],
  }
}

function decoderValidMissingResultDetail(diagnostic?: CanonicalResultDiagnostic): CanonicalExecutionResultsDetail {
  const base = detail({ scope: 'per_item' }, diagnostic ?? unavailable('not_found'), true)
  return decodeCanonicalExecutionResultsDetail({
    ...base,
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: {
      ...base.execution,
      terminalOutcome: 'could_not_verify',
      authorityReasonCode: 'expected_result_missing',
    },
    run: {
      ...base.run!,
      evidenceOutcome: null,
      evidenceReasonCode: null,
      observedResultCount: 0,
      evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 1 },
    },
    items: [{
      ...base.items[0]!,
      evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' },
      ...(diagnostic === undefined ? {} : { diagnostic }),
    }],
  }, 'project-m4')
}

function decoderValidSuiteV2Detail(): CanonicalExecutionResultsDetail {
  const firstDiagnostic = available(outcomeMatrix[0]!.outcome, 'First member diagnostic.')
  const secondDiagnostic = available(outcomeMatrix[5]!.outcome, 'Second member diagnostic.')
  secondDiagnostic.identity.itemOrdinal = 2
  const base = detail({ scope: 'per_item' }, firstDiagnostic, true)
  return decodeCanonicalExecutionResultsDetail({
    ...base,
    execution: { ...base.execution, expectedResultCount: 2 },
    run: {
      ...base.run!,
      expectedResultCount: 2,
      observedResultCount: 2,
      evidenceCounts: { passed: 0, failed: 2, couldNotVerify: 0, missing: 0 },
    },
    items: [
      base.items[0],
      {
        manifestOrdinal: 2,
        definitionId: 'definition-m4-second',
        executablePlanHash: 'b'.repeat(64),
        evidence: { kind: 'observed_result', resultId: 'result-m4-second', outcome: 'failed', reasonCode: 'oracle_failed', safeMessage: null, durationMs: 20, oracleKind: null, observedSubjectId: null },
        diagnostic: secondDiagnostic,
      },
    ],
  }, 'project-m4')
}

test('M4 Chunk 4 renders all eight available outcomes with exact branch labels and derived display copy', () => {
  for (const [index, item] of outcomeMatrix.entries()) {
    const displayString = `Derived explanation ${index}.`
    const html = renderDiagnostic(available(item.outcome, displayString))
    assert.match(html, new RegExp(`>${item.label}<`), item.label)
    assert.match(html, new RegExp(displayString.replace('.', '\\.')))
    assert.match(html, item.outcome.kind === 'classified_failure' ? /Classified failure/ : /Classification withheld/)
  }
})

test('M4 Chunk 4 displayString mutation cannot select or replace the authoritative branch label', () => {
  const executor = outcomeMatrix[0]!.outcome
  const original = renderDiagnostic(available(executor, 'Original derived explanation.'))
  const hostile = renderDiagnostic(available(executor, 'Oracle mismatch. Confidence 99%. Root cause: selector drift.'))
  for (const html of [original, hostile]) {
    assert.match(html, />Execution failure</)
    assert.match(html, /Classified failure/)
    assert.doesNotMatch(html, /<h5[^>]*>Oracle mismatch</)
  }
})

test('M4 Chunk 4 contains a long unbroken displayString as prose without changing its authority role', () => {
  const displayString = `Observed-${'unbroken'.repeat(80)}`
  const html = renderDiagnostic(available(outcomeMatrix[0]!.outcome, displayString))
  assert.match(html, /class="[^"]*break-words[^"]*">Observed-/)
  assert.match(html, />Execution failure</)
  assert.match(html, /Classified failure/)
})

test('M4 Chunk 4 refusal semantics are explicit and integrity findings render only for integrity_invalid', () => {
  const insufficient = renderDiagnostic(available(outcomeMatrix[6]!.outcome))
  assert.match(insufficient, /FORGE cannot classify this Result from the current authoritative evidence/)
  assert.doesNotMatch(insufficient, /Integrity findings/)

  const integrityOutcome: CanonicalDiagnosticOutcome = {
    ...common,
    kind: 'refusal',
    refusalCode: 'integrity_invalid',
    integrityFindings: ['diagnostic_evidence_contradiction', 'diagnostic_authority_binding_invalid', 'diagnostic_historical_authority_substitution'],
    explanationCode: 'diagnostic_integrity_validation_failed',
    explanationParameters: {},
  }
  const integrity = renderDiagnostic(available(integrityOutcome))
  assert.match(integrity, /Interpretation is withheld because diagnostic evidence or authority integrity is invalid/)
  assert.match(integrity, /Diagnostic evidence contradiction/)
  assert.match(integrity, /Diagnostic authority binding invalid/)
  assert.match(integrity, /Historical authority substitution detected/)
})

test('M4 Chunk 4 renders integrity findings in canonical frozen order without mutating input', () => {
  const canonicalOrder = [
    'diagnostic_evidence_contradiction',
    'diagnostic_authority_binding_invalid',
    'diagnostic_historical_authority_substitution',
  ] as const
  const reversedOrder = [...canonicalOrder].reverse()
  const outcome = (integrityFindings: typeof canonicalOrder | typeof reversedOrder): CanonicalDiagnosticOutcome => ({
    ...common,
    kind: 'refusal',
    refusalCode: 'integrity_invalid',
    integrityFindings: [...integrityFindings],
    explanationCode: 'diagnostic_integrity_validation_failed',
    explanationParameters: {},
  })
  const canonicalHtml = renderDiagnostic(available(outcome(canonicalOrder)))
  const reversedOutcome = outcome(reversedOrder)
  const authoritativeInputOrder = [...reversedOutcome.integrityFindings]
  const reversedHtml = renderDiagnostic(available(reversedOutcome))
  const renderedFindings = (html: string) => [...html.matchAll(/<li>([^<]+)<\/li>/g)].map(match => match[1])
  const expectedLabels = [
    'Diagnostic evidence contradiction',
    'Diagnostic authority binding invalid',
    'Historical authority substitution detected',
  ]
  assert.deepEqual(renderedFindings(canonicalHtml), expectedLabels)
  assert.deepEqual(renderedFindings(reversedHtml), expectedLabels)
  assert.deepEqual(reversedOutcome.integrityFindings, authoritativeInputOrder)
})

test('M4 Chunk 4 keeps all three unavailable transport states distinct and safe', () => {
  const cases = [
    ['not_found', 'Diagnostic evidence not found'],
    ['unreadable', 'Diagnostic evidence unreadable'],
    ['unsupported_classifier_version', 'Unsupported diagnostic version'],
  ] as const
  for (const [reason, label] of cases) {
    const html = renderDiagnostic(unavailable(reason))
    assert.match(html, new RegExp(`>${label}<`))
    assert.match(html, /Diagnostic detail unavailable/)
    assert.doesNotMatch(html, /stack|exception|sqlite|database/i)
  }
  assert.match(renderDiagnostic(unavailable('not_found')), /for this Result/)
})

test('M4 Chunk 4 no-diagnostic state remains bounded and does not invent a classification', () => {
  const html = renderDiagnostic()
  assert.match(html, /No diagnostic detail is attached to this Result/)
  assert.doesNotMatch(html, /Classified failure|Classification withheld|Insufficient evidence/)

  const missingHtml = renderDiagnostic(undefined, false)
  assert.match(missingHtml, /No diagnostic detail is attached to this manifest item/)
  assert.doesNotMatch(missingHtml, /this Result|Result diagnostic/)
})

test('M4 Chunk 4 decodes missing-Result diagnostics and keeps every unavailable state Result-neutral', () => {
  const cases = [
    ['not_found', 'Diagnostic evidence not found'],
    ['unreadable', 'Diagnostic evidence unreadable'],
    ['unsupported_classifier_version', 'Unsupported diagnostic version'],
  ] as const
  for (const [reason, label] of cases) {
    const decoded = decoderValidMissingResultDetail(unavailable(reason))
    const html = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: decoded }))
    assert.match(html, /Expected Result missing/)
    assert.match(html, /No persisted Result row exists/)
    assert.match(html, new RegExp(`>${label}<`))
    assert.match(html, /Manifest item diagnostic/)
    assert.doesNotMatch(html, /for this Result|attached to this Result|classify this Result|Result diagnostic|Result ID<\/dt>/)
  }
})

test('M4 Chunk 4 decoder blocks causal, root-cause, and confidence fields before UI rendering', () => {
  for (const field of ['cause', 'rootCause', 'confidence']) {
    const raw = structuredClone(detail({ scope: 'per_item' }, available(outcomeMatrix[0]!.outcome), true)) as unknown as {
      items: Array<{ diagnostic: Record<string, unknown> }>
    }
    raw.items[0]!.diagnostic[field] = 'not-authoritative'
    assert.throws(() => decodeCanonicalExecutionResultsDetail(raw, 'project-m4'), CanonicalResultsContractError)
  }
})

test('M4 Chunk 4 provenance disclosure is keyboard-native, versioned, item-specific, and long-ID safe', () => {
  const diagnostic = available(outcomeMatrix[5]!.outcome)
  diagnostic.identity.projectId = LONG_ID
  diagnostic.identity.executionId = LONG_ID
  diagnostic.identity.runId = LONG_ID
  const html = renderDiagnostic(diagnostic)
  assert.match(html, /<details/)
  assert.match(html, /<summary[^>]*>Diagnostic provenance<\/summary>/)
  assert.match(html, /forge\.m4\.diagnostic-evidence\/v1/)
  assert.match(html, /forge\.m4\.diagnostic-classifier\/v1/)
  assert.match(html, /Manifest item/)
  assert.match(html, /break-all/)
  assert.equal((html.match(new RegExp(LONG_ID, 'g')) ?? []).length, 3)
})

test('M4 Chunk 4 renders direct, Suite v1 single-root, and Suite v2 per-item diagnostics without authority reconstruction', () => {
  const singleRoot: CanonicalExecutionResultsDetail['execution']['definitionAuthority'] = {
    schemaVersion: 3, testSetId: 'test-set-m4', revision: 4, modelRowId: 9, modelVersion: '9.0',
    supportSealHash: HASH, routeEvidenceIdentityHash: HASH, authenticationExpectationIdentityHash: HASH,
  }
  const direct = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: detail(singleRoot, available(outcomeMatrix[0]!.outcome)) }))
  const suiteV1 = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: detail(singleRoot, available(outcomeMatrix[1]!.outcome), true) }))
  const suiteV2 = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: decoderValidSuiteV2Detail() }))
  assert.match(direct, />Execution failure</)
  assert.match(suiteV1, />Authentication not established</)
  assert.match(suiteV1, /Execution authority and provenance/)
  assert.match(suiteV2, />Execution failure</)
  assert.match(suiteV2, />Oracle mismatch</)
  assert.match(suiteV2, /First member diagnostic/)
  assert.match(suiteV2, /Second member diagnostic/)
  assert.equal((suiteV2.match(/Classified failure/g) ?? []).length, 2)
  assert.match(suiteV2, /Immutable accepted Suite provenance/)
  assert.doesNotMatch(suiteV2, /Execution authority and provenance|Test Set|App Model|Support seal/)
})
