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

import { chromium, Page } from '@playwright/test'
import * as dotenv from 'dotenv'
import { ElementClassifier } from '../src/core/onboarding/ElementClassifier'
import { AiBudgetTracker, ElementDefinition } from '../src/core/onboarding/types'
import saucedemoModel from '../models/saucedemo/app-model.json'
import orangehrmModel from '../models/orangehrm/app-model.json'

dotenv.config()

// Pre-exhausted — classifyPage() skips nameWithAi() entirely when the budget
// is exhausted, so this measures determineCritical() only, with zero AI
// calls/cost and no model mutation. We only care about critical counts here.
const exhaustedBudget: AiBudgetTracker = {
  remaining:   0,
  consume:     () => false,
  isExhausted: () => true,
}

interface PageResult {
  pageId:   string
  elements: ElementDefinition[]
}

// Mirrors Crawler.deduplicateSharedElements() exactly — kept in sync by hand,
// not imported, since the real method is private and operates on the live
// PageDefinition[] inside Crawler.crawl(). See that method for the full
// rationale (link-only, href-gated key).
function deduplicateSharedElements(results: PageResult[]): void {
  const seen = new Map<string, string>()
  for (const r of results) {
    for (const el of r.elements) {
      if (el.kind !== 'link' || !el.href) continue
      const key = `${el.label}|${el.kind}|${el.href}`
      const canonicalId = seen.get(key)
      if (!canonicalId) {
        seen.set(key, el.id)
        continue
      }
      el.sharedElementOf = canonicalId
    }
  }
}

async function measureApp(
  appName: string,
  baseUrl: string,
  pages:   { id: string; urlPattern: string }[],
  login:   (page: Page) => Promise<void>
): Promise<PageResult[]> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: baseUrl })
  const page    = await context.newPage()

  console.log(`\n=== ${appName} ===`)
  await login(page)

  const results: PageResult[] = []

  for (const p of pages) {
    const url = p.urlPattern === '/' ? baseUrl : `${baseUrl}${p.urlPattern}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1000) // matches PageVisitor.ts:90 — let SPA render before harvesting
      const classifier = new ElementClassifier(page, p.id, exhaustedBudget)
      const elements   = await classifier.classifyPage()
      results.push({ pageId: p.id, elements })
    } catch (e: any) {
      console.log(`  ${p.id}: ERROR — ${e.message.split('\n')[0]}`)
      results.push({ pageId: p.id, elements: [] })
    }
  }

  await browser.close()
  return results
}

function summarize(appName: string, results: PageResult[]) {
  let rawTotal = 0, rawCritical = 0
  let dedupTotal = 0, dedupCritical = 0

  for (const r of results) {
    rawTotal += r.elements.length
    rawCritical += r.elements.filter(e => e.critical).length

    // Deduped view: a shared-duplicate element doesn't count again toward
    // the total OR the critical count — it was already counted at its
    // canonical (first-seen) occurrence.
    const nonDuplicate = r.elements.filter(e => !e.sharedElementOf)
    dedupTotal += nonDuplicate.length
    dedupCritical += nonDuplicate.filter(e => e.critical).length

    const sharedCount = r.elements.filter(e => e.sharedElementOf).length
    console.log(
      `  ${r.pageId}: ${r.elements.filter(e=>e.critical).length}/${r.elements.length} critical` +
      (sharedCount > 0 ? `  (${sharedCount} marked shared-duplicate)` : '')
    )
  }

  const rawPct   = rawTotal > 0 ? (rawCritical / rawTotal * 100).toFixed(1) : '0.0'
  const dedupPct = dedupTotal > 0 ? (dedupCritical / dedupTotal * 100).toFixed(1) : '0.0'
  console.log(`\n${appName} RAW (no dedup):     ${rawCritical}/${rawTotal} critical (${rawPct}%)`)
  console.log(`${appName} DEDUPED:             ${dedupCritical}/${dedupTotal} critical (${dedupPct}%)`)

  return { rawCritical, rawTotal, dedupCritical, dedupTotal }
}

async function main() {
  const [sUser, sPass] = (process.env.STANDARD_USER_CREDENTIALS || '').split(':')
  const sauceResults = await measureApp(
    'saucedemo',
    'https://www.saucedemo.com',
    (saucedemoModel as any).pages,
    async (page) => {
      await page.goto('https://www.saucedemo.com')
      await page.fill('[data-test="username"]', sUser)
      await page.fill('[data-test="password"]', sPass)
      await page.click('[data-test="login-button"]')
      await page.waitForURL('**/inventory.html**', { timeout: 15000 })
    }
  )
  deduplicateSharedElements(sauceResults)
  const sauceSummary = summarize('saucedemo', sauceResults)

  const [oUser, oPass] = (process.env.ORANGEHRM_ADMINUSER_CREDENTIALS || '').split(':')
  const ohrmResults = await measureApp(
    'orangehrm',
    'https://opensource-demo.orangehrmlive.com',
    (orangehrmModel as any).pages,
    async (page) => {
      await page.goto('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login')
      await page.fill('input[name="username"]', oUser)
      await page.fill('input[name="password"]', oPass)
      await page.click('button[type="submit"]')
      await page.waitForURL('**/dashboard/index**', { timeout: 20000 })
    }
  )
  deduplicateSharedElements(ohrmResults)
  const ohrmSummary = summarize('orangehrm', ohrmResults)

  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify({ saucedemo: sauceSummary, orangehrm: ohrmSummary }, null, 2))

  // SauceDemo's 8 new-rule elements specifically — confirm they're untouched by dedup
  console.log('\n=== SauceDemo hamburger-menu elements (the 8 new-rule additions) — dedup status ===')
  for (const r of sauceResults) {
    for (const el of r.elements) {
      if (el.name === 'openMenu' || el.name === 'closeMenu') {
        console.log(`  ${r.pageId}:${el.name} — critical=${el.critical}, sharedElementOf=${el.sharedElementOf ?? 'none'}`)
      }
    }
  }

  require('fs').writeFileSync(
    'td032-measure-output.json',
    JSON.stringify({ saucedemo: sauceResults, orangehrm: ohrmResults }, null, 2)
  )
}

main()
