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
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const route = read('forge-ui/server/routes/crawl.ts')
const store = read('forge-ui/server/registry/ObservationStore.ts')
const page = read('forge-ui/src/pages/CrawlPage.tsx')
const hooks = read('forge-ui/src/hooks/useApi.ts')
const types = read('forge-ui/src/api/types.ts')
const runner = read('forge-ui/server/jobs/JobRunner.ts')
const overviewAdapter = read('forge-ui/src/components/application-workspace/applicationOverviewAdapter.ts')

test('selected project context is read-only, bounded, and credential-safe', () => {
  assert.match(route, /\/projects\/:appName\/context/)
  assert.match(route, /targetUrl: url/)
  assert.match(route, /credentialAvailability/)
  assert.match(route, /credentialReferenceState/)
  assert.match(route, /credentialResolver: 'backend-environment'/)
  assert.match(route, /credentialRestoration/)
  assert.match(route, /cannotEstablish/)
  assert.match(page, /Restore credential access/)
  assert.doesNotMatch(page, /usernameEnv|passwordEnv|workspacePath/)
  assert.doesNotMatch(types, /ObservationRecord[\s\S]*username:|ObservationRecord[\s\S]*password:/)
})

test('start creates a stable queued observation and prevents duplicate execution', () => {
  assert.match(route, /const observationId = randomUUID\(\)/)
  assert.match(route, /observationStore\.begin\(startRecord\)/)
  assert.match(route, /state: 'queued'/)
  assert.match(route, /OBSERVATION_ALREADY_ACTIVE/)
  assert.match(route, /observationStartReservations\.has\(appName\)/)
  assert.match(route, /observationStartReservations\.add\(appName\)[\s\S]*finally[\s\S]*observationStartReservations\.delete\(appName\)/)
  assert.match(runner, /status: 'queued'/)
  assert.match(runner, /status\.status = 'starting'/)
  assert.match(runner, /status\.status = 'running'/)
  assert.match(page, /disabled=\{active\}/)
})

test('target, project, and backend failures remain actionable', () => {
  assert.match(route, /TARGET_UNREACHABLE/)
  assert.match(route, /Project '\$\{appName\}' was not found/)
  assert.match(route, /OBSERVATION_PERSISTENCE_FAILED/)
  assert.match(page, /role="alert"/)
  assert.match(page, /Confirm the backend is running/)
})

test('terminal classification covers success, partial, blocked, failure, and unknown', () => {
  for (const state of ['completed', 'partially_completed', 'blocked', 'failed', 'unknown']) {
    assert.match(route, new RegExp(`state: '${state}'`))
    assert.match(types, new RegExp(state))
  }
  assert.match(route, /diagnostics\.length > 0/)
  assert.match(route, /pages\.length === 0/)
  assert.match(route, /malformed App Model result/)
})

test('authentication states distinguish availability from producer outcome', () => {
  for (const outcome of ['succeeded', 'failed', 'not_evaluated', 'not_required']) {
    assert.match(route, new RegExp(`outcome: '${outcome}'`))
    assert.match(page, new RegExp(outcome))
  }
  assert.match(route, /role\?\.authOutcome/)
  assert.match(route, /No explicit authentication outcome/)
  assert.match(route, /credentials were unavailable/)
})

test('immutable observation persistence never overwrites prior runs', () => {
  assert.match(store, /started\.json/)
  assert.match(store, /terminal\.json/)
  assert.match(store, /flag: 'wx'/)
  assert.match(store, /ObservationPersistenceError/)
  assert.match(store, /sort\(\(a, b\) => b\.completedAt\.localeCompare\(a\.completedAt\)\)/)
})

test('refresh reads the latest persisted terminal observation', () => {
  assert.match(route, /\/projects\/:appName\/latest/)
  assert.match(hooks, /useLatestObservation/)
  assert.match(page, /latestQuery\.data\?\.observation/)
  assert.match(page, /crawl\/active/)
})

test('result exposes bounded evidence, provenance, unknowns, and recommendation', () => {
  assert.match(page, /Observed subjects/)
  assert.match(page, /Unobserved scope and unknowns/)
  assert.match(page, /Evidence produced/)
  assert.match(page, /Provenance:/)
  assert.match(page, /Because:/)
  assert.match(route, /integrity: 'unknown'/)
  assert.match(route, /Complete crawl frontier coverage was not measured/)
})

test('credential material is neither persisted nor presented', () => {
  // Stage names and completion booleans may identify username/password controls;
  // the persisted contract must still exclude selector text and all values.
  assert.match(store, /hasOnlyKeys\(value, \[/)
  assert.doesNotMatch(store, /credentialMaterial|fieldValue|selectorText|rawHtml|requestPayload/)
  assert.doesNotMatch(store, /credentials?\s*:\s*\{/)
  assert.doesNotMatch(page, /standard_user|secret_sauce/)
  assert.doesNotMatch(route, /res\.json\([^)]*(username|password)/)
})

test('Overview recognizes persisted observation evidence without claiming completeness', () => {
  assert.match(overviewAdapter, /latestObservation/)
  assert.match(overviewAdapter, /Observed — bounded evidence available/)
  assert.match(overviewAdapter, /Complete application coverage is still unknown/)
  assert.match(overviewAdapter, /freshness: 'unknown'/)
})
