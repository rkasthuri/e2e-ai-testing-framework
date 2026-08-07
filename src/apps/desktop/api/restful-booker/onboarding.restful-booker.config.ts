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
    name:    'restful-booker',
    baseUrl: 'https://restful-booker.herokuapp.com',
    appType: 'rest-api',
  },
  appType: 'rest-api',
  apiEndpoints: [
    { method: 'POST',   path: '/auth',          summary: 'CreateToken',          auth: false },
    { method: 'GET',    path: '/booking',        summary: 'GetBookingIds',        auth: false },
    { method: 'GET',    path: '/booking/{id}',   summary: 'GetBooking',           auth: false },
    { method: 'POST',   path: '/booking',        summary: 'CreateBooking',        auth: false },
    { method: 'PUT',    path: '/booking/{id}',   summary: 'UpdateBooking',        auth: true  },
    { method: 'PATCH',  path: '/booking/{id}',   summary: 'PartialUpdateBooking', auth: true  },
    { method: 'DELETE', path: '/booking/{id}',   summary: 'DeleteBooking',        auth: true  },
    { method: 'GET',    path: '/ping',           summary: 'HealthCheck',          auth: false },
  ],
  roles: [
    {
      id:                'adminUser',
      displayName:       'Admin User',
      authFlow:          'api-key',
      credentialsEnvKey: 'BOOKER_CREDENTIALS',
    },
    {
      id:          'guestUser',
      displayName: 'Guest',
      authFlow:    'none',
    },
  ],
  flows: [
    {
      id:          'create-booking',
      hint:        'Create a new booking and verify it appears in the booking list',
      startPageId: 'booking',
      roleId:      'guestUser',
    },
    {
      id:          'auth-and-update',
      hint:        'Authenticate then update an existing booking',
      startPageId: 'auth',
      roleId:      'adminUser',
    },
  ],
  budgets: {
    maxPages: 20,
    maxDepth: 3,
    aiCalls:  20,
  },
}

export default config
