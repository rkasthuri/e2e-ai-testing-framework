/**
 * TD-181 - SQLite runtime authority and durable operation identity.
 *
 * Every database mutation in this file targets disposable SQLite databases.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import type { AppModel, AppModelCandidate } from '../src/core/onboarding/types'
import {
  AppModelOperationConflictError,
  AppModelPersistenceError,
  AppModelProjectionError,
  AppModelRepository,
  InvalidAppModelStateError,
} from '../src/core/storage/repositories/AppModelRepository'
import {
  AppModelProjectionAuthorityError,
  AppModelService,
} from '../src/core/storage/AppModelService'
import { canonicalJsonSha256 } from '../src/core/storage/JsonAppModelMigrationPlanner'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { Crawler } from '../src/core/onboarding/Crawler'
import { VerificationRunner } from '../src/core/onboarding/VerificationRunner'
import { CrawlRunner } from '../src/core/runner/CrawlRunner'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'td181-authority-'))
const dbPath = path.join(tempRoot, 'forge.db')

function candidate(appName: string, pageId = 'home'): AppModelCandidate {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-07-27T12:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name: appName,
      displayName: appName,
      baseUrl: `https://${appName}.example.com`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'sha256:td181',
        crawledAt: '2026-07-27T12:00:00.000Z',
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
    pages: [{
      id: pageId,
      displayName: pageId,
      urlPattern: `/${pageId}`,
      urlPatternType: 'exact',
      fingerprint: `fp-${pageId}`,
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

function snapshot(appName: string, version: string, pageId = 'home'): AppModel {
  const draft = candidate(appName, pageId)
  return {
    ...draft,
    app: { ...draft.app, modelVersion: version },
  }
}

before(async () => {
  initDb(dbPath)
  await runMigrations()
})

after(async () => {
  await closeDb()
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('T1 Migration 017 creates nullable identity columns and exact partial unique index', async () => {
  const columns = await sql<{ name: string; notnull: number }>`
    PRAGMA table_info(app_models)
  `.execute(getDb())
  const byName = new Map(columns.rows.map(row => [row.name, row]))
  assert.equal(byName.get('operation_id')?.notnull, 0)
  assert.equal(byName.get('candidate_hash')?.notnull, 0)

  const index = await sql<{ sql: string }>`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_models_operation_identity'
  `.execute(getDb())
  assert.equal(index.rows.length, 1)
  const normalized = index.rows[0].sql.replace(/\s+/g, ' ').trim()
  assert.match(normalized, /UNIQUE INDEX idx_models_operation_identity/i)
  assert.match(normalized, /ON app_models \(app_name, operation_id\)/i)
  assert.match(normalized, /WHERE operation_id IS NOT NULL$/i)
  assert.doesNotMatch(normalized, /COLLATE\s+NOCASE/i)
})

test('T2 committed result and projection come from the exact post-commit row re-read', async () => {
  const repo = new AppModelRepository()
  const service = new AppModelService(repo)
  const draft = candidate('reread-app')
  let projected: AppModel | null = null
  const result = await service.commitAndProject(
    draft,
    'crawl-reread-1',
    async model => { projected = model },
  )

  assert.equal(result.status, 'commit_and_projection_succeeded')
  if (result.status !== 'commit_and_projection_succeeded') return
  const committed = result.commit.committed
  assert.equal(result.commit.outcome, 'committed_new')
  assert.ok(committed.rowId > 0)
  assert.equal(committed.operationId, 'crawl-reread-1')
  assert.equal(committed.candidateHash, canonicalJsonSha256(draft))
  assert.equal(committed.snapshot.app.modelVersion, '1.0.0')
  assert.notEqual(projected, draft)
  assert.equal(projected, committed.snapshot)
  assert.deepEqual(committed, await repo.getCommittedById(committed.rowId))
})

test('T3 complete-operation retry replays one row; conflict fails; a new operation remains new', async () => {
  const repo = new AppModelRepository()
  const draft = candidate('retry-app')
  const first = await repo.commitCandidate(draft, 'crawl-retry-1')
  const replay = await repo.commitCandidate(candidate('retry-app'), 'crawl-retry-1')

  assert.equal(first.outcome, 'committed_new')
  assert.equal(replay.outcome, 'replayed_existing')
  assert.equal(replay.committed.rowId, first.committed.rowId)
  assert.equal((await repo.findHistory('retry-app')).length, 1)

  await assert.rejects(
    () => repo.commitCandidate(candidate('retry-app', 'different'), 'crawl-retry-1'),
    (error: unknown) => error instanceof AppModelOperationConflictError,
  )
  assert.equal((await repo.findHistory('retry-app')).length, 1)

  const next = await repo.commitCandidate(candidate('retry-app'), 'crawl-retry-2')
  assert.equal(next.outcome, 'committed_new')
  assert.notEqual(next.committed.rowId, first.committed.rowId)
  assert.equal(next.committed.snapshot.app.modelVersion, '1.0.1')
  assert.equal((await repo.findHistory('retry-app')).length, 2)
})

test('T4 structured outcomes distinguish commit failure and post-commit projection failure', async () => {
  let projected = false
  const failingRepository = {
    commitCandidate: async () => {
      throw new AppModelPersistenceError('forced SQLite failure')
    },
  } as unknown as AppModelRepository
  const failed = await new AppModelService(failingRepository).commitAndProject(
    candidate('sqlite-failure'),
    'crawl-sqlite-failure',
    async () => { projected = true },
  )
  assert.equal(failed.status, 'commit_failed')
  assert.equal(projected, false)
  if (failed.status === 'commit_failed') assert.match(failed.error.message, /forced SQLite failure/)

  const repo = new AppModelRepository()
  const service = new AppModelService(repo)
  const partial = await service.commitAndProject(
    candidate('projection-failure'),
    'crawl-projection-failure',
    async () => { throw new Error('disk unavailable') },
  )
  assert.equal(partial.status, 'commit_succeeded_projection_failed')
  if (partial.status !== 'commit_succeeded_projection_failed') return
  assert.equal(partial.commit.committed.rowId > 0, true)
  assert.match(partial.error.message, /SQLite remains authoritative/)
  assert.equal(
    (await repo.getModel('projection-failure'))?.app.modelVersion,
    partial.commit.committed.snapshot.app.modelVersion,
  )

  // Retrying the complete operation after the projection failure must replay
  // the durable commit, not create another logically identical observation.
  let retryProjected: AppModel | null = null
  const retried = await service.commitAndProject(
    candidate('projection-failure'),
    'crawl-projection-failure',
    async model => { retryProjected = model },
  )
  assert.equal(retried.status, 'commit_and_projection_succeeded')
  if (retried.status !== 'commit_and_projection_succeeded') return
  assert.equal(retried.commit.outcome, 'replayed_existing')
  assert.equal(retried.commit.committed.rowId, partial.commit.committed.rowId)
  assert.equal(retryProjected, retried.commit.committed.snapshot)
  assert.equal((await repo.findHistory('projection-failure')).length, 1)
})

test('T5 projection-only retry is idempotent and rejects missing, invalid, mismatched, or superseded rows', async () => {
  const repo = new AppModelRepository()
  const service = new AppModelService(repo)
  const first = await service.commitAndProject(
    candidate('projection-retry'),
    'crawl-projection-retry',
    async () => { throw new Error('initial projection failure') },
  )
  assert.equal(first.status, 'commit_succeeded_projection_failed')
  if (first.status !== 'commit_succeeded_projection_failed') return
  const rowId = first.commit.committed.rowId
  const beforeCount = (await repo.findHistory('projection-retry')).length
  const versions: string[] = []

  await service.projectCommittedSnapshot(
    rowId,
    'projection-retry',
    async model => { versions.push(model.app.modelVersion) },
  )
  await service.projectCommittedSnapshot(
    rowId,
    'projection-retry',
    async model => { versions.push(model.app.modelVersion) },
  )
  assert.deepEqual(versions, ['1.0.0', '1.0.0'])
  assert.equal((await repo.findHistory('projection-retry')).length, beforeCount)

  await assert.rejects(
    () => service.projectCommittedSnapshot(rowId, 'wrong-workspace-app', async () => {}),
    (error: unknown) => error instanceof AppModelProjectionAuthorityError,
  )
  await assert.rejects(
    () => service.projectCommittedSnapshot(999_999_999, 'projection-retry', async () => {}),
    /does not exist/,
  )

  const next = await repo.commitCandidate(
    candidate('projection-retry', 'new-observation'),
    'crawl-projection-retry-2',
  )
  assert.equal(next.committed.snapshot.app.modelVersion, '1.0.1')
  await assert.rejects(
    () => service.projectCommittedSnapshot(rowId, 'projection-retry', async () => {}),
    /not the exact active SQLite authority/,
  )

  const malformed = await repo.commitCandidate(candidate('malformed-reread'), 'crawl-malformed')
  await getDb().updateTable('app_models')
    .set({ model_json: '{"broken":' })
    .where('id', '=', malformed.committed.rowId)
    .execute()
  let malformedProjected = false
  await assert.rejects(
    () => service.projectCommittedSnapshot(
      malformed.committed.rowId,
      'malformed-reread',
      async () => { malformedProjected = true },
    ),
    /malformed model_json/,
  )
  assert.equal(malformedProjected, false)
})

test('T6 invalid SQLite history aborts before mutation and preserves the active row', async () => {
  const repo = new AppModelRepository()
  const original = await repo.upsert(snapshot('invalid-version-app', 'not-semver'))
  const beforeCount = (await repo.findHistory('invalid-version-app')).length

  await assert.rejects(
    () => repo.commitCandidate(
      candidate('invalid-version-app', 'replacement'),
      'crawl-invalid-history',
    ),
    (error: unknown) => error instanceof InvalidAppModelStateError,
  )

  const active = await repo.findActive('invalid-version-app')
  assert.equal(active?.id, original.id)
  assert.equal(active?.version, 'not-semver')
  assert.equal((await repo.findHistory('invalid-version-app')).length, beforeCount)
})

test('T6a full-history allocation uses the semantic maximum, not active or latest row', async () => {
  const repo = new AppModelRepository()
  const appName = 'full-history-version-app'
  await repo.upsert(snapshot(appName, '1.0.37', 'historical-maximum-one'))
  await repo.upsert(snapshot(appName, '1.0.37', 'historical-maximum-duplicate'))
  const lowerActive = await repo.upsert(snapshot(appName, '1.0.2', 'lower-active'))
  const before = (await repo.findHistory(appName))
    .map(row => ({ id: row.id, version: row.version, status: row.status }))
    .sort((left, right) => left.id - right.id)

  assert.equal(before.length, 3)
  assert.equal(before.filter(row => row.version === '1.0.37').length, 2)
  assert.deepEqual(
    before.find(row => row.id === lowerActive.id),
    { id: lowerActive.id, version: '1.0.2', status: 'active' },
  )

  const committed = await repo.commitCandidate(
    candidate(appName, 'fresh-observation'),
    'crawl-full-history-version',
  )
  const after = (await repo.findHistory(appName))
    .map(row => ({ id: row.id, version: row.version, status: row.status }))
    .sort((left, right) => left.id - right.id)

  assert.equal(committed.outcome, 'committed_new')
  assert.equal(committed.committed.snapshot.app.modelVersion, '1.0.38')
  assert.equal(after.length, before.length + 1)
  assert.equal(after.filter(row => row.status === 'active').length, 1)
  assert.deepEqual(
    after.find(row => row.id === committed.committed.rowId),
    { id: committed.committed.rowId, version: '1.0.38', status: 'active' },
  )
  assert.deepEqual(
    after.filter(row => row.id !== committed.committed.rowId),
    before.map(row => ({
      ...row,
      status: row.id === lowerActive.id ? 'superseded' : row.status,
    })),
  )
})

test('T6b malformed historical version reports row, app, and value without mutation', async () => {
  const repo = new AppModelRepository()
  const appName = 'malformed-history-context'
  const malformed = await repo.upsert(snapshot(appName, 'not-semver'))
  const before = await repo.findHistory(appName)

  await assert.rejects(
    () => repo.commitCandidate(
      candidate(appName, 'replacement'),
      'crawl-malformed-history-context',
    ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidAppModelStateError)
      assert.match(error.message, new RegExp(`SQLite row ${malformed.id}\\b`))
      assert.match(error.message, new RegExp(`'${appName}'`))
      assert.match(error.message, /'not-semver'/)
      return true
    },
  )

  const after = await repo.findHistory(appName)
  assert.deepEqual(after, before)
  assert.equal(after.length, 1)
  assert.equal(after[0].id, malformed.id)
  assert.equal(after[0].status, 'active')
})

test('T7 duplicate active rows fail explicitly without selecting or mutating either row', async () => {
  const repo = new AppModelRepository()
  const first = await repo.upsert(snapshot('duplicate-active', '1.0.0'))
  await sql`DROP INDEX idx_models_one_active`.execute(getDb())
  const duplicate = await getDb().insertInto('app_models').values({
    app_name: 'duplicate-active',
    version: '1.0.1',
    base_url: first.base_url,
    app_type: first.app_type,
    intake_mode: first.intake_mode,
    crawl_config_hash: first.crawl_config_hash,
    page_count: first.page_count,
    flow_count: first.flow_count,
    role_count: first.role_count,
    model_json: JSON.stringify(snapshot('duplicate-active', '1.0.1')),
    crawled_at: first.crawled_at,
    crawled_by: first.crawled_by,
    status: 'active',
    evidence_state: first.evidence_state,
    operation_id: null,
    candidate_hash: null,
  }).returningAll().executeTakeFirstOrThrow()

  await assert.rejects(
    () => repo.commitCandidate(
      candidate('duplicate-active', 'replacement'),
      'crawl-duplicate-active',
    ),
    (error: unknown) => error instanceof InvalidAppModelStateError,
  )
  const activeIds = (await getDb().selectFrom('app_models')
    .select('id')
    .where('app_name', '=', 'duplicate-active')
    .where('status', '=', 'active')
    .orderBy('id')
    .execute()).map(row => row.id)
  assert.deepEqual(activeIds, [first.id, duplicate.id])

  await getDb().deleteFrom('app_models').where('id', '=', duplicate.id).execute()
  await sql`CREATE UNIQUE INDEX idx_models_one_active
    ON app_models(app_name) WHERE status = 'active'`.execute(getDb())
})

test('T8 concurrent same-operation retries resolve one row and one version', async () => {
  const repo = new AppModelRepository()
  const [left, right] = await Promise.all([
    repo.commitCandidate(candidate('concurrent-retry'), 'crawl-concurrent-same'),
    repo.commitCandidate(candidate('concurrent-retry'), 'crawl-concurrent-same'),
  ])
  assert.deepEqual(new Set([left.outcome, right.outcome]), new Set([
    'committed_new',
    'replayed_existing',
  ]))
  assert.equal(left.committed.rowId, right.committed.rowId)
  assert.equal(left.committed.snapshot.app.modelVersion, '1.0.0')
  const history = await repo.findHistory('concurrent-retry')
  assert.equal(history.length, 1)
  assert.equal(history.filter(row => row.status === 'active').length, 1)
})

test('T9 concurrent same-app new operations serialize to unique monotonic versions and one active row', async () => {
  const repo = new AppModelRepository()
  const [left, right] = await Promise.all([
    repo.commitCandidate(candidate('concurrent-new', 'left'), 'crawl-concurrent-left'),
    repo.commitCandidate(candidate('concurrent-new', 'right'), 'crawl-concurrent-right'),
  ])
  assert.deepEqual(
    [left.committed.snapshot.app.modelVersion, right.committed.snapshot.app.modelVersion].sort(),
    ['1.0.0', '1.0.1'],
  )
  assert.notEqual(left.committed.rowId, right.committed.rowId)
  const history = await repo.findHistory('concurrent-new')
  assert.equal(history.length, 2)
  assert.equal(new Set(history.map(row => row.version)).size, 2)
  assert.equal(history.filter(row => row.status === 'active').length, 1)
})

test('T10 case-different app names remain independent under concurrent allocation', async () => {
  const repo = new AppModelRepository()
  const [lower, upper] = await Promise.all([
    repo.commitCandidate(candidate('case-app'), 'crawl-case'),
    repo.commitCandidate(candidate('Case-App'), 'crawl-case'),
  ])
  assert.equal(lower.committed.snapshot.app.modelVersion, '1.0.0')
  assert.equal(upper.committed.snapshot.app.modelVersion, '1.0.0')
  assert.equal((await repo.getModel('case-app'))?.app.name, 'case-app')
  assert.equal((await repo.getModel('Case-App'))?.app.name, 'Case-App')
})

test('T11 Crawler derives diff from injected SQLite state and emits no version', () => {
  const previous = snapshot('crawler-app', '3.4.5', 'old')
  const crawler = new Crawler({
    app: { name: 'crawler-app', baseUrl: 'https://crawler-app.example.com', appType: 'web-ui' },
    roles: [],
  }, { previousModel: previous }) as any
  const draft = crawler.buildModel(
    [{ ...previous.pages![0], id: 'new' }],
    [],
    [],
    Date.now(),
    [],
  ) as AppModelCandidate
  assert.equal('modelVersion' in draft.app, false)
  assert.equal(draft.diff?.previousModelVersion, '3.4.5')
  assert.deepEqual(draft.diff?.pagesAdded, ['new'])
  assert.deepEqual(draft.diff?.pagesRemoved, ['old'])
})

test('T12 real healback persistence failure preserves active SQLite state and suppresses projection', async () => {
  const repo = new AppModelRepository()
  const source = {
    ...snapshot('healback-failure', 'not-semver'),
    pages: [{
      ...candidate('healback-failure').pages![0],
      elements: [{
        id: 'home:submit',
        name: 'submit',
        kind: 'button',
        label: 'Submit',
        critical: true,
        aiNamed: false,
        strategies: [
          { type: 'css', value: '.old', confidence: 0.5 },
          { type: 'data-test', value: 'submit', confidence: 1 },
        ],
        tier3Assertions: [],
      }],
    }],
  } as AppModel
  const original = await repo.upsert(source)
  const beforeHistory = await repo.findHistory('healback-failure')
  let projected = false
  const workspace = {
    saveModelProjection: async () => { projected = true },
  } as any
  const verifier = new VerificationRunner(
    'healback-failure',
    undefined,
    workspace,
    new AppModelService(repo),
    'verify-healback-failure',
  ) as any

  await assert.rejects(
    () => verifier.writeModelHealbacks(source, [{
      elementId: 'home:submit',
      name: 'submit',
      pageId: 'home',
      status: 'healed',
      strategyUsed: { type: 'data-test', value: 'submit', confidence: 1 },
      durationMs: 1,
      error: null,
      screenshotPath: null,
      nearestMatch: null,
      verificationTier: 'dom-presence',
    }]),
    (error: unknown) => error instanceof InvalidAppModelStateError,
  )

  const active = await repo.findActive('healback-failure')
  assert.equal(active?.id, original.id)
  assert.equal(active?.status, 'active')
  assert.equal(projected, false)
  assert.deepEqual(
    (await repo.findHistory('healback-failure')).map(row => [row.id, row.status, row.version]),
    beforeHistory.map(row => [row.id, row.status, row.version]),
  )
})


test('T13 complete CrawlRunner retry skips timestamp regeneration and replays the exact SQLite row', async () => {
  await closeDb()
  const appName = 'td181-orchestrator-retry'
  const operationId = 'crawl-orchestrator-retry'
  const workspace = createWorkspace(path.join(tempRoot, 'orchestrator-retry'))
  await workspace.saveConfig({
    schemaVersion: 1,
    appName,
    url: `https://${appName}.example.com`,
    appType: 'web-ui',
    crawlStrategy: 'spa',
    authType: 'none',
    budgets: { maxDepth: 1, maxPages: 1, aiCalls: 1 },
  })
  await openProjectDatabase(workspace)

  const repository = new AppModelRepository()
  const service = new AppModelService(repository)
  let generatedTime = '2026-07-27T12:00:00.000Z'
  let crawlerInvocations = 0
  let projectionAttempts = 0
  const createCrawler = () => ({
    crawl: async (): Promise<AppModelCandidate> => {
      crawlerInvocations += 1
      const draft = candidate(appName, `observation-${crawlerInvocations}`)
      return {
        ...draft,
        generatedAt: generatedTime,
        app: {
          ...draft.app,
          crawlMetadata: {
            ...draft.app.crawlMetadata!,
            crawledAt: generatedTime,
            pagesDiscovered: 0,
          },
        },
        pages: [],
        diff: {
          previousModelVersion: 'none',
          diffGeneratedAt: generatedTime,
          pagesAdded: [],
          pagesRemoved: [],
          pagesModified: null,
          elementsAdded: null,
          elementsRemoved: null,
          strategiesInvalidated: null,
          flowsAdded: null,
          flowsRemoved: null,
        },
      }
    },
  })
  const runner = new CrawlRunner({ appModels: service, createCrawler })
  const failingProjectionWorkspace = new Proxy(workspace, {
    get(target, property, receiver) {
      if (property === 'saveModelProjection') {
        return async () => {
          projectionAttempts += 1
          throw new Error('forced compatibility projection failure')
        }
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  await assert.rejects(
    () => runner.run({
      url: `https://${appName}.example.com`,
      appName,
      workspace: failingProjectionWorkspace,
      operationId,
    }),
    (error: unknown) => error instanceof AppModelProjectionError,
  )
  assert.equal(crawlerInvocations, 1)
  assert.equal(projectionAttempts, 1)
  const firstHistory = await repository.findHistory(appName)
  assert.equal(firstHistory.length, 1)
  const first = await repository.getCommittedById(Number(firstHistory[0].id))
  assert.equal(first.snapshot.generatedAt, generatedTime)

  generatedTime = '2026-07-27T12:05:00.000Z'
  const replay = await runner.run({
    url: `https://${appName}.example.com`,
    appName,
    workspace,
    operationId,
  })
  assert.equal(crawlerInvocations, 1, 'complete retry must not invoke crawler/build')
  assert.equal(replay.appModelCommit?.outcome, 'replayed_existing')
  assert.equal(replay.appModelCommit?.rowId, first.rowId)
  assert.equal(replay.appModelCommit?.version, first.snapshot.app.modelVersion)
  assert.equal((await repository.findHistory(appName)).length, 1)
  const projected = JSON.parse(fs.readFileSync(
    path.join(workspace.root, 'models', appName, 'app-model.json'),
    'utf8',
  )) as AppModel
  assert.deepEqual(projected, first.snapshot)
  assert.equal(projected.generatedAt, '2026-07-27T12:00:00.000Z')

  await assert.rejects(
    () => repository.commitCandidate(
      { ...candidate(appName, 'conflicting-direct-write'), generatedAt: generatedTime },
      operationId,
    ),
    (error: unknown) => error instanceof AppModelOperationConflictError,
  )
  assert.equal((await repository.findHistory(appName)).length, 1)

  const next = await runner.run({
    url: `https://${appName}.example.com`,
    appName,
    workspace,
    operationId: 'crawl-orchestrator-new-observation',
  })
  assert.equal(crawlerInvocations, 2)
  assert.equal(next.appModelCommit?.outcome, 'committed_new')
  assert.notEqual(next.appModelCommit?.rowId, first.rowId)
  assert.equal(next.appModelCommit?.version, '1.0.1')
  const finalHistory = await repository.findHistory(appName)
  assert.equal(finalHistory.length, 2)
  assert.equal(finalHistory.filter(row => row.status === 'active').length, 1)
  await closeDb()
})

test('T14 runtime source has no App Model JSON authority reader or fallback', () => {
  const roots = [
    path.join(process.cwd(), 'src', 'core'),
    path.join(process.cwd(), 'forge-ui', 'server'),
  ]
  const allowed = new Set([
    path.normalize('src/core/onboarding/ModelMigrator.ts'),
    path.normalize('src/core/storage/JsonAppModelMigrationPlanner.ts'),
  ])
  const violations: string[] = []

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      const relative = path.normalize(path.relative(process.cwd(), full))
      if (allowed.has(relative)) continue
      const source = fs.readFileSync(full, 'utf-8')
      if (
        /\bloadAppModel\s*\(/.test(source) ||
        /\bloadModel\s*\(/.test(source) ||
        /readFileSync\([^)]*app-model\.json/.test(source) ||
        /JSON\.parse\([^)]*app-model\.json/.test(source)
      ) {
        violations.push(relative)
      }
    }
  }
  roots.forEach(walk)
  assert.deepEqual(violations, [])

  const crawl = fs.readFileSync(
    path.join(process.cwd(), 'src/core/runner/CrawlRunner.ts'),
    'utf-8',
  )
  assert.ok(crawl.indexOf('replayCommittedOperation(') < crawl.indexOf('this.createCrawler('))
  assert.ok(crawl.indexOf('commitAndProject(') < crawl.lastIndexOf('saveModelProjection('))
  assert.doesNotMatch(crawl, /non-fatal.*DB persist/i)
  assert.match(crawl, /operationId/)

  const generate = fs.readFileSync(
    path.join(process.cwd(), 'src/core/onboarding/GeneratorRunner.ts'),
    'utf-8',
  )
  const verify = fs.readFileSync(
    path.join(process.cwd(), 'src/core/onboarding/VerificationRunner.ts'),
    'utf-8',
  )
  const uiRoute = fs.readFileSync(
    path.join(process.cwd(), 'forge-ui/server/routes/crawl.ts'),
    'utf-8',
  )
  assert.match(generate, /appModels\.requireActive/)
  assert.match(verify, /appModels\.requireActive/)
  assert.match(uiRoute, /executionContext\.readAppModel/)
  assert.doesNotMatch(uiRoute, /app-model\.json/)
})

test('T15 two-workspace ExecutionContext reads only the currently scoped SQLite authority', async () => {
  await closeDb()
  const projectsRoot = path.join(tempRoot, 'ui-projects')
  const { WorkspaceResolver } = await import('../forge-ui/server/context/WorkspaceResolver')
  const { ExecutionContext } = await import('../forge-ui/server/context/ExecutionContext')
  const resolver = new WorkspaceResolver(projectsRoot)
  const appA = 'td181-workspace-a'
  const appB = 'td181-workspace-b'
  const appWithoutAuthority = 'td181-workspace-no-authority'

  const seed = async (appName: string, pageId: string): Promise<{ rowId: number; workspace: any }> => {
    const workspace = resolver.provision(appName) as any
    await openProjectDatabase(workspace)
    const committed = await new AppModelRepository().commitCandidate(
      candidate(appName, pageId),
      `seed-${appName}`,
    )
    await workspace.saveModelProjection(appName, committed.committed.snapshot)
    await closeDb()
    return { rowId: committed.committed.rowId, workspace }
  }

  const seededA = await seed(appA, 'page-a')
  const seededB = await seed(appB, 'page-b')
  assert.ok(seededA.rowId > 0 && seededB.rowId > 0)
  const noAuthorityWorkspace = resolver.provision(appWithoutAuthority) as any
  await openProjectDatabase(noAuthorityWorkspace)
  await noAuthorityWorkspace.saveModelProjection(
    appWithoutAuthority,
    snapshot(appWithoutAuthority, '1.0.0', 'json-only'),
  )
  await closeDb()

  const context = new ExecutionContext(resolver)
  const modelA = await context.readAppModel(appA) as AppModel
  const modelB = await context.readAppModel(appB) as AppModel
  const modelAAgain = await context.readAppModel(appA) as AppModel
  assert.equal(modelA.pages?.[0]?.id, 'page-a')
  assert.equal(modelB.pages?.[0]?.id, 'page-b')
  assert.equal(modelAAgain.pages?.[0]?.id, 'page-a')

  // A JSON projection deliberately exists without any SQLite App Model row.
  // Missing authority must fail rather than falling back to JSON, A, or B.
  await context.readAppModel(appA)
  await assert.rejects(
    () => context.readAppModel(appWithoutAuthority),
    /No crawled model for 'td181-workspace-no-authority'/,
  )
  await closeDb()
})
