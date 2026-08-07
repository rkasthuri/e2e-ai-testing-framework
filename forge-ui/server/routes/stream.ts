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

// TD-UI-004: /api/v1/runs/:runId/stream (SSE). Events run:started /
// test:completed / run:completed / run:interrupted are defined in API.md;
// their source (DB-poll of test_results by run_id) lands in TD-UI-004.
const router = Router()
router.get('/:runId/stream', notImplemented)
export default router
