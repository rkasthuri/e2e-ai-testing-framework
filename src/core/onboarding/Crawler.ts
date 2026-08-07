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

import { chromium, Browser }   from '@playwright/test'
import * as path               from 'path'
import * as crypto             from 'crypto'
import {
  OnboardingConfig, RoleConfig, RoleCrawlResult,
  PageDiscovery, StateGraph, StateEdge, PageNode,
  AiBudgetTracker, AppModel, AppModelCandidate, RoleDefinition, PageDefinition, FlowStep, CrawlDiagnostic,
  AuthenticationStageDiagnostic,
} from './types'
import { FlowDetector }        from './FlowDetector'
import { ApiSpecCrawler }      from './ApiSpecCrawler'
import { AuthManager, summarizeAuthenticationStages } from './AuthManager'
import { StrategyDetector }    from './StrategyDetector'
import { BFSStrategy }         from './BFSStrategy'
import { SPAStrategy }         from './SPAStrategy'
import { HybridStrategy }      from './HybridStrategy'
import { SelfCorrectionEngine } from './SelfCorrectionEngine'
import { ExplorationMap, createExplorationMap, isDiscovered } from './PageExplorationRecord'
import { normalizeUrl, isDenied, isSameOrigin } from './PageVisitor'
import {
  DEFAULT_AI_BUDGET, namingBudget, flowBudget, makeBudgetTracker,
} from '../config/budgetDefaults'

/**
 * TD-131: register SIGINT/SIGTERM handlers that close the browser, then exit —
 * so a Ctrl-C'd or terminated crawl doesn't orphan Chromium. Returns an
 * unregister function; call it in the finally that closes the browser to avoid
 * listener leaks across multiple crawls. SIGKILL cannot be trapped, so those
 * orphans are unavoidable here (prevention beats cure — TD-131 triage).
 */
export function registerBrowserCleanup(browser: Browser): () => void {
  const handler = () => {
    console.warn('\n[FORGE Crawler] Signal received — closing browser and exiting.')
    void browser.close().catch(() => {}).finally(() => process.exit(130))
  }
  process.once('SIGINT', handler)
  process.once('SIGTERM', handler)
  return () => {
    process.removeListener('SIGINT', handler)
    process.removeListener('SIGTERM', handler)
  }
}

export class Crawler {

  // TD-132: Pool A is split into a naming tracker (element classification,
  // per-page, dominant) and a reserved flow tracker (FlowDetector). Naming can
  // no longer starve flow enrichment — they draw from separate pools.
  private namingTracker: AiBudgetTracker
  private flowTracker:   AiBudgetTracker
  private totalAiBudget: number
  // pagesSkipped intentionally NOT tracked as a field: the frontier is not yet
  // instrumented, so the honest value is null ("not measured"), never 0. The real
  // count + a 'crawled-partial' coverage state is TD-UI-054 (A2). Emitting 0 here
  // would assert "measured, none skipped" — a claim FORGE cannot make today.
  /** TD-121: where auth storage state persists; threaded to AuthManager + recorded in the model. Default = cwd `.auth`. */
  private authStateDir: string
  /** TD-131: headless by default ("FORGE is invisible"); --headed opts in for anti-bot sites / visual debugging. */
  private headed: boolean
  /** TD-181: previous runtime truth is injected from SQLite, never loaded from JSON. */
  private previousModel: AppModel | null

  constructor(
    private config: OnboardingConfig,
    opts: { authStateDir?: string; headed?: boolean; previousModel?: AppModel | null } = {},
  ) {
    this.authStateDir = opts.authStateDir ?? path.resolve('.auth')
    this.headed       = opts.headed       ?? false
    this.previousModel = opts.previousModel ?? null
    // TD-132: total Pool A budget → naming + reserved flow. runId/appName are
    // bound at crawl() start (FIX TD-run_id + TD-028), same as before.
    const totalAi = config.budgets?.aiCalls ?? DEFAULT_AI_BUDGET
    this.totalAiBudget = totalAi
    this.namingTracker = makeBudgetTracker(namingBudget(totalAi))
    this.flowTracker   = makeBudgetTracker(flowBudget(totalAi))
  }

  async crawl(): Promise<AppModelCandidate> {
    // ── Strategy branch — delegate non-UI types before any browser launch ──────
    if (this.config.appType === 'rest-api' || this.config.appType === 'graphql-api') {
      const apiCrawler = new ApiSpecCrawler(this.config, { previousModel: this.previousModel })
      return await apiCrawler.crawl()
    }

    const stubTypes = ['mobile-android', 'mobile-ios', 'iot', 'cloud', 'data']
    if (this.config.appType && stubTypes.includes(this.config.appType)) {
      console.log(`[Crawler] App type '${this.config.appType}' not yet supported — returning Placeholder Model`)
      // Placeholder candidate — valid evidence with no pre-allocated version.
      // The caller commits it through the SQLite authority service.
      return this.buildStubModel()
    }

    // ── UI crawl — strategy-based ──────────────────────────────────────────────
    const startTime = Date.now()

    // FIX TD-run_id + TD-028: generate runId once for this crawl session and
    // bind both runId and appName onto the shared budget object so every aiCall
    // site downstream (ElementClassifier, FlowDetector) picks them up without
    // requiring signature changes on every strategy class.
    const runId = crypto.randomUUID()
    this.namingTracker.runId   = runId
    this.namingTracker.appName = this.config.app.name
    this.flowTracker.runId     = runId
    this.flowTracker.appName   = this.config.app.name
    console.log(`[FORGE Crawler] Run ID: ${runId} | App: ${this.config.app.name}`)

    const crawlConfig = {
      baseUrl:  this.config.app.baseUrl,
      maxPages: this.config.budgets?.maxPages ?? 50,
      maxDepth: this.config.budgets?.maxDepth ?? 5,
    }
    console.log(
      `[FORGE Crawler] Starting crawl of ${this.config.app.baseUrl} | ` +
      `Budget: pages=${crawlConfig.maxPages} depth=${crawlConfig.maxDepth} ` +
      `ai=${this.totalAiBudget} (naming=${namingBudget(this.totalAiBudget)}, flow=${flowBudget(this.totalAiBudget)})`
    )

    const browser    = await chromium.launch({
      headless: !this.headed,   // TD-131: headless default; --headed to opt in
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    })
    // TD-131: close the browser on Ctrl-C / termination — otherwise a killed
    // crawl orphans Chromium (SIGKILL can't be trapped; this covers the
    // graceful signals). Unregistered in the finally that closes the browser.
    const unregisterSignals = registerBrowserCleanup(browser)
    const roleCrawls: RoleCrawlResult[] = []
    // TD-064 FC-004b: per-role OBSERVED auth outcome, keyed by role.id. Declared in the
    // crawl-loop scope so it survives to the mergeRoleCrawls call — failed roles `continue`
    // out of the loop, so their outcome must be recorded BEFORE the continue below.
    const roleAuthOutcomes: Record<string, 'succeeded' | 'failed' | 'unknown'> = {}
    const roleAuthenticationStages: Record<string, AuthenticationStageDiagnostic[]> = {}
    const authenticationCrawlDiagnostics: CrawlDiagnostic[] = []
    // successUrl fix: per-role OBSERVED post-auth landing URL (AuthManager's real
    // startUrl) — recorded only on auth SUCCESS. Direct observation, not a guess;
    // consumed by FixtureGenerator when no explicit successUrl is configured.
    const rolePostAuthUrls: Record<string, string> = {}
    // TD-UI-031 Block 4: the start-page zero-clickables signal (site #1) — captured
    // from the FIRST role that reaches the start page, previously discarded.
    let startPageSignal: { realLinks: number | null; jsClickables: number | null; startUrl: string } | null = null

    try {
      for (const role of this.config.roles) {
        console.log(`[FORGE Crawler] Role: ${role.id} — authenticating...`)

        // 1. Authenticate — get context + real post-auth startUrl
        const authResult = await new AuthManager(this.config, { authStateDir: this.authStateDir }).authenticate(role, browser)
        const { context, startUrl, authenticated } = authResult
        roleAuthenticationStages[role.id] = authResult.authenticationStages

        // TD-064 FC-004b: record the OBSERVED auth outcome from the real `authenticated`
        // flag + authFlow (NEVER from reachablePageIds). Recorded here so the FAILED branch
        // below captures it BEFORE `continue` drops the role from the crawl loop.
        const outcome: 'succeeded' | 'failed' | 'unknown' =
            role.authFlow === 'none' ? 'succeeded'   // guest: no auth needed
          : authenticated            ? 'succeeded'
          :                            'failed'
        roleAuthOutcomes[role.id] = outcome
        // Record the observed landing URL only when auth actually succeeded via a
        // real login (guest roles never navigated through an auth flow).
        if (authenticated && role.authFlow !== 'none') {
          rolePostAuthUrls[role.id] = startUrl
        }

        if (!authenticated && role.authFlow !== 'none') {
          const postSubmit = authResult.authenticationStages.find(
            stage => stage.stage === 'post-submit-login-surface-evaluation',
          )
          authenticationCrawlDiagnostics.push({
            scope: 'role',
            target: role.id,
            reason: 'auth-failed',
            detail: summarizeAuthenticationStages(authResult.authenticationStages),
            remedy: postSubmit?.loginSurfaceRetained === true
              ? {
                  tier: 2,
                  action: 'Review target-side authentication acceptance, policy, and anti-automation evidence before another observation; credential resolution alone does not establish acceptance.',
                }
              : {
                  tier: 2,
                  action: 'Review the failed authentication stage and onboarding selector strategy before another observation.',
                },
          })
          // Keep the operational line structural: stage identity and outcome are
          // sufficient to explain the skip without emitting URLs, selector text,
          // field values, or credential material.
          console.warn(`[FORGE Crawler] auth-failed: role=${role.id} authFlow=${role.authFlow} authenticated=false deepestStage=${postSubmit?.stage ?? 'not-established'}; skipping role`)
          await context.close()
          continue
        }

        // 2. Detect crawl strategy from the start page
        const detectorPage = await context.newPage()
        let crawlMode = 'bfs'
        try {
          await detectorPage.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const configCrawlMode = (this.config as any).crawlMode
          // TD-UI-031 Block 4: capture realLinks/jsClickables (site #1) instead of
          // discarding them — feeds a zero-clickables diagnostic when the crawl is empty.
          const sig = await new StrategyDetector().detectWithSignals(detectorPage, configCrawlMode)
          crawlMode = sig.mode
          if (!startPageSignal) startPageSignal = { realLinks: sig.realLinks, jsClickables: sig.jsClickables, startUrl }
        } catch {
          crawlMode = 'bfs'
        } finally {
          await detectorPage.close()
        }

        console.log(
          `[FORGE Crawler] Role: ${role.id} | Mode: ${crawlMode} | Start: ${startUrl}`
        )

        // 3. Run appropriate strategy — TD-124: explorationMap replaces the
        //    overloaded `visited: Set<string>` (discovered/classified/swept).
        const explorationMap = createExplorationMap()
        let pages: PageDiscovery[] = []
        let spaStrategy: SPAStrategy | undefined

        if (crawlMode === 'bfs') {
          pages = await new BFSStrategy(crawlConfig, this.namingTracker)
            .crawl(context, startUrl, explorationMap, crawlConfig.maxPages)
        } else if (crawlMode === 'spa') {
          spaStrategy = new SPAStrategy(crawlConfig, this.namingTracker)
          pages = await spaStrategy.crawl(context, startUrl, explorationMap, crawlConfig.maxPages)
        } else {
          pages = await new HybridStrategy(crawlConfig, this.namingTracker)
            .crawl(context, startUrl, explorationMap, crawlConfig.maxPages)
        }

        pages = await new SelfCorrectionEngine().evaluate(
          pages, context, startUrl, crawlConfig, this.namingTracker, crawlMode as any, explorationMap
        )

        // Build state edges from discovered URLs for FlowDetector.
        const stateEdges = this.buildRoleStateEdges(
          pages, explorationMap, crawlMode, role.id, spaStrategy?.discoveredEdges
        )

        roleCrawls.push({
          roleId:       role.id,
          pages,
          stateEdges,
          pagesSkipped: null,   // not measured (frontier not instrumented) — TD-UI-054
        })

        console.log(
          `[FORGE Crawler] Role: ${role.id} | Complete | ${pages.length} pages`
        )

        await context.close()
      }
    } finally {
      unregisterSignals()
      await browser.close()
    }

    const { pages, roles } = this.mergeRoleCrawls(
      roleCrawls,
      roleAuthOutcomes,
      rolePostAuthUrls,
      roleAuthenticationStages,
    )
    this.applyPagePrerequisites(pages)
    this.deduplicateSharedElements(pages)
    const stateGraph       = this.buildStateGraph(roleCrawls)

    const detector = new FlowDetector(
      stateGraph, pages, roles, this.config, this.flowTracker
    )
    const flows = await detector.detectFlows()

    // TD-UI-031 Block 4 (ADR-016): an empty crawl carries an honest diagnostic +
    // remedy, built ONLY from signals FORGE actually computed. If neither known
    // condition holds, crawlDiagnostics stays empty → null: FORGE does not claim
    // to know why the crawl came back empty.
    const crawlDiagnostics: CrawlDiagnostic[] = [...authenticationCrawlDiagnostics]
    if (pages.length === 0) {
      if (this.config.roles.length === 0 && this.config.unmetAuth) {
        // Instance (iv): auth required, no credentials → no role was crawlable,
        // the start page was never visited. 'auth-required' (never tried), NOT
        // 'auth-failed' (tried and rejected).
        const at      = this.config.unmetAuth.authType
        const envBase = this.config.app.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
        crawlDiagnostics.push({
          scope:  'role',
          target: this.config.app.name,
          reason: 'auth-required',
          detail: `${this.config.app.name} requires ${at} but no credentials were supplied; no role was crawlable and the start page was never visited.`,
          remedy: { tier: 2, action: `Set ${envBase}_USERNAME and ${envBase}_PASSWORD, then re-crawl.` },
        })
      } else if (startPageSignal && startPageSignal.realLinks === 0 && startPageSignal.jsClickables === 0) {
        // Site #1: a role DID reach the start page, but it exposed nothing navigable.
        crawlDiagnostics.push({
          scope:  'start-page',
          target: startPageSignal.startUrl,
          reason: 'zero-clickables',
          detail: `The start page exposed 0 navigable links and 0 JS clickables — likely a login wall or an unrendered SPA.`,
          remedy: { tier: 1, action: `Let FORGE attempt agentic exploration of the start page; if it stays empty, provide credentials and re-crawl.` },
        })
      }
    }

    const model = this.buildModel(pages, roles, flows, startTime, crawlDiagnostics)

    // TD-132: report both pools honestly (used/limit). Naming exhaustion is the
    // DEGRADED trigger (the dominant, page-scaling pool); flow is reported so
    // its reserve is visible even when naming is fine.
    const namingLimit = namingBudget(this.totalAiBudget)
    const flowLimit   = flowBudget(this.totalAiBudget)
    console.log(`════════════════════════════════════════════════════════`)
    console.log(
      `[FORGE Crawler] AI Budget — Naming: ${namingLimit - this.namingTracker.remaining}/${namingLimit} used | ` +
      `Flow: ${flowLimit - this.flowTracker.remaining}/${flowLimit} used`
    )
    console.log(
      model.app.crawlMetadata?.aiBudgetStatus === 'degraded'
        ? `[FORGE Crawler] BUDGET STATUS: DEGRADED — naming AI budget exhausted before ` +
          `crawl finished at maxDepth=${crawlConfig.maxDepth}. Some element ` +
          `names may have used fallback naming instead of AI naming.`
        : `[FORGE Crawler] BUDGET STATUS: WITHIN BUDGET — crawl completed at ` +
          `maxDepth=${crawlConfig.maxDepth} without exhausting the naming budget.`
    )
    console.log(`════════════════════════════════════════════════════════`)

    // TD-181: no internal persistence Ã¢â‚¬â€ the candidate is returned to the
    // caller, which commits through AppModelService before JSON projection.
    return model
  }

  // TD-027 (both halves) / TD-026 -- builds real fromUrl->toUrl relationships
  // instead of visit-order proximity, per crawl mode:
  //  - bfs: edges from each page's recorded outboundUrls (PageVisitor.
  //    extractLinks(), a real <a href> relationship). trigger stays the
  //    literal 'navigation' string -- BFS's discovery never identifies a
  //    triggering element, only a link.
  //  - spa: edges from SPAStrategy.discoveredEdges (the merged classify-then-
  //    discover pass's real click relationships -- see
  //    SPA-Discovery-Merge-Implementation-Brief.md), filtered to targets
  //    that were actually visited. trigger is a real ElementDefinition.id
  //    when discovery matched one, or the literal selector string used to
  //    find the element otherwise -- never 'navigation'.
  //  - hybrid (and spa without discoveredEdges, defensive fallback): visit-
  //    order pairs, unchanged -- on hold pending the separate Hybrid-mode
  //    per-strategy-attribution design work (item 4 of the same brief; see
  //    TD-037 for a related gap flagged during that design pass).
  //
  // BFS branch relies on pages[i] corresponding to the i-th DISCOVERED url
  // (TD-124: `discoveredArr` below is the discovered-only, insertion-ordered
  // list), which holds for a pure bfs run (markDiscovered runs immediately
  // before each pages.push, no gaps; sweep-only entries are excluded). Doesn't
  // hold as reliably if SelfCorrectionEngine escalates a bfs run to hybrid
  // mid-role -- out of scope for the BFS fix; flagged rather than handled.
  private buildRoleStateEdges(
    pages:          PageDiscovery[],
    explorationMap: ExplorationMap,
    crawlMode:      string,
    roleId:         string,
    spaEdges?:      { fromUrl: string; toUrl: string; trigger: string }[],
  ): StateEdge[] {
    const stateEdges: StateEdge[] = []
    // TD-124 (ruling A): the ORDERED, pages[]-aligned list is the DISCOVERED
    // urls in insertion order — NOT every explorationMap key. Sweep-only
    // entries (discovered:false... rather, swept-without-new-discovery) never
    // push to pages[], so including them would break the positional zip
    // pages[i] ↔ url[i] below. Every discovered url was markDiscovered'd
    // immediately before its pages.push (BFS and SPA both), so this stays 1:1.
    const discoveredArr = [...explorationMap].filter(([, r]) => r.discovered).map(([u]) => u)

    if (crawlMode === 'spa' && spaEdges) {
      for (const e of spaEdges) {
        if (isDiscovered(explorationMap, e.toUrl)) {
          stateEdges.push({ fromUrl: e.fromUrl, toUrl: e.toUrl, trigger: e.trigger, roleId })
        }
      }
      return stateEdges
    }

    // TD-UI-041: hybrid / spa-without-edges. This previously emitted visit-ORDER
    // proximity edges (discoveredArr[i] -> [i+1]) stamped 'navigation' — a
    // FABRICATED navigation FORGE never made, with no href to ground it. Proximity
    // is not evidence of navigability. Emit NO edge: FORGE has no observed evidence
    // of how these pages connect and says so (empty), rather than inventing adjacency.
    if (crawlMode !== 'bfs') {
      return stateEdges   // empty — honest absence
    }

    const outboundByUrl = new Map(
      discoveredArr.map((url, i) => [url, pages[i]?.outboundUrls ?? []] as const)
    )
    // TD-UI-041 nav-edge JOIN: pages[i].elements holds the classified anchors with
    // their resolved-absolute href (ElementClassifier). The edge is built from the
    // SAME a[href] set (outboundUrls), so joining element.href <-> edge target
    // recovers the real clicked-element id.
    const elementsByUrl = new Map(
      discoveredArr.map((url, i) => [url, pages[i]?.elements ?? []] as const)
    )
    for (const fromUrl of discoveredArr) {
      const fromElements = elementsByUrl.get(fromUrl) ?? []
      const targets = new Set<string>()
      for (const rawToUrl of outboundByUrl.get(fromUrl) ?? []) {
        const toUrl = normalizeUrl(rawToUrl)
        if (toUrl !== fromUrl && isDiscovered(explorationMap, toUrl)) targets.add(toUrl)
      }
      for (const toUrl of targets) {
        // Join by resolved href (normalize BOTH sides). On MISS, trigger is null —
        // FlowDetector's `|| null` yields elementId: null. NEVER the magic string
        // 'navigation' (VerificationRunner:658 would use it as a bogus selector).
        // NOTE: BFS goto's the href, it does NOT click the anchor — this is an
        // href-derived edge, not a click-observed one; the anchor and target are
        // both real, which is why the edge still qualifies as grounding:'observed'.
        const match = fromElements.find(e => e.href != null && normalizeUrl(e.href) === toUrl)
        stateEdges.push({ fromUrl, toUrl, trigger: match ? match.id : null, roleId })
      }
    }
    return stateEdges
  }

  private mergeRoleCrawls(
    roleCrawls: RoleCrawlResult[],
    roleAuthOutcomes: Record<string, 'succeeded' | 'failed' | 'unknown'>,
    rolePostAuthUrls: Record<string, string> = {},
    roleAuthenticationStages: Record<string, AuthenticationStageDiagnostic[]> = {},
  ): {
    pages: PageDefinition[]
    roles: RoleDefinition[]
  } {
    const pageMap = new Map<string, PageDefinition>()

    for (const crawl of roleCrawls) {
      for (const discovery of crawl.pages) {
        if (!pageMap.has(discovery.pageId)) {
          pageMap.set(discovery.pageId, {
            id:               discovery.pageId,
            displayName:      this.toDisplayName(discovery.pageId),
            urlPattern:       discovery.urlPattern,
            urlPatternType:   'exact',
            fingerprint:      discovery.domHash,
            fingerprintBasis: 'url-only',
            appType:          this.config.app.appType,
            accessibleByRoles: [crawl.roleId],
            isAuthPage:       discovery.isAuthPage,
            elements:         discovery.elements,
          })
        } else {
          const existing = pageMap.get(discovery.pageId)!
          if (!existing.accessibleByRoles.includes(crawl.roleId)) {
            existing.accessibleByRoles.push(crawl.roleId)
          }
        }
      }
    }

    const roles: RoleDefinition[] = this.config.roles.map(r => {
      const reachable  = roleCrawls
        .find(c => c.roleId === r.id)
        ?.pages.map(p => p.pageId) || []
      const allPageIds = Array.from(pageMap.keys())
      const restricted = allPageIds.filter(id => !reachable.includes(id))

      return {
        id:                r.id,
        displayName:       r.displayName,
        authFlow:          r.authFlow,
        credentialsEnvKey: r.credentialsEnvKey || null,
        // TD-121 (finding B): record the REAL storage-state location, not a
        // hardcoded '.auth/...' string. Normalized relative-to-cwd so fixture
        // models stay byte-identical ('.auth/<role>.json') and workspace models
        // stay portable ('.forge/auth/<role>.json') — never an absolute path.
        storageStatePath:  r.authFlow !== 'none'
          ? path.relative(process.cwd(), path.join(this.authStateDir, `${r.id}.json`)).replace(/\\/g, '/')
          : null,
        reachablePageIds:  reachable,
        restrictedPageIds: restricted,
        // TD-064 FC-004b: observed auth outcome (set from the crawl-loop flag, NOT derived
        // here from reachablePageIds). '?? unknown' is a defensive default for a role somehow
        // absent from the map — should not happen.
        authOutcome:       roleAuthOutcomes[r.id] ?? 'unknown',
        ...(roleAuthenticationStages[r.id]
          ? { authenticationStages: roleAuthenticationStages[r.id] }
          : {}),
        // successUrl fix: the observed landing URL, when auth succeeded (else absent).
        ...(rolePostAuthUrls[r.id] ? { observedPostAuthUrl: rolePostAuthUrls[r.id] } : {}),
      }
    })

    return { pages: Array.from(pageMap.values()), roles }
  }

  // Compiles config-declared pagePrerequisites (TD-013) onto their matching
  // PageDefinition — same pattern FlowDetector.mergeConfigSeeded() already
  // uses to turn app-specific config hints into real, executable FlowSteps.
  // Keeps VerificationRunner app-agnostic: it only ever executes steps it's
  // handed, it never knows "cart" or "add-to-cart" are SauceDemo concepts.
  private applyPagePrerequisites(pages: PageDefinition[]): void {
    for (const hint of this.config.pagePrerequisites ?? []) {
      const page = pages.find(p => p.id === hint.pageId)
      if (!page) {
        console.warn(
          `[Crawler] pagePrerequisites references unknown pageId "${hint.pageId}" — skipping`
        )
        continue
      }
      const steps: FlowStep[] = hint.steps.map((s, i) => ({
        stepIndex:    i + 1,
        pageId:       s.pageId ?? hint.pageId,
        action:       s.action,
        elementId:    s.elementId ?? null,
        targetPageId: null,
        value:        s.value ?? null,
      }))
      page.prerequisites = [
        ...(page.prerequisites ?? []),
        {
          // roleId is optional. Omit it when the app-agnostic prerequisite
          // applies to every role; never materialize an undefined value.
          ...(hint.roleId ? { roleId: hint.roleId } : {}),
          steps,
        },
      ]
    }
  }

  // TD-032 Step 2 — ElementClassifier.determineCritical()'s Rule 2 (accessible
  // name + interactive tag/role) correctly flags real, page-independent
  // navigation/header/footer shell elements as critical, but each occurrence
  // is classified per-page with no visibility into other pages, so a shared
  // nav link appearing on every page in the app gets counted as critical once
  // per page — confirmed live on OrangeHRM: the same ~14 sidebar/header links
  // inflated critical-element % across all 30 pages. This pass runs after all
  // pages are merged (the first point where a cross-page view exists) and
  // marks every occurrence after the first with `sharedElementOf`, pointing at
  // the canonical (first-seen) occurrence — never deletes or hides the
  // element from its own page's list, so nothing silently disappears.
  //
  // Dedup key: label + kind + resolved href, and ONLY for kind === 'link'
  // elements with a non-null href. Deliberately app-agnostic, not an
  // OrangeHRM-specific rule: a browser-resolved absolute href is a verifiable,
  // page-independent identity signal on any site. Buttons/role-based controls
  // without an href are NOT deduped here — a generic label like "Add" or
  // "Search" recurring across pages is common in enterprise UIs and is NOT
  // reliably the same control; merging those by label alone would risk
  // silently conflating semantically different elements. Known, accepted
  // limitation: non-href shared controls (e.g. a button-styled "Upgrade" CTA)
  // are not deduped by this pass.
  private deduplicateSharedElements(pages: PageDefinition[]): void {
    const seen = new Map<string, string>() // dedup key -> canonical element id

    for (const page of pages) {
      for (const el of page.elements) {
        if (el.kind !== 'link' || !el.href) continue

        const key = `${el.label}|${el.kind}|${el.href}`
        const canonicalId = seen.get(key)

        if (!canonicalId) {
          seen.set(key, el.id)
          continue
        }
        el.sharedElementOf = canonicalId
      }
    }
  }

  private buildStateGraph(roleCrawls: RoleCrawlResult[]): StateGraph {
    const nodes = new Map<string, PageNode>()
    const edges: StateEdge[] = []

    for (const crawl of roleCrawls) {
      for (const page of crawl.pages) {
        const existing = nodes.get(page.pageId)
        if (existing) {
          existing.visitCount++
          if (!existing.roleIds.includes(crawl.roleId)) {
            existing.roleIds.push(crawl.roleId)
          }
        } else {
          nodes.set(page.pageId, {
            urlPattern: page.urlPattern,
            visitCount: 1,
            roleIds:    [crawl.roleId],
            domHash:    page.domHash,
          })
        }
      }
      edges.push(...crawl.stateEdges)
    }

    return { nodes, edges }
  }

  private buildModel(
    pages:     PageDefinition[],
    roles:     RoleDefinition[],
    flows:     any[],
    startTime: number,
    crawlDiagnostics: CrawlDiagnostic[] = [],
  ): AppModelCandidate {
    const existing = this.previousModel
    return {
      schemaVersion: '2.0',
      generatedAt:   new Date().toISOString(),
      generatedBy:   'engine',   // Crawl-LIEs: the algorithmic engine produced this model, never 'human'
      app: {
        name:             this.config.app.name,
        displayName:      this.toDisplayName(this.config.app.name),
        baseUrl:          this.config.app.baseUrl,
        appType:          this.config.app.appType,
        spaConfig:        null,
        // TD-UI-031: evidenceState derived AT THE SOURCE from observed content.
        // A crawl ran either way (crawlMetadata non-null); pages.length decides
        // whether it FOUND anything. crawled-empty is a diagnostic result, not a
        // failure — Block 4 wires the first real crawlDiagnostic here.
        evidenceState:    pages.length > 0 ? 'crawled' : 'crawled-empty',
        crawlMetadata: {
          crawlConfigHash:  this.hashConfig(),
          crawledAt:        new Date().toISOString(),
          crawledBy:        'engine',   // Crawl-LIEs: an algorithmic crawl, never 'human'
          crawlDurationMs:  Date.now() - startTime,
          pagesBudget:      this.config.budgets?.maxPages ?? 50,
          pagesDiscovered:  pages.length,
          pagesSkipped:     null,        // not measured (frontier not instrumented) — TD-UI-054; NOT 0
          // ADR-018 weakest-truth: EITHER pool exhausted → the crawl ran degraded.
          // Naming-only was flow-blind (a flow-exhausted crawl read within-budget).
          aiBudgetStatus:   (this.namingTracker.isExhausted() || this.flowTracker.isExhausted()) ? 'degraded' : 'within-budget',
          crawlDiagnostics: crawlDiagnostics.length ? crawlDiagnostics : null,
        },
      },
      roles,
      pages,
      flows,
      endpoints: null,
      api:  null,
      diff: existing
        ? {
            previousModelVersion:  existing.app.modelVersion,
            diffGeneratedAt:       new Date().toISOString(),
            pagesAdded:    pages
              .filter(p => !(existing.pages ?? []).find((ep: any) => ep.id === p.id))
              .map(p => p.id),
            pagesRemoved:  (existing.pages ?? [])
              .filter((ep: any) => !pages.find(p => p.id === ep.id))
              .map((ep: any) => ep.id),
            // null = NOT DIFFED (these six were never computed). [] would assert
            // "diffed, none changed" — the lie (ADR-015). pagesAdded/pagesRemoved
            // above ARE computed. TD-UI-054 may compute these for real later.
            pagesModified:          null,
            elementsAdded:          null,
            elementsRemoved:        null,
            strategiesInvalidated:  null,
            flowsAdded:             null,
            flowsRemoved:           null,
          }
        : null,
    }
  }

  private buildStubModel(): AppModelCandidate {
    const appType = this.config.appType || this.config.app.appType
    return {
      schemaVersion: '2.0',
      generatedAt:   new Date().toISOString(),
      // Crawl-LIEs: the algorithmic engine emitted this placeholder; 'agent' asserted
      // an LLM loop that never ran. (Stub-ness is marked by evidenceState:'unsupported-platform'
      // + crawlMetadata:null, NOT by generatedBy.)
      generatedBy:   'engine',
      app: {
        name:             this.config.app.name,
        displayName:      this.config.app.name,
        baseUrl:          this.config.app.baseUrl,
        appType,
        spaConfig:        null,
        // TD-UI-031: FORGE cannot crawl this platform — no crawl executed, so
        // crawlMetadata is null (ADR-015: reaching for .crawledAt is a type error,
        // not a fabricated timestamp). A genuinely different fact from crawled-empty.
        evidenceState:    'unsupported-platform',
        crawlMetadata:    null,
      },
      roles:     [],
      pages:     null,
      flows:     null,
      endpoints: null,
      api:       null,
      diff:      null,
    }
  }

  private resolveCredentials(
    role: RoleConfig
  ): { username: string; password: string } | null {
    if (!role.credentialsEnvKey) return null
    const raw = process.env[role.credentialsEnvKey]
    if (!raw) return null
    const [username, password] = raw.split(':')
    return username && password ? { username, password } : null
  }

  private urlToPageId(url: string): string {
    try {
      const pathname = new URL(url, this.config.app.baseUrl).pathname
      return pathname
        .replace(/^\//, '')
        .replace(/\.html$/, '')
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+$/, '')
        || 'home'
    } catch {
      return 'unknown'
    }
  }

  private toDisplayName(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  private hashConfig(): string {
    const str = JSON.stringify(this.config)
    return 'sha256:' + crypto
      .createHash('sha256')
      .update(str)
      .digest('hex')
      .slice(0, 16)
  }
}
