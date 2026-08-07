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
import { Assertion, NewAssertion } from '../types'

export class AssertionRepository {

  async insert(assertion: NewAssertion): Promise<Assertion> {
    const db = getDb()
    return db.insertInto('assertions')
      .values(assertion)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findQuarantined(appName: string): Promise<Assertion[]> {
    const db = getDb()
    return db.selectFrom('assertions')
      .selectAll()
      .where('app_name', '=', appName)
      .where('status', '=', 'quarantined')
      .orderBy('confidence', 'desc')
      .execute()
  }

  async findByFlow(appName: string, flowId: string): Promise<Assertion[]> {
    const db = getDb()
    return db.selectFrom('assertions')
      .selectAll()
      .where('app_name', '=', appName)
      .where('flow_id', '=', flowId)
      .execute()
  }

  async findByTier(appName: string, tier: number): Promise<Assertion[]> {
    const db = getDb()
    return db.selectFrom('assertions')
      .selectAll()
      .where('app_name', '=', appName)
      .where('tier', '=', tier)
      .execute()
  }

  async promote(id: number, reviewedBy: string): Promise<void> {
    const db = getDb()
    await db.updateTable('assertions')
      .set({
        status:      'promoted',
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .execute()
  }

  async reject(id: number, reviewedBy: string): Promise<void> {
    const db = getDb()
    await db.updateTable('assertions')
      .set({
        status:      'rejected',
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .execute()
  }

  async updateMutationScore(id: number, score: number): Promise<void> {
    const db = getDb()
    await db.updateTable('assertions')
      .set({ mutation_score: score })
      .where('id', '=', id)
      .execute()
  }

  async getStatusBreakdown(
    appName: string
  ): Promise<{ status: string; count: number }[]> {
    const db = getDb()
    const rows = await db.selectFrom('assertions')
      .select(['status'])
      .where('app_name', '=', appName)
      .execute()

    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.status, (map.get(r.status) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([status, count]) => ({ status, count }))
  }
}
