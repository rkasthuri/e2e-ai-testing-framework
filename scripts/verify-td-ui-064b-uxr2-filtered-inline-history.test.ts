/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import {
  ObservationStore,
  type ObservationStartRecord,
  type ObservationTerminalRecord,
} from '../forge-ui/server/registry/ObservationStore'
import { parseObservationHistoryQuery } from '../forge-ui/server/routes/crawl'
import { ApplicationObservations } from '../forge-ui/src/components/application-workspace/ApplicationObservations'
import { materializeObservationDateFilter } from '../forge-ui/src/components/application-workspace/observationHistoryDateFilter'
import { resolveObservationSelection } from '../forge-ui/src/components/application-workspace/applicationObservationSelection'
import type {
  ApplicationObservationsReadModel,
  ObservationRecordReadModel,
} from '../forge-ui/src/components/application-workspace/observationsTypes'

function disposableStore(projects = ['alpha', 'beta']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-064b-uxr2-'))
  const resolver = new WorkspaceResolver(root)
  return {
    resolver,
    store: new ObservationStore(resolver, {
      list: () => projects.map(appName => ({ appName })) as any,
    }),
  }
}

function startRecord(id: string, startedAt: string, projectId = 'alpha'): ObservationStartRecord {
  return {
    schemaVersion: 1,
    observationId: id,
    projectId,
    projectName: projectId,
    observationContext: {
      id,
      label: 'Disposable observation',
      target: 'https://fixture.invalid',
      declaredScope: 'Disposable fixture scope.',
      strategy: 'bfs',
    },
    sourceKind: 'crawl-engine',
    startedAt,
    credentialAvailability: 'not_required',
    authenticationExpectation: 'none',
  }
}

function persist(store: ObservationStore, id: string, startedAt: string, projectId = 'alpha') {
  const start = startRecord(id, startedAt, projectId)
  const evidenceId = `evidence-${id}`
  const terminal: ObservationTerminalRecord = {
    ...start,
    completedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    terminalState: 'completed',
    stateReason: 'Disposable completed result.',
    authentication: {
      expectation: 'none',
      credentialAvailability: 'not_required',
      outcome: 'not_required',
      reason: 'Authentication was not required.',
      attempts: [],
    },
    observedSubjects: [{ id: `subject-${id}`, kind: 'page', value: '/fixture', evidenceId }],
    unobservedScope: [],
    unknowns: [],
    blockers: [],
    evidence: [{
      id: evidenceId,
      subject: '/fixture',
      summary: 'Disposable evidence.',
      capturedAt: startedAt,
      provenance: { kind: 'crawl-run', reference: id },
      integrity: 'valid',
    }],
    errors: [],
    recommendation: null,
  }
  store.begin(start)
  store.complete(terminal)
}

function observation(index: number): ObservationRecordReadModel {
  const id = `observation-${index}`
  return {
    id,
    contextId: id,
    contextLabel: 'Crawl observation',
    declaredScope: 'Configured crawl observation scope.',
    strategy: 'bfs',
    position: index === 1 ? 'latest' : 'historical',
    terminalState: index === 2 ? 'partially_completed' : index === 3 ? 'failed' : index === 4 ? 'blocked' : 'completed',
    startedAt: `2026-08-0${9 - index}T10:00:00.000Z`,
    completedAt: `2026-08-0${9 - index}T10:05:00.000Z`,
    why: 'A bounded terminal explanation.',
    source: 'crawl-engine',
    freshness: { state: 'not_evaluated', reason: 'No approved freshness threshold exists for persisted observations.' },
    authentication: {
      expectation: 'form-login',
      credentialAvailability: 'available',
      outcome: 'succeeded',
      explanation: 'Authentication succeeded for this observation.',
      attempts: [],
    },
    observedSubjects: [{ id: `subject-${index}`, kind: 'page', routePath: '/inventory.html', evidenceId: `evidence-${index}` }],
    unobservedScope: [],
    unknowns: [],
    blockers: [],
    limitations: [],
    evidence: [{
      id: `evidence-${index}`,
      subjectPath: '/inventory.html',
      summary: 'A bounded subject observation was recorded during this crawl.',
      capturedAt: `2026-08-0${9 - index}T10:02:00.000Z`,
      provenance: { kind: 'crawl-run', reference: id },
      integrity: 'valid',
    }],
    safeRecommendation: null,
    modelRecovery: null,
    modelRecoveryFailure: null,
  }
}

function readModel(overrides: Partial<ApplicationObservationsReadModel['page']> = {}): ApplicationObservationsReadModel {
  return {
    project: { id: 'saucedemo', displayName: 'saucedemo' },
    observations: Array.from({ length: 8 }, (_, index) => observation(index + 1)),
    page: {
      previousCursor: null,
      nextCursor: null,
      hasPrevious: false,
      filteredTotal: 8,
      projectTotal: 8,
      ...overrides,
    },
    filter: { startedFrom: null, startedThrough: null },
    requestedObservation: null,
  }
}

const renderProps = {
  onSelect: () => undefined,
  onClearFilters: () => undefined,
  onPrevious: () => undefined,
  onNext: () => undefined,
}

test('persisted startedAt filtering is inclusive, precedes pagination, and returns authoritative totals', () => {
  const { store } = disposableStore()
  persist(store, 'run-1', '2026-08-01T00:00:00.000Z')
  persist(store, 'run-2', '2026-08-02T00:00:00.000Z')
  persist(store, 'run-3', '2026-08-02T23:59:59.999Z')
  persist(store, 'run-4', '2026-08-03T00:00:00.000Z')
  const result = store.history('alpha', {
    limit: 1,
    startedFrom: '2026-08-02T00:00:00.000Z',
    startedThrough: '2026-08-02T23:59:59.999Z',
    requestedObservationId: 'run-4',
  })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.projectTotal, 4)
  assert.equal(result.filteredTotal, 2)
  assert.equal(result.observations.length, 1)
  assert.equal(result.observations[0].observationId, 'run-3')
  assert.ok(result.nextCursor)
  assert.deepEqual(result.requestedObservation, { observationId: 'run-4', status: 'outside_filter' })
})

test('opaque cursors are bound to project and filters and provide restart-stable Previous and Next pages', () => {
  const fixture = disposableStore()
  for (let index = 1; index <= 6; index++) persist(fixture.store, `run-${index}`, `2026-08-0${index}T10:00:00.000Z`)
  const first = fixture.store.history('alpha', { limit: 2 })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok' || !first.nextCursor) return
  const second = fixture.store.history('alpha', { limit: 2, cursor: first.nextCursor })
  assert.equal(second.kind, 'ok')
  if (second.kind !== 'ok') return
  assert.equal(second.previousCursor, null)
  assert.equal(second.hasPrevious, true)
  assert.equal(second.projectTotal, 6)
  assert.equal(second.filteredTotal, 6)
  assert.ok(second.nextCursor)
  const third = fixture.store.history('alpha', { limit: 2, cursor: second.nextCursor })
  assert.equal(third.kind, 'ok')
  if (third.kind !== 'ok') return
  assert.equal(third.hasPrevious, true)
  assert.equal(third.previousCursor, first.nextCursor)
  const previous = fixture.store.history('alpha', { limit: 2, cursor: third.previousCursor })
  assert.equal(previous.kind, 'ok')
  if (previous.kind !== 'ok') return
  assert.deepEqual(previous.observations.map(item => item.observationId), second.observations.map(item => item.observationId))
  assert.deepEqual(fixture.store.history('beta', { limit: 2, cursor: first.nextCursor }), { kind: 'invalid_cursor' })
  assert.deepEqual(fixture.store.history('alpha', {
    limit: 2,
    cursor: first.nextCursor,
    startedFrom: '2026-08-02T00:00:00.000Z',
  }), { kind: 'invalid_cursor' })
  const restarted = new ObservationStore(fixture.resolver, { list: () => [{ appName: 'alpha' }, { appName: 'beta' }] as any })
  const afterRestart = restarted.history('alpha', { limit: 2, cursor: first.nextCursor })
  assert.equal(afterRestart.kind, 'ok')
  if (afterRestart.kind !== 'ok') return
  assert.deepEqual(afterRestart.observations.map(item => item.observationId), second.observations.map(item => item.observationId))
  assert.equal(afterRestart.projectTotal, 6)
})

test('API query validation rejects malformed timestamps, reversed ranges, cursors, and oversized pages', () => {
  assert.equal(parseObservationHistoryQuery({ startedFrom: '2026-08-01' }).ok, false)
  assert.equal(parseObservationHistoryQuery({
    startedFrom: '2026-08-03T00:00:00.000Z',
    startedThrough: '2026-08-02T23:59:59.999Z',
  }).ok, false)
  assert.equal(parseObservationHistoryQuery({ cursor: '../unsafe' }).ok, false)
  assert.equal(parseObservationHistoryQuery({ limit: '51' }).ok, false)
  const valid = parseObservationHistoryQuery({
    limit: '25',
    startedFrom: '2026-08-01T00:00:00.000Z',
    startedThrough: '2026-08-02T23:59:59.999Z',
    observation: 'run-1',
  })
  assert.equal(valid.ok, true)
})

test('local calendar boundaries are deterministic, inclusive, timezone-labelled, and fail closed', () => {
  const result = materializeObservationDateFilter('2026-08-02', '2026-08-02')
  assert.equal(result.ok, true)
  if (!result.ok) return
  const expectedFrom = new Date(0)
  expectedFrom.setFullYear(2026, 7, 2)
  expectedFrom.setHours(0, 0, 0, 0)
  const expectedThrough = new Date(0)
  expectedThrough.setFullYear(2026, 7, 2)
  expectedThrough.setHours(23, 59, 59, 999)
  assert.equal(result.filter.startedFromIso, expectedFrom.toISOString())
  assert.equal(result.filter.startedThroughIso, expectedThrough.toISOString())
  assert.ok(result.filter.timezone.length > 0)
  assert.equal(materializeObservationDateFilter('2026-02-30', '').ok, false)
  assert.equal(materializeObservationDateFilter('2026-08-03', '2026-08-02').ok, false)
})

test('latest and seventh-row details are inline, movable, collapsible, and never duplicated', () => {
  const latest = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: readModel(),
    selectedId: 'observation-1',
    filterActive: false,
    filterDescription: 'All dates',
  }))
  assert.equal((latest.match(/data-testid="selected-observation-detail-row"/g) ?? []).length, 1)
  assert.ok(latest.indexOf('data-selected="true"') < latest.indexOf('data-testid="selected-observation-detail-row"'))
  assert.ok(latest.indexOf('data-testid="selected-observation-detail-row"') < latest.indexOf('data-selected="false"'))

  const seventh = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: readModel(),
    selectedId: 'observation-7',
    filterActive: false,
    filterDescription: 'All dates',
  }))
  assert.equal((seventh.match(/data-testid="selected-observation-detail-row"/g) ?? []).length, 1)
  assert.match(seventh, /Observation observation-7/)

  const collapsed = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: readModel(),
    selectedId: null,
    filterActive: false,
    filterDescription: 'All dates',
  }))
  assert.equal(collapsed.includes('data-testid="selected-observation-detail-row"'), false)
})

test('inline selection exposes row, control, region, disclosure, mobile, and announcement semantics', () => {
  const source = fs.readFileSync(path.resolve('forge-ui/src/components/application-workspace/ApplicationObservations.tsx'), 'utf8')
  assert.match(source, /onClick=\{\(\) => onSelect\(observation\.id\)\}/)
  assert.match(source, /aria-label=\{`View observation \$\{observation\.id\}`\}/)
  assert.match(source, /aria-expanded=\{selected\}/)
  assert.match(source, /aria-controls=\{inlineDetailId\(observation\.id\)\}/)
  assert.match(source, /colSpan=\{9\}/)
  assert.match(source, /role="region"/)
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /focus-visible:ring-2/)
  assert.match(source, /md:hidden/)
  for (const subsection of ['Summary', 'Authentication', 'Observed subjects', 'Evidence records', 'Limitations and unknowns', 'Recovery provenance']) {
    assert.equal(source.includes(subsection), true)
  }
})

test('authoritative count summaries distinguish all, filtered, and zero-match result sets', () => {
  const all = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: readModel({ projectTotal: 111, filteredTotal: 111 }),
    selectedId: 'observation-1',
    filterActive: false,
    filterDescription: 'All dates',
  }))
  assert.match(all, /Total runs: 111/)

  const filtered = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: readModel({ projectTotal: 111, filteredTotal: 37, nextCursor: 'next' }),
    selectedId: 'observation-1',
    filterActive: true,
    filterDescription: '2026-08-01 through 2026-08-02',
  }))
  assert.match(filtered, /Showing 8 of 37 filtered runs — 111 total runs/)
  assert.match(filtered, /More matching observations are available/)

  const emptyModel = { ...readModel({ projectTotal: 111, filteredTotal: 0 }), observations: [] }
  const empty = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    ...renderProps,
    readModel: emptyModel,
    selectedId: null,
    filterActive: true,
    filterDescription: 'future dates',
  }))
  assert.match(empty, /0 runs match the selected dates — 111 total runs/)
  assert.match(empty, /No matching observations/)
  assert.doesNotMatch(empty, /No observation history/)
})

test('URL state clears stale cursors and selections, restores bounded pages, and never auto-appends history', () => {
  const page = fs.readFileSync(path.resolve('forge-ui/src/pages/ApplicationObservationsPage.tsx'), 'utf8')
  const hook = fs.readFileSync(path.resolve('forge-ui/src/hooks/useApi.ts'), 'utf8')
  assert.match(page, /searchParams\.get\('startedFrom'\)/)
  assert.match(page, /searchParams\.get\('startedThrough'\)/)
  assert.match(page, /searchParams\.get\('cursor'\)/)
  assert.match(page, /next\.delete\('cursor'\)/)
  assert.match(page, /next\.delete\('observation'\)/)
  assert.match(page, /setSearchParams\(next\)/)
  assert.match(page, /selectedId === observationId/)
  assert.match(hook, /limit: '25'/)
  assert.doesNotMatch(hook, /useInfiniteQuery|fetchNextPage/)
})

test('selection reports outside-filter and outside-page deep links without loading preceding pages', () => {
  const ids = ['observation-1', 'observation-2']
  const excluded = resolveObservationSelection('observation-7', ids, ids[0], 'outside_filter')
  assert.equal(excluded.selectedId, ids[0])
  assert.match(excluded.explanation ?? '', /does not match the active Started date filter/)
  const outsidePage = resolveObservationSelection('observation-7', ids, ids[0], 'outside_page')
  assert.equal(outsidePage.selectedId, ids[0])
  assert.match(outsidePage.explanation ?? '', /outside the current bounded page/)
})
