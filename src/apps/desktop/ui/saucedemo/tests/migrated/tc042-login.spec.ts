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
import { Users } from '../../data/users';

test.describe('Login Security', () => {
  test('TC042 - SQL injection and XSS attempts in login fields', async ({ guestPage }) => {
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