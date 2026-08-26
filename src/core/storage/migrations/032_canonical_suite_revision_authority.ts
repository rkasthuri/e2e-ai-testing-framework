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
import { Kysely, sql } from 'kysely'
import { currentMigrationDialect } from '../MigrationContext'

export const MIGRATION_032_TRIGGER_DEFINITIONS_V1 = Object.freeze({
  suite_revisions_immutable_update: `CREATE TRIGGER suite_revisions_immutable_update
    BEFORE UPDATE ON suite_revisions BEGIN
      SELECT RAISE(ABORT,'Suite revision authority is immutable');
    END`,
  suite_revisions_immutable_delete: `CREATE TRIGGER suite_revisions_immutable_delete
    BEFORE DELETE ON suite_revisions BEGIN
      SELECT RAISE(ABORT,'Suite revision authority is immutable');
    END`,
  suite_revision_members_immutable_update: `CREATE TRIGGER suite_revision_members_immutable_update
    BEFORE UPDATE ON suite_revision_members BEGIN
      SELECT RAISE(ABORT,'Suite revision authority is immutable');
    END`,
  suite_revision_members_immutable_delete: `CREATE TRIGGER suite_revision_members_immutable_delete
    BEFORE DELETE ON suite_revision_members BEGIN
      SELECT RAISE(ABORT,'Suite revision authority is immutable');
    END`,
  suites_no_delete: `CREATE TRIGGER suites_no_delete
    BEFORE DELETE ON suites BEGIN
      SELECT RAISE(ABORT,'Suite identity cannot be deleted');
    END`,
  suites_guard_update: `CREATE TRIGGER suites_guard_update BEFORE UPDATE ON suites WHEN
    NEW.suite_id<>OLD.suite_id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at OR
    NEW.current_revision<>OLD.current_revision+1 OR NOT EXISTS (
      SELECT 1 FROM suite_revisions r WHERE r.suite_id=OLD.suite_id AND r.project_id=OLD.project_id
        AND r.revision=NEW.current_revision AND r.name_key=NEW.name_key)
    BEGIN SELECT RAISE(ABORT,'Suite head may only advance to its next immutable revision'); END`,
  execution_suite_authority_insert: `CREATE TRIGGER execution_suite_authority_insert BEFORE INSERT ON executions
    WHEN ((NEW.suite_id IS NULL)+(NEW.suite_revision IS NULL)+(NEW.suite_content_hash IS NULL)) NOT IN (0,3)
    BEGIN SELECT RAISE(ABORT,'Execution Suite authority must be wholly present or absent'); END`,
  execution_suite_authority_match_insert: `CREATE TRIGGER execution_suite_authority_match_insert BEFORE INSERT ON executions WHEN NEW.suite_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suite_revisions r WHERE r.suite_id=NEW.suite_id AND r.revision=NEW.suite_revision AND r.project_id=NEW.project_id
      AND r.content_hash=NEW.suite_content_hash AND r.test_set_id=NEW.test_set_id AND r.test_set_revision=NEW.test_set_revision
      AND r.definition_schema_version=NEW.definition_schema_version)
    BEGIN SELECT RAISE(ABORT,'Execution Suite authority mismatch'); END`,
} as const)

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') throw new Error('Migration 032 is governed for SQLite workspace databases only.')
  await sql.raw(`CREATE TABLE suites (
    suite_id varchar(255) NOT NULL PRIMARY KEY, project_id varchar(255) NOT NULL,
    current_revision integer NOT NULL CHECK(current_revision > 0), name_key text NOT NULL, created_at varchar(50) NOT NULL,
    UNIQUE(suite_id, project_id), UNIQUE(project_id, name_key))`).execute(db)
  await sql.raw(`CREATE TABLE suite_revisions (
    suite_id varchar(255) NOT NULL, revision integer NOT NULL CHECK(revision > 0), project_id varchar(255) NOT NULL,
    name text NOT NULL, name_key text NOT NULL, purpose varchar(20) NOT NULL CHECK(purpose = 'sanity'),
    definition_schema_version integer NOT NULL CHECK(definition_schema_version IN (2,3)),
    test_set_row_id integer NOT NULL, test_set_id varchar(255) NOT NULL, test_set_revision integer NOT NULL CHECK(test_set_revision > 0),
    test_set_content_hash varchar(64) NOT NULL CHECK(length(test_set_content_hash)=64 AND test_set_content_hash NOT GLOB '*[^a-f0-9]*'),
    created_at varchar(50) NOT NULL, provenance_source varchar(20) NOT NULL CHECK(provenance_source='product_api'),
    change_kind varchar(20) NOT NULL CHECK(change_kind IN ('created','revised')), prior_revision integer,
    change_intent_key varchar(128) NOT NULL, change_intent_fingerprint varchar(64) NOT NULL CHECK(length(change_intent_fingerprint)=64 AND change_intent_fingerprint NOT GLOB '*[^a-f0-9]*'),
    member_count integer NOT NULL CHECK(member_count BETWEEN 1 AND 50), content_hash varchar(64) NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
    PRIMARY KEY(suite_id, revision), UNIQUE(project_id, change_intent_key),
    FOREIGN KEY(suite_id, project_id) REFERENCES suites(suite_id, project_id) ON DELETE RESTRICT,
    FOREIGN KEY(test_set_row_id) REFERENCES test_set_revisions(id) ON DELETE RESTRICT)`).execute(db)
  await sql.raw(`CREATE TABLE suite_revision_members (
    suite_id varchar(255) NOT NULL, suite_revision integer NOT NULL, member_ordinal integer NOT NULL CHECK(member_ordinal > 0), definition_id varchar(255) NOT NULL,
    PRIMARY KEY(suite_id,suite_revision,member_ordinal), UNIQUE(suite_id,suite_revision,definition_id),
    FOREIGN KEY(suite_id,suite_revision) REFERENCES suite_revisions(suite_id,revision) ON DELETE RESTRICT)`).execute(db)
  await sql`ALTER TABLE executions ADD COLUMN suite_id varchar(255)`.execute(db)
  await sql`ALTER TABLE executions ADD COLUMN suite_revision integer CHECK(suite_revision IS NULL OR suite_revision > 0)`.execute(db)
  await sql`ALTER TABLE executions ADD COLUMN suite_content_hash varchar(64) CHECK(suite_content_hash IS NULL OR (length(suite_content_hash)=64 AND suite_content_hash NOT GLOB '*[^a-f0-9]*'))`.execute(db)
  for (const definition of Object.values(MIGRATION_032_TRIGGER_DEFINITIONS_V1)) {
    await sql.raw(definition).execute(db)
  }
}
export async function down(db: Kysely<any>): Promise<void> { void db; throw new Error('Migration 032 is intentionally irreversible.') }
