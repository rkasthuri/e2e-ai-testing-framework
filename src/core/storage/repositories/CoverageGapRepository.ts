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
import { CoverageGap, NewCoverageGap } from '../types'

export class CoverageGapRepository {

  async insert(gap: NewCoverageGap): Promise<CoverageGap> {
    const db = getDb()
    return db.insertInto('coverage_gaps')
      .values(gap)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async insertBatch(gaps: NewCoverageGap[]): Promise<void> {
    if (gaps.length === 0) return
    const db = getDb()
    await db.insertInto('coverage_gaps')
      .values(gaps)
      .onConflict(oc => oc.columns(['app_name', 'gap_id'] as any).doNothing())
      .execute()
  }

  async findOpen(appName: string): Promise<CoverageGap[]> {
    const db = getDb()
    return db.selectFrom('coverage_gaps')
      .selectAll()
      .where('app_name', '=', appName)
      .where('status', '=', 'open')
      .orderBy('priority', 'asc')
      .execute()
  }

  async findByPriority(
    appName: string,
    priority: string
  ): Promise<CoverageGap[]> {
    const db = getDb()
    return db.selectFrom('coverage_gaps')
      .selectAll()
      .where('app_name', '=', appName)
      .where('priority', '=', priority)
      .where('status', '=', 'open')
      .execute()
  }

  async findById(gapId: string): Promise<CoverageGap | null> {
    const db = getDb()
    const result = await db.selectFrom('coverage_gaps')
      .selectAll()
      .where('gap_id', '=', gapId)
      .executeTakeFirst()
    return result ?? null
  }

  async closeGap(
    gapId: string,
    closedByTest: string
  ): Promise<void> {
    const db = getDb()
    await db.updateTable('coverage_gaps')
      .set({
        status:         'closed',
        closed_at:      new Date().toISOString(),
        closed_by_test: closedByTest,
      })
      .where('gap_id', '=', gapId)
      .execute()
  }

  async getOpenCount(appName: string): Promise<number> {
    const db = getDb()
    const rows = await db.selectFrom('coverage_gaps')
      .select(['id'])
      .where('app_name', '=', appName)
      .where('status', '=', 'open')
      .execute()
    return rows.length
  }

  async getPriorityBreakdown(
    appName: string
  ): Promise<{ priority: string; count: number }[]> {
    const db = getDb()
    const rows = await db.selectFrom('coverage_gaps')
      .select(['priority'])
      .where('app_name', '=', appName)
      .where('status', '=', 'open')
      .execute()

    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.priority, (map.get(r.priority) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([priority, count]) => ({ priority, count }))
  }
}
