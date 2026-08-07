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

import { runMigrations, closeDb } from '../src/core/storage'
import { PurgeJob }               from '../src/core/storage/PurgeJob'

async function main() {
  await runMigrations()
  const job = new PurgeJob()
  await job.run()
  await closeDb()
}

main().catch(e => { console.error('[purge] Failed:', e); process.exit(1) })
