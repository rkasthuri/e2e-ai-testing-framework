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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sql } from 'kysely'
import { closeDb, getDatabaseProvenance, getDb, initDb } from '../src/core/storage/db'
import { runMigrations, runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { up as migrate031Up } from '../src/core/storage/migrations/031_canonical_test_definition_v3'

test('Migration 031 persists explicit v3 Test Set and Execution authority without accepting unknown versions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m1-v3-persistence-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const db = getDb()
    const tables = await sql<{ name: string; sql: string }>`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name IN ('test_set_revisions', 'executions')
      ORDER BY name
    `.execute(db)
    assert.equal(tables.rows.length, 2)
    assert.match(tables.rows.find(row => row.name === 'test_set_revisions')!.sql, /schema_version IN \(1, 2, 3\)/)
    assert.match(tables.rows.find(row => row.name === 'executions')!.sql, /definition_schema_version IN \(1,\s*2,\s*3\)/)

    const hash = 'a'.repeat(64)
    await db.insertInto('test_set_revisions').values({
      test_set_id: 'test-set-v3', revision: 1, project_id: 'm1-v3', generation_id: 'generation-v3',
      schema_version: 3, source_observation_id: null, model_row_id: 1, model_version: '1.0.0',
      observation_run_id: 'observation-run-v3', support_seal_hash: hash,
      characterization_policy_id: 'forge.policy', characterization_policy_version: '1',
      generated_at: '2026-08-24T15:00:00.000Z', outcome: 'completed', definition_count: 1,
      payload_json: '{}', content_hash: hash,
    }).execute()
    await db.insertInto('executions').values({
      execution_id: 'execution-v3', project_id: 'm1-v3', accepted_at: '2026-08-24T15:01:00.000Z',
      test_set_id: 'test-set-v3', test_set_revision: 1, definition_schema_version: 3,
      model_row_id: 1, model_version: '1.0.0', source_observation_id: null,
      support_seal_hash: hash, route_evidence_identity_hash: hash,
      authentication_expectation_identity_hash: hash, manifest_hash: hash,
      max_run_attempts: 1, dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
      execution_intent_key: 'm1-v3-intent', execution_intent_fingerprint: hash,
    }).execute()
    assert.equal((await db.selectFrom('test_set_revisions').select('schema_version').executeTakeFirstOrThrow()).schema_version, 3)
    assert.equal((await db.selectFrom('executions').select('definition_schema_version').executeTakeFirstOrThrow()).definition_schema_version, 3)

    await assert.rejects(sql.raw(`INSERT INTO test_set_revisions (
      test_set_id, revision, project_id, generation_id, schema_version, source_observation_id,
      model_row_id, model_version, observation_run_id, support_seal_hash,
      characterization_policy_id, characterization_policy_version, generated_at, outcome,
      definition_count, payload_json, content_hash
    ) VALUES ('bad-set',2,'m1-v3','bad-generation',4,NULL,1,'1.0.0','run','${hash}','policy','1',
      '2026-08-24T15:02:00.000Z','completed',1,'{}','${hash}')`).execute(db))
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Migration 031 preserves existing v2 revision and Execution bytes without coercing their version', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m1-v3-preserve-'))
  initDb(path.join(root, 'forge.db'))
  try {
    const migrationsDirectory = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
    const through030 = Object.fromEntries(fs.readdirSync(migrationsDirectory)
      .filter(file => /^\d+_.*\.ts$/.test(file) && file <= '030_canonical_execution_start_idempotency.ts')
      .sort()
      .map(file => [file.replace(/\.ts$/, ''), require(path.join(migrationsDirectory, file))]))
    await runSqliteMigrationCoordinator(getDb(), through030)
    const db = getDb()
    const hash = 'b'.repeat(64)
    await db.insertInto('test_set_revisions').values({
      test_set_id: 'test-set-v2', revision: 1, project_id: 'm1-v2-preserve', generation_id: 'generation-v2',
      schema_version: 2, source_observation_id: null, model_row_id: 1, model_version: '1.0.0',
      observation_run_id: 'observation-run-v2', support_seal_hash: hash,
      characterization_policy_id: 'forge.policy', characterization_policy_version: '1',
      generated_at: '2026-08-24T14:00:00.000Z', outcome: 'completed', definition_count: 1,
      payload_json: '{"schemaVersion":2}', content_hash: hash,
    }).execute()
    await db.insertInto('executions').values({
      execution_id: 'execution-v2', project_id: 'm1-v2-preserve', accepted_at: '2026-08-24T14:01:00.000Z',
      test_set_id: 'test-set-v2', test_set_revision: 1, definition_schema_version: 2,
      model_row_id: 1, model_version: '1.0.0', source_observation_id: null,
      support_seal_hash: hash, route_evidence_identity_hash: hash,
      authentication_expectation_identity_hash: hash, manifest_hash: hash,
      max_run_attempts: 1, dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
      execution_intent_key: 'm1-v2-intent', execution_intent_fingerprint: hash,
    }).execute()
    const beforeSet = await db.selectFrom('test_set_revisions').selectAll().executeTakeFirstOrThrow()
    const beforeExecution = await db.selectFrom('executions').selectAll().executeTakeFirstOrThrow()
    await runWithMigrationContext(getDatabaseProvenance(), () => migrate031Up(db))
    const afterSet = await db.selectFrom('test_set_revisions').selectAll().executeTakeFirstOrThrow()
    const afterExecution = await db.selectFrom('executions').selectAll().executeTakeFirstOrThrow()
    assert.deepEqual(afterSet, beforeSet)
    assert.deepEqual(afterExecution, beforeExecution)
    assert.equal(afterSet.schema_version, 2)
    assert.equal(afterExecution.definition_schema_version, 2)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
