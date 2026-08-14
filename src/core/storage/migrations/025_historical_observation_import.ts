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

/**
 * B3 keeps import provenance outside the fact payload while allowing the
 * canonical Observation row to disclose its legacy provenance class.
 */
export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 025 is governed for SQLite workspace databases only.')
  }

  await sql.raw(`
    CREATE TABLE observations_b3 (
      observation_id varchar(36) NOT NULL PRIMARY KEY,
      observation_run_id varchar(36) NOT NULL,
      project_id varchar(255) NOT NULL,
      producer varchar(255) NOT NULL,
      producer_version varchar(100) NOT NULL,
      method varchar(50) NOT NULL CHECK (method IN ('browser_dom_inspection', 'browser_navigation_attempt', 'http_response_inspection')),
      method_version varchar(100) NOT NULL,
      subject_id varchar(255) NOT NULL,
      predicate varchar(255) NOT NULL,
      outcome varchar(20) NOT NULL CHECK (outcome IN ('present', 'absent', 'indeterminate')),
      observed_value_json text,
      boundary_json text NOT NULL CHECK (json_valid(boundary_json)),
      captured_at varchar(50) NOT NULL,
      idempotency_key varchar(255) NOT NULL,
      integrity_hash varchar(64) NOT NULL CHECK (length(integrity_hash) = 64 AND integrity_hash NOT GLOB '*[^a-f0-9]*'),
      provenance_class varchar(30) NOT NULL CHECK (provenance_class IN ('native', 'legacy_direct', 'legacy_reconstructed')),
      safe_reason_code varchar(100),
      safe_message varchar(500),
      artifact_links_sealed integer NOT NULL DEFAULT 0 CHECK (artifact_links_sealed IN (0, 1)),
      UNIQUE (observation_id, project_id),
      UNIQUE (project_id, producer, idempotency_key),
      FOREIGN KEY (observation_run_id, project_id)
        REFERENCES observation_runs(observation_run_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK (outcome <> 'absent' OR observed_value_json IS NULL),
      CHECK (outcome <> 'indeterminate' OR safe_reason_code IS NOT NULL)
    )
  `).execute(db)

  await sql.raw(`
    INSERT INTO observations_b3 SELECT * FROM observations
  `).execute(db)

  await sql.raw(`
    CREATE TABLE observation_artifact_links_b3 (
      artifact_id varchar(36) NOT NULL,
      project_id varchar(255) NOT NULL,
      observation_id varchar(36),
      gap_id varchar(36),
      ordinal integer NOT NULL CHECK (ordinal >= 0),
      PRIMARY KEY (artifact_id, observation_id, gap_id),
      FOREIGN KEY (artifact_id, project_id)
        REFERENCES observation_artifacts(artifact_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (observation_id, project_id)
        REFERENCES observations_b3(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (gap_id, project_id)
        REFERENCES observation_gaps(gap_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK ((observation_id IS NOT NULL AND gap_id IS NULL)
        OR (observation_id IS NULL AND gap_id IS NOT NULL))
    )
  `).execute(db)
  await sql.raw(`INSERT INTO observation_artifact_links_b3 SELECT * FROM observation_artifact_links`).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_observation_support_b3 (
      model_row_id integer NOT NULL,
      project_id varchar(255) NOT NULL,
      observation_id varchar(36) NOT NULL,
      claim_key varchar(255) NOT NULL,
      support_role varchar(20) NOT NULL CHECK (support_role IN ('basis', 'bounds')),
      characterization_policy_id varchar(255) NOT NULL,
      characterization_policy_version varchar(100) NOT NULL,
      linked_at varchar(50) NOT NULL,
      PRIMARY KEY (model_row_id, observation_id, claim_key, support_role),
      FOREIGN KEY (model_row_id) REFERENCES app_models(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (observation_id, project_id)
        REFERENCES observations_b3(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`INSERT INTO app_model_observation_support_b3 SELECT * FROM app_model_observation_support`).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_subject_support_b3 (
      model_row_id integer NOT NULL,
      project_id varchar(255) NOT NULL,
      canonical_subject_id varchar(255) NOT NULL,
      observation_id varchar(36) NOT NULL,
      claim_key varchar(255) NOT NULL,
      support_role varchar(20) NOT NULL CHECK (support_role = 'basis'),
      characterization_policy_id varchar(255) NOT NULL,
      characterization_policy_version varchar(100) NOT NULL,
      linked_at varchar(50) NOT NULL,
      PRIMARY KEY (model_row_id, canonical_subject_id, observation_id, claim_key, support_role),
      FOREIGN KEY (model_row_id) REFERENCES app_models(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (observation_id, project_id)
        REFERENCES observations_b3(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`INSERT INTO app_model_subject_support_b3 SELECT * FROM app_model_subject_support`).execute(db)

  await sql`DROP TABLE app_model_subject_support`.execute(db)
  await sql`DROP TABLE app_model_observation_support`.execute(db)
  await sql`DROP TABLE observation_artifact_links`.execute(db)
  await sql`DROP TABLE observations`.execute(db)
  await sql`ALTER TABLE observations_b3 RENAME TO observations`.execute(db)
  await sql`ALTER TABLE observation_artifact_links_b3 RENAME TO observation_artifact_links`.execute(db)
  await sql`ALTER TABLE app_model_observation_support_b3 RENAME TO app_model_observation_support`.execute(db)
  await sql`ALTER TABLE app_model_subject_support_b3 RENAME TO app_model_subject_support`.execute(db)

  await sql.raw(`
    CREATE TABLE observation_import_sources (
      project_id varchar(255) NOT NULL,
      source_kind varchar(50) NOT NULL CHECK (source_kind IN (
        'observation_file', 'bootstrap_evidence', 'agent_memory',
        'legacy_app_model_support', 'legacy_evidence_ledger',
        'verification_artifact', 'historical_artifact'
      )),
      source_path varchar(1000) NOT NULL,
      source_path_state varchar(20) NOT NULL CHECK (source_path_state IN ('present', 'unavailable')),
      source_schema varchar(255) NOT NULL,
      original_id varchar(255),
      original_id_state varchar(20) NOT NULL CHECK (original_id_state IN ('present', 'unavailable')),
      content_hash varchar(64) NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^a-f0-9]*'),
      capture_timestamp varchar(50),
      workspace_authority varchar(30) NOT NULL CHECK (workspace_authority = 'PRODUCT_WORKSPACE'),
      producer_identity varchar(255),
      producer_identity_state varchar(20) NOT NULL CHECK (producer_identity_state IN ('present', 'unavailable')),
      classification varchar(30) NOT NULL CHECK (classification IN ('clean', 'migratable', 'ambiguous', 'compatibility_only', 'unsupported')),
      legacy_provenance_class varchar(30) NOT NULL CHECK (legacy_provenance_class IN (
        'clean_direct', 'reconstructed', 'ambiguous', 'bootstrap_projection',
        'agent_memory', 'verification_compatibility', 'unsupported'
      )),
      reason_code varchar(100) NOT NULL,
      imported_observation_id varchar(36),
      imported_observation_run_id varchar(36),
      imported_at varchar(50) NOT NULL,
      import_policy_id varchar(255) NOT NULL,
      import_policy_version varchar(100) NOT NULL,
      PRIMARY KEY (project_id, source_kind, source_path, content_hash),
      FOREIGN KEY (imported_observation_id, project_id)
        REFERENCES observations(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (imported_observation_run_id, project_id)
        REFERENCES observation_runs(observation_run_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK ((imported_observation_id IS NULL AND imported_observation_run_id IS NULL)
        OR (imported_observation_id IS NOT NULL AND imported_observation_run_id IS NOT NULL
          AND classification IN ('clean', 'migratable')))
    )
  `).execute(db)

  await sql`CREATE UNIQUE INDEX uq_observation_artifact_ordinal ON observation_artifact_links (observation_id, ordinal) WHERE observation_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_gap_artifact_ordinal ON observation_artifact_links (gap_id, ordinal) WHERE gap_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_observation_artifact_identity ON observation_artifact_links (observation_id, artifact_id) WHERE observation_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_gap_artifact_identity ON observation_artifact_links (gap_id, artifact_id) WHERE gap_id IS NOT NULL`.execute(db)
  await sql`CREATE INDEX idx_observations_run_captured ON observations (observation_run_id, captured_at, observation_id)`.execute(db)
  await sql`CREATE INDEX idx_observations_subject_predicate ON observations (project_id, subject_id, predicate, captured_at, observation_id)`.execute(db)
  await sql`CREATE INDEX idx_model_observation_support_source ON app_model_observation_support (observation_id, model_row_id)`.execute(db)
  await sql`CREATE INDEX idx_model_subject_support_subject ON app_model_subject_support (model_row_id, canonical_subject_id)`.execute(db)
  await sql`CREATE INDEX idx_model_subject_support_source ON app_model_subject_support (observation_id, model_row_id)`.execute(db)
  await sql`CREATE INDEX idx_observation_import_classification ON observation_import_sources (project_id, classification, source_kind)`.execute(db)

  await sql.raw(`CREATE TRIGGER observation_artifact_links_closed_insert BEFORE INSERT ON observation_artifact_links WHEN NEW.observation_id IS NOT NULL BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM observations o WHERE o.observation_id = NEW.observation_id AND o.artifact_links_sealed = 1) THEN RAISE(ABORT, 'Observation artifact set is sealed') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER observations_immutable_update BEFORE UPDATE ON observations BEGIN SELECT CASE WHEN NOT (OLD.artifact_links_sealed = 0 AND NEW.artifact_links_sealed = 1 AND NEW.observation_id IS OLD.observation_id AND NEW.observation_run_id IS OLD.observation_run_id AND NEW.project_id IS OLD.project_id AND NEW.producer IS OLD.producer AND NEW.producer_version IS OLD.producer_version AND NEW.method IS OLD.method AND NEW.method_version IS OLD.method_version AND NEW.subject_id IS OLD.subject_id AND NEW.predicate IS OLD.predicate AND NEW.outcome IS OLD.outcome AND NEW.observed_value_json IS OLD.observed_value_json AND NEW.boundary_json IS OLD.boundary_json AND NEW.captured_at IS OLD.captured_at AND NEW.idempotency_key IS OLD.idempotency_key AND NEW.integrity_hash IS OLD.integrity_hash AND NEW.provenance_class IS OLD.provenance_class AND NEW.safe_reason_code IS OLD.safe_reason_code AND NEW.safe_message IS OLD.safe_message) THEN RAISE(ABORT, 'Observation is immutable') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER observations_immutable_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, 'Observation is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifact_links_immutable_update BEFORE UPDATE ON observation_artifact_links BEGIN SELECT RAISE(ABORT, 'Observation artifact linkage is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifact_links_immutable_delete BEFORE DELETE ON observation_artifact_links BEGIN SELECT RAISE(ABORT, 'Observation artifact linkage is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_observation_support_immutable_update BEFORE UPDATE ON app_model_observation_support BEGIN SELECT RAISE(ABORT, 'App Model Observation support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_observation_support_immutable_delete BEFORE DELETE ON app_model_observation_support BEGIN SELECT RAISE(ABORT, 'App Model Observation support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_subject_support_immutable_update BEFORE UPDATE ON app_model_subject_support BEGIN SELECT RAISE(ABORT, 'App Model subject support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_subject_support_immutable_delete BEFORE DELETE ON app_model_subject_support BEGIN SELECT RAISE(ABORT, 'App Model subject support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_observation_support_closed_insert BEFORE INSERT ON app_model_observation_support BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM app_model_support_seals seal WHERE seal.model_row_id = NEW.model_row_id) THEN RAISE(ABORT, 'App Model Observation support set is sealed') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_subject_support_closed_insert BEFORE INSERT ON app_model_subject_support BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM app_model_support_seals seal WHERE seal.model_row_id = NEW.model_row_id) THEN RAISE(ABORT, 'App Model subject support set is sealed') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER validate_app_model_observation_support_project BEFORE INSERT ON app_model_observation_support BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM app_models m WHERE m.id = NEW.model_row_id AND m.app_name = NEW.project_id) THEN RAISE(ABORT, 'App Model Observation support crosses project authority') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER validate_app_model_subject_support_project BEFORE INSERT ON app_model_subject_support BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM app_models m WHERE m.id = NEW.model_row_id AND m.app_name = NEW.project_id) THEN RAISE(ABORT, 'App Model subject support crosses project authority') END; END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_import_sources_immutable_update BEFORE UPDATE ON observation_import_sources BEGIN SELECT RAISE(ABORT, 'Observation import source metadata is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_import_sources_immutable_delete BEFORE DELETE ON observation_import_sources BEGIN SELECT RAISE(ABORT, 'Observation import source metadata is immutable'); END`).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  void db
  throw new Error('Migration 025 is intentionally irreversible because dropping its provenance ledger would fabricate historical state.')
}
