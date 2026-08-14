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

import { BrowserContext } from '@playwright/test'
import { PageDiscovery, AiBudgetTracker }  from './types'
import { BFSStrategy, CrawlConfig, type PageDiscoverySink } from './BFSStrategy'
import { SPAStrategy }    from './SPAStrategy'
import { normalizeUrl }   from './PageVisitor'
import { ExplorationMap, createExplorationMap } from './PageExplorationRecord'

export class HybridStrategy {
  constructor(
    private config: CrawlConfig,
    private budget: AiBudgetTracker,
    private onPageDiscovered?: PageDiscoverySink,
  ) {}

  async crawl(
    context:        BrowserContext,
    startUrl:       string,
    explorationMap: ExplorationMap = createExplorationMap(),
    budget:         number         = this.config.maxPages,
  ): Promise<PageDiscovery[]> {
    console.log(`[HybridStrategy] Starting | Budget: ${budget} pages`)

    // TD-130: the 60/40 split is removed. It was a proxy for fairness between
    // BFS and SPA — but a fixed cap starved SPA (22 seeded sweeps > 20-open
    // allowance on OrangeHRM → 0 new pages) and discarded BFS's unused share.
    // The CrawlScheduler now provides real fairness (visits-first) without
    // artificial budget caps: BFS uses what it needs; SPA gets the rest.
    const bfs = new BFSStrategy(this.config, this.budget, this.onPageDiscovered)
    const bfsResults = await bfs.crawl(context, startUrl, explorationMap, budget)

    // TD-124 (Nova Q3): seed SPA's frontier with ALL BFS-discovered-but-unswept
    // pages — BFS never click-discovers, so every page it found is unswept and
    // may hide click-only child pages. (Pre-TD-124, SPA started from startUrl,
    // found it already "visited", and swept NOTHING — the whole bug.) Budget
    // caps how many actually get swept; explicit prioritization is crawl
    // planning, out of scope (Nova Q5).
    const unsweptPages = [...explorationMap]
      .filter(([, r]) => r.discovered && !r.swept)
      .map(([url]) => url)

    // TD-130: full remaining budget to SPA — bfsResults.length pages were
    // opened by BFS; the scheduler manages sweep/visit fairness from here.
    const bfsUsed      = bfsResults.length
    const spaRemaining = Math.max(0, budget - bfsUsed)
    console.log(
      `[HybridStrategy] BFS found ${bfsUsed} page(s), ` +
      `passing ${spaRemaining} budget to SPA scheduler ` +
      `(seeding ${unsweptPages.length} unswept BFS page(s) as sweeps)`
    )

    // Pass the same explorationMap so SPA sees BFS's discoveries (swept-gated).
    const bfsSpa = new SPAStrategy(this.config, this.budget, this.onPageDiscovered)
    const spaResults = await bfsSpa.crawl(
      context, startUrl, explorationMap, spaRemaining,
      unsweptPages.length > 0 ? unsweptPages : undefined,
    )

    const all = [...bfsResults, ...spaResults]

    // Deduplicate by normalised URL
    const seen  = new Set<string>()
    const deduped: PageDiscovery[] = []
    for (const p of all) {
      const norm = normalizeUrl(
        p.urlPattern.startsWith('http')
          ? p.urlPattern
          : 'https://placeholder.com' + p.urlPattern
      )
      if (!seen.has(norm)) {
        seen.add(norm)
        deduped.push(p)
      }
    }

    console.log(
      `[HybridStrategy] Complete | BFS: ${bfsResults.length} + ` +
      `SPA: ${spaResults.length} = ${deduped.length} unique pages`
    )

    return deduped
  }
}
