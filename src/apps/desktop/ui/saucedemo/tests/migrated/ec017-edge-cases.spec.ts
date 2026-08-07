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
import { CartPage } from '../../pages/CartPage';
import { CheckoutPage } from '../../pages/CheckoutPage';
import { CheckoutOverviewPage } from '../../pages/CheckoutOverviewPage';

test.describe('Edge Cases - Network Interruption', () => {
  test('EC017 - Network interruption during checkout completion', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add item to cart and proceed to checkout
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await standardUser.locator('[data-test="shopping-cart-link"]').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    await cartPage.proceedToCheckout();

    // Fill checkout information
    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify we're on overview page
    const overviewPage = new CheckoutOverviewPage(standardUser);
    const itemCount = await overviewPage.getItemCount();
    expect(itemCount).toBe(1);

    // Simulate offline network before finishing.
    // NOTE: SauceDemo is fully client-side — there are no server calls during checkout,
    // so offline mode does NOT block completion. This test validates that expected behaviour.
    await standardUser.context().setOffline(true);

    // Finish checkout while offline — should succeed (no network requests needed)
    await overviewPage.finish();

    // Restore network
    await standardUser.context().setOffline(false);

    // Verify checkout completed successfully despite being offline
    await expect(standardUser.locator('[data-test="complete-header"]')).toBeVisible();
    expect(standardUser.url()).toContain('checkout-complete.html');

    console.log('✅ EC017 - Client-side SauceDemo checkout completes successfully even when offline');
  });
});