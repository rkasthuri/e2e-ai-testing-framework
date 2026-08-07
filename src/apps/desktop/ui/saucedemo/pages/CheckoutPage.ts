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
 * CheckoutPage.ts
 * ─────────────────────────────────────────────────────────────
 * Page Object for checkout step 1 (/checkout-step-one.html).
 * "Checkout: Your Information" — name and postal code form.
 *
 * Previously this file contained three classes. Now it contains
 * exactly one. CheckoutOverviewPage and CheckoutCompletePage
 * have their own dedicated files.
 * ─────────────────────────────────────────────────────────────
 */

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';

export class CheckoutPage extends BasePage {
  readonly pageUrl = '/checkout-step-one.html';

  // ── Locators ──────────────────────────────────────────────
  readonly firstNameField = this.smart({
    key: 'checkout.firstNameField',
    description: 'First name input field on checkout information form',
    strategies: [
      { name: 'data-test', selector: '[data-test="firstName"]' },
      { name: 'id',        selector: '#first-name' },
      { name: 'css',       selector: 'input[placeholder*="First" i]' },
    ],
  });

  readonly lastNameField = this.smart({
    key: 'checkout.lastNameField',
    description: 'Last name input field on checkout information form',
    strategies: [
      { name: 'data-test', selector: '[data-test="lastName"]' },
      { name: 'id',        selector: '#last-name' },
      { name: 'css',       selector: 'input[placeholder*="Last" i]' },
    ],
  });

  readonly continueButton = this.smart({
    key: 'checkout.continueButton',
    description: 'Continue button on checkout information form',
    strategies: [
      { name: 'data-test', selector: '[data-test="continue"]' },
      { name: 'id',        selector: '#continue' },
      { name: 'css',       selector: 'input[type="submit"]' },
    ],
  });

  readonly postalCodeField:  Locator;
  readonly cancelButton:     Locator;
  readonly errorMessage:     Locator;
  readonly errorCloseButton: Locator;

  constructor(page: Page) {
    super(page);
    this.postalCodeField  = page.locator('[data-test="postalCode"]');
    this.cancelButton     = page.locator('[data-test="cancel"]');
    this.errorMessage     = page.locator('[data-test="error"]');
    this.errorCloseButton = page.locator('[data-test="error-button"]');
  }

  // ── Contract implementation ───────────────────────────────

  async isLoaded(): Promise<boolean> {
    await expect(await this.firstNameField.resolve()).toBeVisible({ timeout: 10000 });
    return true;
  }

  // ── Form actions ──────────────────────────────────────────

  async fillCheckoutInfo(
    firstName: string,
    lastName: string,
    postalCode: string
  ): Promise<void> {
    await this.firstNameField.fill(firstName);
    await this.lastNameField.fill(lastName);
    await this.postalCodeField.fill(postalCode);
  }

  async continue(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/checkout-step-two.html'),
      this.continueButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  async cancel(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('**/cart.html'),
      this.cancelButton.click(),
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  // ── Error state ───────────────────────────────────────────

  async isErrorVisible(): Promise<boolean> {
    return this.errorMessage.isVisible();
  }

  async getErrorMessage(): Promise<string> {
    return (await this.errorMessage.textContent()) ?? '';
  }

  async closeError(): Promise<void> {
    await this.errorCloseButton.click();
  }
}
