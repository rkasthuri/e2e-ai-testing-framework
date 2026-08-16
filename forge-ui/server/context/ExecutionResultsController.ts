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
import {
  CanonicalResultsContractError,
  serializeCanonicalExecutionResultsList,
  serializeCanonicalExecutionResultsRead,
} from '../../src/api/resultsContract'
import { executionContext } from './ExecutionContext'

export interface ExecutionResultsHttpResult { status: number; body: unknown }
type Project = { appName: string; url: string }
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

function parseLimit(value: unknown): number | null {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return null
  const limit = Number(value)
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 50 ? limit : null
}

export async function listExecutionResults(
  appName: string,
  query: Record<string, unknown>,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionResultsHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const limit = parseLimit(query.limit)
  if (limit === null) {
    return { status: 400, body: fail('limit must be an integer from 1 through 50.', 'INVALID_EXECUTION_RESULTS_QUERY') }
  }
  try {
    const result = serializeCanonicalExecutionResultsList(
      await executionContext.listProductExecutionResults(appName, limit),
      limit,
    )
    return { status: 200, body: ok(result) }
  } catch (cause) {
    if (cause instanceof CanonicalResultsContractError) {
      return { status: 503, body: fail('Canonical Execution Results could not be validated.', 'EXECUTION_RESULTS_PAYLOAD_INVALID') }
    }
    return { status: 503, body: fail('Execution Results are temporarily unavailable.', 'EXECUTION_RESULTS_UNAVAILABLE') }
  }
}

export async function readExecutionResults(
  appName: string,
  executionId: string,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionResultsHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!SAFE_ID.test(executionId)) return { status: 404, body: fail('Execution not found', 'NOT_FOUND') }
  try {
    const result = serializeCanonicalExecutionResultsRead(
      await executionContext.readProductExecutionResults(appName, executionId),
    )
    if (result.kind === 'not_found') return { status: 404, body: fail('Execution not found', 'NOT_FOUND') }
    if (result.kind === 'integrity_invalid') {
      return {
        status: 503,
        body: {
          ...fail('Execution Result integrity is unavailable for safe projection.', 'EXECUTION_RESULTS_INTEGRITY_INVALID'),
          integrityWarnings: result.integrityWarnings,
        },
      }
    }
    return { status: 200, body: ok(result.projection) }
  } catch (cause) {
    if (cause instanceof CanonicalResultsContractError) {
      return { status: 503, body: fail('Canonical Execution Results could not be validated.', 'EXECUTION_RESULTS_PAYLOAD_INVALID') }
    }
    return { status: 503, body: fail('Execution Results are temporarily unavailable.', 'EXECUTION_RESULTS_UNAVAILABLE') }
  }
}
