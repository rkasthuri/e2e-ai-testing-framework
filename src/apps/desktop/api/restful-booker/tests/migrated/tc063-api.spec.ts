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

test.describe('API - Booking Creation Validation', () => {
  const API_BASE_URL = 'https://restful-booker.herokuapp.com';

  test('TC063 - Create booking with missing required fields', async ({ request }) => {
    // Test missing firstname
    const missingFirstname = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        lastname: 'Brown',
        totalprice: 111,
        depositpaid: true,
        bookingdates: {
          checkin: '2024-01-01',
          checkout: '2024-01-02'
        }
      }
    });
    expect(missingFirstname.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Missing firstname rejected with status:', missingFirstname.status());

    // Test missing lastname
    const missingLastname = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        firstname: 'Jim',
        totalprice: 111,
        depositpaid: true,
        bookingdates: {
          checkin: '2024-01-01',
          checkout: '2024-01-02'
        }
      }
    });
    expect(missingLastname.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Missing lastname rejected with status:', missingLastname.status());

    // Test missing totalprice
    const missingTotalprice = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        firstname: 'Jim',
        lastname: 'Brown',
        depositpaid: true,
        bookingdates: {
          checkin: '2024-01-01',
          checkout: '2024-01-02'
        }
      }
    });
    expect(missingTotalprice.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Missing totalprice rejected with status:', missingTotalprice.status());

    // Test missing depositpaid
    const missingDepositpaid = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        firstname: 'Jim',
        lastname: 'Brown',
        totalprice: 111,
        bookingdates: {
          checkin: '2024-01-01',
          checkout: '2024-01-02'
        }
      }
    });
    expect(missingDepositpaid.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Missing depositpaid rejected with status:', missingDepositpaid.status());

    // Test missing bookingdates
    const missingDates = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        firstname: 'Jim',
        lastname: 'Brown',
        totalprice: 111,
        depositpaid: true
      }
    });
    expect(missingDates.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Missing bookingdates rejected with status:', missingDates.status());

    // Test completely empty payload
    const emptyPayload = await request.post(`${API_BASE_URL}/booking`, {
      data: {}
    });
    expect(emptyPayload.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Empty payload rejected with status:', emptyPayload.status());

    // Test null values
    const nullValues = await request.post(`${API_BASE_URL}/booking`, {
      data: {
        firstname: null,
        lastname: null,
        totalprice: null,
        depositpaid: null,
        bookingdates: null
      }
    });
    expect(nullValues.status()).toBeGreaterThanOrEqual(400);
    console.log('✅ TC063 - Null values rejected with status:', nullValues.status());

    console.log('✅ TC063 - All missing required field validations passed successfully');
  });
});