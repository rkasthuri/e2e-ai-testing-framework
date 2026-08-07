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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('forge-ui/src/components/application-workspace/ApplicationEvidence.tsx')
const types = read('forge-ui/src/components/application-workspace/evidenceTypes.ts')
const page = read('forge-ui/src/pages/ApplicationEvidencePage.tsx')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const app = read('forge-ui/src/App.tsx')

test('empty and no-match evidence states remain explicit without a coverage claim', () => {
  assert.match(component, /No evidence is persisted for this project/)
  assert.match(component, /No evidence matches the selected filters/)
  assert.match(component, /Coverage: Unknown/)
  assert.doesNotMatch(component, /coverage percentage|health score|completely modeled/i)
})

test('the live ledger presents identity, source, subject, observation, usage, integrity, freshness, and status independently', () => {
  for (const label of ['Evidence', 'Captured', 'Source', 'Subject', 'Observation', 'Usage', 'Integrity', 'Freshness', 'Status']) {
    assert.match(component, new RegExp(`>${label}<`))
  }
  assert.match(types, /EvidenceLedgerResponse as ApplicationEvidenceReadModel/)
  assert.match(component, /Current support|Historical support/)
  assert.match(component, /Not evaluated/)
})

test('provenance, conflicts, unavailable linkage, and limitations stay visible without invented evidence', () => {
  assert.match(component, /Provenance/)
  assert.match(component, /No exact model reference is established/)
  assert.match(component, /Conflict: Not evaluated/)
  assert.match(component, /Limitations and unknowns/)
})

test('filtering and pagination remain server-owned and bounded', () => {
  assert.match(page, /useEvidenceLedger/)
  assert.match(page, /Source class/)
  assert.match(page, /Captured From/)
  assert.match(page, /Captured Through/)
  assert.match(component, />Previous<|>Next</)
  assert.doesNotMatch(component, /infinite scroll/i)
})

test('credential and unrestricted raw payload fields are absent from presentation contracts', () => {
  assert.doesNotMatch(types, /password|secret|token|cookie|rawHtml|modelJson|stackTrace/i)
  assert.doesNotMatch(component, /credential-reference|environment-variable|SQLite diagnostics/i)
})

test('Evidence remains enabled at the established workspace route', () => {
  assert.match(workspace, /slug: 'evidence', label: 'Evidence', available: true/)
  assert.match(app, /path="\/application\/evidence"/)
})
