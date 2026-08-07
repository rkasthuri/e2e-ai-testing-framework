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
 * scripts/fix-generated-tests.js
 * ─────────────────────────────────────────────────────────────
 * One-time bulk fix for AI-generated tests in src/tests/generated/.
 * Replaces hallucinated POM method calls with correct equivalents
 * from the actual Page Object Model.
 *
 * Run: node scripts/fix-generated-tests.js
 * ─────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

const GENERATED_DIR = path.join('src', 'tests', 'generated');

// ── Replacements ──────────────────────────────────────────────
// Each entry: { pattern: RegExp, replacement: string, description: string }
const FIXES = [
  // waitForLoad() does not exist on any POM. Replace with proper Playwright waits.
  {
    pattern:     /await inventoryPage\.waitForLoad\(\);/g,
    replacement: "await page.waitForURL('**/inventory.html');",
    description: 'inventoryPage.waitForLoad() → page.waitForURL(inventory)',
  },
  {
    pattern:     /await cartPage\.waitForLoad\(\);/g,
    replacement: "await page.waitForURL('**/cart.html');",
    description: 'cartPage.waitForLoad() → page.waitForURL(cart)',
  },
  {
    pattern:     /await checkoutPage\.waitForLoad\(\);/g,
    replacement: "await page.waitForURL('**/checkout-step-one.html');",
    description: 'checkoutPage.waitForLoad() → page.waitForURL(checkout-step-one)',
  },
  {
    pattern:     /await overviewPage\.waitForLoad\(\);/g,
    replacement: "await page.waitForURL('**/checkout-step-two.html');",
    description: 'overviewPage.waitForLoad() → page.waitForURL(checkout-step-two)',
  },
  {
    pattern:     /await completePage\.waitForLoad\(\);/g,
    replacement: "await page.waitForURL('**/checkout-complete.html');",
    description: 'completePage.waitForLoad() → page.waitForURL(checkout-complete)',
  },

  // addItemToCart('name') does not exist — InventoryPage only has addFirstItemToCart().
  // Replace with addFirstItemToCart() and a comment so it's visible on review.
  {
    pattern:     /await inventoryPage\.addItemToCart\([^)]+\);/g,
    replacement: "await inventoryPage.addFirstItemToCart(); // TODO: originally added specific item by name — verify this is the intended item",
    description: "inventoryPage.addItemToCart('name') → addFirstItemToCart()",
  },
];

// ── Process files ─────────────────────────────────────────────
const files = fs.readdirSync(GENERATED_DIR)
  .filter(f => f.endsWith('.spec.ts'))
  .map(f => path.join(GENERATED_DIR, f));

if (!files.length) {
  console.log('No .spec.ts files found in', GENERATED_DIR);
  process.exit(0);
}

let totalFixed = 0;

files.forEach(file => {
  const original = fs.readFileSync(file, 'utf-8');
  let updated    = original;
  const applied  = [];

  FIXES.forEach(({ pattern, replacement, description }) => {
    const before = updated;
    updated = updated.replace(pattern, replacement);
    if (updated !== before) applied.push(description);
  });

  if (applied.length) {
    fs.writeFileSync(file, updated, 'utf-8');
    console.log(`✅ ${path.basename(file)}`);
    applied.forEach(d => console.log(`   • ${d}`));
    totalFixed++;
  } else {
    console.log(`   ${path.basename(file)} — no changes needed`);
  }
});

console.log(`\n${totalFixed} file(s) patched. Re-run validation:\n`);
console.log('  npx playwright test --config=playwright.generated.config.ts --project=chromium\n');
