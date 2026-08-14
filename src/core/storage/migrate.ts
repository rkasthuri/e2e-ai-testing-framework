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

import * as path from 'path';
import * as fs from 'fs';
import { Kysely, sql } from 'kysely';
import {
  getDb,
  closeDb,
  getOpenSqlitePath,
  getDatabaseProvenance,
  initLegacyRuntimeDatabase,
} from './db';
import {
  DatabaseAuthorityError,
  DatabaseAuthorityMode,
  LEGACY_POSTGRES_MIGRATION_CEILING,
  type ActiveDatabaseProvenance,
} from './DatabaseAuthority';
import { runWithMigrationContext } from './MigrationContext';

// Kysely's Migrator and migration types live in a subpath export (kysely/migration)
// that is not declared as a types path in kysely's package.json exports map under
// "moduleResolution": "node". We load it at runtime via require() and type it with
// `any` so that this file compiles cleanly without tsconfig changes.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Migrator } = require('kysely/migration') as { Migrator: new (args: any) => any };

/**
 * CJS-safe migration provider.
 *
 * Kysely's built-in FileMigrationProvider uses dynamic import() which can
 * fail in ts-node / tsx CJS mode. This provider uses require() instead,
 * which works correctly when executed via `tsx src/storage/migrate.ts`.
 */
class TsxMigrationProvider {
  constructor(
    private readonly migrationsDir: string,
    private readonly authority: ActiveDatabaseProvenance,
  ) {}

  async getMigrations(): Promise<Record<string, { up: (db: any) => Promise<void>; down?: (db: any) => Promise<void> }>> {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .filter(f => f.replace(/\.(ts|js)$/, '') <= this.authority.migrationCeiling)
      .sort();

    const migrations: Record<string, any> = {};
    for (const file of files) {
      const name = file.replace(/\.(ts|js)$/, '');
      const fullPath = path.join(this.migrationsDir, file);
      if (name === LEGACY_JSON_IMPORT_MIGRATION && !this.authority.legacyImportAllowed) {
        migrations[name] = { up: async () => undefined }
        continue
      }
      if (name === LEGACY_JSON_IMPORT_MIGRATION) {
        const expectedRoot = this.authority.legacyImportRoot
        if (!expectedRoot || path.resolve(process.cwd()) !== expectedRoot) {
          throw new DatabaseAuthorityError(
            'LEGACY_IMPORT_CONTEXT_CHANGED',
            'Legacy Migration 004 import root changed after database authority was established.',
          )
        }
        delete require.cache[require.resolve(fullPath)]
      }
      const loaded = require(fullPath) as ForgeMigration
      migrations[name] = {
        up: (db: Kysely<any>) => runWithMigrationContext(this.authority, () => loaded.up(db)),
        ...(loaded.down
          ? { down: (db: Kysely<any>) => runWithMigrationContext(this.authority, () => loaded.down!(db)) }
          : {}),
      };
    }
    return migrations;
  }
}

const SINGLE_ACTIVE_MIGRATION = '016_app_models_single_active'
const OPERATION_IDENTITY_MIGRATION = '017_app_models_operation_identity'
const EXECUTION_LIFECYCLE_MIGRATION = '020_execution_lifecycle'
const EXECUTION_IDENTITY_MIGRATION = '021_execution_identity_manifest_run_linkage'
const PRODUCT_EVIDENCE_GUARDS_MIGRATION = '022_product_execution_evidence_guards'
const PRODUCT_CANCELLATION_MIGRATION = '023_product_execution_cancellation'
const CANONICAL_OBSERVATION_MIGRATION = '024_canonical_observation_authority'
const HISTORICAL_OBSERVATION_IMPORT_MIGRATION = '025_historical_observation_import'
const CANONICAL_TEST_DEFINITION_V2_MIGRATION = '026_canonical_test_definition_v2'
const CANONICAL_V2_EXECUTION_AUTHORITY_MIGRATION = '027_canonical_v2_execution_authority'
const LEGACY_JSON_IMPORT_MIGRATION = '004_json_import'
const MIGRATION_TABLE = 'kysely_migration'
const MIGRATION_LOCK_TABLE = 'kysely_migration_lock'
const MIGRATION_LOCK_ID = 'migration_lock'

interface ForgeMigration {
  up: (db: Kysely<any>) => Promise<void>
  down?: (db: Kysely<any>) => Promise<void>
}

class MigrationStateMismatchError extends Error {
  constructor(readonly discrepancies: string[]) {
    super(`[migration] Refusing SQLite migration because schema and migration history disagree: ${discrepancies.join('; ')}. Do not repair or mark migrations applied automatically; restore the database from a verified backup before retrying.`)
    this.name = 'MigrationStateMismatchError'
  }
}

class AtomicMigrationError extends Error {
  constructor(readonly migrationName: string, message: string, options?: { cause?: unknown }) {
    super(`[migration] Atomic migration '${migrationName}' failed: ${message}`, options)
    this.name = 'AtomicMigrationError'
  }
}

interface IndexContract { present: boolean; valid: boolean; detail: string }
interface TableContract { present: boolean; valid: boolean; detail: string }

function stripOuterSqlParentheses(value: string): string {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let quote: string | null = null
    let enclosesWholeExpression = true
    for (let index = 0; index < result.length; index++) {
      const character = result[index]
      if (quote) {
        if (character === quote) {
          if (index + 1 < result.length && result[index + 1] === quote) index++
          else quote = null
        }
        continue
      }
      if (character === "'" || character === '"' || character === '`') quote = character
      else if (character === '[') quote = ']'
      else if (character === '(') depth++
      else if (character === ')') {
        depth--
        if (depth === 0 && index < result.length - 1) { enclosesWholeExpression = false; break }
      }
    }
    if (!enclosesWholeExpression || depth !== 0 || quote !== null) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function unquoteSqlIdentifier(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/""/g, '"')
  if (value.startsWith('`') && value.endsWith('`')) return value.slice(1, -1).replace(/``/g, '`')
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replace(/\]\]/g, ']')
  return value
}

function predicateFromIndexSql(indexSql: string | null): string | null {
  if (!indexSql) return null
  const where = indexSql.match(/\bWHERE\b([\s\S]*)$/i)
  return where ? stripOuterSqlParentheses(where[1].trim().replace(/;\s*$/, '')) : null
}

function isExactActivePredicate(indexSql: string | null): boolean {
  const predicate = predicateFromIndexSql(indexSql)
  if (!predicate) return false
  const equality = predicate.match(/^([A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])\s*=\s*('(?:[^']|'')*')$/)
  if (!equality) return false
  return unquoteSqlIdentifier(equality[1]).toLowerCase() === 'status'
    && equality[2].slice(1, -1).replace(/''/g, "'") === 'active'
}

function isExactOperationPredicate(indexSql: string | null): boolean {
  const predicate = predicateFromIndexSql(indexSql)
  if (!predicate) return false
  const match = predicate.match(/^([A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])\s+IS\s+NOT\s+NULL$/i)
  return Boolean(match && unquoteSqlIdentifier(match[1]).toLowerCase() === 'operation_id')
}

async function tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
  return (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}`.execute(db)).rows.length === 1
}

async function inspectExecutionLifecycleSchema(db: Kysely<any>): Promise<TableContract> {
  const eventsPresent = await tableExists(db, 'execution_events')
  const locksPresent = await tableExists(db, 'execution_locks')
  if (!eventsPresent && !locksPresent) return { present: false, valid: false, detail: 'execution lifecycle tables are absent' }
  if (!eventsPresent || !locksPresent) return { present: true, valid: false, detail: 'only one execution lifecycle table is present' }

  type ColumnRow = { name: string; notnull: number; pk: number }
  type IndexRow = { name: string; unique: number }
  const events = (await sql<ColumnRow>`PRAGMA table_info(execution_events)`.execute(db)).rows
  const locks = (await sql<ColumnRow>`PRAGMA table_info(execution_locks)`.execute(db)).rows
  const exactColumns = (actual: ColumnRow[], expected: Array<[string, number, number]>) => (
    actual.length === expected.length
    && actual.every((column, index) => column.name === expected[index][0]
      && Number(column.notnull) === expected[index][1]
      && Number(column.pk) === expected[index][2])
  )
  const eventsValid = exactColumns(events, [
    ['id', 0, 1], ['execution_id', 1, 0], ['project_id', 1, 0],
    ['event_type', 1, 0], ['outcome', 0, 0], ['occurred_at', 1, 0],
    ['process_instance_id', 1, 0], ['safe_code', 0, 0], ['safe_message', 1, 0],
    ['execution_plan_hash', 1, 0],
  ])
  const locksValid = exactColumns(locks, [
    ['project_id', 1, 1], ['execution_id', 1, 0], ['process_instance_id', 1, 0],
    ['acquired_at', 1, 0], ['last_heartbeat_at', 1, 0],
  ])

  const eventIndexes = (await sql<IndexRow>`PRAGMA index_list(execution_events)`.execute(db)).rows
  const lockIndexes = (await sql<IndexRow>`PRAGMA index_list(execution_locks)`.execute(db)).rows
  const indexColumns = async (name: string): Promise<string[]> => (
    await sql<{ name: string }>`SELECT name FROM pragma_index_info(${name}) ORDER BY seqno`.execute(db)
  ).rows.map(row => row.name)
  const hasIndex = async (indexes: IndexRow[], columns: string[], unique: boolean, requiredName?: string) => {
    for (const index of indexes) {
      if (requiredName && index.name !== requiredName) continue
      const names = await indexColumns(index.name)
      if (Number(index.unique) === Number(unique)
        && names.length === columns.length
        && names.every((name, position) => name === columns[position])) return true
    }
    return false
  }
  const indexesValid = await hasIndex(eventIndexes, ['execution_id', 'event_type'], true)
    && await hasIndex(eventIndexes, ['project_id', 'execution_id'], false, 'idx_execution_project_identity')
    && await hasIndex(lockIndexes, ['execution_id'], true)
  const valid = eventsValid && locksValid && indexesValid
  return {
    present: true,
    valid,
    detail: valid
      ? 'execution lifecycle tables match the Migration 020 contract'
      : 'execution lifecycle tables do not match the exact column/key/index contract',
  }
}

async function inspectExecutionIdentitySchema(db: Kysely<any>): Promise<TableContract> {
  const expectedTables = ['executions', 'execution_items']
  const present = await Promise.all(expectedTables.map(name => tableExists(db, name)))
  const runColumns = await tableExists(db, 'runs')
    ? new Set((await sql<{ name: string }>`PRAGMA table_info(runs)`.execute(db)).rows.map(row => row.name)) : new Set<string>()
  const resultColumns = await tableExists(db, 'test_results')
    ? new Set((await sql<{ name: string }>`PRAGMA table_info(test_results)`.execute(db)).rows.map(row => row.name)) : new Set<string>()
  const anyPresent = present.some(Boolean)
    || ['execution_id', 'origin', 'attempt_ordinal'].some(name => runColumns.has(name))
    || ['result_id', 'execution_item_ordinal', 'definition_id', 'executable_plan_hash'].some(name => resultColumns.has(name))
  if (!anyPresent) return { present: false, valid: false, detail: 'execution identity schema is absent' }
  if (!present.every(Boolean)) return { present: true, valid: false, detail: 'only part of the execution identity schema is present' }

  type IdentityColumn = { name: string; notnull: number; pk: number }
  const columns = async (table: string) => (await sql<IdentityColumn>`SELECT name, "notnull", pk FROM pragma_table_info(${table}) ORDER BY cid`.execute(db)).rows
  const exactColumns = (actual: IdentityColumn[], expected: Array<[string, number, number]>) => actual.length === expected.length
    && actual.every((column, index) => column.name === expected[index][0]
      && Number(column.notnull) === expected[index][1] && Number(column.pk) === expected[index][2])
  const executionColumns = await columns('executions')
  const legacyExecutionsValid = exactColumns(executionColumns, [
    ['execution_id', 1, 1], ['project_id', 1, 0], ['accepted_at', 1, 0],
    ['test_set_id', 1, 0], ['test_set_revision', 1, 0], ['model_row_id', 1, 0],
    ['model_version', 1, 0], ['source_observation_id', 1, 0], ['manifest_hash', 1, 0],
    ['max_run_attempts', 1, 0], ['dispatch_mode', 1, 0], ['stop_rule', 1, 0],
  ])
  const canonicalV2ExecutionsValid = exactColumns(executionColumns, [
    ['execution_id', 1, 1], ['project_id', 1, 0], ['accepted_at', 1, 0],
    ['test_set_id', 1, 0], ['test_set_revision', 1, 0], ['definition_schema_version', 1, 0],
    ['model_row_id', 1, 0], ['model_version', 1, 0], ['source_observation_id', 0, 0],
    ['support_seal_hash', 0, 0], ['route_evidence_identity_hash', 0, 0],
    ['authentication_expectation_identity_hash', 0, 0], ['manifest_hash', 1, 0],
    ['max_run_attempts', 1, 0], ['dispatch_mode', 1, 0], ['stop_rule', 1, 0],
  ])
  const executionsValid = legacyExecutionsValid || canonicalV2ExecutionsValid
  const itemsValid = exactColumns(await columns('execution_items'), [
    ['execution_id', 1, 1], ['item_ordinal', 1, 2],
    ['definition_id', 1, 0], ['executable_plan_hash', 1, 0],
  ])
  const runsValid = ['execution_id', 'origin', 'attempt_ordinal'].every(name => runColumns.has(name))
  const resultsValid = ['result_id', 'execution_item_ordinal', 'definition_id', 'executable_plan_hash'].every(name => resultColumns.has(name))
  const requiredIndexes = new Set((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'index'`.execute(db)).rows.map(row => row.name))
  const indexesValid = [
    'idx_executions_project_accepted', 'uq_execution_started', 'uq_execution_terminal',
    'idx_execution_project_identity', 'uq_runs_execution_attempt',
    'uq_results_result_id', 'uq_results_run_manifest_item',
  ].every(name => requiredIndexes.has(name))
  const triggers = new Set((await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'trigger'`.execute(db)).rows.map(row => row.name))
  const triggersValid = [
    'validate_product_result_insert', 'validate_product_result_update',
    'validate_execution_event_insert', 'validate_execution_event_update',
    'validate_execution_lock_insert', 'execution_lock_identity_immutable', 'validate_product_run_insert',
    'prevent_product_fields_on_legacy_result_insert', 'prevent_missing_product_result_provenance_update',
    'product_result_identity_immutable', 'run_execution_linkage_immutable',
    'executions_immutable_update', 'executions_immutable_delete',
    'execution_events_immutable_update', 'execution_events_immutable_delete',
    'execution_items_immutable_update', 'execution_items_immutable_delete',
  ].every(name => triggers.has(name))
  const foreignKeys = async (table: string) => (await sql<{ table: string }>`SELECT "table" FROM pragma_foreign_key_list(${table})`.execute(db)).rows.map(row => row.table)
  const foreignKeysValid = (await foreignKeys('execution_items')).includes('executions')
    && (await foreignKeys('execution_events')).includes('executions')
    && (await foreignKeys('execution_locks')).includes('executions')
    && (await foreignKeys('runs')).includes('executions')
    && (await foreignKeys('test_results')).includes('runs')
  const valid = executionsValid && itemsValid && runsValid && resultsValid
    && indexesValid && triggersValid && foreignKeysValid
  return { present: true, valid, detail: valid
    ? 'execution identity, manifest, and linkage schema matches the Migration 021 contract'
    : 'execution identity, manifest, or linkage schema does not match the exact Migration 021 contract' }
}

async function inspectCanonicalV2ExecutionAuthoritySchema(db: Kysely<any>): Promise<TableContract> {
  if (!await tableExists(db, 'executions')) return { present: false, valid: false, detail: 'canonical v2 execution authority schema is absent' }
  const columns = new Map((await sql<{ name: string; notnull: number }>`PRAGMA table_info(executions)`.execute(db)).rows
    .map(row => [row.name, Number(row.notnull)]))
  const required = [
    ['definition_schema_version', 1], ['source_observation_id', 0], ['support_seal_hash', 0],
    ['route_evidence_identity_hash', 0], ['authentication_expectation_identity_hash', 0],
  ] as const
  const present = columns.has('definition_schema_version')
    || columns.has('support_seal_hash')
    || columns.has('route_evidence_identity_hash')
    || columns.has('authentication_expectation_identity_hash')
  const valid = required.every(([name, notnull]) => columns.get(name) === notnull)
  return { present, valid, detail: valid
    ? 'execution roots carry discriminated v1/v2 authority identity'
    : 'execution roots do not match the canonical v2 authority contract' }
}

async function inspectProductEvidenceGuards(db: Kysely<any>): Promise<TableContract> {
  const required = [
    'product_result_immutable_update',
    'product_result_immutable_delete',
    'product_run_admission_immutable',
    'product_run_immutable_delete',
  ]
  const present = new Set((await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'trigger'
  `.execute(db)).rows.map(row => row.name))
  const count = required.filter(name => present.has(name)).length
  return {
    present: count > 0,
    valid: count === required.length,
    detail: count === required.length
      ? 'Product Run/Result immutability guards match the Migration 022 contract'
      : `only ${count} of ${required.length} Product evidence guards are present`,
  }
}

async function inspectProductCancellationSchema(db: Kysely<any>): Promise<TableContract> {
  if (!await tableExists(db, 'execution_events')) {
    return { present: false, valid: false, detail: 'execution_events is absent' }
  }
  const columns = await sql<{ name: string; notnull: number }>`PRAGMA table_info(execution_events)`.execute(db)
  const lifecycle = columns.rows.find(column => column.name === 'lifecycle')
  const definition = await sql<{ sql: string | null }>`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_execution_cancellation_requested'
  `.execute(db)
  const trigger = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'validate_execution_event_lifecycle_insert'
  `.execute(db)
  const indexList = await sql<{ name: string; unique: number; partial: number }>`PRAGMA index_list(execution_events)`.execute(db)
  const index = indexList.rows.find(row => row.name === 'uq_execution_cancellation_requested')
  const indexColumns = index
    ? (await sql<{ name: string }>`SELECT name FROM pragma_index_info('uq_execution_cancellation_requested') ORDER BY seqno`.execute(db)).rows
    : []
  const predicate = definition.rows[0]?.sql ? predicateFromIndexSql(definition.rows[0].sql) : null
  const valid = Boolean(lifecycle && Number(lifecycle.notnull) === 0
    && index && Number(index.unique) === 1 && Number(index.partial) === 1
    && indexColumns.length === 1 && indexColumns[0].name === 'execution_id'
    && predicate === "event_type = 'cancellation_requested'"
    && trigger.rows.length === 1)
  const present = Boolean(lifecycle || index || trigger.rows.length > 0)
  return {
    present,
    valid,
    detail: valid
      ? 'Product cancellation event lifecycle and uniqueness match the Migration 023 contract'
      : 'Product cancellation event lifecycle or uniqueness does not match the Migration 023 contract',
  }
}

async function inspectCanonicalObservationSchema(db: Kysely<any>): Promise<TableContract> {
  const requiredTables = [
    'observation_runs',
    'observations',
    'observation_gaps',
    'observation_artifacts',
    'observation_artifact_links',
    'app_model_observation_support',
    'app_model_subject_support',
    'app_model_gap_support',
    'app_model_support_seals',
  ]
  const requiredIndexes = [
    'idx_observations_run_captured',
    'idx_observations_subject_predicate',
    'idx_gaps_run_occurred',
    'idx_model_observation_support_source',
    'idx_model_subject_support_subject',
    'idx_model_gap_support_source',
  ]
  const requiredTriggers = [
    'observation_run_terminalize_once',
    'observation_artifact_links_closed_insert',
    'observations_immutable_update',
    'observations_immutable_delete',
    'observation_gaps_immutable_update',
    'app_model_observation_support_immutable_update',
    'app_model_subject_support_immutable_update',
    'app_model_gap_support_immutable_update',
    'app_model_support_seals_immutable_update',
    'app_model_observation_support_closed_insert',
    'app_model_subject_support_closed_insert',
    'app_model_gap_support_closed_insert',
    'validate_app_model_observation_support_project',
    'validate_app_model_subject_support_project',
    'validate_app_model_gap_support_project',
  ]
  const rows = await sql<{ type: string; name: string }>`
    SELECT type, name FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger')
  `.execute(db)
  const names = new Set(rows.rows.map(row => `${row.type}:${row.name}`))
  const tableCount = requiredTables.filter(name => names.has(`table:${name}`)).length
  const indexCount = requiredIndexes.filter(name => names.has(`index:${name}`)).length
  const triggerCount = requiredTriggers.filter(name => names.has(`trigger:${name}`)).length
  const present = tableCount + indexCount + triggerCount > 0
  const valid = tableCount === requiredTables.length
    && indexCount === requiredIndexes.length
    && triggerCount === requiredTriggers.length
  return {
    present,
    valid,
    detail: valid
      ? 'canonical Observation authority tables, indexes, and guards match the Migration 024 contract'
      : `canonical Observation authority is incomplete (${tableCount}/${requiredTables.length} tables, ${indexCount}/${requiredIndexes.length} indexes, ${triggerCount}/${requiredTriggers.length} guards)`,
  }
}

async function inspectHistoricalObservationImportSchema(db: Kysely<any>): Promise<TableContract> {
  const required = [
    ['table', 'observation_import_sources'],
    ['index', 'idx_observation_import_classification'],
    ['trigger', 'observation_import_sources_immutable_update'],
    ['trigger', 'observation_import_sources_immutable_delete'],
  ] as const
  const rows = await sql<{ type: string; name: string; definition: string | null }>`
    SELECT type, name, sql AS definition FROM sqlite_master
    WHERE name IN (
      'observation_import_sources', 'idx_observation_import_classification',
      'observation_import_sources_immutable_update', 'observation_import_sources_immutable_delete',
      'observations'
    )
  `.execute(db)
  const identities = new Set(rows.rows.map(row => `${row.type}:${row.name}`))
  const observationDefinition = rows.rows.find(row => row.type === 'table' && row.name === 'observations')?.definition ?? ''
  const presentCount = required.filter(([type, name]) => identities.has(`${type}:${name}`)).length
  const provenanceValid = /legacy_direct/i.test(observationDefinition)
    && /legacy_reconstructed/i.test(observationDefinition)
  const present = presentCount > 0 || provenanceValid
  const valid = presentCount === required.length && provenanceValid
  return {
    present,
    valid,
    detail: valid
      ? 'historical Observation import ledger and legacy provenance contract match Migration 025'
      : `historical Observation import authority is incomplete (${presentCount}/${required.length} objects; legacy provenance ${provenanceValid ? 'present' : 'absent'})`,
  }
}

async function inspectCanonicalTestDefinitionV2Schema(db: Kysely<any>): Promise<TableContract> {
  if (!await tableExists(db, 'test_set_revisions')) {
    return { present: false, valid: false, detail: 'test_set_revisions is absent' }
  }
  const columns = await sql<{ name: string; notnull: number }>`PRAGMA table_info(test_set_revisions)`.execute(db)
  const byName = new Map(columns.rows.map(column => [column.name, column]))
  const added = [
    'schema_version', 'observation_run_id', 'support_seal_hash',
    'characterization_policy_id', 'characterization_policy_version',
  ]
  const present = added.some(name => byName.has(name))
  if (!present) return { present: false, valid: false, detail: 'Test Definition v2 columns are absent' }
  const triggers = await sql<{ name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name IN ('test_set_revisions_immutable_update', 'test_set_revisions_immutable_delete')
  `.execute(db)
  const source = byName.get('source_observation_id')
  const valid = added.every(name => byName.has(name)) && Number(source?.notnull) === 0 && triggers.rows.length === 2
  return {
    present: true,
    valid,
    detail: valid
      ? 'versioned Test Definition authority and immutable revision guards match Migration 026'
      : 'versioned Test Definition authority columns or immutable revision guards are incomplete',
  }
}

async function appModelColumns(db: Kysely<any>): Promise<Set<string>> {
  if (!await tableExists(db, 'app_models')) return new Set()
  return new Set((await sql<{ name: string }>`PRAGMA table_info(app_models)`.execute(db)).rows.map(row => row.name))
}

async function inspectIndex(
  db: Kysely<any>,
  indexName: 'idx_models_one_active' | 'idx_models_operation_identity',
  expectedColumns: string[],
  predicateValid: (definition: string | null) => boolean,
): Promise<IndexContract> {
  const definition = await sql<{ tbl_name: string; sql: string | null }>`SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ${indexName}`.execute(db)
  if (definition.rows.length === 0) return { present: false, valid: false, detail: `${indexName} is absent` }
  const list = await sql<{ name: string; unique: number; partial: number }>`PRAGMA index_list(app_models)`.execute(db)
  const listed = list.rows.find(row => row.name === indexName)
  const xinfo = indexName === 'idx_models_one_active'
    ? await sql<{ cid: number; name: string | null; coll: string | null; key: number }>`PRAGMA index_xinfo(idx_models_one_active)`.execute(db)
    : await sql<{ cid: number; name: string | null; coll: string | null; key: number }>`PRAGMA index_xinfo(idx_models_operation_identity)`.execute(db)
  const keyColumns = xinfo.rows.filter(row => Number(row.key) === 1)
  const names = keyColumns.map(row => row.name)
  const exactColumns = names.length === expectedColumns.length && names.every((name, index) => name === expectedColumns[index]) && keyColumns.every(row => Number(row.cid) >= 0)
  const valid = definition.rows[0].tbl_name === 'app_models' && Boolean(listed)
    && Number(listed?.unique) === 1 && Number(listed?.partial) === 1 && exactColumns
    && keyColumns.every(row => row.coll?.toUpperCase() === 'BINARY') && predicateValid(definition.rows[0].sql)
  return { present: true, valid, detail: valid ? `${indexName} matches its exact contract` : `${indexName} exists but does not match its exact table/unique/partial/column/collation/predicate contract` }
}

async function readAppliedMigrations(db: Kysely<any>): Promise<Array<{ name: string; timestamp: string }>> {
  if (!await tableExists(db, MIGRATION_TABLE)) return []
  const rows = await db.selectFrom(MIGRATION_TABLE).select(['name', 'timestamp']).execute() as Array<{ name: string; timestamp: string }>
  return rows.sort((left, right) => {
    const difference = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    return difference === 0 ? left.name.localeCompare(right.name) : difference
  })
}

async function ensureMigrationBookkeeping(db: Kysely<any>): Promise<void> {
  if (!await tableExists(db, MIGRATION_TABLE)) {
    await db.schema.createTable(MIGRATION_TABLE).addColumn('name', 'varchar(255)', column => column.notNull().primaryKey()).addColumn('timestamp', 'varchar(255)', column => column.notNull()).execute()
  }
  if (!await tableExists(db, MIGRATION_LOCK_TABLE)) {
    await db.schema.createTable(MIGRATION_LOCK_TABLE).addColumn('id', 'varchar(255)', column => column.notNull().primaryKey()).addColumn('is_locked', 'integer', column => column.notNull().defaultTo(0)).execute()
  }
  const lockRow = await db.selectFrom(MIGRATION_LOCK_TABLE).select('id').where('id', '=', MIGRATION_LOCK_ID).executeTakeFirst()
  if (!lockRow) await db.insertInto(MIGRATION_LOCK_TABLE).values({ id: MIGRATION_LOCK_ID, is_locked: 0 }).execute()
}

function assertMigrationOrder(migrationNames: string[], applied: Array<{ name: string; timestamp: string }>): void {
  for (let index = 0; index < applied.length; index++) {
    if (!migrationNames.includes(applied[index].name)) throw new MigrationStateMismatchError([`history contains '${applied[index].name}', but no matching migration file exists`])
    if (migrationNames[index] !== applied[index].name) throw new MigrationStateMismatchError([`history is not an ordered prefix: expected '${migrationNames[index] ?? '(none)'}' at position ${index + 1}, found '${applied[index].name}'`])
  }
}

async function assertManagedSchemaHistoryConsistency(db: Kysely<any>, appliedNames: Set<string>): Promise<void> {
  const migration016Applied = appliedNames.has(SINGLE_ACTIVE_MIGRATION)
  const migration017Applied = appliedNames.has(OPERATION_IDENTITY_MIGRATION)
  const columns = await appModelColumns(db)
  const activeIndex = await inspectIndex(db, 'idx_models_one_active', ['app_name'], isExactActivePredicate)
  const operationIndex = await inspectIndex(db, 'idx_models_operation_identity', ['app_name', 'operation_id'], isExactOperationPredicate)
  const executionLifecycle = await inspectExecutionLifecycleSchema(db)
  const executionIdentity = await inspectExecutionIdentitySchema(db)
  const productEvidenceGuards = await inspectProductEvidenceGuards(db)
  const productCancellation = await inspectProductCancellationSchema(db)
  const canonicalObservations = await inspectCanonicalObservationSchema(db)
  const historicalObservationImport = await inspectHistoricalObservationImportSchema(db)
  const canonicalTestDefinitionV2 = await inspectCanonicalTestDefinitionV2Schema(db)
  const canonicalV2ExecutionAuthority = await inspectCanonicalV2ExecutionAuthoritySchema(db)
  const discrepancies: string[] = []
  if (migration016Applied && !activeIndex.valid) discrepancies.push(`history says ${SINGLE_ACTIVE_MIGRATION} is applied, but ${activeIndex.detail}`)
  else if (!migration016Applied && activeIndex.present) discrepancies.push(`history says ${SINGLE_ACTIVE_MIGRATION} is pending, but ${activeIndex.detail}`)
  if (migration017Applied) {
    if (!columns.has('operation_id')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but operation_id is absent`)
    if (!columns.has('candidate_hash')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but candidate_hash is absent`)
    if (!operationIndex.valid) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is applied, but ${operationIndex.detail}`)
  } else {
    if (columns.has('operation_id')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but operation_id exists`)
    if (columns.has('candidate_hash')) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but candidate_hash exists`)
    if (operationIndex.present) discrepancies.push(`history says ${OPERATION_IDENTITY_MIGRATION} is pending, but ${operationIndex.detail}`)
  }
  if (appliedNames.has(EXECUTION_LIFECYCLE_MIGRATION)) {
    if (!appliedNames.has(EXECUTION_IDENTITY_MIGRATION) && !executionLifecycle.valid) discrepancies.push(`history says ${EXECUTION_LIFECYCLE_MIGRATION} is applied, but ${executionLifecycle.detail}`)
  } else if (executionLifecycle.present) {
    discrepancies.push(`history says ${EXECUTION_LIFECYCLE_MIGRATION} is pending, but ${executionLifecycle.detail}`)
  }
  if (appliedNames.has(EXECUTION_IDENTITY_MIGRATION)) {
    if (!executionIdentity.valid) discrepancies.push(`history says ${EXECUTION_IDENTITY_MIGRATION} is applied, but ${executionIdentity.detail}`)
  } else if (executionIdentity.present) {
    discrepancies.push(`history says ${EXECUTION_IDENTITY_MIGRATION} is pending, but ${executionIdentity.detail}`)
  }
  if (appliedNames.has(PRODUCT_EVIDENCE_GUARDS_MIGRATION)) {
    if (!productEvidenceGuards.valid) discrepancies.push(`history says ${PRODUCT_EVIDENCE_GUARDS_MIGRATION} is applied, but ${productEvidenceGuards.detail}`)
  } else if (productEvidenceGuards.present) {
    discrepancies.push(`history says ${PRODUCT_EVIDENCE_GUARDS_MIGRATION} is pending, but ${productEvidenceGuards.detail}`)
  }
  if (appliedNames.has(PRODUCT_CANCELLATION_MIGRATION)) {
    if (!productCancellation.valid) discrepancies.push(`history says ${PRODUCT_CANCELLATION_MIGRATION} is applied, but ${productCancellation.detail}`)
  } else if (productCancellation.present) {
    discrepancies.push(`history says ${PRODUCT_CANCELLATION_MIGRATION} is pending, but ${productCancellation.detail}`)
  }
  if (appliedNames.has(CANONICAL_OBSERVATION_MIGRATION)) {
    if (!canonicalObservations.valid) discrepancies.push(`history says ${CANONICAL_OBSERVATION_MIGRATION} is applied, but ${canonicalObservations.detail}`)
  } else if (canonicalObservations.present) {
    discrepancies.push(`history says ${CANONICAL_OBSERVATION_MIGRATION} is pending, but ${canonicalObservations.detail}`)
  }
  if (appliedNames.has(HISTORICAL_OBSERVATION_IMPORT_MIGRATION)) {
    if (!historicalObservationImport.valid) discrepancies.push(`history says ${HISTORICAL_OBSERVATION_IMPORT_MIGRATION} is applied, but ${historicalObservationImport.detail}`)
  } else if (historicalObservationImport.present) {
    discrepancies.push(`history says ${HISTORICAL_OBSERVATION_IMPORT_MIGRATION} is pending, but ${historicalObservationImport.detail}`)
  }
  if (appliedNames.has(CANONICAL_TEST_DEFINITION_V2_MIGRATION)) {
    if (!canonicalTestDefinitionV2.valid) discrepancies.push(`history says ${CANONICAL_TEST_DEFINITION_V2_MIGRATION} is applied, but ${canonicalTestDefinitionV2.detail}`)
  } else if (canonicalTestDefinitionV2.present) {
    discrepancies.push(`history says ${CANONICAL_TEST_DEFINITION_V2_MIGRATION} is pending, but ${canonicalTestDefinitionV2.detail}`)
  }
  if (appliedNames.has(CANONICAL_V2_EXECUTION_AUTHORITY_MIGRATION)) {
    if (!canonicalV2ExecutionAuthority.valid) discrepancies.push(`history says ${CANONICAL_V2_EXECUTION_AUTHORITY_MIGRATION} is applied, but ${canonicalV2ExecutionAuthority.detail}`)
  } else if (canonicalV2ExecutionAuthority.present) {
    discrepancies.push(`history says ${CANONICAL_V2_EXECUTION_AUTHORITY_MIGRATION} is pending, but ${canonicalV2ExecutionAuthority.detail}`)
  }
  if (discrepancies.length > 0) throw new MigrationStateMismatchError(discrepancies)
}

async function assertMigrationPostconditions(db: Kysely<any>, migrationName: string): Promise<void> {
  const history = new Set((await readAppliedMigrations(db)).map(row => row.name))
  if (!history.has(migrationName)) throw new Error(`migration-history record '${migrationName}' is absent inside the transaction`)
  if (migrationName === SINGLE_ACTIVE_MIGRATION) {
    const duplicates = await sql<{ app_name: string }>`SELECT app_name FROM app_models WHERE status = 'active' GROUP BY app_name HAVING COUNT(*) > 1 ORDER BY app_name`.execute(db)
    if (duplicates.rows.length > 0) throw new Error(`duplicate-active postcondition failed for ${duplicates.rows.map(row => row.app_name).join(', ')}`)
    const index = await inspectIndex(db, 'idx_models_one_active', ['app_name'], isExactActivePredicate)
    if (!index.valid) throw new Error(index.detail)
  }
  if (migrationName === OPERATION_IDENTITY_MIGRATION) {
    const columns = await appModelColumns(db)
    if (!columns.has('operation_id') || !columns.has('candidate_hash')) throw new Error('operation_id and candidate_hash columns are not both present')
    const index = await inspectIndex(db, 'idx_models_operation_identity', ['app_name', 'operation_id'], isExactOperationPredicate)
    if (!index.valid) throw new Error(index.detail)
  }
  if (migrationName === EXECUTION_LIFECYCLE_MIGRATION) {
    const executionLifecycle = await inspectExecutionLifecycleSchema(db)
    if (!executionLifecycle.valid) throw new Error(executionLifecycle.detail)
  }
  if (migrationName === EXECUTION_IDENTITY_MIGRATION) {
    const executionIdentity = await inspectExecutionIdentitySchema(db)
    if (!executionIdentity.valid) throw new Error(executionIdentity.detail)
    const orphanEvents = await sql<{ count: number }>`SELECT COUNT(*) AS count FROM execution_events e LEFT JOIN executions x ON x.execution_id = e.execution_id WHERE x.execution_id IS NULL`.execute(db)
    const orphanLocks = await sql<{ count: number }>`SELECT COUNT(*) AS count FROM execution_locks l LEFT JOIN executions x ON x.execution_id = l.execution_id WHERE x.execution_id IS NULL`.execute(db)
    if (Number(orphanEvents.rows[0].count) !== 0 || Number(orphanLocks.rows[0].count) !== 0) throw new Error('execution lifecycle rows are not fully linked to execution roots')
  }
  if (migrationName === PRODUCT_EVIDENCE_GUARDS_MIGRATION) {
    const guards = await inspectProductEvidenceGuards(db)
    if (!guards.valid) throw new Error(guards.detail)
  }
  if (migrationName === PRODUCT_CANCELLATION_MIGRATION) {
    const cancellation = await inspectProductCancellationSchema(db)
    if (!cancellation.valid) throw new Error(cancellation.detail)
  }
  if (migrationName === CANONICAL_OBSERVATION_MIGRATION) {
    const observations = await inspectCanonicalObservationSchema(db)
    if (!observations.valid) throw new Error(observations.detail)
  }
  if (migrationName === HISTORICAL_OBSERVATION_IMPORT_MIGRATION) {
    const historicalImport = await inspectHistoricalObservationImportSchema(db)
    if (!historicalImport.valid) throw new Error(historicalImport.detail)
  }
  if (migrationName === CANONICAL_TEST_DEFINITION_V2_MIGRATION) {
    const definitions = await inspectCanonicalTestDefinitionV2Schema(db)
    if (!definitions.valid) throw new Error(definitions.detail)
  }
  if (migrationName === CANONICAL_V2_EXECUTION_AUTHORITY_MIGRATION) {
    const executions = await inspectCanonicalV2ExecutionAuthoritySchema(db)
    if (!executions.valid) throw new Error(executions.detail)
  }
}

export async function runSqliteMigrationCoordinator(db: Kysely<any>, migrations: Record<string, ForgeMigration>, beforePending?: () => Promise<unknown>): Promise<string[]> {
  const authority = getDatabaseProvenance()
  if (authority.dialect !== 'sqlite') {
    throw new DatabaseAuthorityError(
      'DATABASE_AUTHORITY_CONFLICT',
      'The atomic SQLite migration coordinator cannot run against a non-SQLite authority.',
    )
  }
  if (authority.legacyImportAllowed
    && (!authority.legacyImportRoot || path.resolve(process.cwd()) !== authority.legacyImportRoot)) {
    throw new DatabaseAuthorityError(
      'LEGACY_IMPORT_CONTEXT_CHANGED',
      'Legacy Migration 004 import root changed after database authority was established.',
    )
  }
  await ensureMigrationBookkeeping(db)
  const migrationNames = Object.keys(migrations).sort()
  let applied = await readAppliedMigrations(db)
  assertMigrationOrder(migrationNames, applied)
  await assertManagedSchemaHistoryConsistency(db, new Set(applied.map(row => row.name)))
  const pending = migrationNames.slice(applied.length)
  if (pending.length === 0) return []
  if (beforePending) await beforePending()
  const completed: string[] = []
  for (const migrationName of pending) {
    await db.connection().execute(async connection => {
      let transactionOpen = false
      try {
        await sql.raw('BEGIN IMMEDIATE').execute(connection)
        transactionOpen = true
        const currentApplied = await readAppliedMigrations(connection)
        assertMigrationOrder(migrationNames, currentApplied)
        await assertManagedSchemaHistoryConsistency(connection, new Set(currentApplied.map(row => row.name)))
        if (currentApplied.length !== applied.length) throw new MigrationStateMismatchError([`migration history changed after coordinator preflight; expected ${applied.length} rows, found ${currentApplied.length}`])
        const migration = migrationName === LEGACY_JSON_IMPORT_MIGRATION
          && !authority.legacyImportAllowed
          ? { up: async (_db: Kysely<any>) => undefined }
          : migrations[migrationName]
        await runWithMigrationContext(authority, () => migration.up(connection))
        await connection.insertInto(MIGRATION_TABLE).values({ name: migrationName, timestamp: new Date().toISOString() }).execute()
        await assertMigrationPostconditions(connection, migrationName)
        await sql.raw('COMMIT').execute(connection)
        transactionOpen = false
      } catch (cause) {
        let rollbackFailure: unknown
        if (transactionOpen) try { await sql.raw('ROLLBACK').execute(connection) } catch (error) { rollbackFailure = error }
        const message = cause instanceof Error ? cause.message : String(cause)
        const rollback = rollbackFailure ? ` Rollback also failed: ${rollbackFailure instanceof Error ? rollbackFailure.message : String(rollbackFailure)}.` : ''
        throw new AtomicMigrationError(migrationName, `${message}${rollback}`, { cause })
      }
    })
    completed.push(migrationName)
    applied = [...applied, { name: migrationName, timestamp: new Date().toISOString() }]
  }
  return completed
}

interface SqliteBackupSummary {
  quickCheck: string
  schema: Array<{ name: string; sql: string | null }>
  rowCounts: Array<{ name: string; count: number }>
  migrations: string[]
}

function inspectSqliteBackup(dbPath: string): SqliteBackupSummary {
  const BetterSqlite3 = require('better-sqlite3')
  const sqlite = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    const quickCheck = String(sqlite.pragma('quick_check', { simple: true }))
    const schema = sqlite.prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all() as Array<{ name: string; sql: string | null }>
    const rowCounts = schema.map(({ name }) => {
      const quoted = `"${name.replace(/"/g, '""')}"`
      const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get() as { count: number }
      return { name, count: Number(row.count) }
    })
    const migrations = schema.some(table => table.name === 'kysely_migration')
      ? (sqlite.prepare('SELECT name FROM kysely_migration ORDER BY name').all() as Array<{ name: string }>).map(row => row.name)
      : []
    return { quickCheck, schema, rowCounts, migrations }
  } finally {
    sqlite.close()
  }
}

async function createVerifiedBackupBefore016(db: any): Promise<string | null> {
  if (getDatabaseProvenance().dialect !== 'sqlite') return null

  let applied: string[]
  try {
    const rows = await db.selectFrom('kysely_migration').select('name').orderBy('name').execute()
    applied = rows.map((row: { name: string }) => row.name)
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('no such table: kysely_migration')) return null
    throw new Error('[migration] Could not inspect migration history before backup.', { cause })
  }

  if (!applied.includes('015_app_models_crawled_by_nullable') || applied.includes(SINGLE_ACTIVE_MIGRATION)) {
    return null
  }

  const dbPath = getOpenSqlitePath()
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith('file:')) return null

  const sourceBefore = inspectSqliteBackup(dbPath)
  if (sourceBefore.quickCheck !== 'ok') {
    throw new Error(`[migration] Refusing migration 016: source SQLite quick_check returned '${sourceBefore.quickCheck}'.`)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${dbPath}.pre-016-${stamp}.bak`
  if (fs.existsSync(backupPath)) {
    throw new Error(`[migration] Refusing to overwrite existing backup: ${backupPath}`)
  }

  await sql`VACUUM INTO ${backupPath}`.execute(db)

  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error(`[migration] Backup was not created correctly: ${backupPath}`)
  }

  const backup = inspectSqliteBackup(backupPath)
  const sourceSignature = JSON.stringify({ schema: sourceBefore.schema, rowCounts: sourceBefore.rowCounts, migrations: sourceBefore.migrations })
  const backupSignature = JSON.stringify({ schema: backup.schema, rowCounts: backup.rowCounts, migrations: backup.migrations })
  if (backup.quickCheck !== 'ok' || backupSignature !== sourceSignature) {
    throw new Error(`[migration] Backup verification failed; original database was not migrated. Backup: ${backupPath}`)
  }

  console.log(`[migration] Verified pre-016 backup: ${backupPath}`)
  return backupPath
}
async function runKyselyMigrations(
  db: any,
  migrationsDir: string,
  authority: ActiveDatabaseProvenance,
): Promise<void> {
  const migrator = new Migrator({ db, provider: new TsxMigrationProvider(migrationsDir, authority) });
  const { error, results } = (await migrator.migrateToLatest()) as { error: unknown; results: Array<{ migrationName: string; status: 'Success' | 'Error' | 'NotMigrated' }> };
  if (results && results.length > 0) for (const result of results) {
    if (result.status === 'Success') console.log(`[migration] SUCCESS ${result.migrationName}`);
    else if (result.status === 'Error') console.error(`[migration] ERROR ${result.migrationName}`);
  }
  else console.log('[migration] Already up to date.');
  if (error) { console.error('[migration] Fatal error:', error); throw error; }
}

export async function runMigrations(): Promise<void> {
  let authority: ActiveDatabaseProvenance
  try {
    authority = getDatabaseProvenance()
  } catch (cause) {
    if (!(cause instanceof DatabaseAuthorityError) || cause.code !== 'DATABASE_AUTHORITY_REQUIRED') throw cause
    // Compatibility callers that have not yet adopted a named initializer are
    // contained as LEGACY_RUNTIME by getDb(); they can never become Product.
    getDb()
    authority = getDatabaseProvenance()
  }
  if (authority.legacyImportAllowed
    && (!authority.legacyImportRoot || path.resolve(process.cwd()) !== authority.legacyImportRoot)) {
    throw new DatabaseAuthorityError(
      'LEGACY_IMPORT_CONTEXT_CHANGED',
      'Legacy Migration 004 import root changed after database authority was established.',
    )
  }
  const db = getDb();
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (authority.dialect === 'postgres') {
    if (authority.authorityMode !== DatabaseAuthorityMode.LEGACY_RUNTIME
      || authority.migrationCeiling !== LEGACY_POSTGRES_MIGRATION_CEILING) {
      throw new DatabaseAuthorityError(
        'DATABASE_AUTHORITY_CONFLICT',
        'PostgreSQL is not an eligible Product or disposable database authority.',
      )
    }
    await runKyselyMigrations(db, migrationsDir, authority)
    return
  }
  const migrations = await new TsxMigrationProvider(migrationsDir, authority).getMigrations()
  const completed = await runSqliteMigrationCoordinator(db, migrations, () => createVerifiedBackupBefore016(db))
  if (completed.length === 0) console.log('[migration] Already up to date.');
  else for (const migrationName of completed) console.log(`[migration] SUCCESS ${migrationName}`)
}

// ── CLI entry-point ───────────────────────────────────────────────────────────
if (require.main === module) {
  initLegacyRuntimeDatabase()
  runMigrations()
    .then(() => {
      console.log('[migration] Done.');
      return closeDb();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[migration] Unhandled error:', err);
      process.exit(1);
    });
}
