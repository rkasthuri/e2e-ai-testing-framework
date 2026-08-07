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

/**
 * api.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.3 – API Testing Integration
 * FORGE — Autonomous Quality Engineering
 *
 * Target:  https://restful-booker.herokuapp.com
 * Pattern: Page Object Model (BookingApiClient)
 * IDs:     AB001 – AB012
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect, APIRequestContext } from '@playwright/test';
import { BookingApiClient, Booking }       from '../pages/BookingApiClient';

// ── Shared state ──────────────────────────────────────────────────────────────

let api:           BookingApiClient;
let createdBookingId: number;

// ── Hooks ─────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ playwright }) => {
  const context: APIRequestContext = await playwright.request.newContext({
    baseURL: 'https://restful-booker.herokuapp.com',
  });
  api = new BookingApiClient(context);
});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1 — Health & Auth
// ═════════════════════════════════════════════════════════════════════════════

test.describe('API - Health & Authentication', () => {

  test('AB001 - Health check returns 201', async () => {
    console.log('🏥 AB001 - Health check');
    const response = await api.ping();
    expect(response.status()).toBe(201);
    console.log('✅ AB001 - API is healthy');
  });

  test('AB002 - Auth token generated with valid credentials', async () => {
    console.log('🔐 AB002 - Authenticate with valid credentials');
    const response = await api.createToken('admin', 'password123');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    console.log('✅ AB002 - Token generated successfully');
  });

  test('AB003 - Auth fails with invalid credentials', async () => {
    console.log('🔐 AB003 - Authenticate with invalid credentials');
    const response = await api.createToken('wronguser', 'wrongpass');
    expect(response.status()).toBe(200); // API returns 200 but with reason field

    const body = await response.json();
    expect(body).toHaveProperty('reason');
    expect(body.reason).toBe('Bad credentials');

    console.log('✅ AB003 - Invalid credentials correctly rejected');
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2 — Read Operations
// ═════════════════════════════════════════════════════════════════════════════

test.describe('API - Read Operations', () => {

  test('AB004 - Get all bookings returns array', async () => {
    console.log('📋 AB004 - Get all bookings');
    const response = await api.getAllBookings();
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('bookingid');

    console.log(`✅ AB004 - Found ${body.length} bookings`);
  });

  test('AB005 - Get booking by ID returns correct structure', async () => {
    console.log('🔍 AB005 - Get booking by ID');

    // First get a valid ID
    const listResponse = await api.getAllBookings();
    const bookings     = await listResponse.json();
    const bookingId    = bookings[0].bookingid;

    const response = await api.getBookingById(bookingId);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('firstname');
    expect(body).toHaveProperty('lastname');
    expect(body).toHaveProperty('totalprice');
    expect(body).toHaveProperty('depositpaid');
    expect(body).toHaveProperty('bookingdates');
    expect(body.bookingdates).toHaveProperty('checkin');
    expect(body.bookingdates).toHaveProperty('checkout');

    console.log(`✅ AB005 - Booking ${bookingId}: ${body.firstname} ${body.lastname}`);
  });

  test('AB006 - Get bookings filtered by firstname', async () => {
    console.log('🔍 AB006 - Filter bookings by firstname');

    // Create a booking with a unique name first
    await api.authenticate();
    const testBooking = BookingApiClient.makeBooking({ firstname: 'UniqueFilterTest' });
    const createResp  = await api.createBooking(testBooking);
    const created     = await createResp.json();

    // Filter by that firstname
    const response = await api.getAllBookings({ firstname: 'UniqueFilterTest' });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    body.forEach((entry: { bookingid: number }) => {
      expect(entry).toHaveProperty('bookingid');
    });

    console.log(`✅ AB006 - Filter returned ${body.length} result(s) for firstname=UniqueFilterTest`);
  });

  test('AB007 - Get non-existent booking returns 404', async () => {
    console.log('🔍 AB007 - Get booking with invalid ID');
    const response = await api.getBookingById(999999);
    expect(response.status()).toBe(404);
    console.log('✅ AB007 - Non-existent booking correctly returns 404');
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3 — Write Operations
// ═════════════════════════════════════════════════════════════════════════════

test.describe('API - Write Operations', () => {

  test('AB008 - Create booking returns correct data', async () => {
    console.log('➕ AB008 - Create new booking');

    const newBooking = BookingApiClient.makeBooking();
    const response   = await api.createBooking(newBooking);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('bookingid');
    expect(body).toHaveProperty('booking');
    expect(body.booking.firstname).toBe(newBooking.firstname);
    expect(body.booking.lastname).toBe(newBooking.lastname);
    expect(body.booking.totalprice).toBe(newBooking.totalprice);
    expect(body.booking.depositpaid).toBe(newBooking.depositpaid);
    expect(body.booking.bookingdates.checkin).toBe(newBooking.bookingdates.checkin);
    expect(body.booking.bookingdates.checkout).toBe(newBooking.bookingdates.checkout);

    // Save for subsequent tests
    createdBookingId = body.bookingid;

    console.log(`✅ AB008 - Booking created with ID: ${createdBookingId}`);
  });

  test('AB009 - Full update booking with PUT', async () => {
    console.log('✏️  AB009 - Full update booking (PUT)');

    // Ensure we have a token and a booking ID
    await api.authenticate();
    if (!createdBookingId) {
      const createResp     = await api.createBooking(BookingApiClient.makeBooking());
      const created        = await createResp.json();
      createdBookingId     = created.bookingid;
    }

    const updatedBooking: Booking = BookingApiClient.makeBooking({
      firstname:       'Updated',
      lastname:        'Booking',
      totalprice:      999,
      depositpaid:     false,
      additionalneeds: 'Late checkout',
    });

    const response = await api.updateBooking(createdBookingId, updatedBooking);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.firstname).toBe('Updated');
    expect(body.lastname).toBe('Booking');
    expect(body.totalprice).toBe(999);
    expect(body.depositpaid).toBe(false);

    console.log(`✅ AB009 - Booking ${createdBookingId} fully updated`);
  });

  test('AB010 - Partial update booking with PATCH', async () => {
    console.log('✏️  AB010 - Partial update booking (PATCH)');

    await api.authenticate();
    if (!createdBookingId) {
      const createResp = await api.createBooking(BookingApiClient.makeBooking());
      const created    = await createResp.json();
      createdBookingId = created.bookingid;
    }

    const response = await api.partialUpdateBooking(createdBookingId, {
      firstname: 'PatchedName',
      totalprice: 500,
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.firstname).toBe('PatchedName');
    expect(body.totalprice).toBe(500);

    console.log(`✅ AB010 - Booking ${createdBookingId} partially updated`);
  });

  test('AB011 - Delete booking', async () => {
    console.log('🗑️  AB011 - Delete booking');

    await api.authenticate();

    // Create a fresh booking to delete
    const createResp  = await api.createBooking(BookingApiClient.makeBooking({
      firstname: 'ToDelete',
      lastname:  'Booking',
    }));
    const created     = await createResp.json();
    const deleteId    = created.bookingid;

    const deleteResp  = await api.deleteBooking(deleteId);
    expect(deleteResp.status()).toBe(201);

    // Verify it's gone
    const getResp = await api.getBookingById(deleteId);
    expect(getResp.status()).toBe(404);

    console.log(`✅ AB011 - Booking ${deleteId} deleted and confirmed gone`);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4 — Security & Negative Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe('API - Security & Negative Tests', () => {

  test('AB012 - Update without auth token returns 403', async () => {
    console.log('🔒 AB012 - Update booking without auth token');

    // Get any valid booking ID
    const listResp = await api.getAllBookings();
    const bookings = await listResp.json();
    const targetId = bookings[0].bookingid;

    const response = await api.updateBookingNoAuth(
      targetId,
      BookingApiClient.makeBooking({ firstname: 'Hacker' }),
    );
    expect(response.status()).toBe(403);

    console.log('✅ AB012 - Unauthorised update correctly blocked with 403');
  });

});

