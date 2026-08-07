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

test.describe('API - Booking Date Filter Tests', () => {
  const BASE_URL = 'https://restful-booker.herokuapp.com';

  test('TC066 - Filter bookings by checkin and checkout date parameters', async ({ request }) => {
    const checkinDate = '2024-01-01';
    const checkoutDate = '2024-01-05';

    const response = await request.get(`${BASE_URL}/booking`, {
      params: {
        checkin: checkinDate,
        checkout: checkoutDate
      }
    });

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const bookings = await response.json();
    expect(Array.isArray(bookings)).toBeTruthy();

    if (bookings.length > 0) {
      const firstBookingId = bookings[0].bookingid;
      const detailResponse = await request.get(`${BASE_URL}/booking/${firstBookingId}`);
      expect(detailResponse.ok()).toBeTruthy();

      const bookingDetails = await detailResponse.json();
      expect(bookingDetails.bookingdates).toBeDefined();
      expect(bookingDetails.bookingdates.checkin).toBeDefined();
      expect(bookingDetails.bookingdates.checkout).toBeDefined();

      const bookingCheckin = new Date(bookingDetails.bookingdates.checkin);
      const bookingCheckout = new Date(bookingDetails.bookingdates.checkout);
      const filterCheckin = new Date(checkinDate);
      const filterCheckout = new Date(checkoutDate);

      expect(bookingCheckin.getTime()).toBeGreaterThanOrEqual(filterCheckin.getTime());
      expect(bookingCheckout.getTime()).toBeLessThanOrEqual(filterCheckout.getTime());

      console.log('✅ TC066 - Successfully filtered bookings by checkin and checkout dates, verified date ranges match filter parameters');
    } else {
      console.log('✅ TC066 - Date filter returned empty result set (no bookings match the specified date range)');
    }
  });
});