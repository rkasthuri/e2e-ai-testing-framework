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
const SUITE_ID = /^suite-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
type CoreDefinitionResult =
  | {
      definitionId: string; schemaVersion: 2; state: 'eligible'; semanticPlanHash: string
      modelRowId: number; modelVersion: string; supportSealHash: string
      routeEvidence: { normalizedPath: string; normalizationPolicy: { id: string; version: string } }
      authenticationExpectation: { state: 'required' | 'not_required'; mechanism: string | null }
      intrinsicCompatibility: 'compatible'
    }
  | {
      definitionId: string; schemaVersion: 3; state: 'eligible'; semanticPlanHash: string; appArea: string
      modelRowId: number; modelVersion: string; supportSealHash: string; intentId: string; intentContentHash: string
      routes: readonly [{ subjectId: string; normalizedPath: string }, { subjectId: string; normalizedPath: string }]
      actions: readonly ['navigate_to_observed_route', 'click_observed_data_test']
      oracle: { kind: 'subject_observable'; subjectId: string; routePath: string }
      authenticationExpectation: { state: 'required' | 'not_required'; mechanism: string | null }
      intrinsicCompatibility: 'compatible'
    }
type CorePreflight =
  | { kind: 'ready'; definitionResults: CoreDefinitionResult[]; current: { contentHash: string; testSet: { schemaVersion: 2 | 3; revision: number; testSetId: string } }; suiteAuthority?: {suiteId:string;revision:number;contentHash:string;name:string;purpose:'sanity'} }
  | { kind: 'rejected'; code: string; safeMessage: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export type ExecutionSelection = { definitionIds: string[]; revision: number | null }
  | { selection: {kind:'suite_revision';suiteId:string;suiteRevision:number} }

export function parseExecutionSelection(body: unknown): ExecutionSelection | null {
  if (!isRecord(body)) return null
  if ('selection' in body) {
    if (Object.keys(body).length!==1 || !isRecord(body.selection)) return null
    const value=body.selection
    if (Object.keys(value).length!==3 || Object.keys(value).some(key=>!['kind','suiteId','suiteRevision'].includes(key))
      || value.kind!=='suite_revision' || typeof value.suiteId!=='string' || !SUITE_ID.test(value.suiteId)
      || !Number.isSafeInteger(value.suiteRevision) || Number(value.suiteRevision)<1) return null
    return {selection:{kind:'suite_revision',suiteId:value.suiteId,suiteRevision:Number(value.suiteRevision)}}
  }
  if (!Array.isArray(body.definitionIds) || body.definitionIds.length > 50
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
  if ('definitionIds' in request && request.definitionIds.length === 0) return { status: 400, body: fail('At least one current-revision definition must be selected.', 'PREFLIGHT_EMPTY_SELECTION') }
  if ('definitionIds' in request && request.revision === null) return { status: 400, body: fail('The immutable Test Set revision is required.', 'INVALID_PREFLIGHT_REQUEST') }
  try {
    const result = await executionContext.readProductExecutionPreflight(appName, {
      ...('selection' in request ? {selection:request.selection} : {definitionIds:request.definitionIds,revision:request.revision}),
      runtime: {},
    }) as CorePreflight
    if (result.kind === 'ready') {
      const credentials = result.definitionResults.some(definition => definition.authenticationExpectation.state === 'required')
        ? 'available' as const : 'not_required' as const
      if ('selection' in request) {
        const suite=result.suiteAuthority
        if (!suite || suite.suiteId!==request.selection.suiteId || suite.revision!==request.selection.suiteRevision) {
          return {status:503,body:fail('Suite preflight authority could not be validated.','SUITE_INTEGRITY_INVALID')}
        }
        return {status:200,body:ok({
          kind:'suite_preflight',projectId:appName,selection:request.selection,
          selectionAuthority:{kind:'suite_revision',suiteId:suite.suiteId,suiteRevision:suite.revision,suiteContentHash:suite.contentHash,name:suite.name,purpose:suite.purpose},
          aggregate:{state:'ready',explanation:'Core revalidated the exact immutable Suite revision, its current Test Set authority, runner, and runtime credential availability.'},
          definitionResults:result.definitionResults,liveEligibility:{state:'eligible',runner:'available',credentials},
          boundaries:{suiteAuthority:'established',executionEligibility:'eligible',persisted:false},
        })}
      }
      return { status: 200, body: ok({
        project: { id: appName, name: project.appName },
        testSetRevision: {
          revision: result.current.testSet.revision,
          testSetId: result.current.testSet.testSetId,
          schemaVersion: result.current.testSet.schemaVersion,
          contentHash: result.current.contentHash,
        },
        aggregate: { state: 'ready', explanation: `Core revalidated the current v${result.current.testSet.schemaVersion} Definition authority, runner, and runtime credential availability.` },
        definitionResults: result.definitionResults,
        liveEligibility: { state: 'eligible', runner: 'available', credentials },
        boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
      }) }
    }
    const runner = result.code === 'runner_unavailable' ? 'unavailable' as const
      : ['support_seal_mismatch', 'route_unknown', 'route_conflicted', 'authentication_unknown', 'authentication_conflicted', 'credentials_unavailable', 'conflicting_evidence'].includes(result.code)
        ? 'available' as const : 'unknown' as const
    const credentials = result.code === 'credentials_unavailable' ? 'unavailable' as const : 'unknown' as const
    if ('selection' in request) return {status:200,body:ok({
      kind:'suite_preflight',projectId:appName,selection:request.selection,selectionAuthority:null,
      aggregate:{state:result.code,explanation:result.safeMessage},definitionResults:[],
      liveEligibility:{state:'blocked',runner,credentials},boundaries:{suiteAuthority:'not_established',executionEligibility:'blocked',persisted:false},
    })}
    return { status: 200, body: ok({
      project: { id: appName, name: project.appName },
      testSetRevision: { revision: request.revision },
      aggregate: { state: result.code, explanation: result.safeMessage },
      definitionResults: [],
      liveEligibility: { state: 'blocked', runner, credentials },
      boundaries: { generationAuthority: 'not_established', executionEligibility: 'blocked', persisted: false },
    }) }
  } catch {
    return { status: 503, body: fail('Execution preflight authorities are temporarily unavailable.', 'PREFLIGHT_UNAVAILABLE') }
  }
}
