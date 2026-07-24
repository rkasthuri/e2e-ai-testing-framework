import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sql } from 'kysely'
import { initDb, getDb, closeDb, getOpenSqlitePath, resolveSqlitePath } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  AppModelPersistenceError,
  AppModelRepository,
  InvalidAppModelStateError,
} from '../src/core/storage/repositories/AppModelRepository'
import type { AppModel } from '../src/core/onboarding/types'
import type { NewAppModel } from '../src/core/storage/types'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sqlite-foundation-'))

after(async () => {
  await closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

function snapshot(name: string, version = '1.0.0'): AppModel {
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-07-24T12:00:00.000Z',
    generatedBy: 'engine',
    app: {
      name,
      displayName: name,
      baseUrl: `https://${name.toLowerCase()}.example.test`,
      appType: 'web-ui',
      modelVersion: version,
      spaConfig: null,
      evidenceState: 'crawled-empty',
      crawlMetadata: {
        crawlConfigHash: `hash-${version}`,
        crawledAt: '2026-07-24T12:00:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 10,
        pagesBudget: 5,
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

function rawRow(model: AppModel): NewAppModel {
  return {
    app_name: model.app.name,
    version: model.app.modelVersion,
    base_url: model.app.baseUrl,
    app_type: model.app.appType,
    intake_mode: 'crawl',
    crawl_config_hash: model.app.crawlMetadata?.crawlConfigHash ?? '',
    page_count: model.pages?.length ?? 0,
    flow_count: model.flows?.length ?? 0,
    role_count: model.roles.length,
    model_json: JSON.stringify(model),
    crawled_at: model.app.crawlMetadata?.crawledAt ?? null,
    crawled_by: model.app.crawlMetadata?.crawledBy ?? null,
    status: 'active',
    evidence_state: model.app.evidenceState,
  }
}

class Through015Provider {
  async getMigrations(): Promise<Record<string, any>> {
    const dir = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
    const result: Record<string, any> = {}
    for (const file of fs.readdirSync(dir).filter(file => /^0(0[1-9]|1[0-5])_.*\.ts$/.test(file)).sort()) {
      result[file.replace(/\.ts$/, '')] = require(path.join(dir, file))
    }
    return result
  }
}

async function create015Database(dbPath: string): Promise<void> {
  initDb(dbPath)
  const { Migrator } = require('kysely/migration')
  const migrator = new Migrator({ db: getDb(), provider: new Through015Provider() })
  const result = await migrator.migrateToLatest()
  if (result.error) throw result.error
  await closeDb()
}

function logicalState(dbPath: string): unknown {
  const BetterSqlite3 = require('better-sqlite3')
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    return {
      quickCheck: db.pragma('quick_check', { simple: true }),
      table: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_models'").get(),
      indexes: db.prepare('PRAGMA index_list(app_models)').all(),
      rows: db.prepare('SELECT * FROM app_models ORDER BY id').all(),
      migrations: db.prepare('SELECT name FROM kysely_migration ORDER BY name').all(),
    }
  } finally {
    db.close()
  }
}

test('normal resolution uses .forge/forge.db and never the root fallback', () => {
  const clean = path.join(ROOT, 'path-default')
  fs.mkdirSync(clean)
  const prior = process.env.DB_PATH
  try {
    delete process.env.DB_PATH
    const resolved = resolveSqlitePath(undefined, clean)
    assert.equal(resolved, path.join(clean, '.forge', 'forge.db'))
    assert.notEqual(resolved, path.join(clean, 'forge-framework.db'))
  } finally {
    if (prior === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = prior
  }
})

test('explicit DB_PATH remains authoritative', () => {
  const prior = process.env.DB_PATH
  const explicit = path.join(ROOT, 'explicit', 'test.db')
  try {
    process.env.DB_PATH = explicit
    assert.equal(resolveSqlitePath(undefined, ROOT), path.resolve(explicit))
  } finally {
    if (prior === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = prior
  }
})

test('migration 016 creates and verifies a backup before adding the constraint', async () => {
  const dir = path.join(ROOT, 'upgrade')
  fs.mkdirSync(dir)
  const dbPath = path.join(dir, 'forge.db')
  await create015Database(dbPath)

  initDb(dbPath)
  await getDb().insertInto('app_models').values(rawRow(snapshot('upgrade-app'))).execute()
  await closeDb()

  initDb(dbPath)
  await runMigrations()
  const names = await getDb().selectFrom('kysely_migration' as any).select('name' as any).execute()
  assert.ok(names.some((row: any) => row.name === '016_app_models_single_active'))
  const indexes = await sql<{ name: string; unique: number; partial: number }>`PRAGMA index_list(app_models)`.execute(getDb())
  assert.ok(indexes.rows.some(row => row.name === 'idx_models_one_active' && row.unique === 1 && row.partial === 1))
  await closeDb()

  const backups = fs.readdirSync(dir).filter(file => file.includes('.pre-016-') && file.endsWith('.bak'))
  assert.equal(backups.length, 1)
  const backupState = logicalState(path.join(dir, backups[0])) as any
  assert.equal(backupState.quickCheck, 'ok')
  assert.equal(backupState.rows.length, 1)
  assert.equal(backupState.migrations.some((row: any) => row.name === '016_app_models_single_active'), false)
})

test('duplicate preflight fails before schema mutation and leaves the original usable and unchanged', async () => {
  const dir = path.join(ROOT, 'duplicate-migration')
  fs.mkdirSync(dir)
  const dbPath = path.join(dir, 'forge.db')
  await create015Database(dbPath)

  initDb(dbPath)
  const model = snapshot('duplicate-app')
  await getDb().insertInto('app_models').values([
    rawRow(model),
    { ...rawRow(model), version: '2.0.0', model_json: JSON.stringify(snapshot('duplicate-app', '2.0.0')) },
  ]).execute()
  await closeDb()
  const before = logicalState(dbPath)

  initDb(dbPath)
  await assert.rejects(runMigrations(), /Duplicate active App Models detected: duplicate-app \(2 active\)/)
  await closeDb()

  assert.deepEqual(logicalState(dbPath), before)
  const backups = fs.readdirSync(dir).filter(file => file.includes('.pre-016-') && file.endsWith('.bak'))
  assert.equal(backups.length, 1)
})

const repositoryDbPath = path.join(ROOT, 'repository', 'forge.db')
const repo = new AppModelRepository()

test('setup real repository database with migration 016', async () => {
  initDb(repositoryDbPath)
  await runMigrations()
  assert.equal(getOpenSqlitePath(), path.resolve(repositoryDbPath))
})

test('successful and repeated upserts preserve history with exactly one active row', async () => {
  await repo.upsert(snapshot('history-app', '1.0.0'))
  await repo.upsert(snapshot('history-app', '2.0.0'))
  const history = await repo.findHistory('history-app')
  assert.equal(history.length, 2)
  assert.equal(history.filter(row => row.status === 'active').length, 1)
  assert.equal(history.find(row => row.status === 'active')?.version, '2.0.0')
})

test('row columns and model_json come from the same validated snapshot', async () => {
  const model = snapshot('consistent-app', '3.2.1')
  const row = await repo.upsert(model)
  const parsed = JSON.parse(row.model_json)
  assert.equal(row.app_name, parsed.app.name)
  assert.equal(row.version, parsed.app.modelVersion)
  assert.equal(row.base_url, parsed.app.baseUrl)
  assert.equal(row.app_type, parsed.app.appType)
  assert.equal(row.crawl_config_hash, parsed.app.crawlMetadata.crawlConfigHash)
  assert.equal(row.page_count, parsed.pages.length)
  assert.equal(row.flow_count, parsed.flows.length)
  assert.equal(row.role_count, parsed.roles.length)
  assert.equal(row.evidence_state, parsed.app.evidenceState)
})

test('forced insert failure rolls back supersede and preserves the previous active row', async () => {
  await repo.upsert(snapshot('rollback-app', '1.0.0'))
  await sql.raw(`
    CREATE TRIGGER force_app_model_insert_failure
    BEFORE INSERT ON app_models
    WHEN NEW.app_name = 'rollback-app' AND NEW.version = '2.0.0'
    BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END
  `).execute(getDb())
  await assert.rejects(
    repo.upsert(snapshot('rollback-app', '2.0.0')),
    (error: unknown) => error instanceof AppModelPersistenceError
      && error.message.includes("rollback-app")
      && error.cause instanceof Error
      && error.cause.message.includes('forced insert failure'),
  )
  const active = await repo.findActive('rollback-app')
  assert.equal(active?.version, '1.0.0')
  assert.equal((await repo.findHistory('rollback-app')).length, 1)
  await sql`DROP TRIGGER force_app_model_insert_failure`.execute(getDb())
})

test('exact app_name identity remains case-sensitive', async () => {
  await repo.upsert(snapshot('CaseSensitiveApp'))
  await repo.upsert(snapshot('casesensitiveapp'))
  assert.equal((await repo.findActive('CaseSensitiveApp'))?.app_name, 'CaseSensitiveApp')
  assert.equal((await repo.findActive('casesensitiveapp'))?.app_name, 'casesensitiveapp')
  const rows = await getDb().selectFrom('app_models').select('app_name')
    .where('status', '=', 'active').where('app_name', 'in', ['CaseSensitiveApp', 'casesensitiveapp']).execute()
  assert.equal(rows.length, 2)
})

test('database rejects a second active row for the same exact app_name', async () => {
  const model = snapshot('constraint-app')
  await repo.upsert(model)
  await assert.rejects(
    getDb().insertInto('app_models').values({ ...rawRow(model), version: '2.0.0' }).execute(),
    /UNIQUE constraint failed: app_models\.app_name/,
  )
})

test('malformed and schema-invalid model_json produce contextual repository errors', async () => {
  await getDb().insertInto('app_models').values({ ...rawRow(snapshot('malformed-app')), model_json: '{' }).execute()
  await assert.rejects(
    repo.getModelJson('malformed-app'),
    (error: unknown) => error instanceof AppModelPersistenceError
      && error.message.includes("malformed-app") && error.message.includes('malformed model_json')
      && error.cause instanceof Error,
  )

  await getDb().insertInto('app_models').values({ ...rawRow(snapshot('invalid-app')), model_json: '{}' }).execute()
  await assert.rejects(
    repo.getModelJson('invalid-app'),
    (error: unknown) => error instanceof AppModelPersistenceError
      && error.message.includes("invalid-app") && error.message.includes('schema-invalid model_json'),
  )
})

test('findActive explicitly rejects a legacy duplicate-active state', async () => {
  await sql`DROP INDEX idx_models_one_active`.execute(getDb())
  const model = snapshot('legacy-duplicate')
  await getDb().insertInto('app_models').values([
    rawRow(model),
    { ...rawRow(model), version: '2.0.0' },
  ]).execute()
  await assert.rejects(
    repo.findActive('legacy-duplicate'),
    (error: unknown) => error instanceof InvalidAppModelStateError
      && error.message.includes('multiple active rows'),
  )
})