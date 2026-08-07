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
const overview = read('forge-ui/src/components/application-workspace/ApplicationOverview.tsx')
const types = read('forge-ui/src/components/application-workspace/types.ts')
const truthBoardTypes = read('forge-ui/src/components/truth-board/types.ts')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const page = read('forge-ui/src/pages/ApplicationWorkspacePage.tsx')

test('new application with no evidence remains explicitly unknown', () => {
  assert.match(overview, /No evidence is available/)
  assert.match(overview, /Current claims remain unknown/)
  assert.match(overview, /No safe recommendation is available/)
})

test('medium confidence overview exposes qualitative level, dimensions, and evidence', () => {
  assert.match(overview, /readModel\.confidenceDimensions/)
  assert.match(overview, /truthConfidence\.level/)
  assert.match(overview, /Evidence visibility/)
  assert.match(overview, /truthConfidence\?\.why/)
})

test('authentication and access blockers remain visible in project status and evidence', () => {
  assert.match(overview, /projectStatus\?\.blockers/)
  assert.match(overview, /Access or project blockers remain visible/)
  assert.match(types, /OverviewEvidenceState/)
  assert.match(overview, /ShieldAlert/)
})

test('stale and integrity-failed evidence have distinct visible states', () => {
  assert.match(types, /'integrity-failed'/)
  assert.match(overview, /Stale/)
  assert.match(overview, /evidence\.state === 'integrity-failed'/)
  assert.match(overview, /Provenance:/)
})

test('known non-critical unknowns are rendered without being hidden', () => {
  assert.match(overview, /Material unknowns/)
  assert.match(overview, /severity !== 'informational'/)
  assert.match(truthBoardTypes, /TruthBoardUnknown/)
})

test('no safe recommendation is an explicit outcome, not an invented action', () => {
  assert.match(overview, /safeRecommendations\.length === 0/)
  assert.match(overview, /No safe recommendation is available from the current evidence/)
  assert.match(types, /safe: boolean/)
  assert.doesNotMatch(overview, /healthScore|health score|numeric KPI/i)
})

test('workspace tabs reflect the later certified Application slices', () => {
  assert.match(workspace, /Application workspace tabs/)
  assert.match(workspace, /Observations.*available: true/s)
  assert.match(workspace, /Application Model.*available: true/s)
  assert.match(workspace, /Evidence.*available: true/s)
  assert.match(page, /buildApplicationOverviewReadModel/)
})
