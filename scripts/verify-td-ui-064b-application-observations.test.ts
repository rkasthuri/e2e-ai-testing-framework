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
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import {
  ObservationStore,
  type ObservationStartRecord,
  type ObservationTerminalRecord,
} from '../forge-ui/server/registry/ObservationStore'
import {
  parseObservationHistoryQuery,
} from '../forge-ui/server/routes/crawl'
import { projectObservationHistoryItem } from '../forge-ui/server/registry/ObservationHistoryPresenter'
import { buildApplicationObservationsReadModel } from '../forge-ui/src/components/application-workspace/applicationObservationsAdapter'
import type { ObservationHistoryResponse } from '../forge-ui/src/api/types'

const fixtureResolvers = new WeakMap<ObservationStore, WorkspaceResolver>()

function persistLegacyFixture(store: ObservationStore, start: ObservationStartRecord, terminal?: ObservationTerminalRecord): void {
  const resolver = fixtureResolvers.get(store)
  assert.ok(resolver)
  const dir = path.join(resolver.resolve(start.projectId).forgeDir, 'observations', start.observationId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'started.json'), JSON.stringify(start, null, 2), 'utf8')
  if (terminal) fs.writeFileSync(path.join(dir, 'terminal.json'), JSON.stringify(terminal, null, 2), 'utf8')
}

function disposableStore(projects: string[] = ['alpha']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-064b-'))
  const resolver = new WorkspaceResolver(root)
  const store = new ObservationStore(resolver, {
    list: () => projects.map(appName => ({ appName })) as any,
  })
  fixtureResolvers.set(store, resolver)
  return { root, resolver, store }
}

function startRecord(
  observationId: string,
  startedAt: string,
  projectId = 'alpha',
): ObservationStartRecord {
  return {
    schemaVersion: 1,
    observationId,
    projectId,
    projectName: projectId,
    observationContext: {
      id: observationId,
      label: 'Disposable observation',
      target: 'https://fixture.invalid',
      declaredScope: 'Only fixture subjects reached by this run.',
      strategy: 'fixture',
    },
    sourceKind: 'crawl-engine',
    startedAt,
    credentialAvailability: 'available',
    authenticationExpectation: 'form-login',
  }
}

function terminalRecord(
  start: ObservationStartRecord,
  terminalState: ObservationTerminalRecord['terminalState'],
  completedAt: string,
): ObservationTerminalRecord {
  const evidenceId = `evidence-${start.observationId}`
  return {
    ...start,
    completedAt,
    terminalState,
    stateReason: `Persisted ${terminalState} fixture outcome.`,
    authentication: {
      expectation: start.authenticationExpectation,
      credentialAvailability: start.credentialAvailability,
      outcome: terminalState === 'completed' ? 'succeeded' : 'failed',
      reason: 'A bounded structural authentication result was persisted.',
      attempts: [{
        roleId: 'fixture-role',
        outcome: terminalState === 'completed' ? 'succeeded' : 'failed',
        stages: [
          'credential-reference-resolution',
          'login-surface-detection',
          'username-control-discovery',
          'password-control-discovery',
          'value-entry-completion',
          'submit-control-discovery',
          'submission-attempt',
          'navigation-or-page-state-change',
          'post-submit-login-surface-evaluation',
        ].map(stage => ({
          stage,
          outcome: 'succeeded',
          selectorStrategyCategory: 'configured',
        })) as NonNullable<ObservationTerminalRecord['authentication']['attempts']>[number]['stages'],
      }],
    },
    observedSubjects: [{
      id: `subject-${start.observationId}`,
      kind: 'page',
      value: '/fixture-subject',
      evidenceId,
    }],
    unobservedScope: ['Scope outside the disposable fixture was not observed.'],
    unknowns: [],
    blockers: [],
    evidence: [{
      id: evidenceId,
      subject: '/fixture-subject',
      summary: 'The disposable subject was observed.',
      capturedAt: start.startedAt,
      provenance: { kind: 'crawl-run', reference: start.observationId },
      integrity: 'unknown',
    }],
    errors: [],
    recommendation: null,
  }
}

function persistTerminal(
  store: ObservationStore,
  id: string,
  state: ObservationTerminalRecord['terminalState'],
  startedAt: string,
  completedAt: string,
) {
  const start = startRecord(id, startedAt)
  persistLegacyFixture(store, start, terminalRecord(start, state, completedAt))
}

test('history orders newest first and uses ascending observation ID as a stable timestamp tie-breaker', () => {
  const { store } = disposableStore()
  persistTerminal(store, 'tie-b', 'completed', '2026-08-05T11:00:00.000Z', '2026-08-05T12:00:00.000Z')
  persistTerminal(store, 'older', 'completed', '2026-08-05T09:00:00.000Z', '2026-08-05T10:00:00.000Z')
  persistTerminal(store, 'tie-a', 'failed', '2026-08-05T11:00:00.000Z', '2026-08-05T12:00:00.000Z')

  const result = store.history('alpha')
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.deepEqual(result.observations.map(item => item.observationId), ['tie-a', 'tie-b', 'older'])
  assert.equal(result.observations[0].position, 'latest')
  assert.equal(result.observations[0].state, 'failed')
  assert.equal(result.observations[1].position, 'historical')
})

test('completed, partial, blocked, failed, unknown, and start-only interrupted states remain distinct', () => {
  const { store } = disposableStore()
  const states: ObservationTerminalRecord['terminalState'][] = [
    'completed', 'partially_completed', 'blocked', 'failed', 'unknown',
  ]
  states.forEach((state, index) => persistTerminal(
    store,
    `state-${state.replaceAll('_', '-')}`,
    state,
    `2026-08-05T0${index}:00:00.000Z`,
    `2026-08-05T0${index}:30:00.000Z`,
  ))
  persistLegacyFixture(store, startRecord('state-interrupted', '2026-08-05T08:00:00.000Z'))

  const result = store.history('alpha')
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.deepEqual(new Set(result.observations.map(item => item.state)), new Set([...states, 'interrupted']))
  const interrupted = result.observations.find(item => item.state === 'interrupted')
  assert.equal(interrupted?.terminal, null)
  assert.equal(interrupted?.position, 'latest')
})

test('empty history is a valid bounded response and an unknown cursor is rejected', () => {
  const { store } = disposableStore()
  assert.deepEqual(store.history('alpha'), {
    kind: 'ok', observations: [], nextCursor: null, previousCursor: null, hasPrevious: false,
    filteredTotal: 0, projectTotal: 0, requestedObservation: null,
  })
  assert.deepEqual(store.history('alpha', { cursor: 'missing' }), { kind: 'invalid_cursor' })
})

test('pagination is bounded and cursor input is validated without offset drift', () => {
  const { store } = disposableStore()
  for (let index = 0; index < 5; index++) {
    persistTerminal(
      store,
      `page-${index}`,
      'completed',
      `2026-08-05T0${index}:00:00.000Z`,
      `2026-08-05T0${index}:30:00.000Z`,
    )
  }
  const first = store.history('alpha', { limit: 2 })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok') return
  assert.equal(first.observations.length, 2)
  assert.equal(first.projectTotal, 5)
  assert.equal(first.filteredTotal, 5)
  assert.notEqual(first.nextCursor, first.observations[1].observationId)
  assert.equal(first.previousCursor, null)
  const second = store.history('alpha', { limit: 2, cursor: first.nextCursor })
  assert.equal(second.kind, 'ok')
  if (second.kind !== 'ok') return
  assert.equal(second.observations.length, 2)
  assert.equal(new Set([...first.observations, ...second.observations].map(item => item.observationId)).size, 4)

  assert.deepEqual(parseObservationHistoryQuery({}), {
    ok: true,
    limit: 20,
    cursor: null,
    startedFrom: null,
    startedThrough: null,
    requestedObservationId: null,
  })
  for (const limit of ['0', '51', '1.5', ['2']]) {
    assert.equal(parseObservationHistoryQuery({ limit }).ok, false)
  }
  assert.equal(parseObservationHistoryQuery({ cursor: '../escape' }).ok, false)
  assert.equal(parseObservationHistoryQuery({ startedFrom: 'not-iso' }).ok, false)
  assert.equal(parseObservationHistoryQuery({
    startedFrom: '2026-08-06T00:00:00.000Z',
    startedThrough: '2026-08-05T23:59:59.999Z',
  }).ok, false)
  assert.deepEqual(store.history('alpha', {
    cursor: first.nextCursor,
    startedFrom: '2026-08-05T00:00:00.000Z',
  }), { kind: 'invalid_cursor' })
})

test('malformed JSON, duplicate identities, ownership mismatches, and invalid timestamps fail closed', () => {
  const malformed = disposableStore()
  const malformedDir = path.join(malformed.resolver.resolve('alpha').forgeDir, 'observations', 'malformed')
  fs.mkdirSync(malformedDir, { recursive: true })
  fs.writeFileSync(path.join(malformedDir, 'started.json'), '{not-json', 'utf8')
  assert.deepEqual(malformed.store.history('alpha'), { kind: 'malformed' })

  const duplicate = disposableStore()
  const duplicateStart = startRecord('duplicate-evidence', '2026-08-05T10:00:00.000Z')
  const duplicateTerminal = terminalRecord(duplicateStart, 'completed', '2026-08-05T10:30:00.000Z')
  duplicateTerminal.evidence.push({ ...duplicateTerminal.evidence[0] })
  persistLegacyFixture(duplicate.store, duplicateStart, duplicateTerminal)
  assert.deepEqual(duplicate.store.history('alpha'), { kind: 'malformed' })

  const ownership = disposableStore(['alpha', 'beta'])
  const wrongDir = path.join(ownership.resolver.resolve('alpha').forgeDir, 'observations', 'wrong-owner')
  fs.mkdirSync(wrongDir, { recursive: true })
  fs.writeFileSync(
    path.join(wrongDir, 'started.json'),
    JSON.stringify(startRecord('wrong-owner', '2026-08-05T10:00:00.000Z', 'beta')),
    'utf8',
  )
  assert.deepEqual(ownership.store.history('alpha'), { kind: 'ownership_mismatch' })

  const timestamp = disposableStore()
  persistLegacyFixture(timestamp.store, startRecord('bad-time', 'not-an-iso-timestamp'))
  assert.deepEqual(timestamp.store.history('alpha'), { kind: 'malformed' })

  const unknownField = disposableStore()
  const unknownDir = path.join(unknownField.resolver.resolve('alpha').forgeDir, 'observations', 'unknown-field')
  fs.mkdirSync(unknownDir, { recursive: true })
  fs.writeFileSync(
    path.join(unknownDir, 'started.json'),
    JSON.stringify({
      ...startRecord('unknown-field', '2026-08-05T10:00:00.000Z'),
      unrestrictedLegacyDiagnostic: 'must fail closed',
    }),
    'utf8',
  )
  assert.deepEqual(unknownField.store.history('alpha'), { kind: 'malformed' })
})

test('safe projection preserves authentication stages, evidence, and provenance while omitting unrestricted errors', () => {
  const { store } = disposableStore()
  const start = startRecord('safe-projection', '2026-08-05T10:00:00.000Z')
  const terminal = terminalRecord(start, 'completed', '2026-08-05T10:30:00.000Z')
  start.observationContext.target = 'https://www.saucedemo.com/'
  start.observationContext.label = 'landing-url = https://www.saucedemo.com/'
  start.observationContext.declaredScope = 'SAUCEDEMO_USERNAME and SAUCEDEMO_PASSWORD'
  terminal.stateReason = 'AppModelPersistenceError: INSERT INTO app_models with schema-validation payload'
  terminal.authentication.reason = 'SAUCEDEMO_USERNAME was resolved at https://www.saucedemo.com/'
  terminal.observedSubjects[0].value = 'https://www.saucedemo.com/inventory.html?session=secret'
  terminal.evidence[0].subject = 'https://www.saucedemo.com/inventory.html?session=secret'
  terminal.evidence[0].summary = 'C:\\private\\fixture AppModelPersistenceError schema-validation payload'
  terminal.unknowns = [{ id: 'unknown-1', subject: 'https://www.saucedemo.com/', reason: 'SAUCEDEMO_PASSWORD' }]
  terminal.blockers = [{ id: 'blocker-1', kind: 'persistence', subject: 'database', reason: 'SQLite constraint detail' }]
  terminal.errors = ['credential-material-must-not-cross-history-api']
  terminal.recommendation = {
    action: 'Retry with SAUCEDEMO_USERNAME',
    because: 'AppModelPersistenceError schema-validation internals',
  }
  terminal.modelRecovery = {
    sourceRowId: 5,
    sourceVersion: '1.0.4',
    sourceFingerprint: 'safe-fingerprint',
    detectedAt: '2026-08-05T10:15:00.000Z',
    validationErrors: ['validation-error-secret-must-not-cross'],
    decision: 'force-guarded-recovery',
    replacementRowId: 6,
    replacementVersion: '1.0.5',
  }
  terminal.modelRecoveryFailure = {
    sourceRowId: 5,
    sourceVersion: '1.0.4',
    sourceFingerprint: 'safe-fingerprint',
    detectedAt: '2026-08-05T10:15:00.000Z',
    phases: {
      crawlExecution: 'completed',
      authentication: 'succeeded',
      modelGeneration: 'validated',
      guardedPersistence: 'failed',
      compatibilityProjection: 'not_attempted',
    },
    persistenceDiagnostic: {
      stage: 'replacement-insert',
      causeChain: [{ name: 'Error', code: null, summary: 'sqlite-secret-detail-must-not-cross' }],
    },
  }
  persistLegacyFixture(store, start, terminal)
  const history = store.history('alpha')
  assert.equal(history.kind, 'ok')
  if (history.kind !== 'ok') return
  const projected = projectObservationHistoryItem(history.observations[0])
  assert.equal(projected.authentication.attempts[0].stages.length, 9)
  assert.equal(projected.evidence[0].provenance.reference, start.observationId)
  assert.equal(projected.modelRecoveryFailure?.sourceRowId, 5)
  assert.equal(projected.observedSubjects[0].routePath, '/inventory.html')
  assert.equal(projected.evidence[0].subjectPath, '/inventory.html')
  const serialized = JSON.stringify(projected)
  for (const forbidden of [
    'SAUCEDEMO_USERNAME',
    'SAUCEDEMO_PASSWORD',
    'https://www.saucedemo.com/',
    'AppModelPersistenceError',
    'schema-validation',
    'INSERT INTO',
    'C:\\private',
    'credential-material',
    'validation-error-secret',
    'sqlite-secret-detail',
    'causeChain',
    'persistenceDiagnostic',
    'stateReason',
    'errors',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `serialized projection contained ${forbidden}`)
  }
  assert.match(projected.stateExplanation, /Guarded persistence failed/)
  assert.equal(projected.recommendation?.category, 'guarded-persistence')
})

test('read model keeps latest, outcome, freshness, authentication availability, and integrity independent', () => {
  const response: ObservationHistoryResponse = {
    project: { id: 'alpha', name: 'Alpha' },
    observations: [{
      ...projectObservationHistoryItem({
        observationId: 'read-model',
        orderingTimestamp: '2026-08-05T10:30:00.000Z',
        position: 'latest',
        state: 'failed',
        start: startRecord('read-model', '2026-08-05T10:00:00.000Z'),
        terminal: terminalRecord(startRecord('read-model', '2026-08-05T10:00:00.000Z'), 'failed', '2026-08-05T10:30:00.000Z'),
      }),
    }],
    page: {
      limit: 20,
      nextCursor: null,
      previousCursor: null,
      hasPrevious: false,
      filteredTotal: 1,
      projectTotal: 1,
    },
    filter: { startedFrom: null, startedThrough: null },
    requestedObservation: null,
  }
  const readModel = buildApplicationObservationsReadModel(response)
  assert.equal(readModel.observations[0].position, 'latest')
  assert.equal(readModel.observations[0].terminalState, 'failed')
  assert.equal(readModel.observations[0].freshness.state, 'not_evaluated')
  assert.match(readModel.observations[0].freshness.reason, /No approved freshness threshold/)
  assert.equal(readModel.observations[0].authentication.credentialAvailability, 'available')
  assert.equal(readModel.observations[0].evidence[0].integrity, 'unknown')
})

test('UI exposes all fail-closed states and keyboard-native disclosures without mutation or health claims', () => {
  const component = fs.readFileSync(path.resolve('forge-ui/src/components/application-workspace/ApplicationObservations.tsx'), 'utf8')
  const page = fs.readFileSync(path.resolve('forge-ui/src/pages/ApplicationObservationsPage.tsx'), 'utf8')
  for (const state of ['Completed', 'Partially completed', 'Blocked', 'Failed', 'Unknown', 'Interrupted']) {
    assert.equal(component.includes(state), true)
  }
  assert.match(component, /Latest describes ordering only/)
  assert.match(component, /<details/)
  assert.match(component, /<summary/)
  assert.match(component, /focus-visible:ring-2/)
  assert.match(component, /type="button"/)
  assert.match(component, /<time dateTime=\{value\} title=\{value\}>/)
  assert.match(component, /Credential availability/)
  assert.match(component, /Authentication outcome/)
  assert.match(component, /Unobserved scope/)
  assert.match(component, /Integrity:/)
  assert.doesNotMatch(component, /healthScore|coveragePercentage|Force re-crawl|Delete observation|Repair observation/)
  for (const state of [
    'No application selected',
    'Loading persisted observation history',
    'Application not found',
    'Observation history could not be validated',
    'FORGE backend unavailable',
  ]) {
    assert.equal(page.includes(state), true)
  }
})
