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
import { CartPage } from '../../pages/CartPage';
import { CheckoutPage } from '../../pages/CheckoutPage';

test.describe('Checkout Form Validation Journey', () => {
  test('TC072 - Checkout form validation journey - invalid/missing data in multi-step checkout flow', async ({ standardUser }) => {
    const inventoryPage = new InventoryPage(standardUser);
    // standardUser fixture already ensures inventory is fully loaded

    // Add items to cart
    await inventoryPage.addItemToCart('Sauce Labs Backpack');
    await inventoryPage.addItemToCart('Sauce Labs Bike Light');
    const cartCount = await inventoryPage.getCartBadgeCount();
    expect(cartCount).toBe(2);
    console.log('✅ TC072 - Added 2 items to cart successfully');

    // Navigate to cart
    await standardUser.click('.shopping_cart_link');
    await standardUser.waitForURL('**/cart.html');
    const cartPage = new CartPage(standardUser);
    const itemCount = await cartPage.getCartItemCount();
    expect(itemCount).toBe(2);
    console.log('✅ TC072 - Verified cart contains 2 items');

    // Proceed to checkout
    await cartPage.proceedToCheckout();
    const checkoutPage = new CheckoutPage(standardUser);

    // For validation-error cases use continueButton.click() directly — checkoutPage.continue()
    // internally awaits waitForURL('**/checkout-step-two.html') which would timeout if
    // validation keeps the user on step-one.

    // Test 1: Submit empty form
    await checkoutPage.continueButton.click();
    const errorVisible = await checkoutPage.isErrorVisible();
    expect(errorVisible).toBe(true);
    const errorMessage = await checkoutPage.getErrorMessage();
    expect(errorMessage).toContain('First Name is required');
    console.log('✅ TC072 - Empty form validation error displayed correctly');

    // Test 2: Submit with only first name
    await checkoutPage.fillCheckoutInfo('John', '', '');
    await checkoutPage.continueButton.click();
    expect(await checkoutPage.isErrorVisible()).toBe(true);
    const lastNameError = await checkoutPage.getErrorMessage();
    expect(lastNameError).toContain('Last Name is required');
    console.log('✅ TC072 - Missing last name validation error displayed');

    // Test 3: Submit with first and last name only
    await checkoutPage.fillCheckoutInfo('John', 'Doe', '');
    await checkoutPage.continueButton.click();
    expect(await checkoutPage.isErrorVisible()).toBe(true);
    const postalCodeError = await checkoutPage.getErrorMessage();
    expect(postalCodeError).toContain('Postal Code is required');
    console.log('✅ TC072 - Missing postal code validation error displayed');

    // Test 4: Try special characters in name fields
    await checkoutPage.fillCheckoutInfo('John<script>', 'Doe"DROP', '12345');
    await checkoutPage.continue();
    const url = standardUser.url();
    expect(url).toContain('checkout-step-two');
    console.log('✅ TC072 - Special characters in name fields handled, form accepted');

    // Navigate back — SauceDemo re-renders the form blank on back navigation (React state reset)
    await standardUser.goBack();
    await standardUser.waitForURL('**/checkout-step-one.html');
    console.log('✅ TC072 - Navigated back to checkout step one successfully');

    // Test 5: Try SQL injection attempt
    await checkoutPage.fillCheckoutInfo("' OR '1'='1", "'; DROP TABLE users--", "' UNION SELECT 1--");
    await checkoutPage.continue();
    const sqlUrl = standardUser.url();
    expect(sqlUrl).toContain('checkout-step-two');
    console.log('✅ TC072 - SQL injection attempt handled, checkout form accepted input');
  });
});
