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

const now = new Date().toISOString();

const seeds = [
  {
    key: 'snapshot.retention_days',
    value: '30', value_type: 'number', category: 'retention',
    description: 'Days to retain DOM snapshots for failed tests',
    allowed_values: '[15,30,60]', default_value: '30',
  },
  {
    key: 'snapshot.capture_on',
    value: '"failure"', value_type: 'string', category: 'retention',
    description: 'When to capture DOM snapshots',
    allowed_values: '["failure","all"]', default_value: '"failure"',
  },
  {
    key: 'ai.budget_per_crawl',
    value: '50', value_type: 'number', category: 'ai-budget',
    description: 'Max Claude API calls per onboarding crawl',
    allowed_values: null, default_value: '50',
  },
  {
    key: 'ai.vision_heal_budget',
    value: '5', value_type: 'number', category: 'ai-budget',
    description: 'Max Vision Healer calls per run',
    allowed_values: null, default_value: '5',
  },
  {
    key: 'ai.pricing.input_per_1k',
    value: '0.003', value_type: 'number', category: 'ai-budget',
    description: 'Claude Sonnet input token cost per 1K tokens USD',
    allowed_values: null, default_value: '0.003',
  },
  {
    key: 'ai.pricing.output_per_1k',
    value: '0.015', value_type: 'number', category: 'ai-budget',
    description: 'Claude Sonnet output token cost per 1K tokens USD',
    allowed_values: null, default_value: '0.015',
  },
  {
    key: 'reporting.sdet_hourly_rate_usd',
    value: '75', value_type: 'number', category: 'reporting',
    description: 'SDET hourly rate for ROI computation USD',
    allowed_values: null, default_value: '75',
  },
  {
    key: 'crawler.max_pages',
    value: '50', value_type: 'number', category: 'crawler',
    description: 'Max pages per onboarding crawl',
    allowed_values: null, default_value: '50',
  },
  {
    key: 'crawler.max_depth',
    value: '5', value_type: 'number', category: 'crawler',
    description: 'Max BFS depth per onboarding crawl',
    allowed_values: null, default_value: '5',
  },
  {
    key: 'notifications.slack_enabled',
    value: 'false', value_type: 'boolean', category: 'notifications',
    description: 'Enable Slack notifications',
    allowed_values: '["true","false"]', default_value: 'false',
  },
  {
    key: 'notifications.email_enabled',
    value: 'false', value_type: 'boolean', category: 'notifications',
    description: 'Enable email notifications',
    allowed_values: '["true","false"]', default_value: 'false',
  },
] as const;

export async function up(db: Kysely<any>): Promise<void> {
  for (const seed of seeds) {
    await db.insertInto('framework_config')
      .values({ ...seed, updated_by: 'system', updated_at: now })
      .onConflict(oc => oc.column('key').doNothing())
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('framework_config')
    .where('updated_by', '=', 'system')
    .execute();
}
