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

import { Transaction } from 'kysely'
import { getDb } from '../db'
import { Database, TestResult, NewTestResult } from '../types'

export class TestResultRepository {

  async insert(result: NewTestResult): Promise<TestResult> {
    const db = getDb()
    return db.insertInto('test_results')
      .values(result)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  /** TD-120: optional trx joins the caller's transaction (see RunRepository.insert). */
  async insertBatch(results: NewTestResult[], trx?: Transaction<Database>): Promise<void> {
    if (results.length === 0) return
    const db = trx ?? getDb()
    await db.insertInto('test_results')
      .values(results)
      .execute()
  }

  async findByRun(runId: string): Promise<TestResult[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('suite', 'asc')
      .execute()
  }

  /** TD-126: how many test_results rows already exist for a run — the batch
   *  verifier uses this to detect streaming (0 = none, ==total = complete,
   *  between = partial gap-fill). */
  async countByRun(runId: string): Promise<number> {
    const db = getDb()
    const row = await db.selectFrom('test_results')
      .select(db.fn.countAll<number>().as('n'))
      .where('run_id', '=', runId)
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  async findByRunAndStatus(runId: string, status: string): Promise<TestResult[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .selectAll()
      .where('run_id', '=', runId)
      .where('status', '=', status)
      .execute()
  }

  async findFailedByRun(runId: string): Promise<TestResult[]> {
    return this.findByRunAndStatus(runId, 'failed')
  }

  async findBySuite(runId: string, suite: string): Promise<TestResult[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .selectAll()
      .where('run_id', '=', runId)
      .where('suite', '=', suite)
      .execute()
  }

  async findByTestId(testId: string, limit = 20): Promise<TestResult[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .selectAll()
      .where('test_id', '=', testId)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
  }

  async findByTag(tag: string, limit = 50): Promise<TestResult[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .selectAll()
      .where('tags', 'like', `%${tag}%`)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
  }

  async findUnverifiedOracles(runId: string): Promise<TestResult[]> {
    return this.findByTag('@unverified-oracle')
  }

  async getSuiteBreakdown(runId: string): Promise<
    { suite: string; total: number; passed: number; failed: number }[]
  > {
    const db = getDb()
    const rows = await db.selectFrom('test_results')
      .select(['suite', 'status'])
      .where('run_id', '=', runId)
      .execute()

    const map = new Map<string, { total: number; passed: number; failed: number }>()
    for (const r of rows) {
      const entry = map.get(r.suite) || { total: 0, passed: 0, failed: 0 }
      entry.total++
      if (r.status === 'passed') entry.passed++
      if (r.status === 'failed') entry.failed++
      map.set(r.suite, entry)
    }
    return Array.from(map.entries()).map(([suite, counts]) => ({ suite, ...counts }))
  }

  async getHistoryForTest(
    testId: string,
    limit = 10
  ): Promise<{ runId: string; status: string; duration_ms: number; started_at: string }[]> {
    const db = getDb()
    return db.selectFrom('test_results')
      .select(['run_id', 'status', 'duration_ms', 'started_at'])
      .where('test_id', '=', testId)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute() as any
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('test_results')
      .where('run_id', '=', runId)
      .execute()
  }
}
