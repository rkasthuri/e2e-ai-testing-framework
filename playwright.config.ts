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
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/test-results.json' }],
    ['list'],
    ['./src/platform/platform-reporter.ts'],
    // TD-126: Result Ingestion Layer — streams test_results to the DB during
    // the run and reconciles the run lifecycle. Workspace auto-discovery finds
    // the DB (.forge/forge.db or the repo-root fixture forge-framework.db).
    ['./src/pipeline/ForgeStreamingReporter.ts'],
  ],
  use: {
    baseURL: 'https://www.saucedemo.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.CI ? true : false,
    actionTimeout:     process.env.CI ? 30000 : 15000,
    navigationTimeout: process.env.CI ? 30000 : 15000,
  },
  projects: [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
    // Scoped to the onboarding pipeline's actual generated-output shape
    // (generated/specs/*.spec.ts for UI apps, generated/*.spec.ts for API apps)
    // rather than a blanket '**/generated/**' -- a broader pattern previously
    // swept in promoted tests/migrated/ specs too, since "generated" appeared
    // anywhere in their path. See playwright.generated.config.ts's migration
    // convention note for why "generated" must stay out of migrated paths.
    // Excludes the whole desktop/api/ tree by directory, not filename --
    // a filename-only exclude (e.g. '**/api.spec.ts' or '**/api*.spec.ts')
    // misses anything that doesn't literally start with "api", like a
    // promoted test named 'tc063-api.spec.ts'.
    testIgnore: ['**/desktop/api/**', '**/generated/specs/**/*.spec.ts', '**/generated/*.spec.ts'],
  },
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
    testIgnore: ['**/desktop/api/**', '**/generated/specs/**/*.spec.ts', '**/generated/*.spec.ts'],
  },
  {
    name: 'api',
    testMatch: '**/desktop/api/**/*.spec.ts',
    use: {
      baseURL: process.env.API_BASE_URL || 'https://restful-booker.herokuapp.com',
    },
  },
  {
    name: 'generated',
    testMatch: ['**/generated/specs/**/*.spec.ts', '**/generated/*.spec.ts'],
    // restful-booker's generated/api.generated.spec.ts already runs under the
    // 'api' project (which now matches the whole desktop/api/ tree) -- without
    // this, it would also match testMatch above and run a second time here.
    testIgnore: ['**/desktop/api/**'],
    use: {
      ...devices['Desktop Chrome'],
      baseURL: process.env.GENERATED_BASE_URL || 'https://opensource-demo.orangehrmlive.com',
    },
  },
  ],
});
