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

import { BrowserContext }  from '@playwright/test'
import { PageDiscovery, AiBudgetTracker } from './types'
import { HybridStrategy }  from './HybridStrategy'
import { CrawlConfig }     from './BFSStrategy'
import { CrawlStrategy }       from './StrategyDetector'
import { ExplorationMap } from './PageExplorationRecord'

export class SelfCorrectionEngine {
  async evaluate(
    pages:          PageDiscovery[],
    context:        BrowserContext,
    startUrl:       string,
    config:         CrawlConfig,
    budget:         AiBudgetTracker,
    usedMode:       CrawlStrategy,
    // TD-124: pass-through only — SelfCorrectionEngine never inspects swept.
    // The escalated HybridStrategy inherits the fix automatically (Nova Q4).
    explorationMap: ExplorationMap,
  ): Promise<PageDiscovery[]> {
    // Correction triggers — all three must be true
    const tooFewPages     = pages.length < 5
    const hasAuthContent  = pages.some(p =>
      p.elements.length > 5 && !p.isAuthPage
    )
    const budgetRemaining = (config.maxPages - pages.length) > 3

    if (!tooFewPages || !hasAuthContent || !budgetRemaining) {
      if (pages.length >= 1) {
        console.log(
          `[SelfCorrection] No correction needed — ` +
          `${pages.length} pages, mode=${usedMode}`
        )
      }
      return pages
    }

    // Already tried hybrid — can't escalate further
    if (usedMode === 'hybrid') {
      console.log(
        `[SelfCorrection] Already used hybrid — ` +
        `${pages.length} pages is the maximum discoverable`
      )
      return pages
    }

    const remainingBudget = config.maxPages - pages.length
    console.log(
      `[SelfCorrection] Triggered: ${pages.length} pages with mode=${usedMode}. ` +
      `Escalating to hybrid with ${remainingBudget} page budget remaining.`
    )

    try {
      const additionalPages = await new HybridStrategy(config, budget)
        .crawl(context, startUrl, explorationMap, remainingBudget)

      const combined = [...pages, ...additionalPages]
      console.log(
        `[SelfCorrection] Complete: ${pages.length} → ${combined.length} pages ` +
        `(+${additionalPages.length} from escalation)`
      )
      return combined
    } catch (e: any) {
      console.warn(`[SelfCorrection] Escalation failed: ${e.message}`)
      return pages
    }
  }
}
