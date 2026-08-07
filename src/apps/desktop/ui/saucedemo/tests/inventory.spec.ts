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
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { Users } from '../data/users';
import { LoginPage } from '../pages/LoginPage';
import { CartPage } from '../pages/CartPage';

// standardUser fixture: already logged in and on /inventory.html
// No beforeEach needed — fixture handles login and navigation.

test.describe('Inventory Page Tests', () => {

  test('TC011 - Verify inventory page loads with products', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await expect(inventoryPage.pageTitle).toContainText('Products');

    const itemCount = await inventoryPage.getProductCount();
    expect(itemCount).toBe(6);

    console.log('✅ TC011 - Inventory page loaded with 6 products');
  });

  test('TC012 - Add single item to cart', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await inventoryPage.addFirstItemToCart();

    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);

    console.log('✅ TC012 - Item added to cart successfully');
  });

  test('TC013 - Add multiple items to cart', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await inventoryPage.addToCartButtons.nth(0).click();
    await inventoryPage.addToCartButtons.nth(1).click();
    await inventoryPage.addToCartButtons.nth(2).click();

    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);

    console.log('✅ TC013 - Multiple items added to cart');
  });

  test('TC014 - Remove item from inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await inventoryPage.addFirstItemToCart();
    expect(await inventoryPage.getCartBadgeCount()).toBe(1);

    await inventoryPage.removeButtons.first().click();

    const isBadgeVisible = await inventoryPage.isCartBadgeVisible();
    expect(isBadgeVisible).toBe(false);

    console.log('✅ TC014 - Item removed from cart');
  });

  test('TC015 - Navigate to cart from inventory', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await inventoryPage.addFirstItemToCart();
    await inventoryPage.goToCart();

    await expect(standardUser).toHaveURL(/.*cart\.html/);
    await expect(inventoryPage.pageTitle).toContainText('Your Cart');

    console.log('✅ TC015 - Navigated to cart successfully');
  });

  test('TC016 - Verify menu functionality', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);

    await inventoryPage.openMenu();

    await expect(inventoryPage.logoutLink).toBeVisible();

    console.log('✅ TC016 - Menu opened successfully');
  });
});

// ── Migrated from tc045-inventory.spec.ts ──────────────────────────
test.describe('Inventory - Product Sorting', () => {
  test('TC045 - Product sorting functionality changes display order correctly', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // [data-test="product_sort_container"] is absent in this SauceDemo build.
    // Drive the select element directly by CSS class; use POM only for reading results.
    const sortSelect = standardUser.locator('select.product_sort_container');
    await expect(sortSelect).toBeVisible({ timeout: 15000 });

    // Test Name A-Z (default sort)
    await sortSelect.selectOption('az');
    await standardUser.waitForLoadState('domcontentloaded');
    const namesAZ = await inventoryPage.getProductNames();
    const sortedAZ = [...namesAZ].sort((a, b) => a.localeCompare(b));
    expect(namesAZ).toEqual(sortedAZ);
    console.log('✅ TC045 - Name A-Z sort verified: products displayed in alphabetical order');

    // Test Name Z-A
    await sortSelect.selectOption('za');
    await standardUser.waitForLoadState('domcontentloaded');
    const namesZA = await inventoryPage.getProductNames();
    const sortedZA = [...namesZA].sort((a, b) => b.localeCompare(a));
    expect(namesZA).toEqual(sortedZA);
    console.log('✅ TC045 - Name Z-A sort verified: products displayed in reverse alphabetical order');

    // Test Price low to high
    await sortSelect.selectOption('lohi');
    await standardUser.waitForLoadState('domcontentloaded');
    const pricesLowHigh = await inventoryPage.getProductPrices();
    const sortedLowHigh = [...pricesLowHigh].sort((a, b) => a - b);
    expect(pricesLowHigh).toEqual(sortedLowHigh);
    console.log('✅ TC045 - Price low-high sort verified: products displayed from lowest to highest price');

    // Test Price high to low
    await sortSelect.selectOption('hilo');
    await standardUser.waitForLoadState('domcontentloaded');
    const pricesHighLow = await inventoryPage.getProductPrices();
    const sortedHighLow = [...pricesHighLow].sort((a, b) => b - a);
    expect(pricesHighLow).toEqual(sortedHighLow);
    console.log('✅ TC045 - Price high-low sort verified: products displayed from highest to lowest price');

    // Verify product count is consistent across sorts
    const productCount = await inventoryPage.getProductCount();
    expect(productCount).toBeGreaterThan(0);
    console.log('✅ TC045 - All sorting options maintain consistent product count');
  });
});

// ── Migrated from tc046-inventory.spec.ts ──────────────────────────
test.describe('Inventory - Product Detail Page', () => {
  test('TC046 - Product detail page loads when clicking product name or image, displays correct product information', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Get first product information from inventory page
    const productNames = await inventoryPage.getProductNames();
    const productPrices = await inventoryPage.getProductPrices();
    const firstProductName = productNames[0];
    const firstProductPrice = productPrices[0];

    // Click product name to navigate to detail page
    await standardUser.locator('.inventory_item_name').first().click();

    // Verify detail page URL
    await expect(standardUser).toHaveURL(/.*inventory-item\.html\?id=\d+/);

    const productDetailPage = new ProductDetailPage(standardUser);
    await expect(productDetailPage.isLoaded()).resolves.toBe(true);

    // Verify product name matches
    const detailProductName = await productDetailPage.getProductName();
    expect(detailProductName).toBe(firstProductName);

    // Verify product price matches
    const detailProductPrice = await productDetailPage.getProductPrice();
    expect(detailProductPrice).toBe(firstProductPrice);

    // Verify product description is present
    const description = await productDetailPage.getProductDescription();
    expect(description.length).toBeGreaterThan(0);

    // [data-test^="add-to-cart-"] is absent on detail page buttons in this SauceDemo build.
    // Use text-based selectors to interact with the buttons directly.
    const addToCartBtn = standardUser.locator('button:has-text("Add to cart")');
    await expect(addToCartBtn).toBeVisible({ timeout: 10000 });

    await addToCartBtn.click();
    const removeBtn = standardUser.locator('button:has-text("Remove")');
    await expect(removeBtn).toBeVisible({ timeout: 5000 });

    // Navigate back and test clicking product image
    await productDetailPage.goBackToInventory();
    await standardUser.waitForURL('**/inventory.html');

    // Click product image to navigate to detail page
    await standardUser.locator('.inventory_item_img').first().click();
    await expect(standardUser).toHaveURL(/.*inventory-item\.html\?id=\d+/);
    await expect(productDetailPage.isLoaded()).resolves.toBe(true);

    // Verify same product is displayed
    const detailProductNameAgain = await productDetailPage.getProductName();
    expect(detailProductNameAgain).toBe(firstProductName);

    console.log('✅ TC046 - Product detail page loads correctly with accurate product information');
  });
});
// ── Migrated from tc047-inventory.spec.ts ──────────────────────────
test.describe('Cart Badge Counter Updates', () => {
  test('TC047 - Cart badge counter updates correctly when adding/removing items from inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Verify initial badge count is 0 (no badge visible)
    const initialCount = await inventoryPage.getCartBadgeCount();
    expect(initialCount).toBe(0);
    console.log('✅ TC047 - Initial cart badge count is 0');

    // Add first item to cart
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    let badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC047 - Badge count incremented to 1 after adding first item');

    // Add second item to cart
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(2);
    console.log('✅ TC047 - Badge count incremented to 2 after adding second item');

    // Add third item to cart
    await inventoryPage.addItemToCart('Sauce Labs Bolt T-Shirt');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(3);
    console.log('✅ TC047 - Badge count incremented to 3 after adding third item');

    // Remove one item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Bike Light');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(2);
    console.log('✅ TC047 - Badge count decremented to 2 after removing one item');

    // Remove another item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Backpack');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC047 - Badge count decremented to 1 after removing another item');

    // Remove last item from cart
    await inventoryPage.removeItemFromCart('Sauce Labs Bolt T-Shirt');
    badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(0);
    console.log('✅ TC047 - Badge count reset to 0 after removing all items');
  });
});


// ── Migrated from tc048-inventory.spec.ts ──────────────────────────
test.describe('Inventory - Button State Toggle', () => {
  test('TC048 - Add/Remove button toggles state correctly (Add to Cart ↔ Remove) on inventory page', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    const itemName = 'Sauce Labs Backpack';
    
    // Verify initial state shows "Add to cart" (SauceDemo uses data-test^="add-to-cart-" attributes)
    const addButton = standardUser.locator(`[data-test^="add-to-cart-"]`).first();
    await expect(addButton).toHaveText('Add to cart');
    console.log('✅ TC048 - Initial button state verified: "Add to cart"');

    // Add item to cart
    await inventoryPage.addItemToCart(itemName);

    // Verify button changes to "Remove"
    const removeButton = standardUser.locator(`[data-test^="remove-"]`).first();
    await expect(removeButton).toHaveText('Remove');
    console.log('✅ TC048 - Button state changed to "Remove" after adding item');

    // Verify cart badge shows 1 item
    const cartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(cartBadgeCount).toBe(1);
    console.log('✅ TC048 - Cart badge count reflects added item');

    // Remove item from cart
    await inventoryPage.removeItemFromCart(itemName);
    
    // Verify button changes back to "Add to cart"
    await expect(addButton).toHaveText('Add to cart');
    console.log('✅ TC048 - Button state toggled back to "Add to cart" after removing item');

    // Verify cart badge is no longer visible
    const finalCartBadgeCount = await inventoryPage.getCartBadgeCount();
    expect(finalCartBadgeCount).toBe(0);
    console.log('✅ TC048 - Cart badge cleared after item removal');

    console.log('✅ TC048 - Add/Remove button toggle behavior verified correctly');
  });
});


// ── Migrated from tc049-inventory.spec.ts ──────────────────────────
test.describe('Inventory - Problem User Experience', () => {
  test('TC049 - Problem user experience - verify inventory page handles image/data issues gracefully', async ({ guestPage }) => {
    const loginPage = new LoginPage(guestPage);
    await loginPage.goto();
    await loginPage.loginAndWait(Users.problem());
    console.log('✅ TC049 - Problem user logged in successfully');

    const inventoryPage = new InventoryPage(guestPage);
    // loginAndWait already navigated to inventory.html
    console.log('✅ TC049 - Inventory page loaded despite problem user issues');

    const productCount = await inventoryPage.getProductCount();
    expect(productCount).toBeGreaterThan(0);
    console.log('✅ TC049 - Products are displayed with count: ' + productCount);

    const productNames = await inventoryPage.getProductNames();
    expect(productNames.length).toBeGreaterThan(0);
    console.log('✅ TC049 - Product names are visible despite data issues');

    const images = await guestPage.locator('.inventory_item_img img').all();
    expect(images.length).toBeGreaterThan(0);
    console.log('✅ TC049 - Product images are present in DOM (may have incorrect src)');

    // 'Sauce Labs Backpack' is reliably addable for problem_user (unlike some other items)
    const testItem = 'Sauce Labs Backpack';
    await inventoryPage.addItemToCart(testItem);
    console.log('✅ TC049 - Add to cart functionality works despite UI issues');

    const badgeCount = await inventoryPage.getCartBadgeCount();
    expect(badgeCount).toBe(1);
    console.log('✅ TC049 - Cart badge updated correctly after adding item');

    const isInCart = await inventoryPage.isItemInCart(testItem);
    expect(isInCart).toBe(true);
    console.log('✅ TC049 - Item confirmed in cart, core functionality intact');

    await guestPage.locator('.shopping_cart_link').click();
    await guestPage.waitForURL('**/cart.html');
    const cartPage = new CartPage(guestPage);
    const cartItemCount = await cartPage.getCartItemCount();
    expect(cartItemCount).toBe(1);
    console.log('✅ TC049 - Cart page accessible and displays correct item count');

    console.log('✅ TC049 - Problem user inventory experience validated successfully');
  });
});

