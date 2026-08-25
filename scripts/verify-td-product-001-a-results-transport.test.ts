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
import { ApiError } from '../forge-ui/src/api/client'
import {
  CanonicalResultsContractError,
  decodeCanonicalExecutionResultsDetail,
  decodeCanonicalExecutionResultsList,
  serializeCanonicalExecutionResultsRead,
} from '../forge-ui/src/api/resultsContract'
import {
  CanonicalResultsIntegrityError,
  CanonicalResultsPayloadError,
  fetchCanonicalExecutionResultsDetail,
  fetchCanonicalExecutionResultsList,
} from '../forge-ui/src/api/resultsClient'
import { listExecutionResults, readExecutionResults } from '../forge-ui/server/context/ExecutionResultsController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const TIME = '2026-08-15T12:00:00.000Z'
const LATER = '2026-08-15T12:00:01.000Z'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function definitionAuthority(schemaVersion: 1 | 2 | 3) {
  return {
    schemaVersion,
    testSetId: 'test-set-alpha',
    revision: 2,
    modelRowId: 7,
    modelVersion: '1.0.6',
    supportSealHash: schemaVersion === 1 ? null : HASH_A,
    routeEvidenceIdentityHash: schemaVersion === 1 ? null : HASH_B,
    authenticationExpectationIdentityHash: schemaVersion === 1 ? null : HASH_C,
  }
}

function listItem(overrides: Record<string, unknown> = {}) {
  return {
    executionId: 'execution-alpha', lifecycle: 'completed', evidenceHeadlineOutcome: 'passed',
    terminalOutcome: 'passed', authorityReasonCode: 'completed', acceptedAt: TIME, terminalAt: LATER,
    expectedResultCount: 1, runCount: 1, observedResultCount: 1, integrityState: 'valid',
    passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 0,
    ...overrides,
  }
}

function observed(outcome: 'passed' | 'failed' | 'could_not_verify' = 'passed') {
  return {
    kind: 'observed_result', resultId: `result-${outcome}`, outcome,
    reasonCode: outcome === 'passed' ? 'completed' : outcome === 'failed' ? 'oracle_failed' : 'navigation_failed',
    safeMessage: null, durationMs: 1_000, oracleKind: null, observedSubjectId: null,
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'canonical_execution_results',
    evidenceHeadlineOutcome: 'passed',
    execution: {
      executionId: 'execution-alpha', lifecycle: 'completed', terminalOutcome: 'passed',
      authorityReasonCode: 'completed', acceptedAt: TIME, terminalAt: LATER, expectedResultCount: 1,
      definitionAuthority: definitionAuthority(2),
    },
    run: {
      runId: 'run-alpha', lifecycle: 'completed', evidenceOutcome: 'passed', evidenceReasonCode: 'completed',
      startedAt: TIME, terminalAt: LATER, expectedResultCount: 1, observedResultCount: 1,
      evidenceCounts: { passed: 1, failed: 0, couldNotVerify: 0, missing: 0 },
    },
    items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: observed() }],
    integrityWarnings: [],
    ...overrides,
  }
}

function detailForOutcome(outcome: 'passed' | 'failed' | 'could_not_verify') {
  return detail({
    evidenceHeadlineOutcome: outcome,
    execution: { ...(detail().execution as object), terminalOutcome: outcome },
    run: {
      ...(detail().run as object), evidenceOutcome: outcome,
      evidenceReasonCode: outcome === 'passed' ? 'completed' : outcome === 'failed' ? 'oracle_failed' : 'navigation_failed',
      evidenceCounts: {
        passed: outcome === 'passed' ? 1 : 0,
        failed: outcome === 'failed' ? 1 : 0,
        couldNotVerify: outcome === 'could_not_verify' ? 1 : 0,
        missing: 0,
      },
    },
    items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: observed(outcome) }],
  })
}

function partialPassingDetail() {
  return detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: {
      ...(detail().execution as object), lifecycle: 'running', terminalOutcome: null, terminalAt: null,
      expectedResultCount: 2,
    },
    run: {
      ...(detail().run as object), lifecycle: 'running', terminalAt: null, expectedResultCount: 2,
      observedResultCount: 1, evidenceOutcome: 'passed',
      evidenceCounts: { passed: 1, failed: 0, couldNotVerify: 0, missing: 1 },
    },
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: observed() },
      { manifestOrdinal: 2, definitionId: 'definition-beta', executablePlanHash: HASH_B, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } },
    ],
    integrityWarnings: [{ code: 'missing_expected_result', severity: 'warning', safeMessage: 'Expected evidence is missing.' }],
  })
}

function coreRead(projectionOverrides: Record<string, unknown> = {}) {
  return {
    kind: 'ok',
    projection: {
      availability: 'available', headlineOutcome: 'passed',
      execution: {
        executionId: 'execution-alpha', lifecycle: 'completed', outcome: 'passed', reasonCode: 'completed',
        acceptedAt: TIME, terminalAt: LATER, manifestCount: 1,
        definitionAuthority: definitionAuthority(2),
      },
      run: {
        runId: 'run-alpha', lifecycle: 'completed', outcome: 'passed', reasonCode: 'completed',
        startedAt: TIME, terminalAt: LATER, expectedResultCount: 1, observedResultCount: 1,
        aggregateCounts: { passed: 1, failed: 0, couldNotVerify: 0 },
      },
      items: [{
        itemOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A,
        result: {
          state: 'result_observed', resultId: 'result-alpha', outcome: 'passed', reasonCode: 'completed',
          safeMessage: null, durationMs: 1_000, oracleKind: null, observedSubjectId: null,
        },
      }],
      integrityWarnings: [],
      ...projectionOverrides,
    },
  }
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('TD-PRODUCT-001-A-1 list keeps lifecycle, evidence headline, and terminal outcome distinct', () => {
  const running = listItem({
    lifecycle: 'running', evidenceHeadlineOutcome: 'could_not_verify', terminalOutcome: null, terminalAt: null,
    expectedResultCount: 2, observedResultCount: 1,
  })
  const read = decodeCanonicalExecutionResultsList({ executions: [running], page: { limit: 25 } })
  assert.deepEqual(
    [read.executions[0].lifecycle, read.executions[0].evidenceHeadlineOutcome, read.executions[0].terminalOutcome],
    ['running', 'could_not_verify', null],
  )
  assert.deepEqual(decodeCanonicalExecutionResultsList({ executions: [], page: { limit: 25 } }).executions, [])
})

test('TD-PRODUCT-001-A-2 observed outcomes and Execution, Run, Result identities remain exact and separate', () => {
  for (const outcome of ['passed', 'failed', 'could_not_verify'] as const) {
    const value = detailForOutcome(outcome)
    const read = decodeCanonicalExecutionResultsDetail(value)
    assert.equal(read.items[0].evidence.kind, 'observed_result')
    if (read.items[0].evidence.kind !== 'observed_result') throw new Error('expected observed Result')
    assert.notEqual(read.execution.executionId, read.run?.runId)
    assert.notEqual(read.run?.runId, read.items[0].evidence.resultId)
    assert.equal(read.items[0].evidence.outcome, outcome)
  }
})

test('M1-R1 v1, v2, and v3 Definition authority remains explicitly discriminated at the Results boundary', () => {
  for (const schemaVersion of [1, 2, 3] as const) {
    const value = detail({
      execution: {
        ...(detail().execution as object),
        definitionAuthority: definitionAuthority(schemaVersion),
      },
    })
    const read = decodeCanonicalExecutionResultsDetail(value)
    assert.equal(read.execution.definitionAuthority.schemaVersion, schemaVersion)
    assert.equal(read.execution.lifecycle, 'completed')
    assert.equal(read.execution.terminalOutcome, 'passed')
    assert.equal(read.execution.authorityReasonCode, 'completed')
    assert.equal(read.run?.evidenceReasonCode, 'completed')
    assert.equal(read.items[0].evidence.kind, 'observed_result')
  }

  const v1ShapedAuthorityMislabeledV2 = {
    ...definitionAuthority(1),
    schemaVersion: 2,
  }
  assert.throws(
    () => decodeCanonicalExecutionResultsDetail(detail({
      execution: {
        ...(detail().execution as object),
        definitionAuthority: v1ShapedAuthorityMislabeledV2,
      },
    })),
    error => error instanceof CanonicalResultsContractError
      && /v2 requires complete canonical support authority/.test(error.message),
  )

  assert.throws(
    () => decodeCanonicalExecutionResultsDetail(detail({
      execution: {
        ...(detail().execution as object),
        definitionAuthority: { ...definitionAuthority(3), routeEvidenceIdentityHash: null },
      },
    })),
    error => error instanceof CanonicalResultsContractError
      && /v3 requires complete canonical support authority/.test(error.message),
  )
})

test('M1-R1 Core v3 projection serializes through the API adapter without changing Result truth', () => {
  const source = coreRead()
  const projection = source.projection
  const v3Source = {
    ...source,
    projection: {
      ...projection,
      execution: {
        ...projection.execution,
        definitionAuthority: definitionAuthority(3),
      },
    },
  }
  const read = serializeCanonicalExecutionResultsRead(v3Source)
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') throw new Error('expected v3 projection')
  assert.equal(read.projection.execution.definitionAuthority.schemaVersion, 3)
  assert.deepEqual(
    {
      headline: read.projection.evidenceHeadlineOutcome,
      lifecycle: read.projection.execution.lifecycle,
      terminalOutcome: read.projection.execution.terminalOutcome,
      authorityReasonCode: read.projection.execution.authorityReasonCode,
      runOutcome: read.projection.run?.evidenceOutcome,
      runReason: read.projection.run?.evidenceReasonCode,
      evidence: read.projection.items[0].evidence,
    },
    {
      headline: 'passed',
      lifecycle: 'completed',
      terminalOutcome: 'passed',
      authorityReasonCode: 'completed',
      runOutcome: 'passed',
      runReason: 'completed',
      evidence: {
        kind: 'observed_result', resultId: 'result-alpha', outcome: 'passed', reasonCode: 'completed',
        safeMessage: null, durationMs: 1_000, oracleKind: null, observedSubjectId: null,
      },
    },
  )
})

test('M1-R1 Results client accepts a valid terminal v3 payload through its production decoder', async () => {
  const original = globalThis.fetch
  try {
    const v3 = detail({
      execution: {
        ...(detail().execution as object),
        definitionAuthority: definitionAuthority(3),
      },
    })
    globalThis.fetch = async () => response(200, { data: v3, error: null, timestamp: TIME })
    const read = await fetchCanonicalExecutionResultsDetail('alpha', 'execution-alpha')
    assert.equal(read.execution.definitionAuthority.schemaVersion, 3)
    assert.equal(read.execution.lifecycle, 'completed')
    assert.equal(read.execution.terminalOutcome, 'passed')
    assert.equal(read.items[0].evidence.kind, 'observed_result')
  } finally {
    globalThis.fetch = original
  }
})

test('TD-PRODUCT-001-A-3 missing and mixed evidence remain explicit union members', () => {
  const read = decodeCanonicalExecutionResultsDetail(partialPassingDetail())
  assert.equal(read.items[1].evidence.kind, 'missing_result')
  assert.equal('resultId' in read.items[1].evidence, false)
  assert.equal(read.execution.terminalOutcome, null)
  assert.equal(read.evidenceHeadlineOutcome, 'could_not_verify')
  assert.equal(read.run?.evidenceOutcome, 'passed', 'Run truth remains Result-only while Execution truth is manifest-aware')
})

test('TD-PRODUCT-001-A-R1-1 every evidence count is recomputed from Result items', () => {
  const failed = detailForOutcome('failed')
  const passed = detailForOutcome('passed')
  const cnv = detailForOutcome('could_not_verify')
  const partial = partialPassingDetail()
  const contradictions = [
    { ...failed, run: { ...(failed.run as object), evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 0 } } },
    { ...passed, run: { ...(passed.run as object), evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 0 } } },
    { ...cnv, run: { ...(cnv.run as object), evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 0 } } },
    { ...partial, run: { ...(partial.run as object), evidenceCounts: { passed: 1, failed: 0, couldNotVerify: 0, missing: 0 } } },
    { ...passed, run: { ...(passed.run as object), observedResultCount: 0 } },
  ]
  for (const value of contradictions) {
    assert.throws(() => decodeCanonicalExecutionResultsDetail(value), CanonicalResultsContractError)
  }
})

test('TD-PRODUCT-001-A-R1-2 execution evidence headline obeys failure-first manifest-aware truth', () => {
  const failed = detailForOutcome('failed')
  const cnv = detailForOutcome('could_not_verify')
  const passed = detailForOutcome('passed')
  const partial = partialPassingDetail()
  for (const value of [
    { ...failed, evidenceHeadlineOutcome: 'passed' },
    { ...failed, evidenceHeadlineOutcome: 'could_not_verify' },
    { ...cnv, evidenceHeadlineOutcome: 'passed' },
    { ...partial, evidenceHeadlineOutcome: 'passed' },
    { ...passed, evidenceHeadlineOutcome: 'failed' },
    { ...passed, evidenceHeadlineOutcome: 'could_not_verify' },
  ]) {
    assert.throws(() => decodeCanonicalExecutionResultsDetail(value), CanonicalResultsContractError)
  }
})

test('TD-PRODUCT-001-A-R1-3 Run evidence outcome follows observed Results without absorbing manifest gaps', () => {
  const failed = detailForOutcome('failed')
  const cnv = detailForOutcome('could_not_verify')
  const passed = detailForOutcome('passed')
  const missingOnly = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...(detail().execution as object), lifecycle: 'running', terminalOutcome: null, terminalAt: null },
    run: {
      ...(detail().run as object), lifecycle: 'running', terminalAt: null, observedResultCount: 0,
      evidenceOutcome: 'passed', evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 1 },
    },
    items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } }],
  })
  for (const value of [
    { ...failed, run: { ...(failed.run as object), evidenceOutcome: 'passed' } },
    { ...cnv, run: { ...(cnv.run as object), evidenceOutcome: 'passed' } },
    { ...passed, run: { ...(passed.run as object), evidenceOutcome: 'failed' } },
    missingOnly,
  ]) {
    assert.throws(() => decodeCanonicalExecutionResultsDetail(value), CanonicalResultsContractError)
  }
  assert.doesNotThrow(() => decodeCanonicalExecutionResultsDetail(partialPassingDetail()))
})

test('TD-PRODUCT-001-A-R1-4 observed Result requires a Run while pre-Run missing evidence remains valid', () => {
  assert.throws(
    () => decodeCanonicalExecutionResultsDetail({ ...detail(), run: null }),
    CanonicalResultsContractError,
  )
  const preRun = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: {
      ...(detail().execution as object), lifecycle: 'accepted', terminalOutcome: null, terminalAt: null,
    },
    run: null,
    items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } }],
  })
  const read = decodeCanonicalExecutionResultsDetail(preRun)
  assert.equal(read.run, null)
  assert.equal(read.evidenceHeadlineOutcome, 'could_not_verify')
  assert.equal(read.execution.terminalOutcome, null)
})

test('TD-PRODUCT-001-A-R2-1 zero-item canonical manifests fail closed in detail and list contracts', () => {
  const zeroDetail = detail({
    evidenceHeadlineOutcome: 'passed',
    execution: { ...(detail().execution as object), expectedResultCount: 0 },
    run: null,
    items: [],
  })
  assert.throws(() => decodeCanonicalExecutionResultsDetail(zeroDetail), CanonicalResultsContractError)
  assert.throws(
    () => decodeCanonicalExecutionResultsDetail({ ...zeroDetail, evidenceHeadlineOutcome: 'could_not_verify' }),
    CanonicalResultsContractError,
  )
  assert.throws(
    () => decodeCanonicalExecutionResultsList({
      executions: [listItem({ expectedResultCount: 0, observedResultCount: 0 })],
      page: { limit: 25 },
    }),
    CanonicalResultsContractError,
  )
  assert.doesNotThrow(() => decodeCanonicalExecutionResultsDetail(detailForOutcome('passed')))
})

test('TD-PRODUCT-001-A-R2-2 duplicate Definition identity is rejected across every evidence pairing', () => {
  const execution = { ...(detail().execution as object), expectedResultCount: 2 }
  const observedRun = {
    ...(detail().run as object), expectedResultCount: 2, observedResultCount: 2,
    evidenceCounts: { passed: 2, failed: 0, couldNotVerify: 0, missing: 0 },
  }
  const mixedRun = {
    ...(detail().run as object), lifecycle: 'running', terminalAt: null, expectedResultCount: 2,
    observedResultCount: 1, evidenceCounts: { passed: 1, failed: 0, couldNotVerify: 0, missing: 1 },
  }
  const duplicateObserved = detail({
    execution,
    run: observedRun,
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-duplicate', executablePlanHash: HASH_A, evidence: observed() },
      { manifestOrdinal: 2, definitionId: 'definition-duplicate', executablePlanHash: HASH_B, evidence: { ...observed(), resultId: 'result-passed-two' } },
    ],
  })
  const duplicateMixed = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...execution, lifecycle: 'running', terminalOutcome: null, terminalAt: null },
    run: mixedRun,
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-duplicate', executablePlanHash: HASH_A, evidence: observed() },
      { manifestOrdinal: 2, definitionId: 'definition-duplicate', executablePlanHash: HASH_B, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } },
    ],
  })
  const duplicateMissing = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...execution, lifecycle: 'accepted', terminalOutcome: null, terminalAt: null },
    run: null,
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-duplicate', executablePlanHash: HASH_A, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } },
      { manifestOrdinal: 2, definitionId: 'definition-duplicate', executablePlanHash: HASH_B, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } },
    ],
  })
  for (const value of [duplicateObserved, duplicateMixed, duplicateMissing]) {
    assert.throws(
      () => decodeCanonicalExecutionResultsDetail(value),
      error => error instanceof CanonicalResultsContractError && /duplicate Definition identity/.test(error.message),
    )
  }
  const duplicateResult = {
    ...duplicateObserved,
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: observed() },
      { manifestOrdinal: 2, definitionId: 'definition-beta', executablePlanHash: HASH_B, evidence: observed() },
    ],
  }
  assert.throws(
    () => decodeCanonicalExecutionResultsDetail(duplicateResult),
    error => error instanceof CanonicalResultsContractError && /duplicate Result identity/.test(error.message),
  )
})

test('TD-PRODUCT-001-A-R3-1 list summaries enforce complete-pass and Product Run ownership invariants', () => {
  for (const value of [
    listItem({ lifecycle: 'running', terminalOutcome: null, terminalAt: null, expectedResultCount: 1, observedResultCount: 0, runCount: 0 }),
    listItem({ lifecycle: 'running', terminalOutcome: null, terminalAt: null, expectedResultCount: 2, observedResultCount: 1, runCount: 1 }),
    listItem({ expectedResultCount: 1, observedResultCount: 1, runCount: 0 }),
  ]) {
    assert.throws(
      () => decodeCanonicalExecutionResultsList({ executions: [value], page: { limit: 25 } }),
      CanonicalResultsContractError,
    )
  }

  const valid = [
    listItem(),
    listItem({
      lifecycle: 'running', terminalOutcome: null, terminalAt: null,
      expectedResultCount: 2, observedResultCount: 1, runCount: 1,
      passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 0,
      evidenceHeadlineOutcome: 'could_not_verify', integrityState: 'warning',
    }),
    listItem({
      evidenceHeadlineOutcome: 'failed', terminalOutcome: 'failed',
      passedResultCount: 0, failedResultCount: 1, couldNotVerifyResultCount: 0,
    }),
    listItem({
      lifecycle: 'cancelled', evidenceHeadlineOutcome: 'could_not_verify', terminalOutcome: 'could_not_verify',
      expectedResultCount: 1, observedResultCount: 0, runCount: 1,
      passedResultCount: 0, failedResultCount: 0, couldNotVerifyResultCount: 0,
    }),
  ]
  assert.equal(decodeCanonicalExecutionResultsList({ executions: valid, page: { limit: 25 } }).executions.length, 4)
})

test('TD-PRODUCT-001-A-R4-1 list outcome totals mathematically determine the evidence headline', () => {
  const rejected = [
    listItem({
      expectedResultCount: 2, observedResultCount: 2,
      passedResultCount: 1, failedResultCount: 1, couldNotVerifyResultCount: 0,
    }),
    listItem({
      expectedResultCount: 2, observedResultCount: 2,
      passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 1,
    }),
    listItem({
      evidenceHeadlineOutcome: 'could_not_verify', terminalOutcome: 'could_not_verify',
      passedResultCount: 0, failedResultCount: 1, couldNotVerifyResultCount: 0,
    }),
    listItem({
      evidenceHeadlineOutcome: 'failed', terminalOutcome: 'failed',
      passedResultCount: 0, failedResultCount: 0, couldNotVerifyResultCount: 1,
    }),
    listItem({ passedResultCount: 0, failedResultCount: 0, couldNotVerifyResultCount: 0 }),
    listItem({ passedResultCount: 2, failedResultCount: 0, couldNotVerifyResultCount: 0 }),
  ]
  for (const value of rejected) {
    assert.throws(
      () => decodeCanonicalExecutionResultsList({ executions: [value], page: { limit: 25 } }),
      CanonicalResultsContractError,
    )
  }

  const accepted = [
    listItem({
      lifecycle: 'running', terminalOutcome: null, terminalAt: null,
      expectedResultCount: 2, observedResultCount: 1,
      passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 0,
      evidenceHeadlineOutcome: 'could_not_verify', integrityState: 'warning',
    }),
    listItem({
      expectedResultCount: 2, observedResultCount: 2,
      passedResultCount: 2, failedResultCount: 0, couldNotVerifyResultCount: 0,
    }),
    listItem({
      expectedResultCount: 2, observedResultCount: 2,
      passedResultCount: 1, failedResultCount: 1, couldNotVerifyResultCount: 0,
      evidenceHeadlineOutcome: 'failed', terminalOutcome: 'failed',
    }),
    listItem({
      expectedResultCount: 2, observedResultCount: 2,
      passedResultCount: 1, failedResultCount: 0, couldNotVerifyResultCount: 1,
      evidenceHeadlineOutcome: 'could_not_verify', terminalOutcome: 'could_not_verify',
    }),
  ]
  assert.equal(decodeCanonicalExecutionResultsList({ executions: accepted, page: { limit: 25 } }).executions.length, 4)
})

test('TD-PRODUCT-001-A-R4-2 integrity-invalid list summaries expose no invented outcome totals', () => {
  const invalid = listItem({
    lifecycle: 'unknown', terminalOutcome: null, terminalAt: null, evidenceHeadlineOutcome: null,
    observedResultCount: 0, runCount: 0,
    passedResultCount: null, failedResultCount: null, couldNotVerifyResultCount: null,
    integrityState: 'invalid', authorityReasonCode: 'projection_integrity_invalid',
  })
  const read = decodeCanonicalExecutionResultsList({ executions: [invalid], page: { limit: 25 } })
  assert.deepEqual(
    [read.executions[0].evidenceHeadlineOutcome, read.executions[0].passedResultCount,
      read.executions[0].failedResultCount, read.executions[0].couldNotVerifyResultCount],
    [null, null, null, null],
  )
  assert.throws(
    () => decodeCanonicalExecutionResultsList({
      executions: [{ ...invalid, passedResultCount: 0, failedResultCount: 0, couldNotVerifyResultCount: 0 }],
      page: { limit: 25 },
    }),
    CanonicalResultsContractError,
  )
})

test('TD-PRODUCT-001-A-R3-2 Run reason follows manifest-ordered observed Result evidence', () => {
  const passed = detailForOutcome('passed')
  const failed = detailForOutcome('failed')
  const cnv = detailForOutcome('could_not_verify')
  for (const value of [
    { ...passed, run: { ...(passed.run as object), evidenceReasonCode: 'navigation_failed' } },
    { ...failed, run: { ...(failed.run as object), evidenceReasonCode: 'assertion_failed' } },
    { ...cnv, run: { ...(cnv.run as object), evidenceReasonCode: 'selector_missing' } },
  ]) {
    assert.throws(() => decodeCanonicalExecutionResultsDetail(value), CanonicalResultsContractError)
  }
  for (const value of [passed, failed, cnv, partialPassingDetail()]) {
    assert.doesNotThrow(() => decodeCanonicalExecutionResultsDetail(value))
  }

  const orderedFailures = detail({
    evidenceHeadlineOutcome: 'failed',
    execution: { ...(detail().execution as object), terminalOutcome: 'failed', expectedResultCount: 2 },
    run: {
      ...(detail().run as object), evidenceOutcome: 'failed', evidenceReasonCode: 'oracle_failed',
      expectedResultCount: 2, observedResultCount: 2,
      evidenceCounts: { passed: 0, failed: 2, couldNotVerify: 0, missing: 0 },
    },
    items: [
      { manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: observed('failed') },
      { manifestOrdinal: 2, definitionId: 'definition-beta', executablePlanHash: HASH_B, evidence: { ...observed('failed'), resultId: 'result-failed-two', reasonCode: 'assertion_failed' } },
    ],
  })
  assert.doesNotThrow(() => decodeCanonicalExecutionResultsDetail(orderedFailures))
  assert.throws(
    () => decodeCanonicalExecutionResultsDetail({
      ...orderedFailures,
      run: { ...(orderedFailures.run as object), evidenceReasonCode: 'assertion_failed' },
    }),
    CanonicalResultsContractError,
  )

  const cancelledWithoutResults = detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...(detail().execution as object), lifecycle: 'cancelled', terminalOutcome: 'could_not_verify' },
    run: {
      ...(detail().run as object), lifecycle: 'cancelled', evidenceOutcome: 'could_not_verify',
      evidenceReasonCode: 'expected_result_missing', observedResultCount: 0,
      evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 1 },
    },
    items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' } }],
  })
  assert.doesNotThrow(() => decodeCanonicalExecutionResultsDetail(cancelledWithoutResults))
})

test('TD-PRODUCT-001-A-4 cancellation and interruption remain lifecycle facts, not outcome aliases', () => {
  const cancelled = decodeCanonicalExecutionResultsDetail(detail({
    execution: { ...(detail().execution as object), lifecycle: 'cancelled' },
    run: { ...(detail().run as object), lifecycle: 'cancelled' },
  }))
  const interrupted = decodeCanonicalExecutionResultsDetail(detail({
    evidenceHeadlineOutcome: 'could_not_verify',
    execution: { ...(detail().execution as object), lifecycle: 'interrupted', terminalOutcome: 'could_not_verify' },
    run: {
      ...(detail().run as object), lifecycle: 'interrupted', evidenceOutcome: null, evidenceReasonCode: null,
      terminalAt: null, observedResultCount: 0,
      evidenceCounts: { passed: 0, failed: 0, couldNotVerify: 0, missing: 1 },
    },
    items: [{
      manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A,
      evidence: { kind: 'missing_result', reasonCode: 'expected_result_missing' },
    }],
    integrityWarnings: [{ code: 'missing_expected_result', severity: 'warning', safeMessage: 'Expected evidence is missing.' }],
  }))
  assert.deepEqual([cancelled.execution.lifecycle, cancelled.execution.terminalOutcome], ['cancelled', 'passed'])
  assert.deepEqual([interrupted.execution.lifecycle, interrupted.run?.evidenceOutcome], ['interrupted', null])
})

test('TD-PRODUCT-001-A-5 malformed identity, enum, count, required field, and legacy detail fail closed', () => {
  const cases = [
    { ...detail(), execution: { ...(detail().execution as object), executionId: '../other' } },
    { ...detail(), evidenceHeadlineOutcome: 'successful' },
    { ...detail(), items: [] },
    { ...detail(), execution: { ...(detail().execution as object), definitionAuthority: undefined } },
    { ...detail(), items: [{ ...(detail().items as Array<Record<string, unknown>>)[0], screenshot_path: 'secret.png' }] },
    { ...detail(), items: [{ ...(detail().items as Array<Record<string, unknown>>)[0], evidence: { ...observed(), rawError: 'secret' } }] },
  ]
  for (const value of cases) assert.throws(() => decodeCanonicalExecutionResultsDetail(value), CanonicalResultsContractError)
  assert.throws(
    () => decodeCanonicalExecutionResultsList({ executions: [{ ...listItem(), mystery: true }], page: { limit: 25 } }),
    CanonicalResultsContractError,
  )
})

test('TD-PRODUCT-001-C bounded oracle detail is typed, paired, and closed', () => {
  const withDetail = detail({
    items: [{
      manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A,
      evidence: { ...observed(), oracleKind: 'subject_observable', observedSubjectId: 'subject-inventory' },
    }],
  })
  const decoded = decodeCanonicalExecutionResultsDetail(withDetail)
  assert.deepEqual(
    decoded.items[0].evidence.kind === 'observed_result'
      ? [decoded.items[0].evidence.oracleKind, decoded.items[0].evidence.observedSubjectId]
      : null,
    ['subject_observable', 'subject-inventory'],
  )
  for (const evidence of [
    { ...observed(), oracleKind: 'visual_guess', observedSubjectId: 'subject-inventory' },
    { ...observed(), oracleKind: 'subject_observable', observedSubjectId: null },
    { ...observed(), oracleKind: null, observedSubjectId: 'subject-inventory' },
    { ...observed(), oracleKind: 'subject_observable', observedSubjectId: '../unsafe' },
  ]) {
    assert.throws(() => decodeCanonicalExecutionResultsDetail(detail({
      items: [{ manifestOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A, evidence }],
    })), CanonicalResultsContractError)
  }
})

test('TD-PRODUCT-001-A-6 core adapter renames ambiguous fields and rejects unpersisted Result richness', () => {
  const read = serializeCanonicalExecutionResultsRead(coreRead())
  assert.equal(read.kind, 'ok')
  if (read.kind !== 'ok') throw new Error('expected projection')
  assert.equal(read.projection.evidenceHeadlineOutcome, 'passed')
  assert.equal(read.projection.execution.terminalOutcome, 'passed')
  assert.equal('headlineOutcome' in read.projection, false)
  assert.equal('outcome' in read.projection.execution, false)

  const rich = coreRead({
    items: [{
      itemOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A,
      result: { ...observed(), state: 'result_observed', kind: undefined, safeMessage: 'invented detail' },
    }],
  })
  assert.throws(() => serializeCanonicalExecutionResultsRead(rich), CanonicalResultsContractError)
  const bounded = coreRead({
    items: [{
      itemOrdinal: 1, definitionId: 'definition-alpha', executablePlanHash: HASH_A,
      result: {
        state: 'result_observed', resultId: 'result-alpha', outcome: 'passed', reasonCode: 'completed',
        safeMessage: null, durationMs: 1_000, oracleKind: 'subject_observable', observedSubjectId: 'subject-inventory',
      },
    }],
  })
  const serialized = serializeCanonicalExecutionResultsRead(bounded)
  assert.equal(serialized.kind === 'ok' && serialized.projection.items[0].evidence.kind === 'observed_result'
    ? serialized.projection.items[0].evidence.observedSubjectId : null, 'subject-inventory')
})

test('TD-PRODUCT-001-A-7 canonical client uses only project-scoped endpoints and decodes valid list/detail', async () => {
  const original = globalThis.fetch
  const requests: string[] = []
  try {
    globalThis.fetch = async input => {
      const url = String(input)
      requests.push(url)
      return response(200, { data: url.endsWith('/results') ? detail() : { executions: [listItem()], page: { limit: 25 } }, error: null, timestamp: TIME })
    }
    assert.equal((await fetchCanonicalExecutionResultsList('alpha project')).executions[0].executionId, 'execution-alpha')
    assert.equal((await fetchCanonicalExecutionResultsDetail('alpha project', 'execution-alpha')).execution.executionId, 'execution-alpha')
    assert.deepEqual(requests, [
      '/api/v1/projects/alpha%20project/executions?limit=25',
      '/api/v1/projects/alpha%20project/executions/execution-alpha/results',
    ])
    assert.equal(requests.some(url => /^\/api\/v1\/(?:results|runs)(?:\/|$)/.test(url)), false)
  } finally {
    globalThis.fetch = original
  }
})

test('TD-PRODUCT-001-A-8 malformed success and integrity-invalid responses are explicit errors, never empty Results', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('<html>not json</html>', { status: 200 })
    await assert.rejects(fetchCanonicalExecutionResultsList('alpha'), CanonicalResultsPayloadError)

    globalThis.fetch = async () => response(200, { data: { executions: [{ ...listItem(), lifecycle: 'done' }], page: { limit: 25 } }, error: null, timestamp: TIME })
    await assert.rejects(fetchCanonicalExecutionResultsList('alpha'), CanonicalResultsPayloadError)

    globalThis.fetch = async () => response(503, {
      error: 'Execution Result integrity is unavailable for safe projection.',
      code: 'EXECUTION_RESULTS_INTEGRITY_INVALID', timestamp: TIME,
      integrityWarnings: [{ code: 'manifest_mismatch', severity: 'error', safeMessage: 'Manifest evidence disagrees.' }],
    })
    await assert.rejects(
      fetchCanonicalExecutionResultsDetail('alpha', 'execution-alpha'),
      error => error instanceof CanonicalResultsIntegrityError
        && error.integrityWarnings[0].code === 'manifest_mismatch',
    )
  } finally {
    globalThis.fetch = original
  }
})

test('TD-PRODUCT-001-A-9 404, unavailable, malformed error, and network failures remain failures', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => response(404, { error: 'Execution not found', code: 'NOT_FOUND', timestamp: TIME })
    await assert.rejects(fetchCanonicalExecutionResultsDetail('alpha', 'missing'), error => error instanceof ApiError && error.status === 404)
    globalThis.fetch = async () => response(503, { error: 'Unavailable', code: 'EXECUTION_RESULTS_UNAVAILABLE', timestamp: TIME })
    await assert.rejects(fetchCanonicalExecutionResultsList('alpha'), error => error instanceof ApiError && error.code === 'EXECUTION_RESULTS_UNAVAILABLE')
    globalThis.fetch = async () => new Response('{', { status: 503 })
    await assert.rejects(fetchCanonicalExecutionResultsList('alpha'), error => error instanceof ApiError && error.code === 'BACKEND_UNAVAILABLE')
    globalThis.fetch = async () => { throw new Error('network') }
    await assert.rejects(fetchCanonicalExecutionResultsList('alpha'), error => error instanceof ApiError && error.code === 'BACKEND_UNAVAILABLE')
  } finally {
    globalThis.fetch = original
  }
})

test('TD-PRODUCT-001-A-10 controller refuses malformed core output and preserves project/not-found/list errors', async () => {
  const originalRead = executionContext.readProductExecutionResults.bind(executionContext)
  const originalList = executionContext.listProductExecutionResults.bind(executionContext)
  const project = async () => ({ appName: 'alpha', url: 'https://example.invalid' })
  try {
    ;(executionContext as unknown as { readProductExecutionResults: typeof originalRead }).readProductExecutionResults = async () => ({ kind: 'ok', projection: { availability: 'available' } })
    ;(executionContext as unknown as { listProductExecutionResults: typeof originalList }).listProductExecutionResults = async () => ({ kind: 'ok', executions: [{ legacy: true }], limit: 25 })
    assert.equal((await readExecutionResults('alpha', 'execution-alpha', project)).status, 503)
    assert.equal((await listExecutionResults('alpha', {}, project)).status, 503)
    assert.equal((await listExecutionResults('alpha', { limit: '0' }, project)).status, 400)
    assert.equal((await listExecutionResults('missing', {}, async () => undefined)).status, 404)
  } finally {
    ;(executionContext as unknown as { readProductExecutionResults: typeof originalRead }).readProductExecutionResults = originalRead
    ;(executionContext as unknown as { listProductExecutionResults: typeof originalList }).listProductExecutionResults = originalList
  }
})

test('TD-PRODUCT-001-A-11 source boundary has no legacy fallback, raw Result fields, or implicit any cast', () => {
  const client = fs.readFileSync(path.resolve('forge-ui/src/api/resultsClient.ts'), 'utf8')
  const hooks = fs.readFileSync(path.resolve('forge-ui/src/hooks/useApi.ts'), 'utf8')
  const controller = fs.readFileSync(path.resolve('forge-ui/server/context/ExecutionResultsController.ts'), 'utf8')
  const combined = `${client}\n${hooks}`
  assert.doesNotMatch(combined, /\/api\/v1\/(?:results|runs)(?:\/|['"`])/)
  assert.doesNotMatch(combined, /run-history|playwright-report|screenshot_path|video_path|rawError|error_msg/)
  assert.doesNotMatch(controller, /\sas any\b/)
  assert.match(client, /apiClient\.get<unknown>/)
})
