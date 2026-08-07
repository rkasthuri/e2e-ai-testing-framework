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
 * BasePage.ts
 * ─────────────────────────────────────────────────────────────
 * Abstract base class for all Page Objects in the FORGE framework.
 *
 * RULES:
 * 1. Cannot be instantiated directly — every page extends this.
 * 2. Every subclass MUST implement pageUrl and isLoaded().
 * 3. Hamburger menu lives here — it appears on every
 *    authenticated page so every Page Object inherits it free.
 * 4. No test logic here — only browser interaction primitives
 *    and shared page behavior.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';
import { SmartLocatorDef } from '../../../../../core/healing/types';

export abstract class BasePage {
  protected readonly page: Page;

  // ── Abstract contract ─────────────────────────────────────
  // Every subclass must declare where it lives and what
  // "loaded" means for that specific page.
  abstract readonly pageUrl: string;
  abstract isLoaded(): Promise<boolean>;

  // ── Hamburger menu (shared across all authenticated pages) ─
  readonly menuButton:        Locator;
  readonly menuCloseButton:   Locator;
  readonly allItemsLink:      Locator;
  readonly aboutLink:         Locator;
  readonly logoutLink:        Locator;
  readonly resetAppStateLink: Locator;

  // ── Shared navigation elements ────────────────────────────
  readonly cartLink:  Locator;
  readonly cartBadge: Locator;
  readonly pageTitle: Locator;

  constructor(page: Page) {
    this.page = page;

    // Hamburger menu
    this.menuButton        = page.locator('#react-burger-menu-btn');
    this.menuCloseButton   = page.locator('#react-burger-cross-btn');
    this.allItemsLink      = page.locator('#inventory_sidebar_link');
    this.aboutLink         = page.locator('#about_sidebar_link');
    this.logoutLink        = page.locator('#logout_sidebar_link');
    this.resetAppStateLink = page.locator('#reset_sidebar_link');

    // Shared navigation
    this.cartLink  = page.locator('.shopping_cart_link');
    this.cartBadge = page.locator('.shopping_cart_badge');
    this.pageTitle = page.locator('.title');
  }

  // ── Navigation ────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto(this.pageUrl);
    await this.waitForPageLoad();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await expect(this.pageTitle).toBeVisible({ timeout: 10000 });
  }

  // ── Hamburger menu actions ────────────────────────────────

  async openMenu(): Promise<void> {
    await this.menuButton.click();
    // webkit enforces stricter CSS-transform visibility than Chromium --
    // the slide animation keeps the element "hidden" until fully complete.
    const isWebkit = this.page.context().browser()?.browserType().name() === 'webkit';
    if (isWebkit) await this.page.waitForTimeout(500);
    await this.allItemsLink.waitFor({ state: 'visible' });
  }

  async closeMenu(): Promise<void> {
    await this.menuCloseButton.click();
    await this.allItemsLink.waitFor({ state: 'hidden' });
  }

  async logout(): Promise<void> {
    await this.openMenu();
    await Promise.all([
      this.page.waitForURL('**/'),
      this.logoutLink.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async goToAllItems(): Promise<void> {
    await this.openMenu();
    await Promise.all([
      this.page.waitForURL('**/inventory.html'),
      this.allItemsLink.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async resetAppState(): Promise<void> {
    await this.openMenu();
    await this.resetAppStateLink.click();
    await this.closeMenu();
  }

  // ── Cart navigation ───────────────────────────────────────

  async goToCart(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/cart.html'),
      this.cartLink.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async getCartBadgeCount(): Promise<number> {
    const isVisible = await this.cartBadge.isVisible();
    if (!isVisible) return 0;
    const text = await this.cartBadge.textContent();
    return parseInt(text ?? '0', 10);
  }

  async isCartBadgeVisible(): Promise<boolean> {
    return this.cartBadge.isVisible();
  }

  // ── Shared utilities ──────────────────────────────────────

  async getPageTitle(): Promise<string> {
    return (await this.pageTitle.textContent()) ?? '';
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `reports/screenshots/${name}-${Date.now()}.png`,
      fullPage: true,
    });
  }

  async scrollToElement(locator: Locator): Promise<void> {
    await locator.scrollIntoViewIfNeeded();
  }

  // ── Self-healing locator factory ──────────────────────────

  protected smart(def: SmartLocatorDef): SmartLocator {
    return new SmartLocator(this.page, def);
  }
}

