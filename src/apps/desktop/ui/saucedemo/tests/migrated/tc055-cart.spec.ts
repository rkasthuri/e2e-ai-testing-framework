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

test.describe('Cart Item Details Display', () => {
  test('TC055 - Verify cart item description matches inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const testItemName = 'Sauce Labs Backpack';
    
    const inventoryItems = await standardUser.locator('.inventory_item').all();
    let inventoryDescription = '';
    
    for (const item of inventoryItems) {
      const nameElement = item.locator('.inventory_item_name');
      const name = await nameElement.textContent();
      
      if (name === testItemName) {
        const descElement = item.locator('.inventory_item_desc');
        inventoryDescription = await descElement.textContent() || '';
        break;
      }
    }

    expect(inventoryDescription).toBeTruthy();
    console.log(`📝 Inventory description captured: "${inventoryDescription.substring(0, 50)}..."`);

    await inventoryPage.addItemToCart(testItemName);
    const cartBadge = await inventoryPage.getCartBadgeCount();
    expect(cartBadge).toBe(1);

    await standardUser.locator('.shopping_cart_link').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(1);

    const isInCart = await cartPage.isItemInCart(testItemName);
    expect(isInCart).toBe(true);

    const cartItem = standardUser.locator('.cart_item');
    const cartItemName = await cartItem.locator('.inventory_item_name').textContent();
    expect(cartItemName).toBe(testItemName);

    const cartItemDesc = await cartItem.locator('.inventory_item_desc').textContent();
    expect(cartItemDesc).toBe(inventoryDescription);

    console.log('✅ TC055 - Cart item description matches inventory page description');
  });
});
