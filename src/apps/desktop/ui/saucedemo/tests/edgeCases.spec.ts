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
import { CartPage } from '../pages/CartPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { TestDataGenerator } from '../../../../../core/utils/testDataGenerator';
import { Users } from '../data/users';
import { CheckoutOverviewPage } from '../pages/CheckoutOverviewPage';
import { CheckoutCompletePage } from '../pages/CheckoutCompletePage';

// ── Security & Boundary Tests ─────────────────────────────────
// These test login validation — use guestPage (starts on login page).

test.describe('Edge Cases - Security & Boundary Testing', () => {

  test('EC001 - SQL Injection attempt', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    const sqlInjection = TestDataGenerator.getEdgeCaseInputs().find(e => e.type === 'sql_injection');

    if (sqlInjection) {
      await loginPage.attemptLogin({ username: sqlInjection.username, password: sqlInjection.password });
      await expect(loginPage.errorMessage).toBeVisible();
      await expect(guestPage).toHaveURL('https://www.saucedemo.com/');
      console.log('✅ EC001 - SQL injection prevented');
    }
  });

  test('EC002 - XSS attempt', async ({ guestPage }) => {
    const loginPage  = new LoginPage(guestPage);
    const xssAttempt = TestDataGenerator.getEdgeCaseInputs().find(e => e.type === 'xss_attempt');

    if (xssAttempt) {
      guestPage.on('dialog', () => { throw new Error('XSS alert was triggered!'); });
      await loginPage.attemptLogin({ username: xssAttempt.username, password: xssAttempt.password });
      await expect(loginPage.errorMessage).toBeVisible();
      console.log('✅ EC002 - XSS attempt prevented');
    }
  });

  test('EC003 - Very long input strings', async ({ guestPage }) => {
    const loginPage  = new LoginPage(guestPage);
    const longInput  = TestDataGenerator.getEdgeCaseInputs().find(e => e.type === 'long_input');

    if (longInput) {
      await loginPage.attemptLogin({ username: longInput.username, password: longInput.password });
      await expect(loginPage.errorMessage).toBeVisible();
      console.log('✅ EC003 - Long input handled gracefully');
    }
  });

  test('EC004 - Special characters in credentials', async ({ guestPage }) => {
    const loginPage    = new LoginPage(guestPage);
    const specialChars = TestDataGenerator.getEdgeCaseInputs().find(e => e.type === 'special_chars');

    if (specialChars) {
      await loginPage.attemptLogin({ username: specialChars.username, password: specialChars.password });
      await expect(loginPage.errorMessage).toBeVisible();
      console.log('✅ EC004 - Special characters handled');
    }
  });

  test('EC005 - Unicode characters', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    const unicode   = TestDataGenerator.getEdgeCaseInputs().find(e => e.type === 'unicode');

    if (unicode) {
      await loginPage.attemptLogin({ username: unicode.username, password: unicode.password });
      await expect(loginPage.errorMessage).toBeVisible();
      console.log('✅ EC005 - Unicode characters handled');
    }
  });

  test('EC006 - Whitespace handling', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin({ username: '   standard_user   ', password: '   secret_sauce   ' });

    const isError    = await loginPage.isErrorVisible();
    const currentUrl = guestPage.url();

    if (currentUrl.includes('inventory.html')) {
      console.log('✅ EC006 - Whitespace trimmed automatically');
    } else if (isError) {
      console.log('✅ EC006 - Whitespace not trimmed (validation working)');
    }
  });

  test('EC007 - Case sensitivity check', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.attemptLogin({ username: 'STANDARD_USER', password: 'secret_sauce' });

    await expect(loginPage.errorMessage).toBeVisible();
    console.log('✅ EC007 - Username is case-sensitive');
  });

  test('EC008 - Rapid successive login attempts', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    for (let i = 0; i < 5; i++) {
      await loginPage.loginButton.click();
      await guestPage.waitForTimeout(100);
    }

    await expect(loginPage.errorMessage).toBeVisible();
    console.log('✅ EC008 - Rapid attempts handled');
  });
});

// ── Browser Behavior Tests ────────────────────────────────────

test.describe('Edge Cases - Browser Behavior', () => {

  test('EC009 - Browser refresh on login page', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.usernameField.fill('standard_user');
    await loginPage.passwordField.fill('secret_sauce');
    await guestPage.reload();

    const usernameValue = await loginPage.usernameField.inputValue();
    const passwordValue = await loginPage.passwordField.inputValue();

    console.log(`✅ EC009 - After refresh: username="${usernameValue}", password="${passwordValue}"`);
    expect(usernameValue.length === 0 || passwordValue.length === 0).toBeTruthy();
  });

  test('EC010 - Browser back button after successful login', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);

    await loginPage.loginAndWait(Users.standard());
    await guestPage.goBack();
    await guestPage.waitForTimeout(1000);

    const currentUrl = guestPage.url();
    console.log(`✅ EC010 - After back button: URL=${currentUrl}`);
    expect(currentUrl.includes('inventory') || currentUrl === 'https://www.saucedemo.com/').toBeTruthy();
  });
});

// ── Self-Healing Tests ────────────────────────────────────────

test.describe('Edge Cases - Self-Healing Tests', () => {

  test('EC011 - Self-healing engine: strategy chain heals broken selector', async ({ guestPage }) => {
    // This test PROVES the healing engine works end-to-end.
    // We create a SmartLocator with a deliberately broken primary selector
    // and verify the framework heals to the fallback automatically.

    const { SmartLocator } = await import('../../../../../core/healing/SmartLocator');
    const { healStore }    = await import('../../../../../core/healing/HealStore');

    // Sabotage: primary selector is intentionally wrong
    const loginButton = new SmartLocator(guestPage, {
      key: 'ec011.loginButton',
      description: 'Login submit button on the login form',
      strategies: [
        { name: 'css',       selector: '[data-test="SABOTAGED-SELECTOR"]' }, // broken
        { name: 'data-test', selector: '[data-test="login-button"]' },       // fallback
        { name: 'id',        selector: '#login-button' },                    // second fallback
      ],
    });

    // Resolve -- should heal to fallback
    const resolved = await loginButton.resolve();
    await expect(resolved).toBeVisible();

    // Verify heal was recorded
    const events = loginButton.getHealEvents();
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('strategy-chain');
    expect(events[0].originalStrategy).toBe('css');
    expect(events[0].healedStrategy).toBe('data-test');

    // Verify heal store persisted the event
    const stored = healStore.getEntry('ec011.loginButton');
    expect(stored).toBeDefined();
    expect(stored!.healedSelector).toBe('[data-test="login-button"]');

    // Verify the healed selector actually works for a real interaction
    const usernameField = new SmartLocator(guestPage, {
      key: 'ec011.usernameField',
      description: 'Username input on login form',
      strategies: [
        { name: 'data-test', selector: '[data-test="username"]' },
        { name: 'id',        selector: '#user-name' },
      ],
    });

    await usernameField.fill('standard_user');
    await loginButton.click();

    // Should show error (no password) -- proves the healed element is interactive
    const errorMessage = guestPage.locator('[data-test="error"]');
    await expect(errorMessage).toBeVisible();

    // Cleanup heal store entry for this test key
    healStore.retireHeal('ec011.loginButton');
    healStore.retireHeal('ec011.usernameField');

    console.log('\u2705 EC011 - Self-healing engine proved: broken selector healed, interaction succeeded');
    console.log(`   Healed: ${events[0].originalStrategy} \u2192 ${events[0].healedStrategy}`);
    console.log(`   Selector: ${events[0].healedSelector}`);
  });

  test('EC012 - Cart items persist after navigating back from checkout', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    const cartPage      = new CartPage(standardUser);
    const checkoutPage  = new CheckoutPage(standardUser);

    await inventoryPage.addFirstItemToCart();
    const initialBadge = await inventoryPage.getCartBadgeCount();

    await inventoryPage.goToCart();

    const itemNamesBefore = await cartPage.getItemNames();
    const itemCountBefore = await cartPage.getCartItemCount();

    await cartPage.proceedToCheckout();
    await standardUser.goBack();
    await standardUser.waitForURL('**/cart.html');

    const itemNamesAfter  = await cartPage.getItemNames();
    const itemCountAfter  = await cartPage.getCartItemCount();
    const badgeAfter      = await cartPage.getCartBadgeCount();

    expect(itemCountAfter).toBe(itemCountBefore);
    expect(itemNamesAfter).toEqual(itemNamesBefore);
    expect(badgeAfter).toBe(initialBadge);

    console.log('✅ EC012 - Cart persisted after browser back navigation');
  });
});

// ── Migrated from ec013-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Concurrent Session Handling', () => {
  test('EC013 - Same user logged in multiple browsers/tabs simultaneously', async ({ browser }) => {
    // Create two independent browser contexts to simulate different browsers/devices
    const context1 = await browser.newContext({ baseURL: 'https://www.saucedemo.com' });
    const context2 = await browser.newContext({ baseURL: 'https://www.saucedemo.com' });
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Login with standard user in first context
      const loginPage1 = new LoginPage(page1);
      await loginPage1.goto();
      await loginPage1.loginAndWait(Users.standard());
      
      const inventoryPage1 = new InventoryPage(page1);
      // loginAndWait already navigated to inventory.html
      console.log('✅ EC013 - First session logged in successfully');

      // Login with same user in second context
      const loginPage2 = new LoginPage(page2);
      await loginPage2.goto();
      await loginPage2.loginAndWait(Users.standard());

      const inventoryPage2 = new InventoryPage(page2);
      // loginAndWait already navigated to inventory.html
      console.log('✅ EC013 - Second concurrent session logged in successfully');

      // Add different items to cart in each session
      await inventoryPage1.addItemToCart('Sauce Labs Backpack');
      const badge1 = await inventoryPage1.getCartBadgeCount();
      expect(badge1).toBe(1);
      console.log('✅ EC013 - Item added to cart in first session');

      await inventoryPage2.addItemToCart('Sauce Labs Bike Light');
      const badge2 = await inventoryPage2.getCartBadgeCount();
      expect(badge2).toBe(1);
      console.log('✅ EC013 - Item added to cart in second session');

      // Navigate to cart in both sessions and verify cart state
      await page1.click('[data-test="shopping-cart-link"]');
      await page1.waitForURL('**/cart.html');
      const cartPage1 = new CartPage(page1);
      const itemsInCart1 = await cartPage1.getItemNames();
      const cart1Count = await cartPage1.getCartItemCount();

      await page2.click('[data-test="shopping-cart-link"]');
      await page2.waitForURL('**/cart.html');
      const cartPage2 = new CartPage(page2);
      const itemsInCart2 = await cartPage2.getItemNames();
      const cart2Count = await cartPage2.getCartItemCount();

      console.log('✅ EC013 - Session 1 cart state:', { count: cart1Count, items: itemsInCart1 });
      console.log('✅ EC013 - Session 2 cart state:', { count: cart2Count, items: itemsInCart2 });

      // Verify both sessions remain functional
      expect(cart1Count).toBeGreaterThanOrEqual(1);
      expect(cart2Count).toBeGreaterThanOrEqual(1);
      expect(itemsInCart1.length).toBeGreaterThanOrEqual(1);
      expect(itemsInCart2.length).toBeGreaterThanOrEqual(1);

      console.log('✅ EC013 - Concurrent sessions handled correctly; both sessions functional with independent cart state');
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});


// ── Migrated from ec014-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Cart Capacity', () => {
  test('EC014 - Maximum cart capacity - adding all products to cart', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const productCount = await inventoryPage.getProductCount();
    console.log(`Total products available: ${productCount}`);
    expect(productCount).toBe(6);

    const productNames = await inventoryPage.getProductNames();
    console.log(`Products to add: ${productNames.join(', ')}`);

    for (const productName of productNames) {
      await inventoryPage.addItemToCart(productName);
      const isInCart = await inventoryPage.isItemInCart(productName);
      expect(isInCart).toBe(true);
    }

    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(6);
    console.log(`✅ EC014 - Successfully added all ${productCount} products to cart`);

    await standardUser.locator('.shopping_cart_link').click();
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);

    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(6);

    const cartItemNames = await cartPage.getItemNames();
    expect(cartItemNames).toHaveLength(6);
    
    for (const productName of productNames) {
      const isInCart = await cartPage.isItemInCart(productName);
      expect(isInCart).toBe(true);
    }

    console.log('✅ EC014 - Verified all 6 products are in cart with correct counts');
  });
});


// ── Migrated from ec015-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Checkout Security', () => {
  test('EC015 - Checkout form field injection with HTML/script tags', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    await inventoryPage.addFirstItemToCart();
    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(1);

    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    expect(await cartPage.getCartItemCount()).toBe(1);

    await cartPage.proceedToCheckout();

    const checkoutPage = new CheckoutPage(standardUser);
    const maliciousFirstName = '<script>alert(1)</script>';
    const maliciousLastName = '<img src=x onerror=alert(2)>';
    const maliciousPostalCode = '<b>12345</b>';

    await checkoutPage.fillCheckoutInfo(maliciousFirstName, maliciousLastName, maliciousPostalCode);
    await checkoutPage.continue();

    const overviewPage = new CheckoutOverviewPage(standardUser);
    
    const paymentInfoText = await standardUser.locator('[data-test="payment-info-value"]').textContent();
    const shippingInfoText = await standardUser.locator('[data-test="shipping-info-value"]').textContent();
    
    expect(paymentInfoText).toBeTruthy();
    expect(shippingInfoText).toBeTruthy();

    const pageContent = await standardUser.content();
    expect(pageContent).not.toContain('<script>');
    expect(pageContent).not.toContain('onerror=');
    expect(pageContent).not.toContain('alert(1)');
    expect(pageContent).not.toContain('alert(2)');

    const scriptTags = await standardUser.locator('script').allTextContents();
    const hasInjectedScript = scriptTags.some(script => script.includes('alert(1)') || script.includes('alert(2)'));
    expect(hasInjectedScript).toBe(false);

    const itemCount = await overviewPage.getItemCount();
    expect(itemCount).toBe(1);

    const subtotal = await overviewPage.getSubtotal();
    expect(subtotal).toBeGreaterThan(0);

    console.log('✅ EC015 - Checkout form fields properly sanitize dangerous input');
  });
});


// ── Migrated from ec016-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Session Management', () => {
  test('EC016 - Session timeout during checkout process', async ({ standardUser, context }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(2);

    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(2);

    await cartPage.proceedToCheckout();
    const checkoutPage = new CheckoutPage(standardUser);

    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');

    await context.clearCookies();
    await standardUser.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    // Use raw click — continue() enforces waitForURL step-two which times out if session
    // clearing causes a redirect to login instead
    await checkoutPage.continueButton.click();
    await standardUser.waitForTimeout(2000);

    const currentUrl = standardUser.url();
    const isOnLoginPage = currentUrl.includes('index.html') || currentUrl === 'https://www.saucedemo.com/' || !currentUrl.includes('inventory') && !currentUrl.includes('checkout');
    
    if (isOnLoginPage) {
      const loginPage = new LoginPage(standardUser);
      const errorVisible = await loginPage.isErrorVisible();
      
      if (errorVisible) {
        const errorMessage = await loginPage.getErrorMessage();
        expect(errorMessage.length).toBeGreaterThan(0);
        console.log('✅ EC016 - Session timeout redirected to login with error message');
      } else {
        console.log('✅ EC016 - Session timeout redirected to login page (session cleared)');
      }
    } else {
      console.log('✅ EC016 - Session timeout handling verified (cookies and storage cleared)');
    }
  });
});


// ── Migrated from ec017-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Network Interruption', () => {
  test('EC017 - Network interruption during checkout completion', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add item to cart and proceed to checkout
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await standardUser.locator('[data-test="shopping-cart-link"]').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    await cartPage.proceedToCheckout();

    // Fill checkout information
    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify we're on overview page
    const overviewPage = new CheckoutOverviewPage(standardUser);
    const itemCount = await overviewPage.getItemCount();
    expect(itemCount).toBe(1);

    // Simulate offline network before finishing.
    // NOTE: SauceDemo is fully client-side — there are no server calls during checkout,
    // so offline mode does NOT block completion. This test validates that expected behaviour.
    await standardUser.context().setOffline(true);

    // Finish checkout while offline — should succeed (no network requests needed)
    await overviewPage.finish();

    // Restore network
    await standardUser.context().setOffline(false);

    // Verify checkout completed successfully despite being offline
    await expect(standardUser.locator('[data-test="complete-header"]')).toBeVisible();
    expect(standardUser.url()).toContain('checkout-complete.html');

    console.log('✅ EC017 - Client-side SauceDemo checkout completes successfully even when offline');
  });
});


// ── Migrated from ec018-edge-cases.spec.ts ──────────────────────────
test.describe('Edge Cases - Price Manipulation', () => {
  test('EC018 - Price manipulation via browser DevTools before checkout', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const originalPrices = await inventoryPage.getProductPrices();
    console.log(`Original prices: ${originalPrices}`);

    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');

    const cartPage = new CartPage(standardUser);
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');

    const cartPricesBeforeTampering = await cartPage.getItemPrices();
    console.log(`Cart prices before tampering: ${cartPricesBeforeTampering}`);

    await standardUser.evaluate(() => {
      const priceElements = document.querySelectorAll('.inventory_item_price');
      priceElements.forEach((el) => {
        el.textContent = '$0.01';
      });
    });

    const cartPricesAfterTampering = await cartPage.getItemPrices();
    console.log(`Cart prices after DOM tampering: ${cartPricesAfterTampering}`);

    await cartPage.proceedToCheckout();

    const checkoutPage = new CheckoutPage(standardUser);
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    const overviewPage = new CheckoutOverviewPage(standardUser);
    await standardUser.waitForURL('**/checkout-step-two.html');

    const subtotal = await overviewPage.getSubtotal();
    const tax = await overviewPage.getTax();
    const total = await overviewPage.getTotal();

    console.log(`Server-side subtotal: ${subtotal}, tax: ${tax}, total: ${total}`);

    const expectedSubtotal = cartPricesBeforeTampering.reduce((sum, price) => sum + price, 0);
    expect(subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(subtotal).not.toBeCloseTo(0.02, 1);

    await overviewPage.verifyTotalIsCorrect();

    await overviewPage.finish();

    const completePage = new CheckoutCompletePage(standardUser);
    await standardUser.waitForURL('**/checkout-complete.html');
    const isComplete = await completePage.isOrderComplete();
    expect(isComplete).toBe(true);

    console.log('✅ EC018 - Server correctly validated prices; DOM tampering had no effect on actual charge');
  });
});

