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

import type { DiagnosticOutcome } from './DiagnosticClassificationContract'

export class UnsupportedDiagnosticExplanationError extends Error {
  constructor(code: string) {
    super(`Unsupported diagnostic explanation code: ${code}`)
    this.name = 'UnsupportedDiagnosticExplanationError'
  }
}

export function presentDiagnosticOutcome(outcome: DiagnosticOutcome): string {
  switch (outcome.explanationCode) {
    case 'executor_failed_before_completion':
      return `The executor did not complete (${outcome.explanationParameters.failureClass}).`
    case 'authentication_attempt_not_established':
      return 'Authentication was attempted but was not established.'
    case 'governed_navigation_not_completed':
      return `Governed navigation to ${outcome.explanationParameters.expectedRoute} did not complete; observed route: ${outcome.explanationParameters.actualRoute ?? 'not observed'} (${outcome.explanationParameters.failureClass}).`
    case 'governed_target_not_observed':
      return `Governed target ${outcome.explanationParameters.subjectId}/${outcome.explanationParameters.elementId} was not observed (cardinality: ${outcome.explanationParameters.observedCardinality}).`
    case 'governed_action_not_completed':
      return `The governed action on ${outcome.explanationParameters.subjectId}/${outcome.explanationParameters.elementId} did not complete (${outcome.explanationParameters.failureClass}).`
    case 'governed_oracle_mismatch':
      return `The governed oracle for ${outcome.explanationParameters.subjectId} observed ${outcome.explanationParameters.actualRoute}; expected ${outcome.explanationParameters.expectedRoute}.`
    case 'diagnostic_predicates_not_satisfied':
      return 'The persisted diagnostic evidence did not satisfy a complete classification predicate.'
    case 'diagnostic_integrity_validation_failed':
      return 'The persisted diagnostic evidence failed integrity validation.'
    default:
      throw new UnsupportedDiagnosticExplanationError((outcome as { explanationCode?: unknown }).explanationCode as string)
  }
}
