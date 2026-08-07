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

import {
  StateGraph, StateEdge, FlowDefinition, FlowStep, FlowCandidate, FlowConfidence,
  PageDefinition, RoleDefinition, OnboardingConfig,
  AiBudgetTracker, EndpointDefinition
} from './types'
import { aiCall }      from '../ai/AiClient'
import { AiResponse }  from '../types/ai'
import { getAppName }  from '../config/appConfig'

export class FlowDetector {

  constructor(
    private stateGraph:    StateGraph,
    private pages:         PageDefinition[],
    private roles:         RoleDefinition[],
    private config:        OnboardingConfig,
    private budget:        AiBudgetTracker,
    private apiEndpoints?: EndpointDefinition[]
  ) {}

  async detectFlows(): Promise<FlowDefinition[]> {
    // ── API branch — detect flows from endpoint definitions ─────────────────
    if (this.config.appType === 'rest-api' || this.config.appType === 'graphql-api') {
      const endpoints = this.apiEndpoints || this.config.apiEndpoints || []
      return this.detectApiFlows(endpoints)
    }
    // ── UI branch — existing graph-based flow detection ───────────────────────
    const configFlows = this.mergeConfigSeeded()
    // If config-seeded flows exist for this app type, skip inferred flows —
    // they are low quality for SPAs and add noise over explicit config hints
    const hasConfigFlows = configFlows.length > 0
    // TD-170 (ADR-021 overclaim, PENDING its own design conversation — DO NOT re-point at
    // renderingModel, that relocates the defect): `isSpa` infers NAVIGATION ARCHITECTURE from
    // a platform value + page count, neither of which observes navigation. The real predicate
    // is "these inferred flows are weakly grounded" — deriveFlowConfidence already measures it.
    // Left UNCHANGED here (keyed off 'web-ui', which survives the TD-163 refactor) until TD-170.
    const isSpa = this.config.appType === 'web-ui' &&
      this.pages.length > 3  // more than a few pages = likely SPA
    let inferred: FlowDefinition[] = []
    let enriched: FlowDefinition[] = []
    if (!hasConfigFlows || !isSpa) {
      const candidates = this.identifyCandidates()
      inferred = candidates.map(c => this.candidateToFlow(c))
      enriched = await this.enrichWithAi(candidates)
    }
    const all = [...configFlows, ...inferred, ...enriched]
    return this.deduplicateFlows(all)
  }

  private detectApiFlows(endpoints: EndpointDefinition[]): FlowDefinition[] {
    const flows: FlowDefinition[] = []

    // Auth flow — endpoints containing /auth or token/auth in summary
    const authEps = endpoints.filter(
      e => /\/auth/i.test(e.path) || /token|auth/i.test(e.summary)
    )
    if (authEps.length > 0) {
      const steps: FlowStep[] = authEps.map((e, i) => ({
        stepIndex:    i + 1,
        pageId:       `${e.method} ${e.path}`,
        action:       'api-call',
        elementId:    null,
        targetPageId: null,
        value:        `${e.method} ${e.path}`,
      }))
      flows.push({
        id:                   'api-flow-auth',
        displayName:          'Authentication',
        confidence:           this.deriveFlowConfidence(steps, [], 'api'),
        source:               'inferred',
        roleId:               'api',
        steps,
        linkedApiEndpointIds: [],
      })
    }

    // CRUD flows — group endpoints by base path (strip /{id})
    const basePathMap = new Map<string, EndpointDefinition[]>()
    for (const ep of endpoints) {
      if (/\/auth/i.test(ep.path) || ep.path === '/ping') continue
      const base = ep.path
        .replace(/\/\{[^}]+\}$/, '')   // strip trailing /{id}
        .replace(/\/\{[^}]+\}/g, '')   // strip other path params
        || '/'
      const bucket = basePathMap.get(base) || []
      bucket.push(ep)
      basePathMap.set(base, bucket)
    }

    for (const [base, eps] of basePathMap) {
      const methods = new Set(eps.map(e => e.method))
      if (methods.size < 2) continue
      const resourceName = base.replace(/^\//, '') || 'resource'
      const capitalized  = resourceName.charAt(0).toUpperCase() + resourceName.slice(1)
      const methodOrder  = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      const sorted = [...eps].sort(
        (a, b) => methodOrder.indexOf(a.method) - methodOrder.indexOf(b.method)
      )
      const steps: FlowStep[] = sorted.map((e, i) => ({
        stepIndex:    i + 1,
        pageId:       `${e.method} ${e.path}`,
        action:       'api-call',
        elementId:    null,
        targetPageId: null,
        value:        `${e.method} ${e.path}`,
      }))
      flows.push({
        id:                   `api-flow-crud-${resourceName}`,
        displayName:          `${capitalized} CRUD`,
        confidence:           this.deriveFlowConfidence(steps, [], 'api'),
        source:               'inferred',
        roleId:               'api',
        steps,
        linkedApiEndpointIds: [],
      })
    }

    // Health flow — /ping or HealthCheck summary
    const healthEps = endpoints.filter(
      e => e.path === '/ping' || /health/i.test(e.summary)
    )
    if (healthEps.length > 0) {
      const steps: FlowStep[] = healthEps.map((e, i) => ({
        stepIndex:    i + 1,
        pageId:       `${e.method} ${e.path}`,
        action:       'api-call',
        elementId:    null,
        targetPageId: null,
        value:        `${e.method} ${e.path}`,
      }))
      flows.push({
        id:                   'api-flow-health',
        displayName:          'Health Check',
        confidence:           this.deriveFlowConfidence(steps, [], 'api'),
        source:               'inferred',
        roleId:               'api',
        steps,
        linkedApiEndpointIds: [],
      })
    }

    return flows
  }

  private identifyCandidates(): FlowCandidate[] {
    const candidates: FlowCandidate[] = []

    // Navigation flows — edges in state graph
    // (Login-step derivation removed — flows assume the role's fixture/AuthManager
    // equivalent has already authenticated before any flow runs. See TD-016/017/019.)
    for (const [roleId, edges] of this.groupEdgesByRole()) {
      if (edges.length < 2) continue
      const steps: FlowStep[] = edges.slice(0, 6).map((edge, i) => ({
        stepIndex:    i + 1,
        pageId:       this.urlToPageId(edge.fromUrl),
        action:       'click',
        elementId:    edge.trigger || null,
        targetPageId: this.urlToPageId(edge.toUrl),
        value:        null,
        // TD-UI-041: a joined edge (real element id) is observed; a missed join
        // (null trigger) is inferred. The EDGE relationship is real either way,
        // but the clicked element is only known when the href join landed.
        grounding:    (edge.trigger ? 'observed' : 'inferred') as 'observed' | 'inferred',
      }))
      candidates.push({ steps, confidence: this.deriveFlowConfidence(steps, [], 'inferred-nav'), roleId })
    }

    return candidates
  }

  // Shared by identifyCandidates() and enrichWithAi()'s TD-031 grounding —
  // a single source of truth for partitioning stateGraph.edges by role, so
  // a flow only ever gets grounded against its own role's real edges.
  private groupEdgesByRole(): Map<string, StateEdge[]> {
    const edgesByRole = new Map<string, StateEdge[]>()
    for (const edge of this.stateGraph.edges) {
      const bucket = edgesByRole.get(edge.roleId) || []
      bucket.push(edge)
      edgesByRole.set(edge.roleId, bucket)
    }
    return edgesByRole
  }

  private mergeConfigSeeded(): FlowDefinition[] {
    if (!this.config.flows) return []
    // Login-step derivation removed (TD-016/017/019) — flows assume the role's
    // fixture/AuthManager equivalent has already authenticated before any flow
    // runs, so compiled steps cover only the hint's post-login business intent.
    // `FlowHint` currently carries no structured step data beyond free-text
    // `hint`, and parsing that text into business steps is a separate design
    // problem (flagged, not built here — see TD-016 in TECH_DEBT.md). Until
    // that lands, config-seeded flows compile with no steps rather than wrong
    // ones.
    return this.config.flows.map(hint => {
      const steps: FlowStep[] = []
      return {
        id:                   hint.id,
        displayName:          hint.hint.slice(0, 80),
        confidence:           this.deriveFlowConfidence(steps, [], 'config-seeded'),
        source:               'config-seeded' as const,
        roleId:               hint.roleId,
        steps,
        linkedApiEndpointIds: [],
      }
    })
  }

  private candidateToFlow(candidate: FlowCandidate): FlowDefinition {
    const role = this.roles.find(r => r.id === candidate.roleId)
    return {
      id:                   `inferred-flow-${candidate.roleId}-${Date.now()}`,
      displayName:          `${role?.displayName || candidate.roleId} flow`,
      confidence:           candidate.confidence,
      source:               'inferred',
      roleId:               candidate.roleId,
      steps:                candidate.steps,
      linkedApiEndpointIds: [],
    }
  }

  private async enrichWithAi(
    candidates: FlowCandidate[]
  ): Promise<FlowDefinition[]> {
    if (candidates.length >= 3) return []
    // TD-132 (ruling D): flow enrichment has its own reserved budget now, but
    // if it is exhausted, say so — never skip silently (Rule 5).
    if (this.budget.isExhausted() || !this.budget.consume(1)) {
      console.warn('[FlowDetector] Flow-enrichment AI budget exhausted — skipping AI flow enrichment (rule-based flows only)')
      return []
    }

    const pageList = this.pages.map(p => ({
      id:       p.id,
      url:      p.urlPattern,
      isAuth:   p.isAuthPage,
      elements: p.elements.slice(0, 5).map(e => e.name),
    }))

    // FIX TD-028: read appName from budget (set from config in Crawler) instead of
    // getAppName() which was returning 'saucedemo' for OrangeHRM crawls.
    // FIX TD-run_id: read runId from budget for per-run cost attribution.
    const appName = this.budget.appName ?? getAppName()
    let response: AiResponse | undefined

    try {
      response = await aiCall({
        operation: 'flow-detect',
        appName,
        runId:     this.budget.runId,   // FIX TD-run_id
        messages:  [{
          role:    'user',
          content: `You are analyzing a web app for test automation.
Given these pages, identify the most important user flows to test.
Respond ONLY with JSON array:
[{"id":"flow-id","displayName":"Flow name","roleId":"standardUser","pageSequence":["pageId1","pageId2"]}]

Pages: ${JSON.stringify(pageList, null, 2)}
Known roles: ${this.roles.map(r => r.id).join(', ')}`,
        }],
        // TD-041 — real OrangeHRM (30 pages, our largest test app) usage
        // measured at 1120 output tokens for a complete, unparsed-by-
        // truncation response (12 flows). The previous 800 cut that
        // response off mid-JSON, which JSON.parse() below would then throw
        // on, silently discarding every proposed flow via the catch path.
        // 2500 gives ~2.2x headroom over the measured value for normal
        // call-to-call variance and apps larger than today's reference
        // set, without resorting to chunking -- chunking would mean the AI
        // only ever sees a subset of pages per call, which changes what
        // "the most important flows across the app" can even mean for a
        // flow spanning chunk boundaries. Revisit if a real app's
        // measured usage ever approaches this cap.
        maxTokens: 2500,
      })
    } catch (callErr: any) {
      console.warn(
        `[FlowDetector] AI enrichment failed for "${appName}" — the AI call itself threw: ` +
        `${callErr?.message || callErr}. Using heuristics only.`
      )
      return []
    }

    try {
      const clean  = response.content.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean) as any[]
      const edgesByRole = this.groupEdgesByRole()
      // TD-040 — the AI is told the known roles list in its own prompt but
      // doesn't reliably respect it (confirmed live: OrangeHRM has exactly
      // one role, adminUser, yet the AI proposed roleId: "standardUser" for
      // every flow). Validate against the same list before compiling, and
      // discard rather than remap a hallucinated roleId to a real one --
      // guessing which real role was "meant" is a different, riskier
      // behavior than this fix covers.
      const knownRoleIds = new Set(this.roles.map(r => r.id))
      return parsed
        .filter(f => {
          const roleId = f.roleId || 'standardUser'
          if (knownRoleIds.has(roleId)) return true
          console.warn(
            `[FlowDetector] Rejecting AI-proposed flow "${f.id}" for "${appName}" — ` +
            `roleId "${roleId}" is not in the known roles list (${[...knownRoleIds].join(', ') || '(none)'}). ` +
            `Discarding the flow, not remapping to a real role.`
          )
          return false
        })
        .map(f => this.compileAgentProposedFlow(f, edgesByRole))
    } catch (parseErr: any) {
      console.warn(
        `[FlowDetector] AI enrichment failed for "${appName}" — response did not parse as JSON ` +
        `(outputTokens: ${response.outputTokens}, inputTokens: ${response.inputTokens}, ` +
        `responseLength: ${response.content.length} chars). Using heuristics only. ` +
        `Parse error: ${parseErr?.message || parseErr}. ` +
        `Response preview: ${response.content.slice(0, 200)}${response.content.length > 200 ? '…' : ''}`
      )
      return []
    }
  }

  // TD-031 — the AI stays edge-blind: it only ever proposes a page-ID
  // sequence (pageSequence), never actions or elements. This compiles that
  // sequence by grounding each consecutive pair against this role's real,
  // crawled stateGraph.edges (via groupEdgesByRole() — never a different
  // role's edges). A direct edge -> a real 'click' step using the edge's
  // real trigger. No direct edge -> falls back to the pre-existing
  // assert-navigation/null shape, but the flow records which pair(s) fell
  // back via groundingWarnings (and logs each one) -- never a silent
  // fallback. No multi-hop pathfinding: the TD-031 investigation (real
  // crawls, both reference apps) found 0 of 25 real transitions needed
  // one -- every gap was a hard dead end, not "reachable but indirect" --
  // so a direct-edge-only lookup matches the actual data shape measured;
  // revisit if real data ever shows otherwise.
  private compileAgentProposedFlow(
    f: { id: string; displayName: string; roleId?: string; pageSequence?: string[] },
    edgesByRole: Map<string, StateEdge[]>,
  ): FlowDefinition {
    const roleId       = f.roleId || 'standardUser'
    const pageSequence = f.pageSequence || []
    const roleEdges    = edgesByRole.get(roleId) || []
    const edgeMap      = new Map<string, StateEdge>()
    for (const edge of roleEdges) {
      // Resolve against the real PageDefinition.id (the same id the AI's
      // pageSequence already uses, since it came from this same this.pages
      // list in the prompt) rather than this.urlToPageId() -- that helper
      // strips ".html" entirely instead of converting it to "-html" and so
      // disagrees with the real page id (TD-030: "inventory" vs the real
      // "inventory-html"). Scoped to this grounding lookup only --
      // identifyCandidates()'s existing this.urlToPageId() usage is
      // untouched, TD-030 itself remains open and unfixed.
      const fromId = this.resolveRealPageId(edge.fromUrl)
      const toId   = this.resolveRealPageId(edge.toUrl)
      if (fromId && toId) edgeMap.set(`${fromId}->${toId}`, edge)
    }

    const steps: FlowStep[] = []
    const groundingWarnings: string[] = []

    // A single-page sequence has no pair to ground -- preserve today's
    // existing single-step shape rather than producing an empty flow.
    if (pageSequence.length === 1) {
      steps.push({
        stepIndex:    1,
        pageId:       pageSequence[0],
        action:       'assert-navigation',
        elementId:    null,
        targetPageId: pageSequence[0],
        value:        this.pages.find(p => p.id === pageSequence[0])?.urlPattern || null,
        grounding:    'observed',   // TD-064 FC-002: on a crawled page — observed
      })
    }

    for (let i = 0; i < pageSequence.length - 1; i++) {
      const fromPid = pageSequence[i]
      const toPid   = pageSequence[i + 1]
      const edge    = edgeMap.get(`${fromPid}->${toPid}`)

      if (edge) {
        steps.push({
          stepIndex:    steps.length + 1,
          pageId:       fromPid,
          action:       'click',
          elementId:    edge.trigger,
          targetPageId: toPid,
          value:        null,
          grounding:    'observed',   // TD-064 FC-002: real crawled edge — observed
        })
      } else {
        const warning = `No real edge found for "${fromPid}" -> "${toPid}" under role "${roleId}" — compiled as assert-navigation only, not a real click.`
        console.warn(`[FlowDetector] ${warning}`)
        groundingWarnings.push(warning)
        steps.push({
          stepIndex:    steps.length + 1,
          pageId:       fromPid,
          action:       'assert-navigation',
          elementId:    null,
          targetPageId: toPid,
          value:        this.pages.find(p => p.id === toPid)?.urlPattern || null,
          grounding:    'inferred',   // TD-064 FC-002: no real edge — never observed
        })
      }
    }

    return {
      id:                   f.id,
      displayName:          f.displayName,
      confidence:           this.deriveFlowConfidence(steps, groundingWarnings, 'agent-proposed'),
      source:               'agent-proposed' as const,
      roleId,
      steps,
      linkedApiEndpointIds: [],
      ...(groundingWarnings.length > 0 ? { groundingWarnings } : {}),
    }
  }

  // Resolves a crawled edge's raw URL to the real PageDefinition.id, by
  // matching its pathname against this.pages[].urlPattern -- see the
  // TD-030 note at this method's call site for why this.urlToPageId()
  // isn't used here.
  private resolveRealPageId(url: string): string | null {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    return this.pages.find(p => p.urlPattern === path)?.id ?? null
  }

  /**
   * TD-066 — derive a flow's evidence-tier (FlowConfidence) from evidence
   * actually present on the flow. The audit proved no single formula fits all
   * four detection paths, so the caller passes its own `path` explicitly (each
   * call site knows which path produced the flow) rather than the helper
   * sniffing source-type strings.
   *
   * Universal rule first: a 0-step flow carries no evidence, so it is 'unknown'
   * for EVERY path. That is what makes the TD-066 smoking gun — a 0-step
   * config-seeded flow surfaced at 0.99 — impossible by construction.
   */
  private deriveFlowConfidence(
    steps:             FlowStep[],
    groundingWarnings: string[],
    path:              'api' | 'inferred-nav' | 'agent-proposed' | 'config-seeded',
  ): FlowConfidence {
    // Universal: no steps == no evidence either way -> unknown (any path,
    // including config-seeded's steps:[] today).
    if (steps.length === 0) return 'unknown'

    switch (path) {
      // AGENT-PROPOSED (enrichWithAi): steps carry a per-step `grounding` field
      // and the flow may carry groundingWarnings. 'observed' only when EVERY
      // step was a real crawled edge AND nothing was flagged; any inferred step
      // or any warning -> 'partial'.
      case 'agent-proposed':
        return steps.every(s => s.grounding === 'observed') && groundingWarnings.length === 0
          ? 'observed'
          : 'partial'

      // INFERRED NAV (identifyCandidates): steps exist but carry NO grounding
      // field — navigation is unproven, so 'observed' is unreachable. 'partial'
      // is the honest ceiling for a step-bearing-but-ungrounded flow.
      case 'inferred-nav':
        return 'partial'

      // API (detectApiFlows): endpoint-derived steps with no grounding and no
      // detect-time verification signal. No evidence exists yet -> 'unknown'.
      // A post-verification upgrade path is deferred to its own TD.
      case 'api':
        return 'unknown'

      // CONFIG-SEEDED (mergeConfigSeeded): flows have NO crawl evidence
      // (author-declared, not observed) -> 'unknown' per the boundary definition
      // (evidence absent). Currently dead code (all config-seeded are steps:[],
      // caught by the 0-step rule above); this sets the honest value for when
      // config-seeded-with-steps ships (TD-016).
      case 'config-seeded':
        return 'unknown'
    }
  }

  private deduplicateFlows(flows: FlowDefinition[]): FlowDefinition[] {
    const seen  = new Set<string>()
    const dedup: FlowDefinition[] = []
    // TD-066: dedup ranks on real evidence, NOT the displayed confidence label
    // (decoupled by design). Higher-evidence flow wins a collision.
    const observedRatio = (f: FlowDefinition): number =>
      f.steps.length === 0
        ? 0
        : f.steps.filter(s => s.grounding === 'observed').length / f.steps.length
    const ranked = [...flows].sort((a, b) => {
      // 1. observed-grounding ratio (flows with no grounding data score 0)
      const ratio = observedRatio(b) - observedRatio(a)
      if (ratio !== 0) return ratio
      // 2. step-bearing flows rank ahead of 0-step flows
      const stepPresence = (b.steps.length > 0 ? 1 : 0) - (a.steps.length > 0 ? 1 : 0)
      if (stepPresence !== 0) return stepPresence
      // 3. more steps = richer evidence (final tiebreak)
      return b.steps.length - a.steps.length
    })
    for (const flow of ranked) {
      const key = flow.id.replace(/-\d+$/, '')
      if (!seen.has(key)) {
        seen.add(key)
        dedup.push(flow)
      }
    }
    return dedup
  }

  private urlToPageId(url: string): string {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    return path
      .replace(/^\//, '')
      .replace(/\.html$/, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      || 'home'
  }
}
