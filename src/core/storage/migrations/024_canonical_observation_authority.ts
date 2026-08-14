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
 * TD-ARCH-003-B1 — the minimum schema exercised by the canonical crawl
 * Observation vertical. Correction, conflict, and retention-event tables are
 * deliberately deferred until a producer exercises them.
 */
export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') {
    throw new Error('Migration 024 is governed for SQLite workspace databases only.')
  }

  await sql.raw(`
    CREATE TABLE observation_runs (
      observation_run_id varchar(36) NOT NULL PRIMARY KEY,
      project_id varchar(255) NOT NULL,
      workspace_authority varchar(30) NOT NULL CHECK (workspace_authority = 'PRODUCT_WORKSPACE'),
      operation_id varchar(255) NOT NULL,
      producer varchar(255) NOT NULL,
      producer_version varchar(100) NOT NULL,
      producer_instance_id varchar(36) NOT NULL,
      producer_process_id integer NOT NULL CHECK (producer_process_id > 0),
      acquisition_kind varchar(30) NOT NULL CHECK (acquisition_kind IN ('web_crawl', 'api_crawl')),
      started_at varchar(50) NOT NULL,
      terminal_at varchar(50),
      lifecycle varchar(20) NOT NULL CHECK (lifecycle IN ('running', 'completed', 'blocked', 'failed', 'interrupted')),
      completeness varchar(20) CHECK (completeness IN ('complete', 'partial', 'unobserved')),
      safe_reason_code varchar(100),
      safe_message varchar(500),
      policy_id varchar(255) NOT NULL,
      policy_version varchar(100) NOT NULL,
      acquisition_plan_hash varchar(64) NOT NULL CHECK (length(acquisition_plan_hash) = 64 AND acquisition_plan_hash NOT GLOB '*[^a-f0-9]*'),
      UNIQUE (observation_run_id, project_id),
      UNIQUE (project_id, producer, operation_id),
      CHECK (
        (lifecycle = 'running' AND terminal_at IS NULL AND completeness IS NULL AND safe_reason_code IS NULL)
        OR
        (lifecycle <> 'running' AND terminal_at IS NOT NULL AND completeness IS NOT NULL
          AND (lifecycle = 'completed' AND completeness = 'complete' OR safe_reason_code IS NOT NULL))
      )
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE observation_artifacts (
      artifact_id varchar(36) NOT NULL PRIMARY KEY,
      observation_run_id varchar(36) NOT NULL,
      project_id varchar(255) NOT NULL,
      storage_key varchar(500) NOT NULL,
      sha256 varchar(64) NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
      media_type varchar(100) NOT NULL,
      byte_size integer NOT NULL CHECK (byte_size >= 0),
      sensitivity_class varchar(30) NOT NULL CHECK (sensitivity_class IN ('internal', 'sensitive')),
      redaction_state varchar(30) NOT NULL CHECK (redaction_state IN ('not_required', 'redacted')),
      captured_at varchar(50) NOT NULL,
      retention_class varchar(50) NOT NULL CHECK (retention_class IN ('short_lived_diagnostic', 'standard_diagnostic', 'forensic_pinned')),
      retention_policy_id varchar(255) NOT NULL,
      retention_policy_version varchar(100) NOT NULL,
      expires_at varchar(50),
      UNIQUE (project_id, storage_key),
      UNIQUE (artifact_id, project_id),
      FOREIGN KEY (observation_run_id, project_id)
        REFERENCES observation_runs(observation_run_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK ((retention_class = 'forensic_pinned' AND expires_at IS NULL)
        OR retention_class <> 'forensic_pinned')
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE observations (
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
      provenance_class varchar(30) NOT NULL CHECK (provenance_class = 'native'),
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
    CREATE TABLE observation_gaps (
      gap_id varchar(36) NOT NULL PRIMARY KEY,
      observation_run_id varchar(36) NOT NULL,
      project_id varchar(255) NOT NULL,
      producer varchar(255) NOT NULL,
      producer_version varchar(100) NOT NULL,
      intended_method varchar(100) NOT NULL,
      intended_method_version varchar(100) NOT NULL,
      intended_subject_id varchar(255) NOT NULL,
      intended_predicate varchar(255) NOT NULL,
      boundary_json text NOT NULL CHECK (json_valid(boundary_json)),
      reason varchar(50) NOT NULL CHECK (reason IN (
        'not_reached', 'acquisition_failed', 'boundary_incomplete',
        'producer_interrupted', 'unsupported_method', 'prerequisite_blocked',
        'redaction_failed', 'artifact_persistence_failed'
      )),
      occurred_at varchar(50) NOT NULL,
      idempotency_key varchar(255) NOT NULL,
      integrity_hash varchar(64) NOT NULL CHECK (length(integrity_hash) = 64 AND integrity_hash NOT GLOB '*[^a-f0-9]*'),
      safe_message varchar(500),
      UNIQUE (gap_id, project_id),
      UNIQUE (project_id, producer, idempotency_key),
      FOREIGN KEY (observation_run_id, project_id)
        REFERENCES observation_runs(observation_run_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE observation_artifact_links (
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
        REFERENCES observations(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (gap_id, project_id)
        REFERENCES observation_gaps(gap_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK ((observation_id IS NOT NULL AND gap_id IS NULL)
        OR (observation_id IS NULL AND gap_id IS NOT NULL))
    )
  `).execute(db)
  await sql`CREATE UNIQUE INDEX uq_observation_artifact_ordinal ON observation_artifact_links (observation_id, ordinal) WHERE observation_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_gap_artifact_ordinal ON observation_artifact_links (gap_id, ordinal) WHERE gap_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_observation_artifact_identity ON observation_artifact_links (observation_id, artifact_id) WHERE observation_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_gap_artifact_identity ON observation_artifact_links (gap_id, artifact_id) WHERE gap_id IS NOT NULL`.execute(db)

  await sql.raw(`
    CREATE TRIGGER observation_artifact_links_closed_insert
    BEFORE INSERT ON observation_artifact_links
    WHEN NEW.observation_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM observations o
        WHERE o.observation_id = NEW.observation_id AND o.artifact_links_sealed = 1
      ) THEN RAISE(ABORT, 'Observation artifact set is sealed') END;
    END
  `).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_observation_support (
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
        REFERENCES observations(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_subject_support (
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
        REFERENCES observations(observation_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_gap_support (
      model_row_id integer NOT NULL,
      project_id varchar(255) NOT NULL,
      gap_id varchar(36) NOT NULL,
      claim_key varchar(255) NOT NULL,
      support_role varchar(20) NOT NULL CHECK (support_role = 'bounds'),
      characterization_policy_id varchar(255) NOT NULL,
      characterization_policy_version varchar(100) NOT NULL,
      linked_at varchar(50) NOT NULL,
      PRIMARY KEY (model_row_id, gap_id, claim_key),
      FOREIGN KEY (model_row_id) REFERENCES app_models(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (gap_id, project_id)
        REFERENCES observation_gaps(gap_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)

  await sql.raw(`
    CREATE TABLE app_model_support_seals (
      model_row_id integer NOT NULL PRIMARY KEY,
      project_id varchar(255) NOT NULL,
      observation_run_id varchar(36) NOT NULL,
      characterization_policy_id varchar(255) NOT NULL,
      characterization_policy_version varchar(100) NOT NULL,
      support_hash varchar(64) NOT NULL CHECK (length(support_hash) = 64 AND support_hash NOT GLOB '*[^a-f0-9]*'),
      sealed_at varchar(50) NOT NULL,
      FOREIGN KEY (model_row_id) REFERENCES app_models(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      FOREIGN KEY (observation_run_id, project_id)
        REFERENCES observation_runs(observation_run_id, project_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)

  await sql`CREATE INDEX idx_observations_run_captured ON observations (observation_run_id, captured_at, observation_id)`.execute(db)
  await sql`CREATE INDEX idx_observations_subject_predicate ON observations (project_id, subject_id, predicate, captured_at, observation_id)`.execute(db)
  await sql`CREATE INDEX idx_gaps_run_occurred ON observation_gaps (observation_run_id, occurred_at, gap_id)`.execute(db)
  await sql`CREATE INDEX idx_artifacts_run_captured ON observation_artifacts (observation_run_id, captured_at, artifact_id)`.execute(db)
  await sql`CREATE INDEX idx_model_observation_support_source ON app_model_observation_support (observation_id, model_row_id)`.execute(db)
  await sql`CREATE INDEX idx_model_subject_support_subject ON app_model_subject_support (model_row_id, canonical_subject_id)`.execute(db)
  await sql`CREATE INDEX idx_model_subject_support_source ON app_model_subject_support (observation_id, model_row_id)`.execute(db)
  await sql`CREATE INDEX idx_model_gap_support_source ON app_model_gap_support (gap_id, model_row_id)`.execute(db)

  await sql.raw(`
    CREATE TRIGGER observation_run_terminalize_once
    BEFORE UPDATE ON observation_runs
    BEGIN
      SELECT CASE WHEN OLD.lifecycle <> 'running'
        THEN RAISE(ABORT, 'ObservationRun is already terminal') END;
      SELECT CASE WHEN NEW.observation_run_id IS NOT OLD.observation_run_id
        OR NEW.project_id IS NOT OLD.project_id
        OR NEW.workspace_authority IS NOT OLD.workspace_authority
        OR NEW.operation_id IS NOT OLD.operation_id
        OR NEW.producer IS NOT OLD.producer
        OR NEW.producer_version IS NOT OLD.producer_version
        OR NEW.producer_instance_id IS NOT OLD.producer_instance_id
        OR NEW.producer_process_id IS NOT OLD.producer_process_id
        OR NEW.acquisition_kind IS NOT OLD.acquisition_kind
        OR NEW.started_at IS NOT OLD.started_at
        OR NEW.policy_id IS NOT OLD.policy_id
        OR NEW.policy_version IS NOT OLD.policy_version
        OR NEW.acquisition_plan_hash IS NOT OLD.acquisition_plan_hash
        THEN RAISE(ABORT, 'ObservationRun identity and admission are immutable') END;
      SELECT CASE WHEN NEW.lifecycle = 'running'
        THEN RAISE(ABORT, 'ObservationRun terminalization must be terminal') END;
    END
  `).execute(db)

  await sql.raw(`CREATE TRIGGER observation_runs_immutable_delete BEFORE DELETE ON observation_runs BEGIN SELECT RAISE(ABORT, 'ObservationRun is immutable'); END`).execute(db)
  await sql.raw(`
    CREATE TRIGGER observations_immutable_update
    BEFORE UPDATE ON observations
    BEGIN
      SELECT CASE WHEN NOT (
        OLD.artifact_links_sealed = 0 AND NEW.artifact_links_sealed = 1
        AND NEW.observation_id IS OLD.observation_id
        AND NEW.observation_run_id IS OLD.observation_run_id
        AND NEW.project_id IS OLD.project_id
        AND NEW.producer IS OLD.producer
        AND NEW.producer_version IS OLD.producer_version
        AND NEW.method IS OLD.method
        AND NEW.method_version IS OLD.method_version
        AND NEW.subject_id IS OLD.subject_id
        AND NEW.predicate IS OLD.predicate
        AND NEW.outcome IS OLD.outcome
        AND NEW.observed_value_json IS OLD.observed_value_json
        AND NEW.boundary_json IS OLD.boundary_json
        AND NEW.captured_at IS OLD.captured_at
        AND NEW.idempotency_key IS OLD.idempotency_key
        AND NEW.integrity_hash IS OLD.integrity_hash
        AND NEW.provenance_class IS OLD.provenance_class
        AND NEW.safe_reason_code IS OLD.safe_reason_code
        AND NEW.safe_message IS OLD.safe_message
      ) THEN RAISE(ABORT, 'Observation is immutable') END;
    END
  `).execute(db)
  await sql.raw(`CREATE TRIGGER observations_immutable_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, 'Observation is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_gaps_immutable_update BEFORE UPDATE ON observation_gaps BEGIN SELECT RAISE(ABORT, 'ObservationGap is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_gaps_immutable_delete BEFORE DELETE ON observation_gaps BEGIN SELECT RAISE(ABORT, 'ObservationGap is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifacts_immutable_update BEFORE UPDATE ON observation_artifacts BEGIN SELECT RAISE(ABORT, 'Observation artifact metadata is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifacts_immutable_delete BEFORE DELETE ON observation_artifacts BEGIN SELECT RAISE(ABORT, 'Observation artifact metadata is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifact_links_immutable_update BEFORE UPDATE ON observation_artifact_links BEGIN SELECT RAISE(ABORT, 'Observation artifact linkage is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER observation_artifact_links_immutable_delete BEFORE DELETE ON observation_artifact_links BEGIN SELECT RAISE(ABORT, 'Observation artifact linkage is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_observation_support_immutable_update BEFORE UPDATE ON app_model_observation_support BEGIN SELECT RAISE(ABORT, 'App Model Observation support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_observation_support_immutable_delete BEFORE DELETE ON app_model_observation_support BEGIN SELECT RAISE(ABORT, 'App Model Observation support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_subject_support_immutable_update BEFORE UPDATE ON app_model_subject_support BEGIN SELECT RAISE(ABORT, 'App Model subject support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_subject_support_immutable_delete BEFORE DELETE ON app_model_subject_support BEGIN SELECT RAISE(ABORT, 'App Model subject support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_gap_support_immutable_update BEFORE UPDATE ON app_model_gap_support BEGIN SELECT RAISE(ABORT, 'App Model gap support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_gap_support_immutable_delete BEFORE DELETE ON app_model_gap_support BEGIN SELECT RAISE(ABORT, 'App Model gap support is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_support_seals_immutable_update BEFORE UPDATE ON app_model_support_seals BEGIN SELECT RAISE(ABORT, 'App Model support seal is immutable'); END`).execute(db)
  await sql.raw(`CREATE TRIGGER app_model_support_seals_immutable_delete BEFORE DELETE ON app_model_support_seals BEGIN SELECT RAISE(ABORT, 'App Model support seal is immutable'); END`).execute(db)
  for (const [table, label] of [
    ['app_model_observation_support', 'Observation'],
    ['app_model_subject_support', 'subject'],
    ['app_model_gap_support', 'gap'],
  ] as const) {
    await sql.raw(`
      CREATE TRIGGER ${table}_closed_insert
      BEFORE INSERT ON ${table}
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM app_model_support_seals seal WHERE seal.model_row_id = NEW.model_row_id
        ) THEN RAISE(ABORT, 'App Model ${label} support set is sealed') END;
      END
    `).execute(db)
  }

  await sql.raw(`
    CREATE TRIGGER validate_app_model_observation_support_project
    BEFORE INSERT ON app_model_observation_support
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM app_models m WHERE m.id = NEW.model_row_id AND m.app_name = NEW.project_id
      ) THEN RAISE(ABORT, 'App Model Observation support crosses project authority') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_app_model_subject_support_project
    BEFORE INSERT ON app_model_subject_support
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM app_models m WHERE m.id = NEW.model_row_id AND m.app_name = NEW.project_id
      ) THEN RAISE(ABORT, 'App Model subject support crosses project authority') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_app_model_gap_support_project
    BEFORE INSERT ON app_model_gap_support
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM app_models m WHERE m.id = NEW.model_row_id AND m.app_name = NEW.project_id
      ) THEN RAISE(ABORT, 'App Model gap support crosses project authority') END;
    END
  `).execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS app_model_support_seals`.execute(db)
  await sql`DROP TABLE IF EXISTS app_model_gap_support`.execute(db)
  await sql`DROP TABLE IF EXISTS app_model_subject_support`.execute(db)
  await sql`DROP TABLE IF EXISTS app_model_observation_support`.execute(db)
  await sql`DROP TABLE IF EXISTS observation_artifact_links`.execute(db)
  await sql`DROP TABLE IF EXISTS observation_gaps`.execute(db)
  await sql`DROP TABLE IF EXISTS observations`.execute(db)
  await sql`DROP TABLE IF EXISTS observation_artifacts`.execute(db)
  await sql`DROP TABLE IF EXISTS observation_runs`.execute(db)
}
