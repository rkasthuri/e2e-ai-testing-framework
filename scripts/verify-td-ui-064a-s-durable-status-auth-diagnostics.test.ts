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
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Browser } from '@playwright/test'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import { JobRunner, ObservationStatusReadError, type JobStatus } from '../forge-ui/server/jobs/JobRunner'
import { logBuffer } from '../forge-ui/server/registry/LogBuffer'
import {
  ObservationStore,
  type ObservationStartRecord,
  type ObservationTerminalRecord,
} from '../forge-ui/server/registry/ObservationStore'

const fixtureResolvers = new WeakMap<ObservationStore, WorkspaceResolver>()

function persistLegacyFixture(store: ObservationStore, start: ObservationStartRecord, terminal?: ObservationTerminalRecord): void {
  const resolver = fixtureResolvers.get(store)
  assert.ok(resolver)
  const dir = path.join(resolver.resolve(start.projectId).forgeDir, 'observations', start.observationId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'started.json'), JSON.stringify(start, null, 2), 'utf8')
  if (terminal) fs.writeFileSync(path.join(dir, 'terminal.json'), JSON.stringify(terminal, null, 2), 'utf8')
}
import {
  authenticationAttempts,
  authenticationFailureRecommendation,
} from '../forge-ui/server/routes/crawl'
import {
  AuthManager,
  summarizeAuthenticationStages,
} from '../src/core/onboarding/AuthManager'
import { validateAppModelObject } from '../src/core/onboarding/ModelValidator'
import type { AuthenticationStageDiagnostic, OnboardingConfig, RoleConfig } from '../src/core/onboarding/types'
import { representativeNinePageCandidate } from './fixtures/td-ui-064a-rd2-nine-page-candidate'

function disposableStore(projects: string[]): {
  root: string
  resolver: WorkspaceResolver
  store: ObservationStore
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-064a-s-'))
  const resolver = new WorkspaceResolver(root)
  const store = new ObservationStore(resolver, {
    list: () => projects.map(appName => ({ appName })) as any,
  })
  fixtureResolvers.set(store, resolver)
  return { root, resolver, store }
}

function startRecord(
  projectId: string,
  observationId: string,
): ObservationStartRecord {
  return {
    schemaVersion: 1,
    observationId,
    projectId,
    projectName: projectId,
    observationContext: {
      id: observationId,
      label: 'Disposable crawl observation',
      target: 'https://fixture.invalid',
      declaredScope: 'fixture-only',
      strategy: 'fixture',
    },
    sourceKind: 'crawl-engine',
    startedAt: '2026-08-05T12:00:00.000Z',
    credentialAvailability: 'available',
    authenticationExpectation: 'form-login',
  }
}

function terminalRecord(
  start: ObservationStartRecord,
  terminalState: ObservationTerminalRecord['terminalState'] = 'partially_completed',
): ObservationTerminalRecord {
  return {
    ...start,
    completedAt: '2026-08-05T12:01:00.000Z',
    terminalState,
    stateReason: 'Disposable evidence remained bounded.',
    authentication: {
      expectation: start.authenticationExpectation,
      credentialAvailability: start.credentialAvailability,
      outcome: 'failed',
      reason: 'The login surface remained after submission; acceptance is externally indeterminate.',
    },
    observedSubjects: [{
      id: 'fixture-page',
      kind: 'page',
      value: '/observed',
      evidenceId: 'fixture-evidence',
    }],
    unobservedScope: ['All scope outside the fixture remains unobserved.'],
    unknowns: [{ id: 'fixture-unknown', subject: 'Authentication acceptance', reason: 'Externally indeterminate.' }],
    blockers: [],
    evidence: [{
      id: 'fixture-evidence',
      subject: '/observed',
      summary: 'One fixture route was observed.',
      capturedAt: '2026-08-05T12:00:30.000Z',
      provenance: { kind: 'crawl-run', reference: start.observationId },
      integrity: 'unknown',
    }],
    errors: [],
    recommendation: {
      action: 'Review target-side acceptance evidence',
      because: 'The safe fixture cannot establish the target-side cause.',
    },
  }
}

test('live in-process status wins while project ownership is enforced', () => {
  const fallback = {
    resolve: () => ({ kind: 'malformed' as const }),
  }
  const runner = new JobRunner(fallback)
  const live: JobStatus = {
    jobId: 'active-observation',
    type: 'crawl',
    appName: 'alpha',
    status: 'running',
    startedAt: '2026-08-05T12:00:00.000Z',
  }
  ;(runner as unknown as { jobs: Map<string, JobStatus> }).jobs.set(live.jobId, live)
  logBuffer.create(live.jobId)
  logBuffer.append(live.jobId, 'safe live line')

  const status = runner.getStatus(live.jobId, 'alpha')
  assert.equal(status?.status, 'running')
  assert.equal(status?.complete, false)
  assert.deepEqual(status?.lines, ['safe live line'])
  assert.equal(runner.getStatus(live.jobId, 'beta'), null)
  logBuffer.clear(live.jobId)
})

test('terminal status and immutable evidence survive a simulated backend restart', () => {
  const { store } = disposableStore(['alpha'])
  const start = startRecord('alpha', 'terminal-observation')
  const terminal = terminalRecord(start)
  persistLegacyFixture(store, start, terminal)

  const restartedRunner = new JobRunner(store)
  const status = restartedRunner.getStatus(start.observationId, start.projectId)
  assert.equal(status?.status, 'partially_completed')
  assert.equal(status?.complete, true)
  assert.equal(status?.startedAt, terminal.startedAt)
  assert.equal(status?.completedAt, terminal.completedAt)
  assert.deepEqual(store.get(start.projectId, start.observationId), terminal)
})

test('a persisted start without a terminal record is interrupted, never active', () => {
  const { store } = disposableStore(['alpha'])
  const start = startRecord('alpha', 'interrupted-observation')
  persistLegacyFixture(store, start)

  const restartedRunner = new JobRunner(store)
  const status = restartedRunner.getStatus(start.observationId, start.projectId)
  assert.equal(status?.status, 'unknown')
  assert.equal(status?.complete, true)
  assert.match(status?.error ?? '', /interrupted and is not active/i)
  assert.equal(restartedRunner.getActiveJob(start.projectId), null)
})

test('mismatched projects, malformed records, and unknown IDs fail closed', () => {
  const { root, resolver, store } = disposableStore(['alpha', 'beta'])
  const start = startRecord('alpha', 'owned-observation')
  persistLegacyFixture(store, start, terminalRecord(start, 'completed'))

  const runner = new JobRunner(store)
  assert.equal(runner.getStatus(start.observationId, 'beta'), null)
  assert.equal(runner.getStatus('unknown-observation', 'alpha'), null)

  const malformedId = 'malformed-observation'
  const malformedDir = path.join(resolver.resolve('alpha').forgeDir, 'observations', malformedId)
  fs.mkdirSync(malformedDir, { recursive: true })
  fs.writeFileSync(path.join(malformedDir, 'started.json'), '{not-json', 'utf8')
  assert.throws(
    () => runner.getStatus(malformedId, 'alpha'),
    (error: unknown) => error instanceof ObservationStatusReadError,
  )

  const wrongOwnerId = 'wrong-owner-observation'
  const wrongOwnerDir = path.join(root, 'alpha', '.forge', 'observations', wrongOwnerId)
  fs.mkdirSync(wrongOwnerDir, { recursive: true })
  fs.writeFileSync(
    path.join(wrongOwnerDir, 'started.json'),
    JSON.stringify(startRecord('beta', wrongOwnerId)),
    'utf8',
  )
  assert.equal(runner.getStatus(wrongOwnerId, 'alpha'), null)
})

test('persisted authentication diagnostics with an unapproved field fail closed', () => {
  const { store } = disposableStore(['alpha'])
  const start = startRecord('alpha', 'unsafe-auth-diagnostic')
  const terminal = terminalRecord(start)
  terminal.authentication.attempts = [{
    roleId: 'fixture-role',
    outcome: 'failed',
    stages: [{
      stage: 'post-submit-login-surface-evaluation',
      outcome: 'failed',
      selectorStrategyCategory: 'configured',
      loginSurfaceRetained: true,
      selector: '[unapproved-raw-selector]',
    } as any],
  }]
  persistLegacyFixture(store, start, terminal)

  assert.equal(store.resolve(start.observationId, start.projectId).kind, 'malformed')
  assert.throws(
    () => new JobRunner(store).getStatus(start.observationId, start.projectId),
    (error: unknown) => error instanceof ObservationStatusReadError,
  )
})

type FixtureMode = 'success' | 'retained' | 'missing-username'

class FixtureError extends Error {
  constructor(name: string) {
    super('A deliberately redacted fixture failure.')
    this.name = name
  }
}

class FixtureLocator {
  constructor(
    private readonly page: FixturePage,
    private readonly selector: string,
  ) {}

  async count(): Promise<number> {
    return this.page.count(this.selector)
  }

  first(): FixtureLocator {
    return this
  }

  async waitFor(): Promise<void> {
    if (this.page.count(this.selector) === 0) throw new FixtureError('LocatorUnavailable')
  }

  async fill(value: string): Promise<void> {
    this.page.recordEntry(this.selector, value)
  }

  async click(): Promise<void> {
    this.page.submit()
  }
}

class FixturePage {
  private currentUrl = 'https://auth.fixture.invalid/login'
  private entries = new Map<string, string>()

  constructor(private readonly mode: FixtureMode) {}

  async goto(url: string): Promise<void> {
    this.currentUrl = url
  }

  async waitForTimeout(): Promise<void> {}

  locator(selector: string): FixtureLocator {
    return new FixtureLocator(this, selector)
  }

  count(selector: string): number {
    if (this.mode === 'missing-username' && selector === '[data-fixture=username]') return 0
    return 1
  }

  recordEntry(selector: string, value: string): void {
    this.entries.set(selector, value)
  }

  submit(): void {
    if (this.mode === 'success') this.currentUrl = 'https://auth.fixture.invalid/observed'
  }

  url(): string {
    return this.currentUrl
  }

  async waitForURL(predicate: (url: URL) => boolean): Promise<void> {
    if (!predicate(new URL(this.currentUrl))) throw new FixtureError('TimeoutError')
  }

  async waitForLoadState(): Promise<void> {}

  async close(): Promise<void> {}
}

function fixtureBrowser(mode: FixtureMode): Browser {
  const page = new FixturePage(mode)
  const context = {
    newPage: async () => page,
    storageState: async () => ({}),
  }
  return {
    newContext: async () => context,
  } as unknown as Browser
}

function fixtureConfig(envKey: string): { config: OnboardingConfig; role: RoleConfig } {
  const role: RoleConfig = {
    id: 'fixture-role',
    displayName: 'Fixture role',
    authFlow: 'form-login',
    credentialsEnvKey: envKey,
    loginUrl: 'https://auth.fixture.invalid/login',
    selectors: {
      username: '[data-fixture=username]',
      password: '[data-fixture=password]',
      submit: '[data-fixture=submit]',
    },
  }
  return {
    role,
    config: {
      app: { name: 'fixture-app', baseUrl: 'https://app.fixture.invalid', appType: 'web-ui' },
      roles: [role],
    },
  }
}

function stage(
  stages: AuthenticationStageDiagnostic[],
  name: AuthenticationStageDiagnostic['stage'],
): AuthenticationStageDiagnostic {
  const found = stages.find(item => item.stage === name)
  assert.ok(found, `Expected stage ${name}`)
  return found
}

test('disposable login success traces all safe stages without diagnostic values', async () => {
  const envKey = 'FORGE_TD_UI_064A_S_SUCCESS_FIXTURE'
  const username = 'fixture-user-sensitive'
  const password = 'fixture-password-sensitive'
  try {
    const { config, role } = fixtureConfig(envKey)
    const result = await new AuthManager(config, {
      credentialMaterial: { username, password },
    }).authenticate(role, fixtureBrowser('success'))
    assert.equal(result.authenticated, true)
    assert.equal(result.authenticationStages.length, 9)
    assert.equal(stage(result.authenticationStages, 'credential-reference-resolution').outcome, 'succeeded')
    assert.equal(stage(result.authenticationStages, 'value-entry-completion').usernameEntryCompleted, true)
    assert.equal(stage(result.authenticationStages, 'value-entry-completion').passwordEntryCompleted, true)
    assert.equal(stage(result.authenticationStages, 'submission-attempt').submissionAttempted, true)
    assert.equal(stage(result.authenticationStages, 'navigation-or-page-state-change').urlClassification?.path, 'different-path')
    assert.equal(stage(result.authenticationStages, 'post-submit-login-surface-evaluation').loginSurfaceRetained, false)

    const candidate = representativeNinePageCandidate('auth-stage-schema-fixture')
    candidate.roles[0].authenticationStages = result.authenticationStages
    candidate.app.modelVersion = '1.0.0'
    assert.deepEqual(validateAppModelObject(candidate), { valid: true, errors: [] })

    const serialized = JSON.stringify(result.authenticationStages)
    for (const forbidden of [username, password, envKey, '[data-fixture=', 'auth.fixture.invalid', '/login', '/observed']) {
      assert.equal(serialized.includes(forbidden), false, `diagnostics exposed forbidden material: ${forbidden}`)
    }
  } finally {
    delete process.env[envKey]
  }
})

test('retained login distinguishes resolved credentials from externally indeterminate acceptance', async () => {
  const envKey = 'FORGE_TD_UI_064A_S_RETAINED_FIXTURE'
  const credentialMaterial = 'fixture-retained-user:fixture-retained-password'
  process.env[envKey] = credentialMaterial
  try {
    const { config, role } = fixtureConfig(envKey)
    const result = await new AuthManager(config).authenticate(role, fixtureBrowser('retained'))
    assert.equal(result.authenticated, false)
    assert.equal(stage(result.authenticationStages, 'credential-reference-resolution').outcome, 'succeeded')
    assert.equal(stage(result.authenticationStages, 'submission-attempt').outcome, 'succeeded')
    assert.equal(stage(result.authenticationStages, 'navigation-or-page-state-change').outcome, 'indeterminate')
    assert.equal(stage(result.authenticationStages, 'navigation-or-page-state-change').safeErrorType, 'TimeoutError')
    assert.equal(stage(result.authenticationStages, 'post-submit-login-surface-evaluation').outcome, 'failed')
    assert.equal(stage(result.authenticationStages, 'post-submit-login-surface-evaluation').loginSurfaceRetained, true)

    const summary = summarizeAuthenticationStages(result.authenticationStages)
    assert.match(summary, /acceptance remains externally indeterminate/i)
    assert.doesNotMatch(summary, /incorrect|invalid credential/i)
    assert.equal(JSON.stringify(result.authenticationStages).includes(credentialMaterial), false)
  } finally {
    delete process.env[envKey]
  }
})

test('form discovery failure stops at the exact safe stage and exposes only an error type', async () => {
  const envKey = 'FORGE_TD_UI_064A_S_DISCOVERY_FIXTURE'
  process.env[envKey] = 'fixture-discovery-user:fixture-discovery-password'
  try {
    const { config, role } = fixtureConfig(envKey)
    const result = await new AuthManager(config).authenticate(role, fixtureBrowser('missing-username'))
    assert.equal(result.authenticated, false)
    assert.equal(stage(result.authenticationStages, 'login-surface-detection').outcome, 'indeterminate')
    assert.equal(stage(result.authenticationStages, 'username-control-discovery').outcome, 'failed')
    assert.equal(stage(result.authenticationStages, 'username-control-discovery').safeErrorType, 'LocatorUnavailable')
    assert.equal(stage(result.authenticationStages, 'password-control-discovery').outcome, 'not_evaluated')
    assert.equal(JSON.stringify(result.authenticationStages).includes('fixture-discovery-password'), false)
  } finally {
    delete process.env[envKey]
  }
})

test('route projection keeps only approved authentication metadata and recommends evidence review', () => {
  const model = {
    roles: [{
      id: 'fixture-role',
      authOutcome: 'failed',
      authenticationStages: [{
        stage: 'post-submit-login-surface-evaluation',
        outcome: 'failed',
        selectorStrategyCategory: 'configured',
        matchCount: 1,
        loginSurfaceRetained: true,
        urlClassification: { origin: 'same-origin', path: 'same-path' },
        safeErrorType: 'TimeoutError',
        selector: '[raw-selector-must-not-pass]',
        value: 'raw-field-value-must-not-pass',
        url: 'https://secret.invalid/login',
        html: '<input value="secret">',
      }],
    }],
  }
  const attempts = authenticationAttempts(model)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].stages.length, 1)
  const serialized = JSON.stringify(attempts)
  for (const forbidden of ['raw-selector', 'raw-field-value', 'secret.invalid', '<input', 'value=']) {
    assert.equal(serialized.includes(forbidden), false)
  }
  const recommendation = authenticationFailureRecommendation(attempts)
  assert.match(recommendation.action, /Review target-side authentication acceptance evidence/i)
  assert.match(recommendation.because, /does not establish that credentials were incorrect/i)
})

test('production wiring uses the durable status owner and only the staged authentication surface', () => {
  const routeSource = fs.readFileSync(
    path.resolve('forge-ui/server/routes/crawl.ts'),
    'utf8',
  )
  const crawlerSource = fs.readFileSync(
    path.resolve('src/core/onboarding/Crawler.ts'),
    'utf8',
  )
  const pageSource = fs.readFileSync(
    path.resolve('forge-ui/src/pages/CrawlPage.tsx'),
    'utf8',
  )

  assert.match(routeSource, /jobRunner\.getStatus\(req\.params\.jobId, expectedProjectId\)/)
  assert.match(routeSource, /status:\s+canonical\?\.runs\?\.\[0\]\?\.lifecycle \?\? view\.status/)
  assert.match(routeSource, /readObservationHistoryView/)
  assert.doesNotMatch(crawlerSource, /observeLoginSurface|buildAllNotObservedDiagnostic/)
  for (const label of [
    'Authentication stage diagnostics',
    'Control visible:',
    'Value entry completed:',
    'Submission attempted:',
    'Login surface retained:',
  ]) {
    assert.equal(pageSource.includes(label), true)
  }
})
