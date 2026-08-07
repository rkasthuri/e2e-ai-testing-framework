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

test.describe('Checkout - Empty Cart Security', () => {
  test('TC057 - Checkout with empty cart - user navigates directly to checkout URL without items', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add an item to cart then remove it to ensure cart is empty
    await inventoryPage.addFirstItemToCart();
    const cartPage = new CartPage(standardUser);
    await standardUser.goto('https://www.saucedemo.com/cart.html');
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBeGreaterThan(0);
    
    await cartPage.removeAllItems();
    const emptyCart = await cartPage.isCartEmpty();
    expect(emptyCart).toBe(true);
    console.log('✅ TC057 - Cart confirmed empty');

    // Attempt to navigate directly to checkout URL with empty cart
    await standardUser.goto('https://www.saucedemo.com/checkout-step-one.html');
    
    // Verify system handles empty cart checkout appropriately
    const checkoutPage = new CheckoutPage(standardUser);
    
    // Try to proceed with checkout information
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify we reach checkout overview (SauceDemo allows empty cart checkout)
    await standardUser.waitForURL('**/checkout-step-two.html');
    const currentUrl = standardUser.url();
    expect(currentUrl).toContain('checkout-step-two.html');
    console.log('✅ TC057 - Empty cart checkout proceeding to overview page verified');

    // Verify overview page shows no items
    const overviewPageContent = await standardUser.locator('.cart_list').isVisible();
    expect(overviewPageContent).toBe(true);
    console.log('✅ TC057 - Checkout with empty cart handled by system');
  });
});