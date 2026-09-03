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

import type { CanonicalDiagnosticOutcome } from '../../api/resultsContract'

export type DiagnosticFailureMode = Extract<CanonicalDiagnosticOutcome, { kind: 'classified_failure' }>['failureMode']
export type DiagnosticRefusalCode = Extract<CanonicalDiagnosticOutcome, { kind: 'refusal' }>['refusalCode']

export const DIAGNOSTIC_FAILURE_LABELS: Readonly<Record<DiagnosticFailureMode, string>> = {
  executor_failure: 'Execution failure',
  authentication_not_established: 'Authentication not established',
  navigation_not_completed: 'Navigation not completed',
  target_not_observed: 'Target not observed',
  action_not_completed: 'Action not completed',
  oracle_mismatch: 'Oracle mismatch',
}

export const DIAGNOSTIC_REFUSAL_LABELS: Readonly<Record<DiagnosticRefusalCode, string>> = {
  insufficient_evidence: 'Insufficient evidence',
  integrity_invalid: 'Diagnostic integrity invalid',
}
