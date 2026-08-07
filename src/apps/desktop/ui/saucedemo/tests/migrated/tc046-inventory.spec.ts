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
import { InventoryPage } from '../../pages/InventoryPage';
import { ProductDetailPage } from '../../pages/ProductDetailPage';

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
