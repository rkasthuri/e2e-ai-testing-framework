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
 * TD-110 — ObservationSettlingPolicy: reusable abstraction for waiting until
 * a page has revealed its evidence.
 *
 * Nova-approved (TD-110 design review).
 *
 * Problem: SPAs render content client-side after domcontentloaded. Detectors
 * that run immediately after page.goto() observe an incomplete page state —
 * live-confirmed on OrangeHRM, whose Vue-rendered login form appears after
 * hydration, so detectAuthType counted 0 password fields and concluded
 * authType 'none' (the TD-110 root cause).
 *
 * Solution: an injectable settling policy that waits for EVIDENCE rather than
 * sleeping for a fixed time. The timeout is the OUTER BOUND, not the
 * mechanism (Nova ruling: evidence-driven settling, not clock-driven).
 *
 * Future consumers: auth detection, strategy detection, nav detection, modal
 * detection, shadow DOM, React suspense, Vue hydration — one interface.
 */
import { Page } from '@playwright/test'

/**
 * TD-166 (auth-settling package) — what a policy OBSERVED while waiting. A TIMER's
 * report, NOT a "settlement" claim (Nova R2 / TD-173 precedent): it says only how long
 * it waited and whether the awaited evidence appeared within a bounded window.
 */
export interface SettleObservation {
  /** Wall-time (ms) until the awaited evidence appeared, or the full ceiling on timeout.
   *  Definitional 0 for a no-op policy (it does not wait). */
  observedMs: number;
  /** The outer bound waited (ms); null for a policy that does not wait. */
  ceilingMs: number | null;
  /** The selector/condition awaited; null for the no-op policy. */
  selector: string | null;
  /** True when the ceiling elapsed WITHOUT the evidence appearing. */
  timedOut: boolean;
  /** Human-readable mechanism — phrased as a TIMER ("waited up to Nms for X"), never
   *  "settled" (Nova R2: a timer is not settlement). */
  mechanism: string;
}

export interface ObservationSettlingPolicy {
  /**
   * Wait until the page has revealed the evidence we're looking for, then REPORT what was
   * observed (elapsed, ceiling, whether it timed out). Must NOT throw — log and continue on
   * timeout (absent evidence is the caller's call to make, not this policy's).
   */
  settle(page: Page): Promise<SettleObservation>;
}

/**
 * DomcontentloadedPolicy — the pre-TD-110 default behavior: no additional
 * waiting beyond domcontentloaded. For fixture flows and static-HTML apps.
 */
export class DomcontentloadedPolicy implements ObservationSettlingPolicy {
  async settle(_page: Page): Promise<SettleObservation> {
    // No-op — domcontentloaded is sufficient for this consumer. observedMs is a
    // DEFINITIONAL 0 (it does not wait), not a measurement.
    return { observedMs: 0, ceilingMs: null, selector: null, timedOut: false,
      mechanism: 'observed at domcontentloaded (no wait)' }
  }
}

/**
 * WaitForSelectorPolicy — settles the moment a specific selector appears
 * (state: 'attached' — presence is the evidence; visibility is a separate
 * question). Evidence-driven: an app whose selector exists at load settles
 * instantly; the timeout fires only when the evidence genuinely never comes.
 */
export class WaitForSelectorPolicy implements ObservationSettlingPolicy {
  constructor(
    private selector: string,
    private timeoutMs: number = 3000,
  ) {}

  async settle(page: Page): Promise<SettleObservation> {
    const t0 = performance.now()
    let timedOut = false
    try {
      await page.waitForSelector(this.selector, {
        timeout: this.timeoutMs,
        state: 'attached',
      })
    } catch {
      // Selector not found within the outer bound — the page genuinely may
      // not have this element. Log and continue; the caller decides what
      // absent evidence means (Rule 5: visible, never silent).
      timedOut = true
      console.log(
        `[ObservationSettlingPolicy] Selector "${this.selector}" not found ` +
        `within ${this.timeoutMs}ms — proceeding with available evidence`,
      )
    }
    return {
      observedMs: Math.round(performance.now() - t0),
      ceilingMs:  this.timeoutMs,
      selector:   this.selector,
      timedOut,
      mechanism:  `waited up to ${this.timeoutMs}ms for the ${this.selector} selector`,
    }
  }
}

/**
 * NetworkIdlePolicy — settles when the network goes idle. For apps that
 * fetch content on load. More aggressive than WaitForSelectorPolicy.
 */
export class NetworkIdlePolicy implements ObservationSettlingPolicy {
  constructor(private timeoutMs: number = 5000) {}

  async settle(page: Page): Promise<SettleObservation> {
    const t0 = performance.now()
    let timedOut = false
    try {
      await page.waitForLoadState('networkidle', { timeout: this.timeoutMs })
    } catch {
      timedOut = true
      console.log(
        `[ObservationSettlingPolicy] Network idle not reached within ` +
        `${this.timeoutMs}ms — proceeding with available evidence`,
      )
    }
    return {
      observedMs: Math.round(performance.now() - t0),
      ceilingMs:  this.timeoutMs,
      selector:   null,
      timedOut,
      mechanism:  `waited up to ${this.timeoutMs}ms for network idle`,
    }
  }
}

/**
 * ComposedPolicy — runs multiple policies in sequence (each contributes its
 * own settling; none invalidates a prior one — the cumulative-observation
 * principle).
 */
export class ComposedPolicy implements ObservationSettlingPolicy {
  constructor(private policies: ObservationSettlingPolicy[]) {}

  async settle(page: Page): Promise<SettleObservation> {
    const parts: SettleObservation[] = []
    for (const policy of this.policies) {
      parts.push(await policy.settle(page))
    }
    // Cumulative observation: sum the waits, time-out if ANY sub-policy did, keep every
    // mechanism visible so the composed line stays reconstructable.
    return {
      observedMs: parts.reduce((n, o) => n + o.observedMs, 0),
      ceilingMs:  parts.reduce((n, o) => n + (o.ceilingMs ?? 0), 0) || null,
      selector:   parts.map(o => o.selector).filter(Boolean).join(', ') || null,
      timedOut:   parts.some(o => o.timedOut),
      mechanism:  parts.map(o => o.mechanism).join(' then '),
    }
  }
}

/** Default settling policy for SPA login detection (TD-110 Fix 1; ceiling raised to 10s by the
 *  TD-166 auth-settling package — invocation is once per onboarding, verified, so the higher
 *  outer bound costs at most 1× per attempt and only on apps whose form never appears). */
export const SPA_AUTH_SETTLING_POLICY =
  new WaitForSelectorPolicy('input[type="password"]', 10000)

/** Default policy — no additional settling (pre-TD-110 behavior). */
export const DEFAULT_SETTLING_POLICY = new DomcontentloadedPolicy()
