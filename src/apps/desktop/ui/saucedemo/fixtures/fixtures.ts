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

/**
 * fixtures.ts
 * ─────────────────────────────────────────────────────────────
 * Playwright fixtures for all SauceDemo user roles.
 *
 * Usage in tests — replace:
 *   import { test } from '@playwright/test';
 * With:
 *   import { test } from '../fixtures/fixtures';
 *
 * Then declare the user context you need as a parameter:
 *   test('my test', async ({ standardUser }) => { ... });
 *
 * Each fixture provides a Page already navigated to inventory
 * and fully loaded — no login boilerplate in tests.
 *
 * guestPage provides a raw unauthenticated page for testing
 * the login flow itself.
 * ─────────────────────────────────────────────────────────────
 */

import { test as base, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { Users } from '../data/users';

type UserFixtures = {
  standardUser: Page;
  lockedUser:   Page;
  problemUser:  Page;
  glitchUser:   Page;
  errorUser:    Page;
  visualUser:   Page;
  guestPage:    Page;
};

async function loginAs(
  page: Page,
  credentials: ReturnType<typeof Users.standard>
): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.loginAndWait(credentials);
}

export const test = base.extend<UserFixtures>({
  /**
   * Standard user — full access, everything works as expected.
   * Default fixture for most tests.
   */
  standardUser: async ({ page }, use) => {
    await loginAs(page, Users.standard());
    // Ensure all 6 inventory items are fully rendered before the test
    // starts interacting. webkit has stricter stability requirements
    // than chromium — this prevents sequential-click timeouts.
    await page.locator('.inventory_item').nth(5).waitFor({ state: 'visible', timeout: 15000 });
    await use(page);
  },

  /**
   * Locked out user — cannot log in.
   * Use for testing the locked account error flow.
   * NOTE: This fixture lands on the login page (not inventory)
   * because login fails. Tests must handle the error state.
   */
  lockedUser: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.attemptLogin(Users.locked());
    await use(page);
  },

  /**
   * Problem user — images broken, some cart interactions fail.
   * Use for testing degraded UI behavior.
   */
  problemUser: async ({ page }, use) => {
    await loginAs(page, Users.problem());
    await use(page);
  },

  /**
   * Performance glitch user — slow page loads.
   * Use for testing timeout handling and loading states.
   */
  glitchUser: async ({ page }, use) => {
    await loginAs(page, Users.glitch());
    await use(page);
  },

  /**
   * Error user — random errors on certain interactions.
   * Use for testing error recovery and resilience.
   */
  errorUser: async ({ page }, use) => {
    await loginAs(page, Users.error());
    await use(page);
  },

  /**
   * Visual user — intentional visual differences.
   * Use for visual regression test baselines.
   */
  visualUser: async ({ page }, use) => {
    await loginAs(page, Users.visual());
    await use(page);
  },

  /**
   * Guest page — raw unauthenticated page.
   * Use for login form tests, security tests, direct URL access.
   */
  guestPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
