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
 * TD-148 — login-surface OBSERVATION (observation-only surface). The contract is now:
 * did we accurately record what we observed, and does the payload avoid implying
 * interpretation? (No verdict, no comparison, no configured value, no remedy.)
 *   O1 each observation carries all three parts; non-implications name competing causes
 *   O2 payload has NO verdict / comparison / configured value / retired outcome vocabulary
 *   O3 no remedy, no re-onboard on this path
 *   O4 fires ONLY on auth failure; non-web app types never observe
 *   O5 banned-word check: wording rules + retired outcome vocabulary absent from the payload
 *   O6 a not-observed observation records the reason in its mechanism (never a bare absence)
 *   O7 observed path records FACTUAL values (present/0/spa/url)
 *   O8 mechanism-scoped, not relevance-scoped; the note separates observation from interpretation
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  observeLoginSurface, buildLoginSurfaceDiagnostic, shouldObserveLoginSurface,
} from '../src/core/onboarding/LoginSurfaceObservation'
import { OnboardingConfig, LoginSurfaceSignal } from '../src/core/onboarding/types'

const cfg = (over: Record<string, unknown> = {}): OnboardingConfig => ({
  app: { name: 'demo', baseUrl: 'https://app.example.com', appType: 'web-ui' },
  appType: 'web-ui',
  roles: [{ id: 'r', displayName: 'r', authFlow: 'form-login', credentialsEnvKey: 'X' }],
  ...over,
} as unknown as OnboardingConfig)

// minimal mock page: url() + goto() + locator(sel).count(); DomcontentloadedPolicy.settle is a no-op.
const mockFactory = (o: { url?: string; password?: boolean; spaDom?: number; spaScript?: number; links?: number; forms?: number }) =>
  async () => ({
    page: {
      url: () => o.url ?? 'https://app.example.com/login',
      goto: async () => {},
      waitForTimeout: async () => {},   // TD-173: detectRenderingModel takes a fixed delayed sample
      locator: (sel: string) => ({ count: async () => {
        if (sel === 'input[type="password"]') return o.password ? 1 : 0
        if (sel.includes('#root')) return o.spaDom ?? 0
        if (sel.includes('script[src')) return o.spaScript ?? 0
        if (sel === 'a[href]') return o.links ?? 0
        if (sel === 'form') return o.forms ?? 0
        return 0
      } }),
    } as any,
    close: async () => {},
  })

const bySignal = (obs: LoginSurfaceSignal[], s: string) => obs.find(o => o.signal === s)!
const RETIRED_VOCAB = ['divergence-detected', 'no-divergence-detected', 'inconclusive']

test('O1 each observation carries all three parts; boundary names competing causes', async () => {
  const diag = await observeLoginSurface(cfg(), mockFactory({ password: false, spaDom: 1 }))
  const obs = diag.loginSurfaceObservation!.observations
  assert.equal(obs.length, 3)
  for (const o of obs) {
    assert.ok(o.observation.length > 0 && o.mechanism.length > 0 && o.observationBoundary.length > 0, `${o.signal} missing a part`)
  }
  // Each boundary names its OWN specific competing causes — not a generic disclaimer.
  const pf = bySignal(obs, 'password-field').observationBoundary
  assert.match(pf, /SSO/); assert.match(pf, /WAF|bot-wall|interstitial/)
  assert.match(pf, /session was already active/); assert.match(pf, /not yet appeared/)
  const as = bySignal(obs, 'app-shape').observationBoundary
  assert.match(as, /static login shell/); assert.match(as, /hydrating/); assert.match(as, /maintenance or interstitial/)
  const lu = bySignal(obs, 'landing-url').observationBoundary
  assert.match(lu, /reverse proxy/); assert.match(lu, /redirect/); assert.match(lu, /geo or tenant/); assert.match(lu, /having moved/)
})

test('O2 payload has NO verdict / comparison / configured value / retired outcome vocabulary', async () => {
  const diag = await observeLoginSurface(cfg(), mockFactory({ password: true }))
  const payload = JSON.stringify(diag)
  for (const v of RETIRED_VOCAB) assert.ok(!payload.includes(v), `retired outcome vocabulary present: ${v}`)
  assert.ok(!payload.includes('"configured"'), 'no configured-value field in an observation-only payload')
  assert.ok(!payload.includes('"checked"') && !payload.includes('notChecked'), 'no manifest — nothing is claimed')
  assert.ok(!('identityDivergence' in diag), 'the retired report shape is gone')
  assert.equal(diag.reason, 'login-surface-observation')
})

test('O3 no remedy, no re-onboard on this path', async () => {
  const diag = await observeLoginSurface(cfg(), mockFactory({ password: false }))
  assert.equal(diag.remedy, undefined)                       // observation prescribes nothing
  assert.ok(!/re-onboard/i.test(diag.detail), 'no re-onboard instruction')
})

test('O4 fires ONLY on auth failure; non-web app types never observe', () => {
  assert.equal(shouldObserveLoginSurface({ r: 'succeeded' }, cfg()), false)
  assert.equal(shouldObserveLoginSurface({ r: 'unknown' }, cfg()), false)
  assert.equal(shouldObserveLoginSurface({ r: 'failed' }, cfg()), true)
  assert.equal(shouldObserveLoginSurface({}, cfg({ roles: [], unmetAuth: { authType: 'form-login' } })), true)
  assert.equal(shouldObserveLoginSurface({}, cfg({ roles: [] })), false)
  assert.equal(shouldObserveLoginSurface({ r: 'failed' }, cfg({ appType: 'rest-api' })), false)
})

test('O5 wording rules hold + retired outcome vocabulary absent from the payload', async () => {
  const diag = await observeLoginSurface(cfg(), mockFactory({ password: false }))
  const p = JSON.stringify(diag).toLowerCase()
  for (const banned of ['stale', 'fresh', '"clean', ' clean ', 'divergence', 'inconclusive']) {
    assert.ok(!p.includes(banned), `banned/retired term in payload: ${banned}`)
  }
})

test('O6 a not-observed observation records the reason in its mechanism (never a bare absence)', async () => {
  const throwing = async () => { throw new Error('net::ERR_CONNECTION_REFUSED') }
  const diag = await observeLoginSurface(cfg(), throwing as any)
  const obs = diag.loginSurfaceObservation!.observations
  for (const o of obs) {
    assert.equal(o.observation, 'not observed')
    assert.match(o.mechanism, /not obtained: .*ERR_CONNECTION_REFUSED/)   // the reason, not a bare "not detected"
  }
})

test('O7 observed path records FACTUAL values (present / 0 / framework-rendered / url)', async () => {
  const withForm = await observeLoginSurface(cfg(), mockFactory({ password: true, spaDom: 1, url: 'https://app.example.com/login' }))
  const o1 = withForm.loginSurfaceObservation!.observations
  assert.equal(bySignal(o1, 'password-field').observation, 'password field present')
  assert.equal(bySignal(o1, 'app-shape').observation, 'framework-rendered')   // ADR-021: rendering value (was 'spa')
  assert.equal(bySignal(o1, 'landing-url').observation, 'https://app.example.com/login')
  const noForm = await observeLoginSurface(cfg(), mockFactory({ password: false }))
  assert.equal(bySignal(noForm.loginSurfaceObservation!.observations, 'password-field').observation, '0 password fields')
})

test('O8 mechanism-scoped, not relevance-scoped; note separates observation from interpretation', async () => {
  const diag = await observeLoginSurface(cfg(), mockFactory({ password: false }))
  const note = diag.loginSurfaceObservation!.note
  assert.match(note, /context for investigation/i)
  assert.match(note, /not used to infer/i)
  assert.ok(!/\brelevant\b|\brelevance\b/i.test(JSON.stringify(diag)), 'must not claim relevance — mechanism-scoped only')
  // pure builder: three-part fixture composes into the detail
  const built = buildLoginSurfaceDiagnostic(
    [{ signal: 'password-field', observation: '0 password fields', mechanism: 'M', observationBoundary: 'N' }], 'demo')
  assert.equal(built.loginSurfaceObservation!.check, 'login-surface-observation')
  assert.match(built.detail, /0 password fields/)
  assert.match(built.detail, /context for investigation/i)
})
