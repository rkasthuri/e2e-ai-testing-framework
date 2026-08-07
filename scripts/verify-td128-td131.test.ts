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
 * TD-128 (isSpa evidence accumulation) + TD-131 (headless default + signal
 * cleanup) — proof tests.
 *
 * node:test + node:assert/strict under tsx. T5-T7 exercise the pure
 * evaluateSpaEvidence (production decision code). T1/T2 monkeypatch
 * chromium.launch to capture the real headless option. T8 tests the real
 * registerBrowserCleanup helper against the live process listeners.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { chromium } from '@playwright/test'
import { evaluateSpaEvidence, SpaEvidence } from '../src/core/onboarding/StrategyDetector'
import { Crawler, registerBrowserCleanup } from '../src/core/onboarding/Crawler'

const REPO_ROOT = path.resolve(__dirname, '..')
const src = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8')

function evidence(p: Partial<SpaEvidence>): SpaEvidence {
  return { runtimeGlobals: false, rootContainer: false, frameworkAttr: false, frameworkScript: false, ...p }
}

const webCfg = {
  app:   { name: 'x', baseUrl: 'https://x.com', appType: 'web-ui' },
  roles: [],
  budgets: { aiCalls: 20, maxPages: 10, maxDepth: 5 },
} as any

/** Run crawl() far enough to hit chromium.launch, capturing its headless option. */
async function captureLaunchHeadless(headed: boolean): Promise<boolean> {
  const crawler = new Crawler(webCfg, { headed })
  const orig = chromium.launch
  let captured: boolean | undefined
  ;(chromium as any).launch = async (opts: any) => {
    captured = opts.headless
    throw new Error('STOP-AFTER-CAPTURE')
  }
  try { await crawler.crawl() } catch { /* expected STOP */ }
  finally { (chromium as any).launch = orig }
  return captured as boolean
}

// ── T1-T2: Crawler launch headless option (real launch call) ──────────────────

test('T1 Crawler default → headless (headed omitted)', async () => {
  assert.equal(await captureLaunchHeadless(false), true)
})

test('T2 Crawler headed:true → headed browser (headless:false)', async () => {
  assert.equal(await captureLaunchHeadless(true), false)
})

// ── T3-T4: wiring (source-level — run()/cli main() are heavy integration paths) ─

test('T3 CrawlRunner passes headed: options.headed ?? false (default false)', () => {
  const content = src('src/core/runner/CrawlRunner.ts')
  assert.match(content, /headed:\s*options\.headed\s*\?\?\s*false/)
})

test('T4 CLI maps --headed → headed:true (presence flag)', () => {
  const content = src('src/core/onboarding/cli.ts')
  assert.match(content, /headed:\s*args\.includes\('--headed'\)/)
  // semantics of the presence flag
  assert.equal(['--headed'].includes('--headed'), true)
  assert.equal([].includes('--headed' as never), false)
})

// ── T5-T7 + T6b: evaluateSpaEvidence (Nova Q2 evidence accumulation) ──────────

test('T5 runtime globals → isSpa:true (strong signal, preserved)', () => {
  assert.equal(evaluateSpaEvidence(evidence({ runtimeGlobals: true })), true)
  // sufficient alone, even with zero DOM signals
})

test('T6 no globals + #app + framework script → isSpa:true (2 DOM signals sufficient)', () => {
  assert.equal(evaluateSpaEvidence(evidence({ rootContainer: true, frameworkScript: true })), true)
})

test('T6b no globals + #app ONLY → isSpa:false (1 DOM signal not sufficient)', () => {
  assert.equal(evaluateSpaEvidence(evidence({ rootContainer: true })), false)
  // false-positive protection: server-rendered apps use #app too
})

test('T7 no globals + no DOM signals → isSpa:false', () => {
  assert.equal(evaluateSpaEvidence(evidence({})), false)
})

test('T7b OrangeHRM worked example: globals:false, root:true, script:true → true', () => {
  assert.equal(
    evaluateSpaEvidence(evidence({ rootContainer: true, frameworkScript: true, frameworkAttr: false })),
    true,
  )
})

// ── T8: registerBrowserCleanup registers + cleanly unregisters signal handlers ─

test('T8 registerBrowserCleanup registers SIGINT/SIGTERM, unregister removes them', () => {
  const fakeBrowser = { close: async () => {} } as any
  const beforeInt  = process.listenerCount('SIGINT')
  const beforeTerm = process.listenerCount('SIGTERM')

  const unregister = registerBrowserCleanup(fakeBrowser)
  assert.equal(process.listenerCount('SIGINT'),  beforeInt + 1,  'SIGINT handler not registered')
  assert.equal(process.listenerCount('SIGTERM'), beforeTerm + 1, 'SIGTERM handler not registered')

  unregister()
  assert.equal(process.listenerCount('SIGINT'),  beforeInt,  'SIGINT handler leaked after unregister')
  assert.equal(process.listenerCount('SIGTERM'), beforeTerm, 'SIGTERM handler leaked after unregister')
})
