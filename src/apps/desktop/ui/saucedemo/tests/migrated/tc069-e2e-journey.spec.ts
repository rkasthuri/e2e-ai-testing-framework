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

test.describe('E2E Journey - Locked Out User', () => {
  test('TC069 - E2E journey with locked_out_user - verify login prevention blocks entire flow', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    
    // Navigate to login page
    await loginPage.goto();
    
    // Attempt to login with locked_out_user
    await loginPage.attemptLogin(Users.locked());
    
    // Verify error message is displayed
    const isErrorVisible = await loginPage.isErrorVisible();
    expect(isErrorVisible).toBe(true);
    
    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage).toContain('Epic sadface: Sorry, this user has been locked out');
    
    // Verify user remains on login page (not redirected to inventory)
    expect(guestPage.url()).toContain('saucedemo.com');
    expect(guestPage.url()).not.toContain('inventory.html');
    
    // Verify inventory page is not accessible by attempting to navigate directly
    await guestPage.goto('https://www.saucedemo.com/inventory.html');
    
    // TD-107: SauceDemo does NOT redirect the URL for an unauthenticated direct-nav —
    // it stays on the URL and renders an access-denied banner. Assert the banner (the
    // real signal); the old URL check asserted the wrong thing AND raced the redirect.
    await expect(guestPage.locator('text=You can only access')).toBeVisible({ timeout: 3000 });
    
    // Verify cart page is not accessible by attempting to navigate directly
    await guestPage.goto('https://www.saucedemo.com/cart.html');
    await expect(guestPage.locator('text=You can only access')).toBeVisible({ timeout: 3000 });
    
    // Verify checkout page is not accessible by attempting to navigate directly
    await guestPage.goto('https://www.saucedemo.com/checkout-step-one.html');
    await expect(guestPage.locator('text=You can only access')).toBeVisible({ timeout: 3000 });
    
    console.log('✅ TC069 - Locked out user prevented from accessing any journey step - login blocked with error message and all protected pages inaccessible');
  });
});