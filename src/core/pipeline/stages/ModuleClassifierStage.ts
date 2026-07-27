/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * TD-112 — Stage 1: rule-based module classification over EVERY page.
 * Pure, deterministic, no I/O, no AI — the same ModuleClassifier rule pass
 * that ran post-crawl in CrawlRunner (and at generation time in
 * GeneratorRunner) before TD-112 moved classification here, pre-persistence.
 */
import { ModuleClassifier } from '../../crawler/ModuleClassifier'
import { EnrichmentStage, EnrichmentContext, EnrichableAppModel } from '../ModelEnrichmentPipeline'

export class ModuleClassifierStage implements EnrichmentStage {
  name = 'ModuleClassifier'
  private classifier = new ModuleClassifier()

  async run(model: EnrichableAppModel, _ctx: EnrichmentContext): Promise<void> {
    if (!model.pages) return
    for (const page of model.pages) {
      page.module = this.classifier.classify(page)
    }
  }
}
