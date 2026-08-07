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

test.describe('Checkout - Browser Navigation', () => {
  test('TC061 - Browser back/forward navigation through checkout steps', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add item to cart and proceed to checkout
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await standardUser.locator('[data-test="shopping-cart-link"]').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    expect(await cartPage.getCartItemCount()).toBe(1);
    await cartPage.proceedToCheckout();

    // Fill checkout step 1 with initial data
    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify we reached checkout overview (step 2)
    const checkoutOverviewPage = new CheckoutOverviewPage(standardUser);
    expect(await checkoutOverviewPage.getItemCount()).toBe(1);
    const initialSubtotal = await checkoutOverviewPage.getSubtotal();
    expect(initialSubtotal).toBeGreaterThan(0);

    // Browser back to checkout step 1
    await standardUser.goBack();
    await standardUser.waitForURL('**/checkout-step-one.html');

    // Modify checkout data
    await checkoutPage.fillCheckoutInfo('Jane', 'Smith', '54321');
    await checkoutPage.continue();

    // Browser forward (should stay on overview with current data)
    await standardUser.waitForURL('**/checkout-step-two.html');
    expect(await checkoutOverviewPage.getItemCount()).toBe(1);
    
    // Verify subtotal remains consistent
    const afterNavigationSubtotal = await checkoutOverviewPage.getSubtotal();
    expect(afterNavigationSubtotal).toBe(initialSubtotal);

    // Browser back again
    await standardUser.goBack();
    await standardUser.waitForURL('**/checkout-step-one.html');

    // Browser forward returns to overview
    await standardUser.goForward();
    await standardUser.waitForURL('**/checkout-step-two.html');

    // Verify state consistency - still one item, correct total calculation
    expect(await checkoutOverviewPage.getItemCount()).toBe(1);
    expect(await checkoutOverviewPage.verifyTotalIsCorrect()).toBe(true);

    console.log('✅ TC061 - Browser back/forward navigation maintains checkout state consistency');
  });
});
