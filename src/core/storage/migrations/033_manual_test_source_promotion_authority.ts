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

export const MIGRATION_033_TRIGGER_DEFINITIONS_V1 = Object.freeze({
  manual_test_sources_immutable_update: `CREATE TRIGGER manual_test_sources_immutable_update
    BEFORE UPDATE ON manual_test_sources BEGIN
      SELECT RAISE(ABORT,'Manual Test Source authority is immutable');
    END`,
  manual_test_sources_immutable_delete: `CREATE TRIGGER manual_test_sources_immutable_delete
    BEFORE DELETE ON manual_test_sources BEGIN
      SELECT RAISE(ABORT,'Manual Test Source authority is immutable');
    END`,
  manual_test_promotions_immutable_update: `CREATE TRIGGER manual_test_promotions_immutable_update
    BEFORE UPDATE ON manual_test_promotions BEGIN
      SELECT RAISE(ABORT,'Manual Test promotion provenance is immutable');
    END`,
  manual_test_promotions_immutable_delete: `CREATE TRIGGER manual_test_promotions_immutable_delete
    BEFORE DELETE ON manual_test_promotions BEGIN
      SELECT RAISE(ABORT,'Manual Test promotion provenance is immutable');
    END`,
  manual_test_promotions_authority_insert: `CREATE TRIGGER manual_test_promotions_authority_insert
    BEFORE INSERT ON manual_test_promotions WHEN
      NOT EXISTS (
        SELECT 1 FROM manual_test_sources s
        WHERE s.source_id=NEW.source_id AND s.project_id=NEW.project_id
          AND s.content_hash=NEW.source_content_hash
      ) OR NOT EXISTS (
        SELECT 1 FROM test_set_revisions t
        WHERE t.id=NEW.test_set_row_id AND t.project_id=NEW.project_id
          AND t.test_set_id=NEW.test_set_id AND t.revision=NEW.test_set_revision
          AND t.content_hash=NEW.test_set_content_hash AND t.schema_version=3
      )
    BEGIN SELECT RAISE(ABORT,'Manual Test promotion authority mismatch'); END`,
  manual_test_promotions_definition_membership_insert: `CREATE TRIGGER manual_test_promotions_definition_membership_insert
    BEFORE INSERT ON manual_test_promotions WHEN
      EXISTS (
        SELECT 1 FROM test_set_revisions t
        WHERE t.id=NEW.test_set_row_id AND t.project_id=NEW.project_id
          AND t.test_set_id=NEW.test_set_id AND t.revision=NEW.test_set_revision
          AND t.content_hash=NEW.test_set_content_hash AND t.schema_version=3
      ) AND NOT EXISTS (
        SELECT 1 FROM test_set_revisions t
        WHERE t.id=NEW.test_set_row_id AND t.project_id=NEW.project_id
          AND t.test_set_id=NEW.test_set_id AND t.revision=NEW.test_set_revision
          AND t.content_hash=NEW.test_set_content_hash AND t.schema_version=3
          AND forge_is_exact_canonical_v3_definition_member(
            t.payload_json,t.content_hash,t.test_set_id,t.revision,t.project_id,
            t.definition_count,NEW.definition_id
          )=1
      )
    BEGIN SELECT RAISE(ABORT,'Manual Test promotion Definition membership mismatch'); END`,
} as const)

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 033 is governed for SQLite workspace databases only.')
  }
  await sql.raw(`CREATE TABLE manual_test_sources (
    source_id varchar(255) NOT NULL PRIMARY KEY,
    project_id varchar(255) NOT NULL,
    schema_version varchar(80) NOT NULL CHECK(schema_version='forge-manual-test-source/v1'),
    source_kind varchar(20) NOT NULL CHECK(source_kind='manual'),
    payload_json text NOT NULL,
    content_hash varchar(64) NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
    admitted_at varchar(50) NOT NULL,
    UNIQUE(project_id,content_hash),
    UNIQUE(source_id,project_id,content_hash)
  )`).execute(db)
  await sql.raw(`CREATE TABLE manual_test_promotions (
    proposal_id varchar(255) NOT NULL PRIMARY KEY,
    project_id varchar(255) NOT NULL,
    proposal_schema_version varchar(100) NOT NULL CHECK(proposal_schema_version='forge-manual-automation-proposal/v1'),
    source_id varchar(255) NOT NULL,
    source_content_hash varchar(64) NOT NULL CHECK(length(source_content_hash)=64 AND source_content_hash NOT GLOB '*[^a-f0-9]*'),
    proposal_payload_json text NOT NULL,
    proposal_content_hash varchar(64) NOT NULL CHECK(length(proposal_content_hash)=64 AND proposal_content_hash NOT GLOB '*[^a-f0-9]*'),
    test_set_row_id integer NOT NULL,
    test_set_id varchar(255) NOT NULL,
    test_set_revision integer NOT NULL CHECK(test_set_revision>0),
    test_set_content_hash varchar(64) NOT NULL CHECK(length(test_set_content_hash)=64 AND test_set_content_hash NOT GLOB '*[^a-f0-9]*'),
    definition_id varchar(255) NOT NULL,
    promoted_at varchar(50) NOT NULL,
    UNIQUE(project_id,proposal_content_hash),
    UNIQUE(project_id,test_set_id,test_set_revision,definition_id),
    FOREIGN KEY(source_id,project_id,source_content_hash)
      REFERENCES manual_test_sources(source_id,project_id,content_hash) ON DELETE RESTRICT
  )`).execute(db)
  await sql`CREATE INDEX idx_manual_test_sources_project ON manual_test_sources(project_id,admitted_at)`.execute(db)
  await sql`CREATE INDEX idx_manual_test_promotions_source ON manual_test_promotions(project_id,source_id)`.execute(db)
  for (const definition of Object.values(MIGRATION_033_TRIGGER_DEFINITIONS_V1)) {
    await sql.raw(definition).execute(db)
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 033 is intentionally irreversible.')
}
