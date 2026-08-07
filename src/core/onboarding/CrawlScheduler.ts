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
 * CrawlScheduler — two work queues, one shared budget, visits-first scheduling.
 *
 * Nova-approved abstraction (TD-130 design review).
 *
 * Budget answers: "How much work may I perform?"
 * Scheduling answers: "Which work should I perform next?"
 *
 * Two queues:
 *   SweepQueue  — BFS-discovered unswept pages
 *                 (click-discovery only, no AI — TD-129)
 *   VisitQueue  — newly-discovered pages to classify
 *                 (full classification, AI budget)
 *
 * Policy: visits-first.
 *   A newly-discovered page is more valuable than another sweep — it's
 *   evidence we haven't seen yet. Sweeps are maintenance on already-known
 *   pages. Pre-TD-130, sweeps monopolized SPA's budget (all 22 BFS seeds
 *   queued ahead of any new page → OrangeHRM 0 new pages at depth 0);
 *   visits-first eliminates that starvation without touching budget
 *   accounting (Nova Q2 unchanged: every page open consumes budget).
 *
 * Depth (TD-130 ruling S1): each work item carries its own depth — the flat
 * queue replaces the old per-generation frontier, so depth is per-item, not
 * per-loop-iteration. Sweeps of BFS pages seed at depth 0; a visit discovered
 * from a page at depth d enqueues at d + 1. Discovery is gated by the
 * consumer: item.depth < maxDepth.
 *
 * Future: agent planner (TD-013) becomes another work producer — slots in as
 * a third queue.
 */

export type CrawlWorkType = 'visit' | 'sweep'

export interface CrawlWorkItem {
  url:   string
  type:  CrawlWorkType
  /** Exploration depth of this item (S1). Seeded sweeps: 0. Visit discovered from depth d: d + 1. */
  depth: number
}

export class CrawlScheduler {
  private visitQueue: CrawlWorkItem[] = []
  private sweepQueue: CrawlWorkItem[] = []

  /** Seed the sweep queue with BFS-discovered unswept pages (depth 0). */
  seedSweeps(urls: string[]): void {
    this.sweepQueue.push(...urls.map(url => ({ url, type: 'sweep' as const, depth: 0 })))
  }

  /** Add a newly-discovered page to the visit queue. */
  enqueueVisit(url: string, depth: number): void {
    this.visitQueue.push({ url, type: 'visit', depth })
  }

  /** Add a page to the sweep queue (discovered during a visit). */
  enqueueSweep(url: string, depth: number): void {
    this.sweepQueue.push({ url, type: 'sweep', depth })
  }

  /**
   * Get the next work item. Visits-first policy: if a visit is ready, always
   * prefer it over a sweep. Returns null when both queues are empty.
   */
  next(): CrawlWorkItem | null {
    if (this.visitQueue.length > 0) return this.visitQueue.shift()!
    if (this.sweepQueue.length > 0) return this.sweepQueue.shift()!
    return null
  }

  hasWork(): boolean {
    return this.visitQueue.length > 0 || this.sweepQueue.length > 0
  }

  pendingVisits(): number { return this.visitQueue.length }
  pendingSweeps(): number { return this.sweepQueue.length }
}
