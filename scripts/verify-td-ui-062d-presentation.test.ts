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
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')
const component = read('forge-ui/src/components/truth-board/TruthBoard.tsx')
const mapper = read('forge-ui/src/components/truth-board/presentation.ts')
const types = read('forge-ui/src/components/truth-board/types.ts')
const executableMapper = mapper.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

test('TD-UI-062D presents a new project with no evidence as visible unknown state', () => {
  assert.match(component, /No evidence references/)
  assert.match(component, /Unknowns/)
  assert.match(component, /Why this state/)
  assert.match(mapper, /section\.why/)
})

test('current crawl with blocked authenticated routes keeps blockers and recommendation visible', () => {
  assert.match(component, /Blockers/)
  assert.match(component, /card\.blockers/)
  assert.match(component, /card\.recommendation/)
  assert.match(types, /kind: string/)
})

test('stale evidence remains visible as evidence and is not converted into health', () => {
  assert.match(component, /Evidence/)
  assert.match(component, /card\.evidenceIds/)
  assert.doesNotMatch(component, /health score|healthScore|KPI/i)
  assert.doesNotMatch(executableMapper, /health score|healthScore|KPI/i)
})

test('integrity-failed evidence can render its supplied blocker and unknown explanation', () => {
  assert.match(component, /card\.unknowns/)
  assert.match(component, /card\.blockers/)
  assert.match(component, /card\.why/)
  assert.match(component, /card\.impact/)
})

test('high confidence remains separate from Project Status and preserves non-critical unknowns', () => {
  assert.match(component, /data-truth-card=\{card\.key\}/)
  assert.match(component, /project-status/)
  assert.match(component, /truth-confidence/)
  assert.match(component, /projectStatus/)
  assert.match(component, /truthConfidence/)
  assert.match(types, /severity: UnknownSeverity/)
})

test('presentation code consumes the read model and does not import core domain contracts', () => {
  assert.match(mapper, /mapTruthBoardToCards/)
  assert.match(mapper, /section\.meaning/)
  assert.match(mapper, /section\.recommendedNextStep/)
  assert.doesNotMatch(component, /src\/core\/domain/)
  assert.doesNotMatch(mapper, /src\/core\/domain/)
})
