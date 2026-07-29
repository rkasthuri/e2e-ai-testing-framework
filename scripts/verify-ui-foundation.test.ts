/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * Platform UI foundation — proof tests.
 *
 * node:test + node:assert/strict under tsx. Imports the forge-ui package
 * (constants, pure functions, stubs) and asserts source-level invariants for
 * the wiring that can't be unit-driven without a browser/live server (the
 * Step-5 boot smoke already curl-verified the live 501s).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { once } from 'node:events'
import express from 'express'
import cors from 'cors'
import { LOCAL_USER } from '../forge-ui/src/contexts/AuthContext'
import { LOCAL_TENANT } from '../forge-ui/src/contexts/TenantContext'
import { ExecutionContext } from '../forge-ui/server/context/ExecutionContext'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import {
  LOCAL_ONLY_HOST,
  isAllowedLocalOrigin,
  localCorsOptions,
  localOriginGuard,
  nextPort,
} from '../forge-ui/server/index'
import { notImplemented } from '../forge-ui/server/http'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')

// T1 — design tokens present
test('T1 design tokens: index.css defines --brand-primary + --signal-unknown', () => {
  const css = read('forge-ui/src/index.css')
  assert.match(css, /--brand-primary:\s*#E8650A/)
  assert.match(css, /--signal-unknown:\s*#8B5CF6/)   // purple = insufficient evidence
})

// T2 — AuthContext local/owner
test('T2 AuthContext: LOCAL_USER is owner/local (useAuth default)', () => {
  assert.equal(LOCAL_USER.role, 'owner')
  assert.equal(LOCAL_USER.tenantId, 'local')
})

// T3 — TenantContext single tenant
test('T3 TenantContext: LOCAL_TENANT id is local', () => {
  assert.equal(LOCAL_TENANT.id, 'local')
})

// T4 — ExecutionContext returns a jobId
test('T4 ExecutionContext.submit returns a job- jobId', async () => {
  // type:'run' is an honest stub (throws → caught) — proves the jobId+error
  // contract WITHOUT launching a real crawl in a unit test. All types share it.
  const res = await new ExecutionContext().submit({ type: 'run', appName: 'x', options: {} })
  assert.match(res.jobId, /^job-/)
  assert.equal(res.status, 'failed')       // 'run' not yet wired
  assert.ok(res.error)
})

// T5 — WorkspaceResolver returns a workspace with forgeDir
test('T5 WorkspaceResolver.resolve returns a Workspace with .forgeDir', () => {
  const cwd = process.cwd()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uiwr-'))
  try {
    process.chdir(dir)   // isolate any dir creation from the repo
    const ws = new WorkspaceResolver().resolve('any-app')
    assert.equal(typeof ws.forgeDir, 'string')
    assert.ok(ws.forgeDir.endsWith('.forge'))
    assert.equal(typeof ws.root, 'string')
  } finally { process.chdir(cwd) }
})

// T6 — stub route handler returns 501 + envelope
test('T6 notImplemented → 501 + error envelope', () => {
  let code = 0
  let body: any = null
  const res: any = {
    status(c: number) { code = c; return this },
    json(b: any) { body = b; return this },
  }
  notImplemented({} as any, res)
  assert.equal(code, 501)
  assert.equal(body.code, 'NOT_IMPLEMENTED')
  assert.ok(body.error && body.timestamp)
})

// T7 — port auto-detection skips 3001 (ruling C) + EADDRINUSE wiring present
test('T7 nextPort skips 3001; startServer wires it on EADDRINUSE', () => {
  assert.equal(nextPort(3000), 3002)   // skip 3001 (reserved for platform-server)
  assert.equal(nextPort(3002), 3003)
  const idx = read('forge-ui/server/index.ts')
  assert.match(idx, /EADDRINUSE/)
  assert.match(idx, /nextPort\(port\)/)
})

// T8 — forge ui CLI command exists
test('T8 cli.ts has the ui command wired to startServer', () => {
  const cli = read('src/core/onboarding/cli.ts')
  assert.match(cli, /case 'ui':/)
  assert.match(cli, /startServer/)
  assert.match(cli, /http:\/\/127\.0\.0\.1:\$\{actualPort\}/)
})

// T9 - the local browser-origin policy accepts loopback only.
test('T9 local origin policy accepts IPv4/IPv6 loopback and rejects other origins', () => {
  assert.equal(isAllowedLocalOrigin(undefined), true)
  assert.equal(isAllowedLocalOrigin('http://localhost:5173'), true)
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:3000'), true)
  assert.equal(isAllowedLocalOrigin('http://[::1]:5173'), true)
  assert.equal(isAllowedLocalOrigin('https://localhost:3000'), true)
  assert.equal(isAllowedLocalOrigin('https://example.com'), false)
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1.example.com'), false)
  assert.equal(isAllowedLocalOrigin('null'), false)
  assert.equal(isAllowedLocalOrigin('file:///tmp/forge.html'), false)
})

// T10 - live proof that the socket is loopback-only and the origin guard runs
// before a representative mutating route.
test('T10 local server boundary binds loopback and blocks unsafe-origin mutation', async () => {
  const app = express()
  let mutations = 0
  app.use(localOriginGuard)
  app.use(cors(localCorsOptions))
  app.use(express.json())
  app.post('/mutate', (_req, res) => {
    mutations += 1
    res.status(200).json({ ok: true })
  })

  const server = app.listen(0, LOCAL_ONLY_HOST)
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    assert.equal(address.address, LOCAL_ONLY_HOST)

    const allowed = await fetch(`http://${LOCAL_ONLY_HOST}:${address.port}/mutate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5173',
      },
      body: '{}',
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')

    const rejected = await fetch(`http://${LOCAL_ONLY_HOST}:${address.port}/mutate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://example.com',
      },
      body: '{}',
    })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.headers.get('access-control-allow-origin'), null)
    assert.equal(mutations, 1)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
})

// T11 - all three launch surfaces enforce an explicit loopback host, and the
// auxiliary servers reject unsafe browser origins before routing.
test('T11 primary and auxiliary servers wire the local-only boundary', () => {
  const ui = read('forge-ui/server/index.ts')
  assert.match(ui, /app\.listen\(port,\s*LOCAL_ONLY_HOST/)
  assert.match(ui, /app\.use\(localOriginGuard\)/)
  assert.doesNotMatch(ui, /app\.use\(cors\(\)\)/)

  const vite = read('forge-ui/vite.config.ts')
  assert.match(vite, /http:\/\/127\.0\.0\.1:3000/)
  assert.doesNotMatch(vite, /http:\/\/localhost:3000/)

  for (const rel of ['src/platform/dashboard-server.ts', 'src/platform/query-server.ts']) {
    const source = read(rel)
    assert.match(source, /server\.listen\(PORT,\s*LOCAL_ONLY_HOST/)
    assert.match(source, /if \(rejectUnsafeBrowserOrigin\(req,\s*res\)\) return/)
  }
})
