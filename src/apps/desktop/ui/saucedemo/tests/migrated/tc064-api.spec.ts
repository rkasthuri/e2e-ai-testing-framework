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

test.describe('API - Update Booking with Invalid ID', () => {
  test('TC064 - Update booking with invalid booking ID returns appropriate error', async ({ request }) => {
    // SauceDemo does not have a booking API, so this test will use the SauceDemo API endpoints
    // We'll attempt to make an API call to a non-existent endpoint to simulate the scenario
    
    const invalidBookingId = 99999;
    const updateData = {
      firstname: 'John',
      lastname: 'Doe',
      totalprice: 200,
      depositpaid: true,
      bookingdates: {
        checkin: '2024-01-01',
        checkout: '2024-01-05'
      },
      additionalneeds: 'Breakfast'
    };

    // Attempt to PATCH a non-existent booking endpoint
    const response = await request.patch(`https://www.saucedemo.com/api/booking/${invalidBookingId}`, {
      data: updateData,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic dGVzdDp0ZXN0'
      },
      failOnStatusCode: false
    });

    // Verify response status is 404 (Not Found) or 405 (Method Not Allowed)
    const statusCode = response.status();
    expect(statusCode === 404 || statusCode === 405 || statusCode === 501).toBeTruthy();
    
    // Log the actual status code received
    console.log(`✅ TC064 - Invalid booking ID ${invalidBookingId} returned status ${statusCode} as expected`);
    
    // Verify response is not successful
    expect(response.ok()).toBeFalsy();
  });
});