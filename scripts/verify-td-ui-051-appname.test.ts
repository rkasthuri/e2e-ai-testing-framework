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
 * TD-UI-051 (SECURITY) — unvalidated appName → filesystem path traversal. The
 * validator rejects every traversal/malformed segment; WorkspaceResolver +
 * TestFileResolver throw as a backstop (rethrow, not swallow-to-null); the routes
 * return 400. S12 is the regression floor — the exact camelCase fixture bug the
 * Step 0 audit caught must be rejected, so the validator can never silently pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import express from 'express'
import { assertValidAppName, isValidAppName, InvalidAppNameError } from '../forge-ui/server/context/appName'
import { workspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import { testFileResolver } from '../forge-ui/server/context/TestFileResolver'
import projectsRouter from '../forge-ui/server/routes/projects'

function once(method: string, urlPath: string): Promise<{ status: number; json: any }> {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter)
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as any).port
        const res = await fetch(`http://localhost:${port}${urlPath}`, { method })
        const json = await res.json().catch(() => null)
        server.close(() => resolve({ status: res.status, json }))
      } catch (e) { server.close(() => reject(e)) }
    })
  })
}

// ── S1–S12: the validator ─────────────────────────────────────────────────────

test('S1 valid names pass — single lowercase alnum-hyphen segment', () => {
  for (const v of ['saucedemo', 'restful-booker', 'orangehrm', 'a', 'x9', 'app-a', 'td120app']) {
    assert.equal(isValidAppName(v), true, `${v} must be valid`)
    assert.equal(assertValidAppName(v), v)
  }
})

const REJECTED: [string, string][] = [
  ['S2  ../etc (unix traversal)',        '../etc'],
  ['S3  ..\\etc (windows traversal)',    '..\\etc'],
  ['S4  a/b (forward slash)',            'a/b'],
  ['S5  a\\b (backslash)',               'a\\b'],
  ['S6  .. (parent)',                    '..'],
  ['S7  . (current)',                    '.'],
  ['S8  /etc/passwd (absolute)',         '/etc/passwd'],
  ['S9  C:\\Windows (drive letter)',     'C:\\Windows'],
  ['S10 a\0b (NUL byte)',                'a\0b'],
  ['S11 empty string',                   ''],
  ['S12 appA (uppercase — the fixture bug we just fixed) — REGRESSION FLOOR', 'appA'],
  ['S+  -app (leading hyphen)',          '-app'],
  ['S+  app.v2 (dot — non-conventional versioned name)', 'app.v2'],
]
for (const [label, input] of REJECTED) {
  test(label + ' → rejected', () => {
    assert.equal(isValidAppName(input), false, `${JSON.stringify(input)} must be invalid`)
    let err: unknown
    try { assertValidAppName(input) } catch (e) { err = e }
    assert.ok(err instanceof InvalidAppNameError, 'must throw InvalidAppNameError')
    assert.equal((err as InvalidAppNameError).code, 'INVALID_APP_NAME')
  })
}

// ── Backstop: WorkspaceResolver throws (defence-in-depth) ──────────────────────

test('B1 WorkspaceResolver.resolve(traversal) THROWS — traversal never reaches path.join', () => {
  assert.throws(() => workspaceResolver.resolve('../../../etc'), InvalidAppNameError)
})
test('B2 WorkspaceResolver.provision(traversal) THROWS — never mkdir outside the root', () => {
  assert.throws(() => workspaceResolver.provision('../x'), InvalidAppNameError)
})
test('B3 WorkspaceResolver.resolve(valid) still works', () => {
  const ws = workspaceResolver.resolve('saucedemo')
  assert.ok(ws.root.endsWith(`${require('path').sep}saucedemo`))
})

// ── Rethrow, not swallow: TestFileResolver ────────────────────────────────────

test('R1 TestFileResolver.read(traversal, id) THROWS — a traversal is not a not-found', () => {
  assert.throws(() => testFileResolver.read('../../../etc', 'anything'), InvalidAppNameError)
})
test('R2 TestFileResolver.read(valid, manifest-ABSENT) returns NULL — step-1 catch (no manifest on disk)', () => {
  assert.equal(testFileResolver.read('zzz-no-such-app-xyz', 'no-such-id'), null)
})
test('R3 TestFileResolver.read(valid, real manifest, ABSENT fileId) returns NULL — step-2 branch, NOT a throw', () => {
  // Distinct no-oracle branch from R2: here the manifest EXISTS and parses; the
  // requested id is simply not in it (`if (!entry) return null`). Override the
  // home dir (WorkspaceResolver uses os.homedir()) so the workspace is a temp dir.
  const savedUP = process.env.USERPROFILE
  const savedHOME = process.env.HOME
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r3home-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  try {
    const ws = workspaceResolver.resolve('r3-app')          // → <home>/.forge-projects/r3-app
    fs.mkdirSync(ws.forgeDir, { recursive: true })
    fs.writeFileSync(
      path.join(ws.forgeDir, 'generation-manifest.json'),
      JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        files: [{ id: 'known-id', relativePath: 'tests/known.spec.ts' }],
      }),
    )
    // manifest present + parsed, requested id NOT in files → null (not throw)
    assert.equal(testFileResolver.read('r3-app', 'absent-id-not-in-manifest'), null)
  } finally {
    if (savedUP === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUP
    if (savedHOME === undefined) delete process.env.HOME; else process.env.HOME = savedHOME
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// ── Route entry → 400 ─────────────────────────────────────────────────────────

test('E1 GET /:appName/... with a dotted segment → 400 INVALID_APP_NAME', async () => {
  const res = await once('GET', '/api/v1/projects/app.bad/crawl/active')
  assert.equal(res.status, 400)
  assert.equal(res.json.code, 'INVALID_APP_NAME')
})
test('E2 GET /:appName/... with uppercase → 400 INVALID_APP_NAME', async () => {
  const res = await once('GET', '/api/v1/projects/AppName/crawl/active')
  assert.equal(res.status, 400)
  assert.equal(res.json.code, 'INVALID_APP_NAME')
})
test('E3 GET /:appName/... with a VALID name → NOT 400 (guard does not over-reject)', async () => {
  const res = await once('GET', '/api/v1/projects/saucedemo/crawl/active')
  assert.notEqual(res.status, 400)   // 404 (no active crawl) — the point is the guard let it through
})
