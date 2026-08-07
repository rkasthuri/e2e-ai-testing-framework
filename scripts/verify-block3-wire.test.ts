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
 * TD-013 Phase 3 (Block 3) — post-crawl recipe-writer wire (write + reader, no orphan).
 *   W1 un-authored app  → synthesized-goals.json written (envelope, origin+grounding intact)
 *   W2 app WITH config  → NO synthesized file written (precedence: skip)
 *   W3 reader: un-authored + synthesized file → returns its goals (origin+grounding intact)
 *   W4 reader: app WITH config → returns HAND-AUTHORED, ignores synthesized (precedence)
 *   W5 reader: neither → [] (existing behavior unbroken)
 *   W6 round-trip fidelity — write then read: deep-equal on actions+grounding+origin
 *   W7 provenance envelope: sourceApp + synthesizedAt; goals[] carry NO execution/validation data
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import {
  synthesizeAndPersistGoals, resolveGoalDefinitions, hasHandAuthoredConfig,
  SynthesizedGoalsEnvelope,
} from '../src/core/onboarding/goalResolution'
import { AppModel } from '../src/core/onboarding/types'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-blk3-'))
const ws = createWorkspace(tmpRoot)

// A minimal committed model: one flow (fill → click) landing on /home, all observed.
const fixtureModel = (appName: string): AppModel => ({
  schemaVersion: '1.0.0',
  classificationRunId: 'run-xyz',
  app: { name: appName, baseUrl: 'https://x.test', appType: 'web' },
  pages: [
    { id: 'p1', urlPattern: '/login', isAuthPage: true, elements: [
      { id: 'p1:user',  name: 'user',  kind: 'input',  strategies: [{ type: 'data-test', value: 'username', confidence: 1 }] },
      { id: 'p1:login', name: 'login', kind: 'button', strategies: [{ type: 'data-test', value: 'go',       confidence: 1 }] },
    ]},
    { id: 'p2', urlPattern: '/home', isAuthPage: false, elements: [] },
  ],
  flows: [{ id: 'f1', displayName: 'Login flow', roleId: 'r', confidence: 'high', source: 'crawl', linkedApiEndpointIds: [],
    steps: [
      { stepIndex: 0, pageId: 'p1', action: 'fill',  elementId: 'p1:user',  targetPageId: 'p1', value: 'alice', grounding: 'observed' },
      { stepIndex: 1, pageId: 'p1', action: 'click', elementId: 'p1:login', targetPageId: 'p2', value: null,    grounding: 'observed' },
    ]}],
} as unknown as AppModel)

test('W1 un-authored app -> synthesized-goals.json written (envelope, origin+grounding intact)', async () => {
  const app = 'blk3-unauthored'
  assert.equal(hasHandAuthoredConfig(app), false)          // sanity: no src/apps config
  const written = await synthesizeAndPersistGoals(app, fixtureModel(app), ws)
  assert.ok(written && written.length === 1)
  const env = await ws.loadSynthesizedGoals(app) as SynthesizedGoalsEnvelope
  assert.ok(env && Array.isArray(env.goals))
  assert.equal(env.goals[0].origin, 'synthesized')
  assert.equal(env.goals[0].actions[0].grounding, 'observed')
  assert.equal(env.goals[0].actions[0].payload, 'alice')   // fill value survived
})

test('W2 app WITH hand-authored config -> NO synthesized file written (precedence skip)', async () => {
  const app = 'saucedemo'                                   // real hand-authored config exists
  assert.equal(hasHandAuthoredConfig(app), true)
  const result = await synthesizeAndPersistGoals(app, fixtureModel(app), ws)
  assert.equal(result, null)                                // skipped
  assert.equal(await ws.loadSynthesizedGoals(app), null)    // nothing written
})

test('W3 reader: un-authored + synthesized present -> returns its goals (origin+grounding intact)', async () => {
  const app = 'blk3-reader'
  await synthesizeAndPersistGoals(app, fixtureModel(app), ws)
  const goals = await resolveGoalDefinitions(app, tmpRoot)
  assert.equal(goals.length, 1)
  assert.equal(goals[0].origin, 'synthesized')
  assert.equal(goals[0].actions[0].grounding, 'observed')
})

test('W4 reader: app WITH config -> returns HAND-AUTHORED, ignores synthesized (precedence)', async () => {
  const app = 'saucedemo'
  // Even if a synthesized file were present in tmpRoot, hand-authored wins:
  const goals = await resolveGoalDefinitions(app, tmpRoot)
  assert.ok(goals.some(g => g.id === 'saucedemo:auth:standardUser'))   // the real config
  assert.ok(!goals.some(g => g.id.startsWith('synthesized:')))         // not the synthesized ids
})

test('W5 reader: neither present -> [] (existing behavior unbroken)', async () => {
  const goals = await resolveGoalDefinitions('blk3-nothing-here', tmpRoot)
  assert.deepEqual(goals, [])
})

test('W6 round-trip fidelity — write then read: deep-equal on actions+grounding+origin', async () => {
  const app = 'blk3-roundtrip'
  const written = await synthesizeAndPersistGoals(app, fixtureModel(app), ws)
  const read = await resolveGoalDefinitions(app, tmpRoot)
  assert.deepEqual(read, written)                           // nothing dropped in serialize/parse
})

test('W7 provenance envelope: sourceApp + synthesizedAt; goals[] carry NO execution/validation data', async () => {
  const app = 'blk3-provenance'
  await synthesizeAndPersistGoals(app, fixtureModel(app), ws)
  const env = await ws.loadSynthesizedGoals(app) as SynthesizedGoalsEnvelope
  assert.equal(env.provenance.sourceApp, app)
  assert.equal(typeof env.provenance.synthesizedAt, 'string')
  assert.equal(env.provenance.classificationRunId, 'run-xyz')
  const g = env.goals[0] as Record<string, unknown>
  assert.ok(!('status' in g))          // generation-only — no execution state
  assert.ok(!('evidenceChain' in g))   // that is session history, not the envelope
  assert.ok(!('resolvedAt' in g))
})

test('cleanup tmp workspace', () => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})
