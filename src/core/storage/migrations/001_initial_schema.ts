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

import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {

  await db.schema.createTable('runs')
    .ifNotExists()
    .addColumn('id',               'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',           'varchar(255)', c => c.notNull().unique())
    .addColumn('app_name',         'varchar(255)', c => c.notNull())
    .addColumn('branch',           'varchar(255)', c => c.notNull().defaultTo('unknown'))
    .addColumn('commit_sha',       'varchar(255)', c => c.notNull().defaultTo('unknown'))
    .addColumn('environment',      'varchar(50)',  c => c.notNull().defaultTo('local'))
    .addColumn('base_url',         'varchar(500)', c => c.notNull().defaultTo(''))
    .addColumn('triggered_by',     'varchar(50)',  c => c.notNull().defaultTo('manual'))
    .addColumn('reporter_version', 'varchar(50)',  c => c.notNull().defaultTo('unknown'))
    .addColumn('status',           'varchar(50)',  c => c.notNull().defaultTo('unknown'))
    .addColumn('total_tests',      'integer',      c => c.notNull().defaultTo(0))
    .addColumn('passed',           'integer',      c => c.notNull().defaultTo(0))
    .addColumn('failed',           'integer',      c => c.notNull().defaultTo(0))
    .addColumn('skipped',          'integer',      c => c.notNull().defaultTo(0))
    .addColumn('duration_ms',      'integer',      c => c.notNull().defaultTo(0))
    .addColumn('started_at',       'varchar(50)',  c => c.notNull())
    .addColumn('completed_at',     'varchar(50)',  c => c.notNull())
    .addColumn('metadata',         'text',         c => c.notNull().defaultTo('{}'))
    .execute();

  await db.schema.createTable('test_results')
    .ifNotExists()
    .addColumn('id',              'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',          'varchar(255)', c => c.notNull())
    .addColumn('test_id',         'varchar(255)', c => c.notNull())
    .addColumn('title',           'text',         c => c.notNull())
    .addColumn('suite',           'varchar(255)', c => c.notNull())
    .addColumn('status',          'varchar(50)',  c => c.notNull())
    .addColumn('duration_ms',     'integer',      c => c.notNull().defaultTo(0))
    .addColumn('retry_count',     'integer',      c => c.notNull().defaultTo(0))
    .addColumn('error_msg',       'text')
    .addColumn('browser',         'varchar(50)',  c => c.notNull().defaultTo('unknown'))
    .addColumn('tier',            'varchar(50)',  c => c.notNull().defaultTo('ui'))
    .addColumn('started_at',      'varchar(50)',  c => c.notNull().defaultTo(''))
    .addColumn('worker_index',    'integer',      c => c.notNull().defaultTo(0))
    .addColumn('tags',            'text',         c => c.notNull().defaultTo('[]'))
    .addColumn('flaky_history',   'integer',      c => c.notNull().defaultTo(0))
    .addColumn('screenshot_path', 'text')
    .addColumn('video_path',      'text')
    .addColumn('metadata',        'text',         c => c.notNull().defaultTo('{}'))
    .execute();

  await db.schema.createTable('test_steps')
    .ifNotExists()
    .addColumn('id',              'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',          'varchar(255)', c => c.notNull())
    .addColumn('test_id',         'varchar(255)', c => c.notNull())
    .addColumn('step_index',      'integer',      c => c.notNull())
    .addColumn('action',          'varchar(100)', c => c.notNull())
    .addColumn('target',          'text')
    .addColumn('value',           'text')
    .addColumn('status',          'varchar(50)',  c => c.notNull())
    .addColumn('duration_ms',     'integer',      c => c.notNull().defaultTo(0))
    .addColumn('screenshot_path', 'text')
    .addColumn('error_msg',       'text')
    .addColumn('healed',          'integer',      c => c.notNull().defaultTo(0))
    .addColumn('step_metadata',   'text',         c => c.notNull().defaultTo('{}'))
    .execute();

  await db.schema.createTable('heal_events')
    .ifNotExists()
    .addColumn('id',                'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',            'varchar(255)', c => c.notNull())
    .addColumn('page',              'varchar(255)', c => c.notNull())
    .addColumn('element',           'varchar(255)', c => c.notNull())
    .addColumn('original_strategy', 'text',         c => c.notNull())
    .addColumn('healed_strategy',   'text',         c => c.notNull())
    .addColumn('heal_type',         'varchar(50)',  c => c.notNull())
    .addColumn('confidence',        'real',         c => c.notNull().defaultTo(0))
    .addColumn('consecutive_count', 'integer',      c => c.notNull().defaultTo(0))
    .addColumn('promoted',          'integer',      c => c.notNull().defaultTo(0))
    .addColumn('healed_at',         'varchar(50)',  c => c.notNull())
    .execute();

  await db.schema.createTable('ai_triage')
    .ifNotExists()
    .addColumn('id',               'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',           'varchar(255)', c => c.notNull())
    .addColumn('test_id',          'varchar(255)', c => c.notNull())
    .addColumn('failure_category', 'varchar(100)', c => c.notNull())
    .addColumn('confidence',       'real',         c => c.notNull().defaultTo(0))
    .addColumn('root_cause',       'text',         c => c.notNull())
    .addColumn('suggested_fix',    'text',         c => c.notNull())
    .addColumn('similar_failures', 'text',         c => c.notNull().defaultTo('[]'))
    .addColumn('triage_model',     'varchar(100)', c => c.notNull())
    .addColumn('triaged_at',       'varchar(50)',  c => c.notNull())
    .addColumn('tokens_used',      'integer',      c => c.notNull().defaultTo(0))
    .execute();

  await db.schema.createTable('ai_usage')
    .ifNotExists()
    .addColumn('id',                  'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',              'varchar(255)')
    .addColumn('app_name',            'varchar(255)', c => c.notNull())
    .addColumn('operation',           'varchar(100)', c => c.notNull())
    .addColumn('model',               'varchar(100)', c => c.notNull())
    .addColumn('input_tokens',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('output_tokens',       'integer',      c => c.notNull().defaultTo(0))
    .addColumn('total_tokens',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('estimated_cost_usd',  'real',         c => c.notNull().defaultTo(0))
    .addColumn('duration_ms',         'integer',      c => c.notNull().defaultTo(0))
    .addColumn('triggered_by',        'varchar(50)',  c => c.notNull().defaultTo('manual'))
    .addColumn('success',             'integer',      c => c.notNull().defaultTo(1))
    .addColumn('recorded_at',         'varchar(50)',  c => c.notNull())
    .execute();

  await db.schema.createTable('dom_snapshots')
    .ifNotExists()
    .addColumn('id',                    'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('run_id',                'varchar(255)', c => c.notNull())
    .addColumn('test_id',               'varchar(255)', c => c.notNull())
    .addColumn('step_index',            'integer',      c => c.notNull())
    .addColumn('url',                   'text',         c => c.notNull())
    .addColumn('dom_hash',              'varchar(255)', c => c.notNull())
    .addColumn('interactive_elements',  'text',         c => c.notNull().defaultTo('[]'))
    .addColumn('captured_at',           'varchar(50)',  c => c.notNull())
    .addColumn('snapshot_type',         'varchar(50)',  c => c.notNull().defaultTo('failure'))
    .addColumn('purge_after_days',      'integer',      c => c.notNull().defaultTo(30))
    .addColumn('purge_after_date',      'varchar(50)',  c => c.notNull())
    .addColumn('purged',                'integer',      c => c.notNull().defaultTo(0))
    .execute();

  await db.schema.createTable('flaky_analysis')
    .ifNotExists()
    .addColumn('id',                 'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('test_id',            'varchar(255)', c => c.notNull())
    .addColumn('app_name',           'varchar(255)', c => c.notNull())
    .addColumn('analysis_date',      'varchar(20)',  c => c.notNull())
    .addColumn('flaky_score',        'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_timing',      'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_selector',    'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_data',        'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_env',         'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_concurrency', 'real',         c => c.notNull().defaultTo(0))
    .addColumn('signal_network',     'real',         c => c.notNull().defaultTo(0))
    .addColumn('sample_size',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('recommendation',     'varchar(100)', c => c.notNull())
    .addColumn('trend',              'varchar(50)',  c => c.notNull().defaultTo('stable'))
    .execute();

  await db.schema.createTable('coverage_gaps')
    .ifNotExists()
    .addColumn('id',             'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('app_name',       'varchar(255)', c => c.notNull())
    .addColumn('gap_id',         'varchar(50)',  c => c.notNull())
    .addColumn('gap_type',       'varchar(50)',  c => c.notNull())
    .addColumn('description',    'text',         c => c.notNull())
    .addColumn('priority',       'varchar(20)',  c => c.notNull())
    .addColumn('suggested_spec', 'varchar(255)', c => c.notNull())
    .addColumn('status',         'varchar(50)',  c => c.notNull().defaultTo('open'))
    .addColumn('identified_at',  'varchar(50)',  c => c.notNull())
    .addColumn('closed_at',      'varchar(50)')
    .addColumn('closed_by_test', 'varchar(255)')
    .execute();

  await db.schema.createTable('app_models')
    .ifNotExists()
    .addColumn('id',                'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('app_name',          'varchar(255)', c => c.notNull())
    .addColumn('version',           'varchar(50)',  c => c.notNull())
    .addColumn('base_url',          'varchar(500)', c => c.notNull())
    .addColumn('app_type',          'varchar(20)',  c => c.notNull().defaultTo('mpa'))
    .addColumn('intake_mode',       'varchar(50)',  c => c.notNull().defaultTo('crawl'))
    .addColumn('crawl_config_hash', 'varchar(255)', c => c.notNull().defaultTo(''))
    .addColumn('page_count',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('flow_count',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('role_count',        'integer',      c => c.notNull().defaultTo(0))
    .addColumn('model_json',        'text',         c => c.notNull().defaultTo('{}'))
    .addColumn('crawled_at',        'varchar(50)',  c => c.notNull())
    .addColumn('crawled_by',        'varchar(50)',  c => c.notNull().defaultTo('human'))
    .addColumn('status',            'varchar(50)',  c => c.notNull().defaultTo('active'))
    .execute();

  await db.schema.createTable('assertions')
    .ifNotExists()
    .addColumn('id',              'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('app_name',        'varchar(255)', c => c.notNull())
    .addColumn('flow_id',         'varchar(255)', c => c.notNull())
    .addColumn('test_id',         'varchar(255)', c => c.notNull())
    .addColumn('assertion_text',  'text',         c => c.notNull())
    .addColumn('assertion_code',  'text',         c => c.notNull())
    .addColumn('tier',            'integer',      c => c.notNull().defaultTo(3))
    .addColumn('status',          'varchar(50)',  c => c.notNull().defaultTo('quarantined'))
    .addColumn('confidence',      'real',         c => c.notNull().defaultTo(0))
    .addColumn('proposed_by',     'varchar(50)',  c => c.notNull().defaultTo('ai'))
    .addColumn('reviewed_by',     'varchar(50)')
    .addColumn('mutation_score',  'real')
    .addColumn('proposed_at',     'varchar(50)',  c => c.notNull())
    .addColumn('reviewed_at',     'varchar(50)')
    .execute();

  await db.schema.createTable('trends')
    .ifNotExists()
    .addColumn('id',              'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('app_name',        'varchar(255)', c => c.notNull())
    .addColumn('period',          'varchar(20)',  c => c.notNull())
    .addColumn('total_runs',      'integer',      c => c.notNull().defaultTo(0))
    .addColumn('pass_rate',       'real',         c => c.notNull().defaultTo(0))
    .addColumn('avg_duration_ms', 'integer',      c => c.notNull().defaultTo(0))
    .addColumn('flaky_count',     'integer',      c => c.notNull().defaultTo(0))
    .addColumn('heal_count',      'integer',      c => c.notNull().defaultTo(0))
    .addColumn('coverage_delta',  'integer',      c => c.notNull().defaultTo(0))
    .addColumn('computed_at',     'varchar(50)',  c => c.notNull())
    .execute();

  await db.schema.createTable('perf_baselines')
    .ifNotExists()
    .addColumn('id',              'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('app_name',        'varchar(255)', c => c.notNull())
    .addColumn('flow_id',         'varchar(255)', c => c.notNull())
    .addColumn('metric',          'varchar(100)', c => c.notNull())
    .addColumn('baseline_value',  'real',         c => c.notNull())
    .addColumn('threshold_pct',   'real',         c => c.notNull().defaultTo(10))
    .addColumn('current_value',   'real')
    .addColumn('status',          'varchar(50)',  c => c.notNull().defaultTo('stable'))
    .addColumn('run_id',          'varchar(255)')
    .addColumn('recorded_at',     'varchar(50)',  c => c.notNull())
    .execute();

  await db.schema.createTable('framework_config')
    .ifNotExists()
    .addColumn('id',             'integer',      c => c.primaryKey().autoIncrement())
    .addColumn('key',            'varchar(255)', c => c.notNull().unique())
    .addColumn('value',          'text',         c => c.notNull())
    .addColumn('value_type',     'varchar(20)',  c => c.notNull())
    .addColumn('category',       'varchar(50)',  c => c.notNull())
    .addColumn('description',    'text',         c => c.notNull())
    .addColumn('allowed_values', 'text')
    .addColumn('default_value',  'text',         c => c.notNull())
    .addColumn('updated_by',     'varchar(50)',  c => c.notNull().defaultTo('system'))
    .addColumn('updated_at',     'varchar(50)',  c => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  const tables = [
    'framework_config', 'perf_baselines', 'trends', 'assertions',
    'app_models', 'coverage_gaps', 'flaky_analysis', 'dom_snapshots',
    'ai_usage', 'ai_triage', 'heal_events', 'test_steps',
    'test_results', 'runs',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
