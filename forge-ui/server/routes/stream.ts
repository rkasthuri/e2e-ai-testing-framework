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

// Legacy compatibility stub: mounted but always 501. The canonical Product
// lifecycle uses project-scoped status reads; no supported SSE contract exists.
const router = Router()
router.get('/:runId/stream', notImplemented)
export default router
