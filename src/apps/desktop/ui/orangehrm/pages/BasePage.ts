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

import { Page, Locator } from '@playwright/test'
import { SmartLocator }    from '../../../../../core/healing/SmartLocator'
import { SmartLocatorDef } from '../../../../../core/healing/types'

export abstract class BasePage {
  protected readonly page: Page

  abstract readonly pageUrl: string
  abstract isLoaded(): Promise<boolean>

  constructor(page: Page) {
    this.page = page
  }

  async goto(): Promise<void> {
    await this.page.goto(this.pageUrl)
    await this.page.waitForLoadState('domcontentloaded')
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `reports/screenshots/${name}-${Date.now()}.png`,
      fullPage: true,
    })
  }

  protected smart(def: SmartLocatorDef): SmartLocator {
    return new SmartLocator(this.page, def)
  }
}
