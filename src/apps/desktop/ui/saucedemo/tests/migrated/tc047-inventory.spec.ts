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

test.describe('Cart Badge Counter Updates', () => {
  test('TC047 - Cart badge counter updates correctly when adding/removing items from inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Verify initial badge count is 0 (no badge visible)
    const initialCount = await inventoryPage.getCartBadgeCount();
    expect(initialCount).toBe(0);
    console.log('✅ TC047 - Initial cart badge count is 0');

    // Add first item to cart
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    let badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC047 - Badge count incremented to 1 after adding first item');

    // Add second item to cart
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(2);
    console.log('✅ TC047 - Badge count incremented to 2 after adding second item');

    // Add third item to cart
    await inventoryPage.addItemToCart('Sauce Labs Bolt T-Shirt');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);
    console.log('✅ TC047 - Badge count incremented to 3 after adding third item');

    // Remove one item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Bike Light');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(2);
    console.log('✅ TC047 - Badge count decremented to 2 after removing one item');

    // Remove another item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Backpack');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC047 - Badge count decremented to 1 after removing another item');

    // Remove last item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Bolt T-Shirt');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(0);
    console.log('✅ TC047 - Badge count reset to 0 after removing all items');
  });
});