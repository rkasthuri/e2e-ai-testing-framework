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
import {
  evaluateIntrinsicCompatibility,
  PROJECTION_FAILURE_CODES,
  type ProjectionFailureCode,
} from '../execution/DefinitionCompatibilityEvaluator'
import type { CanonicalTestDefinitionAuthority } from './TestDefinitionAuthorityProjectionService'
import type { CanonicalRouteEvidence } from './CanonicalRouteEvidenceProjection'
import type { AuthenticationExpectationProjection } from './AuthenticationExpectationProjection'
import {
  materializeSupportedNormalizedTestIntentV1,
  type MaterializedNormalizedTestIntentV1,
  type NormalizedIntentStepV1,
  type SupportedNormalizedTestIntentV1,
} from './NormalizedTestIntentContract'

export type TestGenerationMethod = 'deterministic' | 'heuristic' | 'ai_assisted' | 'manual'
export type TestGenerationOutcome = 'completed' | 'partially_completed' | 'blocked' | 'failed' | 'interrupted'

/**
 * TD-UI-069C-C — a non-secret reference to WHERE credential material lives
 * (env var names), never the material itself. Structurally identical to
 * forge-ui's CredentialReference (ADR-013); redeclared here because src/
 * never imports forge-ui.
 */
export interface AuthenticationCredentialReference {
  usernameEnv: string
  passwordEnv: string
}

export interface TestDesignAuthorityInput {
  projectId: string
  sourceObservation: {
    id: string
    outcome: 'completed' | 'partially_completed'
    authenticationOutcome: 'succeeded' | 'not_required'
    /** The governed mechanism vocabulary (authType) — 'none' when authenticationOutcome is 'not_required'. */
    authenticationExpectation: string
    /** Non-secret reference only; null exactly when authenticationExpectation is 'none'. */
    credentialReference: AuthenticationCredentialReference | null
    subjectIds: string[]
  }
  model: {
    rowId: number
    version: string
    sourceObservationId: string
    validation: 'valid'
    integrity: 'verified' | 'not_evaluated'
    subjects: Array<{ id: string; routePath: string | null; evidenceId: string | null }>
  }
  evidence: Array<{
    id: string
    canonicalSubjectId: string
    routePath: string | null
    sourceObservationId: string
    sourceModelRows: number[]
    support: 'current'
    integrity: 'verified' | 'not_evaluated'
    freshness: 'not_evaluated'
    access: 'available'
    conflict: 'not_evaluated'
  }>
  generatedAt: string
}

/**
 * TD-UI-069C-C — machine-actionable authentication setup. Describes HOW
 * authentication is obtained (a governed mechanism name + a non-secret
 * reference to where credentials live), never the secret itself. Present
 * only when authenticationRequired is true AND evidence at generation time
 * was complete enough to establish it — an incomplete case leaves this
 * field absent, never a fabricated or partial value.
 */
export interface AuthenticationSetup {
  required: true
  mechanism: string
  credentialReference: AuthenticationCredentialReference
  provenance: { sourceObservationId: string }
}

/**
 * TD-UI-069C-C-R — the single truthful compatibility state, deterministically
 * derived from DefinitionCompatibilityEvaluator (the same evaluator
 * ExecutionProjectionService uses to re-verify live) — never independently
 * inferred here. `reason` is OPTIONAL for backward compatibility: revisions
 * 1 and 2 persisted `{ state: 'blocked', explanation }` with no reason field
 * at all, before this type existed, and remain readable exactly as
 * persisted. New generations always include `reason` when blocked.
 */
export type CanonicalRunnerCompatibility =
  | { state: 'compatible'; explanation: string }
  | { state: 'blocked'; reason?: ProjectionFailureCode; explanation: string }

export interface CanonicalTestDefinitionV1 {
  id: string
  title: string
  intent: string
  category: 'navigation'
  canonicalSubjects: string[]
  preconditions: string[]
  steps: Array<{
    kind: 'navigate_to_observed_route'
    subjectId: string
    routePath: string
    evidenceId: string
  }>
  oracle: {
    kind: 'subject_observable'
    subjectId: string
    evidenceId: string
    explanation: string
  }
  provenance: {
    sourceObservationId: string
    modelRowId: number
    modelVersion: string
    supportingEvidenceIds: string[]
  }
  generationMethod: TestGenerationMethod
  validation: { state: 'valid'; explanation: string }
  runnerCompatibility: CanonicalRunnerCompatibility
  /**
   * Optional (not required) for backward compatibility with revisions
   * generated before TD-UI-069C-C, which never populated it — historical
   * revisions remain readable without retroactively inventing a value. New
   * generations always set this explicitly, never leave it undefined.
   */
  authenticationRequired?: boolean
  authenticationSetup?: AuthenticationSetup
  confidenceLimitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerDefinition: string
}

export interface CanonicalTestSetV1 {
  schemaVersion: 1
  testSetId: string
  revision: number
  projectId: string
  generationId: string
  generatedAt: string
  generationMethod: TestGenerationMethod
  outcome: TestGenerationOutcome
  sourceObservationId: string
  modelRowId: number
  modelVersion: string
  supportingEvidenceIds: string[]
  definitions: CanonicalTestDefinitionV1[]
  limitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerSet: string
  coverage: 'unknown'
  freshness: 'not_evaluated'
}

export interface CanonicalSubjectSupportV2 {
  canonicalSubjectId: string
  supportingObservationIds: readonly string[]
  supportingGapIds: readonly string[]
}

export interface CanonicalTestDefinitionV2 {
  id: string
  title: string
  intent: string
  canonicalSubjects: readonly string[]
  provenance: {
    modelRowId: number
    modelVersion: string
    supportSealHash: string
    subjectSupport: readonly CanonicalSubjectSupportV2[]
  }
  routeEvidence?: {
    normalizedPath: string
    normalizationPolicy: { id: string; version: string }
    supportingObservationIds: readonly string[]
  }
  authenticationExpectation?: {
    state: 'required' | 'not_required' | 'unknown' | 'conflicted'
    mechanism: string | null
    bases: ReadonlyArray<{
      kind: 'declared_configuration'
      policyId: string
      policyVersion: string
      configurationDigest: string
      mechanism: string | null
    }>
  }
  action?: {
    kind: 'navigate_to_observed_route'
    subjectId: string
    routePath: string
  }
  oracle?: {
    kind: 'subject_observable'
    subjectId: string
    supportingObservationIds: readonly string[]
    explanation: string
  }
  generationMethod: TestGenerationMethod
  validation: { state: 'valid'; explanation: string }
  runnerCompatibility?: CanonicalRunnerCompatibility
  confidenceLimitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerDefinition: string
}

/** Frozen M1 richer flow contract. V2 remains navigation-only. */
export interface CanonicalTestDefinitionV3 {
  id: string
  title: string
  intent: string
  canonicalSubjects: readonly string[]
  provenance: {
    modelRowId: number
    modelVersion: string
    supportSealHash: string
    subjectSupport: readonly CanonicalSubjectSupportV2[]
    intentId: string
    intentContentHash: string
  }
  appArea: string
  normalizedIntent: SupportedNormalizedTestIntentV1
  flowRouteEvidence: ReadonlyArray<{
    subjectId: string
    normalizedPath: string
    normalizationPolicy: { id: string; version: string }
    supportingObservationIds: readonly string[]
  }>
  authenticationExpectation: NonNullable<CanonicalTestDefinitionV2['authenticationExpectation']>
  actions: readonly NormalizedIntentStepV1[]
  oracle: NonNullable<CanonicalTestDefinitionV2['oracle']>
  generationMethod: TestGenerationMethod
  validation: { state: 'valid'; explanation: string }
  runnerCompatibility: CanonicalRunnerCompatibility
  confidenceLimitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerDefinition: string
}

export interface CanonicalTestSetV2 {
  schemaVersion: 2
  testSetId: string
  revision: number
  projectId: string
  generationId: string
  generatedAt: string
  generationMethod: TestGenerationMethod
  outcome: TestGenerationOutcome
  canonicalSupport: {
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    characterizationPolicy: { id: string; version: string }
    supportingObservationIds: readonly string[]
    supportingGapIds: readonly string[]
  }
  definitions: readonly CanonicalTestDefinitionV2[]
  limitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerSet: string
  coverage: 'unknown'
  freshness: 'not_evaluated'
}

export interface CanonicalTestSetV3 extends Omit<CanonicalTestSetV2, 'schemaVersion' | 'definitions'> {
  schemaVersion: 3
  definitions: readonly CanonicalTestDefinitionV3[]
}

/** V1 remains the active generation/execution contract until later cutovers. */
export type CanonicalTestDefinition = CanonicalTestDefinitionV1
export type AnyCanonicalTestDefinition = CanonicalTestDefinitionV1 | CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
export type CanonicalTestSet = CanonicalTestSetV1 | CanonicalTestSetV2 | CanonicalTestSetV3

export interface MaterializedTestSet<T extends CanonicalTestSet = CanonicalTestSet> {
  value: T
  json: string
  fingerprint: string
}

export class TestDefinitionContractError extends Error {
  constructor(readonly code: 'AUTHORITY_MISMATCH' | 'STALE_AUTHORITY' | 'UNSUPPORTED_DEFINITION' | 'INVALID_DEFINITION') {
    super(code === 'AUTHORITY_MISMATCH'
      ? 'Current observation, model, and evidence provenance do not agree.'
      : code === 'STALE_AUTHORITY'
        ? 'Canonical Test Definition authority changed before persistence.'
      : code === 'UNSUPPORTED_DEFINITION'
        ? 'The proposed test uses an action or oracle that current evidence does not support.'
        : 'The proposed test definition is malformed.')
    this.name = 'TestDefinitionContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/
const SHA256 = /^[a-f0-9]{64}$/

function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)}`
}

function assertText(value: unknown, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
}

function assertTextList(value: unknown, max = 50): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) throw new TestDefinitionContractError('INVALID_DEFINITION')
  for (const item of value) assertText(item)
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertCanonicalIds(value: unknown, options: { min?: number; max?: number } = {}): asserts value is string[] {
  const min = options.min ?? 0
  const max = options.max ?? 500
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  for (const item of value) if (typeof item !== 'string' || !ID.test(item)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (new Set(value).size !== value.length) throw new TestDefinitionContractError('INVALID_DEFINITION')
  const sorted = [...value].sort(compareCanonical)
  if (sorted.some((item, index) => item !== value[index])) throw new TestDefinitionContractError('INVALID_DEFINITION')
}

/**
 * This is the one representation boundary: construction, validation, hashing,
 * and persistence all use the returned JSON. No downstream layer may rebuild
 * the payload from a looser runtime object.
 */
export function materializeCanonicalTestSet<T extends CanonicalTestSet>(value: T): MaterializedTestSet<T> {
  validateCanonicalTestSet(value)
  const json = JSON.stringify(value)
  const reparsed = JSON.parse(json) as T
  validateCanonicalTestSet(reparsed)
  return {
    value: reparsed,
    json,
    fingerprint: crypto.createHash('sha256').update(json).digest('hex'),
  }
}

export function parseCanonicalTestSet(json: string): MaterializedTestSet {
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new TestDefinitionContractError('INVALID_DEFINITION') }
  if (!value || typeof value !== 'object' || ![1, 2, 3].includes((value as { schemaVersion?: unknown }).schemaVersion as number)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  return materializeCanonicalTestSet(value as CanonicalTestSet)
}

export function parseCanonicalTestSetV2(json: string): MaterializedTestSet<CanonicalTestSetV2> {
  const parsed = parseCanonicalTestSet(json)
  if (parsed.value.schemaVersion !== 2) throw new TestDefinitionContractError('INVALID_DEFINITION')
  return parsed as MaterializedTestSet<CanonicalTestSetV2>
}

export function parseCanonicalTestSetV3(json: string): MaterializedTestSet<CanonicalTestSetV3> {
  const parsed = parseCanonicalTestSet(json)
  if (parsed.value.schemaVersion !== 3) throw new TestDefinitionContractError('INVALID_DEFINITION')
  return parsed as MaterializedTestSet<CanonicalTestSetV3>
}

export interface CanonicalDefinitionSaveResultV3 {
  schemaVersion: 3
  testSetId: string
  definitionId: string
  revision: number
}

export function canonicalDefinitionSaveResultV3(
  testSet: CanonicalTestSetV3,
): CanonicalDefinitionSaveResultV3 {
  validateCanonicalTestSet(testSet)
  if (testSet.definitions.length !== 1) throw new TestDefinitionContractError('INVALID_DEFINITION')
  return {
    schemaVersion: 3,
    testSetId: testSet.testSetId,
    definitionId: testSet.definitions[0].id,
    revision: testSet.revision,
  }
}

export function validateCanonicalTestSet(value: CanonicalTestSet): void {
  if (!value || typeof value !== 'object') throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (value.schemaVersion === 1) return validateCanonicalTestSetV1(value)
  if (value.schemaVersion === 2) return validateCanonicalTestSetV2(value)
  if (value.schemaVersion === 3) return validateCanonicalTestSetV3(value)
  throw new TestDefinitionContractError('INVALID_DEFINITION')
}

function validateCanonicalTestSetV1(value: CanonicalTestSetV1): void {
  for (const identity of [value.testSetId, value.projectId, value.generationId, value.sourceObservationId, value.modelVersion]) {
    if (typeof identity !== 'string' || !ID.test(identity)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.modelRowId) || value.modelRowId < 1) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!ISO.test(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (value.generationMethod !== 'deterministic' || value.outcome !== 'partially_completed'
    || value.coverage !== 'unknown' || value.freshness !== 'not_evaluated') {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Array.isArray(value.definitions) || value.definitions.length < 1 || value.definitions.length > 50) throw new TestDefinitionContractError('INVALID_DEFINITION')
  assertTextList(value.supportingEvidenceIds)
  assertTextList(value.limitations)
  assertTextList(value.materialUnknowns)
  assertTextList(value.unobservedScope)
  assertText(value.preventedStrongerSet)
  const definitionIds = new Set<string>()
  for (const definition of value.definitions) {
    if (!ID.test(definition.id) || definitionIds.has(definition.id)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    definitionIds.add(definition.id)
    assertText(definition.title)
    assertText(definition.intent)
    if (definition.category !== 'navigation' || definition.generationMethod !== 'deterministic') throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    if (!Array.isArray(definition.canonicalSubjects) || definition.canonicalSubjects.length !== 1 || !ID.test(definition.canonicalSubjects[0])) throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertTextList(definition.preconditions)
    if (!Array.isArray(definition.steps) || definition.steps.length !== 1) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    const step = definition.steps[0]
    if (step.kind !== 'navigate_to_observed_route' || !ROUTE.test(step.routePath)
      || step.subjectId !== definition.canonicalSubjects[0] || !ID.test(step.evidenceId)) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    if (definition.oracle.kind !== 'subject_observable'
      || definition.oracle.subjectId !== step.subjectId || definition.oracle.evidenceId !== step.evidenceId) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    assertText(definition.oracle.explanation)
    if (definition.provenance.sourceObservationId !== value.sourceObservationId
      || definition.provenance.modelRowId !== value.modelRowId
      || definition.provenance.modelVersion !== value.modelVersion
      || definition.provenance.supportingEvidenceIds.length !== 1
      || definition.provenance.supportingEvidenceIds[0] !== step.evidenceId) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    if (definition.validation.state !== 'valid'
      || !['compatible', 'blocked'].includes(definition.runnerCompatibility.state)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    // TD-UI-069C-C-R: `reason` is optional (backward compat with revisions
    // 1/2, which have no reason field at all) but must be a real
    // ProjectionFailureCode when present, and may only appear when blocked —
    // never on a compatible definition.
    if (definition.runnerCompatibility.state === 'blocked') {
      const reason = (definition.runnerCompatibility as { reason?: unknown }).reason
      if (reason !== undefined && !PROJECTION_FAILURE_CODES.includes(reason as ProjectionFailureCode)) {
        throw new TestDefinitionContractError('INVALID_DEFINITION')
      }
    } else if ('reason' in definition.runnerCompatibility) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    assertText(definition.validation.explanation)
    assertText(definition.runnerCompatibility.explanation)
    // TD-UI-069C-C: both fields are OPTIONAL for backward compatibility with
    // pre-existing revisions that never carried them — validated only when
    // present, never required, never invented for an old row.
    if (definition.authenticationRequired !== undefined && typeof definition.authenticationRequired !== 'boolean') {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    if (definition.authenticationSetup !== undefined) {
      if (definition.authenticationRequired !== true) throw new TestDefinitionContractError('INVALID_DEFINITION')
      const setup = definition.authenticationSetup
      if (setup.required !== true) throw new TestDefinitionContractError('INVALID_DEFINITION')
      assertText(setup.mechanism, 100)
      if (typeof setup.credentialReference?.usernameEnv !== 'string' || !ID.test(setup.credentialReference.usernameEnv)
        || typeof setup.credentialReference?.passwordEnv !== 'string' || !ID.test(setup.credentialReference.passwordEnv)) {
        throw new TestDefinitionContractError('INVALID_DEFINITION')
      }
      // Authentication setup provenance must agree with the definition's own
      // provenance — never a second, independent provenance chain (§4).
      if (setup.provenance.sourceObservationId !== definition.provenance.sourceObservationId) {
        throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      }
    }
    assertTextList(definition.confidenceLimitations)
    assertTextList(definition.materialUnknowns)
    assertTextList(definition.unobservedScope)
    assertText(definition.preventedStrongerDefinition)
  }
}

function validateCanonicalFlowDefinitionV3(
  definition: CanonicalTestDefinitionV3,
  projectId: string,
  authority: CanonicalTestSetV3['canonicalSupport'],
): void {
  if (!definition.appArea || !ID.test(definition.appArea) || !definition.normalizedIntent
    || !definition.flowRouteEvidence || !definition.actions || !definition.oracle
    || !definition.authenticationExpectation || !definition.runnerCompatibility) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  let materialized: MaterializedNormalizedTestIntentV1
  try {
    materialized = materializeSupportedNormalizedTestIntentV1(definition.normalizedIntent)
  } catch {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!definition.provenance.intentId || !definition.provenance.intentContentHash
    || definition.provenance.intentId !== materialized.value.intentId
    || definition.provenance.intentContentHash !== materialized.fingerprint
    || definition.appArea !== materialized.value.appArea.id
    || materialized.value.projectId !== projectId
    || materialized.value.grounding.modelRowId !== authority.modelRowId
    || materialized.value.grounding.modelVersion !== authority.modelVersion
    || materialized.value.grounding.observationRunId !== authority.observationRunId
    || materialized.value.grounding.supportSealHash !== authority.supportSealHash) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  if (JSON.stringify(definition.actions) !== JSON.stringify(materialized.value.steps)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const intentSubjects = materialized.value.grounding.subjectSupport.map(subject => subject.canonicalSubjectId)
  if (JSON.stringify(intentSubjects) !== JSON.stringify(definition.canonicalSubjects)
    || materialized.value.grounding.subjectSupport.some((subject, index) => {
      const provenance = definition.provenance.subjectSupport[index]
      return !provenance || provenance.canonicalSubjectId !== subject.canonicalSubjectId
        || JSON.stringify(provenance.supportingObservationIds) !== JSON.stringify(subject.supportingObservationIds)
        || JSON.stringify(provenance.supportingGapIds) !== JSON.stringify(subject.supportingGapIds)
    })) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }

  if (!Array.isArray(definition.flowRouteEvidence)
    || definition.flowRouteEvidence.length !== definition.canonicalSubjects.length) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const routeSubjects: string[] = []
  const definitionObservationIds = new Set(definition.provenance.subjectSupport.flatMap(subject => [...subject.supportingObservationIds]))
  for (const route of definition.flowRouteEvidence) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(route as unknown as Record<string, unknown>, ['subjectId', 'normalizedPath', 'normalizationPolicy', 'supportingObservationIds'])
    if (!ID.test(route.subjectId) || !ROUTE.test(route.normalizedPath)
      || !route.normalizationPolicy || !ID.test(route.normalizationPolicy.id) || !ID.test(route.normalizationPolicy.version)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    assertCanonicalIds(route.supportingObservationIds, { min: 1 })
    if (route.supportingObservationIds.some((id: string) => !definitionObservationIds.has(id))) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    routeSubjects.push(route.subjectId)
  }
  assertCanonicalIds(routeSubjects, { min: 1, max: 2 })
  if (JSON.stringify(routeSubjects) !== JSON.stringify(definition.canonicalSubjects)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const routes = new Map(definition.flowRouteEvidence.map(route => [route.subjectId, route]))
  const [navigate, click] = definition.actions
  const outcome = materialized.value.expectedOutcomes[0]
  if (definition.actions.length !== 2 || navigate.kind !== 'navigate_to_observed_route'
    || click.kind !== 'click_observed_data_test' || navigate.ordinal !== 0 || click.ordinal !== 1
    || routes.get(navigate.subjectId)?.normalizedPath !== navigate.routePath
    || routes.get(outcome.subjectId)?.normalizedPath !== outcome.routePath
    || click.targetSubjectId !== outcome.subjectId) {
    throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
  }

  const oracle = definition.oracle
  exactKeys(oracle as unknown as Record<string, unknown>, ['kind', 'subjectId', 'supportingObservationIds', 'explanation'])
  const outcomeRoute = routes.get(outcome.subjectId)!
  if (oracle.kind !== 'subject_observable' || oracle.subjectId !== outcome.subjectId) {
    throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
  }
  assertCanonicalIds(oracle.supportingObservationIds, { min: 1 })
  if (JSON.stringify(oracle.supportingObservationIds) !== JSON.stringify(outcomeRoute.supportingObservationIds)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  assertText(oracle.explanation)

  const auth = definition.authenticationExpectation
  exactKeys(auth as unknown as Record<string, unknown>, ['state', 'mechanism', 'bases'])
  if (!['required', 'not_required', 'unknown', 'conflicted'].includes(auth.state)
    || auth.state === 'required' && (!auth.mechanism || !ID.test(auth.mechanism))
    || auth.state !== 'required' && auth.mechanism !== null || !Array.isArray(auth.bases)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if ((auth.state === 'required' || auth.state === 'not_required') && auth.bases.length < 1) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  let previousDigest = ''
  const basisIdentities = new Set<string>()
  for (const basis of auth.bases) {
    if (!basis || typeof basis !== 'object' || Array.isArray(basis)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(basis as unknown as Record<string, unknown>, ['kind', 'policyId', 'policyVersion', 'configurationDigest', 'mechanism'])
    if (basis.kind !== 'declared_configuration' || !ID.test(basis.policyId) || !ID.test(basis.policyVersion)
      || !SHA256.test(basis.configurationDigest) || basis.configurationDigest < previousDigest
      || basisIdentities.has(basis.configurationDigest)
      || basis.mechanism !== null && !ID.test(basis.mechanism)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    previousDigest = basis.configurationDigest
    basisIdentities.add(basis.configurationDigest)
  }
  const expectedPreconditions = auth.state === 'required' ? 1 : 0
  if (materialized.value.preconditions.length !== expectedPreconditions
    || auth.state === 'required' && materialized.value.preconditions[0]?.mechanism !== auth.mechanism) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }

  const runnerCompatibility = definition.runnerCompatibility
  if (!['compatible', 'blocked'].includes(runnerCompatibility.state)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (runnerCompatibility.state === 'blocked') {
    if (!PROJECTION_FAILURE_CODES.includes(runnerCompatibility.reason as ProjectionFailureCode)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
  } else if ('reason' in runnerCompatibility) throw new TestDefinitionContractError('INVALID_DEFINITION')
  assertText(runnerCompatibility.explanation)
  const evaluated = evaluateIntrinsicCompatibility({
    steps: definition.actions.map(action => action.kind === 'click_observed_data_test'
      ? { kind: action.kind, subjectId: action.subjectId, targetSubjectId: action.targetSubjectId, dataTestValue: action.dataTestValue }
      : { kind: action.kind, subjectId: action.subjectId }),
    oracle: { kind: oracle.kind, subjectId: oracle.subjectId },
    authenticationRequired: undefined,
    authenticationExpectation: { state: auth.state, mechanism: auth.mechanism },
  })
  if (JSON.stringify(evaluated) !== JSON.stringify(runnerCompatibility)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
}

function validateCanonicalTestSetV2(value: CanonicalTestSetV2): void {
  exactKeys(value as unknown as Record<string, unknown>, [
    'schemaVersion', 'testSetId', 'revision', 'projectId', 'generationId', 'generatedAt',
    'generationMethod', 'outcome', 'canonicalSupport', 'definitions', 'limitations',
    'materialUnknowns', 'unobservedScope', 'preventedStrongerSet', 'coverage', 'freshness',
  ])
  for (const identity of [value.testSetId, value.projectId, value.generationId]) {
    if (!ID.test(identity)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1
    || !ISO.test(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))
    || !['deterministic', 'heuristic', 'ai_assisted', 'manual'].includes(value.generationMethod)
    || !['completed', 'partially_completed', 'blocked', 'failed', 'interrupted'].includes(value.outcome)
    || value.coverage !== 'unknown' || value.freshness !== 'not_evaluated') {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  assertTextList(value.limitations)
  assertTextList(value.materialUnknowns)
  assertTextList(value.unobservedScope)
  assertText(value.preventedStrongerSet)

  const authority = value.canonicalSupport
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  exactKeys(authority as unknown as Record<string, unknown>, [
    'modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash',
    'characterizationPolicy', 'supportingObservationIds', 'supportingGapIds',
  ])
  if (!Number.isSafeInteger(authority.modelRowId) || authority.modelRowId < 1
    || !ID.test(authority.modelVersion) || !ID.test(authority.observationRunId)
    || !SHA256.test(authority.supportSealHash)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (!authority.characterizationPolicy || typeof authority.characterizationPolicy !== 'object'
    || Array.isArray(authority.characterizationPolicy)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  exactKeys(authority.characterizationPolicy as unknown as Record<string, unknown>, ['id', 'version'])
  if (!ID.test(authority.characterizationPolicy.id) || !ID.test(authority.characterizationPolicy.version)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  assertCanonicalIds(authority.supportingObservationIds, { min: 1 })
  assertCanonicalIds(authority.supportingGapIds)
  const sealedObservations = new Set(authority.supportingObservationIds)
  const sealedGaps = new Set(authority.supportingGapIds)

  if (!Array.isArray(value.definitions) || value.definitions.length < 1 || value.definitions.length > 50) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  const definitionIds = new Set<string>()
  for (const definition of value.definitions) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    const semanticKeys = ['routeEvidence', 'authenticationExpectation', 'action', 'oracle', 'runnerCompatibility']
    const presentSemanticKeys = semanticKeys.filter(key => Object.hasOwn(definition, key))
    if (presentSemanticKeys.length !== 0 && presentSemanticKeys.length !== semanticKeys.length) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    exactKeys(definition as unknown as Record<string, unknown>, [
      'id', 'title', 'intent', 'canonicalSubjects', 'provenance', 'generationMethod',
      ...(presentSemanticKeys.length ? semanticKeys : []),
      'validation', 'confidenceLimitations', 'materialUnknowns',
      'unobservedScope', 'preventedStrongerDefinition',
    ])
    if (!ID.test(definition.id) || definitionIds.has(definition.id)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    definitionIds.add(definition.id)
    assertText(definition.title)
    assertText(definition.intent)
    assertCanonicalIds(definition.canonicalSubjects, { min: 1, max: 50 })
    if (!['deterministic', 'heuristic', 'ai_assisted', 'manual'].includes(definition.generationMethod)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    if (!definition.validation || typeof definition.validation !== 'object' || Array.isArray(definition.validation)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    exactKeys(definition.validation as unknown as Record<string, unknown>, ['state', 'explanation'])
    if (definition.validation.state !== 'valid') throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertText(definition.validation.explanation)
    assertTextList(definition.confidenceLimitations)
    assertTextList(definition.materialUnknowns)
    assertTextList(definition.unobservedScope)
    assertText(definition.preventedStrongerDefinition)

    const provenance = definition.provenance
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(provenance as unknown as Record<string, unknown>, ['modelRowId', 'modelVersion', 'supportSealHash', 'subjectSupport'])
    if (provenance.modelRowId !== authority.modelRowId || provenance.modelVersion !== authority.modelVersion
      || provenance.supportSealHash !== authority.supportSealHash) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    if (!Array.isArray(provenance.subjectSupport) || provenance.subjectSupport.length !== definition.canonicalSubjects.length) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    const subjectIds: string[] = []
    for (const subject of provenance.subjectSupport) {
      if (!subject || typeof subject !== 'object' || Array.isArray(subject)) throw new TestDefinitionContractError('INVALID_DEFINITION')
      exactKeys(subject as unknown as Record<string, unknown>, ['canonicalSubjectId', 'supportingObservationIds', 'supportingGapIds'])
      if (!ID.test(subject.canonicalSubjectId)) throw new TestDefinitionContractError('INVALID_DEFINITION')
      assertCanonicalIds(subject.supportingObservationIds)
      assertCanonicalIds(subject.supportingGapIds)
      if (subject.supportingObservationIds.length + subject.supportingGapIds.length === 0) {
        throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      }
      if (subject.supportingObservationIds.some((id: string) => !sealedObservations.has(id))
        || subject.supportingGapIds.some((id: string) => !sealedGaps.has(id))) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      subjectIds.push(subject.canonicalSubjectId)
    }
    assertCanonicalIds(subjectIds, { min: 1, max: 50 })
    if (subjectIds.some((id, index) => id !== definition.canonicalSubjects[index])) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    if (presentSemanticKeys.length === 0) continue

    const route = definition.routeEvidence!
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(route as unknown as Record<string, unknown>, ['normalizedPath', 'normalizationPolicy', 'supportingObservationIds'])
    if (!ROUTE.test(route.normalizedPath) || !route.normalizationPolicy || typeof route.normalizationPolicy !== 'object'
      || Array.isArray(route.normalizationPolicy)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(route.normalizationPolicy as unknown as Record<string, unknown>, ['id', 'version'])
    if (!ID.test(route.normalizationPolicy.id) || !ID.test(route.normalizationPolicy.version)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertCanonicalIds(route.supportingObservationIds, { min: 1 })
    const definitionObservationIds = new Set<string>((provenance.subjectSupport as readonly CanonicalSubjectSupportV2[])
      .flatMap((subject: CanonicalSubjectSupportV2) => [...subject.supportingObservationIds]))
    if ((route.supportingObservationIds as readonly string[]).some((id: string) => !definitionObservationIds.has(id))) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }

    const auth = definition.authenticationExpectation!
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(auth as unknown as Record<string, unknown>, ['state', 'mechanism', 'bases'])
    if (!['required', 'not_required', 'unknown', 'conflicted'].includes(auth.state)
      || (auth.mechanism !== null && (typeof auth.mechanism !== 'string' || !ID.test(auth.mechanism)))
      || !Array.isArray(auth.bases)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    if (auth.state === 'required' ? auth.mechanism === null : auth.mechanism !== null) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    if ((auth.state === 'required' || auth.state === 'not_required') && auth.bases.length < 1) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    let previousDigest = ''
    const basisIdentities = new Set<string>()
    for (const basis of auth.bases) {
      if (!basis || typeof basis !== 'object' || Array.isArray(basis)) throw new TestDefinitionContractError('INVALID_DEFINITION')
      exactKeys(basis as unknown as Record<string, unknown>, ['kind', 'policyId', 'policyVersion', 'configurationDigest', 'mechanism'])
      if (basis.kind !== 'declared_configuration' || !ID.test(basis.policyId) || !ID.test(basis.policyVersion)
        || !SHA256.test(basis.configurationDigest)
        || (basis.mechanism !== null && (typeof basis.mechanism !== 'string' || !ID.test(basis.mechanism)))
        || basis.configurationDigest < previousDigest || basisIdentities.has(basis.configurationDigest)) {
        throw new TestDefinitionContractError('INVALID_DEFINITION')
      }
      previousDigest = basis.configurationDigest
      basisIdentities.add(basis.configurationDigest)
    }

    const action = definition.action!
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(action as unknown as Record<string, unknown>, ['kind', 'subjectId', 'routePath'])
    if (action.kind !== 'navigate_to_observed_route' || action.subjectId !== definition.canonicalSubjects[0]
      || action.routePath !== route.normalizedPath) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    const oracle = definition.oracle!
    if (!oracle || typeof oracle !== 'object' || Array.isArray(oracle)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    exactKeys(oracle as unknown as Record<string, unknown>, ['kind', 'subjectId', 'supportingObservationIds', 'explanation'])
    if (oracle.kind !== 'subject_observable' || oracle.subjectId !== action.subjectId) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    assertCanonicalIds(oracle.supportingObservationIds, { min: 1 })
    if (oracle.supportingObservationIds.length !== route.supportingObservationIds.length
      || (oracle.supportingObservationIds as readonly string[]).some((id: string, index: number) => id !== route.supportingObservationIds[index])) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    assertText(oracle.explanation)
    const runnerCompatibility = definition.runnerCompatibility!
    if (!['compatible', 'blocked'].includes(runnerCompatibility.state)) {
      throw new TestDefinitionContractError('INVALID_DEFINITION')
    }
    if (runnerCompatibility.state === 'blocked') {
      if (!PROJECTION_FAILURE_CODES.includes(runnerCompatibility.reason as ProjectionFailureCode)) {
        throw new TestDefinitionContractError('INVALID_DEFINITION')
      }
    } else if ('reason' in runnerCompatibility) throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertText(runnerCompatibility.explanation)
    const evaluated = evaluateIntrinsicCompatibility({
      steps: [{ kind: action.kind, subjectId: action.subjectId }],
      oracle: { kind: oracle.kind, subjectId: oracle.subjectId },
      authenticationRequired: undefined,
      authenticationExpectation: { state: auth.state, mechanism: auth.mechanism },
    })
    if (JSON.stringify(evaluated) !== JSON.stringify(runnerCompatibility)) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
  }
}

function validateCanonicalTestSetV3(value: CanonicalTestSetV3): void {
  exactKeys(value as unknown as Record<string, unknown>, [
    'schemaVersion', 'testSetId', 'revision', 'projectId', 'generationId', 'generatedAt',
    'generationMethod', 'outcome', 'canonicalSupport', 'definitions', 'limitations',
    'materialUnknowns', 'unobservedScope', 'preventedStrongerSet', 'coverage', 'freshness',
  ])
  for (const identity of [value.testSetId, value.projectId, value.generationId]) {
    if (!ID.test(identity)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1
    || !ISO.test(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))
    || value.generationMethod !== 'deterministic' || value.outcome !== 'completed'
    || value.coverage !== 'unknown' || value.freshness !== 'not_evaluated') {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  assertTextList(value.limitations)
  assertTextList(value.materialUnknowns)
  assertTextList(value.unobservedScope)
  assertText(value.preventedStrongerSet)

  const authority = value.canonicalSupport
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  exactKeys(authority as unknown as Record<string, unknown>, [
    'modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash',
    'characterizationPolicy', 'supportingObservationIds', 'supportingGapIds',
  ])
  if (!Number.isSafeInteger(authority.modelRowId) || authority.modelRowId < 1
    || !ID.test(authority.modelVersion) || !ID.test(authority.observationRunId)
    || !SHA256.test(authority.supportSealHash)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (!authority.characterizationPolicy || typeof authority.characterizationPolicy !== 'object'
    || Array.isArray(authority.characterizationPolicy)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  exactKeys(authority.characterizationPolicy as unknown as Record<string, unknown>, ['id', 'version'])
  if (!ID.test(authority.characterizationPolicy.id) || !ID.test(authority.characterizationPolicy.version)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  assertCanonicalIds(authority.supportingObservationIds, { min: 1 })
  assertCanonicalIds(authority.supportingGapIds)

  if (!Array.isArray(value.definitions) || value.definitions.length !== 1) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  const definition = value.definitions[0]
  exactKeys(definition as unknown as Record<string, unknown>, [
    'id', 'title', 'intent', 'canonicalSubjects', 'provenance', 'appArea',
    'normalizedIntent', 'flowRouteEvidence', 'authenticationExpectation', 'actions',
    'oracle', 'generationMethod', 'validation', 'runnerCompatibility',
    'confidenceLimitations', 'materialUnknowns', 'unobservedScope', 'preventedStrongerDefinition',
  ])
  if (!ID.test(definition.id) || definition.generationMethod !== 'deterministic') {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  assertText(definition.title)
  assertText(definition.intent)
  assertCanonicalIds(definition.canonicalSubjects, { min: 2, max: 2 })
  if (!definition.validation || typeof definition.validation !== 'object' || Array.isArray(definition.validation)) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  exactKeys(definition.validation as unknown as Record<string, unknown>, ['state', 'explanation'])
  if (definition.validation.state !== 'valid') throw new TestDefinitionContractError('INVALID_DEFINITION')
  assertText(definition.validation.explanation)
  assertTextList(definition.confidenceLimitations)
  assertTextList(definition.materialUnknowns)
  assertTextList(definition.unobservedScope)
  assertText(definition.preventedStrongerDefinition)

  const provenance = definition.provenance
  exactKeys(provenance as unknown as Record<string, unknown>, [
    'modelRowId', 'modelVersion', 'supportSealHash', 'subjectSupport', 'intentId', 'intentContentHash',
  ])
  if (provenance.modelRowId !== authority.modelRowId || provenance.modelVersion !== authority.modelVersion
    || provenance.supportSealHash !== authority.supportSealHash || !ID.test(provenance.intentId)
    || !SHA256.test(provenance.intentContentHash)
    || !Array.isArray(provenance.subjectSupport) || provenance.subjectSupport.length !== 2) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const sealedObservations = new Set(authority.supportingObservationIds)
  const sealedGaps = new Set(authority.supportingGapIds)
  const subjectIds: string[] = []
  for (const subject of provenance.subjectSupport) {
    exactKeys(subject as unknown as Record<string, unknown>, ['canonicalSubjectId', 'supportingObservationIds', 'supportingGapIds'])
    if (!ID.test(subject.canonicalSubjectId)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertCanonicalIds(subject.supportingObservationIds, { min: 1 })
    assertCanonicalIds(subject.supportingGapIds)
    if (subject.supportingObservationIds.some((id: string) => !sealedObservations.has(id))
      || subject.supportingGapIds.some((id: string) => !sealedGaps.has(id))) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    subjectIds.push(subject.canonicalSubjectId)
  }
  assertCanonicalIds(subjectIds, { min: 2, max: 2 })
  if (JSON.stringify(subjectIds) !== JSON.stringify(definition.canonicalSubjects)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  validateCanonicalFlowDefinitionV3(definition, value.projectId, authority)
}

export function generateEvidenceBackedTestSet(
  input: TestDesignAuthorityInput,
  generationId: string,
  revision: number,
): MaterializedTestSet<CanonicalTestSetV1> {
  if (!ID.test(input.projectId) || !ID.test(generationId) || !ISO.test(input.generatedAt)
    || input.model.validation !== 'valid' || input.model.sourceObservationId !== input.sourceObservation.id
    || !['completed', 'partially_completed'].includes(input.sourceObservation.outcome)
    || !['succeeded', 'not_required'].includes(input.sourceObservation.authenticationOutcome)
    || typeof input.sourceObservation.authenticationExpectation !== 'string'
    || (input.sourceObservation.authenticationOutcome === 'not_required'
      ? input.sourceObservation.credentialReference !== null
      : !input.sourceObservation.credentialReference)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  // TD-UI-069C-C — deterministic, evidence-only. `succeeded` is the only
  // authenticationOutcome value (besides `not_required`) this input accepts
  // (checked above), so it alone establishes both that auth was required and
  // that it worked; the credential reference is always structurally present
  // in that case (checked above) and is carried forward as a REFERENCE only
  // — never resolved, never a secret value. Incomplete evidence (no
  // reference derivable) intentionally leaves authenticationSetup absent
  // rather than fabricating one.
  const authenticationRequired = input.sourceObservation.authenticationOutcome === 'succeeded'
  const authenticationSetup = authenticationRequired && input.sourceObservation.credentialReference
    ? {
        required: true as const,
        mechanism: input.sourceObservation.authenticationExpectation,
        credentialReference: input.sourceObservation.credentialReference,
        provenance: { sourceObservationId: input.sourceObservation.id },
      }
    : undefined
  const observed = new Set(input.sourceObservation.subjectIds)
  const modelSubjects = new Map(input.model.subjects.map(subject => [subject.id, subject]))
  const definitions = [...input.evidence]
    .sort((left, right) => left.canonicalSubjectId.localeCompare(right.canonicalSubjectId) || left.id.localeCompare(right.id))
    .map(evidence => {
      const subject = modelSubjects.get(evidence.canonicalSubjectId)
      if (!subject || !observed.has(evidence.canonicalSubjectId) || subject.evidenceId !== evidence.id
        || subject.routePath !== evidence.routePath || evidence.sourceObservationId !== input.sourceObservation.id
        || !evidence.sourceModelRows.includes(input.model.rowId) || evidence.support !== 'current'
        || evidence.access !== 'available' || evidence.conflict !== 'not_evaluated'
        || !evidence.routePath || !ROUTE.test(evidence.routePath)) {
        throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      }
      if (evidence.integrity !== 'verified' && evidence.integrity !== 'not_evaluated') throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      const intent = `Establish whether the observed subject ${evidence.canonicalSubjectId} remains observable at its evidenced route.`
      return {
        id: stableId('test', input.projectId, evidence.canonicalSubjectId, 'navigation', intent),
        title: `Observe ${evidence.canonicalSubjectId}`,
        intent,
        category: 'navigation' as const,
        canonicalSubjects: [evidence.canonicalSubjectId],
        preconditions: authenticationSetup
          ? [`An authenticated session is required. A structured, evidence-backed authentication setup (mechanism: ${authenticationSetup.mechanism}) has been established from source observation ${authenticationSetup.provenance.sourceObservationId}.`]
          : authenticationRequired
            ? ['A separately governed authenticated session is required; current evidence does not establish reusable session setup.']
            : [],
        steps: [{ kind: 'navigate_to_observed_route' as const, subjectId: evidence.canonicalSubjectId, routePath: evidence.routePath, evidenceId: evidence.id }],
        oracle: { kind: 'subject_observable' as const, subjectId: evidence.canonicalSubjectId, evidenceId: evidence.id, explanation: 'Observe the same canonical subject without assuming page completeness or a business outcome.' },
        provenance: { sourceObservationId: input.sourceObservation.id, modelRowId: input.model.rowId, modelVersion: input.model.version, supportingEvidenceIds: [evidence.id] },
        generationMethod: 'deterministic' as const,
        validation: { state: 'valid' as const, explanation: 'The definition matches one current-support subject, route, model, observation, and evidence identity.' },
        // TD-UI-069C-C-R: runnerCompatibility describes only whether this
        // definition itself can be projected/executed — never whether a
        // runner adapter is available (a separate, environment-scoped
        // preflight concern) — and is stamped by calling the exact same
        // shared evaluator ExecutionProjectionService re-verifies with live.
        // ONE owner of compatibility truth; this is never independently
        // inferred here.
        runnerCompatibility: evaluateIntrinsicCompatibility({
          steps: [{ kind: 'navigate_to_observed_route', subjectId: evidence.canonicalSubjectId }],
          oracle: { kind: 'subject_observable', subjectId: evidence.canonicalSubjectId },
          authenticationRequired,
          authenticationSetup: authenticationSetup ? { mechanism: authenticationSetup.mechanism } : undefined,
        }),
        authenticationRequired,
        ...(authenticationSetup ? { authenticationSetup } : {}),
        confidenceLimitations: ['Evidence integrity and freshness were not evaluated.'],
        materialUnknowns: ['Current behavior outside the evidenced subject and route is unknown.'],
        unobservedScope: ['Application scope outside the explicitly referenced subjects remains unknown.'],
        preventedStrongerDefinition: 'No current evidence establishes selectors, multi-step workflow behavior, business rules, or an executable success oracle.',
      }
    })
  if (definitions.length === 0) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  const evidenceIds = definitions.map(definition => definition.provenance.supportingEvidenceIds[0]).sort()
  return materializeCanonicalTestSet({
    schemaVersion: 1,
    testSetId: stableId('test-set', input.projectId),
    revision,
    projectId: input.projectId,
    generationId,
    generatedAt: input.generatedAt,
    generationMethod: 'deterministic',
    outcome: 'partially_completed',
    sourceObservationId: input.sourceObservation.id,
    modelRowId: input.model.rowId,
    modelVersion: input.model.version,
    supportingEvidenceIds: evidenceIds,
    definitions,
    limitations: ['Generation was deterministic and did not use AI enrichment.', 'Definitions were not executed.'],
    materialUnknowns: authenticationSetup
      ? ['Selectors, workflow actions, and business oracles remain unknown. Authentication setup mechanism and reference are established; whether the credential reference currently resolves is not evaluated here.']
      : ['Runner-compatible authentication setup, selectors, workflow actions, and business oracles remain unknown.'],
    unobservedScope: ['Coverage outside the exact supporting subjects is unknown.'],
    preventedStrongerSet: 'Current evidence supports bounded subject observation intents, but not executable workflows or coverage conclusions.',
    coverage: 'unknown',
    freshness: 'not_evaluated',
  })
}

export interface CanonicalV2GenerationInput {
  projectId: string
  generatedAt: string
  authority: CanonicalTestDefinitionAuthority
  routeEvidence: CanonicalRouteEvidence
  authenticationExpectation: AuthenticationExpectationProjection
}

export function generateCanonicalTestSetV2(
  input: CanonicalV2GenerationInput,
  generationId: string,
  revision: number,
): MaterializedTestSet<CanonicalTestSetV2> {
  const { authority, routeEvidence, authenticationExpectation } = input
  if (!ID.test(input.projectId) || !ID.test(generationId) || !ISO.test(input.generatedAt)
    || authority.projectId !== input.projectId || routeEvidence.projectId !== input.projectId
    || routeEvidence.modelRowId !== authority.modelRowId
    || routeEvidence.supportSealHash !== authority.supportSealHash) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const routeBySubject = new Map(routeEvidence.subjects.map(subject => [subject.canonicalSubjectId, subject]))
  const definitions: CanonicalTestDefinitionV2[] = authority.subjectSupport.map(subject => {
    const route = routeBySubject.get(subject.canonicalSubjectId)
    if (!route) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    const intent = `Establish whether canonical subject ${subject.canonicalSubjectId} remains observable at its governed route.`
    const action = {
      kind: 'navigate_to_observed_route' as const,
      subjectId: subject.canonicalSubjectId,
      routePath: route.normalizedPath,
    }
    const oracle = {
      kind: 'subject_observable' as const,
      subjectId: subject.canonicalSubjectId,
      supportingObservationIds: [...route.supportingObservationIds],
      explanation: 'Observe the same sealed canonical subject without asserting page completeness or a business outcome.',
    }
    const runnerCompatibility = evaluateIntrinsicCompatibility({
      steps: [{ kind: action.kind, subjectId: action.subjectId }],
      oracle: { kind: oracle.kind, subjectId: oracle.subjectId },
      authenticationRequired: undefined,
      authenticationExpectation: {
        state: authenticationExpectation.state,
        mechanism: authenticationExpectation.mechanism,
      },
    })
    return {
      id: stableId('test-v2', input.projectId, authority.supportSealHash, subject.canonicalSubjectId, route.normalizedPath),
      title: `Observe ${subject.canonicalSubjectId}`,
      intent,
      canonicalSubjects: [subject.canonicalSubjectId],
      provenance: {
        modelRowId: authority.modelRowId,
        modelVersion: authority.modelVersion,
        supportSealHash: authority.supportSealHash,
        subjectSupport: [{
          canonicalSubjectId: subject.canonicalSubjectId,
          supportingObservationIds: [...subject.supportingObservationIds],
          supportingGapIds: [...subject.supportingGapIds],
        }],
      },
      routeEvidence: {
        normalizedPath: route.normalizedPath,
        normalizationPolicy: { ...routeEvidence.normalizationPolicy },
        supportingObservationIds: [...route.supportingObservationIds],
      },
      authenticationExpectation: {
        state: authenticationExpectation.state,
        mechanism: authenticationExpectation.mechanism,
        bases: authenticationExpectation.bases.map(basis => ({ ...basis })),
      },
      action,
      oracle,
      generationMethod: 'deterministic',
      validation: { state: 'valid', explanation: 'The definition is bound to one sealed subject support set and one exact canonical route.' },
      runnerCompatibility,
      confidenceLimitations: authenticationExpectation.state === 'unknown'
        ? ['Authentication expectation is unknown; this definition is intentionally blocked.']
        : authenticationExpectation.state === 'conflicted'
          ? ['Governed authentication declarations conflict; this definition is intentionally blocked.']
          : [],
      materialUnknowns: ['Credential availability and runtime authentication outcome are execution-time truths and were not evaluated.'],
      unobservedScope: ['Application behavior outside this exact sealed subject and route remains unknown.'],
      preventedStrongerDefinition: runnerCompatibility.state === 'compatible'
        ? 'No stronger workflow or business-outcome semantics are supported by the current canonical evidence.'
        : runnerCompatibility.explanation,
    }
  })
  if (definitions.length === 0 || routeBySubject.size !== definitions.length) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const blocked = definitions.some(definition => definition.runnerCompatibility?.state === 'blocked')
  return materializeCanonicalTestSet({
    schemaVersion: 2,
    testSetId: stableId('test-set-v2', input.projectId),
    revision,
    projectId: input.projectId,
    generationId,
    generatedAt: input.generatedAt,
    generationMethod: 'deterministic',
    outcome: blocked ? 'blocked' : 'completed',
    canonicalSupport: {
      modelRowId: authority.modelRowId,
      modelVersion: authority.modelVersion,
      observationRunId: authority.observationRunId,
      supportSealHash: authority.supportSealHash,
      characterizationPolicy: { ...authority.characterizationPolicy },
      supportingObservationIds: [...authority.supportingObservationIds],
      supportingGapIds: [...authority.supportingGapIds],
    },
    definitions,
    limitations: ['Generation was deterministic, used no AI enrichment, and did not execute definitions.'],
    materialUnknowns: ['Credential availability and authentication execution outcome remain outside Test Definition authority.'],
    unobservedScope: ['Coverage outside the exact sealed App Model support set is unknown.'],
    preventedStrongerSet: blocked
      ? 'One or more definitions preserve unresolved authentication semantics and are intentionally blocked.'
      : 'Current evidence supports bounded navigation and subject-observability semantics only.',
    coverage: 'unknown',
    freshness: 'not_evaluated',
  })
}

export interface CanonicalV3FlowGenerationInput extends CanonicalV2GenerationInput {
  normalizedIntent: MaterializedNormalizedTestIntentV1
}

/** Shared materializer for the frozen v3 shape. Public producers remain source-specific. */
function generateCanonicalFlowTestSetV3ForSource(
  input: CanonicalV3FlowGenerationInput,
  generationId: string,
  revision: number,
  expectedSource: 'discovered' | 'manual',
): MaterializedTestSet<CanonicalTestSetV3> {
  const { authority, routeEvidence, authenticationExpectation } = input
  let normalized: MaterializedNormalizedTestIntentV1
  try {
    normalized = materializeSupportedNormalizedTestIntentV1(input.normalizedIntent.value)
  } catch {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (normalized.fingerprint !== input.normalizedIntent.fingerprint || normalized.json !== input.normalizedIntent.json
    || !ID.test(input.projectId) || !ID.test(generationId) || !ISO.test(input.generatedAt)
    || normalized.value.source !== expectedSource
    || normalized.value.projectId !== input.projectId || authority.projectId !== input.projectId
    || routeEvidence.projectId !== input.projectId || routeEvidence.modelRowId !== authority.modelRowId
    || routeEvidence.supportSealHash !== authority.supportSealHash
    || normalized.value.grounding.modelRowId !== authority.modelRowId
    || normalized.value.grounding.modelVersion !== authority.modelVersion
    || normalized.value.grounding.observationRunId !== authority.observationRunId
    || normalized.value.grounding.supportSealHash !== authority.supportSealHash) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const routeBySubject = new Map(routeEvidence.subjects.map(subject => [subject.canonicalSubjectId, subject]))
  const supportBySubject = new Map(authority.subjectSupport.map(subject => [subject.canonicalSubjectId, subject]))
  const subjects = normalized.value.grounding.subjectSupport.map(subject => subject.canonicalSubjectId)
  const flowRoutes = subjects.map(subjectId => {
    const route = routeBySubject.get(subjectId)
    const support = supportBySubject.get(subjectId)
    const intentSupport = normalized.value.grounding.subjectSupport.find(subject => subject.canonicalSubjectId === subjectId)
    if (!route || !support || !intentSupport
      || JSON.stringify(support.supportingObservationIds) !== JSON.stringify(intentSupport.supportingObservationIds)
      || JSON.stringify(support.supportingGapIds) !== JSON.stringify(intentSupport.supportingGapIds)) {
      throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    }
    return {
      subjectId,
      normalizedPath: route.normalizedPath,
      normalizationPolicy: { ...routeEvidence.normalizationPolicy },
      supportingObservationIds: [...route.supportingObservationIds],
    }
  })
  const actions = normalized.value.steps.map(action => ({ ...action })) as NormalizedIntentStepV1[]
  const outcome = normalized.value.expectedOutcomes[0]
  const outcomeRoute = flowRoutes.find(route => route.subjectId === outcome.subjectId)
  if (!outcomeRoute || outcomeRoute.normalizedPath !== outcome.routePath) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const oracle = {
    kind: 'subject_observable' as const,
    subjectId: outcome.subjectId,
    supportingObservationIds: [...outcomeRoute.supportingObservationIds],
    explanation: 'Observe the sealed target subject at its governed final route after the directly observed click transition.',
  }
  const runnerCompatibility = evaluateIntrinsicCompatibility({
    steps: actions.map(action => action.kind === 'click_observed_data_test'
      ? { kind: action.kind, subjectId: action.subjectId, targetSubjectId: action.targetSubjectId, dataTestValue: action.dataTestValue }
      : { kind: action.kind, subjectId: action.subjectId }),
    oracle: { kind: oracle.kind, subjectId: oracle.subjectId },
    authenticationRequired: undefined,
    authenticationExpectation: {
      state: authenticationExpectation.state,
      mechanism: authenticationExpectation.mechanism,
    },
  })
  if (runnerCompatibility.state !== 'compatible') throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
  const definition: CanonicalTestDefinitionV3 = {
    id: stableId('test-v3-flow', input.projectId, normalized.value.intentId, normalized.fingerprint),
    title: normalized.value.title,
    intent: normalized.value.objective,
    canonicalSubjects: subjects,
    provenance: {
      modelRowId: authority.modelRowId,
      modelVersion: authority.modelVersion,
      supportSealHash: authority.supportSealHash,
      subjectSupport: normalized.value.grounding.subjectSupport.map(subject => ({
        canonicalSubjectId: subject.canonicalSubjectId,
        supportingObservationIds: [...subject.supportingObservationIds],
        supportingGapIds: [...subject.supportingGapIds],
      })),
      intentId: normalized.value.intentId,
      intentContentHash: normalized.fingerprint,
    },
    appArea: normalized.value.appArea.id,
    normalizedIntent: normalized.value,
    flowRouteEvidence: flowRoutes,
    authenticationExpectation: {
      state: authenticationExpectation.state,
      mechanism: authenticationExpectation.mechanism,
      bases: authenticationExpectation.bases.map(basis => ({ ...basis })),
    },
    actions,
    oracle,
    generationMethod: 'deterministic',
    validation: {
      state: 'valid',
      explanation: 'The definition embeds one immutable normalized intent whose selected click is directly observed and exactly sealed.',
    },
    runnerCompatibility,
    confidenceLimitations: [...normalized.value.evidenceAssessment.limitations],
    materialUnknowns: ['Credential availability and runtime authentication outcome remain execution-time truths.'],
    unobservedScope: ['Excluded source-flow steps and behavior outside the selected transition remain unobserved M1 scope.'],
    preventedStrongerDefinition: 'M1 supports one observed data-test click between two governed subjects; additional actions and oracles are refused.',
  }
  return materializeCanonicalTestSet({
    schemaVersion: 3,
    testSetId: stableId('test-set-v3', input.projectId),
    revision,
    projectId: input.projectId,
    generationId,
    generatedAt: input.generatedAt,
    generationMethod: 'deterministic',
    outcome: 'completed',
    canonicalSupport: {
      modelRowId: authority.modelRowId,
      modelVersion: authority.modelVersion,
      observationRunId: authority.observationRunId,
      supportSealHash: authority.supportSealHash,
      characterizationPolicy: { ...authority.characterizationPolicy },
      supportingObservationIds: [...authority.supportingObservationIds],
      supportingGapIds: [...authority.supportingGapIds],
    },
    definitions: [definition],
    limitations: [
      'Generation was deterministic, used no AI enrichment, and did not execute the definition.',
      ...normalized.value.evidenceAssessment.limitations,
    ],
    materialUnknowns: ['Credential availability and authentication execution outcome remain outside Test Definition authority.'],
    unobservedScope: ['Coverage outside the exact selected observed transition is unknown.'],
    preventedStrongerSet: 'The frozen M1 contract permits one observed data-test click only.',
    coverage: 'unknown',
    freshness: 'not_evaluated',
  })
}

/** Materializes the one bounded M1 discovered observed-flow definition. */
export function generateCanonicalFlowTestSetV3(
  input: CanonicalV3FlowGenerationInput,
  generationId: string,
  revision: number,
): MaterializedTestSet<CanonicalTestSetV3> {
  return generateCanonicalFlowTestSetV3ForSource(input, generationId, revision, 'discovered')
}

/** Materializes the one bounded M3 manual-source definition without changing v3. */
export function generateCanonicalManualFlowTestSetV3(
  input: CanonicalV3FlowGenerationInput,
  generationId: string,
  revision: number,
): MaterializedTestSet<CanonicalTestSetV3> {
  return generateCanonicalFlowTestSetV3ForSource(input, generationId, revision, 'manual')
}
