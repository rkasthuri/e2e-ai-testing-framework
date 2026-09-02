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

import { apiClient, ApiError } from './client'
import { decodeDiagnosticInsights, DiagnosticInsightsContractError, INSIGHTS_CLASSIFIER_VERSION, INSIGHTS_EVIDENCE_SCHEMA_VERSION, type DiagnosticInsightsReadModel } from './insightsContract'

export class DiagnosticInsightsPayloadError extends ApiError {
  constructor(cause: unknown) {
    super(cause instanceof DiagnosticInsightsContractError ? cause.message : 'Diagnostic Insights payload is malformed.', 502, 'DIAGNOSTIC_INSIGHTS_PAYLOAD_INVALID')
    this.name = 'DiagnosticInsightsPayloadError'
  }
}

export async function fetchDiagnosticInsights(projectId: string): Promise<DiagnosticInsightsReadModel> {
  const query = new URLSearchParams({ evidenceSchemaVersion: INSIGHTS_EVIDENCE_SCHEMA_VERSION, classifierVersion: INSIGHTS_CLASSIFIER_VERSION })
  try {
    const value = await apiClient.get<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/insights?${query}`)
    return decodeDiagnosticInsights(value, projectId)
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    throw new DiagnosticInsightsPayloadError(cause)
  }
}
