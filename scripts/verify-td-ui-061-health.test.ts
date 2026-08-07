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
 * TD-UI-061 — surgical-bridge proof (B1–B4).
 *
 * The deprecated src/platform dashboard header health badge must NOT fabricate
 * green on absent / could-not-verify evidence. The resolution + presentation were
 * extracted into src/platform/healthState.ts (a pure, side-effect-free seam —
 * dashboard-server.ts starts an HTTP server at import, so it can't be imported
 * directly; SEAM ADDED, noted per the brief). These tests exercise that seam.
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveOverallHealth, healthBadgeLabel, healthBadgeColors,
} from '../src/platform/healthState'

const GREEN = '#059669'   // 'Healthy' text color
const RED   = '#dc2626'   // 'At Risk' / 'Failing' text color
const GREY  = '#6b7280'   // 'Unknown' neutral text color

// B1 — a run present but the LATEST run verified nothing (could-not-verify).
test('B1 latest run could-not-verify (status=unknown) → Unknown, NOT Healthy', () => {
  const state = resolveOverallHealth({
    hasEvidence: true, latestStatus: 'unknown',
    highRisk: 0, streak: 5, triageFailed: 0, visualChanges: 0,
  })
  assert.equal(state, 'Unknown')
  assert.notEqual(state, 'Healthy')
  assert.equal(healthBadgeLabel(state), 'Insufficient Evidence')   // honest words, not "Healthy"
  assert.equal(healthBadgeColors(state).color, GREY)               // neutral, not green
})

// B2 — empty run set: no evidence at all. THE core lie (empty → green 'Healthy').
test('B2 empty run set → Unknown neutral, NOT Healthy/green, NOT a fabricated pass', () => {
  const state = resolveOverallHealth({
    hasEvidence: false, latestStatus: undefined,
    highRisk: 0, streak: 0, triageFailed: 0, visualChanges: 0,
  })
  assert.equal(state, 'Unknown')
  assert.notEqual(state, 'Healthy')       // was the lie: empty fell through to 'Healthy'
  assert.notEqual(state, 'Failing')       // absence ≠ failure — never red-fail either
  const { color } = healthBadgeColors(state)
  assert.equal(color, GREY)
  assert.notEqual(color, GREEN)
  assert.notEqual(color, RED)
  // label carries no number and does not say "Healthy"
  const label = healthBadgeLabel(state)
  assert.equal(label, 'Insufficient Evidence')
  assert.ok(!/\d/.test(label), 'label must contain no fabricated number')
  assert.ok(!/health/i.test(label), 'label must not claim health')
})

// B3 — real evidence, honest cases preserved (we don't break the present-honest path).
test('B3 real run, real results → honest verdict preserved (Healthy AND real risk both surface)', () => {
  // clean passing run, no adverse signal → genuinely Healthy (green)
  const healthy = resolveOverallHealth({
    hasEvidence: true, latestStatus: 'passed',
    highRisk: 0, streak: 5, triageFailed: 0, visualChanges: 0,
  })
  assert.equal(healthy, 'Healthy')
  assert.equal(healthBadgeColors(healthy).color, GREEN)
  // a real risk still surfaces as a real verdict (not masked by the honesty gate)
  const atRisk = resolveOverallHealth({
    hasEvidence: true, latestStatus: 'passed',
    highRisk: 3, streak: 0, triageFailed: 0, visualChanges: 0,
  })
  assert.equal(atRisk, 'At Risk')
  const failing = resolveOverallHealth({
    hasEvidence: true, latestStatus: 'failed',
    highRisk: 0, streak: 0, triageFailed: 2, visualChanges: 0,
  })
  assert.equal(failing, 'Failing')
})

// B4 — the honesty gate DOMINATES: even with a stale clean streak, no evidence →
// Unknown (the gate is checked before the risk/triage/visual rules).
test('B4 honesty gate dominates the risk rules (no evidence never yields Healthy)', () => {
  const state = resolveOverallHealth({
    hasEvidence: false, latestStatus: undefined,
    highRisk: 0, streak: 99, triageFailed: 0, visualChanges: 0,   // would-be "Healthy" inputs
  })
  assert.equal(state, 'Unknown')
  // and the Unknown color is never the green Healthy nor the red Failing token
  assert.notEqual(healthBadgeColors(state).color, GREEN)
  assert.notEqual(healthBadgeColors(state).color, RED)
})
