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

export const INSIGHTS_EVIDENCE_SCHEMA_VERSION = 'forge.m4.diagnostic-evidence/v1' as const
export const INSIGHTS_CLASSIFIER_VERSION = 'forge.m4.diagnostic-classifier/v1' as const
export const INSIGHTS_FAILURE_MODES = [
  'executor_failure', 'authentication_not_established', 'navigation_not_completed',
  'target_not_observed', 'action_not_completed', 'oracle_mismatch',
] as const
export type InsightsFailureMode = typeof INSIGHTS_FAILURE_MODES[number]

export interface DiagnosticInsightsReadModel {
  projectId: string
  evidenceSchemaVersion: typeof INSIGHTS_EVIDENCE_SCHEMA_VERSION
  classifierVersion: typeof INSIGHTS_CLASSIFIER_VERSION
  totalDiagnostics: number
  classifiedFailureCount: number
  refusalCount: number
  countsByFailureMode: Readonly<Record<InsightsFailureMode, number>>
  insufficientEvidenceCount: number
  integrityInvalidCount: number
}

export class DiagnosticInsightsContractError extends Error {
  constructor(message = 'Diagnostic Insights payload does not satisfy the closed UI contract.') {
    super(message)
    this.name = 'DiagnosticInsightsContractError'
  }
}

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DiagnosticInsightsContractError(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DiagnosticInsightsContractError(`${label} contains missing or unsupported fields.`)
  }
}
function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new DiagnosticInsightsContractError(`${label} must be a non-negative safe integer.`)
  return Number(value)
}

export function decodeDiagnosticInsights(value: unknown, expectedProjectId?: string): DiagnosticInsightsReadModel {
  const item = record(value, 'Diagnostic Insights')
  exact(item, [
    'projectId', 'evidenceSchemaVersion', 'classifierVersion', 'totalDiagnostics',
    'classifiedFailureCount', 'refusalCount', 'countsByFailureMode',
    'insufficientEvidenceCount', 'integrityInvalidCount',
  ], 'Diagnostic Insights')
  if (typeof item.projectId !== 'string' || !PROJECT_ID.test(item.projectId)
    || expectedProjectId !== undefined && item.projectId !== expectedProjectId) {
    throw new DiagnosticInsightsContractError('Diagnostic Insights project identity is invalid.')
  }
  if (item.evidenceSchemaVersion !== INSIGHTS_EVIDENCE_SCHEMA_VERSION) throw new DiagnosticInsightsContractError('Diagnostic Insights evidence schema version is unsupported.')
  if (item.classifierVersion !== INSIGHTS_CLASSIFIER_VERSION) throw new DiagnosticInsightsContractError('Diagnostic Insights classifier version is unsupported.')
  const failureCounts = record(item.countsByFailureMode, 'countsByFailureMode')
  exact(failureCounts, INSIGHTS_FAILURE_MODES, 'countsByFailureMode')
  const countsByFailureMode = Object.fromEntries(
    INSIGHTS_FAILURE_MODES.map(mode => [mode, count(failureCounts[mode], `countsByFailureMode.${mode}`)]),
  ) as Record<InsightsFailureMode, number>
  const totalDiagnostics = count(item.totalDiagnostics, 'totalDiagnostics')
  const classifiedFailureCount = count(item.classifiedFailureCount, 'classifiedFailureCount')
  const refusalCount = count(item.refusalCount, 'refusalCount')
  const insufficientEvidenceCount = count(item.insufficientEvidenceCount, 'insufficientEvidenceCount')
  const integrityInvalidCount = count(item.integrityInvalidCount, 'integrityInvalidCount')
  if (Object.values(countsByFailureMode).reduce((sum, value) => sum + value, 0) !== classifiedFailureCount
    || insufficientEvidenceCount + integrityInvalidCount !== refusalCount
    || classifiedFailureCount + refusalCount !== totalDiagnostics) {
    throw new DiagnosticInsightsContractError('Diagnostic Insights counts do not reconcile.')
  }
  return {
    projectId: item.projectId, evidenceSchemaVersion: INSIGHTS_EVIDENCE_SCHEMA_VERSION,
    classifierVersion: INSIGHTS_CLASSIFIER_VERSION, totalDiagnostics, classifiedFailureCount,
    refusalCount, countsByFailureMode: Object.freeze(countsByFailureMode),
    insufficientEvidenceCount, integrityInvalidCount,
  }
}
export const serializeDiagnosticInsights = decodeDiagnosticInsights
