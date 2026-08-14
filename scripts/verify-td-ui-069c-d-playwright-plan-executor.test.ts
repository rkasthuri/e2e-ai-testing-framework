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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PlaywrightPlanExecutor,
  type ExecutionSessionFactory,
} from '../src/core/execution/PlaywrightPlanExecutor'
import type {
  CredentialExecutionScope,
  CredentialMaterial,
} from '../src/core/security/CredentialExecutionScope'
import { EnvironmentCredentialExecutionScope } from '../src/core/security/CredentialExecutionScope'
import type { CanonicalExecutablePlan } from '../src/core/execution/ExecutablePlanContract'

const secret = 'super-secret-value'

function plan(overrides: Record<string, unknown> = {}): CanonicalExecutablePlan {
  return {
    schemaVersion: 1,
    planId: 'plan-1',
    definitionId: 'definition-1',
    title: 'Navigate to observed inventory route',
    category: 'navigation',
    steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory', routePath: '/inventory.html' }],
    oracle: { kind: 'subject_observable', subjectId: 'inventory', assertion: 'final_url_matches_route_no_navigation_error' },
    provenance: {
      definitionId: 'definition-1', sourceObservationId: 'observation-1', modelRowId: 1,
      modelVersion: '1.0.0', supportingEvidenceIds: ['evidence-1'], testSetId: 'test-set-1', revision: 1,
    },
    authenticationRequired: false,
    projectedAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  }
}

class Resolver implements CredentialExecutionScope {
  calls = 0
  constructor(private readonly material: CredentialMaterial | null) {}
  isAvailable(): boolean { return this.material !== null }
  async run<T>(_reference: unknown, operation: (material: CredentialMaterial) => Promise<T>) {
    this.calls++
    return this.material
      ? { kind: 'completed' as const, value: await operation(this.material) }
      : { kind: 'unavailable' as const }
  }
  runProvided<T>(material: { username: string; password: string }, operation: (material: CredentialMaterial) => Promise<T>): Promise<T> {
    return operation(material)
  }
}

interface SessionOptions {
  auth?: boolean | Error
  navigation?: Error
  finalUrl?: string
}

function sessionFactory(options: SessionOptions = {}) {
  const state = { authCalls: 0, navigationCalls: 0, closeCalls: 0, loginUrl: '', targetUrl: '', credentialsSeen: null as CredentialMaterial | null }
  const factory: ExecutionSessionFactory = async () => ({
    async authenticateFormLogin(loginUrl, credentials) {
      state.authCalls++; state.loginUrl = loginUrl; state.credentialsSeen = { ...credentials }
      if (options.auth instanceof Error) throw options.auth
      return options.auth ?? true
    },
    async navigate(url) { state.navigationCalls++; state.targetUrl = url; if (options.navigation) throw options.navigation },
    currentUrl() { return options.finalUrl ?? state.targetUrl },
    async close() { state.closeCalls++ },
  })
  return { state, factory }
}

const authSetup = {
  mechanism: 'form-login',
  credentialReference: { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' },
  provenance: { sourceObservationId: 'observation-1' },
}

test('TD069C-D-1 auth-free navigation and subject_observable oracle complete', async () => {
  const harness = sessionFactory()
  const result = await new PlaywrightPlanExecutor(new Resolver(null), harness.factory).execute(plan(), { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.test/inventory.html' })
  assert.equal(harness.state.authCalls, 0)
  assert.equal(harness.state.closeCalls, 1)
})

test('TD069C-D-2 form-login resolves credentials, authenticates, then navigates', async () => {
  const resolver = new Resolver({ username: 'fixture-user-069cd', password: secret })
  const harness = sessionFactory()
  const result = await new PlaywrightPlanExecutor(resolver, harness.factory).execute(
    plan({ authenticationRequired: true, authenticationSetup: authSetup }),
    { baseUrl: 'https://example.test', loginUrl: 'https://example.test/login' },
  )
  assert.equal(result.status, 'completed')
  assert.equal(resolver.calls, 1)
  assert.equal(harness.state.loginUrl, 'https://example.test/login')
  assert.deepEqual(harness.state.credentialsSeen, { username: 'fixture-user-069cd', password: secret })
})

test('TD069C-D-2b credential material is disposed before route navigation and oracle evaluation', async () => {
  let retained: CredentialMaterial | null = null
  const executor = new PlaywrightPlanExecutor(
    new EnvironmentCredentialExecutionScope({
      SAUCEDEMO_USERNAME: 'scoped-user', SAUCEDEMO_PASSWORD: secret,
    }),
    async () => {
      let current = 'https://example.test/login'
      return {
        async authenticateFormLogin(_loginUrl, credentials) { retained = credentials; return true },
        async navigate(url) {
          assert.throws(() => retained!.username, /no longer available/)
          assert.throws(() => retained!.password, /no longer available/)
          current = url
        },
        currentUrl() { return current },
        async close() {},
      }
    },
  )
  const result = await executor.execute(
    plan({ authenticationRequired: true, authenticationSetup: authSetup }),
    { baseUrl: 'https://example.test', loginUrl: 'https://example.test/login' },
  )
  assert.equal(result.status, 'completed')
})

test('TD069C-D-3 missing credentials fails before allocating browser resources', async () => {
  const harness = sessionFactory()
  const result = await new PlaywrightPlanExecutor(new Resolver(null), harness.factory).execute(
    plan({ authenticationRequired: true, authenticationSetup: authSetup }), { baseUrl: 'https://example.test' },
  )
  assert.deepEqual(result, { status: 'authentication_failed', reasonCode: 'credential_missing' })
  assert.equal(harness.state.navigationCalls, 0)
  assert.equal(harness.state.closeCalls, 0)
})

test('TD069C-D-4 authentication rejection and authentication exception remain authentication_failed', async () => {
  for (const auth of [false, new Error(`must-not-leak-${secret}`)]) {
    const harness = sessionFactory({ auth })
    const result = await new PlaywrightPlanExecutor(new Resolver({ username: 'user', password: secret }), harness.factory).execute(
      plan({ authenticationRequired: true, authenticationSetup: authSetup }), { baseUrl: 'https://example.test' },
    )
    assert.deepEqual(result, { status: 'authentication_failed', reasonCode: 'authentication_failed' })
    assert.equal(harness.state.closeCalls, 1)
  }
})

test('TD069C-D-5 navigation failure is distinct and cleans up', async () => {
  const harness = sessionFactory({ navigation: new Error(`must-not-leak-${secret}`) })
  const result = await new PlaywrightPlanExecutor(new Resolver(null), harness.factory).execute(plan(), { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'navigation_failed', reasonCode: 'navigation_failed' })
  assert.equal(harness.state.closeCalls, 1)
})

test('TD069C-D-6 final URL mismatch is oracle_failed, not navigation_failed', async () => {
  const harness = sessionFactory({ finalUrl: 'https://example.test/other.html' })
  const result = await new PlaywrightPlanExecutor(new Resolver(null), harness.factory).execute(plan(), { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl: 'https://example.test/other.html' })
})

test('TD069C-D-7 unsupported action fails closed before session creation', async () => {
  let created = 0
  const executor = new PlaywrightPlanExecutor(new Resolver(null), async () => { created++; throw new Error('should not start') })
  const result = await executor.execute(plan({ steps: [{ kind: 'click', subjectId: 'inventory' }] }) as any, { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'unsupported_plan', reasonCode: 'unsupported_action' })
  assert.equal(created, 0)
})

test('TD069C-D-8 unsupported oracle fails closed before session creation', async () => {
  let created = 0
  const executor = new PlaywrightPlanExecutor(new Resolver(null), async () => { created++; throw new Error('should not start') })
  const result = await executor.execute(plan({ oracle: { kind: 'content_exists', subjectId: 'inventory' } }) as any, { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'unsupported_plan', reasonCode: 'unsupported_oracle' })
  assert.equal(created, 0)
})

test('TD069C-D-9 unsupported auth uses the shared vocabulary and fails closed', async () => {
  const result = await new PlaywrightPlanExecutor(new Resolver(null), async () => { throw new Error('should not start') }).execute(
    plan({ authenticationRequired: true, authenticationSetup: { ...authSetup, mechanism: 'oauth' } }) as any,
    { baseUrl: 'https://example.test' },
  )
  assert.deepEqual(result, { status: 'unsupported_plan', reasonCode: 'unsupported_auth_mechanism' })
})

test('TD069C-D-10 executor neither mutates its plan nor leaks secrets in results or errors', async () => {
  const value = plan({ authenticationRequired: true, authenticationSetup: authSetup })
  const before = structuredClone(value)
  const harness = sessionFactory({ auth: new Error(`must-not-leak-${secret}`) })
  const result = await new PlaywrightPlanExecutor(new Resolver({ username: 'user', password: secret }), harness.factory).execute(value, { baseUrl: 'https://example.test' })
  assert.deepEqual(value, before)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.ok(!JSON.stringify(value).includes(secret))
})

test('TD069C-D-11 session creation failure is executor_failure and exposes no raw error', async () => {
  const result = await new PlaywrightPlanExecutor(new Resolver(null), async () => { throw new Error(`must-not-leak-${secret}`) }).execute(plan(), { baseUrl: 'https://example.test' })
  assert.deepEqual(result, { status: 'executor_failure', reasonCode: 'executor_failure' })
  assert.ok(!JSON.stringify(result).includes(secret))
})
