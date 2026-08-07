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
 * TD-UI-002 Crawl tab (ADR-012, Phase 1) — proof tests.
 *
 * node:test + node:assert/strict under tsx. Pure helpers (strategy parse, page
 * map, discovered-line count) tested directly. Route validation runs on a
 * throwaway express app (port 0) — only the 400/404 paths that return BEFORE any
 * engine call, so no crawl is ever launched. The engine-layer contract stubs
 * (EngineEventPublisher, CancellationToken) are tested directly.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import crawlRouter, {
  parseStrategy, mapModelPages, countDiscovered,
} from '../forge-ui/server/routes/crawl'
import { EngineEventPublisher, type EngineEvent } from '../src/core/events/EngineEventPublisher'
import { CancellationToken, CancellationError, NO_CANCELLATION } from '../src/core/events/CancellationToken'

/** One request against a throwaway app on an OS-assigned port; closes after. */
function once(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/crawl', crawlRouter)
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as any).port
        const res = await fetch(`http://localhost:${port}${urlPath}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const json = await res.json().catch(() => null)
        server.close(() => resolve({ status: res.status, json }))
      } catch (e) { server.close(() => reject(e)) }
    })
  })
}

// ── Strategy parse (engine mode → user-friendly label; ADR-012) ───────────────

test('C1 parseStrategy maps engine modes to friendly labels (both log patterns)', () => {
  // '[FORGE Crawler] Role: … | Mode: bfs | …' pattern
  assert.deepEqual(
    parseStrategy(['[FORGE Crawler] Role: user | Mode: bfs | Start: /']),
    { raw: 'bfs', label: 'Link Following' },
  )
  // '[StrategyDetector] Mode: spa | …' pattern (Issue #3)
  assert.equal(parseStrategy(['[StrategyDetector] Mode: spa | spa:false']).label, 'Click Discovery')
  assert.equal(parseStrategy(['x | Mode: hybrid | y']).label, 'Hybrid Exploration')
})

test('C2 parseStrategy: null when no Mode line is present', () => {
  assert.deepEqual(parseStrategy(['[FORGE Crawler] Discovered: /a']), { raw: null, label: null })
  assert.deepEqual(parseStrategy([]), { raw: null, label: null })
})

test('C3 parseStrategy: last Mode line wins (multi-role crawl)', () => {
  const lines = ['Role: a | Mode: bfs | s', 'Role: b | Mode: spa | s']
  assert.equal(parseStrategy(lines).raw, 'spa')
  assert.equal(parseStrategy(lines).label, 'Click Discovery')
})

test('C4 parseStrategy: ignores non-strategy Mode: values (constrained to bfs/spa/hybrid)', () => {
  assert.deepEqual(parseStrategy(['Mode: weird']), { raw: null, label: null })
  assert.deepEqual(parseStrategy(['[StrategyDetector] Mode: bfs']), { raw: 'bfs', label: 'Link Following' })
})

// ── Page mapping (app-model.json → table rows; audit ruling) ──────────────────

const MODEL = {
  app: { baseUrl: 'https://www.saucedemo.com' },
  pages: [
    {
      id: 'inventory-html', urlPattern: '/inventory.html',
      elements: [1, 2, 3], accessibleByRoles: ['user'],
      module: { name: 'Inventory', confidence: 'high' },
    },
    { id: 'x', urlPattern: '/x.html' },   // no module / elements / roles
  ],
}

test('C5 mapModelPages: url = baseUrl + urlPattern; element/module/role mapping', () => {
  const p0 = mapModelPages(MODEL)[0]
  assert.equal(p0.url, 'https://www.saucedemo.com/inventory.html')
  assert.equal(p0.urlPattern, '/inventory.html')
  assert.equal(p0.elements, 3)
  assert.equal(p0.module, 'Inventory')
  assert.equal(p0.moduleConfidence, 'high')
  assert.deepEqual(p0.roles, ['user'])
})

test('C6 mapModelPages: missing module → "Unknown"/null; safe count + role defaults', () => {
  const p1 = mapModelPages(MODEL)[1]
  assert.equal(p1.module, 'Unknown')
  assert.equal(p1.moduleConfidence, null)
  assert.equal(p1.elements, 0)
  assert.deepEqual(p1.roles, [])
})

test('C7 mapModelPages: null / empty / malformed model → []', () => {
  assert.deepEqual(mapModelPages(null), [])
  assert.deepEqual(mapModelPages({}), [])
  assert.deepEqual(mapModelPages({ pages: 'nope' }), [])
})

// ── Discovered-line counter (live page count) ─────────────────────────────────

test('C8 countDiscovered counts only the "Discovered:" lines', () => {
  const lines = [
    '[FORGE Crawler] Role: user | Mode: bfs | Start: /',
    '[FORGE Crawler] Discovered: /a (depth 0, ...)',
    '[FORGE Crawler] Discovered: /b (depth 1, ...)',
    '[PageVisitor] something else',
  ]
  assert.equal(countDiscovered(lines), 2)
  assert.equal(countDiscovered([]), 0)
})

// ── Route validation (returns BEFORE any engine call — no crawl launched) ──────

test('C9 POST /api/v1/crawl missing appName → 400 MISSING_APP_NAME', async () => {
  const res = await once('POST', '/api/v1/crawl', {})
  assert.equal(res.status, 400)
  assert.equal(res.json.code, 'MISSING_APP_NAME')
  assert.ok(res.json.error)
})

test('C10 GET /api/v1/crawl/:jobId/status unknown job → 404 NOT_FOUND', async () => {
  const res = await once('GET', '/api/v1/crawl/no-such-job/status')
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'NOT_FOUND')
})

// ── EngineEventPublisher (ADR-012 stub contract) ──────────────────────────────

test('C11 EngineEventPublisher.emit stamps id + ISO timestamp + type + payload', () => {
  const pub = new EngineEventPublisher()
  const seen: EngineEvent[] = []
  pub.on(e => seen.push(e))
  pub.emit('page.discovered', { url: '/a' })
  assert.equal(seen.length, 1)
  const e = seen[0]
  assert.equal(e.type, 'page.discovered')
  assert.deepEqual(e.payload, { url: '/a' })
  assert.ok(/^[0-9a-f-]{36}$/.test(e.id), 'id is a uuid')
  assert.ok(!Number.isNaN(Date.parse(e.timestamp)), 'timestamp is ISO')
})

test('C12 EngineEventPublisher fans out to all handlers; ids are unique', () => {
  const pub = new EngineEventPublisher()
  let a = 0, b = 0
  pub.on(() => a++)
  pub.on(() => b++)
  pub.emit('crawl.started', {})
  pub.emit('crawl.completed', { pagesFound: 3 })
  assert.equal(a, 2)
  assert.equal(b, 2)

  const ids: string[] = []
  const p2 = new EngineEventPublisher()
  p2.on(e => ids.push(e.id))
  p2.emit('warning', {})
  p2.emit('warning', {})
  assert.notEqual(ids[0], ids[1])
})

// ── CancellationToken (ADR-012 stub contract) ─────────────────────────────────

test('C13 CancellationToken: cancelled flips; throwIfCancelled respects it', () => {
  const t = new CancellationToken()
  assert.equal(t.cancelled, false)
  t.throwIfCancelled()             // no-op before cancel
  t.cancel()
  assert.equal(t.cancelled, true)
  assert.throws(() => t.throwIfCancelled(), CancellationError)
})

test('C14 NO_CANCELLATION is never cancelled (Phase 1 default)', () => {
  assert.equal(NO_CANCELLATION.cancelled, false)
})
