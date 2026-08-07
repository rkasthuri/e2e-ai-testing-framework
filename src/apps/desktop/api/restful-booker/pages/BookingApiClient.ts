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
 * BookingApiClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.3 – API Testing Integration
 * FORGE — Autonomous Quality Engineering
 *
 * Page Object pattern applied to API layer.
 * Wraps Playwright's APIRequestContext for Restful Booker endpoints.
 * Target: https://restful-booker.herokuapp.com
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { APIRequestContext, APIResponse } from '@playwright/test';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookingDates {
  checkin:  string;   // YYYY-MM-DD
  checkout: string;   // YYYY-MM-DD
}

export interface Booking {
  firstname:       string;
  lastname:        string;
  totalprice:      number;
  depositpaid:     boolean;
  bookingdates:    BookingDates;
  additionalneeds?: string;
}

export interface BookingResponse extends Booking {
  bookingid?: number;
}

export interface CreateBookingResponse {
  bookingid: number;
  booking:   Booking;
}

export interface AuthResponse {
  token?: string;
  reason?: string;
}

export interface BookingIdEntry {
  bookingid: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class BookingApiClient {
  private readonly baseURL = 'https://restful-booker.herokuapp.com';
  private token: string | null = null;

  constructor(private readonly request: APIRequestContext) {}

  // ── Auth ───────────────────────────────────────────────────────────────────

  async createToken(
    username = 'admin',
    password = 'password123',
  ): Promise<APIResponse> {
    return this.request.post(`${this.baseURL}/auth`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { username, password },
    });
  }

  async authenticate(
    username = 'admin',
    password = 'password123',
  ): Promise<string> {
    const response = await this.createToken(username, password);
    const body: AuthResponse = await response.json();
    if (!body.token) throw new Error(`Auth failed: ${body.reason ?? 'unknown'}`);
    this.token = body.token;
    return this.token;
  }

  getToken(): string | null {
    return this.token;
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  async ping(): Promise<APIResponse> {
    return this.request.get(`${this.baseURL}/ping`);
  }

  // ── Bookings ───────────────────────────────────────────────────────────────

  async getAllBookings(filters?: {
    firstname?: string;
    lastname?:  string;
    checkin?:   string;
    checkout?:  string;
  }): Promise<APIResponse> {
    const params = new URLSearchParams();
    if (filters?.firstname) params.append('firstname', filters.firstname);
    if (filters?.lastname)  params.append('lastname',  filters.lastname);
    if (filters?.checkin)   params.append('checkin',   filters.checkin);
    if (filters?.checkout)  params.append('checkout',  filters.checkout);

    const query = params.toString();
    const url   = query
      ? `${this.baseURL}/booking?${query}`
      : `${this.baseURL}/booking`;

    return this.request.get(url, {
      headers: { 'Accept': 'application/json' },
    });
  }

  async getBookingById(id: number): Promise<APIResponse> {
    return this.request.get(`${this.baseURL}/booking/${id}`, {
      headers: { 'Accept': 'application/json' },
    });
  }

  async createBooking(booking: Booking): Promise<APIResponse> {
    return this.request.post(`${this.baseURL}/booking`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
      },
      data: booking,
    });
  }

  async updateBooking(id: number, booking: Booking): Promise<APIResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':        'application/json',
    };
    if (this.token) headers['Cookie'] = `token=${this.token}`;

    return this.request.put(`${this.baseURL}/booking/${id}`, {
      headers,
      data: booking,
    });
  }

  async partialUpdateBooking(
    id:      number,
    partial: Partial<Booking>,
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':        'application/json',
    };
    if (this.token) headers['Cookie'] = `token=${this.token}`;

    return this.request.patch(`${this.baseURL}/booking/${id}`, {
      headers,
      data: partial,
    });
  }

  async deleteBooking(id: number): Promise<APIResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) headers['Cookie'] = `token=${this.token}`;

    return this.request.delete(`${this.baseURL}/booking/${id}`, { headers });
  }

  // ── Unauthorised variants (for negative testing) ───────────────────────────

  async updateBookingNoAuth(id: number, booking: Booking): Promise<APIResponse> {
    return this.request.put(`${this.baseURL}/booking/${id}`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
      },
      data: booking,
    });
  }

  async deleteBookingNoAuth(id: number): Promise<APIResponse> {
    return this.request.delete(`${this.baseURL}/booking/${id}`, {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Test data factory ──────────────────────────────────────────────────────

  static makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
      firstname:       'Raj',
      lastname:        'Kasthuri',
      totalprice:      250,
      depositpaid:     true,
      bookingdates: {
        checkin:  '2026-07-01',
        checkout: '2026-07-05',
      },
      additionalneeds: 'Breakfast',
      ...overrides,
    };
  }
}
