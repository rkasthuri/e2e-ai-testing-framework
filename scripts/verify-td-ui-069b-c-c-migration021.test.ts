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
import { Kysely, sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { materializeCanonicalTestSet, type CanonicalTestSet } from '../src/core/test-design/TestDefinitionContract'
import { projectExecutablePlan } from '../src/core/execution/ExecutionProjectionService'

interface ForgeMigration { up: (db: Kysely<any>) => Promise<void> }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-069b-c-c-m021-'))
const TEMPLATE = path.join(ROOT, 'through-020.db')
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
const NOW = '2026-08-10T12:00:00.000Z'

function loadMigrations(): Record<string, ForgeMigration> {
  return Object.fromEntries(fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.ts')).sort()
    .map(file => [file.replace(/\.ts$/, ''), require(path.join(MIGRATIONS_DIR, file))]))
}
const migrations = loadMigrations()
const through020 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '020_execution_lifecycle'))
const through021 = Object.fromEntries(Object.entries(migrations).filter(([name]) => name <= '021_execution_identity_manifest_run_linkage'))

async function open(file: string): Promise<Kysely<any>> { initDb(file); return getDb() as unknown as Kysely<any> }
function copy(name: string): string { const target = path.join(ROOT, `${name}.db`); fs.copyFileSync(TEMPLATE, target); return target }
async function tableExists(db: Kysely<any>, name: string): Promise<boolean> {
  return (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`.execute(db)).rows.length === 1
}
async function tableDigest(db: Kysely<any>, name: string): Promise<string> {
  const rows = (await sql.raw(`SELECT * FROM "${name}" ORDER BY rowid`).execute(db)).rows
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function canonicalSet(): ReturnType<typeof materializeCanonicalTestSet> {
  const value: CanonicalTestSet = {
    schemaVersion: 1, testSetId: 'test-set-1', revision: 1, projectId: 'project-1',
    generationId: 'generation-1', generatedAt: NOW, generationMethod: 'deterministic',
    outcome: 'partially_completed', sourceObservationId: 'observation-1', modelRowId: 7,
    modelVersion: '1.0.0', supportingEvidenceIds: ['evidence-1'],
    definitions: [{
      id: 'definition-1', title: 'Observed inventory route', intent: 'Navigate to the observed inventory route.',
      category: 'navigation', canonicalSubjects: ['inventory'], preconditions: [],
      steps: [{ kind: 'navigate_to_observed_route', subjectId: 'inventory', routePath: '/inventory.html', evidenceId: 'evidence-1' }],
      oracle: { kind: 'subject_observable', subjectId: 'inventory', evidenceId: 'evidence-1', explanation: 'Observed route remains reachable.' },
      provenance: { sourceObservationId: 'observation-1', modelRowId: 7, modelVersion: '1.0.0', supportingEvidenceIds: ['evidence-1'] },
      generationMethod: 'deterministic', validation: { state: 'valid', explanation: 'Valid.' },
      runnerCompatibility: { state: 'compatible', explanation: 'Supported.' },
      authenticationRequired: false, confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: 'Bounded route oracle.',
    }],
    limitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerSet: 'Bounded route oracle.',
    coverage: 'unknown', freshness: 'not_evaluated',
  }
  return materializeCanonicalTestSet(value)
}

async function seedAuthority(db: Kysely<any>): Promise<string> {
  const set = canonicalSet()
  await db.insertInto('test_set_revisions').values({
    test_set_id: set.value.testSetId, revision: set.value.revision, project_id: set.value.projectId,
    generation_id: set.value.generationId, source_observation_id: set.value.sourceObservationId,
    model_row_id: set.value.modelRowId, model_version: set.value.modelVersion,
    generated_at: set.value.generatedAt, outcome: set.value.outcome,
    definition_count: set.value.definitions.length, payload_json: set.json, content_hash: set.fingerprint,
  }).execute()
  const projection = projectExecutablePlan({ definition: set.value.definitions[0], definitionTestSetId: set.value.testSetId, definitionRevision: 1 }, {
    currentRevision: { testSetId: set.value.testSetId, revision: 1 },
    sourceObservation: { id: set.value.sourceObservationId, authenticationExpectation: 'none', authenticationOutcome: 'not_required' },
    model: { rowId: 7, version: '1.0.0' }, currentSupportEvidenceIds: ['evidence-1'],
  }, NOW)
  assert.equal(projection.kind, 'ok')
  return projection.kind === 'ok' ? projection.plan.fingerprint : ''
}

async function seedStarted(db: Kysely<any>, options: { terminal?: boolean; lock?: boolean; hash?: string; conflictingTerminal?: boolean } = {}): Promise<string> {
  const hash = options.hash ?? await seedAuthority(db)
  await db.insertInto('execution_events').values({
    execution_id: 'execution-1', project_id: 'project-1', event_type: 'started', outcome: null,
    occurred_at: NOW, process_instance_id: 'process-1', safe_code: null,
    safe_message: 'Accepted.', execution_plan_hash: hash,
  }).execute()
  if (options.terminal) await db.insertInto('execution_events').values({
    execution_id: 'execution-1', project_id: options.conflictingTerminal ? 'project-2' : 'project-1',
    event_type: 'terminal', outcome: 'completed', occurred_at: '2026-08-10T12:01:00.000Z',
    process_instance_id: 'process-1', safe_code: 'completed', safe_message: 'Completed.', execution_plan_hash: hash,
  }).execute()
  if (options.lock) await db.insertInto('execution_locks').values({
    project_id: 'project-1', execution_id: 'execution-1', process_instance_id: 'process-1',
    acquired_at: NOW, last_heartbeat_at: NOW,
  }).execute()
  return hash
}

async function seedLegacy(db: Kysely<any>): Promise<void> {
  await db.insertInto('runs').values({ run_id: 'legacy-run', app_name: 'legacy-app', started_at: NOW, completed_at: NOW }).execute()
  await db.insertInto('test_results').values({ run_id: 'legacy-run', test_id: 'legacy-test', title: 'Legacy', suite: 'legacy', status: 'passed' }).execute()
}

before(async () => { const db = await open(TEMPLATE); await runSqliteMigrationCoordinator(db, through020); await closeDb() })
after(async () => { await closeDb(); fs.rmSync(ROOT, { recursive: true, force: true }) })

test('TD069B-C-C-A clean schema migrates from 020 through exact 021 foundation', async () => {
  const db = await open(copy('clean'))
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through021), ['021_execution_identity_manifest_run_linkage'])
  assert.equal(await tableExists(db, 'executions'), true)
  assert.equal(await tableExists(db, 'execution_items'), true)
  const columns = (await sql<{ name: string }>`PRAGMA table_info(executions)`.execute(db)).rows.map(row => row.name)
  assert.deepEqual(columns, ['execution_id', 'project_id', 'accepted_at', 'test_set_id', 'test_set_revision', 'model_row_id', 'model_version', 'source_observation_id', 'manifest_hash', 'max_run_attempts', 'dispatch_mode', 'stop_rule'])
  const authoritySource = fs.readFileSync(path.join(MIGRATIONS_DIR, '..', 'DatabaseAuthority.ts'), 'utf8')
  assert.match(authoritySource, /LEGACY_POSTGRES_MIGRATION_CEILING = '020_execution_lifecycle'/)
  await closeDb()
})

test('TD069B-C-C-B uniquely reconstructable Migration 020 lifecycle rows are preserved and linked', async () => {
  const db = await open(copy('preserved-lifecycle'))
  const hash = await seedStarted(db, { terminal: true })
  const before = await db.selectFrom('execution_events').selectAll().orderBy('id').execute()
  await runSqliteMigrationCoordinator(db, through021)
  assert.deepEqual(await db.selectFrom('execution_events').selectAll().orderBy('id').execute(), before)
  assert.deepEqual(await db.selectFrom('executions').selectAll().executeTakeFirstOrThrow(), {
    execution_id: 'execution-1', project_id: 'project-1', accepted_at: NOW,
    test_set_id: 'test-set-1', test_set_revision: 1, model_row_id: 7, model_version: '1.0.0',
    source_observation_id: 'observation-1', manifest_hash: hash, max_run_attempts: 1,
    dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
  })
  assert.deepEqual(await db.selectFrom('execution_items').selectAll().executeTakeFirstOrThrow(), {
    execution_id: 'execution-1', item_ordinal: 1, definition_id: 'definition-1', executable_plan_hash: hash,
  })
  await closeDb()
})

test('TD069B-C-C-C legacy runs and results are byte-for-field preserved and classified only as legacy', async () => {
  const db = await open(copy('legacy-preserved')); await seedLegacy(db)
  const unrelated = ['app_models', 'test_set_revisions', 'test_generation_events', 'test_generation_locks', 'heal_events', 'ai_triage', 'assertions']
  const unrelatedBefore = Object.fromEntries(await Promise.all(unrelated.map(async name => [name, await tableDigest(db, name)])))
  const beforeRun = await db.selectFrom('runs').selectAll().executeTakeFirstOrThrow()
  const beforeResult = await db.selectFrom('test_results').selectAll().executeTakeFirstOrThrow()
  await runSqliteMigrationCoordinator(db, through021)
  const afterRun = await db.selectFrom('runs').selectAll().executeTakeFirstOrThrow()
  const afterResult = await db.selectFrom('test_results').selectAll().executeTakeFirstOrThrow()
  assert.deepEqual({ ...afterRun, execution_id: undefined, origin: undefined, attempt_ordinal: undefined }, { ...beforeRun, execution_id: undefined, origin: undefined, attempt_ordinal: undefined })
  assert.equal(afterRun.origin, 'legacy'); assert.equal(afterRun.execution_id, null); assert.equal(afterRun.attempt_ordinal, null)
  assert.deepEqual({ ...afterResult, result_id: undefined, execution_item_ordinal: undefined, definition_id: undefined, executable_plan_hash: undefined }, { ...beforeResult, result_id: undefined, execution_item_ordinal: undefined, definition_id: undefined, executable_plan_hash: undefined })
  assert.equal(afterResult.result_id, null)
  const unrelatedAfter = Object.fromEntries(await Promise.all(unrelated.map(async name => [name, await tableDigest(db, name)])))
  assert.deepEqual(unrelatedAfter, unrelatedBefore)
  await closeDb()
})

test('TD069B-C-C-D Product-shaped Run and Result fixture must match one execution manifest item', async () => {
  const db = await open(copy('product-valid')); const hash = await seedStarted(db, { terminal: true }); await runSqliteMigrationCoordinator(db, through021)
  await db.insertInto('runs').values({ run_id: 'product-run', app_name: 'project-1', started_at: NOW, execution_id: 'execution-1', origin: 'product', attempt_ordinal: 1 }).execute()
  await db.insertInto('test_results').values({ run_id: 'product-run', test_id: 'definition-1', title: 'Product', suite: 'product', status: 'passed', result_id: 'result-1', execution_item_ordinal: 1, definition_id: 'definition-1', executable_plan_hash: hash }).execute()
  assert.equal((await db.selectFrom('test_results').select('result_id').executeTakeFirstOrThrow()).result_id, 'result-1')
  await assert.rejects(db.insertInto('test_results').values({ run_id: 'product-run', test_id: 'wrong', title: 'Wrong', suite: 'product', status: 'passed', result_id: 'result-2', execution_item_ordinal: 1, definition_id: 'wrong-definition', executable_plan_hash: hash }).execute(), /does not match/)
  await assert.rejects(db.updateTable('runs').set({ attempt_ordinal: 2 }).where('run_id', '=', 'product-run').execute(), /linkage is immutable/)
  await assert.rejects(db.updateTable('test_results').set({ definition_id: 'wrong-definition' }).where('result_id', '=', 'result-1').execute(), /immutable/)
  await assert.rejects(db.deleteFrom('execution_items').where('execution_id', '=', 'execution-1').execute(), /immutable/)
  await closeDb()
})

test('TD069B-C-C-E orphan terminal event refuses and rolls back all 021 state', async () => {
  const db = await open(copy('orphan-event')); const hash = await seedAuthority(db)
  await db.insertInto('execution_events').values({ execution_id: 'execution-1', project_id: 'project-1', event_type: 'terminal', outcome: 'completed', occurred_at: NOW, process_instance_id: 'process-1', safe_code: 'completed', safe_message: 'Completed.', execution_plan_hash: hash }).execute()
  await assert.rejects(runSqliteMigrationCoordinator(db, through021), /conflicting started or terminal identity/)
  assert.equal(await tableExists(db, 'executions'), false)
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '021_execution_identity_manifest_run_linkage').execute()).length, 0)
  await closeDb()
})

test('TD069B-C-C-F orphan lock refuses migration', async () => {
  const db = await open(copy('orphan-lock'))
  await db.insertInto('execution_locks').values({ project_id: 'project-1', execution_id: 'execution-1', process_instance_id: 'process-1', acquired_at: NOW, last_heartbeat_at: NOW }).execute()
  await assert.rejects(runSqliteMigrationCoordinator(db, through021), /orphaned or conflicts/)
  assert.equal(await tableExists(db, 'executions'), false); await closeDb()
})

test('TD069B-C-C-G conflicting lifecycle identity refuses migration', async () => {
  const db = await open(copy('conflicting')); await seedStarted(db, { terminal: true, conflictingTerminal: true })
  await assert.rejects(runSqliteMigrationCoordinator(db, through021), /internally conflicting lifecycle evidence/)
  assert.equal(await tableExists(db, 'executions'), false); await closeDb()
})

test('TD069B-C-C-H duplicate Product attempt linkage is refused by the partial unique authority', async () => {
  const db = await open(copy('duplicate-attempt')); await seedStarted(db, { terminal: true }); await runSqliteMigrationCoordinator(db, through021)
  const base = { app_name: 'project-1', started_at: NOW, execution_id: 'execution-1', origin: 'product', attempt_ordinal: 1 }
  await db.insertInto('runs').values({ ...base, run_id: 'product-run-1' }).execute()
  await assert.rejects(db.insertInto('runs').values({ ...base, run_id: 'product-run-2' }).execute(), /UNIQUE constraint failed/)
  await closeDb()
})

test('TD069B-C-C-I malformed semantic hash refuses migration without schema drift', async () => {
  const db = await open(copy('bad-hash')); await seedStarted(db, { hash: 'not-a-semantic-hash' })
  await assert.rejects(runSqliteMigrationCoordinator(db, through021), /event .* is malformed/)
  assert.equal(await tableExists(db, 'executions'), false); await closeDb()
})

test('TD069B-C-C-J a historical Result lacking Product provenance remains a legacy Result', async () => {
  const db = await open(copy('legacy-result')); await seedLegacy(db); await runSqliteMigrationCoordinator(db, through021)
  const row = await db.selectFrom('test_results').select(['result_id', 'execution_item_ordinal', 'definition_id', 'executable_plan_hash']).executeTakeFirstOrThrow()
  assert.deepEqual(row, { result_id: null, execution_item_ordinal: null, definition_id: null, executable_plan_hash: null })
  await closeDb()
})

test('TD069B-C-C-K forced history failure rolls back the entire Migration 021 transaction', async () => {
  const db = await open(copy('forced-rollback'))
  await sql.raw(`CREATE TRIGGER fail_021_history BEFORE INSERT ON kysely_migration WHEN NEW.name = '021_execution_identity_manifest_run_linkage' BEGIN SELECT RAISE(ABORT, 'forced 021 history failure'); END`).execute(db)
  await assert.rejects(runSqliteMigrationCoordinator(db, through021), /forced 021 history failure/)
  assert.equal(await tableExists(db, 'executions'), false)
  assert.deepEqual((await sql<{ name: string }>`PRAGMA table_info(runs)`.execute(db)).rows.map(row => row.name).slice(-3), ['input_health', 'input_health_reason', 'lifecycle'])
  await closeDb()
})

test('TD069B-C-C-L coordinator rerun is recognized without duplicate schema or history mutation', async () => {
  const db = await open(copy('rerun')); await runSqliteMigrationCoordinator(db, through021)
  const before = (await sql<{ type: string; name: string; sql: string | null }>`SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%execution%' OR name LIKE 'uq_runs_%' OR name LIKE 'uq_results_%' ORDER BY type, name`.execute(db)).rows
  assert.deepEqual(await runSqliteMigrationCoordinator(db, through021), [])
  const afterRerun = (await sql<{ type: string; name: string; sql: string | null }>`SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%execution%' OR name LIKE 'uq_runs_%' OR name LIKE 'uq_results_%' ORDER BY type, name`.execute(db)).rows
  assert.deepEqual(afterRerun, before)
  assert.equal((await db.selectFrom('kysely_migration').select('name').where('name', '=', '021_execution_identity_manifest_run_linkage').execute()).length, 1)
  await closeDb()
})
