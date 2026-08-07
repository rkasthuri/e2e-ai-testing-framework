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

import * as fs from 'fs';
import * as path from 'path';

export interface SpecRegistryEntry {
  path?: string;
  lastTcNum?: number;
  lastEcNum?: number;
  describes: string[];
  pageObjects: string[];
  topic: string;
}

export const SPEC_REGISTRY: Record<string, SpecRegistryEntry> = {
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

export const PAGE_OBJECT_METHODS = `
IMPORTS (always use these patterns):
  import { test, expect } from '../fixtures/fixtures';
  import { Users } from '../data/users';
  // Users: Users.standard() | Users.locked() | Users.problem() | Users.glitch() | Users.error() | Users.visual()

LoginPage:
  - goto()                                    - navigate to login page
  - login(credentials: UserCredentials)       - fill and submit login form
  - loginAndWait(credentials: UserCredentials)- login + wait for inventory page
  - attemptLogin(credentials)                 - login without waiting (for error scenarios)
  - usernameField / passwordField / loginButton
  - errorMessage
  - getErrorMessageText()
  - isErrorVisible()
  - getErrorMessage()

InventoryPage:
  - pageTitle / shoppingCartLink / menuButton
  - addToCartButtons / inventoryItems
  - isLoaded()                                - returns boolean, use instead of waitForLoad()
  - getProductCount()                         - was getInventoryItemCount()
  - getProductNames()
  - getProductPrices()
  - addItemToCart(itemName: string)           - filter-based, pass item name as string
  - addFirstItemToCart()
  - removeItemFromCart(itemName: string)
  - sortBy(option: 'az' | 'za' | 'lohi' | 'hilo')
  - getCurrentSortOption()
  - getCartBadgeCount()
  - isItemInCart(itemName: string)

CartPage:
  - pageTitle / cartItems / removeButtons
  - continueShoppingButton / checkoutButton
  - getCartItemCount()                        - returns number
  - getCartBadgeCount()
  - getItemNames()
  - getItemPrices()
  - isCartEmpty()
  - isItemInCart(itemName: string)
  - removeItem(itemName: string)
  - removeFirstItem()
  - removeAllItems()
  - continueShopping()
  - proceedToCheckout()                       - navigates to checkout step 1

CheckoutPage:
  - fillCheckoutInfo(first, last, zip)
  - continue()
  - cancel()
  - isErrorVisible()
  - getErrorMessage()

CheckoutOverviewPage:
  - pageTitle
  - getItemCount()
  - getSubtotal()                             - was getItemTotal()
  - getTax()
  - getTotal()
  - verifyTotalIsCorrect()
  - finish()
  - cancel()

CheckoutCompletePage:
  - isOrderComplete()
  - getCompleteHeader()
  - getCompleteText()
  - backToHome()                              - was backToProducts()
`;

export function getSpecSummary(): string {
  return Object.entries(SPEC_REGISTRY)
    .map(([file, info]) => `${file}: ${info.topic}`)
    .join('\n');
}

export function getLastTcNum(testsDir = path.join('src', 'tests')): number {
  let maxNum = 0;
  try {
    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
      const matches = content.match(/test\([`'"]TC(\d+)/g) ?? [];
      for (const match of matches) {
        const num = parseInt(match.replace(/test\([`'"]TC/, ''), 10);
        if (num > maxNum) maxNum = num;
      }
    }
  } catch {
    return 0;
  }
  return maxNum;
}

export function getLastEcNum(edgeCasesPath = path.join('src', 'tests', 'edgeCases.spec.ts')): number {
  let maxNum = 0;
  try {
    const content = fs.readFileSync(edgeCasesPath, 'utf-8');
    const matches = content.match(/test\([`'"]EC(\d+)/g) ?? [];
    for (const match of matches) {
      const num = parseInt(match.replace(/test\([`'"]EC/, ''), 10);
      if (num > maxNum) maxNum = num;
    }
  } catch {
    return 0;
  }
  return maxNum;
}
