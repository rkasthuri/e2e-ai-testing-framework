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

import { test, expect } from '../fixtures/fixtures';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { Users } from '../data/users';

test.describe('Fast P0 Tests - Standard Users Only', () => {

  test('Standard user login', async ({ guestPage }) => {
    const loginPage     = new LoginPage(guestPage);
    const inventoryPage = new InventoryPage(guestPage);

    await loginPage.loginAndWait(Users.standard());

    await expect(inventoryPage.pageTitle).toContainText('Products');
    console.log('✅ Standard user login successful');
  });

  test('Invalid credentials', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin({ username: 'invalid_user', password: 'wrong_password' });

    await expect(loginPage.errorMessage).toBeVisible();
    console.log('✅ Invalid credentials handled');
  });

  test('Locked user', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin(Users.locked());

    await expect(loginPage.errorMessage).toContainText('locked out');
    console.log('✅ Locked user handled');
  });

  test('Empty fields', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.loginButton.click();

    await expect(loginPage.errorMessage).toBeVisible();
    console.log('✅ Validation working');
  });
});

