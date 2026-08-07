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
 * TD-093 Phase 2 / TD-013 Phase 3 — GoalSynthesizer.
 *
 * Synthesizes candidate PENDING goals from observed landing-page signals.
 * Used by the Bootstrap Mission (Phase 2) and, later, by full-crawl goal
 * auto-discovery (TD-013 Phase 3) — one implementation, different mission
 * policies.
 *
 * PURE: no Playwright dependency, no I/O, no AI calls — simple signal reading
 * only (AI reasoning happens in AgentPlanner when a goal executes). Synthesis
 * generates ZERO evidence: every returned goal has an empty evidenceChain —
 * evidence begins only at execution (Nova Q1).
 */
import { Mission } from './Mission'
import { Goal, GoalOrigin, AgentAction } from './types'
import type { GoalDefinition } from './AgentPlanner'
import type {
  CrawlTopology, CrawlTopologyTransition, CrawlTopologyPrerequisite,
} from './CrawlTopology'

export interface PageSignals {
  navLinks: Array<{ text: string; href: string }>;
  buttonTexts: string[];
  formPresence: boolean;
  currentUrl: string;
  pageTitle: string;
}

export interface GoalSynthesizer {
  synthesize(signals: PageSignals, mission: Mission): Goal[];
  synthesizeFromTopology(topology: CrawlTopology, mission: Mission): GoalDefinition[];
}

/** Candidate-goal cap for a bootstrap mission (shallow, information-gain first). */
const BOOTSTRAP_MAX_GOALS = 5

const AUTH_TEXT = /login|sign.?in/i

export class DefaultGoalSynthesizer implements GoalSynthesizer {
  synthesize(signals: PageSignals, mission: Mission): Goal[] {
    const goals: Goal[] = []
    const origin: GoalOrigin = 'synthesized'

    // Auth goal — a "Login"/"Sign in" button (or nav link) suggests an auth
    // capability worth probing. Only synthesized when the mission permits
    // auth attempts; at most one auth goal per page.
    const authSignal =
      signals.buttonTexts.find(t => AUTH_TEXT.test(t)) ??
      signals.navLinks.find(l => AUTH_TEXT.test(l.text))?.text
    if (authSignal && mission.authAttemptsPermitted) {
      goals.push(this.newGoal(goals.length, origin, {
        description: `Authenticate via the observed '${authSignal.trim()}' control`,
        successCriteria: [{
          description: 'A password field is present (auth form reachable)',
          verifier: 'dom-assertion',
          locator: 'input[type="password"]',
        }],
      }))
    }

    // Navigation goals — one per distinct, real nav link (skip hash/js/empty).
    const seenHrefs = new Set<string>()
    for (const link of signals.navLinks) {
      const href = (link.href ?? '').trim()
      const text = (link.text ?? '').trim()
      if (!href || !text) continue
      if (href === '#' || href.startsWith('#') || href.startsWith('javascript')) continue
      if (seenHrefs.has(href)) continue
      seenHrefs.add(href)
      goals.push(this.newGoal(goals.length, origin, {
        description: `Navigate to '${text}' (${href})`,
        successCriteria: [{
          description: `URL reflects navigation to ${href}`,
          verifier: 'page-url',
          expectedValue: href,
        }],
      }))
    }

    // Mission policy: bootstrap is shallow — cap candidates at 5.
    const cap = mission.type === 'bootstrap' ? BOOTSTRAP_MAX_GOALS : goals.length
    return goals.slice(0, cap)
  }

  /**
   * TD-013 Phase 3 (Block 2c-ii) — the recipe-writer: CrawlTopology → action-bearing
   * GoalDefinitions, ONE GOAL PER FLOW. A LOSSLESS TRANSLATOR, not an interpreter — it
   * preserves ordering, grounding (COPIED 1:1 from each transition, never recomputed,
   * never upgraded), action semantics, and provenance. It NEVER guesses: an unmapped
   * action THROWS rather than being coerced (select→fill is forbidden).
   *
   * `mission` is accepted for signature parity + future policy hooks; full-crawl synthesis
   * applies no cap today (one goal per observed flow, no shallow bound).
   */
  synthesizeFromTopology(topology: CrawlTopology, mission: Mission): GoalDefinition[] {
    void mission
    const selectorById    = new Map<string, string | null>()
    const urlByPageId     = new Map<string, string>()
    const prereqsByPageId = new Map<string, CrawlTopologyPrerequisite[]>()
    for (const page of topology.pages) {
      urlByPageId.set(page.id, page.urlPattern)
      prereqsByPageId.set(page.id, page.prerequisites)
      for (const el of page.elements) selectorById.set(el.id, el.selector)
    }

    return topology.flows.map(flow => {
      const ordered     = flow.orderedTransitionIndices.map(i => topology.transitions[i])
      const flowActions = ordered.map(t => this.transitionToAction(t, selectorById, urlByPageId))

      const terminal     = ordered[ordered.length - 1]
      const targetPageId = terminal?.toPageId ?? null
      const targetUrl    = this.resolveUrl(terminal, urlByPageId)

      // Fork 2(a): inline the TARGET page's recorded PagePrerequisite steps as LEADING
      // actions (self-containment, Rule 7). Reuse RECORDED steps exactly — never synthesize
      // a prereq. Pick the prereq matching the flow's role, else the role-agnostic one.
      const pagePrereqs   = targetPageId ? (prereqsByPageId.get(targetPageId) ?? []) : []
      const applicable    = pagePrereqs.find(pre => pre.roleId === undefined || pre.roleId === flow.roleId)
      const prereqActions = applicable
        ? applicable.steps.map(t => this.transitionToAction(t, selectorById, urlByPageId))
        : []
      // TODO(2c-iii): dedup identical leading prereq sequences across consecutive goals.
      // Deferred by design: dedup trades AGAINST self-containment — removing a goal's inlined
      // prereq makes it depend on a sibling having run first, a hidden prerequisite we refuse
      // to invent (goals stay flat, prerequisites:[]). Correctness (self-contained goals)
      // first; the optimization is a later pass.

      const actions: AgentAction[] = [...prereqActions, ...flowActions]

      const successCriteria = targetUrl
        ? [{
            description:   `URL reflects navigation to ${targetUrl}`,
            verifier:      'page-url',
            expectedValue: targetUrl,
          }]
        : []

      return {
        id:              `synthesized:${flow.id}`,   // deterministic — NEVER Date.now()
        description:     flow.displayName,
        type:            'capability',
        origin:          'synthesized' as GoalOrigin,
        successCriteria,
        prerequisites:   [],   // flat — we never invent goal-graph dependencies
        actions,
      }
    })
  }

  /**
   * Map ONE transition to an AgentAction. grounding is COPIED 1:1 from the transition —
   * never recomputed, never upgraded. Unmapped actions THROW (never silently coerced).
   */
  private transitionToAction(
    t:            CrawlTopologyTransition,
    selectorById: Map<string, string | null>,
    urlByPageId:  Map<string, string>,
  ): AgentAction {
    const grounding = t.grounding                                   // COPY — never recomputed
    const selectorTarget = t.elementId ? (selectorById.get(t.elementId) ?? t.elementId) : ''
    const url = this.resolveUrl(t, urlByPageId)

    switch (t.action) {
      case 'click':
        return { type: 'click', target: selectorTarget, grounding }
      case 'fill':
        return { type: 'fill', target: selectorTarget, payload: t.value ?? undefined, grounding }
      case 'navigate':
        return { type: 'navigate', target: url, grounding }
      case 'api-call':
        // value holds the endpoint ("METHOD /path"), not a body — it maps to target; no
        // request body is fabricated (lossless translator, never guess).
        return { type: 'api-call', target: t.value ?? '', grounding }
      case 'assert-navigation':
        // NOT an interaction — an expectation (elementId is null here). grounding is COPIED
        // (an observed single-page assert stays observed; a no-edge assert stays inferred).
        return {
          type: 'verify', target: url, grounding,
          assertionContext: { assertionType: 'page-url', expectedValue: url },
        }
      default:
        throw new Error(
          `[GoalSynthesizer] Unsupported flow action '${t.action}' — the recipe-writer is a ` +
          `lossless translator and will NOT silently coerce it (e.g. select→fill is forbidden). ` +
          `Add first-class support before emitting.`,
        )
    }
  }

  /** Resolve a transition's destination URL: the target page's urlPattern, else its recorded value. */
  private resolveUrl(t: CrawlTopologyTransition | undefined, urlByPageId: Map<string, string>): string {
    if (!t) return ''
    if (t.toPageId && urlByPageId.has(t.toPageId)) return urlByPageId.get(t.toPageId)!
    return t.value ?? ''
  }

  /** Every synthesized goal: origin='synthesized', status='pending', ZERO evidence. */
  private newGoal(
    index: number,
    origin: GoalOrigin,
    fields: { description: string; successCriteria: Goal['successCriteria'] },
  ): Goal {
    return {
      id:              `synthesized-${index}-${Date.now()}`,
      type:            'capability',
      origin,
      description:     fields.description,
      successCriteria: fields.successCriteria,
      prerequisites:   [],
      status:          'pending',
      evidenceChain:   [],   // evidence starts only at execution — never here
      createdAt:       new Date().toISOString(),
    }
  }
}
