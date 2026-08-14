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

import * as crypto from 'crypto'
import type { AuthenticationCredentialReference } from '../test-design/TestDefinitionContract'

export interface ExecutablePlanStep {
  kind: 'navigate_to_observed_route'
  subjectId: string
  routePath: string
}

export interface ExecutablePlanOracle {
  kind: 'subject_observable'
  subjectId: string
  assertion: 'final_url_matches_route_no_navigation_error'
}

export interface CanonicalExecutablePlanV1 {
  schemaVersion: 1
  planId: string
  definitionId: string
  title: string
  category: 'navigation'
  steps: ExecutablePlanStep[]
  oracle: ExecutablePlanOracle
  provenance: {
    definitionId: string
    sourceObservationId: string
    modelRowId: number
    modelVersion: string
    supportingEvidenceIds: string[]
    testSetId: string
    revision: number
  }
  authenticationRequired: boolean
  authenticationSetup?: {
    mechanism: string
    credentialReference: AuthenticationCredentialReference
    provenance: { sourceObservationId: string }
  }
  projectedAt: string
}

export interface CanonicalExecutablePlanV2 {
  schemaVersion: 2
  planId: string
  definitionId: string
  title: string
  category: 'navigation'
  steps: ExecutablePlanStep[]
  oracle: ExecutablePlanOracle
  provenance: {
    definitionId: string
    testSetId: string
    revision: number
    testSetContentHash: string
    modelRowId: number
    modelVersion: string
    supportSealHash: string
    routeEvidenceIdentityHash: string
    authenticationExpectationIdentityHash: string
  }
  routeEvidence: {
    normalizationPolicy: { id: string; version: string }
  }
  authenticationExpectation: {
    state: 'required' | 'not_required'
    mechanism: string | null
  }
  projectedAt: string
}

export type CanonicalExecutablePlan = CanonicalExecutablePlanV1 | CanonicalExecutablePlanV2
export type SemanticExecutablePlanContent = Omit<CanonicalExecutablePlan, 'projectedAt'>

export interface MaterializedExecutablePlan {
  value: CanonicalExecutablePlan
  json: string
  semanticJson: string
  fingerprint: string
}

export class ExecutablePlanContractError extends Error {
  constructor(readonly code: 'INVALID_PLAN') {
    super('The executable plan is malformed.')
    this.name = 'ExecutablePlanContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/

function assertText(value: unknown, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new ExecutablePlanContractError('INVALID_PLAN')
}

function validateCommon(value: CanonicalExecutablePlan): void {
  if (!ID.test(value.planId) || !ID.test(value.definitionId)) throw new ExecutablePlanContractError('INVALID_PLAN')
  assertText(value.title)
  if (value.category !== 'navigation' || !ISO.test(value.projectedAt) || Number.isNaN(Date.parse(value.projectedAt))) {
    throw new ExecutablePlanContractError('INVALID_PLAN')
  }
  if (!Array.isArray(value.steps) || value.steps.length !== 1) throw new ExecutablePlanContractError('INVALID_PLAN')
  const step = value.steps[0]
  if (step.kind !== 'navigate_to_observed_route' || !ID.test(step.subjectId) || !ROUTE.test(step.routePath)
    || value.oracle.kind !== 'subject_observable' || value.oracle.subjectId !== step.subjectId
    || value.oracle.assertion !== 'final_url_matches_route_no_navigation_error') {
    throw new ExecutablePlanContractError('INVALID_PLAN')
  }
}

export function validateCanonicalExecutablePlan(value: CanonicalExecutablePlan): void {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new ExecutablePlanContractError('INVALID_PLAN')
  }
  validateCommon(value)
  const provenance = value.provenance
  if (provenance.definitionId !== value.definitionId || !ID.test(provenance.definitionId)
    || !ID.test(provenance.testSetId) || !Number.isSafeInteger(provenance.revision) || provenance.revision < 1
    || !Number.isSafeInteger(provenance.modelRowId) || provenance.modelRowId < 1
    || typeof provenance.modelVersion !== 'string' || provenance.modelVersion.length < 1) {
    throw new ExecutablePlanContractError('INVALID_PLAN')
  }
  if (value.schemaVersion === 1) {
    if (!ID.test(value.provenance.sourceObservationId)
      || !Array.isArray(value.provenance.supportingEvidenceIds)
      || value.provenance.supportingEvidenceIds.length < 1
      || value.provenance.supportingEvidenceIds.some(id => !ID.test(id))
      || typeof value.authenticationRequired !== 'boolean') throw new ExecutablePlanContractError('INVALID_PLAN')
    if (value.authenticationSetup) {
      const setup = value.authenticationSetup
      if (!value.authenticationRequired || !ID.test(setup.credentialReference?.usernameEnv)
        || !ID.test(setup.credentialReference?.passwordEnv)
        || setup.provenance.sourceObservationId !== value.provenance.sourceObservationId) {
        throw new ExecutablePlanContractError('INVALID_PLAN')
      }
      assertText(setup.mechanism, 100)
    }
    return
  }
  if (![value.provenance.testSetContentHash, value.provenance.supportSealHash,
    value.provenance.routeEvidenceIdentityHash, value.provenance.authenticationExpectationIdentityHash]
    .every(hash => SHA256.test(hash))) throw new ExecutablePlanContractError('INVALID_PLAN')
  const policy = value.routeEvidence?.normalizationPolicy
  if (!policy || !ID.test(policy.id) || !ID.test(policy.version)) throw new ExecutablePlanContractError('INVALID_PLAN')
  const auth = value.authenticationExpectation
  if (!auth || !['required', 'not_required'].includes(auth.state)
    || auth.state === 'required' && (!auth.mechanism || !ID.test(auth.mechanism))
    || auth.state === 'not_required' && auth.mechanism !== null) throw new ExecutablePlanContractError('INVALID_PLAN')
}

function semanticContent(value: CanonicalExecutablePlan): SemanticExecutablePlanContent {
  const { projectedAt: _projectedAt, ...semantic } = value
  return semantic
}

export function materializeExecutablePlan(value: CanonicalExecutablePlan): MaterializedExecutablePlan {
  validateCanonicalExecutablePlan(value)
  const json = JSON.stringify(value)
  const reparsed = JSON.parse(json) as CanonicalExecutablePlan
  validateCanonicalExecutablePlan(reparsed)
  const semanticJson = JSON.stringify(semanticContent(reparsed))
  return { value: reparsed, json, semanticJson, fingerprint: crypto.createHash('sha256').update(semanticJson).digest('hex') }
}

export function buildExecutablePlanId(definitionId: string, testSetId: string, revision: number): string {
  return `plan-${crypto.createHash('sha256').update([definitionId, testSetId, revision].join('\u001f')).digest('hex').slice(0, 24)}`
}
