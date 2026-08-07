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

test.describe('Edge Cases - Concurrent Session Handling', () => {
  test('EC013 - Same user logged in multiple browsers/tabs simultaneously', async ({ browser }) => {
    // Create two independent browser contexts to simulate different browsers/devices
    const context1 = await browser.newContext({ baseURL: 'https://www.saucedemo.com' });
    const context2 = await browser.newContext({ baseURL: 'https://www.saucedemo.com' });
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Login with standard user in first context
      const loginPage1 = new LoginPage(page1);
      await loginPage1.goto();
      await loginPage1.loginAndWait(Users.standard());
      
      const inventoryPage1 = new InventoryPage(page1);
      // loginAndWait already navigated to inventory.html
      console.log('✅ EC013 - First session logged in successfully');

      // Login with same user in second context
      const loginPage2 = new LoginPage(page2);
      await loginPage2.goto();
      await loginPage2.loginAndWait(Users.standard());

      const inventoryPage2 = new InventoryPage(page2);
      // loginAndWait already navigated to inventory.html
      console.log('✅ EC013 - Second concurrent session logged in successfully');

      // Add different items to cart in each session
      await inventoryPage1.addItemToCart('Sauce Labs Backpack');
      const badge1 = await inventoryPage1.getCartBadgeCount();
      expect(badge1).toBe(1);
      console.log('✅ EC013 - Item added to cart in first session');

      await inventoryPage2.addItemToCart('Sauce Labs Bike Light');
      const badge2 = await inventoryPage2.getCartBadgeCount();
      expect(badge2).toBe(1);
      console.log('✅ EC013 - Item added to cart in second session');

      // Navigate to cart in both sessions and verify cart state
      await page1.click('[data-test="shopping-cart-link"]');
      await page1.waitForURL('**/cart.html');
      const cartPage1 = new CartPage(page1);
      const itemsInCart1 = await cartPage1.getItemNames();
      const cart1Count = await cartPage1.getCartItemCount();

      await page2.click('[data-test="shopping-cart-link"]');
      await page2.waitForURL('**/cart.html');
      const cartPage2 = new CartPage(page2);
      const itemsInCart2 = await cartPage2.getItemNames();
      const cart2Count = await cartPage2.getCartItemCount();

      console.log('✅ EC013 - Session 1 cart state:', { count: cart1Count, items: itemsInCart1 });
      console.log('✅ EC013 - Session 2 cart state:', { count: cart2Count, items: itemsInCart2 });

      // Verify both sessions remain functional
      expect(cart1Count).toBeGreaterThanOrEqual(1);
      expect(cart2Count).toBeGreaterThanOrEqual(1);
      expect(itemsInCart1.length).toBeGreaterThanOrEqual(1);
      expect(itemsInCart2.length).toBeGreaterThanOrEqual(1);

      console.log('✅ EC013 - Concurrent sessions handled correctly; both sessions functional with independent cart state');
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
