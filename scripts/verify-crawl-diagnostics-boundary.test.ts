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
 * TD-UI-064 — PERMANENT invariant of CrawlDiagnostics: the login-surface observation
 * boundary TRAVELS WITH the value. `observationView` is the SOLE gate the card renders
 * through, so a value can never reach the DOM without its boundary. A 'withheld' view
 * carries NO value/mechanism/boundary — only an explicit statement — so nothing bare can be
 * shown. No exception for a pre-rename model (missing observationBoundary), a blank boundary,
 * or a future signal that supplies none. Rendering a value without its blind spot is the
 * exact TD-148 defect the component exists to prevent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observationView, WITHHELD_STATEMENT } from '../forge-ui/src/components/shared/CrawlDiagnostics'
import type { LoginSurfaceSignal } from '../forge-ui/src/api/types'

const obs = (over: Partial<LoginSurfaceSignal> & { signal: LoginSurfaceSignal['signal'] }): LoginSurfaceSignal =>
  ({ observation: 'V', mechanism: 'M', observationBoundary: 'B', ...over } as LoginSurfaceSignal)

test('empty observationBoundary → WITHHELD; the view carries no value', () => {
  const v = observationView(obs({ signal: 'app-shape', observation: 'SENTINEL_SPA', observationBoundary: '' }))
  assert.equal(v.kind, 'withheld')
  assert.equal(JSON.stringify(v).includes('SENTINEL_SPA'), false, 'the withheld view must not carry the value')
  assert.equal((v as any).statement, WITHHELD_STATEMENT)
})

test('missing observationBoundary field (pre-rename model) → WITHHELD', () => {
  const bare = { signal: 'password-field', observation: 'SENTINEL_PW', mechanism: 'M' } as unknown as LoginSurfaceSignal
  const v = observationView(bare)
  assert.equal(v.kind, 'withheld')
  assert.equal(JSON.stringify(v).includes('SENTINEL_PW'), false, 'no value when the boundary field is absent')
})

test('whitespace-only observationBoundary → WITHHELD', () => {
  const v = observationView(obs({ signal: 'landing-url', observation: 'https://SENTINEL_URL', observationBoundary: '   ' }))
  assert.equal(v.kind, 'withheld')
  assert.equal(JSON.stringify(v).includes('SENTINEL_URL'), false, 'no value with a blank boundary')
})

test('complete observation → FULL; value, mechanism, and boundary travel together', () => {
  const v = observationView(obs({ signal: 'app-shape', observation: 'SENTINEL_OK', mechanism: 'MECH_OK', observationBoundary: 'BOUND_OK' }))
  assert.equal(v.kind, 'full')
  assert.equal((v as any).observation, 'SENTINEL_OK')
  assert.equal((v as any).mechanism, 'MECH_OK')
  assert.equal((v as any).observationBoundary, 'BOUND_OK')
})

test('WITHHELD_STATEMENT is an explicit, cause-naming statement (not a bare placeholder)', () => {
  assert.match(WITHHELD_STATEMENT, /withheld/i)
  assert.match(WITHHELD_STATEMENT, /before the boundary field existed|a signal that supplies none/i)
})
