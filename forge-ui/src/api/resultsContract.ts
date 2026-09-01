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

import { decodeCanonicalSuiteSelectionAuthority, type CanonicalSuiteSelectionAuthority } from './suiteContract'

export type CanonicalResultOutcome = 'passed' | 'failed' | 'could_not_verify'
export type CanonicalExecutionLifecycle =
  | 'accepted'
  | 'running'
  | 'cancellation_requested'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'
export type CanonicalRunLifecycle = 'running' | 'completed' | 'cancelled' | 'interrupted'
export type CanonicalResultsIntegrityState = 'valid' | 'warning' | 'invalid'
export type CanonicalResultsIntegritySeverity = 'warning' | 'error'

export type CanonicalResultsIntegrityCode =
  | 'missing_expected_result'
  | 'duplicate_or_conflicting_result'
  | 'manifest_mismatch'
  | 'run_aggregate_mismatch'
  | 'execution_aggregate_mismatch'
  | 'missing_linked_run'
  | 'impossible_lifecycle_outcome'
  | 'unsupported_legacy_evidence'
  | 'conflicting_provenance'

export interface CanonicalResultsIntegrityWarning {
  code: CanonicalResultsIntegrityCode
  severity: CanonicalResultsIntegritySeverity
  safeMessage: string
}

export interface CanonicalExecutionResultsListItem {
  executionId: string
  lifecycle: CanonicalExecutionLifecycle
  /** Current evidence truth; null only when projection integrity is invalid. */
  evidenceHeadlineOutcome: CanonicalResultOutcome | null
  /** Null means no persisted terminal Execution outcome exists. */
  terminalOutcome: CanonicalResultOutcome | null
  authorityReasonCode: string | null
  acceptedAt: string
  terminalAt: string | null
  expectedResultCount: number
  runCount: number
  observedResultCount: number
  /** Canonical observed-Result totals; unavailable when integrityState is invalid. */
  passedResultCount: number | null
  failedResultCount: number | null
  couldNotVerifyResultCount: number | null
  integrityState: CanonicalResultsIntegrityState
  selectionAuthority?: CanonicalSuiteSelectionAuthority
}

export interface CanonicalExecutionResultsListResponse {
  executions: CanonicalExecutionResultsListItem[]
  page: { limit: number }
}

export interface CanonicalObservedResult {
  kind: 'observed_result'
  resultId: string
  outcome: CanonicalResultOutcome
  reasonCode: string
  safeMessage: null
  durationMs: number
  oracleKind: 'subject_observable' | null
  observedSubjectId: string | null
}

export interface CanonicalMissingResult {
  kind: 'missing_result'
  reasonCode: 'expected_result_missing'
}

export interface CanonicalDiagnosticIdentity {
  projectId: string
  executionId: string
  runId: string
  itemOrdinal: number
  evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1'
}

interface CanonicalDiagnosticOutcomeCommon {
  schemaVersion: 'forge.m4.diagnostic-outcome/v1'
  evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1'
  classifierVersion: 'forge.m4.diagnostic-classifier/v1'
  evidenceHash: string
}

export type CanonicalDiagnosticOutcome = CanonicalDiagnosticOutcomeCommon & (
  | { kind: 'classified_failure'; failureMode: 'executor_failure'; explanationCode: 'executor_failed_before_completion'; explanationParameters: { failureClass: 'browser_session_unavailable' | 'executor_internal_failure' | 'process_failure' | 'timeout' } }
  | { kind: 'classified_failure'; failureMode: 'authentication_not_established'; explanationCode: 'authentication_attempt_not_established'; explanationParameters: Record<string, never> }
  | { kind: 'classified_failure'; failureMode: 'navigation_not_completed'; explanationCode: 'governed_navigation_not_completed'; explanationParameters: { failureClass: 'destination_unavailable' | 'browser_navigation_error' | 'timeout'; expectedRoute: string; actualRoute: string | null } }
  | { kind: 'classified_failure'; failureMode: 'target_not_observed'; explanationCode: 'governed_target_not_observed'; explanationParameters: { subjectId: string; elementId: string; observedCardinality: 'zero' } }
  | { kind: 'classified_failure'; failureMode: 'action_not_completed'; explanationCode: 'governed_action_not_completed'; explanationParameters: { subjectId: string; elementId: string; failureClass: 'target_not_actionable' | 'interaction_failed' | 'timeout' } }
  | { kind: 'classified_failure'; failureMode: 'oracle_mismatch'; explanationCode: 'governed_oracle_mismatch'; explanationParameters: { subjectId: string; expectedRoute: string; actualRoute: string } }
  | { kind: 'refusal'; refusalCode: 'insufficient_evidence'; explanationCode: 'diagnostic_predicates_not_satisfied'; explanationParameters: Record<string, never> }
  | { kind: 'refusal'; refusalCode: 'integrity_invalid'; integrityFindings: Array<'diagnostic_evidence_contradiction' | 'diagnostic_authority_binding_invalid' | 'diagnostic_historical_authority_substitution'>; explanationCode: 'diagnostic_integrity_validation_failed'; explanationParameters: Record<string, never> }
)

export type CanonicalResultDiagnostic =
  | {
      state: 'available'
      identity: CanonicalDiagnosticIdentity
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1'
      evidenceHash: string
      classifierVersion: 'forge.m4.diagnostic-classifier/v1'
      outcome: CanonicalDiagnosticOutcome
      /** Derived presentation only; never diagnostic authority. */
      displayString: string
    }
  | {
      state: 'unavailable'
      reason: 'not_found' | 'unreadable' | 'unsupported_classifier_version'
      identity: CanonicalDiagnosticIdentity
    }

export interface CanonicalExecutionResultItem {
  manifestOrdinal: number
  definitionId: string
  executablePlanHash: string
  evidence: CanonicalObservedResult | CanonicalMissingResult
  diagnostic?: CanonicalResultDiagnostic
}

interface CanonicalDefinitionAuthoritySummaryBase {
  testSetId: string
  revision: number
  modelRowId: number
  modelVersion: string
}

export interface CanonicalDefinitionAuthorityV1Summary extends CanonicalDefinitionAuthoritySummaryBase {
  schemaVersion: 1
  supportSealHash: null
  routeEvidenceIdentityHash: null
  authenticationExpectationIdentityHash: null
}

export interface CanonicalDefinitionAuthorityV2Summary extends CanonicalDefinitionAuthoritySummaryBase {
  schemaVersion: 2
  supportSealHash: string
  routeEvidenceIdentityHash: string
  authenticationExpectationIdentityHash: string
}

export interface CanonicalDefinitionAuthorityV3Summary extends CanonicalDefinitionAuthoritySummaryBase {
  schemaVersion: 3
  supportSealHash: string
  routeEvidenceIdentityHash: string
  authenticationExpectationIdentityHash: string
}

export type CanonicalDefinitionAuthoritySummary =
  | CanonicalDefinitionAuthorityV1Summary
  | CanonicalDefinitionAuthorityV2Summary
  | CanonicalDefinitionAuthorityV3Summary
  | { scope: 'per_item' }

interface DecodedDefinitionAuthorityBase extends CanonicalDefinitionAuthoritySummaryBase {
  supportSealHash: string | null
  routeEvidenceIdentityHash: string | null
  authenticationExpectationIdentityHash: string | null
}

export interface CanonicalExecutionResultsDetail {
  kind: 'canonical_execution_results'
  /** Current manifest-aware evidence truth; not a persisted terminal verdict. */
  evidenceHeadlineOutcome: CanonicalResultOutcome
  execution: {
    executionId: string
    lifecycle: CanonicalExecutionLifecycle
    /** Null while the Execution has no persisted terminal outcome. */
    terminalOutcome: CanonicalResultOutcome | null
    authorityReasonCode: string | null
    acceptedAt: string
    terminalAt: string | null
    expectedResultCount: number
    definitionAuthority: CanonicalDefinitionAuthoritySummary
    selectionAuthority?: CanonicalSuiteSelectionAuthority
  }
  run: null | {
    runId: string
    lifecycle: CanonicalRunLifecycle
    /** Result-derived Run evidence; lifecycle independently establishes terminality. */
    evidenceOutcome: CanonicalResultOutcome | null
    evidenceReasonCode: string | null
    startedAt: string
    terminalAt: string | null
    expectedResultCount: number
    observedResultCount: number
    evidenceCounts: {
      passed: number
      failed: number
      couldNotVerify: number
      missing: number
    }
  }
  items: CanonicalExecutionResultItem[]
  integrityWarnings: CanonicalResultsIntegrityWarning[]
}

export type CanonicalExecutionResultsRead =
  | { kind: 'ok'; projection: CanonicalExecutionResultsDetail }
  | { kind: 'not_found' }
  | { kind: 'integrity_invalid'; integrityWarnings: CanonicalResultsIntegrityWarning[] }

export class CanonicalResultsContractError extends Error {
  constructor(message = 'Canonical Results payload is malformed.') {
    super(message)
    this.name = 'CanonicalResultsContractError'
  }
}

type RecordValue = Record<string, unknown>
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/
const REASON = /^[a-z][a-z0-9_]{0,99}$/
const OUTCOMES = ['passed', 'failed', 'could_not_verify'] as const
const ORACLE_KINDS = ['subject_observable'] as const
const EXECUTION_LIFECYCLES = ['accepted', 'running', 'cancellation_requested', 'completed', 'cancelled', 'interrupted', 'unknown'] as const
const RUN_LIFECYCLES = ['running', 'completed', 'cancelled', 'interrupted'] as const
const INTEGRITY_STATES = ['valid', 'warning', 'invalid'] as const
const INTEGRITY_SEVERITIES = ['warning', 'error'] as const
const INTEGRITY_CODES = [
  'missing_expected_result', 'duplicate_or_conflicting_result', 'manifest_mismatch',
  'run_aggregate_mismatch', 'execution_aggregate_mismatch', 'missing_linked_run',
  'impossible_lifecycle_outcome', 'unsupported_legacy_evidence', 'conflicting_provenance',
] as const
const DIAGNOSTIC_UNAVAILABLE_REASONS = ['not_found', 'unreadable', 'unsupported_classifier_version'] as const
const DIAGNOSTIC_INTEGRITY_FINDINGS = [
  'diagnostic_evidence_contradiction', 'diagnostic_authority_binding_invalid',
  'diagnostic_historical_authority_substitution',
] as const
const ROUTE = /^\/(?!\/)(?:[^?#\s]*)$/

function object(value: unknown, allowed: readonly string[], label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CanonicalResultsContractError(`${label} must be an object.`)
  const result = value as RecordValue
  const unexpected = Object.keys(result).find(key => !allowed.includes(key))
  if (unexpected) throw new CanonicalResultsContractError(`${label} contains unknown field ${unexpected}.`)
  return result
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new CanonicalResultsContractError(`${label} must be a non-empty string.`)
  return value
}

function id(value: unknown, label: string): string {
  const result = string(value, label)
  if (!ID.test(result)) throw new CanonicalResultsContractError(`${label} is malformed.`)
  return result
}

function hash(value: unknown, label: string): string {
  const result = string(value, label)
  if (!SHA256.test(result)) throw new CanonicalResultsContractError(`${label} is malformed.`)
  return result
}

function reason(value: unknown, label: string): string {
  const result = string(value, label)
  if (!REASON.test(result)) throw new CanonicalResultsContractError(`${label} is malformed.`)
  return result
}

function nullable<T>(value: unknown, decode: (item: unknown) => T): T | null {
  return value === null ? null : decode(value)
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new CanonicalResultsContractError(`${label} must be an integer of at least ${minimum}.`)
  return Number(value)
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) throw new CanonicalResultsContractError(`${label} is unsupported.`)
  return value as T[number]
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new CanonicalResultsContractError(`${label} must be an ISO timestamp.`)
  }
  return result
}

function route(value: unknown, label: string): string {
  const result = string(value, label)
  if (result.length > 500 || !ROUTE.test(result)) throw new CanonicalResultsContractError(`${label} is malformed.`)
  return result
}

function array<T>(value: unknown, decode: (item: unknown, index: number) => T, label: string): T[] {
  if (!Array.isArray(value)) throw new CanonicalResultsContractError(`${label} must be an array.`)
  return value.map(decode)
}

function decodeWarning(value: unknown, label: string): CanonicalResultsIntegrityWarning {
  const item = object(value, ['code', 'severity', 'safeMessage'], label)
  return {
    code: enumeration(item.code, INTEGRITY_CODES, `${label}.code`),
    severity: enumeration(item.severity, INTEGRITY_SEVERITIES, `${label}.severity`),
    safeMessage: string(item.safeMessage, `${label}.safeMessage`),
  }
}

export function decodeCanonicalResultsIntegrityWarnings(value: unknown): CanonicalResultsIntegrityWarning[] {
  return array(value, (item, index) => decodeWarning(item, `integrityWarnings[${index}]`), 'integrityWarnings')
}

function decodeListItem(value: unknown, label: string): CanonicalExecutionResultsListItem {
  const item = object(value, [
    'executionId', 'lifecycle', 'evidenceHeadlineOutcome', 'terminalOutcome', 'authorityReasonCode', 'acceptedAt', 'terminalAt',
    'expectedResultCount', 'runCount', 'observedResultCount', 'passedResultCount', 'failedResultCount',
    'couldNotVerifyResultCount', 'integrityState',
    'selectionAuthority',
  ], label)
  const result: CanonicalExecutionResultsListItem = {
    executionId: id(item.executionId, `${label}.executionId`),
    lifecycle: enumeration(item.lifecycle, EXECUTION_LIFECYCLES, `${label}.lifecycle`),
    evidenceHeadlineOutcome: nullable(item.evidenceHeadlineOutcome, value => enumeration(value, OUTCOMES, `${label}.evidenceHeadlineOutcome`)),
    terminalOutcome: nullable(item.terminalOutcome, value => enumeration(value, OUTCOMES, `${label}.terminalOutcome`)),
    authorityReasonCode: nullable(item.authorityReasonCode, value => reason(value, `${label}.authorityReasonCode`)),
    acceptedAt: timestamp(item.acceptedAt, `${label}.acceptedAt`),
    terminalAt: nullable(item.terminalAt, value => timestamp(value, `${label}.terminalAt`)),
    expectedResultCount: integer(item.expectedResultCount, `${label}.expectedResultCount`, 1),
    runCount: integer(item.runCount, `${label}.runCount`),
    observedResultCount: integer(item.observedResultCount, `${label}.observedResultCount`),
    passedResultCount: nullable(item.passedResultCount, value => integer(value, `${label}.passedResultCount`)),
    failedResultCount: nullable(item.failedResultCount, value => integer(value, `${label}.failedResultCount`)),
    couldNotVerifyResultCount: nullable(item.couldNotVerifyResultCount, value => integer(value, `${label}.couldNotVerifyResultCount`)),
    integrityState: enumeration(item.integrityState, INTEGRITY_STATES, `${label}.integrityState`),
    ...(item.selectionAuthority===undefined?{}:{selectionAuthority:decodeCanonicalSuiteSelectionAuthority(item.selectionAuthority)}),
  }
  if (result.runCount > 1 || result.observedResultCount > result.expectedResultCount) {
    throw new CanonicalResultsContractError(`${label} contains impossible evidence counts.`)
  }
  if (result.observedResultCount > 0 && result.runCount === 0) {
    throw new CanonicalResultsContractError(`${label} contains Product Results without an owning Product Run.`)
  }
  const totals = [result.passedResultCount, result.failedResultCount, result.couldNotVerifyResultCount]
  if (result.integrityState === 'invalid') {
    if (totals.some(value => value !== null)) {
      throw new CanonicalResultsContractError(`${label} exposes untrusted outcome totals for integrity-invalid evidence.`)
    }
  } else {
    if (result.evidenceHeadlineOutcome === null || totals.some(value => value === null)) {
      throw new CanonicalResultsContractError(`${label} omits trusted canonical outcome totals.`)
    }
    const passed = result.passedResultCount!
    const failed = result.failedResultCount!
    const couldNotVerify = result.couldNotVerifyResultCount!
    if (passed + failed + couldNotVerify !== result.observedResultCount) {
      throw new CanonicalResultsContractError(`${label} outcome totals disagree with observed Result count.`)
    }
    const expectedHeadline: CanonicalResultOutcome = failed > 0
      ? 'failed'
      : couldNotVerify > 0 || result.observedResultCount < result.expectedResultCount
        ? 'could_not_verify'
        : 'passed'
    if (result.evidenceHeadlineOutcome !== expectedHeadline) {
      throw new CanonicalResultsContractError(`${label} evidence headline contradicts canonical outcome totals.`)
    }
  }
  const terminal = ['completed', 'cancelled', 'interrupted'].includes(result.lifecycle)
  if ((terminal && (result.terminalOutcome === null || result.terminalAt === null))
    || (!terminal && (result.terminalOutcome !== null || result.terminalAt !== null))
    || (result.integrityState === 'invalid') !== (result.evidenceHeadlineOutcome === null)) {
    throw new CanonicalResultsContractError(`${label} contains inconsistent lifecycle or integrity truth.`)
  }
  return result
}

export function decodeCanonicalExecutionResultsList(value: unknown): CanonicalExecutionResultsListResponse {
  const root = object(value, ['executions', 'page'], 'Results list')
  const page = object(root.page, ['limit'], 'Results list page')
  return {
    executions: array(root.executions, (item, index) => decodeListItem(item, `executions[${index}]`), 'executions'),
    page: { limit: integer(page.limit, 'page.limit', 1) },
  }
}

function decodeAuthority(value: unknown): CanonicalDefinitionAuthoritySummary {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as RecordValue).scope === 'per_item') {
    return { scope: 'per_item' }
  }
  const item = object(value, [
    'schemaVersion', 'testSetId', 'revision', 'modelRowId', 'modelVersion', 'supportSealHash',
    'routeEvidenceIdentityHash', 'authenticationExpectationIdentityHash',
  ], 'definitionAuthority')
  const schemaVersion = integer(item.schemaVersion, 'definitionAuthority.schemaVersion', 1)
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    throw new CanonicalResultsContractError('definitionAuthority.schemaVersion is unsupported.')
  }
  const authority: DecodedDefinitionAuthorityBase = {
    testSetId: id(item.testSetId, 'definitionAuthority.testSetId'),
    revision: integer(item.revision, 'definitionAuthority.revision', 1),
    modelRowId: integer(item.modelRowId, 'definitionAuthority.modelRowId', 1),
    modelVersion: string(item.modelVersion, 'definitionAuthority.modelVersion'),
    supportSealHash: nullable(item.supportSealHash, value => hash(value, 'definitionAuthority.supportSealHash')),
    routeEvidenceIdentityHash: nullable(item.routeEvidenceIdentityHash, value => hash(value, 'definitionAuthority.routeEvidenceIdentityHash')),
    authenticationExpectationIdentityHash: nullable(item.authenticationExpectationIdentityHash, value => hash(value, 'definitionAuthority.authenticationExpectationIdentityHash')),
  }
  const hashes = [authority.supportSealHash, authority.routeEvidenceIdentityHash, authority.authenticationExpectationIdentityHash]
  if (schemaVersion === 1) {
    if (hashes.some(hashValue => hashValue !== null)) {
      throw new CanonicalResultsContractError('definitionAuthority v1 cannot claim canonical support authority.')
    }
    return {
      schemaVersion,
      testSetId: authority.testSetId,
      revision: authority.revision,
      modelRowId: authority.modelRowId,
      modelVersion: authority.modelVersion,
      supportSealHash: null,
      routeEvidenceIdentityHash: null,
      authenticationExpectationIdentityHash: null,
    }
  }
  if (hashes.some(hashValue => hashValue === null)) {
    throw new CanonicalResultsContractError(`definitionAuthority v${schemaVersion} requires complete canonical support authority.`)
  }
  return {
    schemaVersion,
    ...authority,
    supportSealHash: authority.supportSealHash!,
    routeEvidenceIdentityHash: authority.routeEvidenceIdentityHash!,
    authenticationExpectationIdentityHash: authority.authenticationExpectationIdentityHash!,
  }
}

function decodeDiagnosticIdentity(value: unknown, label: string): CanonicalDiagnosticIdentity {
  const item = object(value, ['projectId', 'executionId', 'runId', 'itemOrdinal', 'evidenceSchemaVersion'], label)
  if (item.evidenceSchemaVersion !== 'forge.m4.diagnostic-evidence/v1') {
    throw new CanonicalResultsContractError(`${label}.evidenceSchemaVersion is unsupported.`)
  }
  return {
    projectId: id(item.projectId, `${label}.projectId`),
    executionId: id(item.executionId, `${label}.executionId`),
    runId: id(item.runId, `${label}.runId`),
    itemOrdinal: integer(item.itemOrdinal, `${label}.itemOrdinal`, 1),
    evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1',
  }
}

function decodeDiagnosticOutcome(value: unknown, label: string): CanonicalDiagnosticOutcome {
  const base = object(value, [
    'schemaVersion', 'evidenceSchemaVersion', 'classifierVersion', 'evidenceHash', 'kind',
    'failureMode', 'refusalCode', 'integrityFindings', 'explanationCode', 'explanationParameters',
  ], label)
  const common = {
    schemaVersion: base.schemaVersion,
    evidenceSchemaVersion: base.evidenceSchemaVersion,
    classifierVersion: base.classifierVersion,
    evidenceHash: hash(base.evidenceHash, `${label}.evidenceHash`),
  }
  if (common.schemaVersion !== 'forge.m4.diagnostic-outcome/v1'
    || common.evidenceSchemaVersion !== 'forge.m4.diagnostic-evidence/v1'
    || common.classifierVersion !== 'forge.m4.diagnostic-classifier/v1') {
    throw new CanonicalResultsContractError(`${label} version is unsupported.`)
  }
  const emptyParameters = () => object(base.explanationParameters, [], `${label}.explanationParameters`)
  const classifiedKeys = ['schemaVersion', 'evidenceSchemaVersion', 'classifierVersion', 'evidenceHash', 'kind', 'failureMode', 'explanationCode', 'explanationParameters']
  if (base.kind === 'classified_failure') {
    object(value, classifiedKeys, label)
    if (base.failureMode === 'executor_failure' && base.explanationCode === 'executor_failed_before_completion') {
      const parameters = object(base.explanationParameters, ['failureClass'], `${label}.explanationParameters`)
      return { ...common, kind: 'classified_failure', failureMode: 'executor_failure', explanationCode: 'executor_failed_before_completion', explanationParameters: {
        failureClass: enumeration(parameters.failureClass, ['browser_session_unavailable', 'executor_internal_failure', 'process_failure', 'timeout'] as const, `${label}.explanationParameters.failureClass`),
      } } as CanonicalDiagnosticOutcome
    }
    if (base.failureMode === 'authentication_not_established' && base.explanationCode === 'authentication_attempt_not_established') {
      emptyParameters()
      return { ...common, kind: 'classified_failure', failureMode: 'authentication_not_established', explanationCode: 'authentication_attempt_not_established', explanationParameters: {} } as CanonicalDiagnosticOutcome
    }
    if (base.failureMode === 'navigation_not_completed' && base.explanationCode === 'governed_navigation_not_completed') {
      const parameters = object(base.explanationParameters, ['failureClass', 'expectedRoute', 'actualRoute'], `${label}.explanationParameters`)
      return { ...common, kind: 'classified_failure', failureMode: 'navigation_not_completed', explanationCode: 'governed_navigation_not_completed', explanationParameters: {
        failureClass: enumeration(parameters.failureClass, ['destination_unavailable', 'browser_navigation_error', 'timeout'] as const, `${label}.explanationParameters.failureClass`),
        expectedRoute: route(parameters.expectedRoute, `${label}.explanationParameters.expectedRoute`),
        actualRoute: nullable(parameters.actualRoute, item => route(item, `${label}.explanationParameters.actualRoute`)),
      } } as CanonicalDiagnosticOutcome
    }
    if (base.failureMode === 'target_not_observed' && base.explanationCode === 'governed_target_not_observed') {
      const parameters = object(base.explanationParameters, ['subjectId', 'elementId', 'observedCardinality'], `${label}.explanationParameters`)
      if (parameters.observedCardinality !== 'zero') throw new CanonicalResultsContractError(`${label}.explanationParameters.observedCardinality is unsupported.`)
      return { ...common, kind: 'classified_failure', failureMode: 'target_not_observed', explanationCode: 'governed_target_not_observed', explanationParameters: {
        subjectId: id(parameters.subjectId, `${label}.explanationParameters.subjectId`), elementId: id(parameters.elementId, `${label}.explanationParameters.elementId`), observedCardinality: 'zero',
      } } as CanonicalDiagnosticOutcome
    }
    if (base.failureMode === 'action_not_completed' && base.explanationCode === 'governed_action_not_completed') {
      const parameters = object(base.explanationParameters, ['subjectId', 'elementId', 'failureClass'], `${label}.explanationParameters`)
      return { ...common, kind: 'classified_failure', failureMode: 'action_not_completed', explanationCode: 'governed_action_not_completed', explanationParameters: {
        subjectId: id(parameters.subjectId, `${label}.explanationParameters.subjectId`), elementId: id(parameters.elementId, `${label}.explanationParameters.elementId`),
        failureClass: enumeration(parameters.failureClass, ['target_not_actionable', 'interaction_failed', 'timeout'] as const, `${label}.explanationParameters.failureClass`),
      } } as CanonicalDiagnosticOutcome
    }
    if (base.failureMode === 'oracle_mismatch' && base.explanationCode === 'governed_oracle_mismatch') {
      const parameters = object(base.explanationParameters, ['subjectId', 'expectedRoute', 'actualRoute'], `${label}.explanationParameters`)
      return { ...common, kind: 'classified_failure', failureMode: 'oracle_mismatch', explanationCode: 'governed_oracle_mismatch', explanationParameters: {
        subjectId: id(parameters.subjectId, `${label}.explanationParameters.subjectId`), expectedRoute: route(parameters.expectedRoute, `${label}.explanationParameters.expectedRoute`), actualRoute: route(parameters.actualRoute, `${label}.explanationParameters.actualRoute`),
      } } as CanonicalDiagnosticOutcome
    }
    throw new CanonicalResultsContractError(`${label} classified outcome is unsupported.`)
  }
  if (base.kind === 'refusal' && base.refusalCode === 'insufficient_evidence' && base.explanationCode === 'diagnostic_predicates_not_satisfied') {
    object(value, ['schemaVersion', 'evidenceSchemaVersion', 'classifierVersion', 'evidenceHash', 'kind', 'refusalCode', 'explanationCode', 'explanationParameters'], label)
    emptyParameters()
    return { ...common, kind: 'refusal', refusalCode: 'insufficient_evidence', explanationCode: 'diagnostic_predicates_not_satisfied', explanationParameters: {} } as CanonicalDiagnosticOutcome
  }
  if (base.kind === 'refusal' && base.refusalCode === 'integrity_invalid' && base.explanationCode === 'diagnostic_integrity_validation_failed') {
    object(value, ['schemaVersion', 'evidenceSchemaVersion', 'classifierVersion', 'evidenceHash', 'kind', 'refusalCode', 'integrityFindings', 'explanationCode', 'explanationParameters'], label)
    emptyParameters()
    const findings = array(base.integrityFindings, item => enumeration(item, DIAGNOSTIC_INTEGRITY_FINDINGS, `${label}.integrityFindings`), `${label}.integrityFindings`)
    if (findings.length < 1 || new Set(findings).size !== findings.length) throw new CanonicalResultsContractError(`${label}.integrityFindings is invalid.`)
    return { ...common, kind: 'refusal', refusalCode: 'integrity_invalid', integrityFindings: findings, explanationCode: 'diagnostic_integrity_validation_failed', explanationParameters: {} } as CanonicalDiagnosticOutcome
  }
  throw new CanonicalResultsContractError(`${label} outcome is unsupported.`)
}

function decodeDiagnostic(value: unknown, label: string): CanonicalResultDiagnostic {
  const base = object(value, ['state', 'reason', 'identity', 'evidenceSchemaVersion', 'evidenceHash', 'classifierVersion', 'outcome', 'displayString'], label)
  const identity = decodeDiagnosticIdentity(base.identity, `${label}.identity`)
  if (base.state === 'unavailable') {
    object(value, ['state', 'reason', 'identity'], label)
    return { state: 'unavailable', reason: enumeration(base.reason, DIAGNOSTIC_UNAVAILABLE_REASONS, `${label}.reason`), identity }
  }
  if (base.state !== 'available') throw new CanonicalResultsContractError(`${label}.state is unsupported.`)
  object(value, ['state', 'identity', 'evidenceSchemaVersion', 'evidenceHash', 'classifierVersion', 'outcome', 'displayString'], label)
  if (base.evidenceSchemaVersion !== 'forge.m4.diagnostic-evidence/v1' || base.classifierVersion !== 'forge.m4.diagnostic-classifier/v1') {
    throw new CanonicalResultsContractError(`${label} version is unsupported.`)
  }
  if (identity.evidenceSchemaVersion !== base.evidenceSchemaVersion) {
    throw new CanonicalResultsContractError(`${label} evidence schema version is inconsistent.`)
  }
  const evidenceHash = hash(base.evidenceHash, `${label}.evidenceHash`)
  const outcome = decodeDiagnosticOutcome(base.outcome, `${label}.outcome`)
  if (outcome.evidenceHash !== evidenceHash) throw new CanonicalResultsContractError(`${label} evidence hash is inconsistent.`)
  return {
    state: 'available', identity, evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v1', evidenceHash,
    classifierVersion: 'forge.m4.diagnostic-classifier/v1', outcome,
    displayString: string(base.displayString, `${label}.displayString`),
  }
}

function decodeEvidence(value: unknown, label: string): CanonicalObservedResult | CanonicalMissingResult {
  const item = object(value, [
    'kind', 'resultId', 'outcome', 'reasonCode', 'safeMessage', 'durationMs', 'oracleKind', 'observedSubjectId',
  ], label)
  if (item.kind === 'missing_result') {
    const missing = object(value, ['kind', 'reasonCode'], label)
    if (missing.reasonCode !== 'expected_result_missing') throw new CanonicalResultsContractError(`${label}.reasonCode is unsupported.`)
    return { kind: 'missing_result', reasonCode: 'expected_result_missing' }
  }
  if (item.kind !== 'observed_result') throw new CanonicalResultsContractError(`${label}.kind is unsupported.`)
  if (item.safeMessage !== null) {
    throw new CanonicalResultsContractError(`${label} contains unpersisted Result detail.`)
  }
  const oracleKind = nullable(item.oracleKind, value => enumeration(
    value, ORACLE_KINDS, `${label}.oracleKind`,
  ))
  const observedSubjectId = nullable(item.observedSubjectId, value => id(value, `${label}.observedSubjectId`))
  if ((oracleKind === null) !== (observedSubjectId === null)) {
    throw new CanonicalResultsContractError(`${label} Result detail is incomplete.`)
  }
  return {
    kind: 'observed_result',
    resultId: id(item.resultId, `${label}.resultId`),
    outcome: enumeration(item.outcome, OUTCOMES, `${label}.outcome`),
    reasonCode: reason(item.reasonCode, `${label}.reasonCode`),
    safeMessage: null,
    durationMs: integer(item.durationMs, `${label}.durationMs`),
    oracleKind,
    observedSubjectId,
  }
}

function decodeItem(value: unknown, label: string): CanonicalExecutionResultItem {
  const item = object(value, ['manifestOrdinal', 'definitionId', 'executablePlanHash', 'evidence', 'diagnostic'], label)
  return {
    manifestOrdinal: integer(item.manifestOrdinal, `${label}.manifestOrdinal`, 1),
    definitionId: id(item.definitionId, `${label}.definitionId`),
    executablePlanHash: hash(item.executablePlanHash, `${label}.executablePlanHash`),
    evidence: decodeEvidence(item.evidence, `${label}.evidence`),
    ...(item.diagnostic === undefined ? {} : { diagnostic: decodeDiagnostic(item.diagnostic, `${label}.diagnostic`) }),
  }
}

interface CanonicalEvidenceTally {
  passed: number
  failed: number
  couldNotVerify: number
  missing: number
  observed: number
}

function tallyEvidence(items: readonly CanonicalExecutionResultItem[]): CanonicalEvidenceTally {
  const tally: CanonicalEvidenceTally = { passed: 0, failed: 0, couldNotVerify: 0, missing: 0, observed: 0 }
  for (const item of items) {
    if (item.evidence.kind === 'missing_result') {
      tally.missing += 1
      continue
    }
    tally.observed += 1
    if (item.evidence.outcome === 'passed') tally.passed += 1
    else if (item.evidence.outcome === 'failed') tally.failed += 1
    else tally.couldNotVerify += 1
  }
  return tally
}

/** Mirrors PersistedEvidenceAggregator's manifest-aware Execution rule. */
function expectedEvidenceHeadline(tally: CanonicalEvidenceTally): CanonicalResultOutcome {
  if (tally.observed + tally.missing === 0) {
    throw new CanonicalResultsContractError('Canonical Results evidence requires a non-empty execution manifest.')
  }
  if (tally.failed > 0) return 'failed'
  if (tally.couldNotVerify > 0 || tally.missing > 0) return 'could_not_verify'
  return 'passed'
}

/** Mirrors its Result-only Run rule; missing manifest members do not rewrite observed Run truth. */
function expectedRunEvidenceOutcome(
  tally: CanonicalEvidenceTally,
  lifecycle: CanonicalRunLifecycle,
): CanonicalResultOutcome | null {
  if (tally.observed === 0) return lifecycle === 'cancelled' ? 'could_not_verify' : null
  if (tally.failed > 0) return 'failed'
  if (tally.couldNotVerify > 0) return 'could_not_verify'
  return 'passed'
}

/** Mirrors the aggregator's manifest-ordered Result-only Run reason selection. */
function expectedRunEvidenceReason(
  items: readonly CanonicalExecutionResultItem[],
  tally: CanonicalEvidenceTally,
  lifecycle: CanonicalRunLifecycle,
): string | null {
  const outcome = expectedRunEvidenceOutcome(tally, lifecycle)
  if (outcome === null) return null
  if (outcome === 'failed') {
    return items.find(item => item.evidence.kind === 'observed_result'
      && item.evidence.outcome === 'failed')!.evidence.reasonCode
  }
  if (outcome === 'could_not_verify') {
    const observed = items.find(item => item.evidence.kind === 'observed_result'
      && item.evidence.outcome === 'could_not_verify')
    return observed?.evidence.reasonCode ?? 'expected_result_missing'
  }
  return 'completed'
}

export function decodeCanonicalExecutionResultsDetail(value: unknown, expectedProjectId?: string): CanonicalExecutionResultsDetail {
  const root = object(value, ['kind', 'evidenceHeadlineOutcome', 'execution', 'run', 'items', 'integrityWarnings'], 'Results detail')
  if (root.kind !== 'canonical_execution_results') throw new CanonicalResultsContractError('Results detail kind is unsupported.')
  const execution = object(root.execution, [
    'executionId', 'lifecycle', 'terminalOutcome', 'authorityReasonCode', 'acceptedAt', 'terminalAt',
    'expectedResultCount', 'definitionAuthority',
    'selectionAuthority',
  ], 'execution')
  const run = root.run === null ? null : object(root.run, [
    'runId', 'lifecycle', 'evidenceOutcome', 'evidenceReasonCode', 'startedAt', 'terminalAt',
    'expectedResultCount', 'observedResultCount', 'evidenceCounts',
  ], 'run')
  const evidenceCounts = run === null ? null : object(run.evidenceCounts, ['passed', 'failed', 'couldNotVerify', 'missing'], 'run.evidenceCounts')
  const items = array(root.items, (item, index) => decodeItem(item, `items[${index}]`), 'items')
  const projection: CanonicalExecutionResultsDetail = {
    kind: 'canonical_execution_results',
    evidenceHeadlineOutcome: enumeration(root.evidenceHeadlineOutcome, OUTCOMES, 'evidenceHeadlineOutcome'),
    execution: {
      executionId: id(execution.executionId, 'execution.executionId'),
      lifecycle: enumeration(execution.lifecycle, EXECUTION_LIFECYCLES, 'execution.lifecycle'),
      terminalOutcome: nullable(execution.terminalOutcome, value => enumeration(value, OUTCOMES, 'execution.terminalOutcome')),
      authorityReasonCode: nullable(execution.authorityReasonCode, value => reason(value, 'execution.authorityReasonCode')),
      acceptedAt: timestamp(execution.acceptedAt, 'execution.acceptedAt'),
      terminalAt: nullable(execution.terminalAt, value => timestamp(value, 'execution.terminalAt')),
      expectedResultCount: integer(execution.expectedResultCount, 'execution.expectedResultCount', 1),
      definitionAuthority: decodeAuthority(execution.definitionAuthority),
      ...(execution.selectionAuthority===undefined?{}:{selectionAuthority:decodeCanonicalSuiteSelectionAuthority(execution.selectionAuthority)}),
    },
    run: run === null || evidenceCounts === null ? null : {
      runId: id(run.runId, 'run.runId'),
      lifecycle: enumeration(run.lifecycle, RUN_LIFECYCLES, 'run.lifecycle'),
      evidenceOutcome: nullable(run.evidenceOutcome, value => enumeration(value, OUTCOMES, 'run.evidenceOutcome')),
      evidenceReasonCode: nullable(run.evidenceReasonCode, value => reason(value, 'run.evidenceReasonCode')),
      startedAt: timestamp(run.startedAt, 'run.startedAt'),
      terminalAt: nullable(run.terminalAt, value => timestamp(value, 'run.terminalAt')),
      expectedResultCount: integer(run.expectedResultCount, 'run.expectedResultCount', 1),
      observedResultCount: integer(run.observedResultCount, 'run.observedResultCount'),
      evidenceCounts: {
        passed: integer(evidenceCounts.passed, 'run.evidenceCounts.passed'),
        failed: integer(evidenceCounts.failed, 'run.evidenceCounts.failed'),
        couldNotVerify: integer(evidenceCounts.couldNotVerify, 'run.evidenceCounts.couldNotVerify'),
        missing: integer(evidenceCounts.missing, 'run.evidenceCounts.missing'),
      },
    },
    items,
    integrityWarnings: decodeCanonicalResultsIntegrityWarnings(root.integrityWarnings),
  }
  if (projection.execution.expectedResultCount !== projection.items.length) {
    throw new CanonicalResultsContractError('Results detail manifest count disagrees with its items.')
  }
  const executionTerminal = ['completed', 'cancelled', 'interrupted'].includes(projection.execution.lifecycle)
  if ((executionTerminal && (projection.execution.terminalOutcome === null || projection.execution.terminalAt === null))
    || (!executionTerminal && (projection.execution.terminalOutcome !== null || projection.execution.terminalAt !== null))) {
    throw new CanonicalResultsContractError('Results detail execution lifecycle disagrees with terminal authority.')
  }
  const ordinals = projection.items.map(item => item.manifestOrdinal)
  const definitionIds = projection.items.map(item => item.definitionId)
  const resultIds = projection.items.flatMap(item => item.evidence.kind === 'observed_result' ? [item.evidence.resultId] : [])
  const tally = tallyEvidence(projection.items)
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new CanonicalResultsContractError('Results detail manifest ordering is inconsistent.')
  }
  if (new Set(definitionIds).size !== definitionIds.length) {
    throw new CanonicalResultsContractError('Results detail manifest contains duplicate Definition identity.')
  }
  if (new Set(resultIds).size !== resultIds.length) {
    throw new CanonicalResultsContractError('Results detail contains duplicate Result identity.')
  }
  if (projection.evidenceHeadlineOutcome !== expectedEvidenceHeadline(tally)) {
    throw new CanonicalResultsContractError('Results detail evidence headline contradicts its Result items.')
  }
  if (projection.run === null && tally.observed > 0) {
    throw new CanonicalResultsContractError('Observed Product Result evidence has no owning Product Run.')
  }
  if (projection.run && (projection.run.expectedResultCount !== projection.items.length
    || projection.run.observedResultCount !== tally.observed
    || projection.run.evidenceCounts.passed !== tally.passed
    || projection.run.evidenceCounts.failed !== tally.failed
    || projection.run.evidenceCounts.couldNotVerify !== tally.couldNotVerify
    || projection.run.evidenceCounts.missing !== tally.missing
    || projection.run.evidenceOutcome !== expectedRunEvidenceOutcome(tally, projection.run.lifecycle)
    || projection.run.evidenceReasonCode !== expectedRunEvidenceReason(projection.items, tally, projection.run.lifecycle)
    || (projection.run.lifecycle === 'running' && projection.run.terminalAt !== null)
    || (['completed', 'cancelled'].includes(projection.run.lifecycle) && projection.run.terminalAt === null)
    || (projection.run.lifecycle === 'interrupted' && projection.run.terminalAt !== null))) {
    throw new CanonicalResultsContractError('Results detail Run evidence disagrees with its Result items.')
  }
  for (const item of projection.items) {
    if (!item.diagnostic) continue
    if (!projection.run || item.diagnostic.identity.projectId.length < 1
      || expectedProjectId !== undefined && item.diagnostic.identity.projectId !== expectedProjectId
      || item.diagnostic.identity.executionId !== projection.execution.executionId
      || item.diagnostic.identity.runId !== projection.run.runId
      || item.diagnostic.identity.itemOrdinal !== item.manifestOrdinal) {
      throw new CanonicalResultsContractError('Results detail diagnostic identity is cross-bound.')
    }
  }
  return projection
}

/** Adapts the core-owned projection to the one frontend-visible contract. */
export function serializeCanonicalExecutionResultsRead(value: unknown, expectedProjectId?: string): CanonicalExecutionResultsRead {
  const root = object(value, ['kind', 'projection', 'integrityWarnings'], 'Core Results read')
  if (root.kind === 'not_found') {
    object(value, ['kind'], 'Core Results read')
    return { kind: 'not_found' }
  }
  if (root.kind === 'integrity_invalid') {
    object(value, ['kind', 'integrityWarnings'], 'Core Results read')
    return { kind: 'integrity_invalid', integrityWarnings: decodeCanonicalResultsIntegrityWarnings(root.integrityWarnings) }
  }
  if (root.kind !== 'ok') throw new CanonicalResultsContractError('Core Results read kind is unsupported.')
  const source = object(root.projection, ['availability', 'headlineOutcome', 'execution', 'run', 'items', 'integrityWarnings'], 'Core Results projection')
  if (source.availability !== 'available') throw new CanonicalResultsContractError('Core Results projection availability is unsupported.')
  const execution = object(source.execution, [
    'executionId', 'lifecycle', 'outcome', 'reasonCode', 'acceptedAt', 'terminalAt', 'manifestCount', 'definitionAuthority',
    'selectionAuthority',
  ], 'Core execution')
  const sourceItems = array(source.items, (entry, index) => {
    const item = object(entry, ['itemOrdinal', 'definitionId', 'executablePlanHash', 'result', 'diagnostic'], `Core items[${index}]`)
    const result = object(item.result, ['state', 'resultId', 'outcome', 'reasonCode', 'safeMessage', 'durationMs', 'oracleKind', 'observedSubjectId'], `Core items[${index}].result`)
    const evidence: CanonicalObservedResult | CanonicalMissingResult = result.state === 'no_result_observed'
      ? (() => {
          object(item.result, ['state', 'reasonCode'], `Core items[${index}].result`)
          if (result.reasonCode !== 'expected_result_missing') throw new CanonicalResultsContractError(`Core items[${index}].result reason is unsupported.`)
          return { kind: 'missing_result', reasonCode: 'expected_result_missing' }
        })()
      : result.state === 'result_observed'
        ? {
            kind: 'observed_result',
            resultId: id(result.resultId, `Core items[${index}].result.resultId`),
            outcome: enumeration(result.outcome, OUTCOMES, `Core items[${index}].result.outcome`),
            reasonCode: reason(result.reasonCode, `Core items[${index}].result.reasonCode`),
            safeMessage: result.safeMessage === null ? null : (() => { throw new CanonicalResultsContractError('Core Result safeMessage was not persisted.') })(),
            durationMs: integer(result.durationMs, `Core items[${index}].result.durationMs`),
            oracleKind: nullable(result.oracleKind, value => enumeration(
              value, ORACLE_KINDS, `Core items[${index}].result.oracleKind`,
            )),
            observedSubjectId: nullable(
              result.observedSubjectId,
              value => id(value, `Core items[${index}].result.observedSubjectId`),
            ),
          }
        : (() => { throw new CanonicalResultsContractError(`Core items[${index}].result state is unsupported.`) })()
    return {
      manifestOrdinal: integer(item.itemOrdinal, `Core items[${index}].itemOrdinal`, 1),
      definitionId: id(item.definitionId, `Core items[${index}].definitionId`),
      executablePlanHash: hash(item.executablePlanHash, `Core items[${index}].executablePlanHash`),
      evidence,
      ...(item.diagnostic === undefined ? {} : { diagnostic: item.diagnostic }),
    }
  }, 'Core items')
  const sourceRun = source.run === null ? null : object(source.run, [
    'runId', 'lifecycle', 'outcome', 'reasonCode', 'startedAt', 'terminalAt', 'expectedResultCount',
    'observedResultCount', 'aggregateCounts',
  ], 'Core run')
  const aggregateCounts = sourceRun === null ? null : object(sourceRun.aggregateCounts, ['passed', 'failed', 'couldNotVerify'], 'Core run aggregateCounts')
  const observedCount = sourceRun === null ? 0 : integer(sourceRun.observedResultCount, 'Core run observedResultCount')
  return {
    kind: 'ok',
    projection: decodeCanonicalExecutionResultsDetail({
      kind: 'canonical_execution_results',
      evidenceHeadlineOutcome: source.headlineOutcome,
      execution: {
        executionId: execution.executionId,
        lifecycle: execution.lifecycle,
        terminalOutcome: execution.outcome,
        authorityReasonCode: execution.reasonCode,
        acceptedAt: execution.acceptedAt,
        terminalAt: execution.terminalAt,
        expectedResultCount: execution.manifestCount,
        definitionAuthority: execution.definitionAuthority,
        ...(execution.selectionAuthority===undefined?{}:{selectionAuthority:execution.selectionAuthority}),
      },
      run: sourceRun === null || aggregateCounts === null ? null : {
        runId: sourceRun.runId,
        lifecycle: sourceRun.lifecycle,
        evidenceOutcome: sourceRun.outcome,
        evidenceReasonCode: sourceRun.reasonCode,
        startedAt: sourceRun.startedAt,
        terminalAt: sourceRun.terminalAt,
        expectedResultCount: sourceRun.expectedResultCount,
        observedResultCount: observedCount,
        evidenceCounts: {
          passed: aggregateCounts.passed,
          failed: aggregateCounts.failed,
          couldNotVerify: aggregateCounts.couldNotVerify,
          missing: sourceItems.length - observedCount,
        },
      },
      items: sourceItems,
      integrityWarnings: source.integrityWarnings,
    }, expectedProjectId),
  }
}

/** Adapts the core list projection and rejects malformed or legacy-shaped rows. */
export function serializeCanonicalExecutionResultsList(value: unknown, requestedLimit: number): CanonicalExecutionResultsListResponse {
  const root = object(value, ['kind', 'executions', 'limit'], 'Core Results list')
  if (root.kind !== 'ok' || integer(root.limit, 'Core Results list limit', 1) !== requestedLimit) {
    throw new CanonicalResultsContractError('Core Results list identity is malformed.')
  }
  return decodeCanonicalExecutionResultsList({
    executions: array(root.executions, (entry, index) => {
      const item = object(entry, [
        'executionId', 'lifecycle', 'evidenceHeadlineOutcome', 'outcome', 'reasonCode', 'acceptedAt', 'terminalAt', 'manifestCount',
        'runCount', 'observedResultCount', 'passedResultCount', 'failedResultCount', 'couldNotVerifyResultCount', 'integrityState',
        'selectionAuthority',
      ], `Core executions[${index}]`)
      return {
        executionId: item.executionId,
        lifecycle: item.lifecycle,
        evidenceHeadlineOutcome: item.evidenceHeadlineOutcome,
        terminalOutcome: item.outcome,
        authorityReasonCode: item.reasonCode,
        acceptedAt: item.acceptedAt,
        terminalAt: item.terminalAt,
        expectedResultCount: item.manifestCount,
        runCount: item.runCount,
        observedResultCount: item.observedResultCount,
        passedResultCount: item.passedResultCount,
        failedResultCount: item.failedResultCount,
        couldNotVerifyResultCount: item.couldNotVerifyResultCount,
        integrityState: item.integrityState,
        ...(item.selectionAuthority===undefined?{}:{selectionAuthority:item.selectionAuthority}),
      }
    }, 'Core executions'),
    page: { limit: requestedLimit },
  })
}
