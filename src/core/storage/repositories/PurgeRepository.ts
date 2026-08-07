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

import { DomSnapshotRepository } from './DomSnapshotRepository'
import { FrameworkConfigRepository } from './FrameworkConfigRepository'

export interface PurgeRecord {
  purgedAt:      string
  snapshotCount: number
  retentionDays: number
}

export class PurgeRepository {

  private snapRepo   = new DomSnapshotRepository()
  private configRepo = new FrameworkConfigRepository()

  async purgeExpiredSnapshots(): Promise<number> {
    const expired = await this.snapRepo.findExpired()
    if (expired.length === 0) return 0

    const ids = expired.map(s => s.id).filter((id): id is number => id !== undefined)
    await this.snapRepo.markPurged(ids)

    console.log(`[PurgeJob] Purged ${ids.length} expired DOM snapshots`)
    return ids.length
  }

  async getNextPurgeDate(): Promise<string> {
    const retentionDays = await this.configRepo.getRetentionDays()
    const next = new Date()
    next.setDate(next.getDate() + retentionDays)
    return next.toISOString().slice(0, 10)
  }

  async getPurgeStats(): Promise<{
    retentionDays:    number
    totalSnapshots:   number
    purgedSnapshots:  number
    pendingSnapshots: number
    nextPurgeDate:    string
  }> {
    const [retentionDays, stats, nextPurgeDate] = await Promise.all([
      this.configRepo.getRetentionDays(),
      this.snapRepo.getPurgeStats(),
      this.getNextPurgeDate(),
    ])

    return {
      retentionDays,
      totalSnapshots:   stats.total,
      purgedSnapshots:  stats.purged,
      pendingSnapshots: stats.pending,
      nextPurgeDate,
    }
  }
}
