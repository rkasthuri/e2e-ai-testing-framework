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

import { Page } from '@playwright/test'

export type CrawlStrategy = 'bfs' | 'spa' | 'hybrid'

/** TD-128: the four SPA signals gathered from the page (decision made in Node). */
export interface SpaEvidence {
  runtimeGlobals:  boolean
  rootContainer:   boolean
  frameworkAttr:   boolean
  frameworkScript: boolean
}

/**
 * TD-128: evidence accumulation (Nova Q2 ruling).
 * Runtime globals alone = sufficient (strong signal).
 * DOM signals alone = need 2+ (weak signals; single
 * node like #app is not sufficient — server-rendered
 * apps use it too).
 *
 * Example (React app with mount div + attribute):
 *   runtimeGlobals:false, rootContainer:true (#root),
 *   frameworkAttr:true ([data-reactroot]) →
 *   domEvidenceCount:2 → isSpa:true ✓
 *
 * OrangeHRM: runtimeGlobals:false, rootContainer:true
 * (#app), frameworkScript:false (chunk-vendors.js) →
 * domEvidenceCount:1 → isSpa:false (by design —
 * routing handled correctly via jsClickables branch).
 * Future: behavioral signals (TD-136) will detect
 * OrangeHRM-style SPAs without framework fingerprints.
 *
 * The old check used ONLY runtime globals (window.React etc.), which production
 * bundles don't expose. Pure + Node-side so it is unit-testable (page.evaluate
 * can't call imported functions — a known tsx failure pattern).
 */
export function evaluateSpaEvidence(e: SpaEvidence): boolean {
  const domEvidenceCount = [e.rootContainer, e.frameworkAttr, e.frameworkScript].filter(Boolean).length
  return e.runtimeGlobals || domEvidenceCount >= 2
}

/** TD-UI-031 Block 4: the start-page signals StrategyDetector computes. Previously
 *  only `mode` survived; realLinks/jsClickables were logged and discarded (site #1).
 *  TD-169 (ADR-015): realLinks/jsClickables are `null` — NOT a `-1` sentinel — when a
 *  config override short-circuits measurement. Unmeasured reads as unknown, never as data. */
export interface StrategySignals {
  mode:         CrawlStrategy
  realLinks:    number | null
  jsClickables: number | null
  isSpa:        boolean
}

export class StrategyDetector {
  async detectWithSignals(page: Page, configOverride?: string): Promise<StrategySignals> {
    // Honour explicit config override — signals not measured (TD-169: null, not a sentinel).
    if (configOverride && configOverride !== 'auto') {
      console.log(`[StrategyDetector] Using config override: ${configOverride}`)
      return { mode: configOverride as CrawlStrategy, realLinks: null, jsClickables: null, isSpa: false }
    }

    // Wait for SPA frameworks to fully initialise
    await page.waitForTimeout(2000)

    const currentUrl = page.url()

    const indicators = await page.evaluate((currentPathname) => {
      // TD-128: gather the raw SPA signals here (DOM-dependent); the accumulation
      // decision is made in Node via evaluateSpaEvidence (pure + unit-testable).
      const spaEvidence = {
        runtimeGlobals:
          !!(window as any).__vue_app__ ||
          !!(window as any).Vue ||
          !!(window as any).React ||
          !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
          !!(window as any).ng ||
          typeof (window as any).getAllAngularRootElements === 'function' ||
          !!(window as any).__NEXT_DATA__ ||
          !!(window as any).nuxt ||
          location.href.includes('/#/'),

        rootContainer:
          !!document.querySelector('#app, #root'),

        frameworkAttr:
          !!document.querySelector('[ng-version], [data-reactroot]'),

        frameworkScript:
          !!document.querySelector(
            'script[src*="react"], ' +
            'script[src*="vue"], ' +
            'script[src*="angular"]'
          ),
      }

      // Count REAL navigable links — different pathname, same origin, no hash tricks
      const allAnchors = Array.from(document.querySelectorAll('a[href]'))
      const realLinks = allAnchors.filter(a => {
        const href = (a as HTMLAnchorElement).getAttribute('href') || ''
        if (!href || href === '#' || href.startsWith('#') ||
            href.startsWith('javascript') || href.startsWith('mailto') ||
            href.startsWith('tel')) return false
        try {
          const resolved = new URL(href, window.location.href)
          // Must be same origin and different pathname
          return resolved.origin === window.location.origin &&
                 resolved.pathname !== currentPathname
        } catch { return false }
      }).length

      // Count JS-only clickables — navigation disguised as non-links
      const jsClickables =
        // hash-only links
        allAnchors.filter(a => {
          const href = (a as HTMLAnchorElement).getAttribute('href') || ''
          return href === '#' || href === '' || href.startsWith('#')
        }).length +
        // buttons excluding submit
        document.querySelectorAll('button:not([type=submit])').length +
        // ARIA nav elements
        document.querySelectorAll(
          '[role="menuitem"],[role="tab"],[role="link"]'
        ).length +
        // Class-based nav patterns
        document.querySelectorAll(
          '[class*="nav-item"],[class*="menu-item"],[class*="sidebar-item"],' +
          '.oxd-main-menu-item'
        ).length

      return { spaEvidence, realLinks, jsClickables }
    }, new URL(currentUrl).pathname)

    // TD-128 (Nova Q2): decide isSpa from the accumulated evidence — Node-side,
    // pure, unit-testable. Same semantics as before, relocated for testability.
    const isSpa = evaluateSpaEvidence(indicators.spaEvidence)

    let mode: CrawlStrategy

    if (isSpa) {
      // SPA framework detected
      if (indicators.realLinks > 3) {
        mode = 'hybrid'  // Has real links too — use both strategies
      } else {
        mode = 'spa'
      }
    } else if (indicators.jsClickables > indicators.realLinks) {
      // More JS navigation than real links — treat as SPA
      mode = indicators.realLinks > 1 ? 'hybrid' : 'spa'
    } else if (indicators.realLinks > 3) {
      mode = 'bfs'
    } else if (indicators.realLinks === 0 && indicators.jsClickables === 0) {
      mode = 'bfs'  // Sparse page (login page etc) — safe default
    } else {
      mode = 'hybrid'  // Uncertain — try both
    }

    console.log(
      `[StrategyDetector] Mode: ${mode} | ` +
      `spa:${isSpa} ` +
      `realLinks:${indicators.realLinks} ` +
      `jsClickables:${indicators.jsClickables}`
    )

    return { mode, realLinks: indicators.realLinks, jsClickables: indicators.jsClickables, isSpa }
  }

  /** Back-compat: the strategy mode alone (Bootstrap + unit callers). */
  async detect(page: Page, configOverride?: string): Promise<CrawlStrategy> {
    return (await this.detectWithSignals(page, configOverride)).mode
  }
}
