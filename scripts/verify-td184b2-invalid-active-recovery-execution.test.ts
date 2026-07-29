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
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import type { InvalidActiveRecoveryRequest } from '../src/core/storage/AppModelRecoveryContract'
import {
  AppModelRecoveryOrchestrator,
  InvalidActiveRecoveryCandidateError,
} from '../src/core/storage/AppModelRecoveryOrchestrator'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  InvalidActiveRecoveryConflictError,
} from '../src/core/storage/repositories/AppModelRepository'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td184b2-'))
const dbPath = path.join(root, 'forge.db')

function rawFingerprint(modelJson: string): string {
  return crypto.createHash('sha256').update(modelJson).digest('hex')
}

function request(
  appName: string,
  rowId: number,
  fingerprint: string,
  operationId = `recover-${appName}`,
): InvalidActiveRecoveryRequest {
  return {
    app_name: appName,
    operation_id: operationId,
    expected_row_id: rowId,
    expected_source_fingerprint: fingerprint,
    operator_acknowledgement: true,
  }
}

async function insertRaw(
  appName: string,
  modelJson: string,
  version: string,
  status: 'active' | 'superseded' = 'active',
): Promise<number> {
  const inserted = await getDb().insertInto('app_models').values({
    app_name: appName,
    version,
    base_url: `https://${appName}.example.com`,
    app_type: 'web-ui',
    intake_mode: 'crawl',
    crawl_config_hash: '',
    page_count: 0,
    flow_count: 0,
    role_count: 0,
    model_json: modelJson,
    crawled_at: null,
    crawled_by: null,
    status,
    evidence_state: 'crawled',
    operation_id: null,
    candidate_hash: null,
    recovery_source_row_id: null,
    recovery_source_fingerprint: null,
  }).returning('id').executeTakeFirstOrThrow()
  return Number(inserted.id)
}

function candidate(appName: string): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-07-29T18:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: appName,
      baseUrl: `https://${appName}.example.com`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:td184b2',
        crawledAt: '2026-07-29T18:00:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 1,
        pagesBudget: 1,
        pagesDiscovered: 1,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [],
    pages: [],
    flows: [],
    endpoints: null,
    api: null,
    diff: null,
  }
}

before(async () => {
  initDb(dbPath)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})

test('TD184B2-1 successful recovery crawls fresh and persists durable provenance', async () => {
  const appName = 'recovery-success'
  const raw = '{"broken":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')
  let projectedVersion: string | null = null

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async options => {
      assert.deepEqual(options, { previousModel: null })
      return candidate(appName)
    },
    async snapshot => {
      projectedVersion = snapshot.app.modelVersion
    },
  )

  assert.equal(result.status, 'commit_and_projection_succeeded')
  if (result.status !== 'commit_and_projection_succeeded') return
  assert.equal(result.commit.outcome, 'committed_new')
  assert.equal(result.commit.committed.snapshot.app.modelVersion, '1.0.1')
  assert.equal(projectedVersion, '1.0.1')

  const rows = await getDb().selectFrom('app_models')
    .selectAll()
    .where('app_name', '=', appName)
    .orderBy('id')
    .execute()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, sourceId)
  assert.equal(rows[0].status, 'superseded')
  assert.equal(rows[0].model_json, raw)
  assert.equal(rows[1].status, 'active')
  assert.equal(rows[1].recovery_source_row_id, sourceId)
  assert.equal(rows[1].recovery_source_fingerprint, rawFingerprint(raw))
})

test('TD184B2-2 fingerprint change after inspection is an explicit conflict', async () => {
  const appName = 'recovery-fingerprint-conflict'
  const raw = '{"broken":'
  const changed = '{"changed":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async () => {
      await getDb().updateTable('app_models')
        .set({ model_json: changed })
        .where('id', '=', sourceId)
        .execute()
      return candidate(appName)
    },
    async () => undefined,
  )

  assert.equal(result.status, 'commit_failed')
  if (result.status !== 'commit_failed') return
  assert.ok(result.error instanceof InvalidActiveRecoveryConflictError)
  assert.match(result.error.message, /fingerprint changed/)
  const rows = await getDb().selectFrom('app_models')
    .select(['id', 'status', 'model_json'])
    .where('app_name', '=', appName)
    .execute()
  assert.deepEqual(rows, [{ id: sourceId, status: 'active', model_json: changed }])
})

test('TD184B2-3 active row change after inspection is an explicit conflict', async () => {
  const appName = 'recovery-row-conflict'
  const raw = '{"broken":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')
  let competingId = 0

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async () => {
      await getDb().updateTable('app_models')
        .set({ status: 'superseded' })
        .where('id', '=', sourceId)
        .execute()
      competingId = await insertRaw(appName, '{"competitor":', '1.0.1')
      return candidate(appName)
    },
    async () => undefined,
  )

  assert.equal(result.status, 'commit_failed')
  if (result.status !== 'commit_failed') return
  assert.ok(result.error instanceof InvalidActiveRecoveryConflictError)
  assert.match(result.error.message, /not active/)
  const active = await getDb().selectFrom('app_models')
    .select('id')
    .where('app_name', '=', appName)
    .where('status', '=', 'active')
    .execute()
  assert.deepEqual(active.map(row => Number(row.id)), [competingId])
})

test('TD184B2-4 canonical candidate validation failure performs no write', async () => {
  const appName = 'recovery-invalid-candidate'
  const raw = '{"broken":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')
  const invalid = {
    ...candidate(appName),
    schemaVersion: 'not-a-schema-version',
  } as AppModelCandidate

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async options => {
      assert.equal(options.previousModel, null)
      return invalid
    },
    async () => assert.fail('projection must not run'),
  )

  assert.equal(result.status, 'commit_failed')
  if (result.status !== 'commit_failed') return
  assert.ok(result.error instanceof InvalidActiveRecoveryCandidateError)
  const rows = await getDb().selectFrom('app_models')
    .select(['id', 'status'])
    .where('app_name', '=', appName)
    .execute()
  assert.deepEqual(rows, [{ id: sourceId, status: 'active' }])
})

test('TD184B2-5 recovery preserves full source and prior history', async () => {
  const appName = 'recovery-history'
  const priorRaw = '{"prior-invalid":'
  const sourceRaw = '{"source-invalid":'
  const priorId = await insertRaw(appName, priorRaw, '1.0.0', 'superseded')
  const sourceId = await insertRaw(appName, sourceRaw, '1.0.1')

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(sourceRaw)),
    async () => candidate(appName),
    async () => undefined,
  )
  assert.equal(result.status, 'commit_and_projection_succeeded')

  const rows = await getDb().selectFrom('app_models')
    .select(['id', 'version', 'status', 'model_json'])
    .where('app_name', '=', appName)
    .orderBy('id')
    .execute()
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.slice(0, 2), [
    { id: priorId, version: '1.0.0', status: 'superseded', model_json: priorRaw },
    { id: sourceId, version: '1.0.1', status: 'superseded', model_json: sourceRaw },
  ])
  assert.equal(rows[2].version, '1.0.2')
  assert.equal(rows[2].status, 'active')
})

test('TD184B2-6 version allocation uses exact-case app history', async () => {
  const appName = 'Recovery-Version-Case'
  await insertRaw(appName, '{"old-a":', '2.4.9', 'superseded')
  await insertRaw(appName, '{"old-b":', '3.0.1', 'superseded')
  await insertRaw(appName.toLowerCase(), '{"other-case":', '99.0.0', 'superseded')
  const raw = '{"active-invalid":'
  const sourceId = await insertRaw(appName, raw, '2.9.9')

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async () => candidate(appName),
    async () => undefined,
  )

  assert.equal(result.status, 'commit_and_projection_succeeded')
  if (result.status !== 'commit_and_projection_succeeded') return
  assert.equal(result.commit.committed.snapshot.app.modelVersion, '3.0.2')
})

test('TD184B2-7 durable replay skips inspection and fresh crawl', async () => {
  const appName = 'recovery-replay'
  const raw = '{"broken":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')
  const recoveryRequest = request(
    appName,
    sourceId,
    rawFingerprint(raw),
    'stable-recovery-operation',
  )
  const orchestrator = new AppModelRecoveryOrchestrator()
  let crawlCount = 0
  const first = await orchestrator.recover(
    recoveryRequest,
    async () => {
      crawlCount += 1
      return candidate(appName)
    },
    async () => undefined,
  )
  const second = await orchestrator.recover(
    recoveryRequest,
    async () => {
      crawlCount += 1
      assert.fail('durable replay must skip fresh crawl')
    },
    async () => undefined,
  )

  assert.equal(first.status, 'commit_and_projection_succeeded')
  assert.equal(second.status, 'commit_and_projection_succeeded')
  if (
    first.status !== 'commit_and_projection_succeeded'
    || second.status !== 'commit_and_projection_succeeded'
  ) return
  assert.equal(first.commit.outcome, 'committed_new')
  assert.equal(second.commit.outcome, 'replayed_existing')
  assert.equal(second.commit.committed.rowId, first.commit.committed.rowId)
  assert.equal(crawlCount, 1)
  const count = await getDb().selectFrom('app_models')
    .select(({ fn }) => fn.count<number>('id').as('count'))
    .where('app_name', '=', appName)
    .executeTakeFirstOrThrow()
  assert.equal(Number(count.count), 2)
})

test('TD184B2-8 projection failure occurs after committed storage', async () => {
  const appName = 'recovery-projection-failure'
  const raw = '{"broken":'
  const sourceId = await insertRaw(appName, raw, '1.0.0')

  const result = await new AppModelRecoveryOrchestrator().recover(
    request(appName, sourceId, rawFingerprint(raw)),
    async options => {
      assert.equal(options.previousModel, null)
      return candidate(appName)
    },
    async () => {
      throw new Error('projection unavailable')
    },
  )

  assert.equal(result.status, 'commit_succeeded_projection_failed')
  if (result.status !== 'commit_succeeded_projection_failed') return
  assert.match(result.error.message, /SQLite committed guarded recovery/)
  const rows = await getDb().selectFrom('app_models')
    .select(['id', 'status', 'recovery_source_row_id'])
    .where('app_name', '=', appName)
    .orderBy('id')
    .execute()
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map(row => row.status),
    ['superseded', 'active'],
  )
  assert.equal(rows[1].id, result.commit.committed.rowId)
  assert.equal(rows[1].recovery_source_row_id, sourceId)
})
