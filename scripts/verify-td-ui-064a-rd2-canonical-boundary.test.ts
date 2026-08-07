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
 * TD-UI-064A-RD2 focused proof for the canonical App Model candidate boundary.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as crypto from 'crypto'
import { sql } from 'kysely'
import { ElementClassifier } from '../src/core/onboarding/ElementClassifier'
import { ApiSpecCrawler } from '../src/core/onboarding/ApiSpecCrawler'
import { Crawler } from '../src/core/onboarding/Crawler'
import type { AppModelCandidate, RawElement } from '../src/core/onboarding/types'
import {
  AppModelCanonicalCandidateError,
  materializeAppModelCandidate,
  materializeAppModelSnapshot,
} from '../src/core/storage/AppModelCanonicalCandidate'
import { AppModelService } from '../src/core/storage/AppModelService'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { representativeNinePageCandidate } from './fixtures/td-ui-064a-rd2-nine-page-candidate'

const legacyRaw = '{"legacy-structural-fixture":true}'

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function boundaryError(candidate: unknown): AppModelCanonicalCandidateError {
  try {
    materializeAppModelCandidate(candidate)
  } catch (cause) {
    assert.ok(cause instanceof AppModelCanonicalCandidateError)
    return cause
  }
  assert.fail('candidate unexpectedly crossed the canonical boundary')
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]),
  )
}

async function insertLiveShapedHistory(appName: string): Promise<number> {
  let activeRowId = 0
  for (let patch = 0; patch <= 4; patch++) {
    const row = await getDb().insertInto('app_models').values({
      app_name: appName,
      version: `1.0.${patch}`,
      base_url: `https://${appName}.example.invalid`,
      app_type: 'web-ui',
      intake_mode: 'crawl',
      crawl_config_hash: '',
      page_count: 0,
      flow_count: 0,
      role_count: 0,
      model_json: legacyRaw,
      crawled_at: null,
      crawled_by: null,
      status: patch === 4 ? 'active' : 'superseded',
      evidence_state: 'crawled',
      operation_id: null,
      candidate_hash: null,
      recovery_source_row_id: null,
      recovery_source_fingerprint: null,
    }).returning('id').executeTakeFirstOrThrow()
    if (patch === 4) activeRowId = Number(row.id)
  }
  return activeRowId
}

function recoveryRequest(appName: string, sourceRowId: number, operationId: string) {
  return {
    app_name: appName,
    operation_id: operationId,
    expected_row_id: sourceRowId,
    expected_source_fingerprint: sha256(legacyRaw),
    operator_acknowledgement: true as const,
  }
}

before(async () => {
  initDb(':memory:')
  await runMigrations()
})

after(async () => {
  await closeDb()
})

test('nine-page fixture omits every legitimately absent optional object property recursively', () => {
  const candidate = representativeNinePageCandidate()
  ;(candidate as any).classificationRunId = undefined
  ;(candidate.roles[0] as any).observedPostAuthUrl = undefined
  ;(candidate.pages![0].elements[0].cardinality as any).hint = undefined
  ;(candidate.pages![0].module as any).reason = undefined
  candidate.pages![0].prerequisites = [{ roleId: undefined, steps: [] } as any]

  const result = materializeAppModelCandidate(candidate)
  assert.equal(result.candidate.pages?.length, 9)
  assert.deepEqual(
    result.omittedOptionalProperties.map(issue => issue.path),
    [
      '/classificationRunId',
      '/pages/0/elements/0/cardinality/hint',
      '/pages/0/module/reason',
      '/pages/0/prerequisites/0/roleId',
      '/roles/0/observedPostAuthUrl',
    ],
  )
  assert.equal(Object.hasOwn(result.candidate, 'classificationRunId'), false)
  assert.equal(Object.hasOwn(result.candidate.roles[0], 'observedPostAuthUrl'), false)
  assert.equal(Object.hasOwn(result.candidate.pages![0].elements[0].cardinality!, 'hint'), false)
  assert.equal(Object.hasOwn(result.candidate.pages![0].module!, 'reason'), false)
})

test('element builder omits absent role names and repeated hints', () => {
  const raw: RawElement = {
    tag: 'button',
    type: 'button',
    dataTest: null,
    id: null,
    ariaLabel: null,
    labelText: null,
    placeholder: null,
    textContent: null,
    role: 'button',
    name: null,
    href: null,
    index: 0,
    containerIndex: 0,
    containerHint: null,
    alt: null,
    inForm: false,
    observedState: 'visible',
  }
  const classifier = new ElementClassifier({} as any, 'synthetic-page', {} as any)
  const element = (classifier as any).classifyElement(raw)
  const roleStrategy = element.strategies.find((item: any) => item.type === 'role')
  assert.ok(roleStrategy)
  assert.equal(Object.hasOwn(roleStrategy, 'accessibleName'), false)
  assert.equal(Object.hasOwn(element.cardinality, 'hint'), false)
})

test('prerequisite and API builders omit absent optional properties', () => {
  const candidate = representativeNinePageCandidate()
  const config = {
    app: {
      name: 'rd2-builder-fixture',
      baseUrl: 'https://rd2-builder-fixture.example.invalid',
      appType: 'web-ui',
    },
    roles: [],
    pagePrerequisites: [{
      pageId: 'inventory',
      steps: [{ action: 'synthetic-setup' }],
    }],
  }
  const crawler = new Crawler(config as any)
  ;(crawler as any).applyPagePrerequisites(candidate.pages)
  assert.equal(Object.hasOwn(candidate.pages![0].prerequisites![0], 'roleId'), false)

  const apiCrawler = new ApiSpecCrawler(config as any)
  const endpoints = (apiCrawler as any).parseOpenApiSpec({
    openapi: '3.0.0',
    paths: { '/synthetic': { get: { responses: {} } } },
  })
  assert.equal(endpoints.length, 1)
  assert.equal(Object.hasOwn(endpoints[0], 'parameters'), false)
})

test('undefined array entries and holes fail closed at every repeated-element path', () => {
  const candidate = representativeNinePageCandidate()
  ;(candidate.pages![0].elements as any[])[0] = undefined
  delete (candidate.pages![1].elements as any[])[1]
  const error = boundaryError(candidate)
  assert.deepEqual(
    error.issues.filter(issue => issue.category === 'undefined-array-entry'),
    [
      { path: '/pages/0/elements/0', category: 'undefined-array-entry', valueType: 'undefined' },
      { path: '/pages/1/elements/1', category: 'undefined-array-entry', valueType: 'undefined' },
    ],
  )
})

test('undefined required properties fail schema validation before persistence', () => {
  const candidate = representativeNinePageCandidate()
  ;(candidate.pages![2] as any).id = undefined
  const error = boundaryError(candidate)
  assert.ok(error.issues.some(issue =>
    issue.path === '/pages/2/id'
    && issue.category === 'undefined-required-property'
    && issue.valueType === 'undefined',
  ))
})

test('every unsupported runtime value fails closed with path and type only', () => {
  class UnsupportedFixture { marker = 'must-not-appear' }
  const cases: Array<[string, unknown, string]> = [
    ['function', () => 'must-not-appear', 'function'],
    ['symbol', Symbol('must-not-appear'), 'symbol'],
    ['bigint', BigInt(1), 'bigint'],
    ['nan', Number.NaN, 'non-finite-number'],
    ['positive-infinity', Number.POSITIVE_INFINITY, 'non-finite-number'],
    ['negative-infinity', Number.NEGATIVE_INFINITY, 'non-finite-number'],
    ['date', new Date('2026-08-05T00:00:00.000Z'), 'unsupported-object'],
    ['map', new Map([['must-not-appear', 1]]), 'unsupported-object'],
    ['class-instance', new UnsupportedFixture(), 'unsupported-object'],
  ]
  for (const [name, runtimeValue, valueType] of cases) {
    const candidate = representativeNinePageCandidate(`rd2-${name}`)
    ;(candidate.pages![3].module as any).reason = runtimeValue
    const error = boundaryError(candidate)
    assert.ok(error.issues.some(issue =>
      issue.path === '/pages/3/module/reason'
      && issue.category === 'unsupported-runtime-value'
      && issue.valueType === valueType,
    ), name)
    assert.doesNotMatch(JSON.stringify(error), /must-not-appear|2026-08-05T00:00:00/i)
  }
})

test('circular, accessor, symbol-key, and non-enumerable structures fail without reading values', () => {
  const candidate = representativeNinePageCandidate()
  const module = candidate.pages![4].module as any
  module.circular = module
  Object.defineProperty(module, 'accessor', {
    enumerable: true,
    get: () => assert.fail('canonical materialization must not execute getters'),
  })
  Object.defineProperty(module, 'hidden', { enumerable: false, value: 'must-not-appear' })
  module[Symbol('must-not-appear')] = 'must-not-appear'
  const error = boundaryError(candidate)
  assert.deepEqual(
    error.issues.filter(issue => issue.category === 'unsupported-runtime-value'),
    [
      { path: '/pages/4/module/$symbol', category: 'unsupported-runtime-value', valueType: 'symbol-key' },
      { path: '/pages/4/module/accessor', category: 'unsupported-runtime-value', valueType: 'accessor-property' },
      { path: '/pages/4/module/circular', category: 'unsupported-runtime-value', valueType: 'circular-reference' },
      { path: '/pages/4/module/hidden', category: 'unsupported-runtime-value', valueType: 'non-enumerable-property' },
    ],
  )
  assert.doesNotMatch(JSON.stringify(error), /must-not-appear/i)
})

test('semantically identical candidates produce the same canonical bytes and hash', () => {
  const original = representativeNinePageCandidate('rd2-deterministic')
  ;(original.pages![0].elements[0].cardinality as any).hint = undefined
  const reordered = reverseObjectKeys(original) as AppModelCandidate
  const first = materializeAppModelCandidate(original)
  const second = materializeAppModelCandidate(reordered)
  assert.equal(first.canonicalJson, second.canonicalJson)
  assert.equal(first.candidateHash, second.candidateHash)
  assert.equal(first.candidateHash, sha256(first.canonicalJson))
})

test('snapshot validation, hashing, and persistence share the materialized representation', async () => {
  const appName = 'rd2-shared-representation'
  const sourceRowId = await insertLiveShapedHistory(appName)
  const rawCandidate = representativeNinePageCandidate(appName)
  ;(rawCandidate.pages![0].elements[0].cardinality as any).hint = undefined
  const boundary = materializeAppModelCandidate(rawCandidate)
  const expectedSnapshot = materializeAppModelSnapshot(boundary, '1.0.5')

  const result = await new AppModelService().commitRecoveryAndProject(
    rawCandidate,
    recoveryRequest(appName, sourceRowId, 'rd2-shared-representation'),
    async () => {},
  )
  assert.equal(result.status, 'commit_and_projection_succeeded')
  const rows = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', appName).orderBy('id').execute()
  const source = rows.find(row => Number(row.id) === sourceRowId)!
  const replacement = rows.find(row => row.status === 'active')!
  assert.equal(rows.length, 6)
  assert.equal(source.model_json, legacyRaw)
  assert.equal(sha256(source.model_json), sha256(legacyRaw))
  assert.equal(source.status, 'superseded')
  assert.equal(replacement.version, '1.0.5')
  assert.equal(replacement.candidate_hash, boundary.candidateHash)
  assert.equal(replacement.model_json, expectedSnapshot.canonicalJson)
  const persisted = JSON.parse(replacement.model_json)
  delete persisted.app.modelVersion
  assert.equal(JSON.stringify(persisted), boundary.canonicalJson)
})

test('boundary and SQLite failures preserve atomicity, legacy bytes, and redacted diagnostics', async () => {
  const boundaryApp = 'rd2-boundary-rollback'
  const boundarySource = await insertLiveShapedHistory(boundaryApp)
  const invalid = representativeNinePageCandidate(boundaryApp)
  ;(invalid.pages![5].module as any).reason = new class { secret = 'raw-secret-marker' }()
  const beforeBoundary = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', boundaryApp).orderBy('id').execute()
  const boundaryResult = await new AppModelService().commitRecoveryAndProject(
    invalid,
    recoveryRequest(boundaryApp, boundarySource, 'rd2-boundary-rollback'),
    async () => assert.fail('projection must not run'),
  )
  assert.equal(boundaryResult.status, 'commit_failed')
  if (boundaryResult.status === 'commit_failed') {
    assert.equal(boundaryResult.error.diagnostic?.stage, 'candidate-materialization')
    assert.deepEqual(boundaryResult.error.diagnostic?.structuralIssues, [{
      path: '/pages/5/module/reason',
      category: 'unsupported-runtime-value',
      valueType: 'unsupported-object',
    }])
    assert.doesNotMatch(JSON.stringify(boundaryResult.error), /raw-secret-marker/i)
  }
  assert.deepEqual(
    await getDb().selectFrom('app_models').selectAll()
      .where('app_name', '=', boundaryApp).orderBy('id').execute(),
    beforeBoundary,
  )

  const sqliteApp = 'rd2-sqlite-rollback'
  const sqliteSource = await insertLiveShapedHistory(sqliteApp)
  await sql.raw(`
    CREATE TRIGGER rd2_sqlite_rollback
    BEFORE INSERT ON app_models
    WHEN NEW.operation_id = 'rd2-sqlite-rollback'
    BEGIN
      SELECT RAISE(ABORT, 'raw-secret-marker C:\\private\\database.db');
    END
  `).execute(getDb())
  const sqliteResult = await new AppModelService().commitRecoveryAndProject(
    representativeNinePageCandidate(sqliteApp),
    recoveryRequest(sqliteApp, sqliteSource, 'rd2-sqlite-rollback'),
    async () => assert.fail('projection must not run'),
  )
  assert.equal(sqliteResult.status, 'commit_failed')
  if (sqliteResult.status === 'commit_failed') {
    assert.equal(sqliteResult.error.diagnostic?.stage, 'transaction-replacement-insert')
    assert.doesNotMatch(JSON.stringify(sqliteResult.error), /raw-secret-marker|private|database\.db/i)
  }
  const sqliteRows = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', sqliteApp).orderBy('id').execute()
  assert.equal(sqliteRows.length, 5)
  assert.equal(sqliteRows.find(row => Number(row.id) === sqliteSource)?.status, 'active')
  assert.equal(sqliteRows.find(row => Number(row.id) === sqliteSource)?.model_json, legacyRaw)
  assert.equal(sha256(sqliteRows.find(row => Number(row.id) === sqliteSource)!.model_json), sha256(legacyRaw))
})
