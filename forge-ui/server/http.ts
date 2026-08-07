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

import type { Request, Response } from 'express'

/** Success envelope (API.md convention): { data, error: null, timestamp }. */
export function ok<T>(data: T) {
  return { data, error: null, timestamp: new Date().toISOString() }
}

/** Error envelope: { error, code, timestamp }. */
export function fail(error: string, code: string) {
  return { error, code, timestamp: new Date().toISOString() }
}

/**
 * Foundation stub handler — every route is 501 until its tab brief
 * (TD-UI-001…007) fills it. Routes stay thin; business logic goes through
 * ExecutionContext, never inline here.
 */
export function notImplemented(_req: Request, res: Response): void {
  res.status(501).json(fail('Not implemented — filled by its tab brief', 'NOT_IMPLEMENTED'))
}
