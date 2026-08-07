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
import { LoginPage } from '../../pages/LoginPage';
import { Users } from '../../data/users';

test.describe('Cart Persistence', () => {
  test('TC051 - Cart persistence across logout/login sessions', async ({ standardUser, context }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add multiple items to cart
    const itemsToAdd = ['Sauce Labs Backpack', 'Sauce Labs Bike Light', 'Sauce Labs Bolt T-Shirt'];
    for (const item of itemsToAdd) {
      await inventoryPage.addItemToCart(item);
    }

    // Verify items were added
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);
    console.log('✅ TC051 - Added 3 items to cart before logout');

    // Navigate to cart to verify items pre-logout
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    const cartItems = await cartPage.getItemNames();
    expect(cartItems).toEqual(expect.arrayContaining(itemsToAdd));
    console.log('✅ TC051 - Verified all items present in cart before logout');

    // Logout via hamburger menu
    await inventoryPage.logout();
    console.log('✅ TC051 - Logged out successfully');

    // Login again with same user
    const loginPage = new LoginPage(standardUser);
    await loginPage.loginAndWait(Users.standard());
    console.log('✅ TC051 - Logged back in as standard_user');

    // SauceDemo persists cart state in localStorage — items survive logout/login within the same context
    const inventoryPageAfterLogin = new InventoryPage(standardUser);
    await standardUser.waitForURL('**/inventory.html');
    const badgeCountAfterLogin = await inventoryPageAfterLogin.getCartBadgeCount();
    expect(badgeCountAfterLogin).toBe(3);
    console.log('✅ TC051 - Cart persisted after logout/login (localStorage-based, not cleared on logout)');

    // Navigate to cart and confirm items are still present
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPageAfterLogin = new CartPage(standardUser);
    const cartItemsAfterLogin = await cartPageAfterLogin.getItemNames();
    expect(cartItemsAfterLogin).toEqual(expect.arrayContaining(itemsToAdd));
    console.log('✅ TC051 - Cart items confirmed persisted after logout/login (SauceDemo localStorage behavior)');
  });
});
