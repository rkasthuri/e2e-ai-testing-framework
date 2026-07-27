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

import * as fs   from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { loadAppModelFixture } from '../helpers/load-app-model-fixture'
import { FlowDetector }  from '../src/core/onboarding/FlowDetector'
import { AppModel, OnboardingConfig, AiBudgetTracker } from '../src/core/onboarding/types'

// Recomputes `flows` for an already-crawled app model using the real (fixed)
// FlowDetector, against the real onboarding config and the pages/roles already
// on disk from the last crawl. No live browser crawl, no AI spend — this exercises
// exactly the code path Part 1 of TD-016/017/019-Implementation-Brief.md changed
// (FlowDetector.mergeConfigSeeded() / identifyCandidates()), not page discovery.
//
// NOTE: `stateGraph.edges` is not persisted in app-model.json (it's rebuilt fresh
// from visited-URL ordering during a live crawl in Crawler.ts). We pass an empty
// edge set here, so identifyCandidates()'s "Navigation flows" branch will report
// zero inferred candidates for any app whose flow detection actually reaches that
// branch (i.e. apps where isSpa===false, like SauceDemo) — that branch genuinely
// needs a live crawl to demonstrate. This script only proves what's provable from
// existing real data: mergeConfigSeeded()'s output (the part of the bug this
// script can fully exercise without a live crawl).

async function findConfig(appName: string): Promise<OnboardingConfig> {
  const appsDir = path.resolve('src/apps')
  const find = (dir: string): string | null => {
    if (!fs.existsSync(dir)) return null
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { const f = find(path.join(dir, e.name)); if (f) return f }
      else if (e.name === `onboarding.${appName}.config.ts`) return path.join(dir, e.name)
    }
    return null
  }
  const cfgPath = find(appsDir)
  if (!cfgPath) throw new Error(`No onboarding config found for ${appName}`)
  const { default: cfg } = await import(pathToFileURL(cfgPath).href)
  return cfg as OnboardingConfig
}

function makeBudget(limit: number): AiBudgetTracker {
  const tracker = { remaining: limit }
  return {
    get remaining() { return tracker.remaining },
    consume(n: number) {
      if (tracker.remaining <= 0) return false
      tracker.remaining -= n
      return true
    },
    isExhausted() { return tracker.remaining <= 0 },
  }
}

async function runApp(appName: string, flowIdsOfInterest: string[]) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`App: ${appName}`)
  console.log('='.repeat(70))

  const model  = loadAppModelFixture(appName) as unknown as AppModel
  const config = await findConfig(appName)

  console.log(`\n-- BEFORE (currently persisted in models/${appName}/app-model.json) --`)
  for (const id of flowIdsOfInterest) {
    const flow = model.flows?.find(f => f.id === id || f.id.startsWith(`${id}-`))
    console.log(`\nflow "${id}":`, flow ? JSON.stringify(flow, null, 2) : '(not found)')
  }

  const detector = new FlowDetector(
    { nodes: new Map(), edges: [] },
    model.pages ?? [],
    model.roles,
    config,
    makeBudget(config.budgets?.aiCalls ?? 50),
  )
  const newFlows = await detector.detectFlows()

  console.log(`\n-- AFTER (recomputed via fixed FlowDetector, real config + real pages) --`)
  for (const id of flowIdsOfInterest) {
    const flow = newFlows.find(f => f.id === id || f.id.startsWith(`${id}-`))
    console.log(`\nflow "${id}":`, flow ? JSON.stringify(flow, null, 2) : '(not found)')
  }

  console.log(`\nAll recomputed flow IDs: ${newFlows.map(f => f.id).join(', ')}`)

  const updated: AppModel = { ...model, flows: newFlows }
  const modelPath = path.resolve(`models/${appName}/app-model.json`)
  fs.writeFileSync(modelPath, JSON.stringify(updated, null, 2))
  console.log(`\nWrote recomputed flows back to ${modelPath}`)
}

async function main() {
  await runApp('orangehrm', ['admin-login'])
  await runApp('saucedemo', ['checkout-happy-path', 'inferred-flow-standardUser', 'inferred-flow-lockedUser'])
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
