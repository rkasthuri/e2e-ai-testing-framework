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
 * nl-test-generator.ts
 * ─────────────────────────────────────────────────────────────
 * Step 5 — Natural Language Test Generation
 * Personal AI-Augmented Testing Framework
 *
 * Type plain English. Get a complete, ready-to-run Playwright
 * test that matches your exact framework style.
 *
 * Usage:
 *   npx tsx src/nl-test-generator.ts
 *   npx tsx src/nl-test-generator.ts --preview   (show only, don't write)
 *   npx tsx src/nl-test-generator.ts --prompt "Test that logged-out user cannot access inventory"
 * ─────────────────────────────────────────────────────────────
 */

import Anthropic   from '@anthropic-ai/sdk';
import * as fs     from 'fs';
import * as path   from 'path';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import {
  PAGE_OBJECT_METHODS as SHARED_PAGE_OBJECT_METHODS,
  SPEC_REGISTRY as SHARED_SPEC_REGISTRY,
  getLastEcNum as getSharedLastEcNum,
  getLastTcNum as getSharedLastTcNum,
  getSpecSummary,
} from '../core/ai/generation-context';
import { getAppName, getBaseUrl } from '../core/config/appConfig'

dotenv.config();

// ── Types ────────────────────────────────────────────────────

interface TestDecision {
  specFile:      string;
  describeBlock: string;
  testId:        string;
  priority:      'P0' | 'P1' | 'P2' | 'EC';
  reasoning:     string;
}

interface GeneratedTest {
  decision:     TestDecision;
  imports:      string[];
  testCode:     string;
  fullTest:     string;
  newMethods:   string[];
}
function getLastTcNum(): number {
  let maxNum = 0;
  const files = fs.readdirSync('src/tests').filter(f => f.endsWith('.spec.ts'));
  for (const file of files) {
    const content = fs.readFileSync(`src/tests/${file}`, 'utf-8');
    const matches = content.match(/test\([`'"]TC(\d+)/g) ?? [];
    for (const match of matches) {
      const num = parseInt(match.replace(/test\([`'"]TC/, ''));
      if (num > maxNum) maxNum = num;
    }
  }
  return maxNum;
}

function getLastEcNum(): number {
  const content = fs.readFileSync('src/tests/edgeCases.spec.ts', 'utf-8');
  const matches = content.match(/test\([`'"]EC(\d+)/g) ?? [];
  let maxNum = 0;
  for (const match of matches) {
    const num = parseInt(match.replace(/test\([`'"]EC/, ''));
    if (num > maxNum) maxNum = num;
  }
  return maxNum;
}
// ── Spec file registry — current state of your framework ─────

const SPEC_REGISTRY = {
  'login.spec.ts': {
    path:        'src/tests/login.spec.ts',
    lastTcNum:   10,
    describes:   ['P0 - Critical Login Tests', 'P1 - High Priority Tests', 'P2 - Data-Driven Tests'],
    pageObjects: ['LoginPage', 'InventoryPage'],
    topic:       'authentication, login, logout, credentials, locked user',
  },
  'inventory.spec.ts': {
    path:        'src/tests/inventory.spec.ts',
    lastTcNum:   16,
    describes:   ['Inventory Page Tests'],
    pageObjects: ['LoginPage', 'InventoryPage'],
    topic:       'inventory, products, add to cart, cart badge, menu, sorting',
  },
  'cart.spec.ts': {
    path:        'src/tests/cart.spec.ts',
    lastTcNum:   24,
    describes:   ['Cart Functionality Tests'],
    pageObjects: ['LoginPage', 'InventoryPage', 'CartPage'],
    topic:       'cart, remove items, cart badge, checkout button, item names, prices',
  },
  'checkout.spec.ts': {
    path:        'src/tests/checkout.spec.ts',
    lastTcNum:   32,
    describes:   ['Checkout Flow Tests'],
    pageObjects: ['LoginPage', 'InventoryPage', 'CartPage', 'CheckoutPage', 'CheckoutOverviewPage', 'CheckoutCompletePage'],
    topic:       'checkout, payment, shipping info, order summary, tax, total price, complete order',
  },
  'e2e-journey.spec.ts': {
    path:        'src/tests/e2e-journey.spec.ts',
    lastTcNum:   36,
    describes:   ['E2E User Journey Tests'],
    pageObjects: ['LoginPage', 'InventoryPage', 'CartPage', 'CheckoutPage', 'CheckoutOverviewPage', 'CheckoutCompletePage'],
    topic:       'end-to-end, full journey, multiple steps, complete workflow',
  },
  'edgeCases.spec.ts': {
    path:        'src/tests/edgeCases.spec.ts',
    lastEcNum:   11,
    describes:   ['Edge Cases - Security & Boundary Testing', 'Edge Cases - Browser Behavior', 'Edge Cases - Self-Healing Tests'],
    pageObjects: ['LoginPage', 'TestDataGenerator'],
    topic:       'security, SQL injection, XSS, boundary, browser behavior, refresh, back button, self-healing',
  },
};

// ── Page Object method reference ──────────────────────────────

const PAGE_OBJECT_METHODS = `
LoginPage:
  - goto()                          — navigate to login page
  - login(username, password)       — fill and submit login form
  - smartLogin(username, password)  — login with self-healing selectors
  - usernameField / passwordField / loginButton  — locators
  - errorMessage                    — error message locator
  - getErrorMessageText()           — returns error text
  - isErrorMessageVisible()         — returns boolean

InventoryPage:
  - pageTitle                       — 'Products' heading locator
  - shoppingCartLink                — cart icon locator
  - menuButton                      — hamburger menu locator
  - addToCartButtons                — all Add to Cart buttons
  - addFirstItemToCart()            — clicks first Add to Cart button
  - getInventoryItemCount()         — returns number of products
  - getCartBadgeCount()             — returns badge count string

CartPage:
  - pageTitle / cartItems / removeButtons
  - continueShoppingButton / checkoutButton / cartBadge
  - getCartItemCount()              — number of items in cart
  - getCartBadgeCount()             — badge count string
  - getItemNames()                  — array of item name strings
  - getItemPrices()                 — array of price strings
  - removeFirstItem()               — removes first cart item
  - removeAllItems()                — removes all items
  - continueShopping()              — clicks Continue Shopping
  - proceedToCheckout()             — clicks Checkout button
  - isCartEmpty()                   — returns boolean

CheckoutPage:
  - fillCheckoutInfo(first, last, zip)
  - continue()                      — clicks Continue button
  - cancel()                        — clicks Cancel button
  - isErrorVisible()                — returns boolean
  - getErrorMessage()               — returns error text

CheckoutOverviewPage:
  - pageTitle
  - getItemCount()                  — number of items
  - getItemTotal()                  — subtotal as number
  - getTax()                        — tax as number
  - getTotal()                      — total as number
  - finish()                        — clicks Finish button
  - cancel()                        — clicks Cancel button

CheckoutCompletePage:
  - isOrderComplete()               — returns boolean
  - getCompleteMessage()            — returns completion text
  - backToProducts()                — clicks Back Home button
`;

// ── Config ───────────────────────────────────────────────────

const CONFIG = {
  testsDir:  'src/tests',
  model:     'claude-sonnet-4-5' as const,
  preview:   process.argv.includes('--preview'),
  prompt:    getArg('--prompt'),
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n✨ NL Test Generator — describe a test in plain English\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set.\n');
    process.exit(1);
  }

  // Get the prompt
  const userPrompt = CONFIG.prompt ?? await askUser(
    '📝 Describe the test you want to create:\n   > '
  );

  if (!userPrompt.trim()) {
    console.log('❌ No description provided.\n');
    process.exit(1);
  }

  console.log(`\n🤖 Generating test for: "${userPrompt}"\n`);

  // Step 1 — Decide where the test belongs
  console.log('  [1/3] Deciding test placement...');
  const decision = await decideTestPlacement(userPrompt);
  console.log(`         → ${decision.testId} in ${decision.specFile} (${decision.priority})`);
  console.log(`         → ${decision.reasoning}`);

  // Step 2 — Generate the test code
  console.log('  [2/3] Generating test code...');
  const generated = await generateTestCode(userPrompt, decision);
  console.log(`         → ${generated.testCode.split('\n').length} lines generated`);

  if (generated.newMethods.length > 0) {
    console.log(`         → ⚠️  New Page Object methods needed:`);
    generated.newMethods.forEach(m => console.log(`              • ${m}`));
  }

  // Step 3 — Show preview
  console.log('\n  [3/3] Test preview:\n');
  console.log('─'.repeat(60));
  console.log(generated.fullTest);
  console.log('─'.repeat(60));

  if (CONFIG.preview) {
    console.log('\n  ℹ️  Preview mode — file not modified.\n');
    writeReports(userPrompt, decision, generated);
    return;
  }

  // Step 4 — Confirm and write
  const confirm = await askUser(
    `\n💾 Add this test to ${decision.specFile}? (yes/no): `
  );

  if (confirm.toLowerCase().startsWith('y')) {
    appendTestToFile(decision, generated);
    writeReports(userPrompt, decision, generated);
    console.log(`\n✅ Test added to ${decision.specFile}`);
    console.log(`   Run it: npx playwright test ${decision.specFile} --grep "${decision.testId}"\n`);
  } else {
    console.log('\n  Test not written. Run again to regenerate.\n');
    writeReports(userPrompt, decision, generated);
  }
}

// ── Step 1: Decide test placement ────────────────────────────

async function decideTestPlacement(prompt: string): Promise<TestDecision> {
  const specSummary = Object.entries(SPEC_REGISTRY)
    .map(([file, info]) => `${file}: ${info.topic}`)
    .join('\n');

const lastNumbers = `Global last TC number: TC${getLastTcNum().toString().padStart(3,'0')} — next TC is TC${(getLastTcNum()+1).toString().padStart(3,'0')}
Global last EC number: EC${getLastEcNum().toString().padStart(3,'0')} — next EC is EC${(getLastEcNum()+1).toString().padStart(3,'0')}`;

  const message = await client.messages.create({
    model:      CONFIG.model,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `You are deciding where a new Playwright test belongs in a test framework for ${getAppName()}.

Spec files and their topics:
${specSummary}

Current TC/EC numbering:
${lastNumbers}

User wants to create this test:
"${prompt}"

Decide:
1. Which spec file it belongs in
2. Which describe block within that file
3. What TC/EC number to assign (next available after the last one)
4. What priority (P0=critical auth/core flow, P1=high priority, P2=data-driven, EC=edge case)

Respond ONLY in this JSON (no markdown):
{
  "specFile": "filename.spec.ts",
  "describeBlock": "exact describe block name",
  "testId": "TC037 (MUST be zero-padded to 3 digits — TC037 not TC37, EC012 not EC12)",
  "priority": "P0" or "P1" or "P2" or "EC",
  "reasoning": "one sentence why"
}
CRITICAL: testId must always use 3-digit zero-padded numbers. TC037 ✓, TC37 ✗. EC012 ✓, EC12 ✗.
`
    }]
  });

  const content = message.content[0].type === 'text' ? message.content[0].text : '';
  const clean   = content.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── Step 2: Generate test code ────────────────────────────────

async function generateTestCode(
  prompt: string,
  decision: TestDecision
): Promise<GeneratedTest> {

  const specInfo = SPEC_REGISTRY[decision.specFile as keyof typeof SPEC_REGISTRY];
  const existingContent = readSpecFile(decision.specFile);

  const message = await client.messages.create({
    model:      CONFIG.model,
    max_tokens: 2048,
    system: `You are a senior QA automation engineer writing Playwright tests for ${getAppName()} (${getBaseUrl()}).

STRICT STYLE RULES — follow exactly:
1. Test ID format: test('${decision.testId} - Description', async ({ page }) => {
2. End every test with: console.log('✅ ${decision.testId} - Brief success message');
3. Use Page Object Model — never use raw selectors directly in tests
4. Login pattern for non-E2E tests:
   const loginPage = new LoginPage(page);
   const inventoryPage = new InventoryPage(page);  // if needed
   await loginPage.goto();
   await loginPage.login(
     process.env.APP_USERNAME || '<username>',
     process.env.APP_PASSWORD || '<password>'
   );
   await page.waitForURL('**/inventory.html');
5. For E2E tests: add step-by-step console.log with emoji (🔐 🛍️ 💳 ✅ 🎉)
6. Use expect() assertions from @playwright/test
7. TypeScript — properly typed
8. Add a short inline comment on every action line explaining its purpose.
   Format: await loginPage.goto(); // Navigate to login page
   Examples:
   await loginPage.login(
     process.env.APP_USERNAME || '<username>',
     process.env.APP_PASSWORD || '<password>'
   ); // Login with valid credentials
   await page.waitForURL('**/inventory.html');              // Confirm successful redirect to inventory
   await inventoryPage.addFirstItemToCart();               // Add first product to cart
   await page.goBack();                                    // Simulate browser back button
   expect(itemCountAfterBack).toBe(itemCountBeforeCheckout); // Verify cart count unchanged after back navigation
   Keep comments concise — max 8 words.

Available Page Object methods:
${PAGE_OBJECT_METHODS}

Base URL: ${getBaseUrl()}`,

    messages: [{
      role: 'user',
      content: `Generate a Playwright test for this requirement:
"${prompt}"

Test placement:
- File: ${decision.specFile}
- Describe block: ${decision.describeBlock}
- Test ID: ${decision.testId}
- Priority: ${decision.priority}

Existing spec (for style reference — do NOT duplicate existing tests):
\`\`\`typescript
${existingContent.slice(0, 2000)}
\`\`\`

Respond ONLY in this JSON (no markdown):
{
  "imports": ["import { CartPage } from '../pages/CartPage';"],
  "testCode": "the complete test() block as a string",
  "newMethods": ["optional: list any new Page Object methods needed that don't exist yet"]
}`
    }]
  });

  const content  = message.content[0].type === 'text' ? message.content[0].text : '';
  const clean    = content.replace(/```json|```/g, '').trim();
  const parsed   = JSON.parse(clean);

  // Build the full formatted test
  const fullTest = formatGeneratedTest(parsed.testCode, decision);

  return {
    decision,
    imports:    parsed.imports    ?? [],
    testCode:   parsed.testCode   ?? '',
    fullTest,
    newMethods: parsed.newMethods ?? [],
  };
}

// ── Format the generated test cleanly ────────────────────────

function formatGeneratedTest(testCode: string, decision: TestDecision): string {
  return `
  // ── Generated by NL Test Generator ──────────────────────────
  // Prompt: see reports/generated-tests.md
  // Generated: ${new Date().toLocaleString()}

  ${testCode}`;
}

// ── Append test to spec file ──────────────────────────────────

function appendTestToFile(decision: TestDecision, generated: GeneratedTest) {
  const specPath = path.join(CONFIG.testsDir, decision.specFile);

  if (!fs.existsSync(specPath)) {
    console.error(`❌ Spec file not found: ${specPath}`);
    return;
  }

  let content = fs.readFileSync(specPath, 'utf-8');

  // Add any new imports not already present
  for (const imp of generated.imports) {
    if (!content.includes(imp)) {
      // Add after existing imports
      const lastImportIdx = content.lastIndexOf('import ');
      const endOfLastImport = content.indexOf('\n', lastImportIdx);
      content = content.slice(0, endOfLastImport + 1) +
                imp + '\n' +
                content.slice(endOfLastImport + 1);
    }
  }

  // Find the closing }); of the target describe block and insert before it
  const describePattern = `test.describe('${decision.describeBlock}'`;
  const describeIdx = content.indexOf(describePattern);

  if (describeIdx === -1) {
    // Describe block not found — append before final });
    const lastClose = content.lastIndexOf('});');
    content = content.slice(0, lastClose) +
              generated.fullTest + '\n' +
              content.slice(lastClose);
  } else {
    // Find the closing }); of THIS describe block
    let depth    = 0;
    let startIdx = content.indexOf('{', describeIdx);
    let endIdx   = startIdx;

    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) { endIdx = i; break; }
    }

    // Insert before the closing }) of the describe block
    content = content.slice(0, endIdx - 1) +
              generated.fullTest + '\n' +
              content.slice(endIdx - 1);
  }

  fs.writeFileSync(specPath, content, 'utf-8');
}

// ── Write reports ─────────────────────────────────────────────

function writeReports(prompt: string, decision: TestDecision, generated: GeneratedTest) {
  ensureDir('reports');

  // Append to generated-tests log
  const logPath = 'reports/generated-tests.md';
  const entry = [
    '',
    `## ${decision.testId} — ${new Date().toLocaleString()}`,
    `**Prompt:** ${prompt}`,
    `**File:** ${decision.specFile} → \`${decision.describeBlock}\``,
    `**Priority:** ${decision.priority} · **Reasoning:** ${decision.reasoning}`,
    '',
    '```typescript',
    generated.fullTest.trim(),
    '```',
    '',
    generated.newMethods.length > 0
      ? `**⚠️ New Page Object methods needed:**\n${generated.newMethods.map(m => `- ${m}`).join('\n')}`
      : '',
    '',
    '---',
  ].join('\n');

  const existing = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf-8')
    : '# Generated Tests Log\n';

  fs.writeFileSync(logPath, existing + entry, 'utf-8');
  console.log(`\n  📝 Logged to reports/generated-tests.md`);
}

// ── Helpers ───────────────────────────────────────────────────

function readSpecFile(filename: string): string {
  const filePath = path.join(CONFIG.testsDir, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
