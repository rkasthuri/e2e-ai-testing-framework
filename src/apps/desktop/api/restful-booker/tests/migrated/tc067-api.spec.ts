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

test.describe('API - Booking Creation with Boundary Values', () => {
  const apiUrl = 'https://restful-booker.herokuapp.com';

  test('TC067 - Create booking with boundary values (negative price, past dates, special characters in names)', async ({ request }) => {
    const bookingData = {
      firstname: "O'Malley<script>alert('xss')</script>",
      lastname: "Test\"User\"'DROP TABLE bookings;--",
      totalprice: -100,
      depositpaid: true,
      bookingdates: {
        checkin: "1900-01-01",
        checkout: "1899-12-31"
      },
      additionalneeds: "<script>alert('xss')</script>&lt;img src=x onerror=alert(1)&gt;"
    };

    const response = await request.post(`${apiUrl}/booking`, {
      data: bookingData,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const responseBody = await response.json();
    const status = response.status();

    if (status === 200 || status === 201) {
      expect(responseBody).toHaveProperty('bookingid');
      expect(typeof responseBody.bookingid).toBe('number');
      expect(responseBody.bookingid).toBeGreaterThan(0);
      
      expect(responseBody.booking).toBeDefined();
      expect(responseBody.booking.firstname).toBe(bookingData.firstname);
      expect(responseBody.booking.lastname).toBe(bookingData.lastname);
      expect(responseBody.booking.totalprice).toBe(bookingData.totalprice);
      expect(responseBody.booking.bookingdates.checkin).toBe(bookingData.bookingdates.checkin);
      expect(responseBody.booking.bookingdates.checkout).toBe(bookingData.bookingdates.checkout);
      expect(responseBody.booking.additionalneeds).toBe(bookingData.additionalneeds);
      
      console.log('✅ TC067 - API accepted boundary values: negative price (-100), past dates (1900/1899), and special characters in names without validation errors');
    } else if (status === 400 || status === 422) {
      expect(responseBody).toHaveProperty('error');
      console.log('✅ TC067 - API correctly rejected boundary values with validation error:', responseBody.error);
    } else {
      throw new Error(`Unexpected status code ${status}: ${JSON.stringify(responseBody)}`);
    }
  });
});