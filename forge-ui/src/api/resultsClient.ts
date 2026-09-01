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
import {
  CanonicalResultsContractError,
  decodeCanonicalExecutionResultsDetail,
  decodeCanonicalExecutionResultsList,
  decodeCanonicalResultsIntegrityWarnings,
  type CanonicalExecutionResultsDetail,
  type CanonicalExecutionResultsListResponse,
  type CanonicalResultsIntegrityWarning,
} from './resultsContract'

export class CanonicalResultsPayloadError extends ApiError {
  constructor(cause: unknown) {
    super(
      cause instanceof CanonicalResultsContractError
        ? cause.message
        : 'Canonical Results payload is malformed.',
      502,
      'CANONICAL_RESULTS_PAYLOAD_INVALID',
    )
    this.name = 'CanonicalResultsPayloadError'
  }
}

export class CanonicalResultsIntegrityError extends ApiError {
  constructor(status: number, readonly integrityWarnings: CanonicalResultsIntegrityWarning[]) {
    super(
      'Execution Result integrity is unavailable for safe projection.',
      status,
      'EXECUTION_RESULTS_INTEGRITY_INVALID',
      { integrityWarnings },
    )
    this.name = 'CanonicalResultsIntegrityError'
  }
}

function projectPath(appName: string): string {
  return `/api/v1/projects/${encodeURIComponent(appName)}`
}

function decodeOrRefuse<T>(value: unknown, decode: (input: unknown) => T): T {
  try {
    return decode(value)
  } catch (cause) {
    throw new CanonicalResultsPayloadError(cause)
  }
}

function rethrowIntegrity(error: unknown): never {
  if (error instanceof ApiError && error.code === 'EXECUTION_RESULTS_INTEGRITY_INVALID') {
    try {
      const detail = error.details
      if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) throw new CanonicalResultsContractError()
      const keys = Object.keys(detail)
      const allowed = ['error', 'code', 'timestamp', 'integrityWarnings']
      if (keys.some(key => !allowed.includes(key))) throw new CanonicalResultsContractError()
      const warnings = decodeCanonicalResultsIntegrityWarnings((detail as Record<string, unknown>).integrityWarnings)
      throw new CanonicalResultsIntegrityError(error.status, warnings)
    } catch (cause) {
      if (cause instanceof CanonicalResultsIntegrityError) throw cause
      throw new CanonicalResultsPayloadError(cause)
    }
  }
  if (!(error instanceof ApiError)) throw new CanonicalResultsPayloadError(error)
  throw error
}

export async function fetchCanonicalExecutionResultsList(
  appName: string,
  limit = 25,
): Promise<CanonicalExecutionResultsListResponse> {
  try {
    const value = await apiClient.get<unknown>(`${projectPath(appName)}/executions?limit=${encodeURIComponent(String(limit))}`)
    return decodeOrRefuse(value, decodeCanonicalExecutionResultsList)
  } catch (error) {
    rethrowIntegrity(error)
  }
}

export async function fetchCanonicalExecutionResultsDetail(
  appName: string,
  executionId: string,
): Promise<CanonicalExecutionResultsDetail> {
  try {
    const value = await apiClient.get<unknown>(
      `${projectPath(appName)}/executions/${encodeURIComponent(executionId)}/results`,
    )
    return decodeOrRefuse(value, input => decodeCanonicalExecutionResultsDetail(input, appName))
  } catch (error) {
    rethrowIntegrity(error)
  }
}
