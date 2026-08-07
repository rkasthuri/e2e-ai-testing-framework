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

import { startServer } from './index'

startServer().catch(error => {
  console.error('[FORGE UI] Control plane failed to start:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
