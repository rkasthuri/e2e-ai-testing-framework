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

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/apps',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,  // ← change undefined to 4
  reporter: [
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],  // ← add open:'never'
    ['json', { outputFile: 'reports/test-results.json' }],
    ['list'],
    ['./src/platform/platform-reporter.ts'],  // ← live progress markers (inert unless PLATFORM_RUN set)
  ],
  use: {
    baseURL: 'https://www.saucedemo.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.CI ? true : false,   // ← was false, now CI-aware
    actionTimeout:     process.env.CI ? 30000 : 15000,  // ← was 15000 flat
    navigationTimeout: process.env.CI ? 30000 : 15000,  // ← add this
  },

  projects: [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    testIgnore: ['**/api.spec.ts', '**/generated/**'],  // generated/ = unvetted backlog, not in main suite
  },
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
    testIgnore: ['**/api.spec.ts', '**/generated/**'],  // generated/ = unvetted backlog, not in main suite
  },
  {
    name: 'api',
    testMatch: '**/api.spec.ts',
    use: {
      baseURL: process.env.API_BASE_URL || 'https://restful-booker.herokuapp.com',
    },
  },
  {
    name: 'generated',
    testMatch: '**/generated/**/*.spec.ts',
    use: {
      ...devices['Desktop Chrome'],
      baseURL: process.env.GENERATED_BASE_URL || 'https://opensource-demo.orangehrmlive.com',
    },
  },
  ],
});
