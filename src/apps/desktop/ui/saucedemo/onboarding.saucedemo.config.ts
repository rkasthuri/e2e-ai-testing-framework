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

import { OnboardingConfig } from '../../../../core/onboarding/types'

const config: OnboardingConfig = {
  app: {
    name:    process.env.APP_NAME || 'saucedemo',
    baseUrl: process.env.BASE_URL || 'https://www.saucedemo.com',
    appType: 'web-ui', // ADR-021 (TD-163): 'mpa' retired — appType is the platform discriminator; rendering lives on renderingModel
  },
  roles: [
    {
      id:                'standardUser',
      displayName:       'Standard User',
      authFlow:          'form-login',
      credentialsEnvKey: 'STANDARD_USER_CREDENTIALS',
      successUrl:        '/inventory.html',
    },
    {
      id:                'lockedUser',
      displayName:       'Locked Out User',
      authFlow:          'form-login',
      credentialsEnvKey: 'LOCKED_USER_CREDENTIALS',
      successUrl:        '/inventory.html',
    },
    {
      id:          'guestPage',
      displayName: 'Guest',
      authFlow:    'none',
    },
  ],
  flows: [
    {
      id:          'checkout-happy-path',
      hint:        'Add item to cart, proceed through checkout to completion',
      startPageId: 'inventory',
      roleId:      'standardUser',
    },
  ],
  // cart-html's per-item content only exists after an item has been added —
  // direct navigation alone lands on an empty cart. See TD-013.
  pagePrerequisites: [
    {
      pageId:  'cart-html',
      roleId:  'standardUser',
      steps: [
        { action: 'click', elementId: 'inventory-html:addToCartSauceLabsBackpack' },
      ],
    },
  ],
  budgets: {
    maxPages: Number(process.env.ONBOARD_MAX_PAGES) || 50,
    maxDepth: Number(process.env.ONBOARD_MAX_DEPTH) || 5,
    // TD-132: this fixture's `|| 50` is intentionally independent of the
    // framework DEFAULT_AI_BUDGET — it pins SauceDemo's small-app budget and is
    // env-overridable via ONBOARD_AI_BUDGET. Not a consolidation target.
    aiCalls:  Number(process.env.ONBOARD_AI_BUDGET)  || 50,
  },
  crawlMode: 'auto',
}

export default config
