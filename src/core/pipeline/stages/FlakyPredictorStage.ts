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

/**
 * TD-120 — FlakyPredictorStage: Stage 1 of the AnalysisPipeline.
 *
 * Reads per-test execution history from test_results (populated by
 * results-store's walkSuite — every test, every run), scores each test with
 * the pure flakyScoring formula, persists to flaky_analysis.
 *
 * Nova rulings enforced here:
 *   - executedRuns = passed + failed + flaky (skipped stored, excluded — Q2)
 *   - MIN_SAMPLE = 10 default, configurable
 *   - below MIN_SAMPLE → PERSIST an insufficient-evidence row, never suppress
 *     ("Unknown is data. Missing is not." — Q3)
 *   - deterministic only — no AI in scoring
 *
 * DB access: raw queries on the INJECTED ctx.db, deliberately NOT via
 * FlakyAnalysisRepository/TestResultRepository — those are bound to the
 * getDb() singleton, and the injected-db testability pattern is the point
 * of AnalysisContext (see AnalysisPipeline.ts).
 */
import { Kysely } from 'kysely'
import { Database } from '../../storage/types'
import { AnalysisStage, AnalysisContext } from '../AnalysisPipeline'
import { TestExecutionSummary, computeFlakyScore } from './scoring/flakyScoring'

export interface FlakyPredictorConfig {
  minSample?: number;   // default: 10 (Nova Q3)
}

interface FlakyRow {
  test_id: string
  app_name: string
  analysis_date: string
  flaky_score: number
  confidence: string
  sample_size: number
  recommendation: string
  trend: string
}

export class FlakyPredictorStage implements AnalysisStage {
  name = 'FlakyPredictor'
  private minSample: number

  constructor(config: FlakyPredictorConfig = {}) {
    this.minSample = config.minSample ?? 10
  }

  async run(ctx: AnalysisContext): Promise<void> {
    // 1. Distinct test_ids for this app — test_results carries no app_name;
    //    join through runs (Step-0 finding C, same pattern as TrendRepository).
    const testIds = await ctx.db
      .selectFrom('test_results as tr')
      .innerJoin('runs as r', 'r.run_id', 'tr.run_id')
      .where('r.app_name', '=', ctx.appName)
      .select('tr.test_id')
      .distinct()
      .execute()
      .then(rows => rows.map(row => row.test_id))

    if (testIds.length === 0) {
      console.log(`[FlakyPredictorStage] No test history for ${ctx.appName} — skipping`)
      return
    }

    console.log(`[FlakyPredictorStage] Scoring ${testIds.length} test(s) for ${ctx.appName}`)
    const analysisDate = new Date().toISOString().slice(0, 10)

    for (const testId of testIds) {
      // 2. Per-test history, most-recent-first, last 50 runs.
      const history = await ctx.db
        .selectFrom('test_results')
        .where('test_id', '=', testId)
        .orderBy('started_at', 'desc')
        .limit(50)
        .select(['run_id', 'status', 'duration_ms', 'started_at'])
        .execute()

      // 3. executedRuns excludes skipped (Nova Q2) — skipped rows are stored
      //    upstream, they just don't count toward the denominator.
      const executed = history.filter(r => r.status !== 'skipped')

      // 4. Below MIN_SAMPLE: persist insufficient-evidence — never suppress.
      //    "Unknown is data. Missing is not." (Nova Q3)
      if (executed.length < this.minSample) {
        await this.upsert(ctx.db, {
          test_id: testId,
          app_name: ctx.appName,
          analysis_date: analysisDate,
          flaky_score: 0,
          confidence: 'insufficient-evidence',
          sample_size: executed.length,
          recommendation:
            `Not enough data (${executed.length}/${this.minSample} runs). Re-run to build history.`,
          trend: 'unknown',
        })
        continue
      }

      // 5. Summary for the pure scorer.
      const failureCount = executed.filter(r => r.status === 'failed').length
      const flakyCount   = executed.filter(r => r.status === 'flaky').length
      let consecutiveFails = 0
      for (const r of executed) {           // most-recent-first
        if (r.status === 'failed') consecutiveFails++
        else break
      }
      const summary: TestExecutionSummary = {
        executedRuns: executed.length, failureCount, flakyCount, consecutiveFails,
      }

      // 6. Score — pure, deterministic (no AI).
      const scored = computeFlakyScore(summary, executed)

      // 7. Persist.
      await this.upsert(ctx.db, {
        test_id: testId,
        app_name: ctx.appName,
        analysis_date: analysisDate,
        flaky_score: scored.score,
        confidence: scored.confidence,
        sample_size: executed.length,
        recommendation: scored.recommendation,
        trend: scored.trend,
      })
    }

    console.log(`[FlakyPredictorStage] Complete for ${ctx.appName}`)
  }

  /**
   * Upsert on (test_id, app_name, analysis_date) — the 006_flaky_unique
   * index. signal_* columns are INTEGER 0/1 in the schema; this stage derives
   * no per-signal evidence (that was the old AI layer's job — TD-127), so
   * they are honestly 0, not fabricated.
   */
  private async upsert(db: Kysely<Database>, row: FlakyRow): Promise<void> {
    await db.insertInto('flaky_analysis')
      .values({
        ...row,
        signal_timing: 0, signal_selector: 0, signal_data: 0,
        signal_env: 0, signal_concurrency: 0, signal_network: 0,
      })
      .onConflict(oc => oc
        .columns(['test_id', 'app_name', 'analysis_date'] as any)
        .doUpdateSet({
          flaky_score:    row.flaky_score,
          confidence:     row.confidence,
          sample_size:    row.sample_size,
          recommendation: row.recommendation,
          trend:          row.trend,
        })
      )
      .execute()
  }
}
