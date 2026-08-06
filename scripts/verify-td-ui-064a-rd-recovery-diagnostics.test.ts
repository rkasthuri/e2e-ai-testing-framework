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

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as crypto from 'crypto'
import { sql } from 'kysely'
import type { AppModelCandidate, ElementDefinition, RawElement } from '../src/core/onboarding/types'
import { ElementClassifier } from '../src/core/onboarding/ElementClassifier'
import { AppModelService } from '../src/core/storage/AppModelService'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import type { AppModelPersistenceError } from '../src/core/storage/repositories/AppModelRepository'
import {
  classifyTerminalState,
  formatRecoveryPersistenceDiagnostic,
  isModelCompatibilityError,
  readEngineRecoveryFailure,
  recoveryFailureRecommendation,
} from '../forge-ui/server/routes/crawl'

const legacyRaw = '{"legacy":true}'

function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function classifyRepeatedWithoutHint(): ElementDefinition {
  const raw: RawElement = {
    tag: 'button',
    type: 'button',
    dataTest: 'inventory-item',
    id: null,
    ariaLabel: null,
    labelText: null,
    placeholder: null,
    textContent: 'Inventory item',
    role: null,
    name: null,
    href: null,
    index: 0,
    containerIndex: 0,
    containerHint: null,
    alt: null,
    inForm: false,
    observedState: 'visible',
  }
  const classifier = new ElementClassifier({} as any, 'inventory', {} as any)
  return (classifier as any).classifyElement(raw) as ElementDefinition
}

function candidate(appName: string, element = classifyRepeatedWithoutHint()): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-08-05T12:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: appName,
      baseUrl: `https://${appName}.example.invalid`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'td-ui-064a-rd',
        crawledAt: '2026-08-05T12:00:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 1,
        pagesBudget: 50,
        pagesDiscovered: 1,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [{
      id: 'inventory',
      displayName: 'Inventory',
      urlPattern: '/inventory.html',
      urlPatternType: 'exact',
      fingerprint: 'dom-fingerprint',
      fingerprintBasis: 'url-only',
      appType: 'web-ui',
      accessibleByRoles: [],
      isAuthPage: false,
      elements: [element],
      module: {
        name: 'Products',
        confidence: 'medium',
        method: 'rule',
        evidenceIds: ['inventory'],
      },
    }],
    flows: [],
    endpoints: null,
    api: null,
    diff: null,
  }
}

async function insertLiveShapedHistory(appName: string): Promise<number> {
  let activeRowId = 0
  for (let patch = 0; patch <= 4; patch++) {
    const inserted = await getDb().insertInto('app_models').values({
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
    if (patch === 4) activeRowId = Number(inserted.id)
  }
  return activeRowId
}

function recoveryRequest(appName: string, rowId: number, operationId: string) {
  return {
    app_name: appName,
    operation_id: operationId,
    expected_row_id: rowId,
    expected_source_fingerprint: fingerprint(legacyRaw),
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

test('missing repeated-element hint is omitted instead of materialized as undefined', () => {
  const element = classifyRepeatedWithoutHint()
  assert.deepEqual(element.cardinality, { kind: 'repeated', index: 0 })
  assert.equal(Object.hasOwn(element.cardinality!, 'hint'), false)
})

test('live-shaped guarded recovery validates, atomically replaces, and preserves legacy bytes', async () => {
  const appName = 'rd-canonical-correction'
  const sourceRowId = await insertLiveShapedHistory(appName)
  const result = await new AppModelService().commitRecoveryAndProject(
    candidate(appName),
    recoveryRequest(appName, sourceRowId, 'rd-canonical-correction'),
    async () => {},
  )
  assert.equal(
    result.status,
    'commit_and_projection_succeeded',
    result.status === 'commit_failed'
      ? JSON.stringify({ message: result.error.message, diagnostic: result.error.diagnostic })
      : undefined,
  )
  if (result.status !== 'commit_and_projection_succeeded') return

  const rows = await getDb().selectFrom('app_models')
    .selectAll()
    .where('app_name', '=', appName)
    .orderBy('id')
    .execute()
  const source = rows.find(row => Number(row.id) === sourceRowId)!
  const replacement = rows.find(row => row.status === 'active')!
  assert.equal(rows.length, 6)
  assert.equal(source.status, 'superseded')
  assert.equal(source.model_json, legacyRaw)
  assert.equal(fingerprint(source.model_json), fingerprint(legacyRaw))
  assert.equal(replacement.version, '1.0.5')
  assert.equal(replacement.recovery_source_row_id, sourceRowId)
  assert.equal(replacement.recovery_source_fingerprint, fingerprint(legacyRaw))
  assert.equal(replacement.model_json.includes('"hint"'), false)
})

test('non-canonical candidate fails before the transaction with a complete safe cause', async () => {
  const appName = 'rd-canonical-diagnostic'
  const sourceRowId = await insertLiveShapedHistory(appName)
  const invalidCandidate = candidate(appName)
  ;(invalidCandidate.pages![0].elements as any[])[0] = undefined

  const before = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', appName).orderBy('id').execute()
  const result = await new AppModelService().commitRecoveryAndProject(
    invalidCandidate,
    recoveryRequest(appName, sourceRowId, 'rd-canonical-diagnostic'),
    async () => {},
  )
  assert.equal(result.status, 'commit_failed')
  if (result.status !== 'commit_failed') return
  assert.equal(result.error.diagnostic?.stage, 'candidate-materialization', JSON.stringify({ message: result.error.message, diagnostic: result.error.diagnostic }))
  assert.deepEqual(result.error.diagnostic?.causeChain.map(item => item.name), ['AppModelCanonicalCandidateError'])
  assert.deepEqual(result.error.diagnostic?.structuralIssues, [{
    path: '/pages/0/elements/0',
    category: 'undefined-array-entry',
    valueType: 'undefined',
  }])
  assert.equal(result.error.diagnostic?.causeChain[0].summary, 'Internal cause detail was withheld.')

  const after = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', appName).orderBy('id').execute()
  assert.deepEqual(after, before)
  assert.equal(after.find(row => Number(row.id) === sourceRowId)?.status, 'active')
})

test('SQLite replacement failure rolls back supersession and redacts nested driver detail', async () => {
  const appName = 'rd-sqlite-rollback'
  const operationId = 'rd-sqlite-redaction'
  const sourceRowId = await insertLiveShapedHistory(appName)
  await sql.raw(`
    CREATE TRIGGER rd_sqlite_redaction
    BEFORE INSERT ON app_models
    WHEN NEW.operation_id = '${operationId}'
    BEGIN
      SELECT RAISE(ABORT, 'credential-secret-marker raw-model-marker C:\\private\\forge.db');
    END
  `).execute(getDb())

  const result = await new AppModelService().commitRecoveryAndProject(
    candidate(appName),
    recoveryRequest(appName, sourceRowId, operationId),
    async () => {},
  )
  assert.equal(result.status, 'commit_failed')
  if (result.status !== 'commit_failed') return
  const error = result.error as AppModelPersistenceError
  assert.equal(error.diagnostic?.stage, 'transaction-replacement-insert', JSON.stringify({ message: error.message, diagnostic: error.diagnostic }))
  assert.match(error.diagnostic?.causeChain[0].code ?? '', /^SQLITE_CONSTRAINT/)
  const publicFailure = JSON.stringify({ message: error.message, diagnostic: error.diagnostic })
  assert.doesNotMatch(publicFailure, /credential-secret-marker|raw-model-marker|private|forge\.db/i)

  const rows = await getDb().selectFrom('app_models').selectAll()
    .where('app_name', '=', appName).orderBy('id').execute()
  assert.equal(rows.length, 5)
  const source = rows.find(row => Number(row.id) === sourceRowId)!
  assert.equal(source.status, 'active')
  assert.equal(source.model_json, legacyRaw)
  assert.equal(fingerprint(source.model_json), fingerprint(legacyRaw))
  assert.equal(rows.some(row => row.operation_id === operationId), false)
})

test('terminal classification preserves completed crawl/auth truth and avoids blind retry advice', () => {
  const failure = readEngineRecoveryFailure({
    kind: 'guarded-app-model-recovery-failed',
    sourceRowId: 5,
    sourceVersion: '1.0.4',
    sourceFingerprint: 'a'.repeat(64),
    detectedAt: '2026-08-05T12:00:00.000Z',
    capturedAt: '2026-08-05T12:01:00.000Z',
    observedSubjects: [{ id: 'inventory', kind: 'page', value: '/inventory.html' }],
    crawlDiagnostics: [],
    roleAuthOutcomes: [{ roleId: 'user', outcome: 'succeeded' }],
    phases: {
      crawlExecution: 'completed',
      authentication: 'succeeded',
      modelGeneration: 'validated',
      guardedPersistence: 'failed',
      compatibilityProjection: 'not_attempted',
    },
    persistenceDiagnostic: {
      stage: 'transaction-replacement-insert',
      causeChain: [{
        name: 'SqliteError',
        code: 'SQLITE_CONSTRAINT_TRIGGER',
        summary: 'credential-secret-marker raw-model-marker C:\\private\\forge.db',
      }],
      structuralIssues: [{
        path: '/pages/0/elements/0',
        category: 'undefined-array-entry',
        valueType: 'undefined',
      }, {
        path: '/pages/1',
        category: 'raw-model-marker',
        valueType: 'credential-secret-marker',
      }],
    },
  })
  assert.ok(failure)
  const classified = classifyTerminalState(
    [{
      id: 'inventory', url: '/inventory.html', urlPattern: '/inventory.html',
      module: 'Unknown', moduleConfidence: null, moduleReason: null,
      elements: 0, roles: [],
    }],
    [],
    true,
    'GuardedRecoveryExecutionError',
    failure,
  )
  assert.equal(classified.state, 'failed')
  assert.match(classified.reason, /Crawl execution completed, authentication was succeeded/)
  assert.match(classified.reason, /replacement model validated/)
  assert.doesNotMatch(classified.reason, /did not begin|could not use it to begin/i)
  assert.doesNotMatch(formatRecoveryPersistenceDiagnostic(failure), /credential-secret-marker|raw-model-marker|private|forge\.db/i)
  assert.deepEqual(failure.persistenceDiagnostic.structuralIssues, [{
    path: '/pages/0/elements/0',
    category: 'undefined-array-entry',
    valueType: 'undefined',
  }, {
    path: '/pages/1',
    category: 'schema-validation',
    valueType: 'schema-invalid',
  }])
  assert.equal(isModelCompatibilityError('AppModelPersistenceError'), false)
  assert.doesNotMatch(recoveryFailureRecommendation().action, /Retry with Force re-crawl/i)
})
