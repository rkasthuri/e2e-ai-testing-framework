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

import { chromium } from 'playwright'
import { SmartLocator }          from '../src/core/healing/SmartLocator'
import { healStore }             from '../src/core/healing/HealStore'
import { VisionHealer }          from '../src/core/healing/VisionHealer'
import { HealEvent }             from '../src/core/healing/types'

// Exercises SmartLocator.resolve()'s real "stored heal stopped resolving ->
// fallback/vision re-heals it" branch directly -- NOT the
// retireHeal()-then-recordHeal() test-setup pattern HV002 uses for its own,
// unrelated, determinism purpose. This is the natural code path TD-022's fix
// targets (SmartLocator.ts line 32).
//
// Both scenarios seed a multi-call heal history via the real recordHeal()
// API (so firstHealed/consecutiveSuccesses reflect genuine prior history,
// not a single contrived call), then point the stored heal at a selector
// that no longer resolves, forcing resolve() down the re-heal path.

function seedHistory(key: string, staleSelector: string, timestamps: string[]): void {
  healStore.retireHeal(key) // ensure clean slate before seeding
  for (const ts of timestamps) {
    const event: HealEvent = {
      key,
      timestamp: ts,
      originalStrategy: 'css',
      healedStrategy: 'id',
      healedSelector: staleSelector,
      source: 'strategy-chain',
    }
    healStore.recordHeal(event)
  }
}

function dumpEntry(label: string, key: string): void {
  const entry = healStore.getEntry(key)
  console.log(`${label} [${key}]:`, entry ? JSON.stringify(entry) : '(none)')
}

async function runFallbackScenario(page: import('playwright').Page) {
  const key = 'td022.repro.fallback'
  console.log(`\n${'='.repeat(70)}`)
  console.log('Scenario A: stored heal stops resolving -> strategy-chain re-heal')
  console.log('='.repeat(70))

  seedHistory(key, '#stale-selector-a', ['2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z'])
  dumpEntry('SEEDED', key)

  const locator = new SmartLocator(page, {
    key,
    description: 'Fallback re-heal repro element',
    strategies: [
      { name: 'css', selector: '#also-broken-a' }, // primary -- deliberately broken
      { name: 'id',  selector: '#real-button' },   // fallback -- actually resolves
    ],
  })

  const resolved = await locator.resolve()
  console.log('resolve() returned, visible:', await resolved.isVisible())
  console.log('heal events this call:', JSON.stringify(locator.getHealEvents()))

  dumpEntry('AFTER resolve()', key)

  const after = healStore.getEntry(key)
  const firstHealedCarried   = after?.firstHealed === '2026-01-01T00:00:00.000Z'
  const consecutiveCarried   = after?.consecutiveSuccesses === 3
  console.log(`firstHealed carried forward (expect true): ${firstHealedCarried}`)
  console.log(`consecutiveSuccesses == 3 (expect true): ${consecutiveCarried} (actual: ${after?.consecutiveSuccesses})`)

  healStore.retireHeal(key) // cleanup
  return { firstHealedCarried, consecutiveCarried }
}

async function runVisionScenario(page: import('playwright').Page) {
  const key = 'td022.repro.vision'
  console.log(`\n${'='.repeat(70)}`)
  console.log('Scenario B: stored heal stops resolving -> vision re-heal')
  console.log('='.repeat(70))

  seedHistory(key, '#stale-selector-b', [
    '2026-02-01T00:00:00.000Z',
    '2026-02-10T00:00:00.000Z',
    '2026-02-15T00:00:00.000Z',
  ])
  dumpEntry('SEEDED', key)

  // Stub VisionHealer.heal so this exercises the real resolve() vision branch
  // deterministically, without a real Claude API call or budget spend.
  const originalHeal = VisionHealer.prototype.heal
  VisionHealer.prototype.heal = async function (_desc: string) {
    console.log('[stub VisionHealer] returning deterministic success -> #real-button')
    return {
      selector:   '#real-button',
      confidence: 0.95,
      reasoning:  'stubbed for TD-022 repro -- no real API call made',
      success:    true,
    }
  }

  try {
    const locator = new SmartLocator(page, {
      key,
      description: 'Vision re-heal repro element',
      strategies: [
        { name: 'css', selector: '#also-broken-b1' }, // primary -- broken
        { name: 'id',  selector: '#also-broken-b2' }, // only fallback -- also broken, exhausts chain
      ],
    })

    const resolved = await locator.resolve()
    console.log('resolve() returned, visible:', await resolved.isVisible())
    console.log('heal events this call:', JSON.stringify(locator.getHealEvents()))

    dumpEntry('AFTER resolve()', key)

    const after = healStore.getEntry(key)
    const firstHealedCarried = after?.firstHealed === '2026-02-01T00:00:00.000Z'
    const consecutiveCarried = after?.consecutiveSuccesses === 4
    const sourceIsVision     = after?.source === 'vision'
    console.log(`firstHealed carried forward (expect true): ${firstHealedCarried}`)
    console.log(`consecutiveSuccesses == 4 (expect true): ${consecutiveCarried} (actual: ${after?.consecutiveSuccesses})`)
    console.log(`source == 'vision' (expect true): ${sourceIsVision} (actual: ${after?.source})`)

    healStore.retireHeal(key) // cleanup
    return { firstHealedCarried, consecutiveCarried, sourceIsVision }
  } finally {
    VisionHealer.prototype.heal = originalHeal
  }
}

async function runPrimaryRecoveredScenario(page: import('playwright').Page) {
  const key = 'td022.repro.primaryRecovered'
  console.log(`\n${'='.repeat(70)}`)
  console.log('Scenario C: primary selector recovered -> stale heal entry retired (no regression check, line 41-44, untouched)')
  console.log('='.repeat(70))

  seedHistory(key, '#stale-selector-c', ['2026-03-01T00:00:00.000Z'])
  dumpEntry('SEEDED', key)

  const locator = new SmartLocator(page, {
    key,
    description: 'Primary-recovered repro element',
    strategies: [
      { name: 'id', selector: '#real-button' }, // primary -- now resolves (recovered)
      { name: 'css', selector: '#unused-fallback' },
    ],
  })

  const resolved = await locator.resolve()
  console.log('resolve() returned, visible:', await resolved.isVisible())
  console.log('heal events this call (expect none -- primary path records no heal):', JSON.stringify(locator.getHealEvents()))

  const after = healStore.getEntry(key)
  const entryDeleted = after === undefined
  console.log(`stale entry deleted on primary recovery (expect true): ${entryDeleted}`)

  return { entryDeleted }
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<html><body><button id="real-button">Login</button></body></html>')

  const a = await runFallbackScenario(page)
  const b = await runVisionScenario(page)
  const c = await runPrimaryRecoveredScenario(page)

  await healStore.save()
  await browser.close()

  console.log(`\n${'='.repeat(70)}`)
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(JSON.stringify({ scenarioA: a, scenarioB: b, scenarioC: c }, null, 2))

  const allPassed = a.firstHealedCarried && a.consecutiveCarried &&
                     b.firstHealedCarried && b.consecutiveCarried && b.sourceIsVision &&
                     c.entryDeleted
  console.log(allPassed ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED (expected on the pre-fix code for A/B)')
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
