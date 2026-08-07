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

test.describe('Inventory - Button State Toggle', () => {
  test('TC048 - Add/Remove button toggles state correctly (Add to Cart ↔ Remove) on inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const itemName = 'Sauce Labs Backpack';
    
    // Verify initial state shows "Add to cart" (SauceDemo uses data-test^="add-to-cart-" attributes)
    const addButton = standardUser.locator(`[data-test^="add-to-cart-"]`).first();
    await expect(addButton).toHaveText('Add to cart');
    console.log('✅ TC048 - Initial button state verified: "Add to cart"');

    // Add item to cart
    await inventoryPage.addItemToCart(itemName);

    // Verify button changes to "Remove"
    const removeButton = standardUser.locator(`[data-test^="remove-"]`).first();
    await expect(removeButton).toHaveText('Remove');
    console.log('✅ TC048 - Button state changed to "Remove" after adding item');

    // Verify cart badge shows 1 item
    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(1);
    console.log('✅ TC048 - Cart badge count reflects added item');

    // Remove item from cart
    await inventoryPage.removeItemFromCart(itemName);
    
    // Verify button changes back to "Add to cart"
    await expect(addButton).toHaveText('Add to cart');
    console.log('✅ TC048 - Button state toggled back to "Add to cart" after removing item');

    // Verify cart badge is no longer visible
    const finalCartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(finalCartBadgeCount).toBe(0);
    console.log('✅ TC048 - Cart badge cleared after item removal');

    console.log('✅ TC048 - Add/Remove button toggle behavior verified correctly');
  });
});
