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

import type {
  ExecutionPreflightDefinitionResult,
  ExecutionPreflightResponse,
  ExecutionPreflightState,
} from './types'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/
export const CANONICAL_PREFLIGHT_ROUTE_POLICY = Object.freeze({
  id: 'forge.canonical-route-normalization',
  version: '1',
})
const SUPPORTED_AUTHENTICATION_MECHANISMS = new Set(['form-login'])
const STATES = new Set<ExecutionPreflightState>([
  'empty_selection', 'invalid_request', 'stale_definition', 'incompatible_definition',
  'legacy_provenance_unsupported', 'support_seal_mismatch', 'route_unknown', 'route_conflicted',
  'authentication_unknown', 'authentication_conflicted', 'credentials_unavailable', 'runner_unavailable',
  'conflicting_evidence', 'preflight_source_invalid', 'execution_already_active',
  'execution_persistence_unavailable', 'ready',
])

export interface ExecutionPreflightRequestAuthority {
  projectId: string
  definitionIds: readonly string[]
  revision: number
}

export class CanonicalExecutionPreflightContractError extends Error {
  constructor() {
    super('Canonical execution preflight payload is malformed or does not match its request.')
    this.name = 'CanonicalExecutionPreflightContractError'
  }
}

function fail(): never { throw new CanonicalExecutionPreflightContractError() }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) fail()
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail()
  return value
}

function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail()
  return value
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail()
  return Number(value)
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) fail()
  return value
}

/**
 * Browser-safe parity with CanonicalRouteEvidenceProjection's governed
 * normalizer. Preflight carries an already-normalized path, so normalization
 * must both succeed and be identity-preserving.
 */
export function isCanonicalPreflightRoute(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
    || /[\u0000-\u001f\u007f\\]/.test(value) || value.startsWith('//')) return false
  let pathname: string
  try {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false
      pathname = parsed.pathname
    } else {
      const parsed = new URL(value, 'https://route.invalid')
      if (parsed.origin !== 'https://route.invalid') return false
      pathname = parsed.pathname
    }
    const decoded = decodeURIComponent(pathname)
    if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.length > 500
      || /[\u0000-\u001f\u007f\\]/.test(decoded)
      || decoded.split('/').some(segment => segment === '.' || segment === '..' || /[@=]/.test(segment))
      || /%(?:2f|5c|00|0d|0a)/i.test(pathname)) return false
    return pathname === value
  } catch {
    return false
  }
}

export function isCanonicalPreflightAuthentication(
  state: unknown,
  mechanism: unknown,
): state is 'required' | 'not_required' {
  return state === 'not_required'
    ? mechanism === null
    : state === 'required'
      && typeof mechanism === 'string'
      && SAFE_ID.test(mechanism)
      && SUPPORTED_AUTHENTICATION_MECHANISMS.has(mechanism)
}

function decodeDefinition(value: unknown): ExecutionPreflightDefinitionResult {
  const input = record(value)
  exactKeys(input, [
    'definitionId', 'schemaVersion', 'state', 'semanticPlanHash', 'modelRowId', 'modelVersion',
    'supportSealHash', 'routeEvidence', 'authenticationExpectation', 'intrinsicCompatibility',
  ])
  if (input.schemaVersion !== 2 || input.state !== 'eligible' || input.intrinsicCompatibility !== 'compatible') fail()

  const route = record(input.routeEvidence)
  exactKeys(route, ['normalizedPath', 'normalizationPolicy'])
  const policy = record(route.normalizationPolicy)
  exactKeys(policy, ['id', 'version'])
  if (!isCanonicalPreflightRoute(route.normalizedPath)
    || policy.id !== CANONICAL_PREFLIGHT_ROUTE_POLICY.id
    || policy.version !== CANONICAL_PREFLIGHT_ROUTE_POLICY.version) fail()
  const normalizedPath = route.normalizedPath

  const authentication = record(input.authenticationExpectation)
  exactKeys(authentication, ['state', 'mechanism'])
  if (!isCanonicalPreflightAuthentication(authentication.state, authentication.mechanism)) fail()

  return {
    definitionId: id(input.definitionId),
    schemaVersion: 2,
    state: 'eligible',
    semanticPlanHash: sha(input.semanticPlanHash),
    modelRowId: positiveInteger(input.modelRowId),
    modelVersion: text(input.modelVersion, 255),
    supportSealHash: sha(input.supportSealHash),
    routeEvidence: {
      normalizedPath,
      normalizationPolicy: { id: text(policy.id, 255), version: text(policy.version, 255) },
    },
    authenticationExpectation: {
      state: authentication.state,
      mechanism: authentication.mechanism as string | null,
    },
    intrinsicCompatibility: 'compatible',
  }
}

function exactOrderedIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

export function decodeCanonicalExecutionPreflight(
  value: unknown,
  expected: ExecutionPreflightRequestAuthority,
): ExecutionPreflightResponse {
  if (!SAFE_ID.test(expected.projectId)
    || !Number.isSafeInteger(expected.revision) || expected.revision < 1
    || expected.definitionIds.length < 1 || expected.definitionIds.length > 50
    || expected.definitionIds.some(definitionId => !SAFE_ID.test(definitionId))
    || new Set(expected.definitionIds).size !== expected.definitionIds.length) fail()

  const input = record(value)
  exactKeys(input, ['project', 'testSetRevision', 'definitions', 'aggregate', 'liveEligibility', 'boundaries'])

  const project = record(input.project)
  exactKeys(project, ['id', 'name'])
  const projectId = id(project.id)
  if (projectId !== expected.projectId) fail()

  if (!Array.isArray(input.definitions) || input.definitions.length > 50) fail()
  const definitions = input.definitions.map(decodeDefinition)
  const responseIds = definitions.map(definition => definition.definitionId)
  if (new Set(responseIds).size !== responseIds.length) fail()

  const aggregate = record(input.aggregate)
  exactKeys(aggregate, ['state', 'explanation'])
  if (typeof aggregate.state !== 'string' || !STATES.has(aggregate.state as ExecutionPreflightState)) fail()
  const aggregateState = aggregate.state as ExecutionPreflightState

  const live = record(input.liveEligibility)
  exactKeys(live, ['state', 'runner', 'credentials'])
  if (!['eligible', 'blocked'].includes(String(live.state))
    || !['available', 'unavailable', 'unknown'].includes(String(live.runner))
    || !['available', 'unavailable', 'not_required', 'unknown'].includes(String(live.credentials))) fail()

  const boundaries = record(input.boundaries)
  exactKeys(boundaries, ['generationAuthority', 'executionEligibility', 'persisted'])
  if (!['established', 'not_established'].includes(String(boundaries.generationAuthority))
    || !['eligible', 'blocked'].includes(String(boundaries.executionEligibility))
    || boundaries.persisted !== false) fail()

  const revision = record(input.testSetRevision)
  const revisionKeys = Object.keys(revision)
  const fullRevision = revisionKeys.length === 4
  if (!fullRevision && revisionKeys.length !== 1) fail()
  exactKeys(revision, fullRevision ? ['revision', 'testSetId', 'schemaVersion', 'contentHash'] : ['revision'])
  const revisionNumber = positiveInteger(revision.revision)
  if (revisionNumber !== expected.revision) fail()

  if (aggregateState === 'ready') {
    const expectedCredentialState = definitions.some(definition => definition.authenticationExpectation.state === 'required')
      ? 'available'
      : 'not_required'
    if (!fullRevision || revision.schemaVersion !== 2
      || !exactOrderedIds(responseIds, expected.definitionIds)
      || live.state !== 'eligible' || live.runner !== 'available'
      || live.credentials !== expectedCredentialState
      || boundaries.generationAuthority !== 'established'
      || boundaries.executionEligibility !== 'eligible') fail()
    id(revision.testSetId)
    sha(revision.contentHash)
  } else if (definitions.length !== 0
    || live.state !== 'blocked'
    || boundaries.generationAuthority !== 'not_established'
    || boundaries.executionEligibility !== 'blocked') fail()

  return {
    project: { id: projectId, name: text(project.name, 255) },
    testSetRevision: fullRevision
      ? { revision: revisionNumber, testSetId: id(revision.testSetId), schemaVersion: 2, contentHash: sha(revision.contentHash) }
      : { revision: revisionNumber },
    definitions,
    aggregate: { state: aggregateState, explanation: text(aggregate.explanation, 2000) },
    liveEligibility: {
      state: live.state as 'eligible' | 'blocked',
      runner: live.runner as 'available' | 'unavailable' | 'unknown',
      credentials: live.credentials as 'available' | 'unavailable' | 'not_required' | 'unknown',
    },
    boundaries: {
      generationAuthority: boundaries.generationAuthority as 'established' | 'not_established',
      executionEligibility: boundaries.executionEligibility as 'eligible' | 'blocked',
      persisted: false,
    },
  }
}
