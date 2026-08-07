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

test.describe('Edge Cases - Cart Capacity', () => {
  test('EC014 - Maximum cart capacity - adding all products to cart', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const productCount = await inventoryPage.getProductCount();
    console.log(`Total products available: ${productCount}`);
    expect(productCount).toBe(6);

    const productNames = await inventoryPage.getProductNames();
    console.log(`Products to add: ${productNames.join(', ')}`);

    for (const productName of productNames) {
      await inventoryPage.addItemToCart(productName);
      const isInCart = await inventoryPage.isItemInCart(productName);
      expect(isInCart).toBe(true);
    }

    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(6);
    console.log(`✅ EC014 - Successfully added all ${productCount} products to cart`);

    await standardUser.locator('.shopping_cart_link').click();
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);

    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(6);

    const cartItemNames = await cartPage.getItemNames();
    expect(cartItemNames).toHaveLength(6);
    
    for (const productName of productNames) {
      const isInCart = await cartPage.isItemInCart(productName);
      expect(isInCart).toBe(true);
    }

    console.log('✅ EC014 - Verified all 6 products are in cart with correct counts');
  });
});
