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
 * PageExplorationRecord — canonical page lifecycle state.
 *
 * Nova-approved abstraction (TD-124 design review).
 *
 * Replaces the overloaded `visited: Set<string>` which conflated three
 * independent facts:
 *   discovered  — a PageDiscovery was produced here
 *   classified  — elements/flows were classified here
 *   swept       — click-discovery was run here (BFS never sweeps; SPA does)
 *
 * The root TD-124 bug: SPAStrategy skipped any URL in `visited`, but "visited"
 * meant "discovered/classified" — so a BFS-discovered page (never swept) was
 * skipped and its click-discovery never ran, losing every click-only page
 * (16/30 on OrangeHRM, live-confirmed). The fix: SPAStrategy checks `swept`,
 * not `discovered`.
 *
 * Future-extensible to: verified, goalExplored, agentVisited, authVerified,
 * firstSeen, explorationDepth, …
 *
 * The Map<string, PageExplorationRecord> (keyed by NORMALIZED URL) replaces
 * `visited: Set<string>` everywhere in the crawl pipeline.
 */

export interface PageExplorationRecord {
  /** A PageDiscovery was produced for this URL. */
  discovered: boolean;

  /**
   * Elements and flows were AI-classified here. Currently set alongside
   * `discovered` (every discovery classifies) — kept separate for future
   * independent classification passes.
   */
  classified: boolean;

  /**
   * Click-discovery (discoverViaSelectors / discoverViaButtonText) was run on
   * this page. BFS never sets this — only SPAStrategy. THE KEY FIX:
   * SPAStrategy checks `swept`, not `discovered`, before skipping a frontier URL.
   */
  swept: boolean;
}

/** Convenience factory — all facts false unless overridden. */
export function makeExplorationRecord(
  partial: Partial<PageExplorationRecord> = {},
): PageExplorationRecord {
  return { discovered: false, classified: false, swept: false, ...partial }
}

/** The exploration map, keyed by normalized URL string. */
export type ExplorationMap = Map<string, PageExplorationRecord>

/** Create a new empty ExplorationMap. */
export function createExplorationMap(): ExplorationMap {
  return new Map()
}

/** Discovered? — replaces `visited.has(url)`. */
export function isDiscovered(map: ExplorationMap, url: string): boolean {
  return map.get(url)?.discovered ?? false
}

/**
 * Swept (click-discovered)? — SPAStrategy uses THIS, not isDiscovered(), to
 * decide whether to skip a frontier URL.
 */
export function isSwept(map: ExplorationMap, url: string): boolean {
  return map.get(url)?.swept ?? false
}

/**
 * Mark a URL discovered (PageDiscovery produced). Sets classified too — every
 * discovery classifies today. Replaces `visited.add(url)`.
 */
export function markDiscovered(map: ExplorationMap, url: string): void {
  const existing = map.get(url) ?? makeExplorationRecord()
  map.set(url, { ...existing, discovered: true, classified: true })
}

/**
 * Mark a URL swept (click-discovery completed). Called by SPAStrategy after
 * discoverViaSelectors + discoverViaButtonText. Preserves discovered/classified.
 */
export function markSwept(map: ExplorationMap, url: string): void {
  const existing = map.get(url) ?? makeExplorationRecord()
  map.set(url, { ...existing, swept: true })
}
