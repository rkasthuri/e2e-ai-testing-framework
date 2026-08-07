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

export const restfulBookerGoals: GoalDefinition[] = [

  // STATE GOAL 1 — Authenticated (token obtained)
  {
    id: 'booker:auth:admin',
    description: 'Admin user is authenticated and token is available',
    type: 'state',
    successCriteria: [{
      description: 'Auth endpoint returns token',
      verifier: 'api-response',
      locator: '/auth',
      expectedValue: 200
    }],
    prerequisites: [],
    actions: [
      { type: 'api-call', target: '/auth',
        payload: { method: 'POST',
                   body: { username: 'admin', password: 'password123' } },
        grounding: 'inferred' }
    ]
  },

  // STATE GOAL 2 — A booking exists to update
  {
    id: 'booker:booking:exists',
    description: 'At least one booking exists in the system',
    type: 'state',
    successCriteria: [{
      description: 'GET /booking returns non-empty array',
      verifier: 'api-response',
      locator: '/booking',
      expectedValue: 200
    }],
    prerequisites: [],   // does not require auth (public endpoint)
    actions: [
      { type: 'api-call', target: '/booking',
        payload: { method: 'GET' }, grounding: 'inferred' }
    ]
  },

  // STATE GOAL 3 — Booking updated successfully
  {
    id: 'booker:booking:updated',
    description: 'An existing booking is updated via PUT /booking/{id}',
    type: 'state',
    successCriteria: [{
      description: 'PUT /booking/1 returns 200',
      verifier: 'api-response',
      locator: '/booking/1',
      expectedValue: 200
    }],
    prerequisites: ['booker:auth:admin', 'booker:booking:exists'],
    actions: [
      { type: 'api-call', target: '/booking/1',
        payload: { method: 'PUT', path: '/booking/1',
                   body: { firstname: 'FORGE', lastname: 'Agent',
                           totalprice: 999, depositpaid: true,
                           bookingdates: { checkin: '2026-01-01',
                                          checkout: '2026-01-07' },
                           additionalneeds: 'Breakfast' } },
        grounding: 'inferred' }
    ]
  },

  // BUSINESS GOAL — auth-and-update
  {
    id: 'booker:business:auth-and-update',
    description: 'Authenticate then update an existing booking',
    type: 'business',
    successCriteria: [{
      description: 'Booking updated successfully',
      verifier: 'api-response',
      locator: '/booking/1',
      expectedValue: 200
    }],
    prerequisites: [
      'booker:auth:admin',
      'booker:booking:exists',
      'booker:booking:updated'
    ],
    actions: []
  }
]

export default restfulBookerGoals
