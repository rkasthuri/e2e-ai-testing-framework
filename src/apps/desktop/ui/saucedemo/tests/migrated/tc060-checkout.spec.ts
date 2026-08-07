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

test.describe('Checkout - Cart Modification Race Condition', () => {
  test('TC060 - Cart modification during checkout overview causes sync or error', async ({ standardUser, context }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');
    await inventoryPage.addItemToCart('Sauce Labs Bolt T-Shirt');

    let badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);

    await standardUser.locator('[data-test="shopping-cart-link"]').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(3);

    await cartPage.proceedToCheckout();

    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    const checkoutOverviewPage = new CheckoutOverviewPage(standardUser);
    const overviewItemCount = await checkoutOverviewPage.getItemCount();
    expect(overviewItemCount).toBe(3);

    const originalSubtotal = await checkoutOverviewPage.getSubtotal();
    const originalTax = await checkoutOverviewPage.getTax();
    const originalTotal = await checkoutOverviewPage.getTotal();

    const newTab = await context.newPage();
    await newTab.goto('https://www.saucedemo.com/cart.html');

    const cartPageInNewTab = new CartPage(newTab);
    const itemsInNewTab = await cartPageInNewTab.getCartItemCount();
    expect(itemsInNewTab).toBe(3);

    await cartPageInNewTab.removeItem('Sauce Labs Bike Light');
    await newTab.waitForTimeout(500);

    const itemsAfterRemoval = await cartPageInNewTab.getCartItemCount();
    expect(itemsAfterRemoval).toBe(2);

    await checkoutOverviewPage.finish();

    const checkoutCompletePage = new CheckoutCompletePage(standardUser);
    const isComplete = await checkoutCompletePage.isOrderComplete();
    expect(isComplete).toBe(true);

    const completeHeader = await checkoutCompletePage.getCompleteHeader();
    expect(completeHeader).toContain('Thank you for your order');

    await checkoutCompletePage.backToHome();
    await standardUser.waitForURL('**/inventory.html');

    await newTab.close();

    console.log('✅ TC060 - Cart modification during checkout completed order without sync validation');
  });
});
