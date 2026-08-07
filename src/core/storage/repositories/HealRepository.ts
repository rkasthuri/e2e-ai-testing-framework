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
import { HealEvent, NewHealEvent } from '../types'

export class HealRepository {

  async insert(event: NewHealEvent): Promise<HealEvent> {
    const db = getDb()
    return db.insertInto('heal_events')
      .values(event)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findByRun(runId: string): Promise<HealEvent[]> {
    const db = getDb()
    return db.selectFrom('heal_events')
      .selectAll()
      .where('run_id', '=', runId)
      .execute()
  }

  async findByElement(page: string, element: string): Promise<HealEvent[]> {
    const db = getDb()
    return db.selectFrom('heal_events')
      .selectAll()
      .where('page', '=', page)
      .where('element', '=', element)
      .orderBy('healed_at', 'desc')
      .execute()
  }

  async getConsecutiveCount(page: string, element: string): Promise<number> {
    const db = getDb()
    const result = await db.selectFrom('heal_events')
      .select(['consecutive_count'])
      .where('page', '=', page)
      .where('element', '=', element)
      .orderBy('healed_at', 'desc')
      .executeTakeFirst()
    return result?.consecutive_count ?? 0
  }

  async markPromoted(id: number): Promise<void> {
    const db = getDb()
    await db.updateTable('heal_events')
      .set({ promoted: 1 })
      .where('id', '=', id)
      .execute()
  }

  async findUnpromoted(consecutiveThreshold = 3): Promise<HealEvent[]> {
    const db = getDb()
    return db.selectFrom('heal_events')
      .selectAll()
      .where('promoted', '=', 0)
      .where('consecutive_count', '>=', consecutiveThreshold)
      .execute()
  }

  async getHealCountByRun(runId: string): Promise<number> {
    const db = getDb()
    const rows = await db.selectFrom('heal_events')
      .select(['id'])
      .where('run_id', '=', runId)
      .execute()
    return rows.length
  }

  async getTopHealedElements(
    appName: string,
    limit = 10
  ): Promise<{ page: string; element: string; count: number }[]> {
    const db = getDb()
    const rows = await db.selectFrom('heal_events')
      .innerJoin('runs', 'runs.run_id', 'heal_events.run_id')
      .select(['heal_events.page', 'heal_events.element'])
      .where('runs.app_name', '=', appName)
      .execute()

    const map = new Map<string, number>()
    for (const r of rows) {
      const key = `${r.page}::${r.element}`
      map.set(key, (map.get(key) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([key, count]) => {
        const [page, element] = key.split('::')
        return { page, element, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('heal_events')
      .where('run_id', '=', runId)
      .execute()
  }
}
