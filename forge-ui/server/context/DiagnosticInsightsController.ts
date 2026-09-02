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

import { fail, ok } from '../http'
import { DiagnosticInsightsContractError, serializeDiagnosticInsights } from '../../src/api/insightsContract'
import { executionContext } from './ExecutionContext'

export interface DiagnosticInsightsHttpResult { status: number; body: unknown }
type Project = { appName: string; url: string }
function errorName(cause: unknown): string | null { return cause instanceof Error ? cause.name : null }

export async function readDiagnosticInsights(appName: string, query: Record<string, unknown>, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<DiagnosticInsightsHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (typeof query.evidenceSchemaVersion !== 'string' || typeof query.classifierVersion !== 'string'
    || Object.keys(query).some(key => key !== 'evidenceSchemaVersion' && key !== 'classifierVersion')) {
    return { status: 400, body: fail('One explicit evidenceSchemaVersion and classifierVersion are required.', 'INVALID_INSIGHTS_VERSION_QUERY') }
  }
  try {
    const result = await executionContext.readProductDiagnosticInsights(appName, query.evidenceSchemaVersion, query.classifierVersion)
    return { status: 200, body: ok(serializeDiagnosticInsights(result, appName)) }
  } catch (cause) {
    if (cause instanceof DiagnosticInsightsContractError) return { status: 503, body: fail('Diagnostic Insights response could not be validated.', 'DIAGNOSTIC_INSIGHTS_PAYLOAD_INVALID') }
    if (errorName(cause) === 'UnsupportedDiagnosticEvidenceSchemaVersionError') return { status: 422, body: fail('The requested diagnostic evidence schema version is not supported.', 'UNSUPPORTED_DIAGNOSTIC_EVIDENCE_VERSION') }
    if (errorName(cause) === 'UnsupportedDiagnosticClassifierVersionError') return { status: 422, body: fail('The requested diagnostic classifier version is not supported.', 'UNSUPPORTED_DIAGNOSTIC_CLASSIFIER_VERSION') }
    if (errorName(cause) === 'InvalidDiagnosticInsightsProjectIdError') return { status: 400, body: fail('The Diagnostic Insights project identity is invalid.', 'INVALID_DIAGNOSTIC_INSIGHTS_PROJECT') }
    if (errorName(cause) === 'DiagnosticInsightsIntegrityError') return { status: 503, body: fail('Diagnostic Insights are unavailable because the version partition could not be read safely.', 'DIAGNOSTIC_INSIGHTS_PARTITION_UNREADABLE') }
    return { status: 503, body: fail('Diagnostic Insights are temporarily unavailable.', 'DIAGNOSTIC_INSIGHTS_UNAVAILABLE') }
  }
}
