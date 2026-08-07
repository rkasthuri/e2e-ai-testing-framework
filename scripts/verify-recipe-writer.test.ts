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
 * TD-013 Phase 3 (Block 2c-ii) — recipe-writer tests (pure, fixture CrawlTopology).
 *   R1 3-step observed flow → 1 goal, 3 ordered actions, correct types, goal grounding observed
 *   R2 inferred assert-navigation step → action type 'verify', goal grounding 'inferred'
 *   R3 click → real selector target (not element-id); fill → payload carries value
 *   R4 target page has PagePrerequisite → steps PREPENDED, each carrying own grounding
 *   R5 no PagePrerequisite → no leading steps fabricated
 *   R6 select action → explicit throw, NEVER a silent fill
 *   R7 prerequisites: [] on every synthesized goal
 *   R8 origin 'synthesized' on every goal; ids deterministic (not Date.now())
 *   R9 regression: bootstrap PageSignals path still produces its goals (Phase-2 intact)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultGoalSynthesizer, PageSignals } from '../src/core/agent/GoalSynthesizer'
import {
  CrawlTopology, CrawlTopologyTransition, CrawlTopologyPage, CrawlTopologyElement, TopologyFlow,
} from '../src/core/agent/CrawlTopology'
import { deriveGoalGrounding } from '../src/core/agent/grounding'
import { Missions } from '../src/core/agent/Mission'

// ── fixture builders ─────────────────────────────────────────────────────────────
const tx = (o: Partial<CrawlTopologyTransition>): CrawlTopologyTransition => ({
  fromPageId: 'p1', toPageId: 'p2', elementId: 'p1:btn', action: 'click',
  value: null, grounding: 'observed', ...o,
})
const el = (id: string, selector: string | null): CrawlTopologyElement =>
  ({ id, name: id, kind: 'button', selector })
const page = (o: Partial<CrawlTopologyPage>): CrawlTopologyPage =>
  ({ id: 'p1', urlPattern: '/p1', isAuthPage: false, elements: [], prerequisites: [], ...o })
const flow = (id: string, indices: number[], roleId?: string): TopologyFlow =>
  ({ id, displayName: `Flow ${id}`, orderedTransitionIndices: indices, roleId })
const topo = (o: Partial<CrawlTopology>): CrawlTopology =>
  ({ appName: 'demo', baseUrl: 'https://demo.test', appType: 'web',
     pages: [], transitions: [], flows: [], source: 'app-model', ...o })

const synth = () => new DefaultGoalSynthesizer()
const mission = Missions.crawl()

// A 3-step observed login flow (fill user, fill pass, click submit) landing on /inventory.
const loginTopo = (): CrawlTopology => topo({
  pages: [
    page({ id: 'p1', urlPattern: '/login', elements: [
      el('p1:user',  '[data-test="username"]'),
      el('p1:pass',  '[data-test="password"]'),
      el('p1:login', '[data-test="login-button"]'),
    ]}),
    page({ id: 'p2', urlPattern: '/inventory' }),
  ],
  transitions: [
    tx({ action: 'fill',  elementId: 'p1:user',  value: 'standard_user', toPageId: 'p1' }),
    tx({ action: 'fill',  elementId: 'p1:pass',  value: 'secret',        toPageId: 'p1' }),
    tx({ action: 'click', elementId: 'p1:login', toPageId: 'p2' }),
  ],
  flows: [flow('login', [0, 1, 2])],
})

test('R1 3-step observed flow -> one goal, 3 ordered actions, correct types, grounding observed', () => {
  const goals = synth().synthesizeFromTopology(loginTopo(), mission)
  assert.equal(goals.length, 1)
  assert.equal(goals[0].actions.length, 3)
  assert.deepEqual(goals[0].actions.map(a => a.type), ['fill', 'fill', 'click'])
  assert.equal(deriveGoalGrounding(goals[0].actions), 'observed')
})

test('R2 inferred assert-navigation step -> verify action, goal grounding inferred', () => {
  const t = topo({
    pages: [page({ id: 'p1', elements: [el('p1:btn', '[data-test="go"]')] }),
            page({ id: 'p2', urlPattern: '/next' })],
    transitions: [
      tx({ action: 'click', elementId: 'p1:btn', grounding: 'observed', toPageId: 'p2' }),
      tx({ action: 'assert-navigation', elementId: null, value: '/next', grounding: 'inferred', toPageId: 'p2' }),
    ],
    flows: [flow('nav', [0, 1])],
  })
  const g = synth().synthesizeFromTopology(t, mission)[0]
  assert.equal(g.actions[1].type, 'verify')
  assert.equal(g.actions[1].grounding, 'inferred')
  assert.equal(deriveGoalGrounding(g.actions), 'inferred')   // one inferred step downgrades the whole goal
})

test('R3 click -> real selector target (not element-id); fill -> payload carries value', () => {
  const g = synth().synthesizeFromTopology(loginTopo(), mission)[0]
  assert.equal(g.actions[2].target, '[data-test="login-button"]')
  assert.notEqual(g.actions[2].target, 'p1:login')            // resolved selector, NOT the id
  assert.equal(g.actions[0].payload, 'standard_user')         // fill value → payload
})

test('R4 target page with PagePrerequisite -> steps PREPENDED, each carrying own grounding', () => {
  const t = topo({
    pages: [
      page({ id: 'p1', elements: [el('p1:btn', '[data-test="go"]')] }),
      page({ id: 'p2', urlPattern: '/secure', elements: [el('p2:setup', '[data-test="setup"]')],
             prerequisites: [{ steps: [
               tx({ action: 'click', elementId: 'p2:setup', grounding: 'inferred', fromPageId: 'p2', toPageId: 'p2' }),
             ]}] }),
    ],
    transitions: [tx({ action: 'click', elementId: 'p1:btn', grounding: 'observed', toPageId: 'p2' })],
    flows: [flow('reach-secure', [0])],
  })
  const g = synth().synthesizeFromTopology(t, mission)[0]
  assert.equal(g.actions.length, 2)                           // 1 prereq + 1 flow step
  assert.equal(g.actions[0].target, '[data-test="setup"]')    // prereq PREPENDED first
  assert.equal(g.actions[0].grounding, 'inferred')            // prereq step's own grounding, 1:1
  assert.equal(deriveGoalGrounding(g.actions), 'inferred')    // inferred prereq downgrades the goal
})

test('R5 no PagePrerequisite -> no leading steps fabricated', () => {
  const g = synth().synthesizeFromTopology(loginTopo(), mission)[0]
  assert.equal(g.actions.length, 3)                           // exactly the flow's 3 steps, nothing prepended
})

test('R6 select action -> explicit throw, NEVER a silent fill', () => {
  const t = topo({
    pages: [page({ id: 'p1', elements: [el('p1:sel', '[data-test="dropdown"]')] })],
    transitions: [tx({ action: 'select', elementId: 'p1:sel', value: 'opt' })],
    flows: [flow('choose', [0])],
  })
  assert.throws(() => synth().synthesizeFromTopology(t, mission), /Unsupported flow action 'select'/)
})

test('R7 prerequisites: [] on every synthesized goal (no invented deps)', () => {
  const goals = synth().synthesizeFromTopology(loginTopo(), mission)
  for (const g of goals) assert.deepEqual(g.prerequisites, [])
})

test('R8 origin synthesized on every goal; ids deterministic (not Date.now())', () => {
  const a = synth().synthesizeFromTopology(loginTopo(), mission)
  const b = synth().synthesizeFromTopology(loginTopo(), mission)
  assert.equal(a[0].origin, 'synthesized')
  assert.equal(a[0].id, 'synthesized:login')                  // derived from flow.id
  assert.equal(a[0].id, b[0].id)                              // deterministic across runs — no timestamp
})

test('R9 regression: bootstrap PageSignals path still produces its goals (Phase-2 intact)', () => {
  const signals: PageSignals = {
    navLinks: [{ text: 'Products', href: '/products' }], buttonTexts: ['Login'],
    formPresence: true, currentUrl: 'https://demo.test/', pageTitle: 'Home',
  }
  const goals = synth().synthesize(signals, Missions.bootstrap())
  assert.ok(goals.length > 0)
  assert.equal(goals[0].origin, 'synthesized')
  assert.ok('evidenceChain' in goals[0])                      // still the action-less Goal shape
})
