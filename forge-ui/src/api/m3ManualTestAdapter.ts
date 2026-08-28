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

import {
  M3_PROMOTION_ERROR_CODES,
  buildManualAnalyzeRequest,
  decodeManualPromotionResultV1,
  decodeManualTestAnalyzeResponseDto,
  type M3ManualTestAdapter,
  type M3PromotionErrorCode,
} from './m3ManualTestContract'
import { apiClient, ApiError } from './client'

export class M3ManualAnalyzeInputError extends Error {
  readonly code = 'MANUAL_SOURCE_INVALID'
  constructor(message = 'The manual source was rejected as malformed. Review the draft fields and Analyze again.') {
    super(message)
    this.name = 'M3ManualAnalyzeInputError'
  }
}

export class M3ManualPromotionError extends Error {
  readonly code: M3PromotionErrorCode

  constructor(code: M3PromotionErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'M3ManualPromotionError'
    this.code = code
  }
}

export function isM3PromotionErrorCode(value: unknown): value is M3PromotionErrorCode {
  return typeof value === 'string' && M3_PROMOTION_ERROR_CODES.includes(value as M3PromotionErrorCode)
}

function projectPath(projectId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/manual-tests`
}

function classifyAnalyzeFailure(cause: unknown): never {
  if (cause instanceof ApiError && cause.status === 400 && cause.code === 'MANUAL_SOURCE_INVALID') {
    throw new M3ManualAnalyzeInputError(cause.message)
  }
  throw cause
}

function classifySaveFailure(cause: unknown): never {
  if (cause instanceof ApiError && isM3PromotionErrorCode(cause.code)) {
    const expectedStatus = cause.code === 'MANUAL_PROPOSAL_NOT_EXECUTABLE' ? 422 : 409
    if (cause.status === expectedStatus) throw new M3ManualPromotionError(cause.code, cause.message)
  }
  throw cause
}

/** Sole production adapter for the frozen M3 Analyze/Save HTTP vocabulary. */
const m3ManualTestAdapterImplementation: M3ManualTestAdapter = {
  mode: 'backend',
  async analyze(projectId, draft) {
    try {
      return decodeManualTestAnalyzeResponseDto(await apiClient.post<unknown>(
        `${projectPath(projectId)}/analyze`,
        buildManualAnalyzeRequest(draft),
      ))
    } catch (cause) {
      classifyAnalyzeFailure(cause)
    }
  },
  async promote(projectId, request) {
    try {
      return decodeManualPromotionResultV1(await apiClient.post<unknown>(`${projectPath(projectId)}/save`, request))
    } catch (cause) {
      classifySaveFailure(cause)
    }
  },
}

export const m3ManualTestAdapter: M3ManualTestAdapter = Object.freeze(m3ManualTestAdapterImplementation)
