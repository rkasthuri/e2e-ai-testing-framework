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

import { BrowserContext, Locator, Page } from '@playwright/test'
import { PageDiscovery, AiBudgetTracker, ElementDefinition }  from './types'
import { PageVisitor, isDenied, isSameOrigin, normalizeUrl } from './PageVisitor'
import { CrawlConfig, type PageDiscoverySink } from './BFSStrategy'
import { ExplorationMap, createExplorationMap, isDiscovered, isSwept, markDiscovered, markSwept } from './PageExplorationRecord'
import { CrawlScheduler } from './CrawlScheduler'

const NAV_SELECTORS = [
  '.oxd-main-menu-item',
  '[data-test*="nav"]',
  '[role="menuitem"]',
  '[role="navigation"] a',
  '[role="tab"]',
  '[class*="nav-item"]',
  '[class*="sidebar"] a',
  '[class*="menu-item"]',
  '[class*="sidebar-item"]',
  'nav a',
  'nav button',
  'a[href="#"]',
  'a[href=""]',
  '.shopping_cart_link',
  '.inventory_item_name',
  '.inventory_item_img a',
]

const NAV_TEXT_PATTERNS = [
  /cart/i, /menu/i, /product/i, /inventory/i,
  /checkout/i, /account/i, /profile/i, /dashboard/i,
  /admin/i, /report/i, /setting/i, /module/i,
]

// Buttons whose action mutates app state rather than navigating — clicking
// these during exploration silently pollutes shared browser-context state
// (e.g. "Add to cart" matches /cart/i but adds an item instead of navigating)
const MUTATING_TEXT_PATTERNS = [
  /add.*cart/i, /remove/i, /delete/i,
]

const BUTTON_TEXT_SELECTOR = 'button, [role=button]'

// Mirrors ElementClassifier.buildRoleSelector()'s tag->role map (ElementClassifier.ts:379)
// -- needed here to compute the same "role" signal off a live clicked element
// that classification already computed off the same element during harvest.
const ROLE_MAP: Record<string, string> = {
  'input':    'textbox',
  'button':   'button',
  'a':        'link',
  'select':   'combobox',
  'textarea': 'textbox',
}

export class SPAStrategy {
  private visitor: PageVisitor

  // TD-026/TD-027 (SPA half) -- real {fromUrl, toUrl, trigger} relationships
  // discovered during the merged classify+discover pass, read by Crawler.ts
  // after crawl() resolves (crawlMode === 'spa' only). Kept as a side-effect
  // property rather than changing crawl()'s return type, so HybridStrategy.ts
  // (which also calls crawl() internally) needs no changes at all.
  readonly discoveredEdges: { fromUrl: string; toUrl: string; trigger: string }[] = []

  constructor(
    private config: CrawlConfig,
    private budget: AiBudgetTracker,
    private onPageDiscovered?: PageDiscoverySink,
  ) {
    this.visitor = new PageVisitor(config.baseUrl, budget)
  }

  async crawl(
    context:        BrowserContext,
    startUrl:       string,
    explorationMap: ExplorationMap = createExplorationMap(),
    budget:         number         = this.config.maxPages,
    initialFrontier?: string[],
  ): Promise<PageDiscovery[]> {
    const discovered: PageDiscovery[] = []
    const maxDepth = this.config.maxDepth
    // TD-124 (Nova Q2): budget measures WORK (page opens), not just new
    // discoveries — a sweep-only open of a BFS-discovered page consumes budget.
    let pagesOpened = 0
    console.log(
      `[SPAStrategy] Starting from: ${startUrl} | Budget: ${budget} page opens | maxDepth: ${maxDepth}`
    )

    // TD-124: candidateSet dedups discovery proposals against SWEPT urls only
    // (not all discovered) — a BFS-discovered-but-unswept page is a valid
    // candidate for click-discovery to surface (its edge is real) even though
    // it is never re-enqueued (it is already a seeded sweep).
    const candidateSet = new Set<string>(
      [...explorationMap].filter(([, r]) => r.swept).map(([u]) => u),
    )

    // TD-130: CrawlScheduler replaces the per-generation frontier array.
    // Two queues, visits-first — sweeps can no longer starve new-page visits
    // (pre-TD-130, Hybrid's seeded sweeps consumed the whole SPA budget before
    // any click-discovered page was visited: OrangeHRM 0 new pages, depth 0).
    // Budget accounting is unchanged (Nova Q2): every open counts.
    const scheduler = new CrawlScheduler()
    if (initialFrontier) {
      // Hybrid: BFS-discovered unswept pages enter as sweeps at depth 0 (S1).
      scheduler.seedSweeps(initialFrontier.map(u => normalizeUrl(u)))
    } else {
      // Standalone SPA: startUrl is undiscovered — it needs full
      // classification, so it enters as a visit, not a sweep.
      scheduler.enqueueVisit(normalizeUrl(startUrl), 0)
    }

    while (pagesOpened < budget && scheduler.hasWork()) {
      const work = scheduler.next()!
      const normalized = normalizeUrl(work.url)
      // Already fully processed — skip. The same URL can legitimately sit in
      // both queues (seeded sweep + click-discovered proposal); first
      // processing wins, later duplicates fall through here.
      if (isSwept(explorationMap, normalized)) continue
      candidateSet.add(normalized)

      // Route by page STATE, not queue label: an already-discovered page must
      // never re-classify (TD-129), whichever queue it arrived from.
      let page: Page
      let elementsForDiscovery: ElementDefinition[]
      let pageDiscoveryToPersist: PageDiscovery | null = null
      if (isDiscovered(explorationMap, normalized)) {
        // Sweep-only (TD-129): open WITHOUT ElementClassifier — zero AI budget.
        const res = await this.visitor.visitForDiscoveryOnly(context, normalized)
        page = res.page
        console.log(`[SPAStrategy] Sweep-only discovery: ${normalized} (no AI — BFS already classified)`)
        elementsForDiscovery = []
      } else {
        // New page — merged classify + click-discover in ONE open (ruling S2;
        // TD-021/TD-026/TD-027 parity — no second open to sweep it later).
        const res = await this.visitor.visitKeepOpen(context, normalized, 'spa', work.depth)
        page = res.page
        discovered.push(res.discovery)
        pageDiscoveryToPersist = res.discovery
        markDiscovered(explorationMap, normalized)
        elementsForDiscovery = res.discovery.elements
      }
      pagesOpened++
      markSwept(explorationMap, normalized)

      try {
        if (pageDiscoveryToPersist) await this.onPageDiscovered?.(pageDiscoveryToPersist)
        // S4: budget gate before discovery unchanged. S1: per-item depth gate
        // (the flat queue has no generations — each item carries its depth).
        if (work.depth < maxDepth && pagesOpened < budget) {
          const navResults    = await this.discoverViaSelectors(page, normalized, candidateSet, elementsForDiscovery)
          const buttonResults = await this.discoverViaButtonText(page, normalized, candidateSet, elementsForDiscovery)
          let enqueued = 0
          for (const r of [...navResults, ...buttonResults]) {
            this.discoveredEdges.push({ fromUrl: normalized, toUrl: r.url, trigger: r.trigger })
            // S3: click-candidates only (outboundUrls stay BFS's job). An
            // already-discovered candidate is a seeded sweep — never re-queued.
            const rNorm = normalizeUrl(r.url)
            if (!isDiscovered(explorationMap, rNorm) && !isSwept(explorationMap, rNorm)) {
              scheduler.enqueueVisit(rNorm, work.depth + 1)
              enqueued++
            }
          }
          if (enqueued > 0) {
            console.log(
              `[SPAStrategy] ${normalized} (depth ${work.depth}): ${enqueued} new candidate(s) enqueued as visits`
            )
          }
        }
      } finally {
        await page.close()
      }
    }

    console.log(
      `[SPAStrategy] Complete | ${discovered.length} pages discovered (${pagesOpened} opened) | ` +
      `pending at exit: ${scheduler.pendingVisits()} visit(s), ${scheduler.pendingSweeps()} sweep(s)`
    )
    return discovered
  }

  // TD-026 -- matches the clicked element against this page's already-
  // classified elements by reading the same identifying signals
  // ElementClassifier.buildStrategyChain() itself prioritizes (data-test >
  // id > role+accessibleName > text), read live off the exact DOM node
  // discovery just resolved via (selector, position) -- not by href
  // presence, and identically for both the href-read and click-fallback
  // paths. Conservative on the lower-confidence tiers: an ambiguous
  // role/text match (matches more than one classified element) is treated
  // as no match rather than guessed.
  private async matchClickedElement(
    el:       Locator,
    elements: ElementDefinition[],
  ): Promise<string | null> {
    const dataTest = await el.getAttribute('data-test').catch(() => null)
    if (dataTest) {
      const match = elements.find(e => e.strategies.some(s => s.type === 'data-test' && s.value === dataTest))
      if (match) return match.id
    }

    const domId = await el.getAttribute('id').catch(() => null)
    if (domId) {
      const match = elements.find(e => e.strategies.some(s => s.type === 'id' && s.value === domId))
      if (match) return match.id
    }

    const tag       = await el.evaluate(node => node.tagName.toLowerCase()).catch(() => null)
    const roleAttr  = await el.getAttribute('role').catch(() => null)
    const ariaLabel = await el.getAttribute('aria-label').catch(() => null)
    const text      = (await el.textContent().catch(() => null))?.trim().slice(0, 30) || null
    const role      = roleAttr || (tag ? ROLE_MAP[tag] : null)

    if (role) {
      const candidates = elements.filter(e => e.strategies.some(s => s.type === 'role' && s.value === role))
      const exact = candidates.filter(e => e.strategies.some(
        s => s.type === 'role' && s.value === role && (s.accessibleName ?? null) === (ariaLabel || text || null)
      ))
      if (exact.length === 1) return exact[0].id
      if (exact.length === 0 && candidates.length === 1) return candidates[0].id
    }

    if (text) {
      const candidates = elements.filter(e => e.strategies.some(s => s.type === 'text' && s.value === text))
      if (candidates.length === 1) return candidates[0].id
    }

    return null
  }

  private async discoverViaSelectors(
    page:       Page,
    startUrl:   string,
    candidates: Set<string>,
    elements:   ElementDefinition[],
  ): Promise<{ url: string; trigger: string }[]> {
    const discovered: { url: string; trigger: string }[] = []

    for (const selector of NAV_SELECTORS) {
      try {
        const count = await page.locator(selector).count()
        if (count === 0) continue

        for (let i = 0; i < count; i++) {
          try {
            const el = page.locator(selector).nth(i)

            const href = await el.getAttribute('href').catch(() => null)
            const trigger = await this.matchClickedElement(el, elements) ?? selector

            if (href && href !== '#' && href !== '' && !href.startsWith('#')) {
              try {
                const absolute = new URL(href, this.config.baseUrl).toString()
                const norm = normalizeUrl(absolute)
                if (isSameOrigin(norm, this.config.baseUrl) &&
                    !isDenied(norm) &&
                    !candidates.has(norm)) {
                  discovered.push({ url: norm, trigger })
                  candidates.add(norm)
                }
              } catch {}
              continue
            }

            const urlBefore = normalizeUrl(page.url())
            await el.click({ timeout: 3000 })
            let urlAfter = urlBefore
            for (let j = 0; j < 8; j++) {
              await page.waitForTimeout(250)
              urlAfter = normalizeUrl(page.url())
              if (urlAfter !== urlBefore) break
            }

            if (urlAfter !== urlBefore &&
                isSameOrigin(urlAfter, this.config.baseUrl) &&
                !isDenied(urlAfter) &&
                !candidates.has(urlAfter)) {
              discovered.push({ url: urlAfter, trigger })
              candidates.add(urlAfter)
            }

            if (normalizeUrl(page.url()) !== normalizeUrl(startUrl)) {
              await page.goto(startUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
              }).catch(() => {})
              await page.waitForTimeout(1200)
            }
          } catch {
            try {
              if (normalizeUrl(page.url()) !== normalizeUrl(startUrl)) {
                await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
                await page.waitForTimeout(1000)
              }
            } catch {}
          }
        }
      } catch (e: any) {
        console.warn(`[SPAStrategy] Selector "${selector}" failed: ${e.message}`)
      }
    }

    const seen = new Set<string>()
    return discovered.filter(d => !seen.has(d.url) && seen.add(d.url))
  }

  private async discoverViaButtonText(
    page:       Page,
    startUrl:   string,
    candidates: Set<string>,
    elements:   ElementDefinition[],
  ): Promise<{ url: string; trigger: string }[]> {
    const discovered: { url: string; trigger: string }[] = []

    try {
      try {
        const burgerBtn = page.locator('#react-burger-menu-btn, .bm-burger-button button')
        if (await burgerBtn.count() > 0) {
          await burgerBtn.first().click({ timeout: 2000 })
          await page.waitForTimeout(800)
        }
      } catch {}

      const count = await page.locator(BUTTON_TEXT_SELECTOR).count()

      for (let i = 0; i < count; i++) {
        try {
          const btn = page.locator(BUTTON_TEXT_SELECTOR).nth(i)
          const text = await btn.textContent().catch(() => '')
          if (!text) continue

          const isNavButton = NAV_TEXT_PATTERNS.some(p => p.test(text))
          const isMutating  = MUTATING_TEXT_PATTERNS.some(p => p.test(text))
          if (!isNavButton || isMutating) continue

          const trigger = await this.matchClickedElement(btn, elements) ?? BUTTON_TEXT_SELECTOR

          const urlBefore = normalizeUrl(page.url())
          await btn.click({ timeout: 3000 })
          await page.waitForTimeout(600)
          const urlAfter = normalizeUrl(page.url())

          if (urlAfter !== urlBefore &&
              isSameOrigin(urlAfter, this.config.baseUrl) &&
              !isDenied(urlAfter) &&
              !candidates.has(urlAfter)) {
            discovered.push({ url: urlAfter, trigger })
            candidates.add(urlAfter)
          }

          if (normalizeUrl(page.url()) !== normalizeUrl(startUrl)) {
            await page.goto(startUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            }).catch(() => {})
            await page.waitForTimeout(1200)
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn(`[SPAStrategy] Button discovery failed: ${e.message}`)
    }

    const seen = new Set<string>()
    return discovered.filter(d => !seen.has(d.url) && seen.add(d.url))
  }
}
