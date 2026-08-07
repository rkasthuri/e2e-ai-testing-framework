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

/**
 * TD-UI-003 Block 5b follow-up — Test Cases tab pure-helper proofs. These encode
 * the tab's honesty-critical decisions (confidence mapping, review classification,
 * path grouping), so they are proven directly. Pure functions — no fs, no mocks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fileConfidence, isReviewItem, splitPath, flowForFile, composeIntentNote, formatDuration,
} from '../forge-ui/src/pages/testCaseHelpers'
import type { ManifestFile, ManifestFlow, ManifestPage, FlowConfidenceTier } from '../forge-ui/src/api/types'

const spec = (id: string, flowId?: string): ManifestFile =>
  ({ id, relativePath: `tests/mod/${id}.generated.spec.ts`, type: 'spec', reason: 'new-flow', flowId })
const pom = (id: string, pageId?: string): ManifestFile =>
  ({ id, relativePath: `tests/pages/${id}.generated.ts`, type: 'pom', reason: 'new-flow', pageId })
const flow = (id: string, confidence: FlowConfidenceTier): ManifestFlow =>
  ({ id, displayName: id, confidence, source: 'inferred', groundingWarnings: [], specFile: '' })
const page = (id: string, moduleConfidence: string): ManifestPage =>
  ({ id, urlPattern: '/x', moduleConfidence, pomFile: '' })

// ── fileConfidence ──────────────────────────────────────────────────────────────

test('C1 flow confidence observed → "High"', () => {
  assert.equal(fileConfidence(spec('s', 'f'), [flow('f', 'observed')], [])?.label, 'High')
})

test('C2 flow confidence partial → "Medium"', () => {
  assert.equal(fileConfidence(spec('s', 'f'), [flow('f', 'partial')], [])?.label, 'Medium')
})

test('C3 flow confidence unknown → "Unknown" (NEVER "Low")', () => {
  // This test exists specifically to FAIL if anyone ever "improves" unknown to
  // "Low". Unknown means we do not know — it is not a weak-but-known signal.
  const r = fileConfidence(spec('s', 'f'), [flow('f', 'unknown')], [])
  assert.equal(r?.label, 'Unknown')
  assert.notEqual(r?.label, 'Low')
})

test('C4 POM moduleConfidence low → "Low" (a POM CAN be Low; a flow never can)', () => {
  assert.equal(fileConfidence(pom('p', 'pg'), [], [page('pg', 'low')])?.label, 'Low')
})

test('C5 fixture → null (no badge — we do not invent a confidence)', () => {
  const fixture: ManifestFile = { id: 'fx', relativePath: 'tests/fixtures.generated.ts', type: 'fixture', reason: 'new-flow' }
  assert.equal(fileConfidence(fixture, [], []), null)
})

test('C6 api-client / api-spec → null', () => {
  const apiClient: ManifestFile = { id: 'ac', relativePath: 'tests/ApiClient.ts', type: 'api-client', reason: 'new-flow' }
  const apiSpec: ManifestFile = { id: 'as', relativePath: 'tests/api.generated.spec.ts', type: 'api-spec', reason: 'new-flow' }
  assert.equal(fileConfidence(apiClient, [], []), null)
  assert.equal(fileConfidence(apiSpec, [], []), null)
})

test('C7 spec whose flowId has NO matching flow → null (never fail-open to High)', () => {
  // The dangerous case: a badge that quietly overstates confidence. Must be null.
  const r = fileConfidence(spec('s', 'missing'), [flow('other', 'observed')], [])
  assert.equal(r, null)
})

// ── isReviewItem ──────────────────────────────────────────────────────────────

test('C8 partial → true', () => {
  assert.equal(isReviewItem(spec('s', 'f'), [flow('f', 'partial')]), true)
})

test('C9 unknown → true', () => {
  assert.equal(isReviewItem(spec('s', 'f'), [flow('f', 'unknown')]), true)
})

test('C10 observed → false', () => {
  assert.equal(isReviewItem(spec('s', 'f'), [flow('f', 'observed')]), false)
})

test('C11 no matching flow → true (RULING: a file we cannot assess IS a review item)', () => {
  assert.equal(isReviewItem(spec('s', 'missing'), [flow('other', 'observed')]), true)
})

// ── splitPath ─────────────────────────────────────────────────────────────────

test('C12 tests/pages/x.page.ts → dir "pages"', () => {
  assert.equal(splitPath('tests/pages/x.page.ts').dir, 'pages')
})

test('C13 tests/checkout/y.spec.ts → dir "checkout"', () => {
  assert.equal(splitPath('tests/checkout/y.spec.ts').dir, 'checkout')
})

test('C14 tests/fixtures.generated.ts → dir "(root)"', () => {
  const r = splitPath('tests/fixtures.generated.ts')
  assert.equal(r.dir, '(root)')
  assert.equal(r.name, 'fixtures.generated.ts')
})

test('C15 Windows backslash input normalizes identically (portability)', () => {
  assert.deepEqual(splitPath('tests\\pages\\x.page.ts'), splitPath('tests/pages/x.page.ts'))
})

// ── flowForFile ──────────────────────────────────────────────────────────────

test('C16 flowForFile: spec with matching flow → the flow; non-spec / no match → null', () => {
  const f = flow('f', 'partial')
  assert.equal(flowForFile(spec('s', 'f'), [f]), f)
  assert.equal(flowForFile(spec('s', 'missing'), [f]), null)
  assert.equal(flowForFile(pom('p', 'pg'), [f]), null)
})

// ── composeIntentNote — the honesty boundary ────────────────────────────────────

test('I1 partial + real warnings → factual note quoting the ACTUAL warnings only', () => {
  const note = composeIntentNote({
    id: 'f', displayName: 'f', confidence: 'partial', source: 'inferred',
    groundingWarnings: ['step 2 had no observed edge', 'step 4 ungrounded'], specFile: '',
  })
  assert.equal(
    note,
    'Source: inferred. Confidence: partial. This flow contains steps FORGE did not ' +
    'directly observe. Grounding warnings: step 2 had no observed edge; step 4 ungrounded.',
  )
})

test('I2 empty groundingWarnings does NOT produce invented text', () => {
  // THE honesty test: with no warnings, the note must SAY there are none — never
  // fabricate a warning or an intent explanation. Exact-equality so ANY invented
  // text fails this test. FORGE has no AI-authored intent string; the note is
  // evidence only.
  const note = composeIntentNote({
    id: 'f', displayName: 'f', confidence: 'unknown', source: 'agent-proposed',
    groundingWarnings: [], specFile: '',
  })
  assert.equal(
    note,
    'Source: agent-proposed. Confidence: unknown. FORGE has no direct observational ' +
    'evidence for this flow. No grounding warnings were recorded.',
  )
  // Belt-and-suspenders: it must not emit the warnings LABEL when there are none.
  assert.equal(note.includes('Grounding warnings:'), false)
})

// ── formatDuration ──────────────────────────────────────────────────────────────

test('F1 formatDuration: ms / s / m-s, and 0 renders as a real "0 ms" (never a dash)', () => {
  assert.equal(formatDuration(0), '0 ms')
  assert.equal(formatDuration(500), '500 ms')
  assert.equal(formatDuration(1500), '1.5 s')
  assert.equal(formatDuration(42000), '42.0 s')
  assert.equal(formatDuration(90000), '1m 30s')
})
