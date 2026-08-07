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
 * TD-112/TD-122 — ModelEnrichmentPipeline: sequences enrichment stages applied
 * to the AppModel AFTER crawl, BEFORE persistence.
 *
 * Nova-approved abstraction (TD-112 + TD-122 design review):
 *
 *   Crawler    → discovers (returns AppModel — no internal save, TD-122)
 *   Pipeline   → enriches  (stages run sequentially, in-place)
 *   Workspace  → persists  (single write point, via CrawlRunner)
 *
 * Module classification is the FIRST enrichment stage, not a special case —
 * adding a new stage never touches CrawlRunner.
 *
 * Enrichment is SYNCHRONOUS (Nova ruling): one crawl produces one immutable,
 * fully-enriched snapshot; nothing mutates the model after persistence.
 */
import { AppModel, AppModelCandidate, AiBudgetTracker } from '../onboarding/types'

export type EnrichableAppModel = AppModel | AppModelCandidate

export interface EnrichmentContext {
  runId: string;              // CrawlRunner's run id (ties snapshot → run — Nova Q3)
  appName: string;
  budgetTracker: AiBudgetTracker;   // classification budget — a SEPARATE pool from the crawl's
}

export interface EnrichmentStage {
  name: string;
  /**
   * Mutates the model in place. Stages run sequentially. A stage must never
   * throw on PARTIAL failure — log + continue, marking affected pages
   * confidence:'unknown' (honesty floor) rather than crashing. A thrown error
   * is treated as a whole-stage failure and isolated by the pipeline below.
   */
  run(model: EnrichableAppModel, ctx: EnrichmentContext): Promise<void>;
}

export class ModelEnrichmentPipeline {
  private stages: EnrichmentStage[] = []

  addStage(stage: EnrichmentStage): this {
    this.stages.push(stage)
    return this   // fluent
  }

  async run(model: EnrichableAppModel, ctx: EnrichmentContext): Promise<void> {
    for (const stage of this.stages) {
      try {
        await stage.run(model, ctx)
      } catch (err) {
        // Stage failure must never abort the pipeline: partial enrichment is
        // better than no enrichment (and no persistence). Explicit, never silent.
        console.warn(`[ModelEnrichmentPipeline] Stage "${stage.name}" failed — skipping: ${err}`)
      }
    }
    // Provenance: which run produced this classification snapshot (Nova Q3).
    model.classificationRunId = ctx.runId
  }
}
