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
 * TD-120 — AnalysisPipeline: sequences analysis stages over execution
 * history, producing computed scores and predictions persisted to the DB.
 *
 * Nova-approved abstraction (TD-120 design review) — the middle layer of
 * FORGE's three-layer evidence architecture:
 *
 *   Evidence Collection   → crawl, execution, healing
 *   Evidence Analysis     → THIS pipeline
 *   Evidence Presentation → knowledge-query, dashboard
 *
 * FlakyPredictorStage is Stage 1. Future stages: failure clustering,
 * regression detection, duration trends, risk forecasting, release readiness.
 *
 * Prediction stays DETERMINISTIC — no AI in scoring. AI belongs only in
 * future explanation layers.
 *
 * Same shape as ModelEnrichmentPipeline (fluent addStage, sequential run,
 * per-stage failure isolation) — deliberately, so pipeline authors learn one
 * pattern. The one difference is documented on AnalysisContext.db below.
 */
import { Kysely } from 'kysely'
import { Database } from '../storage/types'

export interface AnalysisContext {
  runId: string;
  appName: string;
  /**
   * Injected directly — stages never call getDb() themselves. This is the
   * FIRST injected-DB pattern in FORGE (every repository uses the getDb()
   * singleton): stages are fully unit-testable against any Kysely instance
   * (temp-file SQLite in tests) with zero singleton scoping ceremony.
   */
  db: Kysely<Database>;
}

export interface AnalysisStage {
  name: string;
  /**
   * Each stage owns its own DB reads + writes. Stages run sequentially.
   * A stage must never throw on PARTIAL failure — log + continue (honesty
   * floor: persist what is known, mark the rest unknown). A thrown error is
   * a whole-stage failure, isolated by the pipeline below.
   */
  run(ctx: AnalysisContext): Promise<void>;
}

export class AnalysisPipeline {
  private stages: AnalysisStage[] = []

  addStage(stage: AnalysisStage): this {
    this.stages.push(stage)
    return this   // fluent
  }

  async run(ctx: AnalysisContext): Promise<void> {
    for (const stage of this.stages) {
      try {
        await stage.run(ctx)
      } catch (err) {
        // Stage failure never aborts the pipeline — and never the caller:
        // analysis runs AFTER run persistence commits, so a failed stage
        // costs insight, not data. Explicit, never silent.
        console.warn(`[AnalysisPipeline] Stage "${stage.name}" failed — skipping: ${err}`)
      }
    }
  }
}
