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
 * Server-side auth middleware stub. Phase 1: pass-through (always local/owner).
 * Phase 2: JWT verification. Nova-approved cloud-readiness stub.
 */

// Phase-1 request augmentation — Phase 2 populates these from a verified JWT.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: 'owner' | 'admin' | 'viewer'; tenantId: string }
      tenantId?: string
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.user = { id: 'local', role: 'owner', tenantId: 'local' }
  next()
}
