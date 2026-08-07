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
