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

import { AiBudgetTracker } from '../onboarding/types'

/**
 * Budget defaults — single source of truth (TD-132).
 *
 * Consolidates the scattered hardcoded AI-budget `50`s. There are two
 * independent AI-call pools; do not conflate them:
 *
 *   Pool A (crawl)          — element naming + flow enrichment, sized to the
 *                             crawl's page count. Total = DEFAULT_AI_BUDGET,
 *                             split into a naming budget and a reserved flow
 *                             budget so naming can never starve FlowDetector
 *                             (TD-132 defect #2).
 *   Pool B (classification) — module-residue classification (CrawlRunner /
 *                             AiResidueStage). Separate since TD-112; kept at
 *                             DEFAULT_CLASSIFICATION_BUDGET and NOT resized by
 *                             Pool A's dynamic sizing ("Pool B untouched").
 */

/** Pool A default total. Sized for ~75 pages (150 − 10 reserve = 140 naming ÷ ~2 batches/page). */
export const DEFAULT_AI_BUDGET = 150

/** AI calls reserved for FlowDetector — naming cannot consume these (TD-132 defect #2). */
export const FLOW_DETECTOR_RESERVE = 10

/** Pool B default. Unchanged value (was the hardcoded `50`), now named and decoupled from Pool A. */
export const DEFAULT_CLASSIFICATION_BUDGET = 50

/** Floor for Pool A's dynamic sizing — a tiny crawl still gets at least this. */
export const MIN_AI_BUDGET = 50

/** Naming budget = total Pool A minus the FlowDetector reserve. */
export function namingBudget(total: number): number {
  return Math.max(0, total - FLOW_DETECTOR_RESERVE)
}

/** FlowDetector's reserved budget (independent of naming consumption). */
export function flowBudget(_total: number): number {
  return FLOW_DETECTOR_RESERVE
}

/**
 * Effective Pool A budget for a crawl (TD-132): sized to the page cap (the
 * driver of naming demand, ~2 batches/page), floored at MIN_AI_BUDGET, and
 * capped at the user's budget (config or --ai-budget).
 *   effective = min(userBudget, max(MIN_AI_BUDGET, maxPages × 2))
 */
export function effectiveAiBudget(userBudget: number, maxPages: number): number {
  return Math.min(userBudget, Math.max(MIN_AI_BUDGET, maxPages * 2))
}

/**
 * Build an AiBudgetTracker (ruling A — AiBudgetTracker is an interface, not a
 * class; this is the single object-literal factory used by every pool).
 */
export function makeBudgetTracker(
  limit:   number,
  runId?:  string,
  appName?: string,
): AiBudgetTracker {
  const tracker = { remaining: limit }
  return {
    runId,
    appName,
    get remaining() { return tracker.remaining },
    consume(n: number) {
      if (tracker.remaining <= 0) return false
      tracker.remaining -= n
      return true
    },
    isExhausted() { return tracker.remaining <= 0 },
  }
}
