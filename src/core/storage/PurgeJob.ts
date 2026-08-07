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

import { PurgeRepository } from './repositories/PurgeRepository'
import { ConfigService }   from './ConfigService'

export class PurgeJob {

  private purgeRepo = new PurgeRepository()

  async run(): Promise<void> {
    const retentionDays = await ConfigService.getRetentionDays()
    console.log(`[PurgeJob] Running — retention policy: ${retentionDays} days`)

    const purgedCount = await this.purgeRepo.purgeExpiredSnapshots()

    if (purgedCount > 0) {
      console.log(`[PurgeJob] Purged ${purgedCount} expired DOM snapshots`)
    } else {
      console.log('[PurgeJob] No expired snapshots found')
    }

    const stats = await this.purgeRepo.getPurgeStats()
    console.log(
      `[PurgeJob] Stats — total: ${stats.totalSnapshots}, ` +
      `purged: ${stats.purgedSnapshots}, ` +
      `pending: ${stats.pendingSnapshots}, ` +
      `next purge date: ${stats.nextPurgeDate}`
    )
  }

  async runIfDue(): Promise<void> {
    const stats = await this.purgeRepo.getPurgeStats()
    const today = new Date().toISOString().slice(0, 10)
    if (stats.nextPurgeDate <= today) {
      await this.run()
    } else {
      console.log(`[PurgeJob] Not due until ${stats.nextPurgeDate} — skipping`)
    }
  }
}
