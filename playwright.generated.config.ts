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
 * playwright.generated.config.ts
 * -------------------------------------------------------------
 * Minimal config for validating generated tests in src/tests/generated/.
 * Used by the platform's Save & Run button and for direct CLI validation.
 *
 * Does NOT write to run-history.json -- validation only, not a tracked run.
 *
 * Migration convention:
 *   Once a generated test is reviewed and promoted to the permanent suite,
 *   move it to that app's own tests/migrated/ folder (e.g.
 *   src/apps/desktop/ui/saucedemo/tests/migrated/) -- NOT src/tests/generated/migrated/,
 *   which was the originally documented path here but was never actually used.
 *   Keep "generated" out of the migrated path entirely: playwright.config.ts's
 *   chromium/webkit projects exclude any path containing a "generated" segment,
 *   and its "generated" project's testMatch picks up any path containing one --
 *   a migrated-but-still-"generated"-named folder gets silently routed to the
 *   wrong project and the wrong baseURL.
 *
 * Usage:
 *   npx playwright test tc066-login.spec.ts --config=playwright.generated.config.ts --project=chromium
 *   npx playwright test --config=playwright.generated.config.ts   <- run all NEW generated tests
 * -------------------------------------------------------------
 */

import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  testDir:       './src/tests/generated',
  testIgnore:    ['**/migrated/**'],   // migrated tests live in main spec files -- skip here
  fullyParallel: false,
  retries:       0,           // fail fast -- we want to see what needs fixing
  workers:       1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/generated-test-results.json' }],
  ],
  use: {
    baseURL:           'https://www.saucedemo.com',
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    headless:          false,
    actionTimeout:     15000,
    navigationTimeout: 15000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
});
