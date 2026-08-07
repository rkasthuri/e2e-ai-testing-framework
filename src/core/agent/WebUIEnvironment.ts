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
 * TD-013 Commit 3 — WebUIEnvironment.
 *
 * A Playwright-backed ExecutionEnvironment for the 'web-ui' type. Owns its own
 * headless browser (init/close), observes DOM/URL signals, performs agent actions,
 * and verifies a goal's success criteria. Every observe/act/verify path returns a
 * value (never undefined); failures are explicit ActionResults/ObservationResults,
 * never silent (Standing Rule 5).
 *
 * Browser launch mirrors Crawler.ts (chromium + hardening args). TD-097: no
 * hardcoded paths — baseUrl is injected. Evidence ids use crypto.randomUUID()
 * (Node built-in — nanoid is not a dependency).
 */
import { chromium, Browser, Page } from '@playwright/test'
import * as crypto from 'crypto'
import {
  ExecutionEnvironment, ObservationTarget, ObservationResult,
  AgentAction, ActionResult, EvidenceRecord, Goal,
  EvidenceConfidence, EvidenceObservationType,
} from './types'

export class WebUIEnvironment implements ExecutionEnvironment {
  readonly type = 'web-ui' as const
  private browser?: Browser
  private page?: Page

  constructor(private baseUrl: string) {}

  /** Launch headless Chromium (same hardening args as Crawler.ts) + open a page. */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    })
    this.page = await this.browser.newPage()
  }

  /** Close the browser. Always call in a finally block. */
  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = undefined
    this.page = undefined
  }

  async observe(target: ObservationTarget): Promise<ObservationResult> {
    const timestamp = new Date().toISOString()
    if (!this.page) {
      console.warn('[WebUIEnvironment] observe() called before init()')
      return { observed: false, confidence: 'unknown', timestamp }
    }
    switch (target.type) {
      case 'dom-element': {
        const count = await this.page.locator(target.locator).count()
        return { observed: count > 0, value: count, confidence: 'high', timestamp }
      }
      case 'page-url': {
        const url = this.page.url()
        return { observed: this.urlMatches(url, target.locator), value: url, confidence: 'high', timestamp }
      }
      case 'api-response':
      case 'network-request':
      default:
        console.warn(`[WebUIEnvironment] observe target '${target.type}' not supported in web-ui`)
        return { observed: false, confidence: 'unknown', timestamp }
    }
  }

  async act(action: AgentAction): Promise<ActionResult> {
    const timestamp = new Date().toISOString()

    // api-call is unsupported in a web-ui environment — an EXPLICIT failed
    // ActionResult (never a throw, never a silent skip). See Commit-3 pre-audit.
    if (action.type === 'api-call') {
      console.warn('[WebUIEnvironment] api-call not supported in web-ui environment')
      const evidence = this.newEvidence(
        'direct_observation', "action 'api-call' unsupported by the web-ui environment",
        'high', `act:${action.type}`, timestamp)
      return { success: false, evidence, error: 'api-call not supported in web-ui environment' }
    }

    try {
      const page = this.requirePage()
      let nextState: string | undefined
      switch (action.type) {
        case 'navigate':
          await page.goto(action.target, { waitUntil: 'domcontentloaded', timeout: 30000 })
          nextState = page.url()
          break
        case 'click':
          await page.locator(action.target).click()
          nextState = page.url()
          break
        case 'fill':
          await page.locator(action.target).fill(String(action.payload ?? ''))
          break
        case 'wait':
          await page.waitForTimeout(Number(action.payload) || 1000)
          break
        case 'verify': {
          // Delegate to observe(); surface the observation as an ActionResult.
          const obs = await this.observe({ type: 'dom-element', locator: action.target })
          const evidence = this.newEvidence(
            obs.observed ? 'direct_observation' : 'inference',
            `verify '${action.target}' -> observed=${obs.observed}`,
            obs.confidence, 'act:verify', timestamp)
          return { success: obs.observed, evidence, nextState: page.url() }
        }
      }
      const evidence = this.newEvidence(
        'direct_observation', `performed ${action.type} on '${action.target}'`,
        'high', `act:${action.type}`, timestamp)
      return { success: true, evidence, nextState }
    } catch (e: any) {
      // Explicit failure — inference tier, low confidence, error surfaced.
      const evidence = this.newEvidence(
        'inference', `action ${action.type} on '${action.target}' failed: ${e.message}`,
        'low', `act:${action.type}`, timestamp)
      return { success: false, evidence, error: e.message }
    }
  }

  async verify(goal: Goal): Promise<{ achieved: boolean; evidence: EvidenceRecord }> {
    const timestamp = new Date().toISOString()
    const outcomes: boolean[] = []
    const signals: string[] = []

    for (const criterion of goal.successCriteria) {
      let obs: ObservationResult
      // `locator` is the canonical target field (TD-013); `expectedValue` is a
      // back-compat fallback. dom-assertion prefers the selector in `locator`;
      // page-url prefers the URL pattern in `expectedValue`.
      if (criterion.verifier === 'dom-assertion') {
        const selector = criterion.locator ?? String(criterion.expectedValue ?? '')
        obs = await this.observe({ type: 'dom-element', locator: selector })
      } else if (criterion.verifier === 'page-url') {
        const pattern = String(criterion.expectedValue ?? criterion.locator ?? '')
        obs = await this.observe({ type: 'page-url', locator: pattern })
      } else {
        // api-response (or anything else) is unsupported in web-ui -> not achieved.
        console.warn(`[WebUIEnvironment] verifier '${criterion.verifier}' not supported in web-ui`)
        obs = { observed: false, confidence: 'unknown', timestamp }
      }
      outcomes.push(obs.observed)
      signals.push(`${criterion.verifier}=${obs.observed}`)
    }

    // All criteria must pass (and there must be at least one) for achieved.
    const achieved = outcomes.length > 0 && outcomes.every(Boolean)
    const evidence = this.newEvidence(
      achieved ? 'direct_observation' : 'inference',
      `verify(${goal.id}): ${signals.join(', ') || 'no criteria'}`,
      achieved ? 'high' : 'low',
      `verify:${goal.id}`,
      timestamp,
      goal.id)
    return { achieved, evidence }
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private requirePage(): Page {
    if (!this.page) throw new Error('WebUIEnvironment not initialized — call init() before use')
    return this.page
  }

  /** Glob-ish URL match: `*`/`**` become `.*`, everything else is literal. */
  private urlMatches(url: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*')
    return new RegExp(escaped).test(url)
  }

  private newEvidence(
    observationType: EvidenceObservationType,
    signal: string,
    confidence: EvidenceConfidence,
    source: string,
    timestamp: string,
    goalId = '',
  ): EvidenceRecord {
    return {
      id: crypto.randomUUID(),
      observationType,
      signal,
      confidence,
      source,
      timestamp,
      goalId,
      preconditionEvidenceIds: [],
    }
  }
}
