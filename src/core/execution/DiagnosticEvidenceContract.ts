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

export const DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION = 'forge.m4.diagnostic-evidence/v1' as const

export interface AcceptedDefinitionAuthorityV1 {
  definitionSchemaVersion: 3
  testSetId: string
  testSetRevision: number
  testSetContentHash: string
  definitionId: string
  definitionContentHash: string
  supportSealHash: string
  routeEvidenceIdentityHash: string
  authenticationExpectationIdentityHash: string
  snapshotHash: string
}

export interface DiagnosticSuiteAuthorityV1 {
  suiteId: string
  suiteRevision: number
  suiteContentHash: string
}

export interface DiagnosticEvidenceAuthorityV1 {
  projectId: string
  executionId: string
  runId: string
  itemOrdinal: number
  resultId: string | null
  definitionId: string
  executablePlanHash: string
  acceptedDefinitionAuthority: AcceptedDefinitionAuthorityV1
  suiteAuthority: DiagnosticSuiteAuthorityV1 | null
}

export type DiagnosticExecutorEvidence =
  | { outcome: 'completed' }
  | { outcome: 'failed'; failureClass: 'browser_session_unavailable' | 'executor_internal_failure' | 'process_failure' | 'timeout' }
  | { outcome: 'not_started' }

export type DiagnosticAuthenticationEvidence =
  | { state: 'not_required' }
  | { state: 'established'; attemptOccurred: boolean }
  | { state: 'not_established'; attemptOccurred: true }
  | { state: 'not_performed' }

export type DiagnosticNavigationEvidence =
  | { outcome: 'completed'; intendedRoute: string; observedRoute: string }
  | { outcome: 'not_completed'; intendedRoute: string; observedRoute: string | null; failureClass: 'destination_unavailable' | 'browser_navigation_error' | 'timeout' }
  | { outcome: 'not_performed' }

export interface DiagnosticTargetAuthority {
  subjectId: string
  elementId: string
  selectorKind: 'data_test'
  selectorValue: string
}

export type DiagnosticTargetObservationEvidence =
  | { outcome: 'observed'; targetAuthority: DiagnosticTargetAuthority; cardinality: 'one' | 'many' }
  | { outcome: 'not_observed'; targetAuthority: DiagnosticTargetAuthority; cardinality: 'zero' }
  | { outcome: 'not_performed' }

export type DiagnosticActionEvidence =
  | { outcome: 'completed'; interactionAttempted: true; semantic: 'click_observed_data_test' }
  | { outcome: 'not_completed'; interactionAttempted: true; semantic: 'click_observed_data_test'; failureClass: 'target_not_actionable' | 'interaction_failed' | 'timeout' }
  | { outcome: 'not_performed' }

export interface DiagnosticOracleAuthority { kind: 'subject_observable'; subjectId: string }
export type DiagnosticOracleEvidence =
  | { outcome: 'matched'; oracleAuthority: DiagnosticOracleAuthority; expected: string; actual: string }
  | { outcome: 'mismatched'; oracleAuthority: DiagnosticOracleAuthority; expected: string; actual: string }
  | { outcome: 'not_performed' }

export interface DiagnosticEvidenceFactsV1 {
  executor: DiagnosticExecutorEvidence
  authentication: DiagnosticAuthenticationEvidence
  navigation: DiagnosticNavigationEvidence
  targetObservation: DiagnosticTargetObservationEvidence
  action: DiagnosticActionEvidence
  oracle: DiagnosticOracleEvidence
}

export interface DiagnosticEvidenceV1 extends DiagnosticEvidenceFactsV1 {
  schemaVersion: typeof DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
  authority: DiagnosticEvidenceAuthorityV1
}

export class DiagnosticEvidenceContractError extends Error {
  constructor(message = 'Diagnostic evidence does not satisfy the frozen v1 contract.') {
    super(message)
    this.name = 'DiagnosticEvidenceContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const HASH = /^[a-f0-9]{64}$/
const ROUTE = /^\/(?!\/)(?:[^?#\s]*)$/
const SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DiagnosticEvidenceContractError()
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DiagnosticEvidenceContractError()
  }
}

function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value) }
function hash(value: unknown): value is string { return typeof value === 'string' && HASH.test(value) }
function route(value: unknown): value is string { return typeof value === 'string' && value.length <= 500 && ROUTE.test(value) }

function parseTargetAuthority(value: unknown): DiagnosticTargetAuthority {
  const item = record(value)
  exact(item, ['subjectId', 'elementId', 'selectorKind', 'selectorValue'])
  if (!id(item.subjectId) || !id(item.elementId) || item.selectorKind !== 'data_test'
    || typeof item.selectorValue !== 'string' || !SELECTOR.test(item.selectorValue)) throw new DiagnosticEvidenceContractError()
  return item as unknown as DiagnosticTargetAuthority
}

function parseOracleAuthority(value: unknown): DiagnosticOracleAuthority {
  const item = record(value)
  exact(item, ['kind', 'subjectId'])
  if (item.kind !== 'subject_observable' || !id(item.subjectId)) throw new DiagnosticEvidenceContractError()
  return item as unknown as DiagnosticOracleAuthority
}

export function parseDiagnosticEvidenceFactsV1(value: unknown): DiagnosticEvidenceFactsV1 {
  const facts = record(value)
  exact(facts, ['executor', 'authentication', 'navigation', 'targetObservation', 'action', 'oracle'])

  const executor = record(facts.executor)
  if (executor.outcome === 'completed' || executor.outcome === 'not_started') exact(executor, ['outcome'])
  else if (executor.outcome === 'failed') {
    exact(executor, ['outcome', 'failureClass'])
    if (!['browser_session_unavailable', 'executor_internal_failure', 'process_failure', 'timeout'].includes(String(executor.failureClass))) throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  const authentication = record(facts.authentication)
  if (authentication.state === 'not_required' || authentication.state === 'not_performed') exact(authentication, ['state'])
  else if (authentication.state === 'established') {
    exact(authentication, ['state', 'attemptOccurred'])
    if (typeof authentication.attemptOccurred !== 'boolean') throw new DiagnosticEvidenceContractError()
  } else if (authentication.state === 'not_established') {
    exact(authentication, ['state', 'attemptOccurred'])
    if (authentication.attemptOccurred !== true) throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  const navigation = record(facts.navigation)
  if (navigation.outcome === 'not_performed') exact(navigation, ['outcome'])
  else if (navigation.outcome === 'completed') {
    exact(navigation, ['outcome', 'intendedRoute', 'observedRoute'])
    if (!route(navigation.intendedRoute) || !route(navigation.observedRoute)) throw new DiagnosticEvidenceContractError()
  } else if (navigation.outcome === 'not_completed') {
    exact(navigation, ['outcome', 'intendedRoute', 'observedRoute', 'failureClass'])
    if (!route(navigation.intendedRoute) || navigation.observedRoute !== null && !route(navigation.observedRoute)
      || !['destination_unavailable', 'browser_navigation_error', 'timeout'].includes(String(navigation.failureClass))) throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  const target = record(facts.targetObservation)
  if (target.outcome === 'not_performed') exact(target, ['outcome'])
  else if (target.outcome === 'observed') {
    exact(target, ['outcome', 'targetAuthority', 'cardinality'])
    parseTargetAuthority(target.targetAuthority)
    if (!['one', 'many'].includes(String(target.cardinality))) throw new DiagnosticEvidenceContractError()
  } else if (target.outcome === 'not_observed') {
    exact(target, ['outcome', 'targetAuthority', 'cardinality'])
    parseTargetAuthority(target.targetAuthority)
    if (target.cardinality !== 'zero') throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  const action = record(facts.action)
  if (action.outcome === 'not_performed') exact(action, ['outcome'])
  else if (action.outcome === 'completed') {
    exact(action, ['outcome', 'interactionAttempted', 'semantic'])
    if (action.interactionAttempted !== true || action.semantic !== 'click_observed_data_test') throw new DiagnosticEvidenceContractError()
  } else if (action.outcome === 'not_completed') {
    exact(action, ['outcome', 'interactionAttempted', 'semantic', 'failureClass'])
    if (action.interactionAttempted !== true || action.semantic !== 'click_observed_data_test'
      || !['target_not_actionable', 'interaction_failed', 'timeout'].includes(String(action.failureClass))) throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  const oracle = record(facts.oracle)
  if (oracle.outcome === 'not_performed') exact(oracle, ['outcome'])
  else if (oracle.outcome === 'matched' || oracle.outcome === 'mismatched') {
    exact(oracle, ['outcome', 'oracleAuthority', 'expected', 'actual'])
    parseOracleAuthority(oracle.oracleAuthority)
    if (!route(oracle.expected) || !route(oracle.actual)) throw new DiagnosticEvidenceContractError()
  } else throw new DiagnosticEvidenceContractError()

  return structuredClone(facts) as unknown as DiagnosticEvidenceFactsV1
}

function parseAuthority(value: unknown): DiagnosticEvidenceAuthorityV1 {
  const authority = record(value)
  exact(authority, ['projectId', 'executionId', 'runId', 'itemOrdinal', 'resultId', 'definitionId', 'executablePlanHash', 'acceptedDefinitionAuthority', 'suiteAuthority'])
  if (!id(authority.projectId) || !id(authority.executionId) || !id(authority.runId)
    || !Number.isSafeInteger(authority.itemOrdinal) || Number(authority.itemOrdinal) < 1
    || authority.resultId !== null && !id(authority.resultId)
    || !id(authority.definitionId) || !hash(authority.executablePlanHash)) throw new DiagnosticEvidenceContractError()
  const accepted = record(authority.acceptedDefinitionAuthority)
  exact(accepted, ['definitionSchemaVersion', 'testSetId', 'testSetRevision', 'testSetContentHash', 'definitionId', 'definitionContentHash', 'supportSealHash', 'routeEvidenceIdentityHash', 'authenticationExpectationIdentityHash', 'snapshotHash'])
  if (accepted.definitionSchemaVersion !== 3 || !id(accepted.testSetId)
    || !Number.isSafeInteger(accepted.testSetRevision) || Number(accepted.testSetRevision) < 1
    || !hash(accepted.testSetContentHash) || !id(accepted.definitionId)
    || !hash(accepted.definitionContentHash) || !hash(accepted.supportSealHash)
    || !hash(accepted.routeEvidenceIdentityHash) || !hash(accepted.authenticationExpectationIdentityHash)
    || !hash(accepted.snapshotHash) || accepted.definitionId !== authority.definitionId) throw new DiagnosticEvidenceContractError()
  if (authority.suiteAuthority !== null) {
    const suite = record(authority.suiteAuthority)
    exact(suite, ['suiteId', 'suiteRevision', 'suiteContentHash'])
    if (!id(suite.suiteId) || !Number.isSafeInteger(suite.suiteRevision) || Number(suite.suiteRevision) < 1
      || !hash(suite.suiteContentHash)) throw new DiagnosticEvidenceContractError()
  }
  return authority as unknown as DiagnosticEvidenceAuthorityV1
}

export function parseDiagnosticEvidenceV1(value: unknown): DiagnosticEvidenceV1 {
  const evidence = record(value)
  exact(evidence, ['schemaVersion', 'authority', 'executor', 'authentication', 'navigation', 'targetObservation', 'action', 'oracle'])
  if (evidence.schemaVersion !== DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION) throw new DiagnosticEvidenceContractError()
  parseAuthority(evidence.authority)
  parseDiagnosticEvidenceFactsV1({
    executor: evidence.executor,
    authentication: evidence.authentication,
    navigation: evidence.navigation,
    targetObservation: evidence.targetObservation,
    action: evidence.action,
    oracle: evidence.oracle,
  })
  return evidence as unknown as DiagnosticEvidenceV1
}

export function canonicalDiagnosticJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDiagnosticJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalDiagnosticJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
