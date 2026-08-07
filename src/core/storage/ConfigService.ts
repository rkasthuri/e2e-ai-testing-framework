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

import { FrameworkConfigRepository } from './repositories/FrameworkConfigRepository'

let _repo: FrameworkConfigRepository | null = null

function repo(): FrameworkConfigRepository {
  if (!_repo) _repo = new FrameworkConfigRepository()
  return _repo
}

export const ConfigService = {

  // Retention
  getRetentionDays:        () => repo().getRetentionDays(),
  getSnapshotCaptureOn:    () => repo().getString('snapshot.capture_on'),

  // AI budget
  getAiBudgetPerCrawl:     () => repo().getAiBudgetPerCrawl(),
  getVisionHealBudget:     () => repo().getVisionHealBudget(),
  getInputPricePer1k:      () => repo().getNumber('ai.pricing.input_per_1k'),
  getOutputPricePer1k:     () => repo().getNumber('ai.pricing.output_per_1k'),

  // Reporting
  getSdetHourlyRate:       () => repo().getSdetHourlyRate(),

  // Crawler
  getCrawlerMaxPages:      () => repo().getNumber('crawler.max_pages'),
  getCrawlerMaxDepth:      () => repo().getNumber('crawler.max_depth'),

  // Notifications
  isSlackEnabled:          () => repo().getBoolean('notifications.slack_enabled'),
  isEmailEnabled:          () => repo().getBoolean('notifications.email_enabled'),

  // Generic setter — for platform UI settings tab
  set: (key: string, value: string, updatedBy = 'human') =>
    repo().set(key, value, updatedBy),

  // Generic getter — for platform UI settings tab
  getAll:        () => repo().getAll(),
  getByCategory: (category: string) => repo().getByCategory(category),
}
