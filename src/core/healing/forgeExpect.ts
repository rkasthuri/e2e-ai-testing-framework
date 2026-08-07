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
 * TD-065 — forgeExpect: a thin dispatcher around Playwright's `expect`.
 *
 * FixtureGenerator aliases generated specs' `expect` to this. Behaviour:
 *   - Page / raw Locator target  -> pass straight through to Playwright's expect.
 *     A raw `page.locator(selector)` has no SmartLocatorDef, so there is nothing
 *     to heal (Option C). Full assertion-layer healing needs the generator to emit
 *     SmartLocator-backed spec assertions — see the Option-B follow-up TD.
 *   - SmartLocator target        -> heal via resolve({assertionType}) + re-assert,
 *     so a broken selector is repaired AND its correctness re-verified (TD-065
 *     Tier 1) before the assertion runs.
 *
 * Detection uses the `__isSmartLocator` brand (SmartLocator.ts) so it survives
 * duplicate class identities that would defeat a bare `instanceof`.
 */
import { expect as playwrightExpect, Locator } from '@playwright/test';
import { SmartLocator } from './SmartLocator';
import { AssertionContext } from './types';

type Opts = { timeout?: number };

function isSmartLocator(target: unknown): target is SmartLocator {
  return target instanceof SmartLocator || (target as any)?.__isSmartLocator === true;
}

/**
 * Assertion facade for a SmartLocator: resolve (heal + verify) then delegate to
 * Playwright's real LocatorAssertions on the healed locator. Only the assertion
 * types the generator emits are wrapped (audit: toBeVisible / toBeAttached /
 * toHaveText / not.toHaveCount).
 */
class ForgeLocatorAssertion {
  constructor(private smart: SmartLocator, private context?: AssertionContext) {}

  private resolveWith(
    defaultType: AssertionContext['assertionType'],
    expectedValue?: string,
  ): Promise<Locator> {
    return this.smart.resolve(this.context ?? { assertionType: defaultType, expectedValue });
  }

  async toBeVisible(opts?: Opts): Promise<void> {
    return playwrightExpect(await this.resolveWith('toBeVisible')).toBeVisible(opts);
  }

  async toBeAttached(opts?: Opts): Promise<void> {
    return playwrightExpect(await this.resolveWith('toBeAttached')).toBeAttached(opts);
  }

  async toHaveText(expected: string | RegExp | Array<string | RegExp>, opts?: Opts): Promise<void> {
    const healed = await this.resolveWith('toHaveText', Array.isArray(expected) ? undefined : String(expected));
    return playwrightExpect(healed).toHaveText(expected, opts);
  }

  get not() {
    const self = this;
    return {
      async toHaveCount(count: number, opts?: Opts): Promise<void> {
        return playwrightExpect(await self.resolveWith('not.toHaveCount')).not.toHaveCount(count, opts);
      },
      async toBeVisible(opts?: Opts): Promise<void> {
        return playwrightExpect(await self.resolveWith('toBeVisible')).not.toBeVisible(opts);
      },
    };
  }
}

/**
 * Drop-in replacement for Playwright's `expect` in generated specs. Returns `any`
 * because it dispatches across Page / Locator / SmartLocator assertion shapes —
 * generated (not hand-maintained) code consumes it, and the runtime dispatch is
 * what matters. The optional assertionContext lets programmatic callers force a
 * context; generated specs rely on each method's own default.
 */
export function forgeExpect(target: unknown, assertionContext?: AssertionContext): any {
  if (isSmartLocator(target)) {
    return new ForgeLocatorAssertion(target, assertionContext);
  }
  return playwrightExpect(target as any);
}
