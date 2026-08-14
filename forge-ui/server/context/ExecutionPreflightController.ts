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

export interface ExecutionPreflightHttpResult { status: number; body: unknown }
type Project = { appName: string }
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
interface ReadyPlan {
  fingerprint: string
  value: {
    schemaVersion: 2
    definitionId: string
    steps: Array<{ routePath: string }>
    provenance: { modelRowId: number; modelVersion: string; supportSealHash: string }
    routeEvidence: { normalizationPolicy: { id: string; version: string } }
    authenticationExpectation: { state: 'required' | 'not_required'; mechanism: string | null }
  }
}
type CorePreflight =
  | { kind: 'ready'; plans: ReadyPlan[]; current: { contentHash: string; testSet: { schemaVersion: 2; revision: number; testSetId: string } } }
  | { kind: 'rejected'; code: string; safeMessage: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseExecutionSelection(body: unknown): { definitionIds: string[]; revision: number | null } | null {
  if (!isRecord(body) || !Array.isArray(body.definitionIds) || body.definitionIds.length > 50
    || body.definitionIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))) return null
  const revision = body.revision
  if (revision !== undefined && revision !== null && (!Number.isSafeInteger(revision) || Number(revision) < 1)) return null
  return { definitionIds: body.definitionIds as string[], revision: revision == null ? null : Number(revision) }
}

/** Transport-only boundary. Core ExecutionService owns every authority and runtime eligibility read. */
export async function readExecutionPreflight(
  appName: string,
  body: unknown,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<ExecutionPreflightHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const request = parseExecutionSelection(body)
  if (!request) return { status: 400, body: fail('Invalid execution preflight request.', 'INVALID_PREFLIGHT_REQUEST') }
  if (request.definitionIds.length === 0) return { status: 400, body: fail('At least one current-revision definition must be selected.', 'PREFLIGHT_EMPTY_SELECTION') }
  if (request.revision === null) return { status: 400, body: fail('The immutable Test Set revision is required.', 'INVALID_PREFLIGHT_REQUEST') }
  try {
    const result = await executionContext.readProductExecutionPreflight(appName, {
      definitionIds: request.definitionIds,
      revision: request.revision,
      runtime: {},
    }) as CorePreflight
    if (result.kind === 'ready') {
      const definitions = result.plans.map(plan => ({
        definitionId: plan.value.definitionId,
        schemaVersion: 2 as const,
        state: 'eligible' as const,
        semanticPlanHash: plan.fingerprint,
        modelRowId: plan.value.provenance.modelRowId,
        modelVersion: plan.value.provenance.modelVersion,
        supportSealHash: plan.value.provenance.supportSealHash,
        routeEvidence: {
          normalizedPath: plan.value.steps[0].routePath,
          normalizationPolicy: plan.value.routeEvidence.normalizationPolicy,
        },
        authenticationExpectation: plan.value.authenticationExpectation,
        intrinsicCompatibility: 'compatible' as const,
      }))
      const credentials = definitions.some(definition => definition.authenticationExpectation.state === 'required')
        ? 'available' as const : 'not_required' as const
      return { status: 200, body: ok({
        project: { id: appName, name: project.appName },
        testSetRevision: {
          revision: result.current.testSet.revision,
          testSetId: result.current.testSet.testSetId,
          schemaVersion: 2,
          contentHash: result.current.contentHash,
        },
        aggregate: { state: 'ready', explanation: 'Core revalidated the current v2 Definition, sealed support, route/auth semantics, runner, and runtime credential availability.' },
        definitions,
        liveEligibility: { state: 'eligible', runner: 'available', credentials },
        boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
      }) }
    }
    const runner = result.code === 'runner_unavailable' ? 'unavailable' as const
      : ['support_seal_mismatch', 'route_unknown', 'route_conflicted', 'authentication_unknown', 'authentication_conflicted', 'credentials_unavailable', 'conflicting_evidence'].includes(result.code)
        ? 'available' as const : 'unknown' as const
    const credentials = result.code === 'credentials_unavailable' ? 'unavailable' as const : 'unknown' as const
    return { status: 200, body: ok({
      project: { id: appName, name: project.appName },
      testSetRevision: { revision: request.revision },
      aggregate: { state: result.code, explanation: result.safeMessage },
      definitions: [],
      liveEligibility: { state: 'blocked', runner, credentials },
      boundaries: { generationAuthority: 'not_established', executionEligibility: 'blocked', persisted: false },
    }) }
  } catch {
    return { status: 503, body: fail('Execution preflight authorities are temporarily unavailable.', 'PREFLIGHT_UNAVAILABLE') }
  }
}
