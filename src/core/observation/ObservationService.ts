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
import * as path from 'path'
import { randomUUID } from 'crypto'
import { getDatabaseProvenance } from '../storage/db'
import { DatabaseAuthorityMode } from '../storage/DatabaseAuthority'
import { ObservationRepository } from '../storage/repositories/ObservationRepository'
import { ObservationArtifactStore, type ObservationArtifactWriter, type PersistArtifactInput } from './ObservationArtifactStore'
import { ObservationAuthorityError, ObservationContractError } from './ObservationErrors'
import { canonicalObservationIntegrityHash } from './ObservationIntegrity'
import {
  CRAWL_OBSERVATION_METHOD_VERSIONS,
  type ArtifactReferenceRecord,
  type CrawlAcquisitionKind,
  type CrawlObservationMethod,
  type NewObservationGapInput,
  type NewObservationInput,
  type ObservationBoundary,
  type ObservationCompleteness,
  type ObservationGapRecord,
  type ObservationOutcome,
  type ObservationRecord,
  type ObservationRunRecord,
  type ObservationRunSnapshot,
  type PersistedValue,
} from './ObservationTypes'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const MAX_SAFE_JSON_BYTES = 16 * 1024
const MAX_BOUNDARY_JSON_BYTES = 8 * 1024
const PROHIBITED_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i
const QUERY_OR_FRAGMENT_URL = /https?:\/\/[^\s"'<>]*[?#][^\s"'<>]*/i
const SECRET_TEXT = /(?:\bauthorization\s*:|\bproxy-authorization\s*:|\bset-cookie\s*:|\bcookie\s*:|\bbearer\s+[A-Za-z0-9._~+\/-]+|\b(?:password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)\b\s*[=:]\s*\S+|<input[^>]+type\s*=\s*["']?password[^>]+value\s*=)/i

function exactIso(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]))
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function hashSemantic(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function assertSafeId(value: string, field: string): void {
  if (!SAFE_ID.test(value)) {
    throw new ObservationContractError('OBSERVATION_ID_INVALID', `${field} is not a safe canonical identifier.`)
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_V4.test(value)) {
    throw new ObservationContractError('OBSERVATION_ID_INVALID', `${field} is not a lowercase UUID v4.`)
  }
}

function unsafeValue(value: unknown, key?: string): boolean {
  if (key && PROHIBITED_KEY.test(key)) return true
  if (typeof value === 'string') return QUERY_OR_FRAGMENT_URL.test(value)
    || /\bbearer\s+[A-Za-z0-9._~+\/-]+/i.test(value)
  if (Array.isArray(value)) return value.some(item => unsafeValue(item))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([childKey, child]) => unsafeValue(child, childKey))
  }
  return false
}

function assertSafeStructuredValue(value: unknown, field: string, maxBytes: number): string {
  if (unsafeValue(value)) {
    throw new ObservationContractError(
      'OBSERVATION_REDACTION_REQUIRED',
      `${field} contains prohibited sensitive material or an unstripped URL query/fragment.`,
    )
  }
  const encoded = canonicalJson(value)
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new ObservationContractError('OBSERVATION_VALUE_TOO_LARGE', `${field} exceeds its governed inline size limit.`)
  }
  return encoded
}

function assertSafeMessage(value: string | null | undefined, field: string): string | null {
  if (value == null) return null
  if (value.length === 0 || value.length > 500 || /[\r\n\u0000-\u001f]/.test(value)
    || /(?:^|\s)(?:Error:|at [A-Za-z0-9_.<>]+ \(|[A-Za-z]:\\|\{.*\}|\[.*\])/.test(value)
    || SECRET_TEXT.test(value) || QUERY_OR_FRAGMENT_URL.test(value)) {
    throw new ObservationContractError('OBSERVATION_MESSAGE_INVALID', `${field} is not governed redacted operator text.`)
  }
  return value
}

function assertNoUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new ObservationContractError('OBSERVATION_CONTRACT_INVALID', `${field} contains unknown fields.`)
  }
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const keys = Object.keys(value).sort()
  const expected = [...allowed].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', `${field} contains unknown or missing fields.`)
  }
}

function methodFor(value: string, version: string): CrawlObservationMethod {
  if (!(value in CRAWL_OBSERVATION_METHOD_VERSIONS)) {
    throw new ObservationContractError('OBSERVATION_METHOD_UNSUPPORTED', `Unknown crawl Observation method '${value}'.`)
  }
  const method = value as CrawlObservationMethod
  if (CRAWL_OBSERVATION_METHOD_VERSIONS[method] !== version) {
    throw new ObservationContractError('OBSERVATION_METHOD_UNSUPPORTED', `Unknown version '${version}' for method '${method}'.`)
  }
  return method
}

function outcomeFor(value: string): ObservationOutcome {
  if (value !== 'present' && value !== 'absent' && value !== 'indeterminate') {
    throw new ObservationContractError('OBSERVATION_OUTCOME_INVALID', 'Observation outcome must be present, absent, or indeterminate.')
  }
  return value
}

function assertBoundary(method: CrawlObservationMethod | null, boundary: ObservationBoundary): string {
  exactKeys(boundary as unknown as Record<string, unknown>, [
    'schemaVersion', 'kind', 'scope', 'startedAt', 'endedAt', 'completion', 'policyId', 'policyVersion',
  ], 'Observation boundary')
  if (boundary.schemaVersion !== 'forge-observation-boundary/v1'
    || !exactIso(boundary.startedAt) || !exactIso(boundary.endedAt)
    || boundary.endedAt < boundary.startedAt
    || !['complete', 'partial'].includes(boundary.completion)) {
    throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'Observation boundary identity, time, or completeness is invalid.')
  }
  assertSafeId(boundary.policyId, 'boundary.policyId')
  if (!boundary.policyVersion) throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'Boundary policy version is required.')
  const expected = method === 'browser_dom_inspection'
    ? 'document'
    : method === 'browser_navigation_attempt'
      ? 'navigation_attempt'
      : method === 'http_response_inspection'
        ? 'http_exchange'
        : null
  if (method && boundary.kind !== expected) {
    throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', `Method '${method}' cannot use boundary '${boundary.kind}'.`)
  }
  return assertSafeStructuredValue(boundary, 'Observation boundary', MAX_BOUNDARY_JSON_BYTES)
}

function assertMethodContract(method: CrawlObservationMethod, predicate: string, outcome: ObservationOutcome, boundary: ObservationBoundary, observedValue: unknown): void {
  const scope = boundary.scope
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'Observation boundary scope must be a governed object.')
  }
  if (method === 'browser_dom_inspection') {
    if (predicate === 'page.discovered') {
      if (outcome !== 'present') throw new ObservationContractError('OBSERVATION_OUTCOME_INVALID', 'page.discovered supports only present.')
      exactKeys(scope, Object.hasOwn(scope, 'roleId') ? ['acquisitionKind', 'roleId'] : ['acquisitionKind'], 'page.discovered scope')
      if (scope.acquisitionKind !== 'web_crawl' || (scope.roleId !== undefined && typeof scope.roleId !== 'string')) {
        throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'page.discovered scope is invalid.')
      }
      if (!observedValue || typeof observedValue !== 'object' || Array.isArray(observedValue)) {
        throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'page.discovered requires a bounded structured value.')
      }
      const pageValue = observedValue as Record<string, unknown>
      exactKeys(pageValue, Object.hasOwn(pageValue, 'roleId')
        ? ['urlPattern', 'elementCount', 'fingerprint', 'roleId']
        : ['urlPattern', 'elementCount', 'fingerprint'], 'page.discovered observedValue')
      if (typeof pageValue.urlPattern !== 'string' || /[?#]/.test(pageValue.urlPattern)
        || !Number.isInteger(pageValue.elementCount) || Number(pageValue.elementCount) < 0
        || typeof pageValue.fingerprint !== 'string' || pageValue.fingerprint.length === 0
        || (pageValue.roleId !== undefined && typeof pageValue.roleId !== 'string')) {
        throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'page.discovered observedValue is invalid or unredacted.')
      }
      return
    }
    if (predicate === 'control.present') {
      exactKeys(scope, outcome === 'absent' ? ['route', 'queryDigest'] : ['route'], 'control.present scope')
      if (typeof scope.route !== 'string' || !scope.route.startsWith('/')) {
        throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'control.present requires one safe route scope.')
      }
      if (outcome === 'absent' && (typeof scope.queryDigest !== 'string' || !/^[a-f0-9]{64}$/.test(scope.queryDigest))) {
        throw new ObservationContractError('OBSERVATION_NEGATIVE_INVALID', 'DOM absence requires an exact exhaustive-query digest.')
      }
      if (observedValue !== null) throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'control.present does not admit an inline observed value.')
      return
    }
    throw new ObservationContractError('OBSERVATION_PREDICATE_UNSUPPORTED', `Unsupported DOM predicate '${predicate}'.`)
  }
  if (method === 'http_response_inspection') {
    if (!['endpoint.response.status', 'endpoint.response.header', 'endpoint.response.body'].includes(predicate)) {
      throw new ObservationContractError('OBSERVATION_PREDICATE_UNSUPPORTED', `Unsupported HTTP predicate '${predicate}'.`)
    }
    exactKeys(scope, ['requestMethod', 'requestUrl', 'responseStatus'], 'HTTP exchange scope')
    if (typeof scope.requestMethod !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(scope.requestMethod)
      || typeof scope.requestUrl !== 'string' || !/^https?:\/\/[^?#]+$/.test(scope.requestUrl)
      || !Number.isInteger(scope.responseStatus) || Number(scope.responseStatus) < 100 || Number(scope.responseStatus) > 599) {
      throw new ObservationContractError('OBSERVATION_BOUNDARY_INVALID', 'HTTP exchange scope is invalid or unredacted.')
    }
    if (predicate === 'endpoint.response.status') {
      if (outcome !== 'present' || observedValue !== scope.responseStatus) {
        throw new ObservationContractError('OBSERVATION_OUTCOME_INVALID', 'HTTP response status requires a matching present integer value.')
      }
    } else if (outcome === 'present') {
      if (!observedValue || typeof observedValue !== 'object' || Array.isArray(observedValue)) {
        throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'HTTP header/body facts require a governed digest value.')
      }
      exactKeys(observedValue as Record<string, unknown>, ['valueDigest'], 'HTTP observedValue')
      if (!/^[a-f0-9]{64}$/.test(String((observedValue as Record<string, unknown>).valueDigest))) {
        throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'HTTP observedValue requires a SHA-256 value digest.')
      }
    } else if (observedValue !== null) {
      throw new ObservationContractError('OBSERVATION_VALUE_INVALID', 'Non-present HTTP facts cannot carry inline values.')
    }
    return
  }
  throw new ObservationContractError('OBSERVATION_METHOD_UNSUPPORTED', `Method '${method}' is not adopted by B1.`)
}

export interface StartCrawlObservationRunInput {
  operationId: string
  producer: string
  producerVersion: string
  acquisitionKind: CrawlAcquisitionKind
  startedAt?: string
  policyId: string
  policyVersion: string
  acquisitionPlan: Record<string, unknown>
}

export class ObservationService {
  readonly producerInstanceId: string
  readonly producerProcessId: number
  readonly repository: ObservationRepository
  readonly artifacts: ObservationArtifactWriter

  constructor(
    readonly projectId: string,
    readonly workspaceRoot: string,
    dependencies: {
      repository?: ObservationRepository
      artifacts?: ObservationArtifactWriter
      producerInstanceId?: string
      producerProcessId?: number
    } = {},
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot)
    this.producerInstanceId = dependencies.producerInstanceId ?? randomUUID()
    this.producerProcessId = dependencies.producerProcessId ?? process.pid
    this.repository = dependencies.repository ?? new ObservationRepository(projectId)
    this.artifacts = dependencies.artifacts
      ?? new ObservationArtifactStore(projectId, this.workspaceRoot, this.repository)
  }

  private assertAuthority(projectId: string): void {
    if (projectId !== this.projectId) throw new ObservationAuthorityError('ObservationService refused cross-project authority.')
    const provenance = getDatabaseProvenance()
    if (provenance.authorityMode !== DatabaseAuthorityMode.PRODUCT_WORKSPACE
      || !provenance.productSchemaEligible
      || !provenance.workspaceRoot
      || path.resolve(provenance.workspaceRoot) !== this.workspaceRoot) {
      throw new ObservationAuthorityError('ObservationService requires the exact selected PRODUCT_WORKSPACE authority.')
    }
  }

  async startRun(input: StartCrawlObservationRunInput): Promise<PersistedValue<ObservationRunRecord>> {
    this.assertAuthority(this.projectId)
    assertSafeId(this.projectId, 'projectId')
    assertSafeId(input.operationId, 'operationId')
    assertSafeId(input.producer, 'producer')
    assertSafeId(input.policyId, 'policyId')
    if (!input.producerVersion || !input.policyVersion) {
      throw new ObservationContractError('OBSERVATION_VERSION_REQUIRED', 'Producer and acquisition policy versions are required.')
    }
    if (input.acquisitionKind !== 'web_crawl' && input.acquisitionKind !== 'api_crawl') {
      throw new ObservationContractError('OBSERVATION_ACQUISITION_UNSUPPORTED', 'B1 supports only web_crawl and api_crawl acquisition.')
    }
    assertSafeStructuredValue(input.acquisitionPlan, 'acquisition plan', MAX_SAFE_JSON_BYTES)
    const startedAt = input.startedAt ?? new Date().toISOString()
    if (!exactIso(startedAt)) throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'ObservationRun startedAt must be exact UTC ISO-8601.')
    await this.repository.recoverInterruptedRuns(this.projectId, this.producerInstanceId, this.producerProcessId, startedAt)
    return this.repository.startRun({
      observation_run_id: randomUUID(),
      project_id: this.projectId,
      workspace_authority: 'PRODUCT_WORKSPACE',
      operation_id: input.operationId,
      producer: input.producer,
      producer_version: input.producerVersion,
      producer_instance_id: this.producerInstanceId,
      producer_process_id: this.producerProcessId,
      acquisition_kind: input.acquisitionKind,
      started_at: startedAt,
      terminal_at: null,
      lifecycle: 'running',
      completeness: null,
      safe_reason_code: null,
      safe_message: null,
      policy_id: input.policyId,
      policy_version: input.policyVersion,
      acquisition_plan_hash: hashSemantic(input.acquisitionPlan),
    })
  }

  async terminalizeRun(input: {
    observationRunId: string
    lifecycle: 'completed' | 'blocked' | 'failed' | 'interrupted'
    completeness: ObservationCompleteness
    terminalAt?: string
    safeReasonCode?: string | null
    safeMessage?: string | null
  }): Promise<ObservationRunRecord> {
    this.assertAuthority(this.projectId)
    assertUuid(input.observationRunId, 'observationRunId')
    const terminalAt = input.terminalAt ?? new Date().toISOString()
    if (!exactIso(terminalAt)) throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'ObservationRun terminalAt must be exact UTC ISO-8601.')
    const reason = input.safeReasonCode ?? null
    if (!(input.lifecycle === 'completed' && input.completeness === 'complete') && !reason) {
      throw new ObservationContractError('OBSERVATION_REASON_REQUIRED', 'Non-complete ObservationRun terminal states require a safe reason code.')
    }
    if (reason) assertSafeId(reason, 'safeReasonCode')
    const safeMessage = assertSafeMessage(input.safeMessage, 'ObservationRun safeMessage')
    return this.repository.terminalizeRun({
      projectId: this.projectId,
      observationRunId: input.observationRunId,
      terminalAt,
      lifecycle: input.lifecycle,
      completeness: input.completeness,
      safeReasonCode: reason,
      safeMessage,
    })
  }

  async recordObservation(input: NewObservationInput): Promise<PersistedValue<ObservationRecord>> {
    this.assertAuthority(input.projectId)
    assertNoUnknownKeys(input as unknown as Record<string, unknown>, [
      'observationRunId', 'projectId', 'producer', 'producerVersion', 'method', 'methodVersion',
      'subjectId', 'predicate', 'outcome', 'observedValue', 'boundary', 'capturedAt',
      'idempotencyKey', 'artifactIds', 'safeReasonCode', 'safeMessage',
    ], 'Observation input')
    const run = await this.repository.findRun(input.projectId, input.observationRunId)
    if (!run || run.lifecycle !== 'running') {
      throw new ObservationContractError('OBSERVATION_RUN_NOT_RUNNING', 'Observation requires its exact running ObservationRun.')
    }
    if (run.producer !== input.producer || run.producerVersion !== input.producerVersion) {
      throw new ObservationContractError('OBSERVATION_PRODUCER_MISMATCH', 'Observation producer does not match its owning run.')
    }
    const method = methodFor(input.method, input.methodVersion)
    const outcome = outcomeFor(input.outcome)
    assertSafeId(input.subjectId, 'subjectId')
    assertSafeId(input.predicate, 'predicate')
    assertSafeId(input.idempotencyKey, 'idempotencyKey')
    if (!exactIso(input.capturedAt)) throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'Observation capturedAt must be exact UTC ISO-8601.')
    const boundaryJson = assertBoundary(method, input.boundary)
    if (input.capturedAt < input.boundary.startedAt || input.capturedAt > input.boundary.endedAt) {
      throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'Observation capturedAt must fall inside its boundary.')
    }
    const observedValue = input.observedValue === undefined ? null : input.observedValue
    assertMethodContract(method, input.predicate, outcome, input.boundary, observedValue)
    const observedValueJson = observedValue === null
      ? null
      : assertSafeStructuredValue(observedValue, 'observedValue', MAX_SAFE_JSON_BYTES)
    if (outcome === 'absent' && observedValue !== null) {
      throw new ObservationContractError('OBSERVATION_NEGATIVE_INVALID', 'An absent Observation cannot carry an observed value.')
    }
    if (outcome === 'indeterminate' && !input.safeReasonCode) {
      throw new ObservationContractError('OBSERVATION_REASON_REQUIRED', 'An indeterminate Observation requires a safe reason code.')
    }
    const artifactIds = [...(input.artifactIds ?? [])]
    for (const artifactId of artifactIds) assertUuid(artifactId, 'artifactId')
    if (new Set(artifactIds).size !== artifactIds.length) {
      throw new ObservationContractError('OBSERVATION_ARTIFACT_DUPLICATE', 'Observation artifact references must be unique and ordered.')
    }
    const artifacts = await this.repository.getArtifacts(input.projectId, artifactIds)
    if (artifacts.length !== artifactIds.length
      || artifacts.some(artifact => artifact.observationRunId !== input.observationRunId)) {
      throw new ObservationContractError('OBSERVATION_ARTIFACT_NOT_FOUND', 'Observation artifact is missing or belongs to another run.')
    }
    if (outcome === 'absent') {
      if (input.boundary.completion !== 'complete'
        || method === 'browser_navigation_attempt'
        || artifactIds.length === 0) {
        throw new ObservationContractError(
          'OBSERVATION_NEGATIVE_INVALID',
          'Absent requires a complete boundary, an absence-competent method, and durable method artifacts.',
        )
      }
      if (method === 'browser_dom_inspection' && !artifacts.some(artifact => artifact.mediaType === 'text/html')) {
        throw new ObservationContractError('OBSERVATION_NEGATIVE_INVALID', 'DOM absence requires a durable redacted HTML artifact.')
      }
      if (method === 'http_response_inspection' && !artifacts.some(artifact => artifact.mediaType === 'application/json' || artifact.mediaType === 'text/plain')) {
        throw new ObservationContractError('OBSERVATION_NEGATIVE_INVALID', 'HTTP absence requires a durable redacted response artifact.')
      }
      const applicable = await this.repository.findSubjectPredicate(
        input.projectId,
        input.subjectId,
        input.predicate,
      )
      if (applicable.some(observation => observation.outcome === 'present')) {
        throw new ObservationContractError(
          'OBSERVATION_CONFLICT_UNRESOLVED',
          'Absent was refused because an unreconciled present Observation exists for the same subject and predicate.',
        )
      }
    }
    const semantic = {
      schemaVersion: 'forge-observation/v1' as const,
      observationRunId: input.observationRunId,
      projectId: input.projectId,
      producer: input.producer,
      producerVersion: input.producerVersion,
      method,
      methodVersion: input.methodVersion,
      subjectId: input.subjectId,
      predicate: input.predicate,
      outcome,
      observedValue,
      boundary: input.boundary,
      capturedAt: input.capturedAt,
      provenanceClass: 'native' as const,
      safeReasonCode: input.safeReasonCode ?? null,
    }
    const row = {
      observation_id: randomUUID(),
      observation_run_id: input.observationRunId,
      project_id: input.projectId,
      producer: input.producer,
      producer_version: input.producerVersion,
      method,
      method_version: input.methodVersion,
      subject_id: input.subjectId,
      predicate: input.predicate,
      outcome,
      observed_value_json: observedValueJson,
      boundary_json: boundaryJson,
      captured_at: input.capturedAt,
      idempotency_key: input.idempotencyKey,
      integrity_hash: canonicalObservationIntegrityHash(
        semantic,
        artifacts.map(artifact => ({ artifactId: artifact.artifactId, sha256: artifact.sha256 })),
      ),
      provenance_class: 'native',
      safe_reason_code: input.safeReasonCode ?? null,
      safe_message: assertSafeMessage(input.safeMessage, 'Observation safeMessage'),
      artifact_links_sealed: 0,
    }
    return this.repository.insertObservation(row, artifactIds)
  }

  async recordGap(input: NewObservationGapInput): Promise<PersistedValue<ObservationGapRecord>> {
    this.assertAuthority(input.projectId)
    assertNoUnknownKeys(input as unknown as Record<string, unknown>, [
      'observationRunId', 'projectId', 'producer', 'producerVersion', 'intendedMethod',
      'intendedMethodVersion', 'intendedSubjectId', 'intendedPredicate', 'boundary', 'reason',
      'occurredAt', 'idempotencyKey', 'artifactIds', 'safeMessage',
    ], 'ObservationGap input')
    const run = await this.repository.findRun(input.projectId, input.observationRunId)
    if (!run || run.lifecycle !== 'running') {
      throw new ObservationContractError('OBSERVATION_RUN_NOT_RUNNING', 'ObservationGap requires its exact running ObservationRun.')
    }
    if (run.producer !== input.producer || run.producerVersion !== input.producerVersion) {
      throw new ObservationContractError('OBSERVATION_PRODUCER_MISMATCH', 'ObservationGap producer does not match its owning run.')
    }
    const knownMethod = input.intendedMethod in CRAWL_OBSERVATION_METHOD_VERSIONS
      ? methodFor(input.intendedMethod, input.intendedMethodVersion)
      : null
    if (!knownMethod && input.reason !== 'unsupported_method') {
      throw new ObservationContractError('OBSERVATION_METHOD_UNSUPPORTED', 'Unknown intended methods require an unsupported_method gap.')
    }
    assertSafeId(input.intendedSubjectId, 'intendedSubjectId')
    assertSafeId(input.intendedPredicate, 'intendedPredicate')
    assertSafeId(input.idempotencyKey, 'idempotencyKey')
    if (!exactIso(input.occurredAt)) throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'ObservationGap occurredAt must be exact UTC ISO-8601.')
    const boundaryJson = assertBoundary(knownMethod, input.boundary)
    const artifactIds = [...(input.artifactIds ?? [])]
    const artifacts = await this.repository.getArtifacts(input.projectId, artifactIds)
    if (artifacts.length !== artifactIds.length
      || artifacts.some(artifact => artifact.observationRunId !== input.observationRunId)) {
      throw new ObservationContractError('OBSERVATION_ARTIFACT_NOT_FOUND', 'ObservationGap artifact is missing or belongs to another run.')
    }
    const semantic = {
      schemaVersion: 'forge-observation-gap/v1',
      observationRunId: input.observationRunId,
      projectId: input.projectId,
      producer: input.producer,
      producerVersion: input.producerVersion,
      intendedMethod: input.intendedMethod,
      intendedMethodVersion: input.intendedMethodVersion,
      intendedSubjectId: input.intendedSubjectId,
      intendedPredicate: input.intendedPredicate,
      boundary: input.boundary,
      reason: input.reason,
      occurredAt: input.occurredAt,
      artifactHashes: artifacts.map(artifact => ({ artifactId: artifact.artifactId, sha256: artifact.sha256 })),
    }
    return this.repository.insertGap({
      gap_id: randomUUID(),
      observation_run_id: input.observationRunId,
      project_id: input.projectId,
      producer: input.producer,
      producer_version: input.producerVersion,
      intended_method: input.intendedMethod,
      intended_method_version: input.intendedMethodVersion,
      intended_subject_id: input.intendedSubjectId,
      intended_predicate: input.intendedPredicate,
      boundary_json: boundaryJson,
      reason: input.reason,
      occurred_at: input.occurredAt,
      idempotency_key: input.idempotencyKey,
      integrity_hash: hashSemantic(semantic),
      safe_message: assertSafeMessage(input.safeMessage, 'ObservationGap safeMessage'),
    }, artifactIds)
  }

  persistArtifact(input: PersistArtifactInput): Promise<PersistedValue<ArtifactReferenceRecord>> {
    this.assertAuthority(input.projectId)
    return this.artifacts.persist(input)
  }

  readRun(observationRunId: string): Promise<ObservationRunSnapshot | null> {
    this.assertAuthority(this.projectId)
    return this.repository.readRun(this.projectId, observationRunId)
  }

  findRunByOperation(producer: string, operationId: string): Promise<ObservationRunRecord | null> {
    this.assertAuthority(this.projectId)
    return this.repository.findRunByOperation(this.projectId, producer, operationId)
  }

  async recoverInterruptedRuns(terminalAt = new Date().toISOString()): Promise<string[]> {
    this.assertAuthority(this.projectId)
    if (!exactIso(terminalAt)) throw new ObservationContractError('OBSERVATION_TIME_INVALID', 'Recovery time must be exact UTC ISO-8601.')
    return this.repository.recoverInterruptedRuns(this.projectId, this.producerInstanceId, this.producerProcessId, terminalAt)
  }
}
