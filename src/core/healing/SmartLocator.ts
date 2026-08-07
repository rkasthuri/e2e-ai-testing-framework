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

import { Page, Locator, expect, test } from '@playwright/test';
import { SmartLocatorDef, SelectorStrategy, HealEvent, AssertionContext } from './types';
import { HealConfidence, CorrectnessSignal } from '../storage/types';
import { healStore } from './HealStore';
import { VisionHealer } from './VisionHealer';
import { FORGE_COULD_NOT_VERIFY, HealUnresolvedError } from './couldNotVerify';

const STRATEGY_TIMEOUT = 2000;
// Read at call time so tests can toggle HEALING_DISABLED via process.env at runtime
const isHealingDisabled = (): boolean => process.env.HEALING_DISABLED === 'true';

export class SmartLocator {
  // TD-065 — runtime brand so forgeExpect can detect a FORGE-managed locator
  // without a fragile `instanceof` (survives duplicate class identities).
  readonly __isSmartLocator = true as const;
  private page: Page;
  private def: SmartLocatorDef;
  private healEvents: HealEvent[] = [];

  constructor(page: Page, def: SmartLocatorDef) {
    this.page = page;
    this.def = def;
  }

  async resolve(assertionContext?: AssertionContext): Promise<Locator> {
    const [primary, ...fallbacks] = this.def.strategies;

    // Check heal store first -- use remembered selector if available
    const storedSelector = healStore.getHealedSelector(this.def.key);
    if (storedSelector && !isHealingDisabled()) {
      const storedLocator = this.page.locator(storedSelector);
      if (await this.isResolvable(storedLocator)) {
        console.log(`[SmartLocator] Using stored heal for "${this.def.key}": ${storedSelector}`);
        return storedLocator;
      }
      // Stored selector no longer resolves -- don't retire the entry here.
      // It's still being healed, just re-deriving a new selector below
      // (strategy chain or Vision); deleting now would wipe firstHealed/
      // consecutiveSuccesses before recordHeal() gets a chance to carry
      // them forward (TD-022).
      console.log(`[SmartLocator] Stored heal for "${this.def.key}" no longer resolves -- re-deriving via fallback/vision`);
    }

    // Happy path -- try primary
    const primaryLocator = this.buildLocator(primary);
    if (await this.isResolvable(primaryLocator)) {
      // Primary works -- retire any stale heal entry
      if (healStore.getEntry(this.def.key)) {
        healStore.retireHeal(this.def.key);
      }
      return primaryLocator;
    }

    // Healing disabled -- fail immediately
    if (isHealingDisabled()) {
      throw new Error(
        `[SmartLocator] Primary selector failed for "${this.def.key}": ${primary.selector}\n` +
        `Healing is disabled (HEALING_DISABLED=true)`
      );
    }

    // Strategy chain -- try fallbacks in order
    for (const strategy of fallbacks) {
      const locator = this.buildLocator(strategy);
      if (await this.isResolvable(locator)) {
        // TD-065: re-run the caller's real assertion against the healed target
        // (Tier 1) instead of trusting mere resolvability.
        const verified = await verifyHeal(locator, assertionContext);
        this.recordHeal(
          primary, strategy, 'strategy-chain', undefined,
          deriveCorrectnessSignal(verified, assertionContext),
          deriveHealConfidence(verified, strategy.name),
        );
        console.warn(
          `[SmartLocator] Healed "${this.def.key}": ` +
          `${primary.selector} -> ${strategy.selector} (${strategy.name}) ` +
          `[${verified ? 'assertion-verified' : assertionContext ? 'resolvability-only' : 'unverified'}]`
        );
        return locator;
      }
    }

    // All strategies failed -- escalate to Vision
    const visionHealer = new VisionHealer(this.page);
    const visionResult = await visionHealer.heal(this.def.description);

    if (visionResult.success) {
      const visionLocator = this.page.locator(visionResult.selector);
      if (await this.isResolvable(visionLocator)) {
        const verified = await verifyHeal(visionLocator, assertionContext);
        this.recordHeal(
          primary, { name: 'css', selector: visionResult.selector }, 'vision',
          visionResult.confidence,
          deriveCorrectnessSignal(verified, assertionContext),
          deriveHealConfidence(verified, 'css', visionResult.confidence),
        );
        console.log(
          `[SmartLocator] Vision healed "${this.def.key}": ${visionResult.selector} ` +
          `(vision confidence: ${visionResult.confidence}; ` +
          `${verified ? 'assertion-verified' : assertionContext ? 'resolvability-only' : 'unverified'})`
        );
        return visionLocator;
      }
    }

    // ── ADR-018 RED-SIDE — heal exhausted = could-not-verify, NOT a defect ──────
    // The strategy-chain AND Vision both failed to confidently relocate the
    // element. That is "could-not-heal-confidently" (could-not-verify), not a
    // demonstrated app failure. This throw is the SINGLE choke point for both the
    // action path (SmartLocator.click/fill/...) and the assertion path
    // (forgeExpect) — so the signal is emitted here once, no per-call-site catch.
    const reason =
      `Heal exhausted for "${this.def.key}": strategy-chain ` +
      `(${this.def.strategies.map(s => s.name).join(', ')}) + Vision all failed to ` +
      `confidently resolve. Vision: ${visionResult.reasoning}`;
    // (1) cross-boundary signal: structured annotation the ingestion layer re-grades on.
    attachCouldNotVerify(reason);
    // (2) evidence: persist the failed heal (H3) — a DB heal_events failure row ONLY,
    //     via a path DISTINCT from the promotion-shaped recordHeal (closes the
    //     archetype-4 "winners-only" gap: a failed heal is now recorded, not dropped).
    await healStore.recordUnresolved(this.def.key, primary.name, deriveHealConfidence(false, ''));
    // (3) typed throw — distinct from a native browser/network error (b vs c).
    throw new HealUnresolvedError(
      `[SmartLocator] All strategies and Vision exhausted for "${this.def.key}".\n` +
      `Tried: ${this.def.strategies.map(s => s.selector).join(', ')}\n` +
      `Vision: ${visionResult.reasoning}\n` +
      `Description: ${this.def.description}`,
      this.def.key,
    );
  }

  async click(): Promise<void> {
    const locator = await this.resolve();
    await locator.click();
  }

  async fill(value: string): Promise<void> {
    const locator = await this.resolve();
    await locator.fill(value);
  }

  async isVisible(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return locator.isVisible();
    } catch {
      return false;
    }
  }

  async textContent(): Promise<string> {
    const locator = await this.resolve();
    return (await locator.textContent()) ?? '';
  }

  async inputValue(): Promise<string> {
    const locator = await this.resolve();
    return locator.inputValue();
  }

  async selectOption(value: string): Promise<string[]> {
    const locator = await this.resolve();
    return locator.selectOption(value);
  }

  async waitFor(options?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void> {
    const locator = await this.resolve();
    await locator.waitFor(options);
  }

  getHealEvents(): HealEvent[] {
    return this.healEvents;
  }

  private buildLocator(strategy: SelectorStrategy): Locator {
    if (strategy.name === 'role') {
      const role = strategy.selector as Parameters<Page['getByRole']>[0];
      return strategy.accessibleName
        ? this.page.getByRole(role, { name: strategy.accessibleName })
        : this.page.getByRole(role);
    }
    return this.page.locator(strategy.selector);
  }

  private async isResolvable(locator: Locator): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout: STRATEGY_TIMEOUT });
      return true;
    } catch {
      return false;
    }
  }

  private recordHeal(
    original: SelectorStrategy,
    healed: SelectorStrategy,
    source: 'strategy-chain' | 'vision',
    confidence?: number,
    correctnessSignal?: CorrectnessSignal,
    healConfidence?: HealConfidence,
  ): void {
    const event: HealEvent = {
      key: this.def.key,
      timestamp: new Date().toISOString(),
      originalStrategy: original.name,
      healedStrategy: healed.name,
      healedSelector: healed.selector,
      source,
      confidence,
      correctnessSignal,
      healConfidence,
    };
    this.healEvents.push(event);
    healStore.recordHeal(event);  // persist to store
    healStore.save();              // write immediately
  }
}

// ── ADR-018 red-side: could-not-verify signal producer ────────────────────────

/**
 * Attach the structured could-not-verify annotation to the CURRENT Playwright
 * test, so ingestion (streaming reporter + batch JSON) can re-grade the
 * heal-caused failure to could-not-verify.
 *
 * GUARDED: `test.info()` THROWS when called outside a running test. SmartLocator
 * is only used inside specs today, but a future non-spec caller must not crash —
 * so on any failure we skip the annotation (the typed HealUnresolvedError still
 * propagates and carries the signal). Exported for the by-construction test
 * (verifies the guard is a no-op outside a test context).
 */
export function attachCouldNotVerify(description: string): void {
  try {
    test.info().annotations.push({ type: FORGE_COULD_NOT_VERIFY, description });
  } catch {
    // Not inside a running Playwright test — no test.info() to annotate. The
    // typed throw still fires; the signal is simply not carried for this caller.
  }
}

// ── TD-065: heal correctness helpers ──────────────────────────────────────────

// Fixed reliability tiers (the same tiers ElementClassifier assigns). data-test /
// id / role are the stable, unambiguous strategies; text / css are positional/
// content-derived and weaker. Unknown names default to low (conservative).
const HIGH_TIER_STRATEGIES = new Set(['data-test', 'id', 'role', 'aria-label']);

function isHighTier(strategyName: string): boolean {
  return HIGH_TIER_STRATEGIES.has(strategyName);
}

/**
 * TD-065 — re-run the caller's REAL assertion against the healed locator (Tier 1).
 * Returns true only if the assertion actually passes; any throw (or absent
 * context / unhandled assertion type) → false (not assertion-verified). Page-level
 * assertions ('toHaveURL', 'goto') can't be checked against a locator → false.
 */
async function verifyHeal(locator: Locator, context: AssertionContext | undefined): Promise<boolean> {
  if (!context) return false;
  try {
    switch (context.assertionType) {
      case 'toBeVisible':     await expect(locator).toBeVisible({ timeout: 2000 }); return true;
      case 'toBeAttached':    await expect(locator).toBeAttached({ timeout: 2000 }); return true;
      case 'toHaveText':      await expect(locator).toHaveText(context.expectedValue ?? '', { timeout: 2000 }); return true;
      case 'not.toHaveCount': await expect(locator).not.toHaveCount(0, { timeout: 2000 }); return true;
      case 'click':           await locator.click({ timeout: 2000, trial: true }); return true;  // dry-run, no side effect
      case 'fill':            return false;  // fill has no trial-run equivalent; skip verification
                                             // (records unverified/unknown — honest, no side effect)
      default:                return false;  // toHaveURL / goto / unknown — not locator-verifiable
    }
  } catch {
    return false;  // heal rejected for this strategy — assertion did not hold
  }
}

/**
 * TD-065 — derive the correctness-based confidence tier. Vision path takes
 * precedence (a vision heal records with strategy name 'css', but its confidence
 * comes from the model, not the css tier). `strategyName` empty = no strategy
 * resolved → 'failed' (currently unreachable via recordHeal, which is only called
 * on a resolved heal; defined for the future failure-recording path).
 */
export function deriveHealConfidence(
  verified: boolean,
  strategyName: string,
  visionConfidence?: number,
): HealConfidence {
  if (visionConfidence !== undefined) {
    if (visionConfidence >= 0.8) return verified ? 'observed' : 'partial';
    return 'unknown';
  }
  if (verified) return isHighTier(strategyName) ? 'observed' : 'partial';
  return strategyName ? 'unknown' : 'failed';
}

/**
 * TD-065 — how the heal's correctness was established. Called only after a
 * strategy/vision selector resolved, so "resolved" is implicit: context absent →
 * 'unverified'; context present + assertion passed → 'assertion-verified'; context
 * present + assertion failed/unhandled → 'resolvability-only'.
 */
export function deriveCorrectnessSignal(
  verified: boolean,
  context: AssertionContext | undefined,
): CorrectnessSignal {
  if (!context) return 'unverified';
  return verified ? 'assertion-verified' : 'resolvability-only';
}
