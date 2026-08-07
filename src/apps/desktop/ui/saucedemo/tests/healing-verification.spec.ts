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
 * Phase 4.1 Verification Spec
 * Proves SmartLocator strategy chain works correctly.
 * Uses guestPage fixture -- tests the login page elements.
 */
import { test, expect } from '../fixtures/fixtures';
import { SmartLocator } from '../../../../../core/healing/SmartLocator';
import { healStore } from '../../../../../core/healing/HealStore';
import { HealReporter } from '../../../../../core/healing/HealReporter';
import { VisionHealer, resetVisionBudget } from '../../../../../core/healing/VisionHealer';

test.describe('Phase 4.1 -- SmartLocator Verification', () => {

  test('HV001 - Primary selector resolves on happy path', async ({ guestPage }) => {
    const locator = new SmartLocator(guestPage, {
      key: 'test.loginButton',
      description: 'Login button on the login form',
      strategies: [
        { name: 'data-test', selector: '[data-test="login-button"]' },
        { name: 'id',        selector: '#login-button' },
      ],
    });

    const resolved = await locator.resolve();
    await expect(resolved).toBeVisible();
    expect(locator.getHealEvents()).toHaveLength(0);
    console.log('HV001 - Primary selector resolved, zero heal events');
  });

  test('HV002 - Fallback strategy heals when primary fails', async ({ guestPage }) => {
    // Retire any stored heal from a previous run so the strategy chain fires
    healStore.retireHeal('test.loginButtonHeal');
    const locator = new SmartLocator(guestPage, {
      key: 'test.loginButtonHeal',
      description: 'Login button -- primary deliberately broken',
      strategies: [
        { name: 'css',       selector: '[data-test="BROKEN-SELECTOR-XYZ"]' },
        { name: 'id',        selector: '#login-button' },
      ],
    });

    const resolved = await locator.resolve();
    await expect(resolved).toBeVisible();

    const events = locator.getHealEvents();
    expect(events).toHaveLength(1);
    expect(events[0].healedSelector).toBe('#login-button');
    expect(events[0].source).toBe('strategy-chain');
    console.log('HV002 - Fallback healed successfully:', events[0].healedSelector);
  });

  test('HV003 - All strategies fail throws with audit', async ({ guestPage }) => {
    await guestPage.setDefaultTimeout(30000);
    // Navigate to blank page so VisionHealer finds no elements and returns failure,
    // ensuring the "all strategies and Vision exhausted" throw path is exercised.
    await guestPage.goto('about:blank');

    const locator = new SmartLocator(guestPage, {
      key: 'test.allBroken',
      description: 'All selectors deliberately broken',
      strategies: [
        { name: 'css', selector: '[data-test="BROKEN-1"]' },
        { name: 'id',  selector: '#BROKEN-2' },
      ],
    });

    let threw = false;
    try {
      await locator.resolve();
    } catch (error: any) {
      threw = true;
      expect(error.message).toContain('strategies and Vision exhausted');
      expect(error.message).toContain('test.allBroken');
    }

    expect(threw).toBe(true);
    console.log('HV003 - Correct error thrown with audit trail');
  });

  test('HV004 - HEALING_DISABLED skips fallback and fails fast', async ({ guestPage }) => {
    process.env.HEALING_DISABLED = 'true';

    const locator = new SmartLocator(guestPage, {
      key: 'test.disabledHealing',
      description: 'Primary broken but healing disabled',
      strategies: [
        { name: 'css', selector: '[data-test="BROKEN"]' },
        { name: 'id',  selector: '#login-button' },
      ],
    });

    let threw = false;
    try {
      await locator.resolve();
    } catch (error: any) {
      threw = true;
      expect(error.message).toContain('Healing is disabled');
    }

    expect(threw).toBe(true);
    process.env.HEALING_DISABLED = 'false';
    console.log('HV004 - Healing disabled correctly bypasses fallback');
  });

  test('HV005 - HealStore records and retrieves heal events', async ({ guestPage }) => {
    const { HealStoreManager } = await import('../../../../../core/healing/HealStore');
    const testStore = new HealStoreManager();

    // Record a heal
    testStore.recordHeal({
      key: 'test.storeVerification',
      timestamp: new Date().toISOString(),
      originalStrategy: 'data-test',
      healedStrategy: 'id',
      healedSelector: '#login-button',
      source: 'strategy-chain',
    });

    // Verify retrieval
    const entry = testStore.getEntry('test.storeVerification');
    expect(entry).toBeDefined();
    expect(entry!.healedSelector).toBe('#login-button');
    expect(entry!.consecutiveSuccesses).toBe(1);
    expect(entry!.source).toBe('strategy-chain');

    // Verify POM candidate threshold (needs 3 consecutive successes)
    testStore.recordHeal({
      key: 'test.storeVerification',
      timestamp: new Date().toISOString(),
      originalStrategy: 'data-test',
      healedStrategy: 'id',
      healedSelector: '#login-button',
      source: 'strategy-chain',
    });
    testStore.recordHeal({
      key: 'test.storeVerification',
      timestamp: new Date().toISOString(),
      originalStrategy: 'data-test',
      healedStrategy: 'id',
      healedSelector: '#login-button',
      source: 'strategy-chain',
    });

    const candidates = testStore.getPomUpdateCandidates();
    expect(candidates).toContain('test.storeVerification');

    // Verify retirement
    testStore.retireHeal('test.storeVerification');
    expect(testStore.getEntry('test.storeVerification')).toBeUndefined();

    console.log('HV005 - HealStore records, retrieves, tracks candidates, retires correctly');
  });

  test('HV006 - HealReporter generates correct report and markdown', async ({ guestPage }) => {
    const reporter = new HealReporter();

    reporter.addEvent({
      key: 'test.reportVerification',
      timestamp: new Date().toISOString(),
      originalStrategy: 'data-test',
      healedStrategy: 'id',
      healedSelector: '#login-button',
      source: 'strategy-chain',
    });

    const report = reporter.generateReport();

    expect(report.healsAttempted).toBe(1);
    expect(report.healsSucceeded).toBe(1);
    expect(report.healsFailed).toBe(0);
    expect(report.visionCallsUsed).toBe(0);
    expect(report.events).toHaveLength(1);
    expect(report.events[0].key).toBe('test.reportVerification');

    console.log('HV006 - HealReporter generates correct report structure');
  });

  test('HV007 - VisionHealer respects budget and missing API key gracefully', async ({ guestPage }) => {
    // Test with no API key
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const healer = new VisionHealer(guestPage);
    const result = await healer.heal('Login button on the login form');

    expect(result.success).toBe(false);
    expect(result.reasoning).toContain('ANTHROPIC_API_KEY not set');

    // Restore
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
    resetVisionBudget();
    console.log('HV007 - VisionHealer respects budget and missing API key gracefully');
  });
});
