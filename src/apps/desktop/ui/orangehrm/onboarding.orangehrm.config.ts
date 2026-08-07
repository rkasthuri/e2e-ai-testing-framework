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
    name:    'orangehrm',
    baseUrl: 'https://opensource-demo.orangehrmlive.com',
    appType: 'web-ui',
  },
  appType: 'web-ui',
  crawlMode: 'spa',
  roles: [
    {
      id:                'adminUser',
      displayName:       'Admin',
      authFlow:          'form-login',
      credentialsEnvKey: 'ORANGEHRM_ADMINUSER_CREDENTIALS',
      loginUrl:          'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login',
      selectors: {
        username: 'input[name=username]',
        password: 'input[name=password]',
        submit:   '.orangehrm-login-button',
      },
      successUrl: '/web/index.php/dashboard/index',
    },
  ],
  flows: [
    {
      id:          'admin-login',
      hint:        'Admin logs in and lands on dashboard',
      startPageId: 'auth/login',
      roleId:      'adminUser',
    },
  ],
  budgets: {
    maxPages: 30,
    maxDepth: 3,
    aiCalls:  100,
  },
}

export default config
