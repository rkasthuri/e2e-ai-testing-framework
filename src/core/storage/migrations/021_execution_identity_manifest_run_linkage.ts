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
import { currentMigrationDialect } from '../MigrationContext'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/

interface LegacyEvent {
  id: number
  execution_id: string
  project_id: string
  event_type: string
  outcome: string | null
  occurred_at: string
  process_instance_id: string
  safe_code: string | null
  safe_message: string
  execution_plan_hash: string
}

interface LegacyLock {
  project_id: string
  execution_id: string
  process_instance_id: string
  acquired_at: string
  last_heartbeat_at: string
}

interface TestSetRow {
  test_set_id: string
  revision: number
  project_id: string
  source_observation_id: string
  model_row_id: number
  model_version: string
  payload_json: string
  content_hash: string
}

interface ReconstructedExecution {
  executionId: string
  projectId: string
  acceptedAt: string
  testSetId: string
  testSetRevision: number
  modelRowId: number
  modelVersion: string
  sourceObservationId: string
  manifestHash: string
  definitionId: string
  executablePlanHash: string
}

function exactIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value
}

function migrationRefusal(reason: string): never {
  throw new Error(`Migration 021 refused ambiguous execution history: ${reason}`)
}

function stablePlanId(definitionId: string, testSetId: string, revision: number): string {
  return `plan-${crypto.createHash('sha256').update([definitionId, testSetId, revision].join('\u001f')).digest('hex').slice(0, 24)}`
}

/**
 * Frozen reconstruction of TD-UI-069C's semantic plan shape. Migration code
 * must not import a live projector whose future vocabulary could reinterpret
 * historical Migration 020 rows.
 */
function legacyPlanFingerprint(definition: any, row: TestSetRow): string | null {
  if (!definition || typeof definition !== 'object' || !SAFE_ID.test(definition.id)
    || typeof definition.title !== 'string' || definition.title.length < 1
    || definition.category !== 'navigation' || !Array.isArray(definition.steps)
    || definition.steps.length !== 1 || !definition.oracle
    || !definition.provenance || !Array.isArray(definition.provenance.supportingEvidenceIds)) return null
  const step = definition.steps[0]
  if (step.kind !== 'navigate_to_observed_route' || !SAFE_ID.test(step.subjectId)
    || typeof step.routePath !== 'string' || !step.routePath.startsWith('/')
    || definition.oracle.kind !== 'subject_observable'
    || definition.oracle.subjectId !== step.subjectId
    || definition.provenance.sourceObservationId !== row.source_observation_id
    || Number(definition.provenance.modelRowId) !== Number(row.model_row_id)
    || definition.provenance.modelVersion !== row.model_version
    || definition.authenticationRequired !== true && definition.authenticationRequired !== false) return null

  const semantic: any = {
    schemaVersion: 1,
    planId: stablePlanId(definition.id, row.test_set_id, Number(row.revision)),
    definitionId: definition.id,
    title: definition.title,
    category: 'navigation',
    steps: [{ kind: 'navigate_to_observed_route', subjectId: step.subjectId, routePath: step.routePath }],
    oracle: {
      kind: 'subject_observable',
      subjectId: definition.oracle.subjectId,
      assertion: 'final_url_matches_route_no_navigation_error',
    },
    provenance: {
      definitionId: definition.id,
      sourceObservationId: definition.provenance.sourceObservationId,
      modelRowId: Number(definition.provenance.modelRowId),
      modelVersion: definition.provenance.modelVersion,
      supportingEvidenceIds: [...definition.provenance.supportingEvidenceIds],
      testSetId: row.test_set_id,
      revision: Number(row.revision),
    },
    authenticationRequired: definition.authenticationRequired,
  }
  if (definition.authenticationSetup) {
    const setup = definition.authenticationSetup
    if (!definition.authenticationRequired || typeof setup.mechanism !== 'string'
      || !SAFE_ID.test(setup.credentialReference?.usernameEnv)
      || !SAFE_ID.test(setup.credentialReference?.passwordEnv)
      || setup.provenance?.sourceObservationId !== row.source_observation_id) return null
    semantic.authenticationSetup = {
      mechanism: setup.mechanism,
      credentialReference: {
        usernameEnv: setup.credentialReference.usernameEnv,
        passwordEnv: setup.credentialReference.passwordEnv,
      },
      provenance: { sourceObservationId: setup.provenance.sourceObservationId },
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex')
}

function parseCandidate(row: TestSetRow, manifestHash: string): ReconstructedExecution[] {
  if (!SAFE_ID.test(row.test_set_id) || !SAFE_ID.test(row.project_id)
    || !SAFE_ID.test(row.source_observation_id) || !Number.isSafeInteger(Number(row.revision))
    || Number(row.revision) < 1 || !Number.isSafeInteger(Number(row.model_row_id))
    || Number(row.model_row_id) < 1 || typeof row.model_version !== 'string'
    || row.model_version.length < 1 || !SHA256.test(row.content_hash)
    || crypto.createHash('sha256').update(row.payload_json).digest('hex') !== row.content_hash) {
    migrationRefusal(`test-set authority for project '${row.project_id}' is malformed`)
  }
  let payload: any
  try { payload = JSON.parse(row.payload_json) } catch { migrationRefusal(`test-set payload for project '${row.project_id}' is not valid JSON`) }
  if (!payload || payload.schemaVersion !== 1 || payload.testSetId !== row.test_set_id
    || Number(payload.revision) !== Number(row.revision) || payload.projectId !== row.project_id
    || payload.sourceObservationId !== row.source_observation_id
    || Number(payload.modelRowId) !== Number(row.model_row_id) || payload.modelVersion !== row.model_version
    || !Array.isArray(payload.definitions)) {
    migrationRefusal(`test-set row and payload authority disagree for project '${row.project_id}'`)
  }
  return payload.definitions.flatMap((definition: any) => {
    const fingerprint = legacyPlanFingerprint(definition, row)
    return fingerprint === manifestHash ? [{
      executionId: '', projectId: row.project_id, acceptedAt: '',
      testSetId: row.test_set_id, testSetRevision: Number(row.revision),
      modelRowId: Number(row.model_row_id), modelVersion: row.model_version,
      sourceObservationId: row.source_observation_id, manifestHash,
      definitionId: definition.id, executablePlanHash: fingerprint,
    }] : []
  })
}

async function reconstructExecutions(db: Kysely<any>): Promise<ReconstructedExecution[]> {
  const events = await db.selectFrom('execution_events').selectAll().orderBy('id').execute() as LegacyEvent[]
  const locks = await db.selectFrom('execution_locks').selectAll().execute() as LegacyLock[]
  if (events.length === 0 && locks.length === 0) return []

  const byExecution = new Map<string, LegacyEvent[]>()
  for (const event of events) {
    if (!SAFE_ID.test(event.execution_id) || !SAFE_ID.test(event.project_id)
      || !SAFE_ID.test(event.process_instance_id) || !SHA256.test(event.execution_plan_hash)
      || !exactIso(event.occurred_at) || typeof event.safe_message !== 'string'
      || !['started', 'terminal'].includes(event.event_type)) {
      migrationRefusal(`execution event ${event.id} is malformed`)
    }
    const group = byExecution.get(event.execution_id) ?? []
    group.push(event)
    byExecution.set(event.execution_id, group)
  }
  for (const lock of locks) {
    if (!SAFE_ID.test(lock.execution_id) || !SAFE_ID.test(lock.project_id)
      || !SAFE_ID.test(lock.process_instance_id) || !exactIso(lock.acquired_at)
      || !exactIso(lock.last_heartbeat_at) || lock.last_heartbeat_at < lock.acquired_at) {
      migrationRefusal(`execution lock for project '${lock.project_id}' is malformed`)
    }
    const group = byExecution.get(lock.execution_id)
    const started = group?.filter(event => event.event_type === 'started') ?? []
    if (started.length !== 1 || started[0].project_id !== lock.project_id
      || started[0].process_instance_id !== lock.process_instance_id
      || group?.some(event => event.event_type === 'terminal')) {
      migrationRefusal(`execution lock '${lock.execution_id}' is orphaned or conflicts with lifecycle truth`)
    }
  }

  const testSetsByProject = new Map<string, TestSetRow[]>()
  const rows = await db.selectFrom('test_set_revisions').select([
    'test_set_id', 'revision', 'project_id', 'source_observation_id', 'model_row_id',
    'model_version', 'payload_json', 'content_hash',
  ]).execute() as TestSetRow[]
  for (const row of rows) {
    const projectRows = testSetsByProject.get(row.project_id) ?? []
    projectRows.push(row)
    testSetsByProject.set(row.project_id, projectRows)
  }

  const reconstructed: ReconstructedExecution[] = []
  for (const [executionId, group] of byExecution) {
    const started = group.filter(event => event.event_type === 'started')
    const terminal = group.filter(event => event.event_type === 'terminal')
    if (started.length !== 1 || terminal.length > 1) migrationRefusal(`execution '${executionId}' has conflicting started or terminal identity`)
    const root = started[0]
    if (root.outcome !== null || root.safe_code !== null
      || group.some(event => event.project_id !== root.project_id
        || event.process_instance_id !== root.process_instance_id
        || event.execution_plan_hash !== root.execution_plan_hash)
      || terminal.some(event => !event.outcome || event.occurred_at < root.occurred_at)) {
      migrationRefusal(`execution '${executionId}' has internally conflicting lifecycle evidence`)
    }
    const candidates = (testSetsByProject.get(root.project_id) ?? [])
      .flatMap(row => parseCandidate(row, root.execution_plan_hash))
    if (candidates.length !== 1) {
      migrationRefusal(`execution '${executionId}' manifest is not uniquely reconstructable from historical test-set authority`)
    }
    reconstructed.push({ ...candidates[0], executionId, acceptedAt: root.occurred_at })
  }
  return reconstructed
}

export async function up(db: Kysely<any>): Promise<void> {
  if (currentMigrationDialect() !== 'sqlite') throw new Error('Migration 021 is governed for SQLite workspace databases only.')
  const reconstructed = await reconstructExecutions(db)

  await sql.raw(`
    CREATE TABLE executions (
      execution_id varchar(255) NOT NULL PRIMARY KEY,
      project_id varchar(255) NOT NULL,
      accepted_at varchar(50) NOT NULL,
      test_set_id varchar(255) NOT NULL,
      test_set_revision integer NOT NULL CHECK (test_set_revision > 0),
      model_row_id integer NOT NULL CHECK (model_row_id > 0),
      model_version varchar(50) NOT NULL,
      source_observation_id varchar(255) NOT NULL,
      manifest_hash varchar(64) NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
      max_run_attempts integer NOT NULL CHECK (max_run_attempts > 0),
      dispatch_mode varchar(20) NOT NULL CHECK (dispatch_mode = 'serial'),
      stop_rule varchar(50) NOT NULL CHECK (stop_rule = 'stop_on_first_non_completed')
    )
  `).execute(db)
  await sql.raw(`
    CREATE TABLE execution_items (
      execution_id varchar(255) NOT NULL,
      item_ordinal integer NOT NULL CHECK (item_ordinal > 0),
      definition_id varchar(255) NOT NULL,
      executable_plan_hash varchar(64) NOT NULL CHECK (length(executable_plan_hash) = 64 AND executable_plan_hash NOT GLOB '*[^a-f0-9]*'),
      PRIMARY KEY (execution_id, item_ordinal),
      UNIQUE (execution_id, definition_id),
      FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql`CREATE INDEX idx_executions_project_accepted ON executions (project_id, accepted_at)`.execute(db)

  for (const execution of reconstructed) {
    await db.insertInto('executions').values({
      execution_id: execution.executionId, project_id: execution.projectId,
      accepted_at: execution.acceptedAt, test_set_id: execution.testSetId,
      test_set_revision: execution.testSetRevision, model_row_id: execution.modelRowId,
      model_version: execution.modelVersion, source_observation_id: execution.sourceObservationId,
      manifest_hash: execution.manifestHash, max_run_attempts: 1,
      dispatch_mode: 'serial', stop_rule: 'stop_on_first_non_completed',
    }).execute()
    await db.insertInto('execution_items').values({
      execution_id: execution.executionId, item_ordinal: 1,
      definition_id: execution.definitionId, executable_plan_hash: execution.executablePlanHash,
    }).execute()
  }

  await sql.raw(`
    CREATE TABLE execution_events_021 (
      id integer PRIMARY KEY AUTOINCREMENT,
      execution_id varchar(255) NOT NULL,
      project_id varchar(255) NOT NULL,
      event_type varchar(20) NOT NULL,
      outcome varchar(50),
      occurred_at varchar(50) NOT NULL,
      process_instance_id varchar(255) NOT NULL,
      safe_code varchar(100),
      safe_message text NOT NULL,
      execution_plan_hash varchar(64) NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`INSERT INTO execution_events_021 SELECT * FROM execution_events ORDER BY id`).execute(db)
  await sql`DROP TABLE execution_events`.execute(db)
  await sql`ALTER TABLE execution_events_021 RENAME TO execution_events`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_execution_started ON execution_events (execution_id) WHERE event_type = 'started'`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_execution_terminal ON execution_events (execution_id) WHERE event_type = 'terminal'`.execute(db)
  await sql`CREATE INDEX idx_execution_project_identity ON execution_events (project_id, execution_id)`.execute(db)

  await sql.raw(`
    CREATE TABLE execution_locks_021 (
      project_id varchar(255) PRIMARY KEY,
      execution_id varchar(255) NOT NULL UNIQUE,
      process_instance_id varchar(255) NOT NULL,
      acquired_at varchar(50) NOT NULL,
      last_heartbeat_at varchar(50) NOT NULL,
      FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`INSERT INTO execution_locks_021 SELECT * FROM execution_locks`).execute(db)
  await sql`DROP TABLE execution_locks`.execute(db)
  await sql`ALTER TABLE execution_locks_021 RENAME TO execution_locks`.execute(db)

  await sql.raw(`
    CREATE TABLE runs_021 (
      id integer PRIMARY KEY AUTOINCREMENT,
      run_id varchar(255) NOT NULL UNIQUE,
      app_name varchar(255) NOT NULL,
      branch varchar(255) NOT NULL DEFAULT 'unknown',
      commit_sha varchar(255) NOT NULL DEFAULT 'unknown',
      environment varchar(50) NOT NULL DEFAULT 'local',
      base_url varchar(500) NOT NULL DEFAULT '',
      triggered_by varchar(50) NOT NULL DEFAULT 'manual',
      reporter_version varchar(50) NOT NULL DEFAULT 'unknown',
      status varchar(50) NOT NULL DEFAULT 'unknown',
      total_tests integer NOT NULL DEFAULT 0,
      passed integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      skipped integer NOT NULL DEFAULT 0,
      duration_ms integer NOT NULL DEFAULT 0,
      started_at varchar(50) NOT NULL,
      completed_at varchar(50),
      metadata text NOT NULL DEFAULT '{}',
      input_health varchar(20) NOT NULL DEFAULT 'unknown',
      input_health_reason varchar(50),
      lifecycle varchar(50) NOT NULL DEFAULT 'completed',
      execution_id varchar(255),
      origin varchar(20) NOT NULL DEFAULT 'legacy' CHECK (origin IN ('legacy', 'product')),
      attempt_ordinal integer,
      CHECK ((origin = 'legacy' AND execution_id IS NULL AND attempt_ordinal IS NULL)
        OR (origin = 'product' AND execution_id IS NOT NULL AND attempt_ordinal > 0)),
      FOREIGN KEY (execution_id) REFERENCES executions(execution_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`
    INSERT INTO runs_021 (
      id, run_id, app_name, branch, commit_sha, environment, base_url, triggered_by,
      reporter_version, status, total_tests, passed, failed, skipped, duration_ms,
      started_at, completed_at, metadata, input_health, input_health_reason, lifecycle,
      execution_id, origin, attempt_ordinal
    ) SELECT id, run_id, app_name, branch, commit_sha, environment, base_url, triggered_by,
      reporter_version, status, total_tests, passed, failed, skipped, duration_ms,
      started_at, completed_at, metadata, input_health, input_health_reason, lifecycle,
      NULL, 'legacy', NULL FROM runs
  `).execute(db)
  await sql`DROP TABLE runs`.execute(db)
  await sql`ALTER TABLE runs_021 RENAME TO runs`.execute(db)
  await sql`CREATE INDEX idx_runs_run_id ON runs (run_id)`.execute(db)
  await sql`CREATE INDEX idx_runs_app_started ON runs (app_name, started_at)`.execute(db)
  await sql`CREATE INDEX idx_runs_status ON runs (status)`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_runs_execution_attempt ON runs (execution_id, attempt_ordinal) WHERE origin = 'product'`.execute(db)

  await sql.raw(`
    CREATE TABLE test_results_021 (
      id integer PRIMARY KEY AUTOINCREMENT,
      run_id varchar(255) NOT NULL,
      test_id varchar(255) NOT NULL,
      title text NOT NULL,
      suite varchar(255) NOT NULL,
      status varchar(50) NOT NULL,
      duration_ms integer NOT NULL DEFAULT 0,
      retry_count integer NOT NULL DEFAULT 0,
      error_msg text,
      browser varchar(50) NOT NULL DEFAULT 'unknown',
      tier varchar(50) NOT NULL DEFAULT 'ui',
      started_at varchar(50) NOT NULL DEFAULT '',
      worker_index integer NOT NULL DEFAULT 0,
      tags text NOT NULL DEFAULT '[]',
      flaky_history integer NOT NULL DEFAULT 0,
      screenshot_path text,
      video_path text,
      metadata text NOT NULL DEFAULT '{}',
      result_id varchar(255),
      execution_item_ordinal integer,
      definition_id varchar(255),
      executable_plan_hash varchar(64),
      CHECK ((result_id IS NULL AND execution_item_ordinal IS NULL AND definition_id IS NULL AND executable_plan_hash IS NULL)
        OR (result_id IS NOT NULL AND execution_item_ordinal > 0 AND definition_id IS NOT NULL
          AND length(executable_plan_hash) = 64 AND executable_plan_hash NOT GLOB '*[^a-f0-9]*')),
      FOREIGN KEY (run_id) REFERENCES runs(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    )
  `).execute(db)
  await sql.raw(`
    INSERT INTO test_results_021 (
      id, run_id, test_id, title, suite, status, duration_ms, retry_count, error_msg,
      browser, tier, started_at, worker_index, tags, flaky_history, screenshot_path,
      video_path, metadata, result_id, execution_item_ordinal, definition_id, executable_plan_hash
    ) SELECT id, run_id, test_id, title, suite, status, duration_ms, retry_count, error_msg,
      browser, tier, started_at, worker_index, tags, flaky_history, screenshot_path,
      video_path, metadata, NULL, NULL, NULL, NULL FROM test_results
  `).execute(db)
  await sql`DROP TABLE test_results`.execute(db)
  await sql`ALTER TABLE test_results_021 RENAME TO test_results`.execute(db)
  await sql`CREATE INDEX idx_results_run_id ON test_results (run_id)`.execute(db)
  await sql`CREATE INDEX idx_results_test_status ON test_results (test_id, status)`.execute(db)
  await sql`CREATE INDEX idx_results_suite ON test_results (suite)`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_results_result_id ON test_results (result_id) WHERE result_id IS NOT NULL`.execute(db)
  await sql`CREATE UNIQUE INDEX uq_results_run_manifest_item ON test_results (run_id, execution_item_ordinal) WHERE result_id IS NOT NULL`.execute(db)

  await sql.raw(`
    CREATE TRIGGER validate_product_result_insert
    BEFORE INSERT ON test_results WHEN NEW.result_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM runs r JOIN execution_items i
          ON i.execution_id = r.execution_id
         AND i.item_ordinal = NEW.execution_item_ordinal
         AND i.definition_id = NEW.definition_id
         AND i.executable_plan_hash = NEW.executable_plan_hash
        WHERE r.run_id = NEW.run_id AND r.origin = 'product'
      ) THEN RAISE(ABORT, 'Product result does not match its Run execution manifest') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_execution_event_insert
    BEFORE INSERT ON execution_events
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM executions x WHERE x.execution_id = NEW.execution_id
          AND x.project_id = NEW.project_id AND x.manifest_hash = NEW.execution_plan_hash
      ) THEN RAISE(ABORT, 'Execution event does not match its immutable Execution root') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_execution_event_update
    BEFORE UPDATE OF execution_id, project_id, execution_plan_hash ON execution_events
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM executions x WHERE x.execution_id = NEW.execution_id
          AND x.project_id = NEW.project_id AND x.manifest_hash = NEW.execution_plan_hash
      ) THEN RAISE(ABORT, 'Execution event does not match its immutable Execution root') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_execution_lock_insert
    BEFORE INSERT ON execution_locks
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM executions x WHERE x.execution_id = NEW.execution_id AND x.project_id = NEW.project_id
      ) THEN RAISE(ABORT, 'Execution lock does not match its immutable Execution root') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_lock_identity_immutable
    BEFORE UPDATE OF project_id, execution_id, process_instance_id, acquired_at ON execution_locks
    WHEN OLD.project_id IS NOT NEW.project_id OR OLD.execution_id IS NOT NEW.execution_id
      OR OLD.process_instance_id IS NOT NEW.process_instance_id OR OLD.acquired_at IS NOT NEW.acquired_at
    BEGIN SELECT RAISE(ABORT, 'Execution lock identity is immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_product_run_insert
    BEFORE INSERT ON runs WHEN NEW.origin = 'product'
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM executions x WHERE x.execution_id = NEW.execution_id AND x.project_id = NEW.app_name
      ) THEN RAISE(ABORT, 'Product Run does not match its Execution project') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER validate_product_result_update
    BEFORE UPDATE OF run_id, result_id, execution_item_ordinal, definition_id, executable_plan_hash ON test_results
    WHEN NEW.result_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM runs r JOIN execution_items i
          ON i.execution_id = r.execution_id
         AND i.item_ordinal = NEW.execution_item_ordinal
         AND i.definition_id = NEW.definition_id
         AND i.executable_plan_hash = NEW.executable_plan_hash
        WHERE r.run_id = NEW.run_id AND r.origin = 'product'
      ) THEN RAISE(ABORT, 'Product result does not match its Run execution manifest') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER prevent_product_fields_on_legacy_result_insert
    BEFORE INSERT ON test_results WHEN NEW.result_id IS NULL
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM runs r WHERE r.run_id = NEW.run_id AND r.origin = 'product')
        THEN RAISE(ABORT, 'Product Run requires canonical Result provenance') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER prevent_missing_product_result_provenance_update
    BEFORE UPDATE OF run_id, result_id, execution_item_ordinal, definition_id, executable_plan_hash ON test_results
    WHEN NEW.result_id IS NULL
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM runs r WHERE r.run_id = NEW.run_id AND r.origin = 'product')
        THEN RAISE(ABORT, 'Product Run requires canonical Result provenance') END;
    END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER product_result_identity_immutable
    BEFORE UPDATE OF result_id, execution_item_ordinal, definition_id, executable_plan_hash ON test_results
    WHEN OLD.result_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'Product Result identity and provenance are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER run_execution_linkage_immutable
    BEFORE UPDATE OF execution_id, origin, attempt_ordinal ON runs
    WHEN OLD.execution_id IS NOT NEW.execution_id OR OLD.origin IS NOT NEW.origin OR OLD.attempt_ordinal IS NOT NEW.attempt_ordinal
    BEGIN SELECT RAISE(ABORT, 'Run execution linkage is immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER executions_immutable_update BEFORE UPDATE ON executions
    BEGIN SELECT RAISE(ABORT, 'Execution roots are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_events_immutable_update BEFORE UPDATE ON execution_events
    BEGIN SELECT RAISE(ABORT, 'Execution events are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_events_immutable_delete BEFORE DELETE ON execution_events
    BEGIN SELECT RAISE(ABORT, 'Execution events are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER executions_immutable_delete BEFORE DELETE ON executions
    BEGIN SELECT RAISE(ABORT, 'Execution roots are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_items_immutable_update BEFORE UPDATE ON execution_items
    BEGIN SELECT RAISE(ABORT, 'Execution manifest items are immutable'); END
  `).execute(db)
  await sql.raw(`
    CREATE TRIGGER execution_items_immutable_delete BEFORE DELETE ON execution_items
    BEGIN SELECT RAISE(ABORT, 'Execution manifest items are immutable'); END
  `).execute(db)
}
