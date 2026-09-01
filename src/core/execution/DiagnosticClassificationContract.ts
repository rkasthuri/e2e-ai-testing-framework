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

import type { DiagnosticEvidenceV1 } from './DiagnosticEvidenceContract'

export const DIAGNOSTIC_OUTCOME_SCHEMA_VERSION = 'forge.m4.diagnostic-outcome/v1' as const
export const DIAGNOSTIC_CLASSIFIER_VERSION = 'forge.m4.diagnostic-classifier/v1' as const

export type DiagnosticClassifierVersion = typeof DIAGNOSTIC_CLASSIFIER_VERSION
export type DiagnosticIntegrityFinding =
  | 'diagnostic_evidence_contradiction'
  | 'diagnostic_authority_binding_invalid'
  | 'diagnostic_historical_authority_substitution'

interface DiagnosticOutcomeCommon {
  schemaVersion: typeof DIAGNOSTIC_OUTCOME_SCHEMA_VERSION
  evidenceSchemaVersion: DiagnosticEvidenceV1['schemaVersion']
  classifierVersion: DiagnosticClassifierVersion
  evidenceHash: string
}

export type DiagnosticClassifiedFailure = DiagnosticOutcomeCommon & (
  | { kind: 'classified_failure'; failureMode: 'executor_failure'; explanationCode: 'executor_failed_before_completion'; explanationParameters: { failureClass: 'browser_session_unavailable' | 'executor_internal_failure' | 'process_failure' | 'timeout' } }
  | { kind: 'classified_failure'; failureMode: 'authentication_not_established'; explanationCode: 'authentication_attempt_not_established'; explanationParameters: Record<string, never> }
  | { kind: 'classified_failure'; failureMode: 'navigation_not_completed'; explanationCode: 'governed_navigation_not_completed'; explanationParameters: { failureClass: 'destination_unavailable' | 'browser_navigation_error' | 'timeout'; expectedRoute: string; actualRoute: string | null } }
  | { kind: 'classified_failure'; failureMode: 'target_not_observed'; explanationCode: 'governed_target_not_observed'; explanationParameters: { subjectId: string; elementId: string; observedCardinality: 'zero' } }
  | { kind: 'classified_failure'; failureMode: 'action_not_completed'; explanationCode: 'governed_action_not_completed'; explanationParameters: { subjectId: string; elementId: string; failureClass: 'target_not_actionable' | 'interaction_failed' | 'timeout' } }
  | { kind: 'classified_failure'; failureMode: 'oracle_mismatch'; explanationCode: 'governed_oracle_mismatch'; explanationParameters: { subjectId: string; expectedRoute: string; actualRoute: string } }
)

export type DiagnosticRefusal = DiagnosticOutcomeCommon & (
  | { kind: 'refusal'; refusalCode: 'insufficient_evidence'; explanationCode: 'diagnostic_predicates_not_satisfied'; explanationParameters: Record<string, never> }
  | { kind: 'refusal'; refusalCode: 'integrity_invalid'; integrityFindings: DiagnosticIntegrityFinding[]; explanationCode: 'diagnostic_integrity_validation_failed'; explanationParameters: Record<string, never> }
)

export type DiagnosticOutcome = DiagnosticClassifiedFailure | DiagnosticRefusal

export class UnsupportedDiagnosticClassifierVersionError extends Error {
  constructor(version: string) {
    super(`Unsupported diagnostic classifier version: ${version}`)
    this.name = 'UnsupportedDiagnosticClassifierVersionError'
  }
}

export function parseDiagnosticClassifierVersion(version: string): DiagnosticClassifierVersion {
  if (version !== DIAGNOSTIC_CLASSIFIER_VERSION) {
    throw new UnsupportedDiagnosticClassifierVersionError(version)
  }
  return version
}

function performed(phase: { outcome?: string; state?: string }, discriminator: 'outcome' | 'state' = 'outcome'): boolean {
  return !['not_performed', 'not_started'].includes(String(phase[discriminator]))
}

export function hasDiagnosticEvidenceContradiction(evidence: DiagnosticEvidenceV1): boolean {
  const downstream = [evidence.authentication, evidence.navigation, evidence.targetObservation, evidence.action, evidence.oracle]
  if (['failed', 'not_started'].includes(evidence.executor.outcome)
    && downstream.some((phase, index) => performed(phase, index === 0 ? 'state' : 'outcome'))) return true
  if (['not_established', 'not_performed'].includes(evidence.authentication.state)
    && [evidence.navigation, evidence.targetObservation, evidence.action, evidence.oracle].some(phase => performed(phase))) return true
  if (['not_completed', 'not_performed'].includes(evidence.navigation.outcome)
    && [evidence.targetObservation, evidence.action, evidence.oracle].some(phase => performed(phase))) return true
  if (['not_observed', 'not_performed'].includes(evidence.targetObservation.outcome)
    && [evidence.action, evidence.oracle].some(phase => performed(phase))) return true
  if (['not_completed', 'not_performed'].includes(evidence.action.outcome) && performed(evidence.oracle)) return true
  if (evidence.oracle.outcome === 'matched' && evidence.oracle.expected !== evidence.oracle.actual) return true
  return evidence.oracle.outcome === 'mismatched' && evidence.oracle.expected === evidence.oracle.actual
}

export function classifyDiagnosticEvidence(
  evidence: DiagnosticEvidenceV1,
  evidenceHash: string,
  classifierVersion: string,
  integrityFindings: readonly DiagnosticIntegrityFinding[] = [],
): DiagnosticOutcome {
  const supportedClassifierVersion = parseDiagnosticClassifierVersion(classifierVersion)
  const common: DiagnosticOutcomeCommon = {
    schemaVersion: DIAGNOSTIC_OUTCOME_SCHEMA_VERSION,
    evidenceSchemaVersion: evidence.schemaVersion,
    classifierVersion: supportedClassifierVersion,
    evidenceHash,
  }
  const findings = new Set(integrityFindings)
  if (hasDiagnosticEvidenceContradiction(evidence)) findings.add('diagnostic_evidence_contradiction')
  if (findings.size > 0) return {
    ...common,
    kind: 'refusal',
    refusalCode: 'integrity_invalid',
    integrityFindings: [...findings].sort(),
    explanationCode: 'diagnostic_integrity_validation_failed',
    explanationParameters: {},
  }

  if (evidence.executor.outcome === 'failed'
    && evidence.authentication.state === 'not_performed'
    && evidence.navigation.outcome === 'not_performed'
    && evidence.targetObservation.outcome === 'not_performed'
    && evidence.action.outcome === 'not_performed'
    && evidence.oracle.outcome === 'not_performed') return {
    ...common, kind: 'classified_failure', failureMode: 'executor_failure',
    explanationCode: 'executor_failed_before_completion', explanationParameters: { failureClass: evidence.executor.failureClass },
  }
  if (evidence.executor.outcome === 'completed'
    && evidence.authentication.state === 'not_established' && evidence.authentication.attemptOccurred
    && evidence.navigation.outcome === 'not_performed' && evidence.targetObservation.outcome === 'not_performed'
    && evidence.action.outcome === 'not_performed' && evidence.oracle.outcome === 'not_performed') return {
    ...common, kind: 'classified_failure', failureMode: 'authentication_not_established',
    explanationCode: 'authentication_attempt_not_established', explanationParameters: {},
  }
  const authenticated = evidence.authentication.state === 'established' || evidence.authentication.state === 'not_required'
  if (evidence.executor.outcome === 'completed' && authenticated && evidence.navigation.outcome === 'not_completed'
    && evidence.targetObservation.outcome === 'not_performed' && evidence.action.outcome === 'not_performed'
    && evidence.oracle.outcome === 'not_performed') return {
    ...common, kind: 'classified_failure', failureMode: 'navigation_not_completed',
    explanationCode: 'governed_navigation_not_completed', explanationParameters: {
      failureClass: evidence.navigation.failureClass,
      expectedRoute: evidence.navigation.intendedRoute,
      actualRoute: evidence.navigation.observedRoute,
    },
  }
  if (evidence.executor.outcome === 'completed' && authenticated && evidence.navigation.outcome === 'completed'
    && evidence.targetObservation.outcome === 'not_observed' && evidence.targetObservation.cardinality === 'zero'
    && evidence.action.outcome === 'not_performed' && evidence.oracle.outcome === 'not_performed') return {
    ...common, kind: 'classified_failure', failureMode: 'target_not_observed',
    explanationCode: 'governed_target_not_observed', explanationParameters: {
      subjectId: evidence.targetObservation.targetAuthority.subjectId,
      elementId: evidence.targetObservation.targetAuthority.elementId,
      observedCardinality: 'zero',
    },
  }
  if (evidence.executor.outcome === 'completed' && authenticated && evidence.navigation.outcome === 'completed'
    && evidence.targetObservation.outcome === 'observed' && evidence.action.outcome === 'not_completed'
    && evidence.action.interactionAttempted && evidence.oracle.outcome === 'not_performed') return {
    ...common, kind: 'classified_failure', failureMode: 'action_not_completed',
    explanationCode: 'governed_action_not_completed', explanationParameters: {
      subjectId: evidence.targetObservation.targetAuthority.subjectId,
      elementId: evidence.targetObservation.targetAuthority.elementId,
      failureClass: evidence.action.failureClass,
    },
  }
  if (evidence.executor.outcome === 'completed' && authenticated && evidence.navigation.outcome === 'completed'
    && evidence.targetObservation.outcome === 'observed' && evidence.action.outcome === 'completed'
    && evidence.oracle.outcome === 'mismatched' && evidence.oracle.expected !== evidence.oracle.actual) return {
    ...common, kind: 'classified_failure', failureMode: 'oracle_mismatch',
    explanationCode: 'governed_oracle_mismatch', explanationParameters: {
      subjectId: evidence.oracle.oracleAuthority.subjectId,
      expectedRoute: evidence.oracle.expected,
      actualRoute: evidence.oracle.actual,
    },
  }
  return {
    ...common, kind: 'refusal', refusalCode: 'insufficient_evidence',
    explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {},
  }
}
