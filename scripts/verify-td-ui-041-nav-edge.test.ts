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
 * TD-UI-041 nav-edge — two latent lies fixed defensively:
 *   BFS stamped trigger:'navigation' (a fake element id); hybrid emitted
 *   visit-order PROXIMITY edges (a fabricated navigation). Now BFS JOINs the
 *   anchor by resolved href (real id, or NULL on miss — never 'navigation'), and
 *   hybrid emits NO edge. A joined edge is grounding:'observed'. node:test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Crawler } from '../src/core/onboarding/Crawler'
import { FlowDetector } from '../src/core/onboarding/FlowDetector'
import { createExplorationMap, markDiscovered } from '../src/core/onboarding/PageExplorationRecord'
import { normalizeUrl } from '../src/core/onboarding/PageVisitor'

const A = 'https://x.example.com/a'
const B = 'https://x.example.com/b'
const C = 'https://x.example.com/c'

// buildRoleStateEdges is private — drive it directly (same pattern as the shape test).
type CrawlerPriv = {
  buildRoleStateEdges(pages: unknown[], map: unknown, mode: string, roleId: string, spaEdges?: unknown): any[]
}
function edgesFor(mode: string, pagesElements: any[], outbound: string[], spaEdges?: any[]): any[] {
  const map = createExplorationMap()
  markDiscovered(map, normalizeUrl(A))
  markDiscovered(map, normalizeUrl(B))
  const pages = [
    { pageId: 'a', urlPattern: '/a', elements: pagesElements, outboundUrls: outbound, domHash: '', isAuthPage: false },
    { pageId: 'b', urlPattern: '/b', elements: [], outboundUrls: [], domHash: '', isAuthPage: false },
  ]
  const crawler = new Crawler({ app: { name: 'x', baseUrl: 'https://x.example.com', appType: 'web-ui' }, roles: [] } as any) as unknown as CrawlerPriv
  return crawler.buildRoleStateEdges(pages as any, map, mode, 'user', spaEdges)
}

test('J1 BFS edge JOINS to the real element id when the anchor was classified', () => {
  const edges = edgesFor('bfs', [{ id: 'a:cartLink', name: 'cartLink', href: B }], [B])
  const edge = edges.find(e => e.toUrl === normalizeUrl(B))
  assert.ok(edge, 'edge a→b must exist')
  assert.equal(edge.trigger, 'a:cartLink')   // the real clicked-element id, recovered by href join
})

test('J2 BFS edge with an unclassifiable/missing anchor → trigger NULL, never "navigation"', () => {
  // outbound href B exists (edge built), but no element carries href === B.
  const edges = edgesFor('bfs', [{ id: 'a:other', name: 'other', href: 'https://x.example.com/unrelated' }], [B])
  const edge = edges.find(e => e.toUrl === normalizeUrl(B))
  assert.ok(edge, 'edge a→b must still exist')
  assert.equal(edge.trigger, null, 'a missed join is NULL')
  // Anti-regression: the magic string must NEVER appear as a trigger anywhere.
  assert.equal(edges.some(e => e.trigger === 'navigation'), false, 'the string "navigation" must never be an element id')
})

test('J3 hybrid mode emits NO proximity edges (fabrication deleted)', () => {
  const edges = edgesFor('hybrid', [{ id: 'a:link', name: 'link', href: B }], [B])
  assert.deepEqual(edges, [], 'proximity is not evidence of navigability — emit nothing')
})

test('J5 SPA path unchanged — spaEdges triggers pass through verbatim (was already honest)', () => {
  const edges = edgesFor('spa', [], [], [{ fromUrl: normalizeUrl(A), toUrl: normalizeUrl(B), trigger: 'a:clickedRealElement' }])
  const edge = edges.find(e => e.toUrl === normalizeUrl(B))
  assert.ok(edge, 'spa edge must exist')
  assert.equal(edge.trigger, 'a:clickedRealElement')
})

// ── J4: grounding — driven through FlowDetector.identifyCandidates() (sync, no AI) ──

type FDPriv = { identifyCandidates(): { steps: any[] }[] }

test('J4 a joined edge carries grounding:"observed"; a null-trigger edge carries "inferred"', () => {
  const stateGraph = {
    nodes: new Map(),
    edges: [
      { fromUrl: A, toUrl: B, trigger: 'a:cartLink', roleId: 'user' },   // joined → observed
      { fromUrl: B, toUrl: C, trigger: null,          roleId: 'user' },   // missed → inferred
    ],
  }
  const fd = new FlowDetector(
    stateGraph as any, [], [],
    { app: { name: 'x', baseUrl: 'https://x.example.com', appType: 'web-ui' }, roles: [] } as any,
    { remaining: 0, consume: () => false, isExhausted: () => true } as any,
  ) as unknown as FDPriv
  const cand = fd.identifyCandidates()
  const steps = cand.flatMap(c => c.steps)
  const joined = steps.find(s => s.elementId === 'a:cartLink')
  const missed = steps.find(s => s.elementId === null)
  assert.equal(joined?.grounding, 'observed', 'a joined edge is observed')
  assert.equal(missed?.grounding, 'inferred', 'a missed join is inferred')
  // And the fake id never reaches a flow step.
  assert.equal(steps.some(s => s.elementId === 'navigation'), false)
})
