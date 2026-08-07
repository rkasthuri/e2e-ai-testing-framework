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

test.describe('Logout Functionality', () => {
  // NOTE: Using only standardUser — guestPage shares the same underlying page object and its
  // goto('/') would overwrite standardUser's inventory navigation before the test body runs.
  test('TC041 - Logout functionality and session termination', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded
    console.log('✅ TC041 - User successfully logged in and on inventory page');

    await inventoryPage.logout();
    console.log('✅ TC041 - Logged out via hamburger menu');

    await standardUser.waitForURL('**/');
    const loginPage = new LoginPage(standardUser);
    await expect(standardUser.locator('[data-test="username"]')).toBeVisible();
    console.log('✅ TC041 - Redirected to login page after logout');

    // SauceDemo redirects unauthenticated requests to the login page (/)
    // but does NOT show an error message until a login attempt is made.
    await standardUser.goto('https://www.saucedemo.com/inventory.html');
    await standardUser.waitForURL('**/');
    expect(standardUser.url()).not.toContain('inventory.html');
    await expect(standardUser.locator('[data-test="username"]')).toBeVisible();
    console.log('✅ TC041 - Session invalidated, accessing inventory redirects to login page');

    // Re-login on the same page to verify login works after logout
    await loginPage.loginAndWait(Users.standard());
    const freshInventoryPage = new InventoryPage(standardUser);
    await standardUser.waitForURL('**/inventory.html');
    const freshProductCount = await freshInventoryPage.getProductCount();
    expect(freshProductCount).toBeGreaterThan(0);
    console.log('✅ TC041 - Re-login confirmed working after session logout');
  });
});
