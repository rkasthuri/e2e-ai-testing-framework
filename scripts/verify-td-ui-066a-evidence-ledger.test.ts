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
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import { parseEvidenceLedgerQuery } from '../forge-ui/server/context/EvidenceLedgerController'
import { BootstrapEvidenceReader } from '../forge-ui/server/registry/BootstrapEvidenceReader'
import { presentEvidenceLedger, type EvidenceLedgerQuery } from '../forge-ui/server/registry/EvidenceLedgerPresenter'
import type { ObservationHistoryItem } from '../forge-ui/server/registry/ObservationStore'
import { ApplicationEvidence } from '../forge-ui/src/components/application-workspace/ApplicationEvidence'
import { evidenceCalendarBoundary, isValidEvidenceCalendarDate } from '../forge-ui/src/components/application-workspace/evidenceLedgerDateFilter'

const project = { id: 'alpha', name: 'Alpha' }

function observation(
  id: string,
  completedAt: string,
  outcome: 'completed' | 'failed' = 'completed',
  subjects = ['inventory-html'],
): ObservationHistoryItem {
  const startedAt = new Date(Date.parse(completedAt) - 60_000).toISOString()
  const start = {
    schemaVersion: 1 as const,
    observationId: id,
    projectId: project.id,
    projectName: project.name,
    observationContext: { id, label: 'Fixture', target: 'https://unsafe.invalid', declaredScope: 'Fixture', strategy: 'bfs' },
    sourceKind: 'crawl-engine' as const,
    startedAt,
    credentialAvailability: 'unknown' as const,
    authenticationExpectation: 'unknown',
  }
  const observedSubjects = subjects.map((subject, index) => ({ id: subject, kind: 'page' as const, value: `/${subject.replace('-html', '.html')}`, evidenceId: `${id}-page-${index + 1}` }))
  return {
    observationId: id,
    orderingTimestamp: completedAt,
    position: id === 'obs-new' ? 'latest' : 'historical',
    state: outcome,
    start,
    terminal: {
      ...start,
      completedAt,
      terminalState: outcome,
      stateReason: 'UNSAFE internal exception https://unsafe.invalid SECRET_ENV',
      authentication: { expectation: 'unknown', credentialAvailability: 'unknown', outcome: 'not_evaluated', reason: 'UNSAFE', attempts: [] },
      observedSubjects,
      unobservedScope: [], unknowns: [], blockers: [], errors: [], recommendation: null,
      evidence: observedSubjects.map(subject => ({
        id: subject.evidenceId,
        subject: subject.value,
        summary: 'UNSAFE raw page content and secret value',
        capturedAt: completedAt,
        provenance: { kind: 'crawl-run' as const, reference: id },
        integrity: 'valid' as const,
      })),
    },
  }
}

function query(overrides: Partial<EvidenceLedgerQuery> = {}): EvidenceLedgerQuery {
  return {
    limit: 25,
    cursor: null,
    requestedEvidenceId: null,
    sourceClass: null,
    support: null,
    integrity: null,
    observationId: null,
    capturedFrom: null,
    capturedThrough: null,
    ...overrides,
  }
}

function fixture(overrides: Partial<Parameters<typeof presentEvidenceLedger>[0]> = {}) {
  const observations = [
    observation('obs-new', '2026-08-06T14:00:00.000Z', 'completed', ['inventory-html', 'cart-html']),
    observation('obs-old', '2026-08-05T14:00:00.000Z', 'failed'),
  ]
  return presentEvidenceLedger({
    project,
    observations,
    bootstrapEvidence: [{
      id: `bootstrap-${'a'.repeat(64)}`,
      canonicalSubjectId: 'goal:fixture',
      capturedAt: '2026-08-04T14:00:00.000Z',
      observationType: 'direct_observation',
      confidence: 'high',
      goalOrigin: 'observed',
    }],
    models: [
      { rowId: 7, version: '1.0.6', lifecycle: 'active', sourceObservationId: 'obs-new', subjects: [{ id: 'inventory-html', evidenceId: 'obs-new-page-1' }, { id: 'cart-html', evidenceId: 'obs-new-page-2' }] },
      { rowId: 6, version: '1.0.5', lifecycle: 'superseded', sourceObservationId: 'obs-old', subjects: [{ id: 'inventory-html', evidenceId: 'obs-old-page-1' }] },
    ],
    query: query(),
    ...overrides,
  })
}

function renderLedger(readModel: any, selectedEvidenceId: string | null): string {
  return renderToStaticMarkup(React.createElement(
    MemoryRouter,
    null,
    React.createElement(ApplicationEvidence, {
      readModel,
      selectedEvidenceId,
      onSelect: () => {},
      onPrevious: () => {},
      onNext: () => {},
      filterToolbar: React.createElement('div', null, 'Filters'),
    }),
  ))
}

test('unified authority projection orders exact evidence identities newest-first and reports factual totals', () => {
  const result = fixture()
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.deepEqual(result.value.evidence.map(item => item.id), ['obs-new-page-1', 'obs-new-page-2', 'obs-old-page-1', `bootstrap-${'a'.repeat(64)}`])
  assert.equal(result.value.page.projectTotal, 4)
  assert.equal(result.value.page.filteredTotal, 4)
  assert.equal(result.value.page.currentSupportTotal, 2)
  assert.equal(result.value.page.historicalSupportTotal, 2)
  assert.equal(result.value.ordering, 'captured-desc-id-asc-v1')
})

test('current support, lifecycle, freshness, integrity, conflict, access, and observation outcome stay independent', () => {
  const result = fixture()
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  const current = result.value.evidence[0]
  const historical = result.value.evidence[2]
  assert.equal(current.support, 'current')
  assert.equal(current.sourceModels[0].lifecycle, 'active')
  assert.equal(current.sourceObservation?.outcome, 'completed')
  assert.equal(current.freshness, 'not_evaluated')
  assert.equal(current.conflict, 'not_evaluated')
  assert.equal(current.access, 'available')
  assert.equal(historical.support, 'historical')
  assert.equal(historical.sourceObservation?.outcome, 'failed')
})

test('filtering occurs before bounded pagination and totals remain authoritative', () => {
  const result = fixture({ query: query({ support: 'current', limit: 1 }) })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.value.evidence.length, 1)
  assert.equal(result.value.page.filteredTotal, 2)
  assert.equal(result.value.page.projectTotal, 4)
  assert.ok(result.value.page.nextCursor)
  const second = fixture({ query: query({ support: 'current', limit: 1, cursor: result.value.page.nextCursor }) })
  assert.equal(second.kind, 'ok')
  if (second.kind === 'ok') assert.equal(second.value.evidence[0].id, 'obs-new-page-2')
})

test('opaque cursors are bound to project, ordering, and the full filter set', () => {
  const first = fixture({ query: query({ limit: 1 }) })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok') return
  assert.equal(fixture({ query: query({ limit: 1, support: 'current', cursor: first.value.page.nextCursor }) }).kind, 'invalid_cursor')
  assert.equal(fixture({ project: { id: 'beta', name: 'Beta' }, query: query({ limit: 1, cursor: first.value.page.nextCursor }) }).kind, 'ownership_mismatch')
})

test('Previous and Next keep one bounded page while authoritative totals remain stable', () => {
  const many = Array.from({ length: 55 }, (_, index) => observation(
    `obs-${String(index).padStart(2, '0')}`,
    new Date(Date.parse('2026-08-06T14:00:00.000Z') - index * 60_000).toISOString(),
  ))
  const first = fixture({ observations: many, bootstrapEvidence: [], models: [], query: query({ limit: 25 }) })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok') return
  const second = fixture({ observations: many, bootstrapEvidence: [], models: [], query: query({ limit: 25, cursor: first.value.page.nextCursor }) })
  assert.equal(second.kind, 'ok')
  if (second.kind !== 'ok') return
  const third = fixture({ observations: many, bootstrapEvidence: [], models: [], query: query({ limit: 25, cursor: second.value.page.nextCursor }) })
  assert.equal(third.kind, 'ok')
  if (third.kind !== 'ok') return
  assert.equal(first.value.evidence.length, 25)
  assert.equal(second.value.evidence.length, 25)
  assert.equal(third.value.evidence.length, 5)
  assert.equal(third.value.page.projectTotal, 55)
  assert.ok(third.value.page.previousCursor)
  const back = fixture({ observations: many, bootstrapEvidence: [], models: [], query: query({ limit: 25, cursor: third.value.page.previousCursor }) })
  assert.equal(back.kind, 'ok')
  if (back.kind === 'ok') assert.deepEqual(back.value.evidence.map(item => item.id), second.value.evidence.map(item => item.id))
})

test('captured date filters use inclusive local-calendar boundaries and reject reversed or invalid dates', () => {
  assert.equal(isValidEvidenceCalendarDate('2026-02-29'), false)
  assert.equal(isValidEvidenceCalendarDate('2026-08-06'), true)
  const from = evidenceCalendarBoundary('2026-08-06', false)
  const through = evidenceCalendarBoundary('2026-08-06', true)
  assert.ok(from < through)
  const result = fixture({ query: query({ capturedFrom: from, capturedThrough: through }) })
  assert.equal(result.kind, 'ok')
  if (result.kind === 'ok') assert.equal(result.value.page.filteredTotal, 2)
  assert.equal(parseEvidenceLedgerQuery({ capturedFrom: through, capturedThrough: from }).ok, false)
  assert.equal(parseEvidenceLedgerQuery({ capturedFrom: '2026-08-06' }).ok, false)
})

test('source, support, integrity, observation, limit, identity, and cursor query inputs fail closed', () => {
  for (const invalid of [
    { sourceClass: 'logs' }, { support: 'healthy' }, { integrity: 'current' }, { limit: '51' },
    { observation: '../foreign' }, { evidence: '<unsafe>' }, { cursor: '*' },
  ]) assert.equal(parseEvidenceLedgerQuery(invalid).ok, false)
  assert.equal(parseEvidenceLedgerQuery({ sourceClass: 'onboarding', limit: '25' }).ok, true)
})

test('duplicate identities, project ownership conflicts, and broken active-model references fail closed', () => {
  const duplicate = observation('obs-new', '2026-08-06T14:00:00.000Z')
  assert.equal(fixture({ observations: [duplicate, duplicate] }).kind, 'malformed')
  const foreign = observation('obs-foreign', '2026-08-06T14:00:00.000Z')
  foreign.start.projectId = 'beta'
  assert.equal(fixture({ observations: [foreign] }).kind, 'ownership_mismatch')
  assert.equal(fixture({ models: [{ rowId: 7, version: '1.0.6', lifecycle: 'active', sourceObservationId: 'obs-new', subjects: [{ id: 'inventory-html', evidenceId: 'missing' }] }] }).kind, 'malformed')
})

test('bootstrap reader derives stable project-scoped identities and omits unrestricted values and sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-066a-bootstrap-'))
  const resolver = new WorkspaceResolver(root)
  const forgeDir = resolver.resolve('alpha').forgeDir
  fs.mkdirSync(forgeDir, { recursive: true })
  fs.writeFileSync(path.join(forgeDir, 'bootstrap-evidence.json'), JSON.stringify({
    schemaVersion: '1.0', appName: 'alpha', url: 'https://secret.invalid', missionType: 'bootstrap', producedAt: '2026-08-04T14:00:00.000Z',
    records: [{ field: 'goal:fixture', value: 'SECRET_VALUE', source: 'SECRET_ENV', observationType: 'direct_observation', confidence: 'high', goalOrigin: 'observed', timestamp: '2026-08-04T14:00:00.000Z' }],
  }))
  const reader = new BootstrapEvidenceReader(resolver)
  const first = reader.read('alpha')
  const second = reader.read('alpha')
  assert.deepEqual(second, first)
  assert.equal(first.kind, 'ok')
  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /SECRET_VALUE|SECRET_ENV|secret\.invalid/)
  assert.match(serialized, /projection|bootstrap-[a-f0-9]{64}|goal:fixture/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('API projection and rendered page omit forbidden raw content and unrestricted persisted prose', () => {
  const result = fixture()
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  const markup = renderLedger(result.value, 'obs-new-page-1')
  const combined = `${JSON.stringify(result.value)}${markup}`
  assert.doesNotMatch(combined, /UNSAFE|SECRET_ENV|unsafe\.invalid|raw page content/i)
  assert.doesNotMatch(combined, /password|cookie|token|raw model JSON|sqlite|stack trace/i)
  assert.match(markup, /inventory-html/)
  assert.match(markup, /\/inventory\.html/)
})

test('compact ledger renders one inline detail with semantic controls, links, disclosures, and independent labels', () => {
  const result = fixture()
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  const markup = renderLedger(result.value, 'obs-new-page-1')
  assert.equal((markup.match(/role="region"/g) ?? []).length, 1)
  assert.match(markup, /aria-label="View evidence obs-new-page-1"/)
  assert.match(markup, /aria-expanded="true"/)
  assert.match(markup, /aria-controls="evidence-detail-obs-new-page-1"/)
  assert.match(markup, /Provenance|Observation and subject|Usage and model linkage|Integrity and freshness|Conflicts|Limitations and unknowns/)
  assert.match(markup, /application\/observations\?project=alpha&amp;observation=obs-new/)
  assert.match(markup, /application\/model\?project=alpha&amp;model=7/)
  assert.match(markup, /xl:table|xl:hidden|focus-visible:ring-2/)
})

test('collapsed selection renders zero details and never adds mutation or completeness controls', () => {
  const result = fixture()
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  const markup = renderLedger(result.value, null)
  assert.equal((markup.match(/role="region"/g) ?? []).length, 0)
  assert.doesNotMatch(markup, />\s*(Start|Retry|Force re-crawl|Delete|Repair|Regenerate|Export)\s*</i)
  assert.match(markup, /Coverage: Unknown|do not establish application completeness/)
})

test('projection is read-only with respect to supplied immutable authority records', () => {
  const observations = [observation('obs-new', '2026-08-06T14:00:00.000Z')]
  const before = JSON.stringify(observations)
  presentEvidenceLedger({ project, observations, bootstrapEvidence: [], models: [{ rowId: 7, version: '1.0.6', lifecycle: 'active', sourceObservationId: 'obs-new', subjects: [{ id: 'inventory-html', evidenceId: 'obs-new-page-1' }] }], query: query() })
  assert.equal(JSON.stringify(observations), before)
})
