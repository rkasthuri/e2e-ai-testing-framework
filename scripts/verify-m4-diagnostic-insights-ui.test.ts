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
import { ApiError } from '../forge-ui/src/api/client'
import {
  decodeDiagnosticInsights,
  DiagnosticInsightsContractError,
  type DiagnosticInsightsReadModel,
} from '../forge-ui/src/api/insightsContract'
import { InsightsError, InsightsSummary } from '../forge-ui/src/pages/InsightsPage'
import { readDiagnosticInsights } from '../forge-ui/server/context/DiagnosticInsightsController'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'

const PROJECT = 'project-m4'
const versions = {
  projectId: PROJECT,
  evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1' as const,
  classifierVersion: 'forge.m4.diagnostic-classifier/v1' as const,
}
const versionQuery = {
  evidenceSchemaVersion: versions.evidenceSchemaVersion,
  classifierVersion: versions.classifierVersion,
}
const six = {
  executor_failure: 1,
  authentication_not_established: 1,
  navigation_not_completed: 1,
  target_not_observed: 1,
  action_not_completed: 1,
  oracle_mismatch: 1,
}
function matrix(overrides: Partial<DiagnosticInsightsReadModel> = {}): DiagnosticInsightsReadModel {
  return { ...versions, totalDiagnostics: 10, classifiedFailureCount: 6, refusalCount: 4, countsByFailureMode: six, insufficientEvidenceCount: 3, integrityInvalidCount: 1, ...overrides }
}
function render(element: React.ReactElement): string { return renderToStaticMarkup(element) }

test('M4 Chunk 5 certified 10-diagnostic partition decodes and renders exact separated counts', () => {
  const decoded = decodeDiagnosticInsights(matrix(), PROJECT)
  assert.deepEqual(decoded, matrix())
  const html = render(React.createElement(InsightsSummary, { insights: decoded }))
  for (const label of ['Total diagnostics', 'Classified failures', 'Refusals', 'Executor failure', 'Authentication not established', 'Navigation not completed', 'Target not observed', 'Action not completed', 'Oracle mismatch', 'Insufficient evidence', 'Integrity invalid']) assert.match(html, new RegExp(label))
  assert.match(html, /Refusals are not classified failures/)
  assert.equal((html.match(/>1<\/dd>/g) ?? []).length, 7)
})

test('M4 Chunk 5 genuine Suite v2 insufficient partition keeps all refusal counts outside failure modes', () => {
  const decoded = decodeDiagnosticInsights(matrix({ totalDiagnostics: 3, classifiedFailureCount: 0, refusalCount: 3, countsByFailureMode: Object.fromEntries(Object.keys(six).map(key => [key, 0])) as typeof six, insufficientEvidenceCount: 3, integrityInvalidCount: 0 }), PROJECT)
  assert.equal(Object.values(decoded.countsByFailureMode).every(value => value === 0), true)
  const html = render(React.createElement(InsightsSummary, { insights: decoded }))
  assert.match(html, /Classification refusals/)
  assert.match(html, /Insufficient evidence/)
  assert.doesNotMatch(html, /percentage|confidence|root cause|healing/i)
})

test('M4 Chunk 5 zero partition is an honest empty state with no error or invented category', () => {
  const zero = decodeDiagnosticInsights(matrix({ totalDiagnostics: 0, classifiedFailureCount: 0, refusalCount: 0, countsByFailureMode: Object.fromEntries(Object.keys(six).map(key => [key, 0])) as typeof six, insufficientEvidenceCount: 0, integrityInvalidCount: 0 }), PROJECT)
  const html = render(React.createElement(InsightsSummary, { insights: zero }))
  assert.match(html, /role="status"/)
  assert.match(html, /No diagnostics in this version partition/)
  assert.doesNotMatch(html, /role="alert"|Classified failure modes|Classification refusals/)
})

test('M4 Chunk 5 decoder rejects malformed, extra-field, mixed-version, identity, and count attacks', () => {
  const attacks = [
    { ...matrix(), projectId: 'other-project' },
    { ...matrix(), evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v2' },
    { ...matrix(), classifierVersion: 'forge.m4.diagnostic-classifier/v2' },
    { ...matrix(), rootCause: 'selector drift' },
    { ...matrix(), legacyTriage: { appBug: 6 } },
    { ...matrix(), countsByFailureMode: { ...six, insufficient_evidence: 3 } },
    { ...matrix(), classifiedFailureCount: 7 },
    { ...matrix(), refusalCount: 5 },
    { ...matrix(), totalDiagnostics: 11 },
  ]
  for (const attack of attacks) assert.throws(() => decodeDiagnosticInsights(attack, PROJECT), DiagnosticInsightsContractError)
})

test('M4 Chunk 5 error UI distinguishes invalid project, evidence version, classifier version, unreadable partition, and malformed payload', () => {
  const cases = [
    [new ApiError('invalid', 400, 'INVALID_APP_NAME'), 'Invalid project identity'],
    [new ApiError('missing', 404, 'NOT_FOUND'), 'Project not found'],
    [new ApiError('evidence', 422, 'UNSUPPORTED_DIAGNOSTIC_EVIDENCE_VERSION'), 'Evidence version not supported'],
    [new ApiError('classifier', 422, 'UNSUPPORTED_DIAGNOSTIC_CLASSIFIER_VERSION'), 'Classifier version not supported'],
    [new ApiError('unreadable', 503, 'DIAGNOSTIC_INSIGHTS_PARTITION_UNREADABLE'), 'Diagnostic partition unavailable'],
    [new ApiError('malformed', 503, 'DIAGNOSTIC_INSIGHTS_PAYLOAD_INVALID'), 'Diagnostic Insights response was invalid'],
  ] as const
  for (const [error, label] of cases) {
    const html = render(React.createElement(InsightsError, { error }))
    assert.match(html, /role="alert"/)
    assert.match(html, new RegExp(label))
    assert.doesNotMatch(html, /Classified failure modes|Total diagnostics/)
  }
})

test('M4 Chunk 5 controller requires explicit versions and never turns missing/invalid identity into zero data', async () => {
  const found = async () => ({ appName: PROJECT, url: 'https://example.invalid' })
  const missing = async () => undefined
  assert.equal((await readDiagnosticInsights(PROJECT, {}, found)).status, 400)
  const absent = await readDiagnosticInsights(PROJECT, versionQuery, missing)
  assert.equal(absent.status, 404)
  assert.doesNotMatch(JSON.stringify(absent.body), /totalDiagnostics/)
})

test('M4 Chunk 5 controller maps unknown versions and unreadable partitions distinctly without partial counts', async () => {
  const original = executionContext.readProductDiagnosticInsights.bind(executionContext)
  const found = async () => ({ appName: PROJECT, url: 'https://example.invalid' })
  const named = (name: string) => Object.assign(new Error('raw storage detail'), { name })
  try {
    const replacement = executionContext as unknown as { readProductDiagnosticInsights: typeof original }
    for (const [name, code] of [
      ['UnsupportedDiagnosticEvidenceSchemaVersionError', 'UNSUPPORTED_DIAGNOSTIC_EVIDENCE_VERSION'],
      ['UnsupportedDiagnosticClassifierVersionError', 'UNSUPPORTED_DIAGNOSTIC_CLASSIFIER_VERSION'],
      ['DiagnosticInsightsIntegrityError', 'DIAGNOSTIC_INSIGHTS_PARTITION_UNREADABLE'],
    ] as const) {
      replacement.readProductDiagnosticInsights = async () => { throw named(name) }
      const response = await readDiagnosticInsights(PROJECT, versionQuery, found)
      assert.equal((response.body as { code: string }).code, code)
      assert.doesNotMatch(JSON.stringify(response.body), /raw storage detail|totalDiagnostics/)
    }
  } finally {
    ;(executionContext as unknown as { readProductDiagnosticInsights: typeof original }).readProductDiagnosticInsights = original
  }
})

test('M4 Chunk 5 controller serializes Core counts only and rejects malformed Core output', async () => {
  const original = executionContext.readProductDiagnosticInsights.bind(executionContext)
  const found = async () => ({ appName: PROJECT, url: 'https://example.invalid' })
  try {
    const replacement = executionContext as unknown as { readProductDiagnosticInsights: typeof original }
    replacement.readProductDiagnosticInsights = async () => matrix()
    const accepted = await readDiagnosticInsights(PROJECT, versionQuery, found)
    assert.equal(accepted.status, 200)
    assert.deepEqual((accepted.body as { data: unknown }).data, matrix())
    replacement.readProductDiagnosticInsights = async () => ({ ...matrix(), confidence: 0.99 })
    const rejected = await readDiagnosticInsights(PROJECT, versionQuery, found)
    assert.equal(rejected.status, 503)
    assert.equal((rejected.body as { code: string }).code, 'DIAGNOSTIC_INSIGHTS_PAYLOAD_INVALID')
  } finally {
    ;(executionContext as unknown as { readProductDiagnosticInsights: typeof original }).readProductDiagnosticInsights = original
  }
})

test('M4 Chunk 5 source boundary stays project-scoped, GET-only, version-explicit, and free of legacy authority', () => {
  const routes = fs.readFileSync(path.resolve('forge-ui/server/routes/projects.ts'), 'utf8')
  const controller = fs.readFileSync(path.resolve('forge-ui/server/context/DiagnosticInsightsController.ts'), 'utf8')
  const context = fs.readFileSync(path.resolve('forge-ui/server/context/ExecutionContext.ts'), 'utf8')
  const client = fs.readFileSync(path.resolve('forge-ui/src/api/insightsClient.ts'), 'utf8')
  const page = fs.readFileSync(path.resolve('forge-ui/src/pages/InsightsPage.tsx'), 'utf8')
  assert.match(routes, /router\.get\('\/:appName\/insights'/)
  assert.doesNotMatch(routes, /router\.post\('\/:appName\/insights'/)
  assert.match(context, /DiagnosticInsightsService/)
  assert.match(client, /evidenceSchemaVersion.*classifierVersion/s)
  assert.doesNotMatch(`${controller}\n${client}`, /\/api\/v1\/insights(?:\/|['"`])/)
  assert.doesNotMatch(`${controller}\n${client}\n${page}`, /RunRepository|TrendRepository|legacyTriage|currentHead|rootCause|confidenceScore|healingSuggestion/)
  assert.doesNotMatch(controller, /DiagnosticEvidenceRepository|classifyDiagnosticEvidence|countsByFailureMode\s*=/)
})

test('M4 Chunk 5 page exposes semantic headings, announced states, and responsive count grids', () => {
  const page = fs.readFileSync(path.resolve('forge-ui/src/pages/InsightsPage.tsx'), 'utf8')
  assert.match(page, /<h1[^>]*>Insights<\/h1>/)
  assert.match(page, /aria-live="polite"/)
  assert.match(page, /aria-live="assertive"/)
  assert.match(page, /grid gap-3 sm:grid-cols-3/)
  assert.match(page, /grid gap-6 lg:grid-cols-2/)
  assert.match(page, /break-all font-mono/)
})
