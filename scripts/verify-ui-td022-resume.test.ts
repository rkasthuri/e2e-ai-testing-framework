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
 * TD-UI-022 crawl-session resume — server-side proof tests (Option B).
 *
 * getActiveJob (JobRunner appName→jobId index) and the resume route
 * GET /api/v1/projects/:appName/crawl/active. The engine call
 * (executionContext.submit) is stubbed to hold a job in 'running' so the
 * lifecycle is observable without a real crawl. Non-'crawl' job types are used
 * so no workspace is provisioned. The CrawlPage resume EFFECT (React) is covered
 * manually per Option B — a component test harness is deferred (see the logged TD).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { JobRunner, jobRunner } from '../forge-ui/server/jobs/JobRunner'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'
import projectsRouter from '../forge-ui/server/routes/projects'

/** Stub executionContext.submit to hold every job in 'running' until released. */
function holdEngine(): { release: (r?: unknown) => void; restore: () => void } {
  const orig = executionContext.submit
  const resolvers: Array<(v: unknown) => void> = []
  ;(executionContext as any).submit = () => new Promise(r => resolvers.push(r as (v: unknown) => void))
  return {
    release: (r: unknown = { jobId: 'x', status: 'completed' }) => resolvers.splice(0).forEach(fn => fn(r)),
    restore: () => { (executionContext as any).submit = orig },
  }
}

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

// ── JobRunner.getActiveJob ────────────────────────────────────────────────────

test('D1 getActiveJob: running job returned, then null after complete', async () => {
  const jr = new JobRunner()
  const engine = holdEngine()
  let p: Promise<string> | undefined
  try {
    p = jr.submit({ jobId: 'j1', type: 'generate', appName: 'app-a', options: {} })
    const active = jr.getActiveJob('app-a')
    assert.equal(active?.jobId, 'j1')
    assert.equal(active?.status, 'running')
    engine.release({ jobId: 'x', status: 'completed' })
    await p
    assert.equal(jr.getActiveJob('app-a'), null)
  } finally {
    engine.release(); if (p) await p.catch(() => {}); engine.restore()
  }
})

test('D2 getActiveJob: null after a failed job', async () => {
  const jr = new JobRunner()
  const engine = holdEngine()
  let p: Promise<string> | undefined
  try {
    p = jr.submit({ jobId: 'j2', type: 'generate', appName: 'app-b', options: {} })
    assert.equal(jr.getActiveJob('app-b')?.jobId, 'j2')
    engine.release({ jobId: 'x', status: 'failed', error: 'boom' })
    await p
    assert.equal(jr.getActiveJob('app-b'), null)
  } finally {
    engine.release(); if (p) await p.catch(() => {}); engine.restore()
  }
})

test('D3 getActiveJob: null for an unknown appName', () => {
  assert.equal(new JobRunner().getActiveJob('no-such-app'), null)
})

test('D4 getActiveJob: correct appName→jobId index across concurrent apps', async () => {
  const jr = new JobRunner()
  const engine = holdEngine()
  let pA: Promise<string> | undefined
  let pB: Promise<string> | undefined
  try {
    pA = jr.submit({ jobId: 'jA', type: 'generate', appName: 'conc-a', options: {} })
    pB = jr.submit({ jobId: 'jB', type: 'generate', appName: 'conc-b', options: {} })
    assert.equal(jr.getActiveJob('conc-a')?.jobId, 'jA')
    assert.equal(jr.getActiveJob('conc-b')?.jobId, 'jB')
    engine.release({ jobId: 'x', status: 'completed' })
    await Promise.all([pA, pB])
    assert.equal(jr.getActiveJob('conc-a'), null)
    assert.equal(jr.getActiveJob('conc-b'), null)
  } finally {
    engine.release(); await Promise.all([pA, pB].map(p => p?.catch(() => {}))); engine.restore()
  }
})

// ── Route GET /api/v1/projects/:appName/crawl/active ──────────────────────────

test('A1 route → 404 { NOT_FOUND } when no active crawl', async () => {
  const res = await once('GET', '/api/v1/projects/no-active-app-xyz/crawl/active')
  assert.equal(res.status, 404)
  assert.equal(res.json.code, 'NOT_FOUND')
})

test('A2 route → 200 { jobId, status, startedAt } when a crawl is active', async () => {
  const engine = holdEngine()
  let p: Promise<string> | undefined
  try {
    // Seed the SINGLETON jobRunner (the route reads it) with a held job.
    p = jobRunner.submit({ jobId: 'route-j1', type: 'generate', appName: 'route-app', options: {} })
    const res = await once('GET', '/api/v1/projects/route-app/crawl/active')
    assert.equal(res.status, 200)
    assert.equal(res.json.data.jobId, 'route-j1')
    assert.equal(res.json.data.status, 'running')
    assert.ok(res.json.data.startedAt)
    assert.equal(res.json.data.lines, undefined)   // lightweight — no lines/pages
  } finally {
    engine.release(); if (p) await p.catch(() => {}); engine.restore()
  }
})
