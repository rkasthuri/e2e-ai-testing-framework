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
 * CheckoutCompletePage.ts
 * ─────────────────────────────────────────────────────────────
 * Page Object for checkout step 3 (/checkout-complete.html).
 * "Checkout: Complete!" — order confirmation screen.
 *
 * Previously bundled inside CheckoutPage.ts. Now a dedicated
 * file with complete order confirmation assertions.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';

export class CheckoutCompletePage extends BasePage {
  readonly pageUrl = '/checkout-complete.html';

  // ── Locators ──────────────────────────────────────────────
  readonly completeHeader:   Locator;
  readonly completeText:     Locator;
  readonly ponyExpressImage: Locator;
  readonly backHomeButton = this.smart({
    key: 'checkoutComplete.backHomeButton',
    description: 'Back to products button on order complete page',
    strategies: [
      { name: 'data-test', selector: '[data-test="back-to-products"]' },
      { name: 'id',        selector: '#back-to-products' },
      { name: 'css',       selector: 'button[name="back-to-products"]' },
    ],
  });

  constructor(page: Page) {
    super(page);
    this.completeHeader   = page.locator('.complete-header');
    this.completeText     = page.locator('.complete-text');
    this.ponyExpressImage = page.locator('.pony_express');
  }

  // ── Contract implementation ───────────────────────────────

  async isLoaded(): Promise<boolean> {
    await expect(this.completeHeader).toBeVisible({ timeout: 10000 });
    return true;
  }

  // ── Order confirmation ────────────────────────────────────

  async isOrderComplete(): Promise<boolean> {
    return this.completeHeader.isVisible();
  }

  async getCompleteHeader(): Promise<string> {
    return (await this.completeHeader.textContent()) ?? '';
  }

  async getCompleteText(): Promise<string> {
    return (await this.completeText.textContent()) ?? '';
  }

  async isPonyExpressVisible(): Promise<boolean> {
    return this.ponyExpressImage.isVisible();
  }

  // ── Navigation ────────────────────────────────────────────

  async backToHome(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/inventory.html'),
      this.backHomeButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }
}
