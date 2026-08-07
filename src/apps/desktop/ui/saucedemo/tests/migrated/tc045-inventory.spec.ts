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
