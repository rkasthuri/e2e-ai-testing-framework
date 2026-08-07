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

import { chromium } from '@playwright/test'
import * as dotenv from 'dotenv'
import orangehrmModel from '../models/orangehrm/app-model.json'

dotenv.config()

const INTERACTIVE_ROLES = ['link', 'button', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'option']

function classify(raw: any): string | null {
  if (raw.dataTest) return 'OLD:dataTest'
  if (raw.type === 'submit') return 'OLD:submit'
  if (raw.type === 'password') return 'OLD:password'
  if (raw.role === 'button' && raw.textContent) return 'OLD:role=button+text'
  if (raw.tag === 'input' || raw.tag === 'select' || raw.tag === 'textarea') return 'NEW:rule1-formInput'
  const hasAccessibleName = !!(raw.ariaLabel || raw.alt || raw.textContent)
  const isInteractiveTag  = (raw.tag === 'a' && !!raw.href) || raw.tag === 'button'
  const isInteractiveRole = !!raw.role && INTERACTIVE_ROLES.includes(raw.role)
  if (hasAccessibleName && (isInteractiveTag || isInteractiveRole)) return 'NEW:rule2-accessibleName+interactive'
  if (raw.inForm) return 'NEW:rule3-inForm'
  return null
}

async function harvest(page: any) {
  return page.evaluate(() => {
    const selector = [
      'input:not([type=hidden])', 'button', 'select', 'textarea', 'a[href]',
      '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
      '[role="combobox"]', '[data-test]',
    ].join(',')
    return Array.from(document.querySelectorAll(selector)).slice(0, 100).map((el: any) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      dataTest: el.getAttribute('data-test'),
      ariaLabel: el.getAttribute('aria-label'),
      textContent: el.textContent?.trim().slice(0, 50) || null,
      role: el.getAttribute('role'),
      href: el.href || null,
      alt: el.getAttribute('alt'),
      inForm: el.closest('form') !== null,
    }))
  })
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ baseURL: 'https://opensource-demo.orangehrmlive.com' })
  const page = await context.newPage()

  const [oUser, oPass] = (process.env.ORANGEHRM_ADMINUSER_CREDENTIALS || '').split(':')
  await page.goto('https://opensource-demo.orangehrmlive.com/web/index.php/auth/login')
  await page.fill('input[name="username"]', oUser)
  await page.fill('input[name="password"]', oPass)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/index**', { timeout: 20000 })

  const ruleCounts: Record<string, number> = {}
  const samples: Record<string, any[]> = {}

  for (const p of (orangehrmModel as any).pages) {
    const url = `https://opensource-demo.orangehrmlive.com${p.urlPattern}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1000)
      const raw = await harvest(page)
      for (const el of raw) {
        const rule = classify(el)
        if (rule) {
          ruleCounts[rule] = (ruleCounts[rule] || 0) + 1
          samples[rule] = samples[rule] || []
          if (samples[rule].length < 8) {
            samples[rule].push({ page: p.id, tag: el.tag, role: el.role, text: el.textContent, dataTest: el.dataTest, inForm: el.inForm })
          }
        }
      }
    } catch (e: any) {
      console.log(`${p.id}: ERROR — ${e.message.split('\n')[0]}`)
    }
  }

  console.log('\n=== RULE FIRING COUNTS (OrangeHRM, all pages) ===')
  console.log(JSON.stringify(ruleCounts, null, 2))
  console.log('\n=== SAMPLES PER RULE ===')
  console.log(JSON.stringify(samples, null, 2))

  await browser.close()
}
main()
