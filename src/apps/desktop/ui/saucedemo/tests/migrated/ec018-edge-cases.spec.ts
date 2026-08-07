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
import { CheckoutCompletePage } from '../../pages/CheckoutCompletePage';

test.describe('Edge Cases - Price Manipulation', () => {
  test('EC018 - Price manipulation via browser DevTools before checkout', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const originalPrices = await inventoryPage.getProductPrices();
    console.log(`Original prices: ${originalPrices}`);

    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');

    const cartPage = new CartPage(standardUser);
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');

    const cartPricesBeforeTampering = await cartPage.getItemPrices();
    console.log(`Cart prices before tampering: ${cartPricesBeforeTampering}`);

    await standardUser.evaluate(() => {
      const priceElements = document.querySelectorAll('.inventory_item_price');
      priceElements.forEach((el) => {
        el.textContent = '$0.01';
      });
    });

    const cartPricesAfterTampering = await cartPage.getItemPrices();
    console.log(`Cart prices after DOM tampering: ${cartPricesAfterTampering}`);

    await cartPage.proceedToCheckout();

    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    const overviewPage = new CheckoutOverviewPage(standardUser);
    await standardUser.waitForURL('**/checkout-step-two.html');

    const subtotal = await overviewPage.getSubtotal();
    const tax = await overviewPage.getTax();
    const total = await overviewPage.getTotal();

    console.log(`Server-side subtotal: ${subtotal}, tax: ${tax}, total: ${total}`);

    const expectedSubtotal = cartPricesBeforeTampering.reduce((sum, price) => sum + price, 0);
    expect(subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(subtotal).not.toBeCloseTo(0.02, 1);

    await overviewPage.verifyTotalIsCorrect();

    await overviewPage.finish();

    const completePage = new CheckoutCompletePage(standardUser);
    await standardUser.waitForURL('**/checkout-complete.html');
    const isComplete = await completePage.isOrderComplete();
    expect(isComplete).toBe(true);

    console.log('✅ EC018 - Server correctly validated prices; DOM tampering had no effect on actual charge');
  });
});