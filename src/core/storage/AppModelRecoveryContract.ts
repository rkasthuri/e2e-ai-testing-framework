/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * Guarded recovery intent. The same exact evidence binds inspection, fresh
 * crawl orchestration, and the repository-owned recovery transaction.
 */
export interface InvalidActiveRecoveryRequest {
  app_name: string
  operation_id: string
  expected_row_id: number
  expected_source_fingerprint: string
  operator_acknowledgement: true
}

/**
 * Raw evidence about one invalid active row. Deliberately excludes model_json,
 * parsed JSON, and AppModel so invalid persisted data cannot cross the trusted
 * model boundary.
 */
export interface InvalidActiveInspection {
  row_id: number
  app_name: string
  version: string
  status: string
  raw_model_json_fingerprint: string
  validation_errors: string[]
}

/**
 * A recovery crawl cannot receive prior App Model state. The invalid source
 * row remains raw SQLite evidence and never crosses this producer boundary.
 */
export interface InvalidActiveRecoveryCrawlOptions {
  previousModel: null
}
