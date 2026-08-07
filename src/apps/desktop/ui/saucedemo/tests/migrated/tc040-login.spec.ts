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
import { Users } from '../../data/users';

test.describe('Session Persistence', () => {
  test('TC040 - Session persists after page refresh and browser navigation', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();
    await loginPage.loginAndWait(Users.standard());

    const inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    const initialProductCount = await inventoryPage.getProductCount();
    expect(initialProductCount).toBeGreaterThan(0);
    console.log('✅ TC040 - User successfully logged in and on inventory page');

    await guestPage.reload();
    await guestPage.waitForURL('**/inventory.html');
    const productCountAfterReload = await inventoryPage.getProductCount();
    expect(productCountAfterReload).toBe(initialProductCount);
    console.log('✅ TC040 - Session persisted after page reload');

    await inventoryPage.addFirstItemToCart();
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    await guestPage.click('.shopping_cart_link');
    await guestPage.waitForURL('**/cart.html');

    const cartPage = new CartPage(guestPage);
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);
    console.log('✅ TC040 - Navigated to cart with item');

    await guestPage.goBack();
    await guestPage.waitForURL('**/inventory.html');
    const badgeCountAfterBack = await inventoryPage.getCartBadgeCount();
    expect(badgeCountAfterBack).toBe(1);
    console.log('✅ TC040 - Session persisted after browser back navigation');

    await guestPage.reload();
    await guestPage.waitForURL('**/inventory.html');
    const finalBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(finalBadgeCount).toBe(1);
    console.log('✅ TC040 - Cart state and session persistence verified after all navigation');
  });
});
