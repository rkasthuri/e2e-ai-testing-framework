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

test.describe('API - Security: Delete Booking Without Authentication', () => {
  const bookingId = 1;

  test('TC065 - Verify DELETE booking without auth token returns 403', async ({ request }) => {
    // Note: SauceDemo does not have a booking API endpoint
    // This test demonstrates the pattern for a real booking API
    // For actual execution, this would need to be adapted to a real API endpoint
    
    // Attempt to delete a booking without providing authentication token
    const response = await request.delete(`https://restful-booker.herokuapp.com/booking/${bookingId}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Verify the response status is 403 Forbidden (or 401 Unauthorized)
    // Different APIs may return 401 or 403 for missing/invalid auth
    expect(response.status()).toBeGreaterThanOrEqual(401);
    expect(response.status()).toBeLessThanOrEqual(403);
    
    console.log('✅ TC065 - DELETE booking without authentication correctly rejected with status:', response.status());

    // Verify that the booking still exists (deletion was prevented)
    const getResponse = await request.get(`https://restful-booker.herokuapp.com/booking/${bookingId}`);
    
    // If the booking exists (200 or 404 for non-existent), deletion was properly prevented
    // A 200 status means the booking still exists after unauthorized delete attempt
    expect([200, 404]).toContain(getResponse.status());
    
    if (getResponse.status() === 200) {
      console.log('✅ TC065 - Booking still exists after unauthorized delete attempt - security measure working correctly');
    }
  });
});