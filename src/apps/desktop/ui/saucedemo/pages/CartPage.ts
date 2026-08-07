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
 * CartPage.ts
 * ─────────────────────────────────────────────────────────────
 * Page Object for the SauceDemo cart page (/cart.html).
 * Standardized to data-test selectors throughout.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';

export class CartPage extends BasePage {
  readonly pageUrl = '/cart.html';

  // ── Locators ──────────────────────────────────────────────
  readonly cartItems:              Locator;
  readonly cartItemNames:          Locator;
  readonly cartItemPrices:         Locator;
  readonly cartItemQuantities:     Locator;
  readonly removeButtons:          Locator;
  readonly continueShoppingButton = this.smart({
    key: 'cart.continueShoppingButton',
    description: 'Continue shopping button on the cart page',
    strategies: [
      { name: 'data-test', selector: '[data-test="continue-shopping"]' },
      { name: 'id',        selector: '#continue-shopping' },
      { name: 'css',       selector: 'button[name="continue-shopping"]' },
    ],
  });

  readonly checkoutButton = this.smart({
    key: 'cart.checkoutButton',
    description: 'Proceed to checkout button on the cart page',
    strategies: [
      { name: 'data-test', selector: '[data-test="checkout"]' },
      { name: 'id',        selector: '#checkout' },
      { name: 'css',       selector: 'button[name="checkout"]' },
    ],
  });

  constructor(page: Page) {
    super(page);
    this.cartItems          = page.locator('.cart_item');
    this.cartItemNames      = page.locator('.inventory_item_name');
    this.cartItemPrices     = page.locator('.inventory_item_price');
    this.cartItemQuantities = page.locator('.item_quantity');
    this.removeButtons      = page.locator('[data-test^="remove-"]');
  }

  // ── Contract implementation ───────────────────────────────

  async isLoaded(): Promise<boolean> {
    await expect(this.pageTitle).toBeVisible({ timeout: 10000 });
    return true;
  }

  // ── Cart state ────────────────────────────────────────────

  async getCartItemCount(): Promise<number> {
    return this.cartItems.count();
  }

  async isCartEmpty(): Promise<boolean> {
    return (await this.getCartItemCount()) === 0;
  }

  async getItemNames(): Promise<string[]> {
    return this.cartItemNames.allTextContents();
  }

  async getItemPrices(): Promise<number[]> {
    const texts = await this.cartItemPrices.allTextContents();
    return texts.map(t => parseFloat(t.replace('$', '')));
  }

  async getItemQuantities(): Promise<number[]> {
    const texts = await this.cartItemQuantities.allTextContents();
    return texts.map(t => parseInt(t, 10));
  }

  async getTotalPrice(): Promise<number> {
    const prices = await this.getItemPrices();
    return prices.reduce((sum, p) => sum + p, 0);
  }

  async isItemInCart(itemName: string): Promise<boolean> {
    const names = await this.getItemNames();
    return names.includes(itemName);
  }

  // ── Cart actions ──────────────────────────────────────────

  /**
   * Remove a specific item by name.
   * Converts item name to the data-test remove button format.
   */
  async removeItem(itemName: string): Promise<void> {
    const key      = itemName.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '');
    const dataTest = `remove-${key}`;
    await this.page.locator(`[data-test="${dataTest}"]`).click();
  }

  async removeFirstItem(): Promise<void> {
    await this.removeButtons.first().click();
  }

  async removeAllItems(): Promise<void> {
    const count = await this.removeButtons.count();
    for (let i = 0; i < count; i++) {
      await this.removeButtons.first().click();
    }
  }

  // ── Navigation ────────────────────────────────────────────

  async continueShopping(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/inventory.html'),
      this.continueShoppingButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async proceedToCheckout(): Promise<void> {
    // Promise.all pattern: start waiting for navigation BEFORE clicking.
    // Required for webkit — clicking a navigation-triggering button without
    // a concurrent waitForURL causes the click action itself to hang.
    await Promise.all([
      this.page.waitForURL('**/checkout-step-one.html'),
      this.checkoutButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }
}
