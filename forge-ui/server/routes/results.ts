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

import { Router } from 'express'
import { notImplemented } from '../http'

// Legacy compatibility stub: mounted but always 501. Canonical Product Results
// transport is project-scoped under /api/v1/projects/:appName/executions.
const router = Router()
router.use(notImplemented)
export default router
