/**
 * FORGE ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Autonomous Quality Engineering
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
import { Kysely, sql } from 'kysely'
import type { AppModelCandidate } from '../src/core/onboarding/types'
import {
  AppModelRecoveryOrchestrator,
  InvalidActiveRecoveryCrawler,
} from '../src/core/storage/AppModelRecoveryOrchestrator'
import type { InvalidActiveRecoveryRequest } from '../src/core/storage/AppModelRecoveryContract'
import type {
  AppModelCommitProjectionResult,
} from '../src/core/storage/AppModelService'
import { AppModelService } from '../src/core/storage/AppModelService'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import {
  AppModelOperationConflictError,
} from '../src/core/storage/repositories/AppModelRepository'

interface ForgeMigration {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

const repoRoot = path.resolve(__dirname, '..')
const liveDbPath = path.join(repoRoot, '.forge', 'forge.db')
const liveWalPath = `${liveDbPath}-wal`
const liveShmPath = `${liveDbPath}-shm`
const sauceJsonPath = path.join(repoRoot, 'models', 'saucedemo', 'app-model.json')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td184b3-'))
const disposableDbPath = path.join(tempRoot, 'saucedemo-rehearsal.db')
const migrationsDir = path.join(repoRoot, 'src', 'core', 'storage', 'migrations')

let liveDbHashBefore = ''
let sauceJsonHashBefore = ''
let startingHistory: string[] = []
let appliedMigrations: string[] = []
let finalHistory: string[] = []
let startingColumns: string[] = []
let finalColumns: string[] = []
let finalIndexes: string[] = []
let originalSauceRows: Array<Record<string, unknown>> = []
let finalSauceRows: Array<Record<string, unknown>> = []
let sourceRowId = 0
let sourceRaw = ''
let sourceFingerprint = ''
let freshCrawlPreviousModels: unknown[] = []
let recoveryResults: AppModelCommitProjectionResult[] = []
let replayResult: AppModelCommitProjectionResult | null = null
let committedRowAfterProjectionFailure: Record<string, unknown> | undefined
let replayProjectedRowId = 0

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function fingerprint(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function loadMigrations(): Record<string, ForgeMigration> {
  return Object.fromEntries(
    fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.ts'))
      .sort()
      .map(file => [file.replace(/\.ts$/, ''), require(path.join(migrationsDir, file))]),
  )
}

async function migrationHistory(db: Kysely<any>): Promise<string[]> {
  return (await db.selectFrom('kysely_migration')
    .select('name')
    .orderBy('name')
    .execute() as Array<{ name: string }>).map(row => row.name)
}

function freshSauceCandidate(generatedAt: string): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt,
    generatedBy: 'engine',
    app: {
      name: 'saucedemo',
      displayName: 'SauceDemo',
      baseUrl: 'https://www.saucedemo.com',
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:td184b3-disposable-fresh-crawl',
        crawledAt: generatedAt,
        crawledBy: 'engine',
        crawlDurationMs: 1,
        pagesBudget: 1,
        pagesDiscovered: 0,
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
  assert.equal(fs.existsSync(liveWalPath), false, 'live WAL must be absent before snapshot')
  assert.equal(fs.existsSync(liveShmPath), false, 'live SHM must be absent before snapshot')
  liveDbHashBefore = hashFile(liveDbPath)
  sauceJsonHashBefore = hashFile(sauceJsonPath)
  fs.copyFileSync(liveDbPath, disposableDbPath)
  assert.equal(hashFile(disposableDbPath), liveDbHashBefore)

  initDb(disposableDbPath)
  const db = getDb() as unknown as Kysely<any>
  startingHistory = await migrationHistory(db)
  startingColumns = (
    await sql<{ name: string }>`PRAGMA table_info(app_models)`.execute(db)
  ).rows.map(row => row.name)
  originalSauceRows = await db.selectFrom('app_models')
    .selectAll()
    .where('app_name', '=', 'saucedemo')
    .orderBy('id')
    .execute() as Array<Record<string, unknown>>

  assert.equal(startingHistory.at(-1), '015_app_models_crawled_by_nullable')
  assert.equal(startingHistory.includes('016_app_models_single_active'), false)
  assert.equal(startingHistory.includes('017_app_models_operation_identity'), false)
  assert.equal(startingHistory.includes('018_app_models_recovery_provenance'), false)
  assert.equal(startingColumns.includes('operation_id'), false)
  assert.equal(startingColumns.includes('candidate_hash'), false)
  assert.equal(startingColumns.includes('recovery_source_row_id'), false)
  assert.equal(startingColumns.includes('recovery_source_fingerprint'), false)

  appliedMigrations = await runSqliteMigrationCoordinator(db, loadMigrations())
  finalHistory = await migrationHistory(db)
  finalColumns = (
    await sql<{ name: string }>`PRAGMA table_info(app_models)`.execute(db)
  ).rows.map(row => row.name)
  finalIndexes = (
    await sql<{ name: string }>`PRAGMA index_list(app_models)`.execute(db)
  ).rows.map(row => row.name)

  const activeRows = await db.selectFrom('app_models')
    .select(['id', 'app_name', 'version', 'status', 'model_json'])
    .where('app_name', '=', 'saucedemo')
    .where('status', '=', 'active')
    .execute()
  assert.equal(activeRows.length, 1)
  sourceRowId = Number(activeRows[0].id)
  sourceRaw = activeRows[0].model_json
  sourceFingerprint = fingerprint(sourceRaw)
  const recoveryRequest: InvalidActiveRecoveryRequest = {
    app_name: 'saucedemo',
    operation_id: 'td184b3-saucedemo-guarded-recovery',
    expected_row_id: sourceRowId,
    expected_source_fingerprint: sourceFingerprint,
    operator_acknowledgement: true,
  }

  const service = new AppModelService()
  const inspection = await service.inspectInvalidActiveForRecovery(recoveryRequest)
  assert.equal(inspection.row_id, sourceRowId)
  assert.equal(inspection.raw_model_json_fingerprint, sourceFingerprint)
  assert.equal(inspection.validation_errors.length > 0, true)
  assert.equal('model_json' in inspection, false)
  assert.equal('snapshot' in inspection, false)
  await assert.rejects(
    service.findActive('saucedemo'),
    /schema-invalid model_json|identity does not match model_json/,
  )

  let crawlersAtBarrier = 0
  let releaseCrawlers!: () => void
  const bothCrawlersReady = new Promise<void>(resolve => {
    releaseCrawlers = resolve
  })
  const crawler = (candidate: AppModelCandidate): InvalidActiveRecoveryCrawler =>
    async options => {
      freshCrawlPreviousModels.push(options.previousModel)
      crawlersAtBarrier += 1
      if (crawlersAtBarrier === 2) releaseCrawlers()
      await bothCrawlersReady
      return candidate
    }
  const orchestrator = new AppModelRecoveryOrchestrator(service)
  recoveryResults = await Promise.all([
    orchestrator.recover(
      recoveryRequest,
      crawler(freshSauceCandidate('2026-07-29T20:00:00.000Z')),
      async () => {
        throw new Error('forced disposable projection failure')
      },
    ),
    orchestrator.recover(
      recoveryRequest,
      crawler(freshSauceCandidate('2026-07-29T20:00:01.000Z')),
      async () => {
        throw new Error('forced disposable projection failure')
      },
    ),
  ])

  const committed = recoveryResults.find(
    result => result.status === 'commit_succeeded_projection_failed',
  )
  assert.ok(
    committed,
    recoveryResults.map(result =>
      result.status === 'commit_failed'
        ? `${result.status}: ${result.error.name}: ${result.error.message}`
        : result.status,
    ).join(' | '),
  )
  if (committed.status !== 'commit_succeeded_projection_failed') {
    throw new Error('expected one committed recovery with projection failure')
  }
  committedRowAfterProjectionFailure = await db.selectFrom('app_models')
    .selectAll()
    .where('id', '=', committed.commit.committed.rowId)
    .executeTakeFirst()

  replayResult = await orchestrator.recover(
    recoveryRequest,
    async () => {
      assert.fail('durable replay must not invoke a fresh crawl')
    },
    async snapshot => {
      replayProjectedRowId = Number(
        (await db.selectFrom('app_models')
          .select('id')
          .where('app_name', '=', snapshot.app.name)
          .where('version', '=', snapshot.app.modelVersion)
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow()).id,
      )
    },
  )

  finalSauceRows = await db.selectFrom('app_models')
    .selectAll()
    .where('app_name', '=', 'saucedemo')
    .orderBy('id')
    .execute() as Array<Record<string, unknown>>
})

after(async () => {
  await closeDb()
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('TD184B3-1 disposable snapshot migrates 015 -> 016 -> 017 -> 018 and executes guarded recovery', () => {
  assert.equal(startingHistory.length, 15)
  assert.deepEqual(appliedMigrations, [
    '016_app_models_single_active',
    '017_app_models_operation_identity',
    '018_app_models_recovery_provenance',
  ])
  assert.deepEqual(finalHistory.slice(-4), [
    '015_app_models_crawled_by_nullable',
    '016_app_models_single_active',
    '017_app_models_operation_identity',
    '018_app_models_recovery_provenance',
  ])
  assert.equal(finalIndexes.includes('idx_models_one_active'), true)
  assert.equal(finalIndexes.includes('idx_models_operation_identity'), true)
  assert.equal(finalColumns.includes('operation_id'), true)
  assert.equal(finalColumns.includes('candidate_hash'), true)
  assert.equal(finalColumns.includes('recovery_source_row_id'), true)
  assert.equal(finalColumns.includes('recovery_source_fingerprint'), true)
  assert.deepEqual(freshCrawlPreviousModels, [null, null])

  const source = finalSauceRows.find(row => Number(row.id) === sourceRowId)
  const replacement = finalSauceRows.find(row => row.status === 'active')
  assert.equal(source?.status, 'superseded')
  assert.equal(source?.model_json, sourceRaw)
  assert.ok(replacement)
  assert.equal(replacement.recovery_source_row_id, sourceRowId)
  assert.equal(replacement.recovery_source_fingerprint, sourceFingerprint)
})

test('TD184B3-2 all SauceDemo history and duplicate historical versions are preserved', () => {
  assert.equal(finalSauceRows.length, originalSauceRows.length + 1)
  for (const original of originalSauceRows) {
    const preserved = finalSauceRows.find(row => row.id === original.id)
    assert.ok(preserved, `missing original SauceDemo row ${original.id}`)
    for (const [key, value] of Object.entries(original)) {
      const expected = original.id === sourceRowId && key === 'status'
        ? 'superseded'
        : value
      assert.deepEqual(preserved[key], expected, `row ${original.id} field ${key} changed`)
    }
  }

  const originalVersions = originalSauceRows.map(row => String(row.version))
  for (const duplicate of ['1.0.29', '1.0.32', '1.0.33']) {
    const beforeCount = originalVersions.filter(version => version === duplicate).length
    const preservedCount = finalSauceRows
      .filter(row => Number(row.id) !== Number(finalSauceRows.at(-1)?.id))
      .filter(row => row.version === duplicate)
      .length
    assert.equal(preservedCount, beforeCount)
    assert.equal(beforeCount > 1, true)
  }
})

test('TD184B3-3 exact-case semantic history allocates SauceDemo version 1.0.38', () => {
  const replacement = finalSauceRows.find(row => row.status === 'active')
  assert.equal(replacement?.version, '1.0.38')
  assert.equal(
    recoveryResults.some(result =>
      result.status === 'commit_succeeded_projection_failed'
      && result.commit.committed.snapshot.app.modelVersion === '1.0.38'),
    true,
  )
})

test('TD184B3-4 durable replay returns the exact committed SQLite row', () => {
  assert.equal(replayResult?.status, 'commit_and_projection_succeeded')
  if (replayResult?.status !== 'commit_and_projection_succeeded') return
  assert.equal(replayResult.commit.outcome, 'replayed_existing')
  assert.equal(replayResult.commit.committed.rowId, committedRowAfterProjectionFailure?.id)
  assert.equal(replayProjectedRowId, replayResult.commit.committed.rowId)
  assert.equal(replayResult.commit.committed.recoverySourceRowId, sourceRowId)
  assert.equal(
    replayResult.commit.committed.recoverySourceFingerprint,
    sourceFingerprint,
  )
})

test('TD184B3-5 same operation with a different candidate conflicts without a second replacement', () => {
  const conflicts = recoveryResults.filter(result => result.status === 'commit_failed')
  assert.equal(conflicts.length, 1)
  if (conflicts[0].status !== 'commit_failed') return
  assert.ok(conflicts[0].error instanceof AppModelOperationConflictError)
  assert.equal(
    finalSauceRows.filter(row => row.recovery_source_row_id === sourceRowId).length,
    1,
  )
})

test('TD184B3-6 projection failure leaves the guarded SQLite commit durable', () => {
  const failedProjection = recoveryResults.find(
    result => result.status === 'commit_succeeded_projection_failed',
  )
  assert.ok(failedProjection)
  assert.ok(committedRowAfterProjectionFailure)
  assert.equal(committedRowAfterProjectionFailure.status, 'active')
  assert.equal(committedRowAfterProjectionFailure.version, '1.0.38')
  assert.equal(
    committedRowAfterProjectionFailure.recovery_source_row_id,
    sourceRowId,
  )
})

test('TD184B3-7 live SQLite and SauceDemo JSON remain byte-for-byte unchanged', () => {
  assert.equal(hashFile(liveDbPath), liveDbHashBefore)
  assert.equal(hashFile(sauceJsonPath), sauceJsonHashBefore)
  assert.equal(fs.existsSync(liveWalPath), false)
  assert.equal(fs.existsSync(liveShmPath), false)
})
