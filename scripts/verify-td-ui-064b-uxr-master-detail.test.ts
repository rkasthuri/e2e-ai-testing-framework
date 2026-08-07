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
import * as path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ApplicationObservations } from '../forge-ui/src/components/application-workspace/ApplicationObservations'
import { resolveObservationSelection } from '../forge-ui/src/components/application-workspace/applicationObservationSelection'
import type {
  ApplicationObservationsReadModel,
  ObservationRecordReadModel,
} from '../forge-ui/src/components/application-workspace/observationsTypes'

function observation(
  index: number,
  terminalState: ObservationRecordReadModel['terminalState'],
): ObservationRecordReadModel {
  const id = `observation-${index}`
  return {
    id,
    contextId: id,
    contextLabel: 'Crawl observation',
    declaredScope: 'Configured crawl observation scope.',
    strategy: 'bfs',
    position: index === 1 ? 'latest' : 'historical',
    terminalState,
    startedAt: `2026-08-0${9 - index}T10:00:00.000Z`,
    completedAt: terminalState === 'interrupted' ? null : `2026-08-0${9 - index}T10:05:00.000Z`,
    why: terminalState === 'completed'
      ? 'The observation completed and produced 1 observed subject.'
      : 'Some application scope remained unobserved.',
    source: 'crawl-engine',
    freshness: {
      state: 'not_evaluated',
      reason: 'No approved freshness threshold exists for persisted observations.',
    },
    authentication: {
      expectation: 'form-login',
      credentialAvailability: 'available',
      outcome: terminalState === 'completed' ? 'succeeded' : 'failed',
      explanation: 'Authentication was attempted, but acceptance remained indeterminate.',
      attempts: [{
        roleId: 'attempt-1',
        outcome: terminalState === 'completed' ? 'succeeded' : 'failed',
        stages: [{
          stage: 'credential-reference-resolution',
          outcome: 'succeeded',
          selectorStrategyCategory: 'not_applicable',
        }],
      }],
    },
    observedSubjects: [{
      id: `subject-${index}`,
      kind: 'page',
      routePath: '/inventory.html',
      evidenceId: `evidence-${index}`,
    }],
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

function readModel(hasMore = false): ApplicationObservationsReadModel {
  const states: ObservationRecordReadModel['terminalState'][] = [
    'completed',
    'partially_completed',
    'failed',
    'blocked',
    'unknown',
    'interrupted',
    'completed',
    'partially_completed',
  ]
  return {
    project: { id: 'saucedemo', displayName: 'saucedemo' },
    observations: states.map((state, index) => observation(index + 1, state)),
    page: {
      previousCursor: null,
      nextCursor: hasMore ? 'next-cursor' : null,
      hasPrevious: false,
      filteredTotal: hasMore ? 12 : 8,
      projectTotal: hasMore ? 12 : 8,
    },
    filter: { startedFrom: null, startedThrough: null },
    requestedObservation: null,
  }
}

test('selection defaults to latest, restores valid deep links, and fails closed for invalid or unavailable IDs', () => {
  const ids = readModel().observations.map(item => item.id)
  assert.deepEqual(resolveObservationSelection(null, ids, ids[0], null), {
    selectedId: ids[0], explanation: null,
  })
  assert.deepEqual(resolveObservationSelection(ids[3], ids, ids[0], 'on_page'), {
    selectedId: ids[3], explanation: null,
  })
  const malformed = resolveObservationSelection('../other-project', ids, ids[0], null)
  assert.equal(malformed.selectedId, ids[0])
  assert.match(malformed.explanation ?? '', /identifier was invalid/)
  const unavailable = resolveObservationSelection('other-project-observation', ids, ids[0], 'not_found')
  assert.equal(unavailable.selectedId, ids[0])
  assert.match(unavailable.explanation ?? '', /not available for the selected project/)
})

test('bounded deep-link resolution does not append preceding pages', () => {
  const firstPage = readModel(true).observations.slice(0, 4).map(item => item.id)
  const outsidePage = resolveObservationSelection('observation-8', firstPage, firstPage[0], 'outside_page')
  assert.equal(outsidePage.selectedId, firstPage[0])
  assert.match(outsidePage.explanation ?? '', /outside the current bounded page/)
  const expanded = readModel().observations.map(item => item.id)
  const restored = resolveObservationSelection('observation-8', expanded, expanded[0], 'on_page')
  assert.equal(restored.selectedId, 'observation-8')
  assert.equal(restored.explanation, null)
})

test('eight observations render as compact master rows with exactly one selected detail', () => {
  const html = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    readModel: readModel(),
    selectedId: 'observation-3',
    onSelect: () => undefined,
    filterActive: false,
    filterDescription: 'All dates',
    onClearFilters: () => undefined,
    onPrevious: () => undefined,
    onNext: () => undefined,
  }))
  assert.equal((html.match(/<tr aria-selected=/g) ?? []).length, 8)
  assert.equal((html.match(/data-testid="selected-observation-detail"/g) ?? []).length, 1)
  assert.match(html, /Observation observation-3/)
  for (const heading of ['Position', 'Context', 'Started', 'Completed', 'Source', 'Status', 'Authentication', 'Subjects', 'Evidence']) {
    assert.match(html, new RegExp(`>${heading}<`))
  }
  for (const state of ['Completed', 'Partially completed', 'Failed', 'Blocked', 'Unknown', 'Interrupted']) {
    assert.match(html, new RegExp(state))
  }
})

test('semantic controls, row-wide mouse selection, selection announcements, responsive summaries, and disclosures remain explicit', () => {
  const source = fs.readFileSync(path.resolve('forge-ui/src/components/application-workspace/ApplicationObservations.tsx'), 'utf8')
  const page = fs.readFileSync(path.resolve('forge-ui/src/pages/ApplicationObservationsPage.tsx'), 'utf8')
  assert.match(source, /aria-label=\{`View observation \$\{observation\.id\}`\}/)
  assert.match(source, /onClick=\{\(\) => onSelect\(observation\.id\)\}/)
  assert.match(source, /aria-selected=\{selected\}/)
  assert.match(source, /Selected/)
  assert.match(source, /focus-visible:ring-2/)
  assert.match(source, /aria-expanded=\{selected\}/)
  assert.match(source, /aria-controls=\{inlineDetailId\(observation\.id\)\}/)
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /md:table/)
  assert.match(source, /md:hidden/)
  assert.match(source, /<details/)
  assert.match(source, /<summary/)
  assert.match(source, /One bounded page is shown at a time/)
  assert.equal((source.match(/<InlineObservationDetails/g) ?? []).length, 1)
  assert.match(page, /searchParams\.get\('observation'\)/)
  assert.match(page, /next\.set\('observation', observationId\)/)
  assert.match(page, /searchParams\.get\('cursor'\)/)
  assert.match(page, /next\.delete\('cursor'\)/)
})

test('rendered presentation contains no forbidden legacy diagnostic patterns or mutation controls', () => {
  const html = renderToStaticMarkup(React.createElement(ApplicationObservations, {
    readModel: readModel(true),
    selectedId: 'observation-1',
    onSelect: () => undefined,
    filterActive: false,
    filterDescription: 'All dates',
    onClearFilters: () => undefined,
    onPrevious: () => undefined,
    onNext: () => undefined,
  }))
  for (const forbidden of [
    'SAUCEDEMO_USERNAME',
    'SAUCEDEMO_PASSWORD',
    'https://www.saucedemo.com/',
    'AppModelPersistenceError',
    'schema-validation',
    'Force re-crawl',
    'Retry observation',
    'Delete observation',
    'Repair observation',
  ]) {
    assert.equal(html.includes(forbidden), false, `rendered presentation contained ${forbidden}`)
  }
  assert.match(html, /No approved freshness threshold/)
  assert.match(html, /Credentials: available/)
  assert.match(html, /Next/)
  assert.match(html, /More matching observations are available/)
})
