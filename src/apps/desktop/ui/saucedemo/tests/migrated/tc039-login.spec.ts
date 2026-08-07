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
import { Users } from '../../data/users';

test.describe('Login - Additional User Types', () => {
  test('TC039 - error_user and visual_user login functionality', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    
    // Test error_user login
    await loginPage.goto();
    await loginPage.loginAndWait(Users.error());
    
    let inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    
    const errorUserProductCount = await inventoryPage.getProductCount();
    expect(errorUserProductCount).toBeGreaterThan(0);
    console.log('✅ TC039 - error_user successfully logged in and loaded inventory page');

    // Proper logout via hamburger menu — just navigating to '/' does not clear the session
    await inventoryPage.logout();
    console.log('✅ TC039 - error_user logged out via menu');

    // Test visual_user login (already on login page after logout)
    await loginPage.loginAndWait(Users.visual());
    
    inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    
    const visualUserProductCount = await inventoryPage.getProductCount();
    expect(visualUserProductCount).toBeGreaterThan(0);
    console.log('✅ TC039 - visual_user successfully logged in and loaded inventory page');
  });
});
