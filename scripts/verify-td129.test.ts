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
 * TD-129 — proof tests (visitForDiscoveryOnly + SPAStrategy sweep-only wiring).
 *
 * node:test + node:assert/strict under tsx. Fakes only: a recording page/context
 * for the PageVisitor tests, a spying visitor + stubbed discover* for the
 * SPAStrategy tests. No browser, no AI.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PageVisitor, normalizeUrl } from '../src/core/onboarding/PageVisitor'
import { SPAStrategy } from '../src/core/onboarding/SPAStrategy'
import { CrawlConfig } from '../src/core/onboarding/BFSStrategy'
import { markDiscovered, createExplorationMap } from '../src/core/onboarding/PageExplorationRecord'
import { AiBudgetTracker } from '../src/core/onboarding/types'

const BASE = 'https://x.com'
const cfg: CrawlConfig = { baseUrl: BASE, maxPages: 50, maxDepth: 5 }
const ctxOf = (page: any) => ({ newPage: async () => page }) as any

/** Budget that records every consume — proves whether ANY AI naming fired. */
function spyBudget(): AiBudgetTracker & { consumed: number } {
  const s = { consumed: 0 }
  return {
    get remaining() { return 50 - s.consumed }, get consumed() { return s.consumed },
    consume(n: number) { s.consumed += n; return true }, isExhausted() { return false },
  } as any
}

/** Recording fake page — captures goto/waitForTimeout args. */
function recPage() {
  const calls = { goto: [] as any[], waited: [] as number[], closed: false }
  const page = {
    goto: async (url: string, opts: any) => { calls.goto.push([url, opts]) },
    waitForTimeout: async (ms: number) => { calls.waited.push(ms) },
    close: async () => { calls.closed = true },
  }
  return { page, calls }
}

// ── T1-T3: PageVisitor.visitForDiscoveryOnly ──────────────────────────────────

test('T1 visitForDiscoveryOnly navigates to the url (domcontentloaded, 30s) + hydration settle', async () => {
  const { page, calls } = recPage()
  const budget = spyBudget()
  await new PageVisitor(BASE, budget).visitForDiscoveryOnly(ctxOf(page), `${BASE}/p`)
  assert.deepEqual(calls.goto, [[`${BASE}/p`, { waitUntil: 'domcontentloaded', timeout: 30000 }]])
  assert.deepEqual(calls.waited, [1000])   // same hydration settle as gotoAndClassify
})

test('T2 visitForDiscoveryOnly returns { page } only — no discovery/PageDiscovery', async () => {
  const { page } = recPage()
  const res = await new PageVisitor(BASE, spyBudget()).visitForDiscoveryOnly(ctxOf(page), `${BASE}/p`)
  assert.deepEqual(Object.keys(res), ['page'])
  assert.equal((res as any).discovery, undefined)
  assert.equal(res.page, page)
})

test('T3 visitForDiscoveryOnly consumes ZERO AI budget (no ElementClassifier path)', async () => {
  const { page } = recPage()
  const budget = spyBudget()
  await new PageVisitor(BASE, budget).visitForDiscoveryOnly(ctxOf(page), `${BASE}/p`)
  assert.equal(budget.consumed, 0, 'visitForDiscoveryOnly consumed AI budget — it must not classify')
})

// ── T4-T6: SPAStrategy sweep-only branch uses the primitive ───────────────────

/** SPA whose visitor spies which method is called; discover* stubbed to capture the elements arg. */
function spaSpy() {
  const budget = spyBudget()
  const s = new SPAStrategy(cfg, budget)
  const calls = { keepOpen: [] as string[], discoveryOnly: [] as string[], elementsSeen: [] as any[] }
  const fakePage = () => ({ close: async () => {} }) as any
  ;(s as any).visitor = {
    visitKeepOpen: async (_c: any, url: string) => { calls.keepOpen.push(normalizeUrl(url)); return { page: fakePage(), discovery: { pageId: url, urlPattern: url, elements: [{ id: 'e1' }], outboundUrls: [], domHash: 'h', isAuthPage: false } } },
    visitForDiscoveryOnly: async (_c: any, url: string) => { calls.discoveryOnly.push(normalizeUrl(url)); return { page: fakePage() } },
  }
  ;(s as any).discoverViaSelectors = async (_p: any, _u: string, _c: Set<string>, elements: any[]) => { calls.elementsSeen.push(elements); return [] }
  ;(s as any).discoverViaButtonText = async () => []
  return { s, calls, budget }
}

test('T4 sweep-only (discovered && !swept) uses visitForDiscoveryOnly, NOT visitKeepOpen', async () => {
  const map = createExplorationMap(); markDiscovered(map, `${BASE}/bfs`)   // BFS-discovered, unswept
  const { s, calls } = spaSpy()
  await s.crawl({} as any, `${BASE}/`, map, 50, [`${BASE}/bfs`])
  assert.deepEqual(calls.discoveryOnly, [`${BASE}/bfs`], 'sweep page not routed to visitForDiscoveryOnly')
  assert.equal(calls.keepOpen.includes(`${BASE}/bfs`), false, 'sweep page wrongly used visitKeepOpen')
})

test('T4b genuinely-new page still uses visitKeepOpen (full classify) — contrast', async () => {
  const map = createExplorationMap()   // /new not yet discovered
  const { s, calls } = spaSpy()
  await s.crawl({} as any, `${BASE}/new`, map, 50)
  assert.deepEqual(calls.keepOpen, [`${BASE}/new`])
  assert.equal(calls.discoveryOnly.includes(`${BASE}/new`), false)
})

test('T5 sweep-only passes elements:[] to discoverViaSelectors (new page passes its real elements)', async () => {
  // sweep-only path
  const sweepMap = createExplorationMap(); markDiscovered(sweepMap, `${BASE}/bfs`)
  const sweep = spaSpy()
  await sweep.s.crawl({} as any, `${BASE}/`, sweepMap, 50, [`${BASE}/bfs`])
  assert.deepEqual(sweep.calls.elementsSeen[0], [], 'sweep-only did not pass elements:[]')
  // new-page path passes the classified elements (contrast)
  const newMap = createExplorationMap()
  const fresh = spaSpy()
  await fresh.s.crawl({} as any, `${BASE}/new`, newMap, 50)
  assert.deepEqual(fresh.calls.elementsSeen[0], [{ id: 'e1' }])
})

test('T6 sweep-only fires NO aiCall — budget unchanged after the sweep', async () => {
  const map = createExplorationMap(); markDiscovered(map, `${BASE}/bfs`)
  const { s, budget } = spaSpy()
  await s.crawl({} as any, `${BASE}/`, map, 50, [`${BASE}/bfs`])
  assert.equal(budget.consumed, 0, 'sweep-only consumed AI budget — TD-129 not effective')
})
