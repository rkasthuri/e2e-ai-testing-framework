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
import { LoginPage } from '../../pages/LoginPage';
import { InventoryPage } from '../../pages/InventoryPage';
import { CartPage } from '../../pages/CartPage';
import { CheckoutPage } from '../../pages/CheckoutPage';
import { CheckoutOverviewPage } from '../../pages/CheckoutOverviewPage';
import { CheckoutCompletePage } from '../../pages/CheckoutCompletePage';
import { Users } from '../../data/users';

test.describe('Performance Degradation Journey', () => {
  test('TC073 - Performance glitch user completes full journey within acceptable thresholds', async ({ guestPage }) => {
    // glitch_user adds a ~5 s artificial delay on login; use a generous threshold
    const MAX_LOAD_TIME_MS = 15000;
    const loadTimes: { step: string; duration: number }[] = [];

    // Login step
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();
    
    let startTime = Date.now();
    await loginPage.loginAndWait(Users.glitch());
    let duration = Date.now() - startTime;
    loadTimes.push({ step: 'Login to Inventory', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Login completed in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);

    // Inventory page - add item to cart
    const inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    
    startTime = Date.now();
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    duration = Date.now() - startTime;
    loadTimes.push({ step: 'Add to Cart', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Add to cart completed in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);
    
    expect(await inventoryPage.getCartBadgeCount()).toBe(1);

    // Navigate to cart
    startTime = Date.now();
    await guestPage.click('.shopping_cart_link');
    const cartPage = new CartPage(guestPage);
    await guestPage.waitForURL('**/cart.html');
    duration = Date.now() - startTime;
    loadTimes.push({ step: 'Navigate to Cart', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Cart page loaded in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);

    expect(await cartPage.getCartItemCount()).toBe(1);

    // Proceed to checkout
    startTime = Date.now();
    await cartPage.proceedToCheckout();
    await guestPage.waitForURL('**/checkout-step-one.html');
    duration = Date.now() - startTime;
    loadTimes.push({ step: 'Proceed to Checkout', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Checkout page loaded in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);

    // Fill checkout info
    const checkoutPage = new CheckoutPage(guestPage);
    startTime = Date.now();
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();
    await guestPage.waitForURL('**/checkout-step-two.html');
    duration = Date.now() - startTime;
    loadTimes.push({ step: 'Fill Info and Continue', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Checkout overview loaded in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);

    // Overview page
    const overviewPage = new CheckoutOverviewPage(guestPage);
    expect(await overviewPage.getItemCount()).toBe(1);
    
    startTime = Date.now();
    await overviewPage.finish();
    await guestPage.waitForURL('**/checkout-complete.html');
    duration = Date.now() - startTime;
    loadTimes.push({ step: 'Complete Order', duration });
    expect(duration).toBeLessThan(MAX_LOAD_TIME_MS);
    console.log(`⏱️  Order completion loaded in ${duration}ms (threshold: ${MAX_LOAD_TIME_MS}ms)`);

    // Verify order completion
    const completePage = new CheckoutCompletePage(guestPage);
    expect(await completePage.isOrderComplete()).toBeTruthy();
    expect(await completePage.getCompleteHeader()).toContain('Thank you for your order');

    // Calculate and log total journey time
    const totalTime = loadTimes.reduce((sum, item) => sum + item.duration, 0);
    console.log(`\n📊 Performance Summary:`);
    loadTimes.forEach(({ step, duration }) => {
      console.log(`   ${step}: ${duration}ms`);
    });
    console.log(`   Total Journey Time: ${totalTime}ms`);
    
    // Verify no step exceeded threshold
    const slowestStep = loadTimes.reduce((max, item) => item.duration > max.duration ? item : max);
    console.log(`   Slowest Step: ${slowestStep.step} (${slowestStep.duration}ms)`);
    
    console.log('✅ TC073 - Performance glitch user completed full E2E journey within acceptable thresholds');
  });
});
