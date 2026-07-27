/**
 * Focused proof tests for the read-only JSON → SQLite App Model dry-run.
 */
import { spawnSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalJsonSha256,
  canonicalizeJson,
  deterministicMigrationReportJson,
  JsonMigrationDatabaseError,
  planJsonAppModelMigration,
} from '../src/core/storage/JsonAppModelMigrationPlanner'

const ROOT = path.resolve(__dirname, '..')
const VALID_TEMPLATE = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'models', 'ultimateqa', 'app-model.json'), 'utf8'),
)

function temp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-json-migration-'))
}

function model(appName: string, version = '1.0.0'): any {
  const value = structuredClone(VALID_TEMPLATE)
  value.app.name = appName
  value.app.modelVersion = version
  value.app.baseUrl = `https://${appName}.example.test`
  value.generatedAt = '2026-01-01T00:00:00.000Z'
  value.app.crawlMetadata.crawledAt = '2026-01-01T00:00:00.000Z'
  value.classificationRunId = 'fixture-run'
  return value
}

function writeModel(
  modelsDir: string,
  folder: string,
  value: unknown,
  serialization?: string,
): string {
  const dir = path.join(modelsDir, folder)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'app-model.json')
  fs.writeFileSync(file, serialization ?? `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return file
}

const MIGRATION_016_INDEX_SQL = `
  CREATE UNIQUE INDEX idx_models_one_active
  ON app_models (app_name)
  WHERE status = 'active'
`

function createDb(
  root: string,
  migration016 = true,
  indexSql: string | null = migration016 ? MIGRATION_016_INDEX_SQL : null,
): { path: string; db: any } {
  const dbPath = path.join(root, 'forge.db')
  const BetterSqlite3 = require('better-sqlite3')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    CREATE TABLE app_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_name TEXT NOT NULL,
      version TEXT NOT NULL,
      base_url TEXT NOT NULL,
      app_type TEXT NOT NULL,
      intake_mode TEXT NOT NULL,
      crawl_config_hash TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      flow_count INTEGER NOT NULL,
      role_count INTEGER NOT NULL,
      model_json TEXT NOT NULL,
      crawled_at TEXT,
      crawled_by TEXT,
      status TEXT NOT NULL,
      evidence_state TEXT NOT NULL
    );
    CREATE TABLE kysely_migration (
      name TEXT PRIMARY KEY NOT NULL,
      timestamp TEXT NOT NULL
    );
  `)
  if (migration016) {
    db.prepare('INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)').run(
      '016_app_models_single_active',
      '2026-01-01T00:00:00.000Z',
    )
  }
  if (indexSql) db.exec(indexSql)
  return { path: dbPath, db }
}

function planWithMigrationIndex(
  indexSql: string | null,
  prepare?: (db: any) => void,
) {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'index-contract-app', model('index-contract-app'))
  const target = createDb(root, true, null)
  prepare?.(target.db)
  if (indexSql) target.db.exec(indexSql)
  target.db.close()
  return planFor(models, target.path)
}

function insertModel(db: any, value: any, status: string, serialization?: string): void {
  const isApi = value.app.appType === 'rest-api'
    || value.app.appType === 'graphql-api'
    || (value.endpoints?.length ?? 0) > 0
  db.prepare(`
    INSERT INTO app_models (
      app_name, version, base_url, app_type, intake_mode,
      crawl_config_hash, page_count, flow_count, role_count,
      model_json, crawled_at, crawled_by, status, evidence_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.app.name,
    value.app.modelVersion,
    value.app.baseUrl,
    value.app.appType,
    isApi ? 'spec-driven' : 'crawl',
    value.app.crawlMetadata?.crawlConfigHash ?? '',
    isApi ? (value.endpoints?.length ?? 0) : (value.pages?.length ?? 0),
    value.flows?.length ?? 0,
    value.roles?.length ?? 0,
    serialization ?? JSON.stringify(value),
    value.app.crawlMetadata?.crawledAt ?? null,
    value.app.crawlMetadata?.crawledBy ?? null,
    status,
    value.app.evidenceState,
  )
}

function planFor(modelsDir: string, dbPath: string) {
  return planJsonAppModelMigration({ modelsDir, databasePath: dbPath })
}

function hashFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('canonicalization sorts object keys, preserves arrays, and does not mutate input', () => {
  const input = { z: 1, a: { y: 2, b: 3 }, array: [{ z: 4, a: 5 }, 2, 1] }
  const before = JSON.stringify(input)
  assert.equal(
    JSON.stringify(canonicalizeJson(input)),
    '{"a":{"b":3,"y":2},"array":[{"a":5,"z":4},2,1],"z":1}',
  )
  assert.equal(JSON.stringify(input), before)
})

test('canonicalization preserves a top-level __proto__ key as ordinary data', () => {
  const input = JSON.parse('{"z":1,"__proto__":{"marker":"top"}}') as Record<string, unknown>
  const canonical = canonicalizeJson(input) as Record<string, any>
  assert.equal(Object.getPrototypeOf(canonical), null)
  assert.equal(Object.prototype.hasOwnProperty.call(canonical, '__proto__'), true)
  assert.equal(canonical.__proto__.marker, 'top')
  assert.equal(JSON.stringify(canonical), '{"__proto__":{"marker":"top"},"z":1}')
})

test('canonicalization preserves a nested __proto__ key as ordinary data', () => {
  const input = JSON.parse('{"outer":{"z":1,"__proto__":{"marker":"nested"}}}') as Record<string, unknown>
  const canonical = canonicalizeJson(input) as Record<string, any>
  assert.equal(Object.getPrototypeOf(canonical.outer), null)
  assert.equal(Object.prototype.hasOwnProperty.call(canonical.outer, '__proto__'), true)
  assert.equal(canonical.outer.__proto__.marker, 'nested')
})

test('canonicalization preserves constructor and prototype keys as ordinary data', () => {
  const input = JSON.parse('{"prototype":{"value":2},"constructor":{"value":1}}') as Record<string, unknown>
  const canonical = canonicalizeJson(input) as Record<string, any>
  assert.equal(Object.prototype.hasOwnProperty.call(canonical, 'constructor'), true)
  assert.equal(Object.prototype.hasOwnProperty.call(canonical, 'prototype'), true)
  assert.equal(canonical.constructor.value, 1)
  assert.equal(canonical.prototype.value, 2)
})

test('special-key canonical hashes are identical when only object key order changes', () => {
  const first = JSON.parse('{"z":1,"__proto__":{"b":2,"a":1},"constructor":3}')
  const second = JSON.parse('{"constructor":3,"__proto__":{"a":1,"b":2},"z":1}')
  assert.equal(canonicalJsonSha256(first), canonicalJsonSha256(second))
})

test('special-key canonical hashes change when a special-key value changes', () => {
  const first = JSON.parse('{"__proto__":{"value":1},"constructor":2,"prototype":3}')
  const second = JSON.parse('{"__proto__":{"value":9},"constructor":2,"prototype":3}')
  assert.notEqual(canonicalJsonSha256(first), canonicalJsonSha256(second))
})

test('canonicalization creates no prototype pollution or inherited data property', () => {
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  const input = JSON.parse('{"__proto__":{"polluted":"yes"},"safe":{"constructor":{"x":1}}}')
  const canonical = canonicalizeJson(input) as Record<string, any>
  assert.equal(Object.getPrototypeOf(canonical), null)
  assert.equal(Object.getPrototypeOf(canonical.safe), null)
  assert.equal('polluted' in canonical, false)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('classifies a valid source with no exact-case SQLite row as safe new import', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'new-app', model('new-app'))
  const target = createDb(root)
  target.db.close()
  const plan = planFor(models, target.path)
  assert.equal(plan.items[0].classification, 'safe_new_import')
  assert.equal(plan.summary.exitCode, 0)
  assert.equal(plan.migration016.status, 'applied')
})

test('distinguishes exact serialization from canonical semantic equality', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const exact = model('exact-app')
  const exactRaw = JSON.stringify(exact)
  writeModel(models, 'exact-app', exact, exactRaw)
  const target = createDb(root)
  insertModel(target.db, exact, 'active', exactRaw)
  target.db.close()
  assert.equal(planFor(models, target.path).items[0].classification, 'exact_duplicate')

  const semanticRoot = temp()
  const semanticModels = path.join(semanticRoot, 'models')
  const semantic = model('semantic-app')
  writeModel(semanticModels, 'semantic-app', semantic)
  const semanticTarget = createDb(semanticRoot)
  insertModel(semanticTarget.db, semantic, 'active', JSON.stringify(semantic))
  semanticTarget.db.close()
  assert.equal(
    planFor(semanticModels, semanticTarget.path).items[0].classification,
    'semantic_duplicate_different_serialization',
  )
})

test('classifies a different active snapshot as a blocking conflict', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'conflict-app', model('conflict-app', '2.0.0'))
  const target = createDb(root)
  insertModel(target.db, model('conflict-app', '1.0.0'), 'active')
  target.db.close()
  const plan = planFor(models, target.path)
  assert.equal(plan.items[0].classification, 'conflicting_active_snapshot')
  assert.equal(plan.summary.exitCode, 1)
})

test('recognizes a matching superseded snapshot without reactivating it', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const source = model('historical-app')
  writeModel(models, 'historical-app', source)
  const target = createDb(root)
  insertModel(target.db, source, 'superseded')
  target.db.close()
  const item = planFor(models, target.path).items[0]
  assert.equal(item.classification, 'matching_superseded_snapshot')
  assert.equal(item.proposedAction, 'no_op_preserve_superseded')
})

test('separates malformed JSON from schema-invalid JSON', () => {
  const malformedRoot = temp()
  const malformedModels = path.join(malformedRoot, 'models')
  writeModel(malformedModels, 'broken', {}, '{ definitely-not-json')
  const malformedTarget = createDb(malformedRoot)
  malformedTarget.db.close()
  assert.equal(planFor(malformedModels, malformedTarget.path).items[0].classification, 'invalid_json')

  const invalidRoot = temp()
  const invalidModels = path.join(invalidRoot, 'models')
  const invalid = model('invalid-app')
  invalid.app.appType = 'spa'
  writeModel(invalidModels, 'invalid-app', invalid)
  const invalidTarget = createDb(invalidRoot)
  invalidTarget.db.close()
  assert.equal(
    planFor(invalidModels, invalidTarget.path).items[0].classification,
    'schema_invalid_json',
  )
})

test('missing, folder-mismatched, and duplicate identities are ambiguous', () => {
  const missingRoot = temp()
  const missingModels = path.join(missingRoot, 'models')
  const missing = model('missing-app')
  delete missing.app.name
  writeModel(missingModels, 'missing-app', missing)
  const missingTarget = createDb(missingRoot)
  missingTarget.db.close()
  assert.equal(planFor(missingModels, missingTarget.path).items[0].classification, 'ambiguous_identity')

  const mismatchRoot = temp()
  const mismatchModels = path.join(mismatchRoot, 'models')
  writeModel(mismatchModels, 'wrong-folder', model('actual-name'))
  const mismatchTarget = createDb(mismatchRoot)
  mismatchTarget.db.close()
  assert.equal(planFor(mismatchModels, mismatchTarget.path).items[0].classification, 'ambiguous_identity')

  const duplicateRoot = temp()
  const duplicateModels = path.join(duplicateRoot, 'models')
  writeModel(path.join(duplicateModels, 'one'), 'same-name', model('same-name'))
  writeModel(path.join(duplicateModels, 'two'), 'same-name', model('same-name'))
  const duplicateTarget = createDb(duplicateRoot)
  duplicateTarget.db.close()
  const duplicatePlan = planFor(duplicateModels, duplicateTarget.path)
  assert.ok(duplicatePlan.items.every(item => item.classification === 'ambiguous_identity'))
})

test('differently cased app names remain separate exact identities', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'CaseApp', model('CaseApp'))
  const target = createDb(root)
  insertModel(target.db, model('caseapp'), 'active')
  target.db.close()
  const item = planFor(models, target.path).items[0]
  assert.equal(item.classification, 'safe_new_import')
  assert.equal(item.sqliteMatches.length, 0)
})

test('reports Migration 016 as not applied without applying it', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'new-app', model('new-app'))
  const target = createDb(root, false)
  target.db.close()
  const first = planFor(models, target.path)
  const second = planFor(models, target.path)
  assert.equal(first.migration016.status, 'not_applied')
  assert.equal(first.migration016.historyApplied, false)
  assert.equal(first.migration016.indexPresent, false)
  assert.equal(first.migration016.indexContractValid, false)
  assert.deepEqual(second.migration016, first.migration016)
})

test('Migration 016 rejects the expected index name on the wrong column', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX idx_models_one_active
    ON app_models (base_url)
    WHERE status = 'active'
  `)
  assert.equal(plan.migration016.status, 'inconsistent')
  assert.deepEqual(plan.migration016.indexedColumns, ['base_url'])
  assert.equal(plan.migration016.indexColumnExact, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('Migration 016 rejects a non-unique index with the expected name', () => {
  const plan = planWithMigrationIndex(`
    CREATE INDEX idx_models_one_active
    ON app_models (app_name)
    WHERE status = 'active'
  `)
  assert.equal(plan.migration016.indexUnique, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('Migration 016 rejects a non-partial index with the expected name', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX idx_models_one_active
    ON app_models (app_name)
  `)
  assert.equal(plan.migration016.indexPartial, false)
  assert.equal(plan.migration016.indexPredicateExact, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('Migration 016 rejects a materially different active-row predicate', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX idx_models_one_active
    ON app_models (app_name)
    WHERE status = 'superseded'
  `)
  assert.equal(plan.migration016.indexPartial, true)
  assert.equal(plan.migration016.indexPredicateExact, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('Migration 016 rejects COLLATE NOCASE identity', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX idx_models_one_active
    ON app_models (app_name COLLATE NOCASE)
    WHERE status = 'active'
  `)
  assert.equal(plan.migration016.indexColumnExact, true)
  assert.equal(plan.migration016.indexCaseSensitive, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('Migration 016 accepts harmless identifier quoting and whitespace', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX "idx_models_one_active"
      ON "app_models" ( "app_name" )
      WHERE ( "status" = 'active' )
  `)
  assert.equal(plan.migration016.status, 'applied')
  assert.equal(plan.migration016.indexTargetsAppModels, true)
  assert.deepEqual(plan.migration016.indexedColumns, ['app_name'])
  assert.equal(plan.migration016.indexPredicateExact, true)
  assert.equal(plan.migration016.indexCaseSensitive, true)
  assert.equal(plan.migration016.indexContractValid, true)
})

test('Migration 016 accepts the exact migration-defined index contract', () => {
  const plan = planWithMigrationIndex(MIGRATION_016_INDEX_SQL)
  assert.equal(plan.migration016.status, 'applied')
  assert.equal(plan.migration016.indexContractValid, true)
})

test('Migration 016 rejects the expected index name on another table', () => {
  const plan = planWithMigrationIndex(`
    CREATE UNIQUE INDEX idx_models_one_active
    ON deceptive_models (app_name)
    WHERE status = 'active'
  `, db => db.exec(`
    CREATE TABLE deceptive_models (
      app_name TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `))
  assert.equal(plan.migration016.indexTable, 'deceptive_models')
  assert.equal(plan.migration016.indexTargetsAppModels, false)
  assert.equal(plan.migration016.indexContractValid, false)
})

test('repeated plans and JSON reports are deterministic', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const source = model('repeat-app')
  writeModel(models, 'repeat-app', source)
  const target = createDb(root)
  insertModel(target.db, source, 'active')
  target.db.close()
  const first = planFor(models, target.path)
  const second = planFor(models, target.path)
  assert.deepEqual(second, first)
  assert.equal(deterministicMigrationReportJson(second), deterministicMigrationReportJson(first))
})

test('planner performs zero database writes and zero App Model JSON writes', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const file = writeModel(models, 'immutable-app', model('immutable-app'))
  const target = createDb(root)
  target.db.close()
  const before = {
    dbHash: hashFile(target.path),
    jsonHash: hashFile(file),
    jsonMtime: fs.statSync(file).mtimeMs,
  }
  const first = planFor(models, target.path)
  const second = planFor(models, target.path)
  const after = {
    dbHash: hashFile(target.path),
    jsonHash: hashFile(file),
    jsonMtime: fs.statSync(file).mtimeMs,
  }
  assert.deepEqual(second, first)
  assert.deepEqual(after, before)
})

test('unavailable database is explicit and CLI exits non-zero with a deterministic error report', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'new-app', model('new-app'))
  const missingDb = path.join(root, 'missing.db')
  assert.throws(
    () => planFor(models, missingDb),
    (error: unknown) => error instanceof JsonMigrationDatabaseError,
  )

  const report = path.join(root, 'error-report.json')
  const result = spawnSync(
    process.execPath,
    [
      '-r',
      'tsx/cjs',
      path.join(ROOT, 'scripts', 'dry-run-json-app-model-migration.ts'),
      '--models-dir', models,
      '--db', missingDb,
      '--report', report,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).error.code, 'database_unavailable_or_unreadable')
})

test('canonical hashes preserve array order and JSON value types', () => {
  assert.notEqual(canonicalJsonSha256({ values: [1, 2] }), canonicalJsonSha256({ values: [2, 1] }))
  assert.notEqual(canonicalJsonSha256({ value: 1 }), canonicalJsonSha256({ value: '1' }))
  assert.notEqual(canonicalJsonSha256({ value: false }), canonicalJsonSha256({ value: 'false' }))
})

test('schema-invalid source remains blocking when SQLite has a semantic relation', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const invalid = model('invalid-related')
  invalid.app.appType = 'spa'
  writeModel(models, 'invalid-related', invalid)
  const target = createDb(root)
  insertModel(target.db, invalid, 'active')
  target.db.close()
  const item = planFor(models, target.path).items[0]
  assert.equal(item.classification, 'schema_invalid_json')
  assert.equal(item.blocking, true)
  assert.ok(item.sqliteMatches.some(row => row.serializationMatch === 'semantic_equal'))
  assert.equal(item.actionPerformed, false)
})

test('multiple active SQLite rows are ambiguous and block without choosing a winner', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'ambiguous-db', model('ambiguous-db'))
  const target = createDb(root, false)
  insertModel(target.db, model('ambiguous-db', '1.0.0'), 'active')
  insertModel(target.db, model('ambiguous-db', '2.0.0'), 'active')
  target.db.close()
  const plan = planFor(models, target.path)
  assert.equal(plan.items[0].classification, 'ambiguous_identity')
  assert.deepEqual(plan.items[0].sqliteMatches.map(row => row.id), [1, 2])
  assert.equal(plan.summary.verdict, 'BLOCKED')
  assert.ok(plan.databaseReadiness.blockers.some(item => item.code === 'duplicate_active_rows'))
})

test('database readiness blocks when Migration 016 history exists but its index is absent', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'new-app', model('new-app'))
  const target = createDb(root)
  target.db.exec('DROP INDEX idx_models_one_active')
  target.db.close()
  const plan = planFor(models, target.path)
  assert.equal(plan.migration016.status, 'inconsistent')
  assert.equal(plan.databaseReadiness.ready, false)
  assert.equal(plan.summary.verdict, 'BLOCKED')
  assert.ok(plan.databaseReadiness.blockers.some(
    item => item.code === 'single_active_index_missing_or_invalid',
  ))
})

test('global duplicate-active state blocks even when the source identity itself is new', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'clean-source', model('clean-source'))
  const target = createDb(root, false)
  insertModel(target.db, model('other-app', '1.0.0'), 'active')
  insertModel(target.db, model('other-app', '2.0.0'), 'active')
  target.db.close()
  const plan = planFor(models, target.path)
  assert.equal(plan.items[0].classification, 'safe_new_import')
  assert.equal(plan.summary.verdict, 'BLOCKED')
  assert.deepEqual(plan.databaseReadiness.duplicateActiveIdentities, [
    { appName: 'other-app', rowIds: [1, 2] },
  ])
})

test('deterministic payload excludes absolute fixture paths and uses stable source ordering', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'z-app', model('z-app'))
  writeModel(models, 'B-app', model('B-app'))
  writeModel(models, 'a-app', model('a-app'))
  const target = createDb(root)
  target.db.close()
  const plan = planFor(models, target.path)
  const report = deterministicMigrationReportJson(plan)
  assert.deepEqual(plan.items.map(item => item.sourcePath), [
    'B-app/app-model.json', 'a-app/app-model.json', 'z-app/app-model.json',
  ])
  assert.equal(plan.sourceRoot, 'models')
  assert.equal(plan.databasePath, 'forge.db')
  assert.ok(!report.includes(root.replace(/\\/g, '/')))
  assert.equal(plan.actionsPerformed.length, 0)
})

test('filesystem mtime changes do not change the deterministic plan', () => {
  const root = temp()
  const models = path.join(root, 'models')
  const file = writeModel(models, 'mtime-app', model('mtime-app'))
  const target = createDb(root)
  target.db.close()
  const first = deterministicMigrationReportJson(planFor(models, target.path))
  fs.utimesSync(file, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))
  const second = deterministicMigrationReportJson(planFor(models, target.path))
  assert.equal(second, first)
})

test('CLI refuses existing report paths unless overwrite is explicit', () => {
  const root = temp()
  const models = path.join(root, 'models')
  writeModel(models, 'report-app', model('report-app'))
  const target = createDb(root)
  target.db.close()
  const report = path.join(root, 'report.json')
  fs.writeFileSync(report, 'preserve-me', 'utf8')
  const args = [
    '-r', 'tsx/cjs', path.join(ROOT, 'scripts', 'dry-run-json-app-model-migration.ts'),
    '--models-dir', models, '--db', target.path, '--report', report,
  ]
  const refused = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  assert.notEqual(refused.status, 0)
  assert.equal(fs.readFileSync(report, 'utf8'), 'preserve-me')
  const overwritten = spawnSync(process.execPath, [...args, '--overwrite'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(overwritten.status, 0)
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).reportVersion, 'json-app-model-dry-run/v1')
})