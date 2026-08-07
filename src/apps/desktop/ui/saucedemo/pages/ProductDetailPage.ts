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
 * ProductDetailPage.ts
 * ─────────────────────────────────────────────────────────────
 * Page Object for the SauceDemo product detail page.
 * URL pattern: /inventory-item.html?id=N
 *
 * Previously missing from the framework entirely — tests that
 * needed this page were using raw selectors directly.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductDetailPage extends BasePage {
  readonly pageUrl = '/inventory-item.html';

  // ── Locators ──────────────────────────────────────────────
  readonly productName:        Locator;
  readonly productPrice:       Locator;
  readonly productDescription: Locator;
  readonly productImage:       Locator;
  readonly addToCartButton:    Locator;
  readonly removeButton:       Locator;
  readonly backButton:         Locator;

  constructor(page: Page) {
    super(page);
    this.productName        = page.locator('.inventory_details_name');
    this.productPrice       = page.locator('.inventory_details_price');
    this.productDescription = page.locator('.inventory_details_desc');
    this.productImage       = page.locator('.inventory_details_img img');
    this.addToCartButton    = page.locator('[data-test^="add-to-cart-"]');
    this.removeButton       = page.locator('[data-test^="remove-"]');
    this.backButton         = page.locator('[data-test="back-to-products"]');
  }

  // ── Contract implementation ───────────────────────────────

  async isLoaded(): Promise<boolean> {
    await expect(this.productName).toBeVisible({ timeout: 10000 });
    return true;
  }

  override async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await expect(this.productName).toBeVisible({ timeout: 10000 });
  }

  // ── Product details ───────────────────────────────────────

  async getProductName(): Promise<string> {
    return (await this.productName.textContent()) ?? '';
  }

  async getProductPrice(): Promise<number> {
    const text = (await this.productPrice.textContent()) ?? '0';
    return parseFloat(text.replace('$', ''));
  }

  async getProductDescription(): Promise<string> {
    return (await this.productDescription.textContent()) ?? '';
  }

  // ── Cart interaction ──────────────────────────────────────

  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
  }

  async removeFromCart(): Promise<void> {
    await this.removeButton.click();
  }

  async isInCart(): Promise<boolean> {
    return this.removeButton.isVisible();
  }

  // ── Navigation ────────────────────────────────────────────

  async goBackToInventory(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/inventory.html'),
      this.backButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }
}
