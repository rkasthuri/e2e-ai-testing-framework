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

test.describe('Inventory - Problem User Experience', () => {
  test('TC049 - Problem user experience - verify inventory page handles image/data issues gracefully', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();
    await loginPage.loginAndWait(Users.problem());
    console.log('✅ TC049 - Problem user logged in successfully');

    const inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    console.log('✅ TC049 - Inventory page loaded despite problem user issues');

    const productCount = await inventoryPage.getProductCount();
    expect(productCount).toBeGreaterThan(0);
    console.log('✅ TC049 - Products are displayed with count: ' + productCount);

    const productNames = await inventoryPage.getProductNames();
    expect(productNames.length).toBeGreaterThan(0);
    console.log('✅ TC049 - Product names are visible despite data issues');

    const images = await guestPage.locator('.inventory_item_img img').all();
    expect(images.length).toBeGreaterThan(0);
    console.log('✅ TC049 - Product images are present in DOM (may have incorrect src)');

    // 'Sauce Labs Backpack' is reliably addable for problem_user (unlike some other items)
    const testItem = 'Sauce Labs Backpack';
    await inventoryPage.addItemToCart(testItem);
    console.log('✅ TC049 - Add to cart functionality works despite UI issues');

    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC049 - Cart badge updated correctly after adding item');

    const isInCart = await inventoryPage.isItemInCart(testItem);
    expect(isInCart).toBe(true);
    console.log('✅ TC049 - Item confirmed in cart, core functionality intact');

    await guestPage.locator('.shopping_cart_link').click();
    await guestPage.waitForURL('**/cart.html');
    const cartPage = new CartPage(guestPage);
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);
    console.log('✅ TC049 - Cart page accessible and displays correct item count');

    console.log('✅ TC049 - Problem user inventory experience validated successfully');
  });
});
