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
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ExecutionHistory,
  ExecutionResultsDetail,
  ResultsError,
} from '../forge-ui/src/pages/ResultsPage'
import { ApiError } from '../forge-ui/src/api/client'
import {
  CanonicalResultsIntegrityError,
  CanonicalResultsPayloadError,
} from '../forge-ui/src/api/resultsClient'
import type {
  CanonicalExecutionResultsDetail,
  CanonicalExecutionResultsListItem,
} from '../forge-ui/src/api/resultsContract'

const HASH = 'a'.repeat(64)
const root = path.resolve(__dirname, '..')

function summary(overrides: Partial<CanonicalExecutionResultsListItem> = {}): CanonicalExecutionResultsListItem {
  return {
    executionId: 'execution-1',
    lifecycle: 'completed',
    evidenceHeadlineOutcome: 'passed',
    terminalOutcome: 'passed',
    authorityReasonCode: 'completed',
    acceptedAt: '2026-08-17T12:00:00.000Z',
    terminalAt: '2026-08-17T12:00:02.000Z',
    expectedResultCount: 1,
    runCount: 1,
    observedResultCount: 1,
    passedResultCount: 1,
    failedResultCount: 0,
    couldNotVerifyResultCount: 0,
    integrityState: 'valid',
    ...overrides,
  }
}

function detail(overrides: Partial<CanonicalExecutionResultsDetail> = {}): CanonicalExecutionResultsDetail {
  return {
    kind: 'canonical_execution_results',
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: {
      executionId: 'execution-1',
      lifecycle: 'running',
      terminalOutcome: null,
      authorityReasonCode: null,
      acceptedAt: '2026-08-17T12:00:00.000Z',
      terminalAt: null,
      expectedResultCount: 4,
      definitionAuthority: {
        schemaVersion: 2,
        testSetId: 'test-set-1',
        revision: 3,
        modelRowId: 4,
        modelVersion: 'model-v4',
        supportSealHash: HASH,
        routeEvidenceIdentityHash: HASH,
        authenticationExpectationIdentityHash: HASH,
      },
    },
    run: {
      runId: 'run-1',
      lifecycle: 'running',
      evidenceOutcome: 'failed',
      evidenceReasonCode: 'navigation_failed',
      startedAt: '2026-08-17T12:00:01.000Z',
      terminalAt: null,
      expectedResultCount: 4,
      observedResultCount: 3,
      evidenceCounts: { passed: 1, failed: 1, couldNotVerify: 1, missing: 1 },
    },
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-pass', executablePlanHash: HASH, evidence: { kind: 'observed_result', resultId: 'result-pass', outcome: 'passed', reasonCode: 'completed', safeMessage: null, durationMs: 10, oracleKind: null, observedSubjectId: null } },
      { manifestOrdinal: 2, definitionId: 'definition-fail', executablePlanHash: HASH, evidence: { kind: 'observed_result', resultId: 'result-fail', outcome: 'failed', reasonCode: 'navigation_failed', safeMessage: null, durationMs: 20, oracleKind: null, observedSubjectId: null } },
      { manifestOrdinal: 3, definitionId: 'definition-cnv', executablePlanHash: HASH, evidence: { kind: 'observed_result', resultId: 'result-cnv', outcome: 'could_not_verify', reasonCode: 'oracle_unavailable', safeMessage: null, durationMs: 30, oracleKind: null, observedSubjectId: null } },
      { manifestOrdinal: 4, definitionId: 'definition-missing', executablePlanHash: HASH, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } },
    ],
    integrityWarnings: [],
    ...overrides,
  }
}

test('history presents canonical lifecycle, headline, terminal outcome, totals, and completeness separately', () => {
  const html = renderToStaticMarkup(React.createElement(ExecutionHistory, {
    executions: [
      summary(),
      summary({ executionId: 'execution-failed', evidenceHeadlineOutcome: 'failed', terminalOutcome: 'failed', passedResultCount: 0, failedResultCount: 1 }),
      summary({ executionId: 'execution-partial', lifecycle: 'running', terminalOutcome: null, terminalAt: null, expectedResultCount: 2, observedResultCount: 1, evidenceHeadlineOutcome: 'could_not_verify' }),
    ],
    selectedExecutionId: null,
    onSelect: () => undefined,
  }))
  assert.match(html, /Lifecycle: Completed/)
  assert.match(html, /Evidence: Passed/)
  assert.match(html, /Terminal outcome/)
  assert.match(html, /1 of 2 observed/)
  assert.match(html, /Execution is still running; current evidence is incomplete/)
  assert.match(html, />Failed</)
  assert.match(html, />Could not verify</)
  assert.doesNotMatch(html, /pass rate/i)
})

test('history distinguishes empty and integrity-invalid authority from ordinary zero Results', () => {
  const empty = renderToStaticMarkup(React.createElement(ExecutionHistory, { executions: [], selectedExecutionId: null, onSelect: () => undefined }))
  assert.match(empty, /No Product executions yet/)
  const invalid = renderToStaticMarkup(React.createElement(ExecutionHistory, {
    executions: [summary({ evidenceHeadlineOutcome: null, passedResultCount: null, failedResultCount: null, couldNotVerifyResultCount: null, integrityState: 'invalid' })],
    selectedExecutionId: null,
    onSelect: () => undefined,
  }))
  assert.match(invalid, /Normal Results are withheld because canonical integrity is invalid/)
  assert.match(invalid, /disabled=""/)
  assert.doesNotMatch(invalid, />0<\/strong>/)
})

test('detail keeps passed, failed, could-not-verify, and missing Result identities distinct', () => {
  const html = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: detail() }))
  assert.match(html, /Result ID<\/dt><dd[^>]*>result-pass/)
  assert.match(html, /Result ID<\/dt><dd[^>]*>result-fail/)
  assert.match(html, /Result ID<\/dt><dd[^>]*>result-cnv/)
  assert.match(html, /Expected Result missing/)
  assert.match(html, /No persisted Result row exists/)
  assert.match(html, /Definition definition-missing/)
  assert.match(html, /Current evidence: Could not verify/)
  assert.match(html, /Persisted terminal outcome<\/dt><dd[^>]*>Not persisted/)
  assert.match(html, /The evidence headline describes current persisted evidence; it is not a terminal execution verdict/)
})

test('detail preserves Execution, Run, and Result identity and exposes only sparse canonical provenance', () => {
  const html = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: detail() }))
  assert.match(html, /Execution ID/)
  assert.match(html, /execution-1/)
  assert.match(html, /Run ID run-1/)
  assert.match(html, /result-pass/)
  assert.match(html, /Detailed diagnostic evidence was not persisted for this Result/)
  assert.match(html, /Authentication expectation is provenance, not an authentication execution outcome/)
  assert.doesNotMatch(html, /authentication (succeeded|failed)|logged in|credential used/i)
  assert.doesNotMatch(html, /screenshot|video|stack trace/i)
})

test('detail renders valid v3 Definition authority without treating Results as malformed', () => {
  const base = detail()
  const html = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, {
    detail: detail({
      execution: {
        ...base.execution,
        definitionAuthority: { ...base.execution.definitionAuthority, schemaVersion: 3 },
      },
    }),
  }))
  assert.match(html, /Execution authority and provenance/)
  assert.match(html, /Support seal/)
  assert.match(html, /Current evidence: Could not verify/)
  assert.doesNotMatch(html, /Canonical Results response was invalid/)
})

test('detail truthfully presents absent Run and cancellation without synthetic Result rows', () => {
  const base = detail()
  const absentRun = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...base.execution, lifecycle: 'cancelled', terminalOutcome: 'could_not_verify', terminalAt: '2026-08-17T12:00:02.000Z' },
    run: null,
    items: base.items.map(item => ({ manifestOrdinal: item.manifestOrdinal, definitionId: item.definitionId, executablePlanHash: item.executablePlanHash, evidence: { kind: 'missing_result' as const, reasonCode: 'expected_result_missing' as const } })),
  })
  const html = renderToStaticMarkup(React.createElement(ExecutionResultsDetail, { detail: absentRun }))
  assert.match(html, /No Product Run persisted/)
  assert.match(html, /No Run identity or Result evidence was manufactured/)
  assert.match(html, /Lifecycle<\/dt><dd[^>]*>Cancelled/)
  assert.equal((html.match(/Expected Result missing/g) ?? []).length, 4)
})

test('canonical payload, integrity, not-found, and unavailable failures remain distinct rendered states', () => {
  const malformed = renderToStaticMarkup(React.createElement(ResultsError, { error: new CanonicalResultsPayloadError(new Error('bad')), subject: 'detail' }))
  assert.match(malformed, /Canonical Results response was invalid/)
  assert.match(malformed, /No Result truth was inferred/)
  const integrity = renderToStaticMarkup(React.createElement(ResultsError, { error: new CanonicalResultsIntegrityError(409, [{ code: 'manifest_mismatch', severity: 'error', safeMessage: 'Manifest authority disagrees.' }]), subject: 'detail' }))
  assert.match(integrity, /Results integrity could not be established/)
  assert.match(integrity, /Manifest authority disagrees/)
  const missing = renderToStaticMarkup(React.createElement(ResultsError, { error: new ApiError('missing', 404, 'NOT_FOUND'), subject: 'detail' }))
  assert.match(missing, /Execution not found/)
  const unavailable = renderToStaticMarkup(React.createElement(ResultsError, { error: new ApiError('offline', 0, 'BACKEND_UNAVAILABLE'), subject: 'history' }))
  assert.match(unavailable, /FORGE backend unavailable/)
  assert.match(unavailable, /No legacy source was used as a fallback/)
})

test('page source uses only certified canonical hooks and retains bounded UI states', () => {
  const source = fs.readFileSync(path.join(root, 'forge-ui/src/pages/ResultsPage.tsx'), 'utf8')
  assert.match(source, /useCanonicalExecutionResults\(project\)/)
  assert.match(source, /useCanonicalExecutionResultDetail\(project, selectedExecutionId\)/)
  assert.match(source, /Loading canonical execution history/)
  assert.match(source, /Loading execution Results/)
  assert.match(source, /Canonical Results response was invalid/)
  assert.match(source, /Results integrity could not be established/)
  assert.match(source, /No legacy source was used as a fallback/)
  assert.doesNotMatch(source, /['"`]\/api\/v1\/(?:results|runs)/)
  assert.doesNotMatch(source, /run-history\.json|playwright|healing|flaky-analysis/i)
})
