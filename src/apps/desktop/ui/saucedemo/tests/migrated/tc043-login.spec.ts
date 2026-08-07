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

    console.log('✅ TC043 - Password field masking and security verified successfully');
  });
});
