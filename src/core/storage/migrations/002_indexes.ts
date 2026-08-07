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

import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const idx = async (name: string, table: string, cols: string) => {
    await sql`CREATE INDEX IF NOT EXISTS ${sql.raw(name)} ON ${sql.raw(table)} (${sql.raw(cols)})`.execute(db);
  };

  await idx('idx_runs_run_id',           'runs',             'run_id');
  await idx('idx_runs_app_started',      'runs',             'app_name, started_at');
  await idx('idx_runs_status',           'runs',             'status');
  await idx('idx_results_run_id',        'test_results',     'run_id');
  await idx('idx_results_test_status',   'test_results',     'test_id, status');
  await idx('idx_results_suite',         'test_results',     'suite');
  await idx('idx_steps_run_test',        'test_steps',       'run_id, test_id');
  await idx('idx_heals_run_id',          'heal_events',      'run_id');
  await idx('idx_heals_page_element',    'heal_events',      'page, element');
  await idx('idx_heals_promoted',        'heal_events',      'promoted');
  await idx('idx_triage_run_test',       'ai_triage',        'run_id, test_id');
  await idx('idx_triage_category',       'ai_triage',        'failure_category');
  await idx('idx_usage_run_id',          'ai_usage',         'run_id');
  await idx('idx_usage_operation',       'ai_usage',         'operation');
  await idx('idx_usage_recorded',        'ai_usage',         'recorded_at');
  await idx('idx_snapshots_run_test',    'dom_snapshots',    'run_id, test_id');
  await idx('idx_snapshots_purge',       'dom_snapshots',    'purge_after_date, purged');
  await idx('idx_flaky_test_app',        'flaky_analysis',   'test_id, app_name');
  await idx('idx_gaps_app_status',       'coverage_gaps',    'app_name, status');
  await idx('idx_models_app_status',     'app_models',       'app_name, status');
  await idx('idx_assertions_app_status', 'assertions',       'app_name, status');
  await idx('idx_assertions_tier',       'assertions',       'tier, status');
  await idx('idx_trends_app_period',     'trends',           'app_name, period');
  await idx('idx_perf_app_flow',         'perf_baselines',   'app_name, flow_id');
  await idx('idx_config_key',            'framework_config', 'key');
  await idx('idx_config_category',       'framework_config', 'category');
}

export async function down(db: Kysely<any>): Promise<void> {
  const names = [
    'idx_runs_run_id', 'idx_runs_app_started', 'idx_runs_status',
    'idx_results_run_id', 'idx_results_test_status', 'idx_results_suite',
    'idx_steps_run_test', 'idx_heals_run_id', 'idx_heals_page_element',
    'idx_heals_promoted', 'idx_triage_run_test', 'idx_triage_category',
    'idx_usage_run_id', 'idx_usage_operation', 'idx_usage_recorded',
    'idx_snapshots_run_test', 'idx_snapshots_purge', 'idx_flaky_test_app',
    'idx_gaps_app_status', 'idx_models_app_status', 'idx_assertions_app_status',
    'idx_assertions_tier', 'idx_trends_app_period', 'idx_perf_app_flow',
    'idx_config_key', 'idx_config_category',
  ];
  for (const name of names) {
    await sql`DROP INDEX IF EXISTS ${sql.raw(name)}`.execute(db);
  }
}
