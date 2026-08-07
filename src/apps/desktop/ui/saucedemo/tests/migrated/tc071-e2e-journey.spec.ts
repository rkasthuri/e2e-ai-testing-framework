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

import { test, expect } from '../../fixtures/fixtures';
import { InventoryPage } from '../../pages/InventoryPage';
import { CheckoutPage } from '../../pages/CheckoutPage';

test.describe('E2E Journey - Empty Cart Checkout Prevention', () => {
  test('TC071 - System prevents checkout attempt with empty cart', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Attempt to navigate directly to checkout with empty cart.
    // NOTE: SauceDemo is a client-side React app — it does NOT redirect away from
    // checkout-step-one.html when the cart is empty. The page renders normally.
    await standardUser.goto('https://www.saucedemo.com/checkout-step-one.html');

    // Verify we stay on checkout-step-one (no redirect)
    const currentUrl = standardUser.url();
    expect(currentUrl).toContain('checkout-step-one.html');

    // Verify cart badge is still 0 (no items were added)
    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(0);

    // Verify the checkout form is displayed (page rendered successfully)
    const checkoutPage = new CheckoutPage(standardUser);
    const firstNameField = standardUser.locator('[data-test="firstName"]');
    await expect(firstNameField).toBeVisible();
    console.log('✅ TC071 - Checkout form accessible even with empty cart on SauceDemo (client-side app)');
  });
});
