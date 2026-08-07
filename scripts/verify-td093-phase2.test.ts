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
 * TD-093 Phase 2 — proof tests (Mission, GoalSynthesizer, BootstrapEvidence, GoalOrigin).
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`,
 * the scripts/*.test.ts glob). Pure in-memory — no browser, no HTTP, no I/O.
 *
 * NOTE on type-level tests (T7/T8): scripts/ is NOT under the check:core tsconfig
 * (include is src/** only), so @ts-expect-error is not enforced here. The POSITIVE
 * constructions below prove the types accept correct values at compile-under-tsx;
 * the NEGATIVE proofs (agentSupervised: false rejected, origin: 'invented'
 * rejected) are demonstrated by targeted tsc probes in the Step-7 report.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Mission, Missions } from '../src/core/agent/Mission'
import { DefaultGoalSynthesizer, PageSignals } from '../src/core/agent/GoalSynthesizer'
import { BootstrapEvidencePackage } from '../src/core/onboarding/BootstrapEvidence'
import { Goal, GoalOrigin } from '../src/core/agent/types'

function signalsWith(navCount: number, buttons: string[] = []): PageSignals {
  return {
    navLinks: Array.from({ length: navCount }, (_, i) => ({ text: `Link ${i}`, href: `/page-${i}` })),
    buttonTexts: buttons,
    formPresence: true,
    currentUrl: 'https://example.com/',
    pageTitle: 'Example',
  }
}

// ── Mission factory ───────────────────────────────────────────────────────────

test('T1 Missions.bootstrap() produces the canonical bootstrap policy', () => {
  const m = Missions.bootstrap()
  assert.equal(m.type, 'bootstrap')
  assert.equal(m.depthBudget, 2)
  assert.equal(m.authAttemptsPermitted, true)
  assert.equal(m.optimizeFor, 'information-gain')
  assert.equal(m.label, 'Bootstrap: first-time app discovery')
})

test('T2 Missions.bootstrap().supervisedOnly === true (hard-lock documented)', () => {
  assert.equal(Missions.bootstrap().supervisedOnly, true)
})

test('T3 Missions.crawl() is NOT supervised-only (contrast)', () => {
  const m = Missions.crawl()
  assert.equal(m.supervisedOnly, false)
  assert.equal(m.type, 'crawl')
  assert.equal(m.depthBudget, 10)
  assert.equal(m.optimizeFor, 'efficiency')
})

// ── GoalSynthesizer ───────────────────────────────────────────────────────────

test('T4 synthesize() with nav links -> every goal pending + origin=synthesized', () => {
  const goals = new DefaultGoalSynthesizer().synthesize(signalsWith(3), Missions.bootstrap())
  assert.ok(goals.length > 0, 'goals were synthesized')
  for (const g of goals) {
    assert.equal(g.status, 'pending')
    assert.equal(g.origin, 'synthesized')
  }
})

test('T5 synthesize() generates ZERO evidence (evidence starts only at execution)', () => {
  const goals = new DefaultGoalSynthesizer().synthesize(
    signalsWith(4, ['Sign In']), Missions.bootstrap())
  assert.ok(goals.length > 0)
  for (const g of goals) {
    assert.equal(g.evidenceChain.length, 0,
      `VACUITY: goal ${g.id} must carry no EvidenceRecords at synthesis`)
  }
})

test('T6 bootstrap mission caps candidates at 5 (even with more signals)', () => {
  const goals = new DefaultGoalSynthesizer().synthesize(
    signalsWith(9, ['Login']), Missions.bootstrap())   // 9 nav + 1 auth candidate = 10
  assert.equal(goals.length, 5, 'bootstrap cap is 5')
  // Contrast: a crawl mission is uncapped for the same signals.
  const crawlGoals = new DefaultGoalSynthesizer().synthesize(
    signalsWith(9, ['Login']), Missions.crawl())
  assert.equal(crawlGoals.length, 10, 'crawl mission is uncapped')
})

test('T6b verification mission (auth not permitted) synthesizes no auth goal', () => {
  const goals = new DefaultGoalSynthesizer().synthesize(
    signalsWith(2, ['Sign In']), Missions.verification())
  assert.ok(!goals.some(g => g.successCriteria.some(c => c.locator === 'input[type="password"]')),
    'authAttemptsPermitted=false suppresses the auth goal')
})

test('T6c junk links (hash/javascript/empty) are filtered, hrefs deduped', () => {
  const signals: PageSignals = {
    navLinks: [
      { text: 'Real', href: '/real' },
      { text: 'Dup',  href: '/real' },          // dedup by href
      { text: 'Hash', href: '#' },              // junk
      { text: 'JS',   href: 'javascript:void(0)' }, // junk
      { text: '',     href: '/no-text' },       // junk (no text)
    ],
    buttonTexts: [], formPresence: false,
    currentUrl: 'https://example.com/', pageTitle: 'X',
  }
  const goals = new DefaultGoalSynthesizer().synthesize(signals, Missions.bootstrap())
  assert.equal(goals.length, 1, 'only the one real, distinct link becomes a goal')
})

// ── BootstrapEvidencePackage type ─────────────────────────────────────────────

test('T7 BootstrapEvidencePackage.agentSupervised is literal true', () => {
  // POSITIVE type proof: this construction compiles with agentSupervised: true.
  // (Negative — agentSupervised: false — is rejected by tsc; proven by the
  // Step-7 targeted compile probe, since scripts/ is outside check:core.)
  const pkg: BootstrapEvidencePackage = {
    schemaVersion: '1.0', appName: 'x', url: 'https://x', missionType: 'bootstrap',
    producedAt: 't', agentSupervised: true, records: [],
    synthesizedGoalCount: 0, achievedGoalCount: 0, blockedGoalCount: 0,
    unreachableGoalCount: 0, authAttempted: false, authOutcome: 'not-attempted', notes: [],
  }
  assert.equal(pkg.agentSupervised, true)
  assert.equal(pkg.missionType, 'bootstrap')
})

// ── GoalOrigin ────────────────────────────────────────────────────────────────

test('T8 Goal accepts origin=synthesized and origin=user (valid GoalOrigin values)', () => {
  const mk = (origin: GoalOrigin): Goal => ({
    id: 'g', type: 'state', origin, description: 'd', successCriteria: [],
    prerequisites: [], status: 'pending', evidenceChain: [], createdAt: 't',
  })
  assert.equal(mk('synthesized').origin, 'synthesized')
  assert.equal(mk('user').origin, 'user')
  assert.equal(mk('observed').origin, 'observed')
  // Negative ('invented') is a tsc rejection — proven by the Step-7 compile probe.
})
