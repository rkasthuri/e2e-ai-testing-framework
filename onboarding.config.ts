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

import { OnboardingConfig } from './src/core/onboarding/types'

const config: OnboardingConfig = {
  app: {
    name:    process.env.APP_NAME || 'saucedemo',
    baseUrl: process.env.BASE_URL || 'https://www.saucedemo.com',
    appType: 'mpa',
  },
  roles: [
    {
      id:                'standardUser',
      displayName:       'Standard User',
      authFlow:          'form-login',
      credentialsEnvKey: 'STANDARD_USER_CREDENTIALS',
    },
    {
      id:                'lockedUser',
      displayName:       'Locked Out User',
      authFlow:          'form-login',
      credentialsEnvKey: 'LOCKED_USER_CREDENTIALS',
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
  budgets: {
    maxPages: Number(process.env.ONBOARD_MAX_PAGES) || 50,
    maxDepth: Number(process.env.ONBOARD_MAX_DEPTH) || 5,
    aiCalls:  Number(process.env.ONBOARD_AI_BUDGET)  || 50,
  },
}

export default config
