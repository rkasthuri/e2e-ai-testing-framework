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
 * TD-UI-031 Block 4 — crawlDiagnostics + the corrected EmptyModelError. The
 * error message is DERIVED from evidenceState + crawlDiagnostics (never the false
 * "onboarded but never crawled"); the new 'auth-required' reason is distinct from
 * 'auth-failed'; and both diagnostic shapes validate against the v2 schema.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EmptyModelError } from '../src/core/errors/OperatorFacingError'
import { validateAppModelObject } from '../src/core/onboarding/ModelValidator'

// ── EmptyModelError message is derived, honest, and remedy-bearing ───────────────

test('E1 unsupported-platform → "FORGE cannot crawl", no false "never crawled"', () => {
  const msg = new EmptyModelError('some-mobile', { evidenceState: 'unsupported-platform' }).message
  assert.match(msg, /FORGE cannot crawl 'some-mobile'/)
  assert.doesNotMatch(msg, /never crawled|onboarded/)
})

test('E2 crawled-empty + auth-required diagnostic → states the crawl RAN + carries the remedy', () => {
  const msg = new EmptyModelError('saucedemo', {
    evidenceState: 'crawled-empty',
    diagnostics: [{
      reason: 'auth-required',
      detail: 'saucedemo requires form-login but no credentials were supplied; no role was crawlable and the start page was never visited.',
      remedy: { action: 'Set SAUCEDEMO_USERNAME and SAUCEDEMO_PASSWORD, then re-crawl.' },
    }],
  }).message
  assert.match(msg, /ran but discovered no pages/)              // the crawl RAN (not "never crawled")
  assert.match(msg, /no credentials were supplied/)             // the WHY
  assert.match(msg, /Remedy: Set SAUCEDEMO_USERNAME/)           // the remedy
  assert.doesNotMatch(msg, /never crawled|onboarded/)           // the old lie is gone
})

test('E3 crawled-empty, no diagnostic → says plainly it does not know why (honest floor)', () => {
  const msg = new EmptyModelError('mystery', { evidenceState: 'crawled-empty', diagnostics: null }).message
  assert.match(msg, /ran but discovered no pages/)
  assert.match(msg, /could not determine why/)
  assert.doesNotMatch(msg, /never crawled|onboarded/)
})

// ── the diagnostic shapes are schema-valid on a crawled-empty model ──────────────

const emptyModelWith = (diagnostics: unknown) => ({
  schemaVersion: '2.0', generatedAt: '2026-07-14T00:00:00.000Z', generatedBy: 'human',
  app: {
    name: 'x', displayName: 'X', baseUrl: 'https://x.example.com', appType: 'web-ui',
    modelVersion: '1.0.0', spaConfig: null, evidenceState: 'crawled-empty',
    crawlMetadata: {
      crawlConfigHash: 'sha256:x', crawledAt: '2026-07-14T00:00:00.000Z', crawledBy: 'human',
      crawlDurationMs: 300, pagesBudget: 50, pagesDiscovered: 0, pagesSkipped: 0,
      aiBudgetStatus: 'within-budget', crawlDiagnostics: diagnostics,
    },
  },
  roles: [], pages: [], flows: [], endpoints: null, api: null, diff: null,
})

test('D1 auth-required diagnostic validates against the v2 schema', () => {
  const m = emptyModelWith([{
    scope: 'role', target: 'saucedemo', reason: 'auth-required',
    detail: 'requires form-login but no credentials were supplied.',
    remedy: { tier: 2, action: 'Set SAUCEDEMO_USERNAME and SAUCEDEMO_PASSWORD, then re-crawl.' },
  }])
  const { valid, errors } = validateAppModelObject(m)
  assert.equal(valid, true, errors.join('; '))
})

test('D2 zero-clickables diagnostic (tier-1 remedy) validates against the v2 schema', () => {
  const m = emptyModelWith([{
    scope: 'start-page', target: 'https://x.example.com', reason: 'zero-clickables',
    detail: '0 navigable links and 0 JS clickables.',
    remedy: { tier: 1, action: 'Let FORGE attempt agentic exploration of the start page.' },
  }])
  const { valid, errors } = validateAppModelObject(m)
  assert.equal(valid, true, errors.join('; '))
})

test('D3 an unknown reason value is REJECTED (enum is closed)', () => {
  const m = emptyModelWith([{
    scope: 'role', target: 'x', reason: 'made-up-reason',
    detail: 'x', remedy: { tier: 2, action: 'x' },
  }])
  assert.equal(validateAppModelObject(m).valid, false)
})
