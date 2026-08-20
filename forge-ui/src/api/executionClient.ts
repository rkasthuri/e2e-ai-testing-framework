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
  CanonicalExecutionContractError,
  decodeCanonicalExecutionCancellationAccepted,
  decodeCanonicalExecutionStartAccepted,
  decodeCanonicalExecutionStatus,
  type CanonicalExecutionCancellationAccepted,
  type CanonicalExecutionStartAccepted,
  type CanonicalExecutionStartRequest,
  type CanonicalExecutionStatus,
} from './executionContract'
import {
  CanonicalExecutionPreflightContractError,
  decodeCanonicalExecutionPreflight,
} from './executionPreflightContract'
import type { ExecutionPreflightResponse } from './types'

export class CanonicalExecutionPayloadError extends ApiError {
  constructor(cause: unknown) {
    super(
      cause instanceof CanonicalExecutionContractError
        ? cause.message
        : 'Canonical execution payload is malformed.',
      502,
      'CANONICAL_EXECUTION_PAYLOAD_INVALID',
    )
    this.name = 'CanonicalExecutionPayloadError'
  }
}

export class CanonicalExecutionPreflightPayloadError extends ApiError {
  constructor(cause: unknown) {
    super(
      cause instanceof CanonicalExecutionPreflightContractError
        ? cause.message
        : 'Canonical execution preflight payload is malformed.',
      502,
      'CANONICAL_EXECUTION_PREFLIGHT_PAYLOAD_INVALID',
    )
    this.name = 'CanonicalExecutionPreflightPayloadError'
  }
}

export class CanonicalExecutionStartAmbiguousError extends ApiError {
  constructor(cause: ApiError) {
    super(
      'Execution acceptance could not be established from the response. Retry with the same intent key.',
      cause.status,
      'EXECUTION_START_OUTCOME_AMBIGUOUS',
      null,
    )
    this.name = 'CanonicalExecutionStartAmbiguousError'
  }
}

const START_REFUSAL_CODE_VALUES = [
  'NOT_FOUND',
  'INVALID_EXECUTION_REQUEST',
  'PREFLIGHT_EMPTY_SELECTION',
  'PREFLIGHT_STALE_DEFINITION',
  'PREFLIGHT_INCOMPATIBLE_DEFINITION',
  'PREFLIGHT_LEGACY_PROVENANCE_UNSUPPORTED',
  'PREFLIGHT_SUPPORT_SEAL_MISMATCH',
  'PREFLIGHT_ROUTE_UNKNOWN',
  'PREFLIGHT_ROUTE_CONFLICTED',
  'PREFLIGHT_AUTHENTICATION_UNKNOWN',
  'PREFLIGHT_AUTHENTICATION_CONFLICTED',
  'PREFLIGHT_CREDENTIALS_UNAVAILABLE',
  'PREFLIGHT_RUNNER_UNAVAILABLE',
  'PREFLIGHT_CONFLICTING_EVIDENCE',
  'PREFLIGHT_SOURCE_INVALID',
  'EXECUTION_ALREADY_ACTIVE',
  'EXECUTION_INTENT_CONFLICT',
  'EXECUTION_PERSISTENCE_UNAVAILABLE',
  'EXECUTION_UNAVAILABLE',
] as const

export type CanonicalExecutionStartRefusalCode = typeof START_REFUSAL_CODE_VALUES[number]

const START_REFUSAL_CODES: ReadonlySet<string> = new Set(START_REFUSAL_CODE_VALUES)
const validatedCanonicalStartRefusals = new WeakSet<CanonicalExecutionStartRefusalError>()
const transportObservedCanonicalStatuses = new WeakMap<CanonicalExecutionStatus, {
  project: string
  executionId: string
  queryAuthority: object | null
}>()

export class CanonicalExecutionStartRefusalError extends ApiError {
  readonly refusalCode: CanonicalExecutionStartRefusalCode

  constructor(cause: ApiError, refusalCode: CanonicalExecutionStartRefusalCode) {
    super(cause.message, cause.status, cause.code, cause.details)
    this.name = 'CanonicalExecutionStartRefusalError'
    this.refusalCode = refusalCode
  }
}

function exactIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

/** A parsed, closed Start error envelope proves a semantic refusal regardless of HTTP class. */
export function isCanonicalExecutionStartRefusal(error: unknown): error is CanonicalExecutionStartRefusalError {
  return error instanceof CanonicalExecutionStartRefusalError
    && validatedCanonicalStartRefusals.has(error)
}

/** Exact status transport provenance. Decoder-valid caller objects and copies are not registered. */
export function isTransportObservedCanonicalExecutionStatusFor(
  lifecycle: unknown,
  project: string,
  executionId: string,
  queryAuthority: object,
): lifecycle is CanonicalExecutionStatus {
  if (!lifecycle || typeof lifecycle !== 'object') return false
  const binding = transportObservedCanonicalStatuses.get(lifecycle as CanonicalExecutionStatus)
  return binding?.project === project
    && binding.executionId === executionId
    && binding.queryAuthority === queryAuthority
}

function canonicalStartRefusalCode(error: ApiError): CanonicalExecutionStartRefusalCode | null {
  if (!error.details || typeof error.details !== 'object' || Array.isArray(error.details)) return null
  const detail = error.details as Record<string, unknown>
  const keys = Object.keys(detail)
  const valid = keys.length === 3 && keys.every(key => ['error', 'code', 'timestamp'].includes(key))
    && typeof detail.error === 'string' && detail.error.length >= 1 && detail.error.length <= 1000
    && typeof detail.code === 'string' && detail.code === error.code && START_REFUSAL_CODES.has(detail.code)
    && exactIso(detail.timestamp)
  return valid ? detail.code as CanonicalExecutionStartRefusalCode : null
}

export function classifyCanonicalExecutionStartFailure(error: unknown): ApiError {
  if (isCanonicalExecutionStartRefusal(error) || error instanceof CanonicalExecutionStartAmbiguousError) return error
  if (error instanceof ApiError) {
    const refusalCode = canonicalStartRefusalCode(error)
    if (refusalCode) {
      const refusal = new CanonicalExecutionStartRefusalError(error, refusalCode)
      validatedCanonicalStartRefusals.add(refusal)
      return refusal
    }
  }
  const cause = error instanceof ApiError
    ? error
    : new ApiError('Canonical Start transport failed.', 0, 'BACKEND_UNAVAILABLE')
  return new CanonicalExecutionStartAmbiguousError(cause)
}

function projectPath(appName: string): string {
  return `/api/v1/projects/${encodeURIComponent(appName)}`
}

function decodeOrRefuse<T>(value: unknown, decode: (input: unknown) => T): T {
  try {
    return decode(value)
  } catch (cause) {
    throw new CanonicalExecutionPayloadError(cause)
  }
}

function rethrow(error: unknown): never {
  if (error instanceof ApiError) throw error
  throw new CanonicalExecutionPayloadError(error)
}

export async function fetchCanonicalExecutionStatus(
  appName: string,
  executionId: string,
  queryAuthority?: object,
): Promise<CanonicalExecutionStatus> {
  try {
    const value = await apiClient.get<unknown>(
      `${projectPath(appName)}/execution/${encodeURIComponent(executionId)}/status`,
    )
    const decoded = decodeOrRefuse(value, decodeCanonicalExecutionStatus)
    if (decoded.executionId !== executionId || decoded.projectId !== appName) {
      throw new CanonicalExecutionPayloadError(new CanonicalExecutionContractError())
    }
    const status = Object.freeze({ ...decoded })
    transportObservedCanonicalStatuses.set(status, {
      project: appName,
      executionId,
      queryAuthority: queryAuthority ?? null,
    })
    return status
  } catch (error) {
    rethrow(error)
  }
}

/** Exact cache identity for the canonical lifecycle transport. */
export function canonicalExecutionStatusQueryKey(appName: string | null, executionId: string | null) {
  return ['canonical-execution-status', appName, executionId] as const
}

export async function fetchCanonicalExecutionPreflight(
  appName: string,
  definitionIds: readonly string[],
  revision: number,
): Promise<ExecutionPreflightResponse> {
  try {
    const value = await apiClient.post<unknown>(`${projectPath(appName)}/execution/preflight`, {
      definitionIds,
      revision,
    })
    try {
      return decodeCanonicalExecutionPreflight(value, { projectId: appName, definitionIds, revision })
    } catch (cause) {
      throw new CanonicalExecutionPreflightPayloadError(cause)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new CanonicalExecutionPreflightPayloadError(error)
  }
}

export async function cancelCanonicalExecution(
  appName: string,
  executionId: string,
): Promise<CanonicalExecutionCancellationAccepted> {
  try {
    const value = await apiClient.post<unknown>(
      `${projectPath(appName)}/execution/${encodeURIComponent(executionId)}/cancel`,
      {},
    )
    const accepted = decodeOrRefuse(value, decodeCanonicalExecutionCancellationAccepted)
    if (accepted.executionId !== executionId) {
      throw new CanonicalExecutionPayloadError(new CanonicalExecutionContractError())
    }
    return accepted
  } catch (error) {
    rethrow(error)
  }
}
