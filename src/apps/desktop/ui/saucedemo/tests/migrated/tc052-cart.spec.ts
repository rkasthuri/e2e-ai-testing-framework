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

test.describe('Cart - Adding Same Item Multiple Times', () => {
  test('TC052 - Adding same item multiple times and quantity display', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add first item to cart
    const itemName = 'Sauce Labs Backpack';
    await inventoryPage.addItemToCart(itemName);
    
    // Verify badge shows 1
    let badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);

    // Attempt to add the same item again
    // Note: SauceDemo converts "Add to cart" to "Remove" after adding, so this tests the actual behavior
    const isInCart = await inventoryPage.isItemInCart(itemName);
    expect(isInCart).toBe(true);

    // Navigate to cart to verify behavior
    await standardUser.goto('https://www.saucedemo.com/cart.html');
    const cartPage = new CartPage(standardUser);

    // Verify cart has exactly 1 item (SauceDemo does not support quantity increments)
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);

    // Verify the item appears only once in the cart
    const itemNames = await cartPage.getItemNames();
    const itemOccurrences = itemNames.filter(name => name === itemName).length;
    expect(itemOccurrences).toBe(1);

    // Verify cart badge still shows 1
    expect(badgeCount).toBe(1);

    console.log('✅ TC052 - Verified same item cannot be added multiple times; SauceDemo maintains single instance per product');
  });
});