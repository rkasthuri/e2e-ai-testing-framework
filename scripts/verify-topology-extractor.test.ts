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
 * TD-013 Phase 3 (Block 2b) — CrawlTopology extractor tests (pure, fixture AppModel).
 *   E1 observed flow step   → transition.grounding 'observed' (inherited 1:1)
 *   E2 inferred flow step   → 'inferred' (NO promotion — honesty guard)
 *   E3 grounding undefined  → 'inferred' (never 'observed' on absent evidence)
 *   E4 pages null + flows null → empty topology, no throw
 *   E5 element selector resolves via the reused EmitHelper builder (real selector, not id)
 *   E6 source === 'app-model'
 *   E7 bootstrap PageSignals → 1 page, 0 transitions, source 'live-page' (degenerate)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppModel, ElementDefinition, FlowStep } from '../src/core/onboarding/types'
import { PageSignals } from '../src/core/agent/GoalSynthesizer'
import { topologyFromAppModel, topologyFromPageSignals } from '../src/core/agent/TopologyExtractor'

// ── minimal fixture builders (only the fields the extractor reads) ───────────────
const elem = (): ElementDefinition => ({
  id: 'p1:login', name: 'login', kind: 'button', label: 'Login', critical: true,
  aiNamed: false, strategies: [{ type: 'data-test', value: 'login-button', confidence: 1 }],
  tier3Assertions: [],
} as unknown as ElementDefinition)

const step = (grounding?: 'observed' | 'inferred'): FlowStep => ({
  stepIndex: 0, pageId: 'p1', action: 'click', elementId: 'p1:login',
  targetPageId: 'p2', value: null, ...(grounding ? { grounding } : {}),
})

const model = (pages: unknown, steps: FlowStep[] | null): AppModel => ({
  app: { name: 'demo', baseUrl: 'https://demo.test', appType: 'web' },
  pages,
  flows: steps === null ? null : [{ id: 'f1', displayName: 'F1', steps, roleId: 'r',
    confidence: 'high', source: 'crawl', linkedApiEndpointIds: [] }],
} as unknown as AppModel)

const twoPages = [
  { id: 'p1', urlPattern: '/p1', displayName: 'P1', isAuthPage: false, elements: [elem()] },
  { id: 'p2', urlPattern: '/p2', displayName: 'P2', isAuthPage: false, elements: [] },
]

test('E1 observed flow step -> transition.grounding observed (inherited 1:1)', () => {
  const topo = topologyFromAppModel(model(twoPages, [step('observed')]))
  assert.equal(topo.pages.length, 2)
  assert.equal(topo.transitions.length, 1)
  assert.equal(topo.transitions[0].grounding, 'observed')
  assert.equal(topo.transitions[0].fromPageId, 'p1')
  assert.equal(topo.transitions[0].toPageId, 'p2')
})

test('E2 inferred flow step -> inferred (NO promotion)', () => {
  const topo = topologyFromAppModel(model(twoPages, [step('inferred')]))
  assert.equal(topo.transitions[0].grounding, 'inferred')
})

test('E3 grounding undefined -> inferred (never observed on absent evidence)', () => {
  const topo = topologyFromAppModel(model(twoPages, [step(undefined)]))
  assert.equal(topo.transitions[0].grounding, 'inferred')
})

test('E4 pages null + flows null -> empty topology, no throw', () => {
  const topo = topologyFromAppModel(model(null, null))
  assert.deepEqual(topo.pages, [])
  assert.deepEqual(topo.transitions, [])
})

test('E5 element selector resolves via reused builder (real selector, not element-id)', () => {
  const topo = topologyFromAppModel(model(twoPages, [step('observed')]))
  const el = topo.pages[0].elements[0]
  assert.equal(el.selector, '[data-test="login-button"]')
  assert.notEqual(el.selector, el.id)   // resolved selector, NOT the raw element-id
})

test('E6 source === app-model', () => {
  const topo = topologyFromAppModel(model(twoPages, [step('observed')]))
  assert.equal(topo.source, 'app-model')
})

test('E7 bootstrap PageSignals -> 1 page, 0 transitions, source live-page', () => {
  const signals: PageSignals = {
    navLinks: [{ text: 'Home', href: '/' }], buttonTexts: ['Login'],
    formPresence: true, currentUrl: 'https://demo.test/login', pageTitle: 'Login',
  }
  const topo = topologyFromPageSignals(signals)
  assert.equal(topo.pages.length, 1)
  assert.equal(topo.transitions.length, 0)
  assert.equal(topo.source, 'live-page')
  assert.equal(topo.pages[0].id, 'https://demo.test/login')
})

// ── Block 2c-i: flow-grouping restored over the flat transitions[] ───────────────
const modelWithFlows = (
  flows: Array<{ id: string; displayName: string; roleId: string; steps: FlowStep[] }>,
): AppModel => ({
  app: { name: 'demo', baseUrl: 'https://demo.test', appType: 'web' },
  pages: twoPages,
  flows: flows.map(f => ({ ...f, confidence: 'high', source: 'crawl', linkedApiEndpointIds: [] })),
} as unknown as AppModel)

const twoFlowModel = () => modelWithFlows([
  { id: 'fa', displayName: 'Flow A', roleId: 'admin', steps: [step('observed'), step('observed')] },
  { id: 'fb', displayName: 'Flow B', roleId: 'user',  steps: [step('inferred')] },
])

test('E8 two-flow fixture -> flows has 2 entries with correct ids/displayNames', () => {
  const topo = topologyFromAppModel(twoFlowModel())
  assert.equal(topo.flows.length, 2)
  assert.equal(topo.flows[0].id, 'fa'); assert.equal(topo.flows[0].displayName, 'Flow A')
  assert.equal(topo.flows[1].id, 'fb'); assert.equal(topo.flows[1].displayName, 'Flow B')
  assert.equal(topo.flows[0].roleId, 'admin'); assert.equal(topo.flows[1].roleId, 'user')
})

test('E9 flow ordering preserved — orderedTransitionIndices reflect step order exactly', () => {
  const topo = topologyFromAppModel(twoFlowModel())
  assert.equal(topo.transitions.length, 3)               // 2 (Flow A) + 1 (Flow B), flat
  assert.deepEqual(topo.flows[0].orderedTransitionIndices, [0, 1])
  assert.deepEqual(topo.flows[1].orderedTransitionIndices, [2])
})

test('E10 a transition traceable to its flow resolves the right grounding (grouping did not disturb 1:1)', () => {
  const topo = topologyFromAppModel(twoFlowModel())
  const faFirst = topo.transitions[topo.flows[0].orderedTransitionIndices[0]]
  const fbOnly  = topo.transitions[topo.flows[1].orderedTransitionIndices[0]]
  assert.equal(faFirst.grounding, 'observed')            // Flow A step was observed
  assert.equal(fbOnly.grounding, 'inferred')             // Flow B step was inferred — no promotion
})

test('E11 bootstrap/degenerate (0 flows) -> flows: []', () => {
  const topo = topologyFromAppModel(model(twoPages, null))
  assert.deepEqual(topo.flows, [])
  const signals: PageSignals = {
    navLinks: [], buttonTexts: [], formPresence: false,
    currentUrl: 'https://demo.test/', pageTitle: 'Home',
  }
  assert.deepEqual(topologyFromPageSignals(signals).flows, [])
})

test('E12 page prerequisites projected onto CrawlTopologyPage (grounding inherited 1:1)', () => {
  const pagesWithPrereq = [{
    id: 'p1', urlPattern: '/p1', displayName: 'P1', isAuthPage: true, elements: [elem()],
    prerequisites: [{ roleId: 'admin', steps: [
      { stepIndex: 0, pageId: 'p1', action: 'click', elementId: 'p1:login',
        targetPageId: 'p1', value: null, grounding: 'inferred' },
    ]}],
  }]
  const topo = topologyFromAppModel(model(pagesWithPrereq, null))
  assert.equal(topo.pages[0].prerequisites.length, 1)
  assert.equal(topo.pages[0].prerequisites[0].roleId, 'admin')
  assert.equal(topo.pages[0].prerequisites[0].steps[0].grounding, 'inferred')   // copied 1:1, not promoted
  // a page with no prerequisites projects to [] (never fabricated)
  const bare = topologyFromAppModel(model(twoPages, null))
  assert.deepEqual(bare.pages[1].prerequisites, [])
})
