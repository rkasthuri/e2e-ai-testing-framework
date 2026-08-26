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

import { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ── Runs ──────────────────────────────────────────────────────────────────────
export interface RunsTable {
  id:                Generated<number>;
  run_id:            string;
  app_name:          string;
  branch:            string;
  commit_sha:        string;
  environment:       string;
  base_url:          string;
  triggered_by:      string;
  reporter_version:  string;
  status:            string;
  total_tests:       number;
  passed:            number;
  failed:            number;
  skipped:           number;
  duration_ms:       number;
  started_at:        string;
  // TD-126: nullable — INTERRUPTED runs never get a completion time (migration 012).
  completed_at:      Generated<string | null>;
  metadata:          string;
  // TD-067 — insert-optional (DB DEFAULT 'unknown' / NULL) so existing insert
  // sites need no change this commit; Commit 3 writes them via the triage gate.
  input_health:        Generated<string>;         // freshness/self-health verdict for triage input
  input_health_reason: Generated<string | null>;  // short reason when non-ok; NULL when ok / not evaluated
  // TD-126: run lifecycle — 'created'|'running'|'completed'|'failed'|'interrupted'.
  // Orthogonal to `status` (test outcome); DB default 'completed' (migration 012).
  lifecycle:           Generated<string>;
  // Migration 021: legacy remains the default; Product linkage is explicit.
  execution_id:        Generated<string | null>;
  origin:              Generated<string>;
  attempt_ordinal:     Generated<number | null>;
}

// ── Test Results ──────────────────────────────────────────────────────────────
export interface TestResultsTable {
  id:                Generated<number>;
  run_id:            string;
  test_id:           string;
  title:             string;
  suite:             string;
  status:            string;
  duration_ms:       number;
  retry_count:       number;
  error_msg:         string | null;
  browser:           string;
  tier:              string;
  started_at:        string;
  worker_index:      number;
  tags:              string;
  flaky_history:     number;
  screenshot_path:   string | null;
  video_path:        string | null;
  metadata:          string;
  // Migration 021: nullable exactly for historical/legacy Result rows.
  result_id:                  Generated<string | null>;
  execution_item_ordinal:     Generated<number | null>;
  definition_id:              Generated<string | null>;
  executable_plan_hash:       Generated<string | null>;
  // Migration 029: bounded native Product Result detail. Both remain NULL for
  // legacy rows and when the Result did not reach its governed oracle.
  oracle_kind:                Generated<string | null>;
  observed_subject_id:        Generated<string | null>;
}

// ── Test Steps ────────────────────────────────────────────────────────────────
export interface TestStepsTable {
  id:                Generated<number>;
  run_id:            string;
  test_id:           string;
  step_index:        number;
  action:            string;
  target:            string | null;
  value:             string | null;
  status:            string;
  duration_ms:       number;
  screenshot_path:   string | null;
  error_msg:         string | null;
  healed:            number;
  step_metadata:     string;
}

// ── Heal Events ───────────────────────────────────────────────────────────────
export interface HealEventsTable {
  id:                Generated<number>;
  run_id:            string;
  page:              string;
  element:           string;
  original_strategy: string;
  healed_strategy:   string;
  heal_type:         string;
  confidence:        number;
  consecutive_count: number;
  promoted:          number;
  healed_at:         string;
  correctness_signal: string | null;   // TD-065 — how heal correctness was established
  heal_confidence:    string | null;   // TD-065 — derived correctness-based confidence tier
}

// TD-065 — heal correctness vocabulary.
export type HealConfidence   = 'observed' | 'partial' | 'unknown' | 'failed';
export type CorrectnessSignal = 'assertion-verified' | 'resolvability-only' | 'unverified';

// ── AI Triage ─────────────────────────────────────────────────────────────────
export interface AiTriageTable {
  id:                Generated<number>;
  run_id:            string;
  test_id:           string;
  failure_category:  string;
  confidence:        number;
  confidence_source: string;
  root_cause:        string;
  suggested_fix:     string;
  evidence:          string | null;   // TD-UI-043: gate-required proof; NULL = none required (non-app-bug)
  similar_failures:  string;
  triage_model:      string;
  triaged_at:        string;
  tokens_used:       number;
}

// ── AI Usage ──────────────────────────────────────────────────────────────────
export interface AiUsageTable {
  id:                Generated<number>;
  run_id:            string | null;
  app_name:          string;
  operation:         string;
  model:             string;
  input_tokens:      number;
  output_tokens:     number;
  total_tokens:      number;
  estimated_cost_usd: number;
  duration_ms:       number;
  triggered_by:      string;
  success:           number;
  recorded_at:       string;
  retry_attempt:     number;   // TD-053: 0 = first attempt, 1 = first retry, ...
}

// ── DOM Snapshots ─────────────────────────────────────────────────────────────
export interface DomSnapshotsTable {
  id:                Generated<number>;
  run_id:            string;
  test_id:           string;
  step_index:        number;
  url:               string;
  dom_hash:          string;
  interactive_elements: string;
  captured_at:       string;
  snapshot_type:     string;
  purge_after_days:  number;
  purge_after_date:  string;
  purged:            number;
}

// ── Flaky Analysis ────────────────────────────────────────────────────────────
export interface FlakyAnalysisTable {
  id:                Generated<number>;
  test_id:           string;
  app_name:          string;
  analysis_date:     string;
  flaky_score:       number;
  signal_timing:     number;
  signal_selector:   number;
  signal_data:       number;
  signal_env:        number;
  signal_concurrency: number;
  signal_network:    number;
  sample_size:       number;
  recommendation:    string;
  trend:             string;
  /** TD-120 (migration 011): evidential standing of this prediction.
   *  'high' | 'medium' | 'low' | 'insufficient-evidence' | 'unknown'.
   *  Generated<> (DB default 'unknown') so pre-011 writers that omit it —
   *  notably the untouched flaky-predictor.ts (TD-127) — keep compiling. */
  confidence:        Generated<string>;
}

// ── Coverage Gaps ─────────────────────────────────────────────────────────────
export interface CoverageGapsTable {
  id:                Generated<number>;
  app_name:          string;
  gap_id:            string;
  gap_type:          string;
  description:       string;
  priority:          string;
  suggested_spec:    string;
  status:            string;
  identified_at:     string;
  closed_at:         string | null;
  closed_by_test:    string | null;
}

// ── App Models ────────────────────────────────────────────────────────────────
export interface AppModelsTable {
  id:                Generated<number>;
  app_name:          string;
  version:           string;
  base_url:          string;
  app_type:          string;
  intake_mode:       string;
  crawl_config_hash: string;
  page_count:        number;
  flow_count:        number;
  role_count:        number;
  model_json:        string;
  crawled_at:        string | null;   // TD-UI-031: NULL for unsupported-platform (no crawl ran)
  crawled_by:        string | null;   // Crawl-LIEs (migration 015): NULL when no crawl ran (stub). Values: 'engine'|'agent'|'human'|'import'
  status:            string;
  evidence_state:    string;          // 'crawled' | 'crawled-empty' | 'unsupported-platform'
  operation_id:      string | null;   // migration 017: orchestrator-owned durable retry identity
  candidate_hash:    string | null;   // migration 017: canonical unversioned-candidate SHA-256
  recovery_source_row_id: number | null;       // migration 018: guarded recovery source row
  recovery_source_fingerprint: string | null;  // migration 018: SHA-256 of exact source model_json
}

// ── Assertions ────────────────────────────────────────────────────────────────
export interface AssertionsTable {
  id:                Generated<number>;
  app_name:          string;
  flow_id:           string;
  test_id:           string;
  assertion_text:    string;
  assertion_code:    string;
  tier:              number;
  status:            string;
  confidence:        number;
  proposed_by:       string;
  reviewed_by:       string | null;
  mutation_score:    number | null;
  proposed_at:       string;
  reviewed_at:       string | null;
}

// ── Trends ────────────────────────────────────────────────────────────────────
export interface TrendsTable {
  id:                Generated<number>;
  app_name:          string;
  period:            string;
  total_runs:        number;
  pass_rate:         number;
  avg_duration_ms:   number;
  flaky_count:       number;
  heal_count:        number;
  coverage_delta:    number;
  computed_at:       string;
}

// ── Performance Baselines ─────────────────────────────────────────────────────
export interface PerfBaselinesTable {
  id:                Generated<number>;
  app_name:          string;
  flow_id:           string;
  metric:            string;
  baseline_value:    number;
  threshold_pct:     number;
  current_value:     number | null;
  status:            string;
  run_id:            string | null;
  recorded_at:       string;
}

// ── Framework Config ──────────────────────────────────────────────────────────
export interface FrameworkConfigTable {
  id:                Generated<number>;
  key:               string;
  value:             string;
  value_type:        string;
  category:          string;
  description:       string;
  allowed_values:    string | null;
  default_value:     string;
  updated_by:        string;
  updated_at:        string;
}

export interface TestSetRevisionsTable {
  id: Generated<number>;
  test_set_id: string;
  revision: number;
  project_id: string;
  generation_id: string;
  schema_version: Generated<number>;
  source_observation_id: string | null;
  model_row_id: number;
  model_version: string;
  observation_run_id: string | null;
  support_seal_hash: string | null;
  characterization_policy_id: string | null;
  characterization_policy_version: string | null;
  generated_at: string;
  outcome: string;
  definition_count: number;
  payload_json: string;
  content_hash: string;
}

export interface TestGenerationEventsTable {
  id: Generated<number>;
  generation_id: string;
  project_id: string;
  event_type: string;
  outcome: string | null;
  occurred_at: string;
  process_instance_id: string;
  test_set_row_id: number | null;
  safe_code: string | null;
  safe_message: string;
}

export interface TestGenerationLocksTable {
  project_id: string;
  generation_id: string;
  process_instance_id: string;
  acquired_at: string;
}

// ── Product execution lifecycle ─────────────────────────────────────────────
export interface ExecutionEventsTable {
  id: Generated<number>;
  execution_id: string;
  project_id: string;
  event_type: string;
  outcome: string | null;
  occurred_at: string;
  process_instance_id: string;
  safe_code: string | null;
  safe_message: string;
  execution_plan_hash: string;
  // Migration 023: NULL only for pre-023 rows; all new events are explicit.
  lifecycle: Generated<string | null>;
}

export interface ExecutionLocksTable {
  project_id: string;
  execution_id: string;
  process_instance_id: string;
  acquired_at: string;
  last_heartbeat_at: string;
}

export interface ExecutionsTable {
  execution_id: string;
  project_id: string;
  accepted_at: string;
  test_set_id: string;
  test_set_revision: number;
  definition_schema_version: number;
  model_row_id: number;
  model_version: string;
  source_observation_id: string | null;
  support_seal_hash: string | null;
  route_evidence_identity_hash: string | null;
  authentication_expectation_identity_hash: string | null;
  manifest_hash: string;
  max_run_attempts: number;
  dispatch_mode: string;
  stop_rule: string;
  // Migration 030: NULL only for historical pre-idempotency executions.
  execution_intent_key: Generated<string | null>;
  execution_intent_fingerprint: Generated<string | null>;
  suite_id: Generated<string | null>;
  suite_revision: Generated<number | null>;
  suite_content_hash: Generated<string | null>;
}

export interface SuitesTable { suite_id: string; project_id: string; current_revision: number; name_key: string; created_at: string }
export interface SuiteRevisionsTable {
  suite_id: string; revision: number; project_id: string; name: string; name_key: string; purpose: string;
  definition_schema_version: number; test_set_row_id: number; test_set_id: string; test_set_revision: number;
  test_set_content_hash: string; created_at: string; provenance_source: string; change_kind: string;
  prior_revision: number | null; change_intent_key: string; change_intent_fingerprint: string;
  member_count: number; content_hash: string;
}
export interface SuiteRevisionMembersTable { suite_id: string; suite_revision: number; member_ordinal: number; definition_id: string }

export interface ExecutionItemsTable {
  execution_id: string;
  item_ordinal: number;
  definition_id: string;
  executable_plan_hash: string;
  // Migration 029: immutable plan oracle authority. Historical items remain NULL.
  oracle_kind: Generated<string | null>;
  oracle_subject_id: Generated<string | null>;
}

// ── Canonical Observation authority ─────────────────────────────────────────
export interface ObservationRunsTable {
  observation_run_id: string;
  project_id: string;
  workspace_authority: string;
  operation_id: string;
  producer: string;
  producer_version: string;
  producer_instance_id: string;
  producer_process_id: number;
  acquisition_kind: string;
  started_at: string;
  terminal_at: string | null;
  lifecycle: string;
  completeness: string | null;
  safe_reason_code: string | null;
  safe_message: string | null;
  policy_id: string;
  policy_version: string;
  acquisition_plan_hash: string;
}

export interface ObservationsTable {
  observation_id: string;
  observation_run_id: string;
  project_id: string;
  producer: string;
  producer_version: string;
  method: string;
  method_version: string;
  subject_id: string;
  predicate: string;
  outcome: string;
  observed_value_json: string | null;
  boundary_json: string;
  captured_at: string;
  idempotency_key: string;
  integrity_hash: string;
  provenance_class: string;
  safe_reason_code: string | null;
  safe_message: string | null;
  artifact_links_sealed: number;
}

export interface ObservationGapsTable {
  gap_id: string;
  observation_run_id: string;
  project_id: string;
  producer: string;
  producer_version: string;
  intended_method: string;
  intended_method_version: string;
  intended_subject_id: string;
  intended_predicate: string;
  boundary_json: string;
  reason: string;
  occurred_at: string;
  idempotency_key: string;
  integrity_hash: string;
  safe_message: string | null;
  artifact_links_sealed: number;
}

export interface ObservationArtifactsTable {
  artifact_id: string;
  observation_run_id: string;
  project_id: string;
  storage_key: string;
  sha256: string;
  media_type: string;
  byte_size: number;
  sensitivity_class: string;
  redaction_state: string;
  captured_at: string;
  retention_class: string;
  retention_policy_id: string;
  retention_policy_version: string;
  expires_at: string | null;
}

export interface ObservationArtifactLinksTable {
  artifact_id: string;
  project_id: string;
  observation_id: string | null;
  gap_id: string | null;
  ordinal: number;
}

export interface AppModelObservationSupportTable {
  model_row_id: number;
  project_id: string;
  observation_id: string;
  claim_key: string;
  support_role: string;
  characterization_policy_id: string;
  characterization_policy_version: string;
  linked_at: string;
}

export interface AppModelSubjectSupportTable extends AppModelObservationSupportTable {
  canonical_subject_id: string;
}

export interface AppModelGapSupportTable {
  model_row_id: number;
  project_id: string;
  gap_id: string;
  claim_key: string;
  support_role: string;
  characterization_policy_id: string;
  characterization_policy_version: string;
  linked_at: string;
}

export interface AppModelSupportSealsTable {
  model_row_id: number;
  project_id: string;
  observation_run_id: string;
  characterization_policy_id: string;
  characterization_policy_version: string;
  support_hash: string;
  sealed_at: string;
}

export interface ObservationImportSourcesTable {
  project_id: string;
  source_kind: string;
  source_path: string;
  source_path_state: string;
  source_schema: string;
  original_id: string | null;
  original_id_state: string;
  content_hash: string;
  capture_timestamp: string | null;
  workspace_authority: string;
  producer_identity: string | null;
  producer_identity_state: string;
  classification: string;
  legacy_provenance_class: string;
  reason_code: string;
  imported_observation_id: string | null;
  imported_observation_run_id: string | null;
  imported_at: string;
  import_policy_id: string;
  import_policy_version: string;
}

// ── Master Database Interface ─────────────────────────────────────────────────
export interface Database {
  runs:              RunsTable;
  test_results:      TestResultsTable;
  test_steps:        TestStepsTable;
  heal_events:       HealEventsTable;
  ai_triage:         AiTriageTable;
  ai_usage:          AiUsageTable;
  dom_snapshots:     DomSnapshotsTable;
  flaky_analysis:    FlakyAnalysisTable;
  coverage_gaps:     CoverageGapsTable;
  app_models:        AppModelsTable;
  assertions:        AssertionsTable;
  trends:            TrendsTable;
  perf_baselines:    PerfBaselinesTable;
  framework_config:  FrameworkConfigTable;
  test_set_revisions: TestSetRevisionsTable;
  test_generation_events: TestGenerationEventsTable;
  test_generation_locks: TestGenerationLocksTable;
  execution_events: ExecutionEventsTable;
  execution_locks: ExecutionLocksTable;
  executions: ExecutionsTable;
  execution_items: ExecutionItemsTable;
  suites: SuitesTable;
  suite_revisions: SuiteRevisionsTable;
  suite_revision_members: SuiteRevisionMembersTable;
  observation_runs: ObservationRunsTable;
  observations: ObservationsTable;
  observation_gaps: ObservationGapsTable;
  observation_artifacts: ObservationArtifactsTable;
  observation_artifact_links: ObservationArtifactLinksTable;
  app_model_observation_support: AppModelObservationSupportTable;
  app_model_subject_support: AppModelSubjectSupportTable;
  app_model_gap_support: AppModelGapSupportTable;
  app_model_support_seals: AppModelSupportSealsTable;
  observation_import_sources: ObservationImportSourcesTable;
}

// ── Convenience aliases ───────────────────────────────────────────────────────
export type Run              = Selectable<RunsTable>;
export type NewRun           = Insertable<RunsTable>;
export type UpdateRun        = Updateable<RunsTable>;

export type TestResult       = Selectable<TestResultsTable>;
export type NewTestResult    = Insertable<TestResultsTable>;

export type TestStep         = Selectable<TestStepsTable>;
export type NewTestStep      = Insertable<TestStepsTable>;

export type HealEvent        = Selectable<HealEventsTable>;
export type NewHealEvent     = Insertable<HealEventsTable>;

export type AiTriage         = Selectable<AiTriageTable>;
export type NewAiTriage      = Insertable<AiTriageTable>;

export type AiUsage          = Selectable<AiUsageTable>;
export type NewAiUsage       = Insertable<AiUsageTable>;

export type DomSnapshot      = Selectable<DomSnapshotsTable>;
export type NewDomSnapshot   = Insertable<DomSnapshotsTable>;

export type FlakyAnalysis    = Selectable<FlakyAnalysisTable>;
export type NewFlakyAnalysis = Insertable<FlakyAnalysisTable>;

export type CoverageGap      = Selectable<CoverageGapsTable>;
export type NewCoverageGap   = Insertable<CoverageGapsTable>;

export type AppModel         = Selectable<AppModelsTable>;
export type NewAppModel      = Insertable<AppModelsTable>;

export type Assertion        = Selectable<AssertionsTable>;
export type NewAssertion     = Insertable<AssertionsTable>;

export type Trend            = Selectable<TrendsTable>;
export type NewTrend         = Insertable<TrendsTable>;

export type PerfBaseline     = Selectable<PerfBaselinesTable>;
export type NewPerfBaseline  = Insertable<PerfBaselinesTable>;

export type FrameworkConfig    = Selectable<FrameworkConfigTable>;
export type NewFrameworkConfig = Insertable<FrameworkConfigTable>;
export type TestSetRevision = Selectable<TestSetRevisionsTable>;
export type NewTestSetRevision = Insertable<TestSetRevisionsTable>;
export type TestGenerationEvent = Selectable<TestGenerationEventsTable>;
export type NewTestGenerationEvent = Insertable<TestGenerationEventsTable>;
export type ExecutionEvent = Selectable<ExecutionEventsTable>;
export type NewExecutionEvent = Insertable<ExecutionEventsTable>;
export type ExecutionLock = Selectable<ExecutionLocksTable>;
export type NewExecutionLock = Insertable<ExecutionLocksTable>;
export type Execution = Selectable<ExecutionsTable>;
export type NewExecution = Insertable<ExecutionsTable>;
export type ExecutionItem = Selectable<ExecutionItemsTable>;
export type NewExecutionItem = Insertable<ExecutionItemsTable>;
export type ObservationRunRow = Selectable<ObservationRunsTable>;
export type NewObservationRunRow = Insertable<ObservationRunsTable>;
export type ObservationRow = Selectable<ObservationsTable>;
export type NewObservationRow = Insertable<ObservationsTable>;
export type ObservationGapRow = Selectable<ObservationGapsTable>;
export type NewObservationGapRow = Insertable<ObservationGapsTable>;
export type ObservationArtifactRow = Selectable<ObservationArtifactsTable>;
export type NewObservationArtifactRow = Insertable<ObservationArtifactsTable>;
export type ObservationImportSourceRow = Selectable<ObservationImportSourcesTable>;
export type NewObservationImportSourceRow = Insertable<ObservationImportSourcesTable>;
