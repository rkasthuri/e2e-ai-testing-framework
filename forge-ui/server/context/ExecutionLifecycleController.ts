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
import { executionContext } from './ExecutionContext'
import { parseExecutionSelection, readExecutionPreflight } from './ExecutionPreflightController'

export interface ExecutionLifecycleHttpResult { status: number; body: unknown }
type Project = { appName: string; url: string }

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null
}

function envelopeData(result: ExecutionLifecycleHttpResult): Record<string, any> | null {
  return result.status === 200 ? record(record(result.body)?.data) : null
}

function rejectionStatus(code: string): number {
  if (code === 'invalid_request' || code === 'empty_selection') return 400
  if (code === 'execution_persistence_unavailable' || code === 'preflight_source_invalid') return 503
  if (code === 'incompatible_definition') return 422
  return 409
}

function rejectionCode(code: string): string {
  switch (code) {
    case 'execution_already_active': return 'EXECUTION_ALREADY_ACTIVE'
    case 'stale_definition': return 'PREFLIGHT_STALE_DEFINITION'
    case 'incompatible_definition': return 'PREFLIGHT_INCOMPATIBLE_DEFINITION'
    case 'legacy_provenance_unsupported': return 'PREFLIGHT_LEGACY_PROVENANCE_UNSUPPORTED'
    case 'support_seal_mismatch': return 'PREFLIGHT_SUPPORT_SEAL_MISMATCH'
    case 'route_unknown': return 'PREFLIGHT_ROUTE_UNKNOWN'
    case 'route_conflicted': return 'PREFLIGHT_ROUTE_CONFLICTED'
    case 'authentication_unknown': return 'PREFLIGHT_AUTHENTICATION_UNKNOWN'
    case 'authentication_conflicted': return 'PREFLIGHT_AUTHENTICATION_CONFLICTED'
    case 'credentials_unavailable': return 'PREFLIGHT_CREDENTIALS_UNAVAILABLE'
    case 'runner_unavailable': return 'PREFLIGHT_RUNNER_UNAVAILABLE'
    case 'conflicting_evidence': return 'PREFLIGHT_CONFLICTING_EVIDENCE'
    case 'preflight_source_invalid': return 'PREFLIGHT_SOURCE_INVALID'
    case 'execution_persistence_unavailable': return 'EXECUTION_PERSISTENCE_UNAVAILABLE'
    case 'empty_selection': return 'PREFLIGHT_EMPTY_SELECTION'
    default: return 'INVALID_EXECUTION_REQUEST'
  }
}

/**
 * Transport-facing composition only. The engine ExecutionService performs the
 * second definition/runner/credential/projection recheck and is the sole owner
 * of durable acceptance and Playwright invocation.
 */
export async function startExecution(
  appName: string,
  body: unknown,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionLifecycleHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const selection = parseExecutionSelection(body)
  if (!selection) return { status: 400, body: fail('Invalid execution request.', 'INVALID_EXECUTION_REQUEST') }
  if (selection.definitionIds.length === 0) {
    return { status: 400, body: fail('At least one current-revision definition must be selected.', 'PREFLIGHT_EMPTY_SELECTION') }
  }

  const preflight = await readExecutionPreflight(appName, body, async () => project)
  if (preflight.status !== 200) return preflight
  const preflightData = envelopeData(preflight)
  const aggregate = record(preflightData?.aggregate)
  if (!aggregate || aggregate.state !== 'ready') {
    const state = typeof aggregate?.state === 'string' ? aggregate.state : 'source_invalid'
    const message = typeof aggregate?.explanation === 'string'
      ? aggregate.explanation
      : 'Execution preflight could not establish a ready verdict.'
    return { status: 409, body: fail(message, `PREFLIGHT_${state.toUpperCase()}`) }
  }

  try {
    const result = await executionContext.startProductExecution(appName, {
      definitionIds: selection.definitionIds,
      revision: selection.revision ?? Number(preflightData?.testSetRevision?.revision),
      runtime: { baseUrl: project.url, loginUrl: project.url },
    }) as any
    if (result.kind !== 'accepted') {
      return {
        status: rejectionStatus(result.code),
        body: fail(result.safeMessage, rejectionCode(result.code)),
      }
    }
    return {
      status: 202,
      body: ok({
        executionId: result.executionId,
        state: 'accepted',
        startedAt: result.startedAt,
        executionPlanHash: result.executionPlanHash,
      }),
    }
  } catch {
    return { status: 503, body: fail('Execution acceptance is temporarily unavailable.', 'EXECUTION_UNAVAILABLE') }
  }
}

export async function readExecutionStatus(
  appName: string,
  executionId: string,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionLifecycleHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(executionId)) {
    return { status: 404, body: fail('Execution not found', 'NOT_FOUND') }
  }
  try {
    const status = await executionContext.readProductExecutionStatus(appName, executionId)
    return status
      ? { status: 200, body: ok(status) }
      : { status: 404, body: fail('Execution not found', 'NOT_FOUND') }
  } catch {
    return { status: 503, body: fail('Durable execution status is temporarily unavailable.', 'EXECUTION_STATUS_UNAVAILABLE') }
  }
}

export async function cancelExecution(
  appName: string,
  executionId: string,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionLifecycleHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(executionId)) {
    return { status: 404, body: fail('Execution not found', 'NOT_FOUND') }
  }
  try {
    const result = await executionContext.cancelProductExecution(appName, executionId) as any
    if (result.kind === 'accepted') {
      return {
        status: 202,
        body: ok({
          executionId,
          state: result.state,
          requestedAt: result.requestedAt,
          alreadyRequested: result.alreadyRequested,
        }),
      }
    }
    if (result.code === 'execution_not_found') {
      return { status: 404, body: fail(result.safeMessage, 'NOT_FOUND') }
    }
    if (result.code === 'execution_already_terminal') {
      return { status: 409, body: fail(result.safeMessage, 'EXECUTION_ALREADY_TERMINAL') }
    }
    if (result.code === 'invalid_request') {
      return { status: 400, body: fail(result.safeMessage, 'INVALID_EXECUTION_REQUEST') }
    }
    return { status: 503, body: fail(result.safeMessage, 'EXECUTION_CANCELLATION_UNAVAILABLE') }
  } catch {
    return { status: 503, body: fail('Execution cancellation is temporarily unavailable.', 'EXECUTION_CANCELLATION_UNAVAILABLE') }
  }
}
