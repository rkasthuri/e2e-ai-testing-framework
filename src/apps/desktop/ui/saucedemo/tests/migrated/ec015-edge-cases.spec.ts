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

test.describe('Edge Cases - Checkout Security', () => {
  test('EC015 - Checkout form field injection with HTML/script tags', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    await inventoryPage.addFirstItemToCart();
    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(1);

    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    expect(await cartPage.getCartItemCount()).toBe(1);

    await cartPage.proceedToCheckout();

    const checkoutPage = new CheckoutPage(standardUser);
    const maliciousFirstName = '<script>alert(1)</script>';
    const maliciousLastName = '<img src=x onerror=alert(2)>';
    const maliciousPostalCode = '<b>12345</b>';

    await checkoutPage.fillCheckoutInfo(maliciousFirstName, maliciousLastName, maliciousPostalCode);
    await checkoutPage.continue();

    const overviewPage = new CheckoutOverviewPage(standardUser);
    
    const paymentInfoText = await standardUser.locator('[data-test="payment-info-value"]').textContent();
    const shippingInfoText = await standardUser.locator('[data-test="shipping-info-value"]').textContent();
    
    expect(paymentInfoText).toBeTruthy();
    expect(shippingInfoText).toBeTruthy();

    const pageContent = await standardUser.content();
    expect(pageContent).not.toContain('<script>');
    expect(pageContent).not.toContain('onerror=');
    expect(pageContent).not.toContain('alert(1)');
    expect(pageContent).not.toContain('alert(2)');

    const scriptTags = await standardUser.locator('script').allTextContents();
    const hasInjectedScript = scriptTags.some(script => script.includes('alert(1)') || script.includes('alert(2)'));
    expect(hasInjectedScript).toBe(false);

    const itemCount = await overviewPage.getItemCount();
    expect(itemCount).toBe(1);

    const subtotal = await overviewPage.getSubtotal();
    expect(subtotal).toBeGreaterThan(0);

    console.log('✅ EC015 - Checkout form fields properly sanitize dangerous input');
  });
});
