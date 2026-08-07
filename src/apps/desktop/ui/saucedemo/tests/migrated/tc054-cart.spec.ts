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
import { CartPage } from '../../pages/CartPage';

test.describe('Cart - Empty State', () => {
  test('TC054 - Empty cart state and checkout button behavior', async ({ standardUser }) => {
    // standardUser fixture already ensures inventory is fully loaded (6 items visible)
    // Navigate to cart without adding any items
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    
    // Verify cart is empty
    const isEmpty = await cartPage.isCartEmpty();
    expect(isEmpty).toBe(true);
    
    // Verify cart item count is 0
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(0);
    
    // Verify checkout button is present but attempting to proceed with empty cart
    const checkoutButton = standardUser.locator('[data-test="checkout"]');
    await expect(checkoutButton).toBeVisible();
    
    // Click checkout and verify we can proceed (SauceDemo allows empty cart checkout)
    await cartPage.proceedToCheckout();
    
    // Verify we are on checkout page even with empty cart
    await expect(standardUser).toHaveURL(/.*checkout-step-one.html/);
    
    console.log('✅ TC054 - Empty cart checkout behavior verified - SauceDemo allows proceeding with empty cart');
  });
});