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

import { getDb } from '../db'
import { DomSnapshot, NewDomSnapshot } from '../types'

export class DomSnapshotRepository {

  async insert(snapshot: NewDomSnapshot): Promise<DomSnapshot> {
    const db = getDb()
    return db.insertInto('dom_snapshots')
      .values(snapshot)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findByStep(
    runId: string,
    testId: string,
    stepIndex: number
  ): Promise<DomSnapshot | null> {
    const db = getDb()
    const result = await db.selectFrom('dom_snapshots')
      .selectAll()
      .where('run_id', '=', runId)
      .where('test_id', '=', testId)
      .where('step_index', '=', stepIndex)
      .executeTakeFirst()
    return result ?? null
  }

  async findByTest(runId: string, testId: string): Promise<DomSnapshot[]> {
    const db = getDb()
    return db.selectFrom('dom_snapshots')
      .selectAll()
      .where('run_id', '=', runId)
      .where('test_id', '=', testId)
      .orderBy('step_index', 'asc')
      .execute()
  }

  async findExpired(): Promise<DomSnapshot[]> {
    const db = getDb()
    const now = new Date().toISOString().slice(0, 10)
    return db.selectFrom('dom_snapshots')
      .selectAll()
      .where('purge_after_date', '<=', now)
      .where('purged', '=', 0)
      .execute()
  }

  async markPurged(ids: number[]): Promise<void> {
    if (ids.length === 0) return
    const db = getDb()
    for (const id of ids) {
      await db.updateTable('dom_snapshots')
        .set({ purged: 1 })
        .where('id', '=', id)
        .execute()
    }
  }

  async getPurgeStats(): Promise<{
    total:   number
    purged:  number
    pending: number
  }> {
    const db = getDb()
    const rows = await db.selectFrom('dom_snapshots')
      .select(['purged'])
      .execute()
    const total  = rows.length
    const purged = rows.filter(r => r.purged === 1).length
    return { total, purged, pending: total - purged }
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('dom_snapshots')
      .where('run_id', '=', runId)
      .execute()
  }
}
