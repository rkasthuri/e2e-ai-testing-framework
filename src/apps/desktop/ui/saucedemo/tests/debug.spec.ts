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

import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';

test.describe('Debug Tests', () => {
  
  test('Debug - Performance glitch user', async ({ page }) => {
    test.setTimeout(60000);
    
    console.log('🔍 Starting debug test for performance_glitch_user...');
    
    const loginPage = new LoginPage(page);
    const inventoryPage = new InventoryPage(page);

    console.log('Step 1: Navigate to login page');
    await loginPage.goto();
    await page.screenshot({ path: 'reports/screenshots/debug-1-login.png' });
    
    console.log('Step 2: Fill credentials');
    await loginPage.login('performance_glitch_user', 'secret_sauce');
    await page.screenshot({ path: 'reports/screenshots/debug-2-filled.png' });
    
    console.log('Step 3: Wait for navigation (max 30s)...');
    const startTime = Date.now();
    
    try {
      await page.waitForURL('**/inventory.html', { timeout: 30000 });
      const duration = Date.now() - startTime;
      console.log(`✅ SUCCESS - Took ${duration}ms`);
      
      await page.screenshot({ path: 'reports/screenshots/debug-3-success.png' });
      
      const title = await inventoryPage.pageTitle.textContent();
      console.log(`Page title: "${title}"`);
      
      await expect(inventoryPage.pageTitle).toContainText('Products');
      
    } catch (error) {
      console.error(`❌ FAILED after ${Date.now() - startTime}ms`);
      console.log('Current URL:', page.url());
      
      await page.screenshot({ path: 'reports/screenshots/debug-error.png' });
      
      const hasError = await loginPage.errorMessage.isVisible().catch(() => false);
      if (hasError) {
        const errorText = await loginPage.getErrorMessageText();
        console.log(`Error message: "${errorText}"`);
      }
      
      throw error;
    }
  });
});
