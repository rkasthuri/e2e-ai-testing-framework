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

test.describe('Cart - Maximum Items', () => {
  test('TC053 - Cart behavior with maximum items (all 6 products added)', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Get all product names to add them systematically
    const productNames = await inventoryPage.getProductNames();
    expect(productNames.length).toBe(6);
    console.log('✅ TC053 - Verified 6 products available in inventory');

    // Add all 6 products to cart
    for (const productName of productNames) {
      await inventoryPage.addItemToCart(productName);
    }
    console.log('✅ TC053 - Added all 6 products to cart');

    // Verify cart badge shows 6
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(6);
    console.log('✅ TC053 - Cart badge displays 6 items');

    // Navigate to cart
    await standardUser.click('.shopping_cart_link');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);

    // Verify all 6 items are visible in cart
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(6);
    console.log('✅ TC053 - All 6 items visible in cart');

    // Verify all item names match
    const cartItemNames = await cartPage.getItemNames();
    expect(cartItemNames.length).toBe(6);
    for (const productName of productNames) {
      expect(await cartPage.isItemInCart(productName)).toBe(true);
    }
    console.log('✅ TC053 - All product names correctly displayed in cart');

    // Verify prices are displayed for all items
    const cartPrices = await cartPage.getItemPrices();
    expect(cartPrices.length).toBe(6);
    for (const price of cartPrices) {
      expect(price).toBeGreaterThan(0);
    }
    console.log('✅ TC053 - All 6 items have valid prices displayed');

    // Proceed to checkout to verify functionality with full cart
    await cartPage.proceedToCheckout();
    const checkoutPage = new CheckoutPage(standardUser);

    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify checkout overview with all 6 items
    const checkoutOverviewPage = new CheckoutOverviewPage(standardUser);
    const overviewItemCount = await checkoutOverviewPage.getItemCount();
    expect(overviewItemCount).toBe(6);
    console.log('✅ TC053 - Checkout overview displays all 6 items');

    // Verify totals are calculated correctly
    const subtotal = await checkoutOverviewPage.getSubtotal();
    const tax = await checkoutOverviewPage.getTax();
    const total = await checkoutOverviewPage.getTotal();
    
    expect(subtotal).toBeGreaterThan(0);
    expect(tax).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(subtotal);
    await expect(checkoutOverviewPage.verifyTotalIsCorrect()).resolves.toBe(true);
    console.log('✅ TC053 - Order totals correctly calculated for 6 items');

    console.log('✅ TC053 - Cart handles maximum items (6) with correct badge count and checkout functionality');
  });
});
