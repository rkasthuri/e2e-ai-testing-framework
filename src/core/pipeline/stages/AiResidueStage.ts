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
 * TD-112 — Stage 2: AI residue classification for pages the rule pass could
 * not place (confidence:'unknown'). Synchronous (Nova ruling — one crawl, one
 * immutable snapshot), budget-gated by the injected CLASSIFICATION tracker
 * (a separate pool from the crawl's own AI budget — Step-0 finding D).
 *
 * Honesty rules:
 *   - AI answering "unknown" is a VALID outcome — never retried (Nova Q2c).
 *   - Budget exhaustion leaves remaining pages method:'unknown' with an
 *     explicit warn — degraded, never silent, never a crash.
 *   - A failed AI call leaves the rule-pass unknown in place, warned.
 */
import { aiCall } from '../../ai/AiClient'
import { ModuleClassifier } from '../../crawler/ModuleClassifier'
import { EnrichmentStage, EnrichmentContext, EnrichableAppModel } from '../ModelEnrichmentPipeline'

export class AiResidueStage implements EnrichmentStage {
  name = 'AiResidue'
  private classifier = new ModuleClassifier()

  async run(model: EnrichableAppModel, ctx: EnrichmentContext): Promise<void> {
    if (!model.pages) return

    const unknownPages = model.pages.filter(p => p.module?.confidence === 'unknown')
    if (unknownPages.length === 0) return

    for (const page of unknownPages) {
      if (ctx.budgetTracker.isExhausted()) {
        console.warn(
          `[AiResidueStage] Classification budget exhausted — ` +
          `${unknownPages.length - unknownPages.indexOf(page)} ` +
          `page(s) remain unclassified (method:unknown, honest)`,
        )
        break
      }

      try {
        // Adapter: ModuleClassifier's thin injectable → the real AiClient.
        // Budget consumed BEFORE the call (reserve-then-spend — a failed call
        // still costs budget, preventing failure loops from spending forever).
        const claudeApiCall = async (prompt: string): Promise<string> => {
          ctx.budgetTracker.consume(1)
          const response = await aiCall({
            operation: 'module-classify',   // TD-112 AiOperation (Step 1)
            runId:     ctx.runId,
            appName:   ctx.appName,
            messages:  [{ role: 'user', content: prompt }],
          })
          return response.content
        }

        // classifyWithAi honors the honesty floor internally: an AI "unknown"
        // (or unusable response) comes back as method/confidence 'unknown' —
        // assigned as-is, NEVER retried (Nova Q2c).
        page.module = await this.classifier.classifyWithAi(page, claudeApiCall)
      } catch (err) {
        console.warn(
          `[AiResidueStage] AI classification failed for page ${page.id} — ` +
          `leaving as unknown: ${err}`,
        )
        // page.module keeps the rule-pass unknown result.
      }
    }
  }
}
