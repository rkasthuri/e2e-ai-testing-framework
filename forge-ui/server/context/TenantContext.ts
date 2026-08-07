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

import type { Request, Response, NextFunction } from 'express'

/**
 * Server-side tenant middleware stub. Phase 1: single tenant (always 'local').
 * Phase 2: extract tenantId from the verified JWT. Nova-approved stub.
 * (The `Express.Request` augmentation lives in AuthContext.ts.)
 */
export function tenantMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.tenantId = 'local'
  next()
}
