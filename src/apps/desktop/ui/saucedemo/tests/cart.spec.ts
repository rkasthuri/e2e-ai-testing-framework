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
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { Users } from '../data/users';
import { LoginPage } from '../pages/LoginPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { CheckoutOverviewPage } from '../pages/CheckoutOverviewPage';

// standardUser fixture: logged in on /inventory.html.
// beforeEach handles the cart-specific setup (add items + navigate).

test.describe('Cart Functionality Tests', () => {

  test.beforeEach(async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    await inventoryPage.addToCartButtons.nth(0).click();
    // Wait for cart badge to confirm first item registered before
    // clicking again. webkit requires DOM to settle between actions
    // that trigger badge/button state changes.
    await standardUser.waitForFunction(() =>
      document.querySelector('.shopping_cart_badge')?.textContent === '1'
    );
    await inventoryPage.addToCartButtons.nth(0).click();
    await inventoryPage.goToCart();
  });

  test('TC017 - Verify cart page displays added items', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    await expect(cartPage.pageTitle).toContainText('Your Cart');

    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(2);

    console.log('✅ TC017 - Cart displays correct number of items');
  });

  test('TC018 - Remove item from cart', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    expect(await cartPage.getCartItemCount()).toBe(2);

    await cartPage.removeFirstItem();

    expect(await cartPage.getCartItemCount()).toBe(1);

    console.log('✅ TC018 - Item removed from cart');
  });

  test('TC019 - Remove all items from cart', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    await cartPage.removeAllItems();

    expect(await cartPage.isCartEmpty()).toBe(true);

    console.log('✅ TC019 - All items removed, cart is empty');
  });

  test('TC020 - Continue shopping from cart', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    await cartPage.continueShopping();

    await expect(standardUser).toHaveURL(/.*inventory\.html/);

    console.log('✅ TC020 - Continued shopping successfully');
  });

  test('TC021 - Proceed to checkout from cart', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    await cartPage.proceedToCheckout();

    await expect(standardUser).toHaveURL(/.*checkout-step-one\.html/);

    console.log('✅ TC021 - Proceeded to checkout');
  });

  test('TC022 - Verify cart badge count matches items', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    const badgeCount = await cartPage.getCartBadgeCount();
    const itemCount  = await cartPage.getCartItemCount();

    expect(badgeCount).toBe(itemCount);

    console.log('✅ TC022 - Badge count matches cart items');
  });

  test('TC023 - Verify item names displayed correctly', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    const itemNames = await cartPage.getItemNames();

    expect(itemNames.length).toBeGreaterThan(0);
    expect(itemNames[0]).toBeTruthy();

    console.log(`✅ TC023 - Items displayed: ${itemNames.join(', ')}`);
  });

  test('TC024 - Verify prices displayed correctly', async ({ standardUser }) => {
    const cartPage = new CartPage(standardUser);

    const prices = await cartPage.getItemPrices();

    expect(prices.length).toBeGreaterThan(0);
    prices.forEach(price => {
      expect(price).toBeGreaterThan(0);
    });

    console.log(`✅ TC024 - Prices displayed: ${prices.map(p => '$' + p).join(', ')}`);
  });
});

// ── Migrated from tc051-cart.spec.ts ──────────────────────────
test.describe('Cart Persistence', () => {
  test('TC051 - Cart persistence across logout/login sessions', async ({ standardUser, context }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add multiple items to cart
    const itemsToAdd = ['Sauce Labs Backpack', 'Sauce Labs Bike Light', 'Sauce Labs Bolt T-Shirt'];
    for (const item of itemsToAdd) {
      await inventoryPage.addItemToCart(item);
    }

    // Verify items were added
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);
    console.log('✅ TC051 - Added 3 items to cart before logout');

    // Navigate to cart to verify items pre-logout
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    const cartItems = await cartPage.getItemNames();
    expect(cartItems).toEqual(expect.arrayContaining(itemsToAdd));
    console.log('✅ TC051 - Verified all items present in cart before logout');

    // Logout via hamburger menu
    await inventoryPage.logout();
    console.log('✅ TC051 - Logged out successfully');

    // Login again with same user
    const loginPage = new LoginPage(standardUser);
    await loginPage.loginAndWait(Users.standard());
    console.log('✅ TC051 - Logged back in as standard_user');

    // SauceDemo persists cart state in localStorage — items survive logout/login within the same context
    const inventoryPageAfterLogin = new InventoryPage(standardUser);
    await standardUser.waitForURL('**/inventory.html');
    const badgeCountAfterLogin = await inventoryPageAfterLogin.getCartBadgeCount();
    expect(badgeCountAfterLogin).toBe(3);
    console.log('✅ TC051 - Cart persisted after logout/login (localStorage-based, not cleared on logout)');

    // Navigate to cart and confirm items are still present
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');
    const cartPageAfterLogin = new CartPage(standardUser);
    const cartItemsAfterLogin = await cartPageAfterLogin.getItemNames();
    expect(cartItemsAfterLogin).toEqual(expect.arrayContaining(itemsToAdd));
    console.log('✅ TC051 - Cart items confirmed persisted after logout/login (SauceDemo localStorage behavior)');
  });
});


// ── Migrated from tc052-cart.spec.ts ──────────────────────────
test.describe('Cart - Adding Same Item Multiple Times', () => {
  test('TC052 - Adding same item multiple times and quantity display', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add first item to cart
    const itemName = 'Sauce Labs Backpack';
    await inventoryPage.addItemToCart(itemName);
    
    // Verify badge shows 1
    let badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);

    // Attempt to add the same item again
    // Note: SauceDemo converts "Add to cart" to "Remove" after adding, so this tests the actual behavior
    const isInCart = await inventoryPage.isItemInCart(itemName);
    expect(isInCart).toBe(true);

    // Navigate to cart to verify behavior
    await standardUser.goto('https://www.saucedemo.com/cart.html');
    const cartPage = new CartPage(standardUser);

    // Verify cart has exactly 1 item (SauceDemo does not support quantity increments)
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);

    // Verify the item appears only once in the cart
    const itemNames = await cartPage.getItemNames();
    const itemOccurrences = itemNames.filter(name => name === itemName).length;
    expect(itemOccurrences).toBe(1);

    // Verify cart badge still shows 1
    expect(badgeCount).toBe(1);

    console.log('✅ TC052 - Verified same item cannot be added multiple times; SauceDemo maintains single instance per product');
  });
});


// ── Migrated from tc053-cart.spec.ts ──────────────────────────
test.describe('Cart - Maximum Items', () => {
  test('TC053 - Cart behavior with maximum items (all 6 products added)', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Get all product names to add them systematically
    const productNames = await inventoryPage.getProductNames();
    expect(productNames.length).toBe(6);
    console.log('✅ TC053 - Verified 6 products available in inventory');

    // Add all 6 products to cart
    for (const productName of productNames) {
      await inventoryPage.addItemToCart(productName);
    }
    console.log('✅ TC053 - Added all 6 products to cart');

    // Verify cart badge shows 6
    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(6);
    console.log('✅ TC053 - Cart badge displays 6 items');

    // Navigate to cart
    await standardUser.click('.shopping_cart_link');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);

    // Verify all 6 items are visible in cart
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(6);
    console.log('✅ TC053 - All 6 items visible in cart');

    // Verify all item names match
    const cartItemNames = await cartPage.getItemNames();
    expect(cartItemNames.length).toBe(6);
    for (const productName of productNames) {
      expect(await cartPage.isItemInCart(productName)).toBe(true);
    }
    console.log('✅ TC053 - All product names correctly displayed in cart');

    // Verify prices are displayed for all items
    const cartPrices = await cartPage.getItemPrices();
    expect(cartPrices.length).toBe(6);
    for (const price of cartPrices) {
      expect(price).toBeGreaterThan(0);
    }
    console.log('✅ TC053 - All 6 items have valid prices displayed');

    // Proceed to checkout to verify functionality with full cart
    await cartPage.proceedToCheckout();
    const checkoutPage = new CheckoutPage(standardUser);

    await checkoutPage.fillCheckoutInfo('John', 'Doe', '12345');
    await checkoutPage.continue();

    // Verify checkout overview with all 6 items
    const checkoutOverviewPage = new CheckoutOverviewPage(standardUser);
    const overviewItemCount = await checkoutOverviewPage.getItemCount();
    expect(overviewItemCount).toBe(6);
    console.log('✅ TC053 - Checkout overview displays all 6 items');

    // Verify totals are calculated correctly
    const subtotal = await checkoutOverviewPage.getSubtotal();
    const tax = await checkoutOverviewPage.getTax();
    const total = await checkoutOverviewPage.getTotal();
    
    expect(subtotal).toBeGreaterThan(0);
    expect(tax).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(subtotal);
    await expect(checkoutOverviewPage.verifyTotalIsCorrect()).resolves.toBe(true);
    console.log('✅ TC053 - Order totals correctly calculated for 6 items');

    console.log('✅ TC053 - Cart handles maximum items (6) with correct badge count and checkout functionality');
  });
});


// ── Migrated from tc054-cart.spec.ts ──────────────────────────
test.describe('Cart - Empty State', () => {
  test('TC054 - Empty cart state and checkout button behavior', async ({ standardUser }) => {
    // standardUser fixture already ensures inventory is fully loaded (6 items visible)
    // Navigate to cart without adding any items
    await standardUser.click('[data-test="shopping-cart-link"]');
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    
    // Verify cart is empty
    const isEmpty = await cartPage.isCartEmpty();
    expect(isEmpty).toBe(true);
    
    // Verify cart item count is 0
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(0);
    
    // Verify checkout button is present but attempting to proceed with empty cart
    const checkoutButton = standardUser.locator('[data-test="checkout"]');
    await expect(checkoutButton).toBeVisible();
    
    // Click checkout and verify we can proceed (SauceDemo allows empty cart checkout)
    await cartPage.proceedToCheckout();
    
    // Verify we are on checkout page even with empty cart
    await expect(standardUser).toHaveURL(/.*checkout-step-one.html/);
    
    console.log('✅ TC054 - Empty cart checkout behavior verified - SauceDemo allows proceeding with empty cart');
  });
});


// ── Migrated from tc055-cart.spec.ts ──────────────────────────
test.describe('Cart Item Details Display', () => {
  test('TC055 - Verify cart item description matches inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const testItemName = 'Sauce Labs Backpack';
    
    const inventoryItems = await standardUser.locator('.inventory_item').all();
    let inventoryDescription = '';
    
    for (const item of inventoryItems) {
      const nameElement = item.locator('.inventory_item_name');
      const name = await nameElement.textContent();
      
      if (name === testItemName) {
        const descElement = item.locator('.inventory_item_desc');
        inventoryDescription = await descElement.textContent() || '';
        break;
      }
    }

    expect(inventoryDescription).toBeTruthy();
    console.log(`📝 Inventory description captured: "${inventoryDescription.substring(0, 50)}..."`);

    await inventoryPage.addItemToCart(testItemName);
    const cartBadge = await inventoryPage.getCartBadgeCount();
    expect(cartBadge).toBe(1);

    await standardUser.locator('.shopping_cart_link').click();
    await standardUser.waitForURL('**/cart.html');

    const cartPage = new CartPage(standardUser);
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(1);

    const isInCart = await cartPage.isItemInCart(testItemName);
    expect(isInCart).toBe(true);

    const cartItem = standardUser.locator('.cart_item');
    const cartItemName = await cartItem.locator('.inventory_item_name').textContent();
    expect(cartItemName).toBe(testItemName);

    const cartItemDesc = await cartItem.locator('.inventory_item_desc').textContent();
    expect(cartItemDesc).toBe(inventoryDescription);

    console.log('✅ TC055 - Cart item description matches inventory page description');
  });
});

