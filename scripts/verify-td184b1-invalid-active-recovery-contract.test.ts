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
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import type { InvalidActiveRecoveryRequest } from '../src/core/storage/AppModelRecoveryContract'
import { AppModelService } from '../src/core/storage/AppModelService'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { AppModelRepository } from '../src/core/storage/repositories/AppModelRepository'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td184b1-'))
const dbPath = path.join(root, 'forge.db')

function rawFingerprint(modelJson: string): string {
  return crypto.createHash('sha256').update(modelJson).digest('hex')
}

function request(
  appName: string,
  rowId: number,
  fingerprint: string,
): InvalidActiveRecoveryRequest {
  return {
    app_name: appName,
    operation_id: `recover-${appName}`,
    expected_row_id: rowId,
    expected_source_fingerprint: fingerprint,
    operator_acknowledgement: true,
  }
}

async function insertRawActive(
  appName: string,
  modelJson: string,
  version = '1.0.0',
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
    status: 'active',
    evidence_state: 'crawled',
    operation_id: null,
    candidate_hash: null,
  }).returning('id').executeTakeFirstOrThrow()
  return Number(inserted.id)
}

function candidate(appName: string): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-07-29T14:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: appName,
      baseUrl: `https://${appName}.example.com`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:td184b1',
        crawledAt: '2026-07-29T14:00:00.000Z',
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

test('TD184B1-1 inspects exactly one invalid active row as raw evidence', async () => {
  const appName = 'invalid-inspection'
  const raw = '{"broken":'
  const rowId = await insertRawActive(appName, raw)
  const result = await new AppModelService().inspectInvalidActiveForRecovery(
    request(appName, rowId, rawFingerprint(raw)),
  )

  assert.deepEqual(Object.keys(result).sort(), [
    'app_name',
    'raw_model_json_fingerprint',
    'row_id',
    'status',
    'validation_errors',
    'version',
  ])
  assert.deepEqual(
    {
      row_id: result.row_id,
      app_name: result.app_name,
      version: result.version,
      status: result.status,
      raw_model_json_fingerprint: result.raw_model_json_fingerprint,
    },
    {
      row_id: rowId,
      app_name: appName,
      version: '1.0.0',
      status: 'active',
      raw_model_json_fingerprint: rawFingerprint(raw),
    },
  )
  assert.equal(result.validation_errors.length > 0, true)
  assert.match(result.validation_errors[0], /JSON parse failed/)
})

test('TD184B1-2 refuses inspection when the active row is missing', async () => {
  await assert.rejects(
    new AppModelService().inspectInvalidActiveForRecovery(
      request('missing-active', 999, rawFingerprint('{}')),
    ),
    /Active App Model 'missing-active' does not exist/,
  )
})

test('TD184B1-3 refuses inspection when multiple active rows exist', async () => {
  const appName = 'multiple-active'
  await sql`DROP INDEX idx_models_one_active`.execute(getDb())
  try {
    const first = await insertRawActive(appName, '{"first":')
    const secondRaw = '{"second":'
    const second = await insertRawActive(appName, secondRaw, '1.0.1')
    await assert.rejects(
      new AppModelService().inspectInvalidActiveForRecovery(
        request(appName, second, rawFingerprint(secondRaw)),
      ),
      new RegExp(`multiple active rows \\(${second}, ${first}\\)`),
    )
    await getDb().updateTable('app_models')
      .set({ status: 'superseded' })
      .where('id', '=', first)
      .execute()
  } finally {
    await sql`
      CREATE UNIQUE INDEX idx_models_one_active
      ON app_models (app_name)
      WHERE status = 'active'
    `.execute(getDb())
  }
})

test('TD184B1-4 rejects a source fingerprint mismatch', async () => {
  const appName = 'fingerprint-mismatch'
  const raw = '{"broken":'
  const rowId = await insertRawActive(appName, raw)
  await assert.rejects(
    new AppModelService().inspectInvalidActiveForRecovery(
      request(appName, rowId, '0'.repeat(64)),
    ),
    /fingerprint mismatch/,
  )
})

test('TD184B1-5 invalid JSON never becomes a trusted AppModel', async () => {
  const appName = 'never-trusted'
  const raw = '{"still-broken":'
  const rowId = await insertRawActive(appName, raw)
  const inspection = await new AppModelService().inspectInvalidActiveForRecovery(
    request(appName, rowId, rawFingerprint(raw)),
  )

  assert.equal('model_json' in inspection, false)
  assert.equal('snapshot' in inspection, false)
  assert.equal('model' in inspection, false)
  await assert.rejects(
    new AppModelService().findActive(appName),
    /contains malformed model_json/,
  )
})

test('TD184B1-6 valid AppModel reads and persistence remain unchanged', async () => {
  const appName = 'valid-path'
  const repository = new AppModelRepository()
  const service = new AppModelService(repository)
  const committed = await repository.commitCandidate(
    candidate(appName),
    'crawl-valid-path',
  )
  const active = await service.requireActive(appName)
  assert.equal(active.app.name, appName)
  assert.equal(active.app.modelVersion, '1.0.0')
  assert.deepEqual(committed.committed.snapshot, active)

  const row = await getDb().selectFrom('app_models')
    .select(['id', 'model_json', 'candidate_hash'])
    .where('id', '=', committed.committed.rowId)
    .executeTakeFirstOrThrow()
  await assert.rejects(
    service.inspectInvalidActiveForRecovery(
      request(appName, Number(row.id), rawFingerprint(row.model_json)),
    ),
    /is a valid App Model and is not eligible/,
  )
  assert.equal(row.candidate_hash, committed.committed.candidateHash)
})

test('TD-UI-064A-R discovers invalid active recovery evidence without exposing payload', async () => {
  const appName = 'forced-recovery-discovery'
  const raw = '{"legacy":true}'
  const rowId = await insertRawActive(appName, raw, '1.0.4')
  const inspection = await new AppModelService().findInvalidActiveForRecovery(appName)

  assert.equal(inspection?.row_id, rowId)
  assert.equal(inspection?.version, '1.0.4')
  assert.equal(inspection?.raw_model_json_fingerprint, rawFingerprint(raw))
  assert.equal((inspection?.validation_errors.length ?? 0) > 0, true)
  assert.equal('model_json' in (inspection ?? {}), false)
})

test('TD-UI-064A-R discovery is null for no prior model and a valid current model', async () => {
  const service = new AppModelService()
  assert.equal(await service.findInvalidActiveForRecovery('no-prior-model'), null)

  const appName = 'valid-recovery-discovery'
  await new AppModelRepository().commitCandidate(candidate(appName), 'valid-recovery-discovery')
  assert.equal(await service.findInvalidActiveForRecovery(appName), null)
})
