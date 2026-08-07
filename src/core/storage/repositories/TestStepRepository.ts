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
import { TestStep, NewTestStep } from '../types'

export class TestStepRepository {

  async insertBatch(steps: NewTestStep[]): Promise<void> {
    if (steps.length === 0) return
    const db = getDb()
    const CHUNK = 100
    for (let i = 0; i < steps.length; i += CHUNK) {
      await db.insertInto('test_steps')
        .values(steps.slice(i, i + CHUNK))
        .execute()
    }
  }

  async findByTest(runId: string, testId: string): Promise<TestStep[]> {
    const db = getDb()
    return db.selectFrom('test_steps')
      .selectAll()
      .where('run_id', '=', runId)
      .where('test_id', '=', testId)
      .orderBy('step_index', 'asc')
      .execute()
  }

  async findFailureStep(runId: string, testId: string): Promise<TestStep | null> {
    const db = getDb()
    const result = await db.selectFrom('test_steps')
      .selectAll()
      .where('run_id', '=', runId)
      .where('test_id', '=', testId)
      .where('status', '=', 'failed')
      .orderBy('step_index', 'asc')
      .executeTakeFirst()
    return result ?? null
  }

  async findHealedSteps(runId: string): Promise<TestStep[]> {
    const db = getDb()
    return db.selectFrom('test_steps')
      .selectAll()
      .where('run_id', '=', runId)
      .where('healed', '=', 1)
      .execute()
  }

  async getStepCountByAction(runId: string): Promise<
    { action: string; count: number }[]
  > {
    const db = getDb()
    const rows = await db.selectFrom('test_steps')
      .select(['action'])
      .where('run_id', '=', runId)
      .execute()

    const map = new Map<string, number>()
    for (const r of rows) {
      map.set(r.action, (map.get(r.action) || 0) + 1)
    }
    return Array.from(map.entries()).map(([action, count]) => ({ action, count }))
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('test_steps')
      .where('run_id', '=', runId)
      .execute()
  }
}
