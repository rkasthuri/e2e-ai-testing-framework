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
import { AiTriage, NewAiTriage } from '../types'

export class AiTriageRepository {

  async insert(triage: NewAiTriage): Promise<AiTriage> {
    const db = getDb()
    return db.insertInto('ai_triage')
      .values(triage)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findByTest(runId: string, testId: string): Promise<AiTriage | null> {
    const db = getDb()
    const result = await db.selectFrom('ai_triage')
      .selectAll()
      .where('run_id', '=', runId)
      .where('test_id', '=', testId)
      .executeTakeFirst()
    return result ?? null
  }

  async findByRun(runId: string): Promise<AiTriage[]> {
    const db = getDb()
    return db.selectFrom('ai_triage')
      .selectAll()
      .where('run_id', '=', runId)
      .execute()
  }

  async findByCategory(
    category: string,
    days = 30
  ): Promise<AiTriage[]> {
    const db = getDb()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return db.selectFrom('ai_triage')
      .selectAll()
      .where('failure_category', '=', category)
      .where('triaged_at', '>=', since)
      .orderBy('triaged_at', 'desc')
      .execute()
  }

  async findSimilarFailures(
    testId: string,
    limit = 5
  ): Promise<AiTriage[]> {
    const db = getDb()
    return db.selectFrom('ai_triage')
      .selectAll()
      .where('similar_failures', 'like', `%${testId}%`)
      .orderBy('triaged_at', 'desc')
      .limit(limit)
      .execute()
  }

  async getCategoryBreakdown(
    appName: string,
    days = 30
  ): Promise<{ category: string; count: number }[]> {
    const db = getDb()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const rows = await db.selectFrom('ai_triage')
      .innerJoin('runs', 'runs.run_id', 'ai_triage.run_id')
      .select(['ai_triage.failure_category'])
      .where('runs.app_name', '=', appName)
      .where('ai_triage.triaged_at', '>=', since)
      .execute()

    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.failure_category, (map.get(r.failure_category) || 0) + 1)
    }
    return Array.from(map.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('ai_triage')
      .where('run_id', '=', runId)
      .execute()
  }
}
