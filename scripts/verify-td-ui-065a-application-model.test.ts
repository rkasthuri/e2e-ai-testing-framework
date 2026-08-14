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

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'
import { canonicalEndpointSubjectId } from '../src/core/observation/ObservationSubjectIdentity'
import { presentApplicationModelHistory } from '../forge-ui/server/registry/ApplicationModelHistoryPresenter'
import { parseApplicationModelQuery } from '../forge-ui/server/context/ApplicationModelHistoryController'
import { ApplicationModel } from '../forge-ui/src/components/application-workspace/ApplicationModel'
import type { ApplicationModelHistoryResponse } from '../forge-ui/src/api/types'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-065a-'))
const dbPath = path.join(root, 'model-history.db')
const projectId = 'model-fixture'

function candidate(pageId: string, appName = projectId): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-08-06T12:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: 'Model fixture',
      baseUrl: 'https://fixture.invalid',
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:fixture',
        crawledAt: '2026-08-06T11:55:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 10,
        pagesBudget: 1,
        pagesDiscovered: 1,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [{
      id: pageId,
      displayName: pageId,
      urlPattern: `/${pageId}`,
      urlPatternType: 'exact',
      fingerprint: `fingerprint-${pageId}`,
      fingerprintBasis: 'url-only',
      appType: 'web-ui',
      accessibleByRoles: [],
      isAuthPage: false,
      elements: [],
    }],
    flows: [],
    endpoints: null,
    api: null,
    diff: null,
  }
}

before(async () => {
  initDb(dbPath)
  await runMigrations()
  const repository = new AppModelRepository()
  for (let index = 1; index <= 27; index++) {
    await repository.commitCandidate(candidate(`page-${index}`), `observation-${index}`)
  }
  await getDb().insertInto('app_models').values({
    app_name: projectId,
    version: '99.0.0',
    base_url: 'https://fixture.invalid',
    app_type: 'web-ui',
    intake_mode: 'crawl',
    crawl_config_hash: 'fixture',
    page_count: 0,
    flow_count: 0,
    role_count: 0,
    model_json: '{malformed',
    crawled_at: '2026-08-06T13:00:00.000Z',
    crawled_by: null,
    status: 'superseded',
    evidence_state: 'unknown',
    operation_id: null,
    candidate_hash: null,
    recovery_source_row_id: null,
    recovery_source_fingerprint: null,
  }).execute()
  await getDb().insertInto('app_models').values({
    app_name: projectId,
    version: '100.0.0',
    base_url: 'https://fixture.invalid',
    app_type: 'web-ui',
    intake_mode: 'crawl',
    crawl_config_hash: 'fixture',
    page_count: 0,
    flow_count: 0,
    role_count: 0,
    model_json: '{}',
    crawled_at: '2026-08-06T13:05:00.000Z',
    crawled_by: null,
    status: 'superseded',
    evidence_state: 'unknown',
    operation_id: null,
    candidate_hash: null,
    recovery_source_row_id: null,
    recovery_source_fingerprint: null,
  }).execute()
})

after(async () => {
  await closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

function fakeObservations() {
  return {
    latest: () => ({ observationId: 'observation-27' }),
    resolve: (observationId: string, owner: string) => owner === projectId
      ? {
          kind: 'terminal',
          terminal: {
            observationId,
            terminalState: 'completed',
            startedAt: '2026-08-06T11:50:00.000Z',
            completedAt: '2026-08-06T12:00:00.000Z',
            observedSubjects: [{ id: 'page-27', evidenceId: 'evidence-page-27' }],
          },
        }
      : { kind: 'not_found' },
  } as any
}

test('authority returns bounded newest-first history, separate current model, and authoritative totals', async () => {
  const result = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.total, 29)
  assert.equal(result.activeCount, 1)
  assert.equal(result.models.length, 25)
  assert.equal(result.models[0].version, '100.0.0')
  assert.equal(result.models[0].validation, 'invalid')
  assert.equal(result.models[0].subjects.length, 0)
  assert.equal(result.models[1].version, '99.0.0')
  assert.equal(result.models[1].validation, 'malformed')
  assert.equal(result.activeModel?.version, '1.0.26')
  assert.equal(result.activeModel?.lifecycle, 'active')
  assert.equal(result.activeModel?.validation, 'valid')
  assert.equal(result.activeModel?.integrity, 'verified')
  assert.equal(result.activeModel?.subjects[0].id, 'page-27')
  assert.ok(result.nextCursor)
  assert.equal(result.hasPrevious, false)
})

test('opaque project-bound pagination provides deterministic Previous and Next without changing totals', async () => {
  const repository = new AppModelRepository()
  const first = await repository.readHistory(projectId, { limit: 10 })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok' || !first.nextCursor) return
  const second = await repository.readHistory(projectId, { limit: 10, cursor: first.nextCursor })
  assert.equal(second.kind, 'ok')
  if (second.kind !== 'ok' || !second.nextCursor) return
  assert.equal(second.hasPrevious, true)
  assert.equal(second.previousCursor, null)
  assert.equal(second.total, first.total)
  assert.deepEqual(await repository.readHistory(projectId, { limit: 5, cursor: first.nextCursor }), { kind: 'invalid_cursor' })
  const third = await repository.readHistory(projectId, { limit: 10, cursor: second.nextCursor })
  assert.equal(third.kind, 'ok')
  if (third.kind !== 'ok') return
  assert.equal(third.previousCursor, first.nextCursor)
  const previous = await repository.readHistory(projectId, { limit: 10, cursor: third.previousCursor })
  assert.equal(previous.kind, 'ok')
  if (previous.kind !== 'ok') return
  assert.deepEqual(previous.models.map(model => model.rowId), second.models.map(model => model.rowId))
  assert.deepEqual(await repository.readHistory('another-project', { cursor: first.nextCursor }), { kind: 'invalid_cursor' })
})

test('requested identities distinguish on-page, outside-page, and unknown without loading unbounded history', async () => {
  const repository = new AppModelRepository()
  const first = await repository.readHistory(projectId, { limit: 5 })
  assert.equal(first.kind, 'ok')
  if (first.kind !== 'ok') return
  const onPage = await repository.readHistory(projectId, { limit: 5, requestedRowId: first.models[0].rowId })
  const outside = await repository.readHistory(projectId, { limit: 5, requestedRowId: first.models[4].rowId - 1 })
  const missing = await repository.readHistory(projectId, { limit: 5, requestedRowId: 999999 })
  assert.equal(onPage.kind === 'ok' ? onPage.requestedModel?.status : null, 'on_page')
  assert.equal(outside.kind === 'ok' ? outside.requestedModel?.status : null, 'outside_page')
  assert.equal(missing.kind === 'ok' ? missing.requestedModel?.status : null, 'not_found')
})

test('presentation joins source observation safely and keeps position, validation, integrity, projection, coverage, and freshness independent', async () => {
  const raw = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok') return
  const presented = presentApplicationModelHistory({ ...raw, projectionState: 'current' }, { id: projectId, name: 'Model fixture' }, { limit: 25, observations: fakeObservations() })
  assert.equal(presented.kind, 'ok')
  if (presented.kind !== 'ok') return
  const current = presented.value.currentModel
  assert.equal(current?.sourceObservation, null)
  assert.equal(current?.subjects[0].basis, 'unknown')
  assert.equal(current?.subjects[0].evidenceId, null)
  assert.equal(current?.freshness, 'not_evaluated')
  assert.equal(current?.coverage, 'unknown')
  assert.equal(current?.projection, 'current')
  assert.equal(presented.value.latestObservationId, null)
})

test('canonical model subject IDs remain exact and link only to the same persisted observation subject identity', async () => {
  const subjectProjectId = 'subject-identity-fixture'
  const subjectCandidate = candidate('inventory-html', subjectProjectId)
  if (!subjectCandidate.pages) throw new Error('web fixture must include pages')
  subjectCandidate.pages[0].urlPattern = '/inventory.html'
  await new AppModelRepository().commitCandidate(subjectCandidate, 'observation-subject-identity')

  const raw = await new AppModelRepository().readHistory(subjectProjectId)
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok') return
  assert.equal(raw.activeModel?.subjects[0].id, 'inventory-html')
  assert.equal(raw.activeModel?.subjects[0].routePath, '/inventory.html')

  const presented = presentApplicationModelHistory(
    { ...raw, projectionState: 'current' },
    { id: subjectProjectId, name: 'Subject identity fixture' },
    {
      limit: 25,
      observations: {
        latest: () => ({ observationId: 'observation-subject-identity' }),
        resolve: (observationId: string, owner: string) => observationId === 'observation-subject-identity' && owner === subjectProjectId
          ? {
              kind: 'terminal',
              terminal: {
                observationId,
                terminalState: 'completed',
                startedAt: '2026-08-06T11:50:00.000Z',
                completedAt: '2026-08-06T12:00:00.000Z',
                observedSubjects: [{ id: 'inventory-html', evidenceId: 'evidence-inventory' }],
              },
            }
          : { kind: 'not_found' },
      } as any,
    },
  )
  assert.equal(presented.kind, 'ok')
  if (presented.kind !== 'ok') return
  assert.deepEqual(presented.value.currentModel?.subjects[0], {
    id: 'inventory-html',
    kind: 'page',
    routePath: '/inventory.html',
    basis: 'unknown',
    evidenceId: null,
    derivedClassification: null,
  })
  assert.match(renderToStaticMarkup(React.createElement(
    MemoryRouter,
    null,
    React.createElement(ApplicationModel, {
      readModel: presented.value,
      selectedRowId: presented.value.currentModel?.rowId ?? null,
      onSelect: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
    }),
  )), />inventory-html</)
})

test('malformed metadata, missing active, and multiple active states fail closed', () => {
  const base = {
    kind: 'ok', models: [], activeModel: null, total: 0, activeCount: 0,
    nextCursor: null, previousCursor: null, hasPrevious: false,
    requestedModel: null, projectionState: 'not_evaluated',
  }
  assert.equal(presentApplicationModelHistory({ ...base, total: 1 }, { id: projectId, name: projectId }, { limit: 25 }).kind, 'active_missing')
  assert.equal(presentApplicationModelHistory({ ...base, activeCount: 2 }, { id: projectId, name: projectId }, { limit: 25 }).kind, 'multiple_active')
  assert.equal(presentApplicationModelHistory({ ...base, total: '1' }, { id: projectId, name: projectId }, { limit: 25 }).kind, 'malformed')
})

test('duplicate history identities and an inconsistent active lifecycle fail closed', async () => {
  const raw = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok' || !raw.activeModel) return
  const duplicate = presentApplicationModelHistory({
    ...raw,
    models: [raw.models[0], raw.models[0]],
    projectionState: 'current',
  }, { id: projectId, name: projectId }, { limit: 25, observations: fakeObservations() })
  assert.equal(duplicate.kind, 'malformed')
  const inconsistent = presentApplicationModelHistory({
    ...raw,
    activeModel: { ...raw.activeModel, lifecycle: 'superseded' },
    projectionState: 'current',
  }, { id: projectId, name: projectId }, { limit: 25, observations: fakeObservations() })
  assert.equal(inconsistent.kind, 'malformed')
})

test('REST endpoint subjects receive a bounded safe identity without exposing a full URL', async () => {
  const apiCandidate: AppModelCandidate = {
    ...candidate('unused'),
    app: {
      ...candidate('unused').app,
      name: 'api-fixture',
      displayName: 'API fixture',
      appType: 'rest-api',
    },
    pages: null,
    flows: null,
    endpoints: [{ method: 'GET', path: '/items', summary: 'Items', auth: false }],
  }
  await new AppModelRepository().commitCandidate(apiCandidate, 'observation-api')
  const result = await new AppModelRepository().readHistory('api-fixture')
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.deepEqual(result.activeModel?.subjects, [{
    id: canonicalEndpointSubjectId({ method: 'GET', path: '/items' }),
    kind: 'endpoint',
    routePath: '/items',
    derivedClassification: null,
  }])
})

test('guarded recovery provenance is allowlisted and source-fingerprint verification remains explicit', async () => {
  const raw = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok' || !raw.activeModel) return
  const recovered = {
    ...raw.activeModel,
    recovery: {
      sourceRowId: 5,
      sourceVersion: '1.0.4',
      sourceFingerprint: 'a'.repeat(64),
      sourceFingerprintMatches: true,
    },
  }
  const presented = presentApplicationModelHistory({
    ...raw,
    activeModel: recovered,
    models: raw.models.map(model => model.rowId === recovered.rowId ? recovered : model),
    projectionState: 'current',
  }, { id: projectId, name: projectId }, { limit: 25, observations: fakeObservations() })
  assert.equal(presented.kind, 'ok')
  if (presented.kind !== 'ok') return
  assert.deepEqual(presented.value.currentModel?.recovery, recovered.recovery)
})

test('query validation bounds pagination and rejects malformed identities and cursors', () => {
  assert.deepEqual(parseApplicationModelQuery({}), { ok: true, limit: 25, cursor: null, requestedRowId: null })
  assert.equal(parseApplicationModelQuery({ limit: '0' }).ok, false)
  assert.equal(parseApplicationModelQuery({ limit: '51' }).ok, false)
  assert.equal(parseApplicationModelQuery({ cursor: '../unsafe' }).ok, false)
  assert.equal(parseApplicationModelQuery({ model: '0' }).ok, false)
  assert.deepEqual(parseApplicationModelQuery({ limit: '50', cursor: 'opaque_cursor', model: '7' }), { ok: true, limit: 50, cursor: 'opaque_cursor', requestedRowId: 7 })
})

test('safe serialized presentation excludes raw model and internal diagnostic channels', async () => {
  const raw = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok') return
  const presented = presentApplicationModelHistory({ ...raw, projectionState: 'current' }, { id: projectId, name: projectId }, { limit: 25, observations: fakeObservations() })
  assert.equal(presented.kind, 'ok')
  const serialized = JSON.stringify(presented)
  for (const forbidden of ['model_json', 'baseUrl', 'schema-validation', 'sqlite', 'stack', 'credential', 'environment']) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false)
  }
})

function uiReadModel(raw: any): ApplicationModelHistoryResponse {
  const presented = presentApplicationModelHistory({ ...raw, projectionState: 'current' }, { id: projectId, name: 'Model fixture' }, { limit: 25, observations: fakeObservations() })
  assert.equal(presented.kind, 'ok')
  if (presented.kind !== 'ok') throw new Error('fixture presentation failed')
  return presented.value
}

test('UI renders current separately, one inline detail, semantic selection controls, responsive cards, and no mutation actions', async () => {
  const raw = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(raw.kind, 'ok')
  if (raw.kind !== 'ok') return
  const readModel = uiReadModel(raw)
  const selected = readModel.models[6].rowId
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(ApplicationModel, {
      readModel,
      selectedRowId: selected,
      onSelect: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
    }),
  ))
  assert.match(markup, /Current active model/)
  assert.equal((markup.match(/<h1/g) ?? []).length, 1)
  assert.match(markup, /Total model versions:.*29/)
  assert.match(markup, /Currently active:.*1/)
  assert.equal((markup.match(/role="region"/g) ?? []).length, 1)
  assert.match(markup, new RegExp(`aria-label="View model ${selected}"`))
  assert.match(markup, /aria-expanded="true"/)
  assert.match(markup, /aria-controls=/)
  assert.match(markup, /aria-selected="true"/)
  assert.match(markup, /Freshness.*Not evaluated/s)
  assert.match(markup, /Coverage.*Unknown/s)
  assert.doesNotMatch(markup, />\s*(Edit|Delete|Activate|Supersede|Recover|Rebuild|Retry|Crawl|Force re-crawl)\s*</i)
  const source = fs.readFileSync(path.resolve('forge-ui/src/components/application-workspace/ApplicationModel.tsx'), 'utf8')
  assert.match(source, /onClick=\{\(\) => onSelect\(model\.rowId\)\}/)
  assert.match(source, /focus-visible:ring-2/)
  assert.match(source, /md:hidden/)
})

test('restart re-read preserves ordering, totals, current identity, and safe presentation', async () => {
  const before = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(before.kind, 'ok')
  if (before.kind !== 'ok') return
  await closeDb()
  initDb(dbPath)
  const afterRestart = await new AppModelRepository().readHistory(projectId, { limit: 25 })
  assert.equal(afterRestart.kind, 'ok')
  if (afterRestart.kind !== 'ok') return
  assert.equal(afterRestart.total, before.total)
  assert.equal(afterRestart.activeCount, before.activeCount)
  assert.equal(afterRestart.activeModel?.rowId, before.activeModel?.rowId)
  assert.deepEqual(afterRestart.models.map(model => [model.rowId, model.version, model.lifecycle, model.validation, model.integrity]), before.models.map(model => [model.rowId, model.version, model.lifecycle, model.validation, model.integrity]))
})
