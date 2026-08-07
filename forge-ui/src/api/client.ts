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

import type { Envelope } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Typed fetch wrapper. Unwraps the server envelope (returns `data`); throws
 * with the envelope's `error` message on non-2xx. Vite proxies /api to the
 * Express control-plane (:3000).
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('FORGE backend is unavailable. Start the control plane and try again.', 0, 'BACKEND_UNAVAILABLE')
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | { error?: string } | null
  if (!res.ok) {
    if (!json && res.status >= 500) {
      throw new ApiError('FORGE backend is unavailable or returned an unreadable error. Start the control plane and try again.', res.status, 'BACKEND_UNAVAILABLE')
    }
    throw new ApiError(
      (json as { error?: string })?.error ?? `HTTP ${res.status}`,
      res.status,
      (json as { code?: string })?.code ?? null,
    )
  }
  return (json as Envelope<T>).data
}

export const apiClient = {
  get:  <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put:  <T>(path: string, body: unknown) => request<T>('PUT', path, body),
}
