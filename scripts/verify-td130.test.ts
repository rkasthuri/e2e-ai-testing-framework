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
 * TD-130 — proof tests (CrawlScheduler + visits-first scheduling in
 * SPAStrategy, 60/40 split removal in HybridStrategy).
 *
 * node:test + node:assert/strict under tsx. Strategy tests drive the REAL
 * crawl() control flow with a sequence-recording fake visitor + stubbed
 * discover* — no browser, no AI. Hybrid budget test stubs the strategy
 * prototypes to capture the budgets actually passed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrawlScheduler } from '../src/core/onboarding/CrawlScheduler'
import { SPAStrategy } from '../src/core/onboarding/SPAStrategy'
import { BFSStrategy, CrawlConfig } from '../src/core/onboarding/BFSStrategy'
import { HybridStrategy } from '../src/core/onboarding/HybridStrategy'
import { normalizeUrl } from '../src/core/onboarding/PageVisitor'
import { createExplorationMap, markDiscovered, isSwept } from '../src/core/onboarding/PageExplorationRecord'
import { PageDiscovery, AiBudgetTracker } from '../src/core/onboarding/types'

const BASE = 'https://x.com'
const cfg: CrawlConfig = { baseUrl: BASE, maxPages: 50, maxDepth: 5 }
const noBudget = (): AiBudgetTracker => ({ remaining: 999, consume: () => true, isExhausted: () => false })
const ctx = {} as any

function disc(url: string): PageDiscovery {
  return { pageId: url, urlPattern: url, elements: [], outboundUrls: [], domHash: 'h', isAuthPage: false }
}

/** SPA whose visitor records a labeled open sequence; click graph drives discovery. */
function spaSeq(clickGraph: Record<string, string[]>, config: CrawlConfig = cfg) {
  const s = new SPAStrategy(config, noBudget())
  const seq: string[] = []
  const fakePage = () => ({ close: async () => {} }) as any
  ;(s as any).visitor = {
    visitKeepOpen:         async (_c: any, url: string) => { seq.push(`visit:${normalizeUrl(url)}`); return { page: fakePage(), discovery: disc(url) } },
    visitForDiscoveryOnly: async (_c: any, url: string) => { seq.push(`sweep:${normalizeUrl(url)}`); return { page: fakePage() } },
  }
  ;(s as any).discoverViaSelectors = async (_p: any, url: string) =>
    (clickGraph[normalizeUrl(url)] ?? []).map(u => ({ url: u, trigger: 'click' }))
  ;(s as any).discoverViaButtonText = async () => []
  return { s, seq }
}

// ── T1-T5: CrawlScheduler unit behavior ───────────────────────────────────────

test('T1 seedSweeps + next() returns sweep items (depth 0)', () => {
  const sch = new CrawlScheduler()
  sch.seedSweeps(['a', 'b'])
  assert.deepEqual(sch.next(), { url: 'a', type: 'sweep', depth: 0 })
  assert.deepEqual(sch.next(), { url: 'b', type: 'sweep', depth: 0 })
})

test('T2 enqueueVisit + next() returns the visit before a queued sweep', () => {
  const sch = new CrawlScheduler()
  sch.enqueueSweep('s', 0)
  sch.enqueueVisit('v', 1)
  assert.equal(sch.next()!.url, 'v')
  assert.equal(sch.next()!.url, 's')
})

test('T3 visits-first even when the sweep queue was seeded first', () => {
  const sch = new CrawlScheduler()
  sch.seedSweeps(['s1', 's2', 's3'])
  sch.enqueueVisit('v', 1)
  assert.deepEqual(sch.next(), { url: 'v', type: 'visit', depth: 1 })
})

test('T4 next() returns null when both queues are empty', () => {
  assert.equal(new CrawlScheduler().next(), null)
})

test('T5 hasWork() false when both empty, true when either holds work', () => {
  const sch = new CrawlScheduler()
  assert.equal(sch.hasWork(), false)
  sch.seedSweeps(['s']); assert.equal(sch.hasWork(), true)
  sch.next();            assert.equal(sch.hasWork(), false)
  sch.enqueueVisit('v', 1); assert.equal(sch.hasWork(), true)
  assert.equal(sch.pendingVisits(), 1)
  assert.equal(sch.pendingSweeps(), 0)
})

// ── T6-T8, T10: SPAStrategy scheduling behavior ───────────────────────────────

test('T6 sweep that discovers a new URL → new URL processed as a VISIT (classified)', async () => {
  const map = createExplorationMap(); markDiscovered(map, `${BASE}/s1`)
  const { s, seq } = spaSeq({ [`${BASE}/s1`]: [`${BASE}/newX`] })
  await s.crawl(ctx, `${BASE}/`, map, 50, [`${BASE}/s1`])
  assert.ok(seq.includes(`visit:${BASE}/newX`), `newX not visited/classified — seq: ${seq}`)
})

test('T7+T10 no starvation: visit jumps ahead of 4 pending sweeps (visits-first behavioral proof)', async () => {
  const map = createExplorationMap()
  const seeds = ['p1', 'p2', 'p3', 'p4', 'p5'].map(p => `${BASE}/${p}`)
  seeds.forEach(u => markDiscovered(map, u))
  // sweeping p1 surfaces newX; p2-p5 sweeps still pending at that moment
  const { s, seq } = spaSeq({ [`${BASE}/p1`]: [`${BASE}/newX`] })
  await s.crawl(ctx, `${BASE}/`, map, 50, seeds)
  assert.deepEqual(seq, [
    `sweep:${BASE}/p1`,
    `visit:${BASE}/newX`,   // ← jumped the 4 remaining sweeps
    `sweep:${BASE}/p2`, `sweep:${BASE}/p3`, `sweep:${BASE}/p4`, `sweep:${BASE}/p5`,
  ])
})

test('T8 budget exhausted mid-sweep → remaining sweeps not processed', async () => {
  const map = createExplorationMap()
  const seeds = ['p1', 'p2', 'p3'].map(p => `${BASE}/${p}`)
  seeds.forEach(u => markDiscovered(map, u))
  const { s, seq } = spaSeq({})
  await s.crawl(ctx, `${BASE}/`, map, 2, seeds)
  assert.equal(seq.length, 2, `budget 2 must cap opens at 2 — seq: ${seq}`)
  assert.equal(isSwept(map, `${BASE}/p3`), false, 'p3 processed despite exhausted budget')
})

// ── T9: HybridStrategy — no 60/40 split ───────────────────────────────────────

test('T9 Hybrid passes FULL budget to BFS and full remainder to SPA (no 60/40)', async () => {
  const bfsOrig = BFSStrategy.prototype.crawl
  const spaOrig = SPAStrategy.prototype.crawl
  const captured = { bfsBudget: -1, spaBudget: -1 }
  try {
    BFSStrategy.prototype.crawl = async function (_c, _s, map, budget) {
      captured.bfsBudget = budget!
      // simulate BFS finding 22 pages, all discovered-unswept
      const pages: PageDiscovery[] = []
      for (let i = 0; i < 22; i++) {
        const u = `${BASE}/bfs${i}`
        markDiscovered(map!, u)
        pages.push(disc(u))
      }
      return pages
    }
    SPAStrategy.prototype.crawl = async function (_c, _s, _map, budget) {
      captured.spaBudget = budget!
      return []
    }
    await new HybridStrategy(cfg, noBudget()).crawl(ctx, `${BASE}/`, createExplorationMap(), 50)
  } finally {
    BFSStrategy.prototype.crawl = bfsOrig
    SPAStrategy.prototype.crawl = spaOrig
  }
  assert.equal(captured.bfsBudget, 50, 'BFS must receive the full budget (was 60% cap)')
  assert.equal(captured.spaBudget, 28, 'SPA must receive budget - bfsUsed = 50 - 22 = 28 (was floor(40%) = 20)')
})

// ── T11: per-item depth gate (ruling S1) ──────────────────────────────────────

test('T11 depth gate is per-item: discoveries from a page AT maxDepth are not followed', async () => {
  const shallow: CrawlConfig = { baseUrl: BASE, maxPages: 50, maxDepth: 1 }
  const map = createExplorationMap()
  // start (depth 0) discovers newX (depth 1); newX discovers deep2 — but
  // newX.depth === maxDepth, so its discovery must not run.
  const { s, seq } = spaSeq({ [BASE]: [`${BASE}/newX`], [`${BASE}/newX`]: [`${BASE}/deep2`] }, shallow)
  await s.crawl(ctx, `${BASE}/`, map, 50)
  assert.ok(seq.includes(`visit:${BASE}/newX`), 'depth-1 page itself must still be visited')
  assert.equal(seq.some(e => e.endsWith('/deep2')), false, `deep2 followed past maxDepth — seq: ${seq}`)
})
