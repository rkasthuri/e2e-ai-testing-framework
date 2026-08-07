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
 * TD-UI-001 Onboard — proof tests.
 *
 * node:test + node:assert/strict under tsx. Registry + route tests run against
 * a TEMP home (env override) so the real ~/.forge is never touched. The route
 * is mounted on a throwaway express app bound to port 0 (OS-assigned) and
 * closed after each request. Validation tests (missing url/appName) return 400
 * BEFORE any engine call, so no crawl is launched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import express from 'express'
import projectsRouter from '../forge-ui/server/routes/projects'
import { ProjectRegistry } from '../forge-ui/server/registry/ProjectRegistry'
import { deriveAppName } from '../forge-ui/src/lib/deriveAppName'
import { CONFIDENCE_CONFIG } from '../forge-ui/src/components/shared/ConfidenceBadge'

// The route's projectRegistry singleton binds to the real ~/.forge at import.
// This machine has no ~/.forge/projects.json (verified), so GET returns [].
// T1-T3 use freshRegistry() with a temp home for isolated write tests.

/** One request against a throwaway app on an OS-assigned port; closes after. */
function once(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter)
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

function freshRegistry(): ProjectRegistry {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'))
  process.env.HOME = dir; process.env.USERPROFILE = dir
  return new ProjectRegistry()   // reads home in its constructor
}
const entry = (appName: string, url = 'https://x') => ({
  appName, url, workspacePath: '/w', createdAt: 't', lastOpenedAt: 't',
})

// ── T1-T3, T6: ProjectRegistry + GET ──────────────────────────────────────────

test('T1 ProjectRegistry.list() → [] when the registry file is missing', () => {
  assert.deepEqual(freshRegistry().list(), [])
})

test('T2 register() writes an entry; list() returns it', () => {
  const r = freshRegistry()
  r.register(entry('saucedemo'))
  assert.equal(r.list().length, 1)
  assert.equal(r.find('saucedemo')?.appName, 'saucedemo')
})

test('T3 register() updates an existing entry (no duplicate)', () => {
  const r = freshRegistry()
  r.register(entry('saucedemo', 'https://a'))
  r.register(entry('saucedemo', 'https://b'))
  assert.equal(r.list().length, 1)
  assert.equal(r.find('saucedemo')?.url, 'https://b')
})

test('T6 GET /api/v1/projects → discovered projects (fixtures always present)', async () => {
  // Isolate the registry to a temp EMPTY home; GET still returns the
  // auto-discovered apps (Step 6) — the 3 known fixtures are always included.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-empty-'))
  process.env.HOME = empty; process.env.USERPROFILE = empty
  const res = await once('GET', '/api/v1/projects')
  assert.equal(res.status, 200)
  const names = res.json.data.projects.map((p: any) => p.appName)
  assert.ok(
    ['saucedemo', 'orangehrm', 'restful-booker'].every(n => names.includes(n)),
    `fixtures missing from discovery: ${names}`,
  )
})

// ── T4-T5: POST validation (400 before any engine call) ───────────────────────

test('T4 POST /api/v1/projects missing url → 400 MISSING_URL', async () => {
  const res = await once('POST', '/api/v1/projects', { appName: 'x' })
  assert.equal(res.status, 400)
  assert.equal(res.json.code, 'MISSING_URL')
  assert.ok(res.json.error)
})

test('T5 POST /api/v1/projects missing appName → 400 MISSING_APP_NAME', async () => {
  const res = await once('POST', '/api/v1/projects', { url: 'https://x' })
  assert.equal(res.status, 400)
  assert.equal(res.json.code, 'MISSING_APP_NAME')
})

// ── T7-T8: pure UI helpers ────────────────────────────────────────────────────

test('T7 deriveAppName from URL', () => {
  assert.equal(deriveAppName('https://www.saucedemo.com'), 'saucedemo')
  assert.equal(deriveAppName('https://opensource-demo.orangehrmlive.com'), 'orangehrmlive')
  // Non-URL input slugifies (preserves internal hyphens) — Step-1 correction B.
  assert.equal(deriveAppName('not-a-url'), 'not-a-url')
})

test('T8 ConfidenceBadge config: humanized labels + semantic colors (Nova Q5)', () => {
  assert.equal(CONFIDENCE_CONFIG.high.label, 'Verified')
  assert.equal(CONFIDENCE_CONFIG.high.colorClass, 'text-pass')     // green
  assert.equal(CONFIDENCE_CONFIG.medium.label, 'Likely')
  assert.equal(CONFIDENCE_CONFIG.medium.colorClass, 'text-flaky')  // amber
  assert.equal(CONFIDENCE_CONFIG.low.label, 'Uncertain')
  assert.equal(CONFIDENCE_CONFIG.low.colorClass, 'text-fail')      // red
  assert.equal(CONFIDENCE_CONFIG.unknown.label, 'Unknown')
  assert.equal(CONFIDENCE_CONFIG.unknown.colorClass, 'text-unknown') // purple
  // every level has a tooltip
  for (const k of ['high', 'medium', 'low', 'unknown']) {
    assert.ok(CONFIDENCE_CONFIG[k].tooltip.length > 0)
  }
})
