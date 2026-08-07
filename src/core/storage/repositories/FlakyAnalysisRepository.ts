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
import { FlakyAnalysis, NewFlakyAnalysis } from '../types'

export class FlakyAnalysisRepository {

  async upsert(analysis: NewFlakyAnalysis): Promise<FlakyAnalysis> {
    const db = getDb()
    await db.insertInto('flaky_analysis')
      .values(analysis)
      .onConflict(oc => oc
        .columns(['test_id', 'app_name', 'analysis_date'] as any)
        .doUpdateSet({
          flaky_score:        analysis.flaky_score,
          signal_timing:      analysis.signal_timing,
          signal_selector:    analysis.signal_selector,
          signal_data:        analysis.signal_data,
          signal_env:         analysis.signal_env,
          signal_concurrency: analysis.signal_concurrency,
          signal_network:     analysis.signal_network,
          sample_size:        analysis.sample_size,
          recommendation:     analysis.recommendation,
          trend:              analysis.trend,
        })
      )
      .execute()

    return db.selectFrom('flaky_analysis')
      .selectAll()
      .where('test_id', '=', analysis.test_id)
      .where('app_name', '=', analysis.app_name)
      .where('analysis_date', '=', analysis.analysis_date)
      .executeTakeFirstOrThrow()
  }

  /**
   * Get all flaky analysis records for an app, ordered by flaky_score
   * descending. Includes insufficient-evidence rows — consumers decide how
   * to render them (TD-127 / Nova Q3: honest state, never filtered here).
   */
  async findByApp(appName: string, limit = 100): Promise<FlakyAnalysis[]> {
    const db = getDb()
    return db.selectFrom('flaky_analysis')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('flaky_score', 'desc')
      .limit(limit)
      .execute()
  }

  async findByTest(testId: string): Promise<FlakyAnalysis | null> {
    const db = getDb()
    const result = await db.selectFrom('flaky_analysis')
      .selectAll()
      .where('test_id', '=', testId)
      .orderBy('analysis_date', 'desc')
      .executeTakeFirst()
    return result ?? null
  }

  async findTopFlaky(appName: string, limit = 10): Promise<FlakyAnalysis[]> {
    const db = getDb()
    return db.selectFrom('flaky_analysis')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('flaky_score', 'desc')
      .limit(limit)
      .execute()
  }

  async findDegrading(appName: string): Promise<FlakyAnalysis[]> {
    const db = getDb()
    return db.selectFrom('flaky_analysis')
      .selectAll()
      .where('app_name', '=', appName)
      .where('trend', '=', 'degrading')
      .orderBy('flaky_score', 'desc')
      .execute()
  }

  async findByRecommendation(
    appName: string,
    recommendation: string
  ): Promise<FlakyAnalysis[]> {
    const db = getDb()
    return db.selectFrom('flaky_analysis')
      .selectAll()
      .where('app_name', '=', appName)
      .where('recommendation', '=', recommendation)
      .execute()
  }

  async getSignalBreakdown(appName: string): Promise<{
    signal:   string
    avgScore: number
  }[]> {
    const db = getDb()
    const rows = await db.selectFrom('flaky_analysis')
      .select([
        'signal_timing', 'signal_selector', 'signal_data',
        'signal_env', 'signal_concurrency', 'signal_network',
      ])
      .where('app_name', '=', appName)
      .execute()

    if (rows.length === 0) return []

    const signals = [
      'signal_timing', 'signal_selector', 'signal_data',
      'signal_env', 'signal_concurrency', 'signal_network',
    ] as const

    return signals.map(signal => ({
      signal,
      avgScore: rows.reduce((s, r) => s + (r[signal] as number), 0) / rows.length,
    }))
  }
}
