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

import * as crypto from 'crypto'
import { Kysely, sql } from 'kysely'
import { routeEvidenceIdentity } from '../../execution/ExecutionProjectionService'
import { suiteHash, type CanonicalSuiteRevision } from '../../suites/SuiteContract'
import {
  parseCanonicalTestSet,
  type CanonicalTestDefinitionV1,
  type CanonicalTestDefinitionV2,
  type CanonicalTestDefinitionV3,
  type CanonicalTestSetV1,
  type CanonicalTestSetV2,
  type CanonicalTestSetV3,
} from '../../test-design/TestDefinitionContract'
import { currentMigrationDialect } from '../MigrationContext'

interface TriggerDefinition { name: string; sql: string }
interface SuspendedTable { name: string; createSql: string; indexSql: string[]; rows: any[] }

const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function manifestHash(items: any[]): string {
  const hashes = items.map(item => item.executable_plan_hash)
  return hashes.length === 1 ? hashes[0] : digest({ schemaVersion: 1, planFingerprints: hashes })
}

function routeSelectionHash(hashes: string[]): string {
  return hashes.length === 1 ? hashes[0] : digest({ schemaVersion: 2, routeEvidenceIdentityHashes: hashes })
}

function authenticationIdentity(definition: CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3): string | null {
  return definition.authenticationExpectation ? digest({
    schemaVersion: 'forge-authentication-expectation/v1',
    state: definition.authenticationExpectation.state,
    mechanism: definition.authenticationExpectation.mechanism,
    bases: definition.authenticationExpectation.bases,
  }) : null
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error(`Migration 035 found malformed ${label}.`)
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Migration 035 found malformed ${label}.`)
}

async function captureTables(db: Kysely<any>, names: string[]): Promise<SuspendedTable[]> {
  const captured: SuspendedTable[] = []
  for (const name of names) {
    const table = (await sql<{ sql: string }>`SELECT sql FROM sqlite_master WHERE type='table' AND name=${name}`.execute(db)).rows[0]
    if (!table?.sql) continue
    const escaped = name.replace(/"/g, '""')
    const rows = (await sql.raw<any>(`SELECT * FROM "${escaped}"`).execute(db)).rows
    const indexSql = (await sql<{ sql: string | null }>`SELECT sql FROM sqlite_master
      WHERE type='index' AND tbl_name=${name} AND sql IS NOT NULL ORDER BY name`.execute(db)).rows
      .map(index => index.sql).filter((value): value is string => value !== null)
    captured.push({ name, createSql: table.sql, indexSql, rows })
  }
  return captured
}

async function dropCapturedTables(db: Kysely<any>, captured: SuspendedTable[]): Promise<void> {
  for (const table of captured) {
    await sql.raw(`DROP TABLE "${table.name.replace(/"/g, '""')}"`).execute(db)
  }
}

async function restoreCapturedTables(db: Kysely<any>, captured: SuspendedTable[], order: string[]): Promise<void> {
  const byName = new Map(captured.map(table => [table.name, table]))
  for (const name of order) {
    const table = byName.get(name)
    if (!table) continue
    await sql.raw(table.createSql).execute(db)
    for (let offset = 0; offset < table.rows.length; offset += 50) {
      await db.insertInto(name as any).values(table.rows.slice(offset, offset + 50)).execute()
    }
    for (const index of table.indexSql) await sql.raw(index).execute(db)
  }
}

const REPLACED_TRIGGERS = new Set([
  'suite_revisions_immutable_update', 'suite_revisions_immutable_delete',
  'suite_revision_members_immutable_update', 'suite_revision_members_immutable_delete',
  'execution_suite_authority_insert', 'execution_suite_authority_match_insert',
])

export const MIGRATION_035_TRIGGER_DEFINITIONS_V1 = Object.freeze({
  suite_revisions_immutable_update: `CREATE TRIGGER suite_revisions_immutable_update BEFORE UPDATE ON suite_revisions BEGIN SELECT RAISE(ABORT,'Suite revision authority is immutable'); END`,
  suite_revisions_immutable_delete: `CREATE TRIGGER suite_revisions_immutable_delete BEFORE DELETE ON suite_revisions BEGIN SELECT RAISE(ABORT,'Suite revision authority is immutable'); END`,
  suite_revision_members_immutable_update: `CREATE TRIGGER suite_revision_members_immutable_update BEFORE UPDATE ON suite_revision_members BEGIN SELECT RAISE(ABORT,'Suite revision authority is immutable'); END`,
  suite_revision_members_immutable_delete: `CREATE TRIGGER suite_revision_members_immutable_delete BEFORE DELETE ON suite_revision_members BEGIN SELECT RAISE(ABORT,'Suite revision authority is immutable'); END`,
  suite_member_authority_validate_insert: `CREATE TRIGGER suite_member_authority_validate_insert BEFORE INSERT ON suite_revision_member_authorities WHEN
    NOT EXISTS (SELECT 1 FROM suite_revisions r JOIN suite_revision_members m ON m.suite_id=r.suite_id AND m.suite_revision=r.revision
      JOIN test_set_revisions t ON t.id=NEW.test_set_row_id
      WHERE r.suite_id=NEW.suite_id AND r.revision=NEW.suite_revision AND r.suite_schema_version IN (1,2)
        AND m.member_ordinal=NEW.member_ordinal AND m.definition_id=NEW.definition_id
        AND t.project_id=r.project_id AND t.test_set_id=NEW.test_set_id AND t.revision=NEW.test_set_revision
        AND t.content_hash=NEW.test_set_content_hash AND t.schema_version=NEW.definition_schema_version
        AND (SELECT COUNT(*) FROM json_each(t.payload_json,'$.definitions') d WHERE json_extract(d.value,'$.id')=NEW.definition_id)=1
        AND (r.suite_schema_version=2 OR (r.test_set_row_id=NEW.test_set_row_id AND r.test_set_id=NEW.test_set_id
          AND r.test_set_revision=NEW.test_set_revision AND r.test_set_content_hash=NEW.test_set_content_hash
          AND r.definition_schema_version=NEW.definition_schema_version)))
    BEGIN SELECT RAISE(ABORT,'Suite member authority mismatch'); END`,
  suite_member_authority_immutable_update: `CREATE TRIGGER suite_member_authority_immutable_update BEFORE UPDATE ON suite_revision_member_authorities BEGIN SELECT RAISE(ABORT,'Suite member authority is immutable'); END`,
  suite_member_authority_immutable_delete: `CREATE TRIGGER suite_member_authority_immutable_delete BEFORE DELETE ON suite_revision_member_authorities BEGIN SELECT RAISE(ABORT,'Suite member authority is immutable'); END`,
  execution_scope_validate_insert: `CREATE TRIGGER execution_scope_validate_insert BEFORE INSERT ON executions WHEN NOT (
    (NEW.test_set_authority_scope='single' AND NEW.test_set_id IS NOT NULL AND NEW.test_set_revision IS NOT NULL
      AND NEW.test_set_revision>0 AND NEW.definition_schema_version IN (1,2,3)
      AND NEW.model_row_id>0 AND NEW.model_version IS NOT NULL
      AND ((NEW.definition_schema_version=1 AND NEW.source_observation_id IS NOT NULL
        AND NEW.support_seal_hash IS NULL AND NEW.route_evidence_identity_hash IS NULL
        AND NEW.authentication_expectation_identity_hash IS NULL)
      OR (NEW.definition_schema_version IN (2,3) AND NEW.source_observation_id IS NULL
        AND NEW.support_seal_hash IS NOT NULL AND length(NEW.support_seal_hash)=64 AND NEW.support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND NEW.route_evidence_identity_hash IS NOT NULL AND length(NEW.route_evidence_identity_hash)=64 AND NEW.route_evidence_identity_hash NOT GLOB '*[^a-f0-9]*'
        AND NEW.authentication_expectation_identity_hash IS NOT NULL AND length(NEW.authentication_expectation_identity_hash)=64 AND NEW.authentication_expectation_identity_hash NOT GLOB '*[^a-f0-9]*')))
    OR
    (NEW.test_set_authority_scope='per_item' AND NEW.suite_id IS NOT NULL
      AND NEW.test_set_id IS NULL AND NEW.test_set_revision IS NULL AND NEW.definition_schema_version IS NULL
      AND NEW.model_row_id IS NULL AND NEW.model_version IS NULL AND NEW.source_observation_id IS NULL
      AND NEW.support_seal_hash IS NULL AND NEW.route_evidence_identity_hash IS NULL
      AND NEW.authentication_expectation_identity_hash IS NULL))
    BEGIN SELECT RAISE(ABORT,'Execution Test Set authority scope is invalid'); END`,
  execution_suite_authority_insert: `CREATE TRIGGER execution_suite_authority_insert BEFORE INSERT ON executions
    WHEN ((NEW.suite_id IS NULL)+(NEW.suite_revision IS NULL)+(NEW.suite_content_hash IS NULL)) NOT IN (0,3)
    BEGIN SELECT RAISE(ABORT,'Execution Suite authority must be wholly present or absent'); END`,
  execution_suite_authority_match_insert: `CREATE TRIGGER execution_suite_authority_match_insert BEFORE INSERT ON executions WHEN NEW.suite_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suite_revisions r WHERE r.suite_id=NEW.suite_id AND r.revision=NEW.suite_revision AND r.project_id=NEW.project_id
      AND r.content_hash=NEW.suite_content_hash
      AND ((r.suite_schema_version=1 AND NEW.test_set_authority_scope='single' AND r.test_set_id=NEW.test_set_id
        AND r.test_set_revision=NEW.test_set_revision AND r.definition_schema_version=NEW.definition_schema_version)
        OR (r.suite_schema_version=2 AND NEW.test_set_authority_scope='per_item')))
    BEGIN SELECT RAISE(ABORT,'Execution Suite authority mismatch'); END`,
  execution_item_authority_validate_insert: `CREATE TRIGGER execution_item_authority_validate_insert BEFORE INSERT ON execution_item_authorities WHEN
    NOT EXISTS (SELECT 1 FROM executions e JOIN execution_items i ON i.execution_id=e.execution_id
      JOIN test_set_revisions t ON t.id=NEW.test_set_row_id
      WHERE e.execution_id=NEW.execution_id AND i.item_ordinal=NEW.item_ordinal AND i.definition_id=NEW.definition_id
        AND t.project_id=e.project_id AND t.test_set_id=NEW.test_set_id AND t.revision=NEW.test_set_revision
        AND t.content_hash=NEW.test_set_content_hash AND t.schema_version=NEW.definition_schema_version
        AND (SELECT COUNT(*) FROM json_each(t.payload_json,'$.definitions') d WHERE json_extract(d.value,'$.id')=NEW.definition_id)=1
        AND (e.test_set_authority_scope='per_item' OR (e.test_set_id=NEW.test_set_id AND e.test_set_revision=NEW.test_set_revision
          AND e.definition_schema_version=NEW.definition_schema_version)))
    BEGIN SELECT RAISE(ABORT,'Execution item authority mismatch'); END`,
  execution_item_authority_suite_match_insert: `CREATE TRIGGER execution_item_authority_suite_match_insert BEFORE INSERT ON execution_item_authorities
    WHEN EXISTS (SELECT 1 FROM executions e JOIN suite_revisions r ON r.suite_id=e.suite_id AND r.revision=e.suite_revision
      WHERE e.execution_id=NEW.execution_id AND r.suite_schema_version=2)
      AND NOT EXISTS (SELECT 1 FROM executions e JOIN suite_revision_member_authorities a
        ON a.suite_id=e.suite_id AND a.suite_revision=e.suite_revision AND a.member_ordinal=NEW.item_ordinal
        WHERE e.execution_id=NEW.execution_id AND a.test_set_row_id=NEW.test_set_row_id AND a.test_set_id=NEW.test_set_id
          AND a.test_set_revision=NEW.test_set_revision AND a.test_set_content_hash=NEW.test_set_content_hash
          AND a.definition_schema_version=NEW.definition_schema_version AND a.definition_id=NEW.definition_id)
    BEGIN SELECT RAISE(ABORT,'Execution item authority differs from accepted Suite member authority'); END`,
  execution_item_authority_immutable_update: `CREATE TRIGGER execution_item_authority_immutable_update BEFORE UPDATE ON execution_item_authorities BEGIN SELECT RAISE(ABORT,'Execution item authority is immutable'); END`,
  execution_item_authority_immutable_delete: `CREATE TRIGGER execution_item_authority_immutable_delete BEFORE DELETE ON execution_item_authorities BEGIN SELECT RAISE(ABORT,'Execution item authority is immutable'); END`,
  execution_started_authority_complete: `CREATE TRIGGER execution_started_authority_complete BEFORE INSERT ON execution_events WHEN NEW.event_type='started' AND (
    (SELECT COUNT(*) FROM execution_items i WHERE i.execution_id=NEW.execution_id) < 1 OR
    (SELECT COUNT(*) FROM execution_item_authorities a WHERE a.execution_id=NEW.execution_id) <>
      (SELECT COUNT(*) FROM execution_items i WHERE i.execution_id=NEW.execution_id) OR
    EXISTS (SELECT 1 FROM execution_item_authorities a LEFT JOIN execution_items i
      ON i.execution_id=a.execution_id AND i.item_ordinal=a.item_ordinal WHERE a.execution_id=NEW.execution_id AND i.execution_id IS NULL))
    BEGIN SELECT RAISE(ABORT,'Execution item authority must exactly cover the accepted manifest'); END`,
} as const)

function assertHistoricalRow(row: any, definitionId: string, projectId: string): {
  testSet: CanonicalTestSetV1 | CanonicalTestSetV2 | CanonicalTestSetV3
  definition: CanonicalTestDefinitionV1 | CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
} {
  assertHash(row.content_hash, 'historical Test Set content hash')
  assertId(row.test_set_id, 'historical Test Set identity')
  assertId(definitionId, 'historical Definition identity')
  let parsed: ReturnType<typeof parseCanonicalTestSet>
  try {
    parsed = parseCanonicalTestSet(row.payload_json)
  } catch {
    throw new Error('Migration 035 found malformed or ambiguous historical Test Set authority.')
  }
  if (parsed.fingerprint !== row.content_hash || parsed.value.projectId !== projectId
    || parsed.value.testSetId !== row.test_set_id || parsed.value.revision !== Number(row.revision)
    || parsed.value.schemaVersion !== Number(row.schema_version)
    || parsed.value.definitions.length !== Number(row.definition_count)
    || parsed.value.definitions.filter(definition => definition.id === definitionId).length !== 1) {
    throw new Error('Migration 035 found contradictory historical Definition authority.')
  }
  const definition = parsed.value.definitions.find(candidate => candidate.id === definitionId)!
  return {
    testSet: parsed.value,
    definition,
  }
}

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') throw new Error('Migration 035 is governed for SQLite workspace databases only.')
  const triggers = (await sql<TriggerDefinition>`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name`.execute(db)).rows
  for (const trigger of triggers) await sql.raw(`DROP TRIGGER "${trigger.name.replace(/"/g, '""')}"`).execute(db)
  await sql`PRAGMA defer_foreign_keys = ON`.execute(db)

  const [suiteRevisions, suiteMembers, testSetRows, executions, executionItems] = await Promise.all([
    sql<any>`SELECT * FROM suite_revisions ORDER BY suite_id,revision`.execute(db).then(result => result.rows),
    sql<any>`SELECT * FROM suite_revision_members ORDER BY suite_id,suite_revision,member_ordinal`.execute(db).then(result => result.rows),
    sql<any>`SELECT * FROM test_set_revisions ORDER BY id`.execute(db).then(result => result.rows),
    sql<any>`SELECT * FROM executions ORDER BY execution_id`.execute(db).then(result => result.rows),
    sql<any>`SELECT * FROM execution_items ORDER BY execution_id,item_ordinal`.execute(db).then(result => result.rows),
  ])
  const suiteRows: any[] = []
  for (const revision of suiteRevisions) {
    assertId(revision.suite_id, 'Suite identity')
    assertId(revision.project_id, 'Suite project identity')
    assertHash(revision.change_intent_fingerprint, 'Suite change-intent fingerprint')
    assertHash(revision.content_hash, 'Suite content hash')
    assertHash(revision.test_set_content_hash, 'Suite Test Set content hash')
    const rootValues = [revision.definition_schema_version, revision.test_set_row_id, revision.test_set_id,
      revision.test_set_revision, revision.test_set_content_hash]
    if (rootValues.some(value => value === null) || ![2, 3].includes(Number(revision.definition_schema_version))
      || !Number.isSafeInteger(Number(revision.test_set_revision)) || Number(revision.test_set_revision) < 1) {
      throw new Error('Migration 035 found partial Suite v1 root authority.')
    }
    const members = suiteMembers.filter(member => member.suite_id === revision.suite_id
      && Number(member.suite_revision) === Number(revision.revision))
    if (!Number.isSafeInteger(Number(revision.member_count)) || Number(revision.member_count) < 1
      || members.length !== Number(revision.member_count)
      || members.some((member, index) => Number(member.member_ordinal) !== index + 1)
      || new Set(members.map(member => member.definition_id)).size !== members.length) {
      throw new Error('Migration 035 found incomplete Suite revision membership.')
    }
    const testSet = testSetRows.find(row => Number(row.id) === Number(revision.test_set_row_id))
    if (!testSet || testSet.project_id !== revision.project_id || testSet.test_set_id !== revision.test_set_id
      || Number(testSet.revision) !== Number(revision.test_set_revision)
      || Number(testSet.schema_version) !== Number(revision.definition_schema_version)
      || testSet.content_hash !== revision.test_set_content_hash) {
      throw new Error('Migration 035 found missing or cross-project Suite history.')
    }
    const authorities = members.map(member => {
      const historical = assertHistoricalRow(testSet, member.definition_id, revision.project_id)
      if (historical.testSet.schemaVersion !== 2 && historical.testSet.schemaVersion !== 3) {
        throw new Error('Migration 035 found unsupported Suite Definition authority.')
      }
      const item = {
        ...revision,
        member_ordinal: Number(member.member_ordinal),
        definition_id: member.definition_id,
      }
      suiteRows.push(item)
      return {
        ordinal: Number(member.member_ordinal),
        definitionAuthority: {
          definitionId: member.definition_id,
          definitionSchemaVersion: Number(revision.definition_schema_version) as 2 | 3,
          testSetId: revision.test_set_id,
          testSetRevision: Number(revision.test_set_revision),
          testSetContentHash: revision.test_set_content_hash,
        },
      }
    })
    const base: Omit<CanonicalSuiteRevision, 'contentHash'> = {
      schemaVersion: 1,
      suiteId: revision.suite_id,
      projectId: revision.project_id,
      revision: Number(revision.revision),
      name: revision.name,
      purpose: 'sanity',
      members: authorities,
      createdAt: revision.created_at,
      provenance: {
        source: 'product_api',
        changeKind: revision.change_kind as 'created' | 'revised',
        priorRevision: revision.prior_revision === null ? null : Number(revision.prior_revision),
        changeIntentKey: revision.change_intent_key,
        changeIntentFingerprint: revision.change_intent_fingerprint,
      },
    }
    if (suiteHash(base) !== revision.content_hash) {
      throw new Error('Migration 035 found contradictory Suite content hash authority.')
    }
  }

  const executionRows: any[] = []
  for (const execution of executions) {
    assertId(execution.execution_id, 'Execution identity')
    assertId(execution.project_id, 'Execution project identity')
    assertId(execution.test_set_id, 'Execution Test Set identity')
    assertHash(execution.manifest_hash, 'Execution manifest hash')
    if (execution.execution_intent_fingerprint !== null) assertHash(execution.execution_intent_fingerprint, 'Execution intent fingerprint')
    const schemaVersion = Number(execution.definition_schema_version)
    const singlePredicate = Number(execution.test_set_revision) > 0 && [1, 2, 3].includes(schemaVersion)
      && Number(execution.model_row_id) > 0 && execution.model_version !== null
      && (schemaVersion === 1
        ? execution.source_observation_id !== null && execution.support_seal_hash === null
          && execution.route_evidence_identity_hash === null && execution.authentication_expectation_identity_hash === null
        : execution.source_observation_id === null && HASH.test(execution.support_seal_hash ?? '')
          && HASH.test(execution.route_evidence_identity_hash ?? '')
          && HASH.test(execution.authentication_expectation_identity_hash ?? ''))
    if (!singlePredicate) throw new Error('Migration 035 found incomplete single-root Execution authority.')
    const items = executionItems.filter(item => item.execution_id === execution.execution_id)
    if (items.length < 1 || items.some((item, index) => Number(item.item_ordinal) !== index + 1)
      || new Set(items.map(item => item.definition_id)).size !== items.length
      || items.some(item => !HASH.test(item.executable_plan_hash))
      || manifestHash(items) !== execution.manifest_hash) {
      throw new Error('Migration 035 found incomplete or contradictory Execution manifest authority.')
    }
    const suiteValues = [execution.suite_id, execution.suite_revision, execution.suite_content_hash]
    if (!suiteValues.every(value => value === null) && !suiteValues.every(value => value !== null)) {
      throw new Error('Migration 035 found partial Execution Suite authority.')
    }
    if (execution.suite_id !== null) {
      const suite = suiteRevisions.find(revision => revision.suite_id === execution.suite_id
        && Number(revision.revision) === Number(execution.suite_revision))
      if (!suite || suite.project_id !== execution.project_id || suite.content_hash !== execution.suite_content_hash
        || suite.test_set_id !== execution.test_set_id || Number(suite.test_set_revision) !== Number(execution.test_set_revision)
        || Number(suite.definition_schema_version) !== schemaVersion) {
        throw new Error('Migration 035 found Execution/Suite authority mismatch.')
      }
    }
    const routeHashes: string[] = []
    const authHashes: string[] = []
    for (const item of items) {
      assertId(item.definition_id, 'Execution Definition identity')
      const matches = testSetRows.filter(row => row.project_id === execution.project_id
        && row.test_set_id === execution.test_set_id && Number(row.revision) === Number(execution.test_set_revision))
      if (matches.length !== 1 || Number(matches[0].schema_version) !== schemaVersion) {
        throw new Error('Migration 035 found missing, ambiguous, or cross-project Execution history.')
      }
      const testSetRow = matches[0]
      const historical = assertHistoricalRow(testSetRow, item.definition_id, execution.project_id)
      if (Number(testSetRow.model_row_id) !== Number(execution.model_row_id)
        || testSetRow.model_version !== execution.model_version) {
        throw new Error('Migration 035 found Execution model authority mismatch.')
      }
      if (schemaVersion === 1) {
        if (historical.testSet.schemaVersion !== 1 || testSetRow.source_observation_id !== execution.source_observation_id
          || historical.testSet.sourceObservationId !== execution.source_observation_id) {
          throw new Error('Migration 035 found Execution observation authority mismatch.')
        }
      } else {
        if (historical.testSet.schemaVersion === 1 || historical.testSet.schemaVersion !== schemaVersion
          || testSetRow.support_seal_hash !== execution.support_seal_hash
          || historical.testSet.canonicalSupport.modelRowId !== Number(execution.model_row_id)
          || historical.testSet.canonicalSupport.modelVersion !== execution.model_version
          || historical.testSet.canonicalSupport.supportSealHash !== execution.support_seal_hash) {
          throw new Error('Migration 035 found Execution support authority mismatch.')
        }
        const definition = historical.definition as CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
        const routeHash = routeEvidenceIdentity(definition)
        const authHash = authenticationIdentity(definition)
        if (!routeHash || !authHash || !HASH.test(routeHash) || !HASH.test(authHash)) {
          throw new Error('Migration 035 found malformed embedded Execution authority.')
        }
        routeHashes.push(routeHash)
        authHashes.push(authHash)
      }
      executionRows.push({ ...item, ...execution, test_set_row_id: Number(testSetRow.id),
        content_hash: testSetRow.content_hash, schema_version: testSetRow.schema_version })
    }
    if (schemaVersion !== 1 && (routeSelectionHash(routeHashes) !== execution.route_evidence_identity_hash
      || authHashes[0] !== execution.authentication_expectation_identity_hash)) {
      throw new Error('Migration 035 found Execution route/authentication authority mismatch.')
    }
  }

  // SQLite RESTRICT foreign keys are immediate even when defer_foreign_keys is
  // enabled.  Suspend the exact dependent tables before rebuilding their
  // parents, then restore their original schemas, rows, and indexes after the
  // canonical parent names exist again.  The preflight above has already
  // proved the authority rows that will be backfilled.
  const suiteDependents = await captureTables(db, ['suite_revision_members'])
  const executionDependents = await captureTables(db, [
    'diagnostic_evidence', 'test_results', 'execution_items', 'execution_events', 'execution_locks', 'runs',
  ])
  await dropCapturedTables(db, suiteDependents)
  await dropCapturedTables(db, executionDependents)

  await sql.raw(`CREATE TABLE suite_revisions_035 (
    suite_id varchar(255) NOT NULL, revision integer NOT NULL CHECK(revision>0), project_id varchar(255) NOT NULL,
    name text NOT NULL, name_key text NOT NULL, purpose varchar(20) NOT NULL CHECK(purpose='sanity'),
    suite_schema_version integer NOT NULL CHECK(suite_schema_version IN (1,2)),
    definition_schema_version integer, test_set_row_id integer, test_set_id varchar(255), test_set_revision integer,
    test_set_content_hash varchar(64), created_at varchar(50) NOT NULL, provenance_source varchar(20) NOT NULL CHECK(provenance_source='product_api'),
    change_kind varchar(20) NOT NULL CHECK(change_kind IN ('created','revised')), prior_revision integer,
    change_intent_key varchar(128) NOT NULL, change_intent_fingerprint varchar(64) NOT NULL CHECK(length(change_intent_fingerprint)=64 AND change_intent_fingerprint NOT GLOB '*[^a-f0-9]*'),
    member_count integer NOT NULL CHECK(member_count BETWEEN 1 AND 50), content_hash varchar(64) NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
    PRIMARY KEY(suite_id,revision), UNIQUE(project_id,change_intent_key),
    FOREIGN KEY(suite_id,project_id) REFERENCES suites(suite_id,project_id) ON DELETE RESTRICT,
    FOREIGN KEY(test_set_row_id) REFERENCES test_set_revisions(id) ON DELETE RESTRICT,
    CHECK((suite_schema_version=1 AND definition_schema_version IN (2,3) AND test_set_row_id IS NOT NULL
      AND length(test_set_id) BETWEEN 1 AND 255 AND substr(test_set_id,1,1) GLOB '[A-Za-z0-9]' AND test_set_id NOT GLOB '*[^A-Za-z0-9._:-]*'
      AND test_set_revision>0 AND length(test_set_content_hash)=64 AND test_set_content_hash NOT GLOB '*[^a-f0-9]*')
      OR (suite_schema_version=2 AND definition_schema_version IS NULL
      AND test_set_row_id IS NULL AND test_set_id IS NULL AND test_set_revision IS NULL AND test_set_content_hash IS NULL)))`).execute(db)
  await sql.raw(`INSERT INTO suite_revisions_035 SELECT suite_id,revision,project_id,name,name_key,purpose,1,definition_schema_version,
    test_set_row_id,test_set_id,test_set_revision,test_set_content_hash,created_at,provenance_source,change_kind,prior_revision,
    change_intent_key,change_intent_fingerprint,member_count,content_hash FROM suite_revisions`).execute(db)
  await sql`DROP TABLE suite_revisions`.execute(db)
  await sql`ALTER TABLE suite_revisions_035 RENAME TO suite_revisions`.execute(db)
  await restoreCapturedTables(db, suiteDependents, ['suite_revision_members'])

  await sql.raw(`CREATE TABLE executions_035 (
    execution_id varchar(255) NOT NULL PRIMARY KEY, project_id varchar(255) NOT NULL, accepted_at varchar(50) NOT NULL,
    test_set_authority_scope varchar(20) NOT NULL DEFAULT 'single' CHECK(test_set_authority_scope IN ('single','per_item')),
    test_set_id varchar(255), test_set_revision integer, definition_schema_version integer CHECK(definition_schema_version IS NULL OR definition_schema_version IN (1,2,3)),
    model_row_id integer, model_version varchar(50), source_observation_id varchar(255), support_seal_hash varchar(64),
    route_evidence_identity_hash varchar(64), authentication_expectation_identity_hash varchar(64),
    manifest_hash varchar(64) NOT NULL CHECK(length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
    max_run_attempts integer NOT NULL CHECK(max_run_attempts>0), dispatch_mode varchar(20) NOT NULL CHECK(dispatch_mode='serial'),
    stop_rule varchar(50) NOT NULL CHECK(stop_rule='stop_on_first_non_completed'), execution_intent_key varchar(128) CHECK(execution_intent_key IS NULL OR (
      length(execution_intent_key) BETWEEN 1 AND 128 AND substr(execution_intent_key,1,1) GLOB '[A-Za-z0-9]'
      AND execution_intent_key NOT GLOB '*[^A-Za-z0-9._:-]*')),
    execution_intent_fingerprint varchar(64) CHECK(execution_intent_fingerprint IS NULL OR (length(execution_intent_fingerprint)=64
      AND execution_intent_fingerprint NOT GLOB '*[^a-f0-9]*')), suite_id varchar(255), suite_revision integer,
    suite_content_hash varchar(64) CHECK(suite_content_hash IS NULL OR (length(suite_content_hash)=64 AND suite_content_hash NOT GLOB '*[^a-f0-9]*')),
    CHECK(((test_set_authority_scope='single' AND test_set_id IS NOT NULL AND test_set_revision>0
      AND definition_schema_version IN (1,2,3) AND model_row_id>0 AND model_version IS NOT NULL
      AND ((definition_schema_version=1 AND source_observation_id IS NOT NULL
        AND support_seal_hash IS NULL AND route_evidence_identity_hash IS NULL
        AND authentication_expectation_identity_hash IS NULL)
      OR (definition_schema_version IN (2,3) AND source_observation_id IS NULL
        AND support_seal_hash IS NOT NULL AND length(support_seal_hash)=64 AND support_seal_hash NOT GLOB '*[^a-f0-9]*'
        AND route_evidence_identity_hash IS NOT NULL AND length(route_evidence_identity_hash)=64 AND route_evidence_identity_hash NOT GLOB '*[^a-f0-9]*'
        AND authentication_expectation_identity_hash IS NOT NULL AND length(authentication_expectation_identity_hash)=64 AND authentication_expectation_identity_hash NOT GLOB '*[^a-f0-9]*')))
      OR (test_set_authority_scope='per_item' AND suite_id IS NOT NULL
        AND test_set_id IS NULL AND test_set_revision IS NULL AND definition_schema_version IS NULL
        AND model_row_id IS NULL AND model_version IS NULL AND source_observation_id IS NULL
        AND support_seal_hash IS NULL AND route_evidence_identity_hash IS NULL
        AND authentication_expectation_identity_hash IS NULL))),
    CHECK(((suite_id IS NULL)+(suite_revision IS NULL)+(suite_content_hash IS NULL)) IN (0,3)))`).execute(db)
  await sql.raw(`INSERT INTO executions_035 SELECT execution_id,project_id,accepted_at,'single',test_set_id,test_set_revision,
    definition_schema_version,model_row_id,model_version,source_observation_id,support_seal_hash,route_evidence_identity_hash,
    authentication_expectation_identity_hash,manifest_hash,max_run_attempts,dispatch_mode,stop_rule,execution_intent_key,
    execution_intent_fingerprint,suite_id,suite_revision,suite_content_hash FROM executions`).execute(db)
  await sql`DROP TABLE executions`.execute(db)
  await sql`ALTER TABLE executions_035 RENAME TO executions`.execute(db)
  await sql`CREATE INDEX idx_executions_project_accepted ON executions(project_id,accepted_at)`.execute(db)
  await sql.raw(`CREATE UNIQUE INDEX uq_executions_project_intent ON executions(project_id,execution_intent_key) WHERE execution_intent_key IS NOT NULL`).execute(db)
  await restoreCapturedTables(db, executionDependents,
    ['execution_items', 'execution_events', 'execution_locks', 'runs', 'test_results', 'diagnostic_evidence'])

  await sql.raw(`CREATE TABLE suite_revision_member_authorities (
    suite_id varchar(255) NOT NULL CHECK(length(suite_id) BETWEEN 1 AND 255 AND substr(suite_id,1,1) GLOB '[A-Za-z0-9]' AND suite_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    suite_revision integer NOT NULL CHECK(suite_revision>0),member_ordinal integer NOT NULL CHECK(member_ordinal>0),test_set_row_id integer NOT NULL,
    test_set_id varchar(255) NOT NULL CHECK(length(test_set_id) BETWEEN 1 AND 255 AND substr(test_set_id,1,1) GLOB '[A-Za-z0-9]' AND test_set_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    test_set_revision integer NOT NULL CHECK(test_set_revision>0),test_set_content_hash varchar(64) NOT NULL CHECK(length(test_set_content_hash)=64 AND test_set_content_hash NOT GLOB '*[^a-f0-9]*'),
    definition_schema_version integer NOT NULL CHECK(definition_schema_version IN (2,3)),
    definition_id varchar(255) NOT NULL CHECK(length(definition_id) BETWEEN 1 AND 255 AND substr(definition_id,1,1) GLOB '[A-Za-z0-9]' AND definition_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    PRIMARY KEY(suite_id,suite_revision,member_ordinal), UNIQUE(suite_id,suite_revision,test_set_row_id,definition_id),
    FOREIGN KEY(suite_id,suite_revision,member_ordinal) REFERENCES suite_revision_members(suite_id,suite_revision,member_ordinal) ON DELETE RESTRICT,
    FOREIGN KEY(test_set_row_id) REFERENCES test_set_revisions(id) ON DELETE RESTRICT)`).execute(db)
  for (const item of suiteRows) await db.insertInto('suite_revision_member_authorities').values({
    suite_id:item.suite_id,suite_revision:Number(item.revision),member_ordinal:Number(item.member_ordinal),test_set_row_id:Number(item.test_set_row_id),
    test_set_id:item.test_set_id,test_set_revision:Number(item.test_set_revision),test_set_content_hash:item.test_set_content_hash,
    definition_schema_version:Number(item.definition_schema_version),definition_id:item.definition_id,
  }).execute()

  await sql.raw(`CREATE TABLE execution_item_authorities (
    execution_id varchar(255) NOT NULL CHECK(length(execution_id) BETWEEN 1 AND 255 AND substr(execution_id,1,1) GLOB '[A-Za-z0-9]' AND execution_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    item_ordinal integer NOT NULL CHECK(item_ordinal>0),test_set_row_id integer NOT NULL,
    test_set_id varchar(255) NOT NULL CHECK(length(test_set_id) BETWEEN 1 AND 255 AND substr(test_set_id,1,1) GLOB '[A-Za-z0-9]' AND test_set_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    test_set_revision integer NOT NULL CHECK(test_set_revision>0),test_set_content_hash varchar(64) NOT NULL CHECK(length(test_set_content_hash)=64 AND test_set_content_hash NOT GLOB '*[^a-f0-9]*'),
    definition_schema_version integer NOT NULL CHECK(definition_schema_version IN (1,2,3)),
    definition_id varchar(255) NOT NULL CHECK(length(definition_id) BETWEEN 1 AND 255 AND substr(definition_id,1,1) GLOB '[A-Za-z0-9]' AND definition_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
    PRIMARY KEY(execution_id,item_ordinal), UNIQUE(execution_id,test_set_row_id,definition_id),
    FOREIGN KEY(execution_id,item_ordinal) REFERENCES execution_items(execution_id,item_ordinal) ON DELETE RESTRICT,
    FOREIGN KEY(test_set_row_id) REFERENCES test_set_revisions(id) ON DELETE RESTRICT)`).execute(db)
  for (const item of executionRows) await db.insertInto('execution_item_authorities').values({
    execution_id:item.execution_id,item_ordinal:Number(item.item_ordinal),test_set_row_id:Number(item.test_set_row_id),test_set_id:item.test_set_id,
    test_set_revision:Number(item.test_set_revision),test_set_content_hash:item.content_hash,
    definition_schema_version:Number(item.definition_schema_version),definition_id:item.definition_id,
  }).execute()

  for (const trigger of triggers.filter(item => !REPLACED_TRIGGERS.has(item.name))) await sql.raw(trigger.sql).execute(db)
  for (const definition of Object.values(MIGRATION_035_TRIGGER_DEFINITIONS_V1)) await sql.raw(definition).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 035 is intentionally irreversible because per-member and per-item authority cannot be safely forgotten.')
}
