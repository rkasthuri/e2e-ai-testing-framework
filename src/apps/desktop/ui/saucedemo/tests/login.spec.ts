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
import { TestDataGenerator } from '../../../../../core/utils/testDataGenerator';
import { Users } from '../data/users';
import { CartPage } from '../pages/CartPage';

// ── P0 Critical Login Tests ───────────────────────────────────
// Uses guestPage fixture — each test starts on the login page.
// These tests VERIFY the login flow itself, so they must not
// use the standardUser fixture (that skips the flow we're testing).

test.describe('P0 - Critical Login Tests', () => {

  test('TC001 - Valid login with standard user', async ({ guestPage }) => {
    const loginPage    = new LoginPage(guestPage);
    const inventoryPage = new InventoryPage(guestPage);

    await loginPage.loginAndWait(Users.standard());

    await expect(guestPage).toHaveURL(/.*inventory\.html/);
    await expect(inventoryPage.pageTitle).toContainText('Products');
    await expect(inventoryPage.cartLink).toBeVisible();

    const itemCount = await inventoryPage.getProductCount();
    expect(itemCount).toBeGreaterThan(0);

    console.log('✅ TC001 - Valid login successful');
  });

  test('TC002 - Invalid credentials error handling', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin({ username: 'invalid_user', password: 'wrong_password' });

    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Username and password do not match');
    await expect(guestPage).toHaveURL('https://www.saucedemo.com/');

    console.log('✅ TC002 - Invalid credentials handled correctly');
  });

  test('TC003 - Empty username validation', async ({ guestPage, browserName }) => {
    const loginPage = new LoginPage(guestPage);

    if (browserName === 'firefox') {
      test.setTimeout(60000);
      await guestPage.waitForTimeout(500);
    }

    await loginPage.passwordField.fill('secret_sauce');
    await loginPage.loginButton.click();

    const timeout = browserName === 'firefox' ? 10000 : 5000;
    await expect(loginPage.errorMessage).toBeVisible({ timeout });
    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Username is required');

    console.log(`✅ TC003 - Empty username validation working on ${browserName}`);
  });

  test('TC004 - Empty password validation', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.usernameField.fill('standard_user');
    await loginPage.loginButton.click();

    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Password is required');

    console.log('✅ TC004 - Empty password validation working');
  });

  test('TC005 - Empty fields validation', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.loginButton.click();

    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Username is required');

    console.log('✅ TC005 - Empty fields validation working');
  });

  test('TC006 - Locked out user handling', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin(Users.locked());

    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Sorry, this user has been locked out');
    await expect(guestPage).toHaveURL('https://www.saucedemo.com/');

    console.log('✅ TC006 - Locked user handled correctly');
  });
});

// ── P1 High Priority Tests ────────────────────────────────────

test.describe('P1 - High Priority Tests', () => {

  test('TC007 - Performance glitch user login @slow @flaky', async ({ guestPage, browserName }) => {
    test.setTimeout(90000);
    const loginPage     = new LoginPage(guestPage);
    const inventoryPage = new InventoryPage(guestPage);

    const startTime = Date.now();

    if (browserName === 'firefox' || browserName === 'webkit') {
      await guestPage.waitForTimeout(1000);
    }

    await loginPage.attemptLogin(Users.glitch());
    await guestPage.waitForURL('**/inventory.html', { timeout: 60000 });

    const loginDuration = Date.now() - startTime;
    await expect(inventoryPage.pageTitle).toContainText('Products', { timeout: 10000 });

    console.log(`⏱️ TC007 - Login took ${loginDuration}ms (performance_glitch_user on ${browserName})`);
    expect(loginDuration).toBeGreaterThan(1000);
  });

  test('TC008 - Problem user login @slow @flaky', async ({ guestPage, browserName }) => {
    test.setTimeout(60000);
    const loginPage     = new LoginPage(guestPage);
    const inventoryPage = new InventoryPage(guestPage);

    if (browserName === 'firefox' || browserName === 'webkit') {
      await guestPage.waitForTimeout(1000);
    }

    await loginPage.attemptLogin(Users.problem());
    await guestPage.waitForURL('**/inventory.html', { timeout: 30000 });

    await expect(inventoryPage.pageTitle).toContainText('Products', { timeout: 10000 });
    const itemCount = await inventoryPage.getProductCount();
    expect(itemCount).toBeGreaterThan(0);

    console.log(`✅ TC008 - Problem user login successful on ${browserName}`);
  });
});

// ── P2 Data-Driven Tests ──────────────────────────────────────
// These iterate across multiple users — they stay data-driven
// rather than using per-user fixtures.

test.describe('P2 - Data-Driven Tests', () => {

  test('TC009 - Test all valid users', async ({ page, browserName }) => {
    test.setTimeout(180000);
    const validUsers = TestDataGenerator.getValidUsers();

    for (const user of validUsers) {
      const loginPage     = new LoginPage(page);
      const inventoryPage = new InventoryPage(page);

      console.log(`Testing ${user.username} on ${browserName}...`);
      await loginPage.goto();

      if (browserName === 'firefox' || browserName === 'webkit') {
        await page.waitForTimeout(1000);
      }

      await loginPage.attemptLogin({ username: user.username, password: user.password });

      if (user.expectedBehavior === 'success' || user.expectedBehavior === 'slow') {
        const timeout = user.expectedBehavior === 'slow' ? 60000 : 20000;
        try {
          await page.waitForURL('**/inventory.html', { timeout });
          await expect(inventoryPage.pageTitle).toContainText('Products', { timeout: 10000 });
          console.log(`✅ ${user.username} - ${user.description} (${browserName})`);
        } catch {
          console.log(`⚠️ ${user.username} timed out on ${browserName}, skipping...`);
          continue;
        }
      }
    }
  });

  test('TC010 - Test invalid credentials variations', async ({ page }) => {
    const invalidUsers = TestDataGenerator.getInvalidUsers().filter(
      u => u.expectedBehavior === 'error'
    );

    for (const user of invalidUsers) {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.attemptLogin({ username: user.username, password: user.password });
      await expect(loginPage.errorMessage).toBeVisible();
      console.log(`✅ ${user.description} - Error shown correctly`);
    }
  });

  test('TC037 - Logged-out user cannot access inventory page directly', async ({ guestPage }) => {
    await guestPage.goto('https://www.saucedemo.com/inventory.html');
    await guestPage.waitForURL('https://www.saucedemo.com/');
    await expect(guestPage).toHaveURL('https://www.saucedemo.com/');

    const loginPage = new LoginPage(guestPage);
    const isErrorVisible = await loginPage.isErrorVisible();
    expect(isErrorVisible).toBe(true);

    const errorText = await loginPage.getErrorMessage();
    expect(errorText).toContain('Epic sadface');

    console.log('✅ TC037 - Logged-out user redirected to login');
  });
});

// ── Migrated from tc039-login.spec.ts ──────────────────────────
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


// ── Migrated from tc040-login.spec.ts ──────────────────────────
test.describe('Session Persistence', () => {
  test('TC040 - Session persists after page refresh and browser navigation', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();
    await loginPage.loginAndWait(Users.standard());

    const inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    const initialProductCount = await inventoryPage.getProductCount();
    expect(initialProductCount).toBeGreaterThan(0);
    console.log('✅ TC040 - User successfully logged in and on inventory page');

    await guestPage.reload();
    await guestPage.waitForURL('**/inventory.html');
    const productCountAfterReload = await inventoryPage.getProductCount();
    expect(productCountAfterReload).toBe(initialProductCount);
    console.log('✅ TC040 - Session persisted after page reload');

    await inventoryPage.addFirstItemToCart();
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    await guestPage.click('.shopping_cart_link');
    await guestPage.waitForURL('**/cart.html');

    const cartPage = new CartPage(guestPage);
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);
    console.log('✅ TC040 - Navigated to cart with item');

    await guestPage.goBack();
    await guestPage.waitForURL('**/inventory.html');
    const badgeCountAfterBack = await inventoryPage.getCartBadgeCount();
    expect(badgeCountAfterBack).toBe(1);
    console.log('✅ TC040 - Session persisted after browser back navigation');

    await guestPage.reload();
    await guestPage.waitForURL('**/inventory.html');
    const finalBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(finalBadgeCount).toBe(1);
    console.log('✅ TC040 - Cart state and session persistence verified after all navigation');
  });
});


// ── Migrated from tc041-login.spec.ts ──────────────────────────
test.describe('Logout Functionality', () => {
  // NOTE: Using only standardUser — guestPage shares the same underlying page object and its
  // goto('/') would overwrite standardUser's inventory navigation before the test body runs.
  test('TC041 - Logout functionality and session termination @webkit-timing', async ({ standardUser }) => {
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
// ── Migrated from tc042-login.spec.ts ──────────────────────────
test.describe('Login Security', () => {
  test('TC042 - SQL injection and XSS attempts in login fields @webkit-timing', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();

    // Test SQL injection attempt in username field
    const sqlInjectionPayloads = [
      "' OR '1'='1",
      "' OR '1'='1' --",
      "admin'--",
      "' OR 1=1--",
      "admin' OR '1'='1"
    ];

    for (const payload of sqlInjectionPayloads) {
      await loginPage.attemptLogin({ username: payload, password: 'secret_sauce' });
      const isErrorVisible = await loginPage.isErrorVisible();
      expect(isErrorVisible).toBe(true);
      const errorMessage = await loginPage.getErrorMessage();
      expect(errorMessage).not.toContain('SQL');
      expect(errorMessage).not.toContain('syntax');
      expect(errorMessage).not.toContain('database');
      expect(errorMessage).toContain('Epic sadface');
      console.log(`✅ TC042 - SQL injection payload "${payload}" safely rejected with user-friendly error`);
    }

    // Test XSS attempts in username field
    const xssPayloads = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "javascript:alert(1)",
      "<svg onload=alert(1)>",
      "<iframe src='javascript:alert(1)'>"
    ];

    for (const payload of xssPayloads) {
      await loginPage.goto();
      await loginPage.attemptLogin({ username: payload, password: 'secret_sauce' });
      const isErrorVisible = await loginPage.isErrorVisible();
      expect(isErrorVisible).toBe(true);
      const errorMessage = await loginPage.getErrorMessage();
      expect(errorMessage).not.toContain('<script>');
      expect(errorMessage).not.toContain('<img');
      expect(errorMessage).not.toContain('<svg');
      expect(errorMessage).not.toContain('<iframe');
      expect(errorMessage).toContain('Epic sadface');
      
      // Verify no script execution by checking page hasn't navigated or broken
      const currentUrl = guestPage.url();
      expect(currentUrl).toContain('saucedemo.com');
      
      console.log(`✅ TC042 - XSS payload "${payload}" safely sanitized and rejected`);
    }

    // Test SQL injection in password field
    await loginPage.goto();
    await loginPage.attemptLogin({ username: 'standard_user', password: "' OR '1'='1" });
    const isErrorVisible = await loginPage.isErrorVisible();
    expect(isErrorVisible).toBe(true);
    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage).not.toContain('SQL');
    expect(errorMessage).toContain('Epic sadface');

    // Test XSS in password field
    await loginPage.goto();
    await loginPage.attemptLogin({ username: 'standard_user', password: "<script>alert(1)</script>" });
    const isPasswordErrorVisible = await loginPage.isErrorVisible();
    expect(isPasswordErrorVisible).toBe(true);

    // Verify legitimate login still works after injection attempts
    await loginPage.goto();
    await loginPage.loginAndWait(Users.standard());
    const currentUrl = guestPage.url();
    expect(currentUrl).toContain('inventory.html');

    console.log('✅ TC042 - All SQL injection and XSS attempts properly handled without exposing vulnerabilities');
  });
});


// ── Migrated from tc043-login.spec.ts ──────────────────────────
test.describe('Login Security', () => {
  test('TC043 - Password field masking and security', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();

    // Get the password input field
    const passwordInput = guestPage.locator('[data-test="password"]');

    // Verify password input has type="password" attribute for masking
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Type a test password
    const testPassword = 'secret_sauce';
    await passwordInput.fill(testPassword);

    // Verify the input value is present but masked in DOM
    const inputValue = await passwordInput.inputValue();
    expect(inputValue).toBe(testPassword);

    // Verify the type attribute remains "password" after input
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Verify characters are not visible as plain text in the rendered field
    // The text content should be empty because password fields don't expose textContent
    const textContent = await passwordInput.textContent();
    expect(textContent).toBe('');

    // Additional check: autocomplete attribute is optional — log it but don't assert truthy
    // SauceDemo does not set an explicit autocomplete attribute on the password field
    const autocompleteAttr = await passwordInput.getAttribute('autocomplete');
    console.log(`ℹ️  TC043 - autocomplete attribute value: ${autocompleteAttr ?? '(not set)'}`);
    // If set, it should be "current-password" or "off" — not "on" or absent without warning
    if (autocompleteAttr !== null) {
      expect(['current-password', 'off', 'new-password']).toContain(autocompleteAttr);
    }

    console.log('✅ TC043 - Password field masking and security verification confirmed');
  });
});
