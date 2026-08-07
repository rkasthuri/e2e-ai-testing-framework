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

import { GoalDefinition } from '../../../../core/agent/AgentPlanner'

export const saucedemoGoals: GoalDefinition[] = [

  // STATE GOAL 1 — User is authenticated as standardUser
  {
    id: 'saucedemo:auth:standardUser',
    description: 'User is authenticated as standardUser and on inventory page',
    type: 'state',
    successCriteria: [{
      description: 'Inventory page is displayed',
      verifier: 'page-url',
      expectedValue: '**/inventory.html'
    }],
    prerequisites: [],   // no prereqs — first goal
    actions: [
      { type: 'navigate', target: 'https://www.saucedemo.com', grounding: 'inferred' },
      { type: 'fill', target: 'input[data-test="username"]',
        payload: 'standard_user', grounding: 'inferred' },
      { type: 'fill', target: 'input[data-test="password"]',
        payload: 'secret_sauce', grounding: 'inferred' },
      { type: 'click', target: 'input[data-test="login-button"]', grounding: 'inferred' },
    ]
  },

  // STATE GOAL 2 — Cart contains at least one item
  {
    id: 'saucedemo:cart:not-empty',
    description: 'Shopping cart contains at least one item',
    type: 'state',
    successCriteria: [{
      description: 'Cart badge shows item count',
      verifier: 'dom-assertion',
      locator: '[data-test="shopping-cart-badge"]'
    }],
    prerequisites: ['saucedemo:auth:standardUser'],
    actions: [
      { type: 'click',
        target: '[data-test="add-to-cart-sauce-labs-backpack"]', grounding: 'inferred' },
    ]
  },

  // STATE GOAL 3 — Checkout page is displayed
  {
    id: 'saucedemo:checkout:ready',
    description: 'Checkout page is displayed with order summary',
    type: 'state',
    successCriteria: [{
      description: 'Checkout overview page reached',
      verifier: 'page-url',
      expectedValue: '**/checkout-step-one.html'
    }],
    prerequisites: ['saucedemo:cart:not-empty'],
    actions: [
      { type: 'click', target: '[data-test="shopping-cart-link"]', grounding: 'inferred' },
      { type: 'click', target: '[data-test="checkout"]', grounding: 'inferred' },
    ]
  },

  // BUSINESS GOAL — checkout-happy-path (orchestrates the above)
  {
    id: 'saucedemo:business:checkout-happy-path',
    description: 'Complete the checkout happy path from login to checkout page',
    type: 'business',
    successCriteria: [{
      description: 'Checkout page reached',
      verifier: 'page-url',
      expectedValue: '**/checkout-step-one.html'
    }],
    prerequisites: [
      'saucedemo:auth:standardUser',
      'saucedemo:cart:not-empty',
      'saucedemo:checkout:ready'
    ],
    actions: []   // business goal — orchestrates state goals, no direct actions
  }
]

export default saucedemoGoals
