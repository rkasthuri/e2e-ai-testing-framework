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
 * CheckoutOverviewPage.ts
 * ─────────────────────────────────────────────────────────────
 * Page Object for checkout step 2 (/checkout-step-two.html).
 * "Checkout: Overview" — order summary before final confirmation.
 *
 * Previously bundled inside CheckoutPage.ts. Now a dedicated
 * file with a complete method surface including price parsing
 * and order verification helpers.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';

export class CheckoutOverviewPage extends BasePage {
  readonly pageUrl = '/checkout-step-two.html';

  // ── Locators ──────────────────────────────────────────────
  readonly cartItems:     Locator;
  readonly itemNames:     Locator;
  readonly itemPrices:    Locator;
  readonly itemQuantities:Locator;
  readonly paymentInfo:   Locator;
  readonly shippingInfo:  Locator;
  readonly subtotalLabel: Locator;
  readonly taxLabel:      Locator;
  readonly totalLabel:    Locator;
  readonly finishButton = this.smart({
    key: 'checkout.finishButton',
    description: 'Finish order button on checkout overview page',
    strategies: [
      { name: 'data-test', selector: '[data-test="finish"]' },
      { name: 'id',        selector: '#finish' },
      { name: 'css',       selector: 'button[name="finish"]' },
    ],
  });

  readonly cancelButton = this.smart({
    key: 'checkoutOverview.cancelButton',
    description: 'Cancel button on checkout overview page',
    strategies: [
      { name: 'data-test', selector: '[data-test="cancel"]' },
      { name: 'id',        selector: '#cancel' },
      { name: 'css',       selector: 'button[name="cancel"]' },
    ],
  });

  constructor(page: Page) {
    super(page);
    this.cartItems      = page.locator('.cart_item');
    this.itemNames      = page.locator('.inventory_item_name');
    this.itemPrices     = page.locator('.inventory_item_price');
    this.itemQuantities = page.locator('.item_quantity');
    this.paymentInfo    = page.locator('.summary_value_label').first();
    this.shippingInfo   = page.locator('.summary_value_label').nth(1);
    this.subtotalLabel  = page.locator('.summary_subtotal_label');
    this.taxLabel       = page.locator('.summary_tax_label');
    this.totalLabel     = page.locator('.summary_total_label');
  }

  // ── Contract implementation ───────────────────────────────

  async isLoaded(): Promise<boolean> {
    await expect(await this.finishButton.resolve()).toBeVisible({ timeout: 10000 });
    return true;
  }

  // ── Order details ─────────────────────────────────────────

  async getItemCount(): Promise<number> {
    return this.cartItems.count();
  }

  async getItemNames(): Promise<string[]> {
    return this.itemNames.allTextContents();
  }

  async getItemPrices(): Promise<number[]> {
    const texts = await this.itemPrices.allTextContents();
    return texts.map(t => parseFloat(t.replace('$', '')));
  }

  async getSubtotal(): Promise<number> {
    const text = (await this.subtotalLabel.textContent()) ?? '0';
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  async getTax(): Promise<number> {
    const text = (await this.taxLabel.textContent()) ?? '0';
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  async getTotal(): Promise<number> {
    const text = (await this.totalLabel.textContent()) ?? '0';
    return parseFloat(text.replace(/[^0-9.]/g, ''));
  }

  async getPaymentInfo(): Promise<string> {
    return (await this.paymentInfo.textContent()) ?? '';
  }

  async getShippingInfo(): Promise<string> {
    return (await this.shippingInfo.textContent()) ?? '';
  }

  /**
   * Verify the displayed total equals subtotal + tax.
   * Returns true if the math checks out to 2 decimal places.
   */
  async verifyTotalIsCorrect(): Promise<boolean> {
    const subtotal = await this.getSubtotal();
    const tax      = await this.getTax();
    const total    = await this.getTotal();
    return Math.abs((subtotal + tax) - total) < 0.01;
  }

  // ── Navigation ────────────────────────────────────────────

  async finish(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/checkout-complete.html'),
      this.finishButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async cancel(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/inventory.html'),
      this.cancelButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }
}
