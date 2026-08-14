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

import * as fs from 'fs'
import * as path from 'path'
import { workspaceResolver, type ResolvedWorkspace } from '../context/WorkspaceResolver'
import { assertValidAppName } from '../context/appName'
import { projectRegistry, type ProjectRegistry } from './ProjectRegistry'

export type ObservationTerminalState =
  | 'completed'
  | 'partially_completed'
  | 'blocked'
  | 'failed'
  | 'unknown'

export type AuthenticationOutcome =
  | 'succeeded'
  | 'failed'
  | 'not_evaluated'
  | 'not_required'

export interface AuthenticationStageRecord {
  stage:
    | 'credential-reference-resolution'
    | 'login-surface-detection'
    | 'username-control-discovery'
    | 'password-control-discovery'
    | 'value-entry-completion'
    | 'submit-control-discovery'
    | 'submission-attempt'
    | 'navigation-or-page-state-change'
    | 'post-submit-login-surface-evaluation'
  outcome: 'succeeded' | 'failed' | 'indeterminate' | 'not_evaluated' | 'not_required'
  selectorStrategyCategory: 'configured' | 'semantic-fallback' | 'not_applicable'
  matchCount?: number
  controlVisible?: boolean
  usernameEntryCompleted?: boolean
  passwordEntryCompleted?: boolean
  submissionAttempted?: boolean
  loginSurfaceRetained?: boolean
  urlClassification?: {
    origin: 'same-origin' | 'different-origin' | 'indeterminate'
    path: 'same-path' | 'different-path' | 'indeterminate'
  }
  safeErrorType?: string
}

export interface AuthenticationAttemptRecord {
  roleId: string
  outcome: 'succeeded' | 'failed' | 'unknown'
  stages: AuthenticationStageRecord[]
}

export interface ObservationStartRecord {
  schemaVersion: 1
  observationId: string
  projectId: string
  projectName: string
  observationContext: {
    id: string
    label: string
    target: string
    declaredScope: string
    strategy: string
  }
  sourceKind: 'crawl-engine'
  startedAt: string
  credentialAvailability: 'available' | 'missing' | 'not_required' | 'unknown'
  authenticationExpectation: string
}

export interface ObservationEvidenceRecord {
  id: string
  subject: string
  summary: string
  capturedAt: string
  provenance: {
    kind: 'crawl-run'
    reference: string
  }
  integrity: 'valid' | 'failed' | 'unknown'
}

export interface ObservationTerminalRecord extends ObservationStartRecord {
  completedAt: string
  terminalState: ObservationTerminalState
  stateReason: string
  authentication: {
    expectation: string
    credentialAvailability: ObservationStartRecord['credentialAvailability']
    outcome: AuthenticationOutcome
    reason: string
    attempts?: AuthenticationAttemptRecord[]
  }
  observedSubjects: Array<{
    id: string
    kind: 'page' | 'route'
    value: string
    evidenceId: string
  }>
  unobservedScope: string[]
  unknowns: Array<{ id: string; subject: string; reason: string }>
  blockers: Array<{ id: string; kind: string; subject: string; reason: string }>
  evidence: ObservationEvidenceRecord[]
  errors: string[]
  recommendation: { action: string; because: string } | null
  modelRecovery?: {
    sourceRowId: number
    sourceVersion: string
    sourceFingerprint: string
    detectedAt: string
    validationErrors: string[]
    decision: 'force-guarded-recovery'
    replacementRowId: number
    replacementVersion: string
  }
  modelRecoveryFailure?: {
    sourceRowId: number
    sourceVersion: string
    sourceFingerprint: string
    detectedAt: string
    phases: {
      crawlExecution: 'completed'
      authentication: 'succeeded' | 'failed' | 'unknown'
      modelGeneration: 'validated' | 'failed'
      guardedPersistence: 'succeeded' | 'failed' | 'not_attempted'
      compatibilityProjection: 'failed' | 'not_attempted'
    }
    persistenceDiagnostic: {
      stage: string
      causeChain: Array<{ name: string; code: string | null; summary: string }>
      structuralIssues?: Array<{
        path: string
        category: string
        valueType: string
      }>
    }
  }
}

export type ObservationLookup =
  | { kind: 'terminal'; start: ObservationStartRecord; terminal: ObservationTerminalRecord }
  | { kind: 'interrupted'; start: ObservationStartRecord }
  | { kind: 'malformed' }
  | { kind: 'ownership_mismatch' }
  | { kind: 'not_found' }

export type ObservationHistoryState = ObservationTerminalState | 'interrupted'

export interface ObservationHistoryItem {
  observationId: string
  orderingTimestamp: string
  position: 'latest' | 'historical'
  state: ObservationHistoryState
  start: ObservationStartRecord
  terminal: ObservationTerminalRecord | null
}

export type ObservationHistoryLookup =
  | {
      kind: 'ok'
      observations: ObservationHistoryItem[]
      nextCursor: string | null
      previousCursor: string | null
      hasPrevious: boolean
      filteredTotal: number
      projectTotal: number
      requestedObservation: {
        observationId: string
        status: 'on_page' | 'outside_page' | 'outside_filter' | 'not_found'
      } | null
    }
  | { kind: 'malformed' }
  | { kind: 'ownership_mismatch' }
  | { kind: 'invalid_cursor' }
  | { kind: 'invalid_filter' }

type JsonRead =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'value'; value: unknown }

const OBSERVATION_ID = /^[a-zA-Z0-9-]+$/

export const DEFAULT_OBSERVATION_HISTORY_LIMIT = 20
export const MAX_OBSERVATION_HISTORY_LIMIT = 50
const OBSERVATION_HISTORY_ORDER = 'terminal-or-start-desc-id-asc-v1'

interface ObservationHistoryCursor {
  version: 1
  projectId: string
  startedFrom: string | null
  startedThrough: string | null
  ordering: typeof OBSERVATION_HISTORY_ORDER
  afterObservationId: string
}

export interface ObservationHistoryOptions {
  limit?: number
  cursor?: string | null
  startedFrom?: string | null
  startedThrough?: string | null
  requestedObservationId?: string | null
}

function encodeObservationHistoryCursor(cursor: ObservationHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeObservationHistoryCursor(value: string): ObservationHistoryCursor | null {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!isRecord(decoded) || !hasOnlyKeys(decoded, [
      'version', 'projectId', 'startedFrom', 'startedThrough', 'ordering', 'afterObservationId',
    ])) return null
    if (decoded.version !== 1
      || typeof decoded.projectId !== 'string'
      || (decoded.startedFrom !== null && typeof decoded.startedFrom !== 'string')
      || (decoded.startedThrough !== null && typeof decoded.startedThrough !== 'string')
      || decoded.ordering !== OBSERVATION_HISTORY_ORDER
      || typeof decoded.afterObservationId !== 'string'
      || !OBSERVATION_ID.test(decoded.afterObservationId)) return null
    return decoded as unknown as ObservationHistoryCursor
  } catch {
    return null
  }
}

function readJson(file: string): JsonRead {
  if (!fs.existsSync(file)) return { kind: 'missing' }
  try {
    return { kind: 'value', value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown }
  } catch {
    return { kind: 'malformed' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

const AUTHENTICATION_STAGE_NAMES = new Set([
  'credential-reference-resolution',
  'login-surface-detection',
  'username-control-discovery',
  'password-control-discovery',
  'value-entry-completion',
  'submit-control-discovery',
  'submission-attempt',
  'navigation-or-page-state-change',
  'post-submit-login-surface-evaluation',
])

function isAuthenticationStageRecord(value: unknown): value is AuthenticationStageRecord {
  if (!isRecord(value)) return false
  const optionalBooleans = [
    value.controlVisible,
    value.usernameEntryCompleted,
    value.passwordEntryCompleted,
    value.submissionAttempted,
    value.loginSurfaceRetained,
  ]
  const url = value.urlClassification
  return hasOnlyKeys(value, [
    'stage',
    'outcome',
    'selectorStrategyCategory',
    'matchCount',
    'controlVisible',
    'usernameEntryCompleted',
    'passwordEntryCompleted',
    'submissionAttempted',
    'loginSurfaceRetained',
    'urlClassification',
    'safeErrorType',
  ])
    && typeof value.stage === 'string'
    && AUTHENTICATION_STAGE_NAMES.has(value.stage)
    && ['succeeded', 'failed', 'indeterminate', 'not_evaluated', 'not_required'].includes(String(value.outcome))
    && ['configured', 'semantic-fallback', 'not_applicable'].includes(String(value.selectorStrategyCategory))
    && (value.matchCount === undefined || (Number.isSafeInteger(value.matchCount) && Number(value.matchCount) >= 0))
    && optionalBooleans.every(item => item === undefined || typeof item === 'boolean')
    && (value.safeErrorType === undefined || (typeof value.safeErrorType === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.safeErrorType)))
    && (url === undefined || (isRecord(url)
      && hasOnlyKeys(url, ['origin', 'path'])
      && ['same-origin', 'different-origin', 'indeterminate'].includes(String(url.origin))
      && ['same-path', 'different-path', 'indeterminate'].includes(String(url.path))))
}

function isAuthenticationAttemptRecord(value: unknown): value is AuthenticationAttemptRecord {
  return isRecord(value)
    && hasOnlyKeys(value, ['roleId', 'outcome', 'stages'])
    && typeof value.roleId === 'string'
    && ['succeeded', 'failed', 'unknown'].includes(String(value.outcome))
    && Array.isArray(value.stages)
    && value.stages.every(isAuthenticationStageRecord)
}

function isStartRecord(
  value: unknown,
  projectId: string,
  observationId: string,
): value is ObservationStartRecord {
  if (!isRecord(value) || !isRecord(value.observationContext)) return false
  const context = value.observationContext
  return value.schemaVersion === 1
    && value.observationId === observationId
    && value.projectId === projectId
    && typeof value.projectName === 'string'
    && value.sourceKind === 'crawl-engine'
    && typeof value.startedAt === 'string'
    && ['available', 'missing', 'not_required', 'unknown'].includes(String(value.credentialAvailability))
    && typeof value.authenticationExpectation === 'string'
    && hasOnlyKeys(context, ['id', 'label', 'target', 'declaredScope', 'strategy'])
    && context.id === observationId
    && typeof context.label === 'string'
    && typeof context.target === 'string'
    && typeof context.declaredScope === 'string'
    && typeof context.strategy === 'string'
}

const START_KEYS = [
  'schemaVersion',
  'observationId',
  'projectId',
  'projectName',
  'observationContext',
  'sourceKind',
  'startedAt',
  'credentialAvailability',
  'authenticationExpectation',
] as const

function isTerminalEvidence(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.provenance)) return false
  return hasOnlyKeys(value, ['id', 'subject', 'summary', 'capturedAt', 'provenance', 'integrity'])
    && hasOnlyKeys(value.provenance, ['kind', 'reference'])
    && typeof value.id === 'string'
    && typeof value.subject === 'string'
    && typeof value.summary === 'string'
    && typeof value.capturedAt === 'string'
    && value.provenance.kind === 'crawl-run'
    && typeof value.provenance.reference === 'string'
    && ['valid', 'failed', 'unknown'].includes(String(value.integrity))
}

function isModelRecovery(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, [
      'sourceRowId', 'sourceVersion', 'sourceFingerprint', 'detectedAt',
      'validationErrors', 'decision', 'replacementRowId', 'replacementVersion',
    ])
    && Number.isSafeInteger(value.sourceRowId)
    && typeof value.sourceVersion === 'string'
    && typeof value.sourceFingerprint === 'string'
    && typeof value.detectedAt === 'string'
    && isStringArray(value.validationErrors)
    && value.decision === 'force-guarded-recovery'
    && Number.isSafeInteger(value.replacementRowId)
    && typeof value.replacementVersion === 'string'
}

function isModelRecoveryFailure(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.phases) || !isRecord(value.persistenceDiagnostic)) return false
  const phases = value.phases
  const diagnostic = value.persistenceDiagnostic
  const causeChain = diagnostic.causeChain
  const structuralIssues = diagnostic.structuralIssues
  return hasOnlyKeys(value, [
    'sourceRowId', 'sourceVersion', 'sourceFingerprint', 'detectedAt', 'phases', 'persistenceDiagnostic',
  ])
    && Number.isSafeInteger(value.sourceRowId)
    && typeof value.sourceVersion === 'string'
    && typeof value.sourceFingerprint === 'string'
    && typeof value.detectedAt === 'string'
    && hasOnlyKeys(phases, [
      'crawlExecution', 'authentication', 'modelGeneration', 'guardedPersistence', 'compatibilityProjection',
    ])
    && phases.crawlExecution === 'completed'
    && ['succeeded', 'failed', 'unknown'].includes(String(phases.authentication))
    && ['validated', 'failed'].includes(String(phases.modelGeneration))
    && ['succeeded', 'failed', 'not_attempted'].includes(String(phases.guardedPersistence))
    && ['failed', 'not_attempted'].includes(String(phases.compatibilityProjection))
    && hasOnlyKeys(diagnostic, ['stage', 'causeChain', 'structuralIssues'])
    && typeof diagnostic.stage === 'string'
    && Array.isArray(causeChain)
    && causeChain.every(item => isRecord(item)
      && hasOnlyKeys(item, ['name', 'code', 'summary'])
      && typeof item.name === 'string'
      && (item.code === null || typeof item.code === 'string')
      && typeof item.summary === 'string')
    && (structuralIssues === undefined || (Array.isArray(structuralIssues)
      && structuralIssues.every(item => isRecord(item)
        && hasOnlyKeys(item, ['path', 'category', 'valueType'])
        && typeof item.path === 'string'
        && typeof item.category === 'string'
        && typeof item.valueType === 'string')))
}

function isTerminalRecord(
  value: unknown,
  projectId: string,
  observationId: string,
): value is ObservationTerminalRecord {
  if (!isStartRecord(value, projectId, observationId)) return false
  const terminal = value as unknown as Record<string, unknown>
  if (!isRecord(terminal.authentication)) return false
  const authentication = terminal.authentication
  return hasOnlyKeys(terminal, [
    ...START_KEYS,
    'completedAt',
    'terminalState',
    'stateReason',
    'authentication',
    'observedSubjects',
    'unobservedScope',
    'unknowns',
    'blockers',
    'evidence',
    'errors',
    'recommendation',
    'modelRecovery',
    'modelRecoveryFailure',
  ])
    && typeof terminal.completedAt === 'string'
    && ['completed', 'partially_completed', 'blocked', 'failed', 'unknown'].includes(String(terminal.terminalState))
    && typeof terminal.stateReason === 'string'
    && typeof authentication.expectation === 'string'
    && ['available', 'missing', 'not_required', 'unknown'].includes(String(authentication.credentialAvailability))
    && ['succeeded', 'failed', 'not_evaluated', 'not_required'].includes(String(authentication.outcome))
    && typeof authentication.reason === 'string'
    && hasOnlyKeys(authentication, ['expectation', 'credentialAvailability', 'outcome', 'reason', 'attempts'])
    && (authentication.attempts === undefined
      || (Array.isArray(authentication.attempts) && authentication.attempts.every(isAuthenticationAttemptRecord)))
    && Array.isArray(terminal.observedSubjects)
    && terminal.observedSubjects.every(item => isRecord(item)
      && hasOnlyKeys(item, ['id', 'kind', 'value', 'evidenceId'])
      && typeof item.id === 'string'
      && (item.kind === 'page' || item.kind === 'route')
      && typeof item.value === 'string'
      && typeof item.evidenceId === 'string')
    && isStringArray(terminal.unobservedScope)
    && Array.isArray(terminal.unknowns)
    && terminal.unknowns.every(item => isRecord(item)
      && hasOnlyKeys(item, ['id', 'subject', 'reason'])
      && typeof item.id === 'string'
      && typeof item.subject === 'string'
      && typeof item.reason === 'string')
    && Array.isArray(terminal.blockers)
    && terminal.blockers.every(item => isRecord(item)
      && hasOnlyKeys(item, ['id', 'kind', 'subject', 'reason'])
      && typeof item.id === 'string'
      && typeof item.kind === 'string'
      && typeof item.subject === 'string'
      && typeof item.reason === 'string')
    && Array.isArray(terminal.evidence)
    && terminal.evidence.every(isTerminalEvidence)
    && isStringArray(terminal.errors)
    && (terminal.recommendation === null || (isRecord(terminal.recommendation)
      && hasOnlyKeys(terminal.recommendation, ['action', 'because'])
      && typeof terminal.recommendation.action === 'string'
      && typeof terminal.recommendation.because === 'string'))
    && (terminal.modelRecovery === undefined || isModelRecovery(terminal.modelRecovery))
    && (terminal.modelRecoveryFailure === undefined || isModelRecoveryFailure(terminal.modelRecoveryFailure))
}

function sameStartRecord(start: ObservationStartRecord, terminal: ObservationTerminalRecord): boolean {
  return start.schemaVersion === terminal.schemaVersion
    && start.observationId === terminal.observationId
    && start.projectId === terminal.projectId
    && start.projectName === terminal.projectName
    && start.sourceKind === terminal.sourceKind
    && start.startedAt === terminal.startedAt
    && start.credentialAvailability === terminal.credentialAvailability
    && start.authenticationExpectation === terminal.authenticationExpectation
    && JSON.stringify(start.observationContext) === JSON.stringify(terminal.observationContext)
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function hasUniqueStringIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map(item => item.id)).size === items.length
}

function isHistorySafeStart(start: ObservationStartRecord): boolean {
  return isExactIsoTimestamp(start.startedAt)
}

function isHistorySafeTerminal(terminal: ObservationTerminalRecord): boolean {
  if (!isHistorySafeStart(terminal)
    || !isExactIsoTimestamp(terminal.completedAt)
    || terminal.completedAt < terminal.startedAt
    || !terminal.evidence.every(item => isExactIsoTimestamp(item.capturedAt))
    || !hasUniqueStringIds(terminal.observedSubjects)
    || !hasUniqueStringIds(terminal.evidence)
    || !hasUniqueStringIds(terminal.unknowns)
    || !hasUniqueStringIds(terminal.blockers)) {
    return false
  }

  const evidenceIds = new Set(terminal.evidence.map(item => item.id))
  if (!terminal.observedSubjects.every(item => evidenceIds.has(item.evidenceId))
    || !terminal.evidence.every(item => item.provenance.reference === terminal.observationId)) {
    return false
  }

  if (terminal.authentication.attempts?.some(attempt => {
    const stages = attempt.stages.map(item => item.stage)
    return new Set(stages).size !== stages.length
  })) {
    return false
  }

  return (terminal.modelRecovery === undefined || isExactIsoTimestamp(terminal.modelRecovery.detectedAt))
    && (terminal.modelRecoveryFailure === undefined
      || isExactIsoTimestamp(terminal.modelRecoveryFailure.detectedAt))
}

/**
 * Read-only compatibility access to pre-canonical Observation files.
 * Active Product code must use ObservationService and
 * ObservationReadProjectionService instead.
 */
export class ObservationStore {
  constructor(
    private readonly workspaces = workspaceResolver,
    private readonly projects: Pick<ProjectRegistry, 'list'> = projectRegistry,
  ) {}

  get(projectId: string, observationId: string): ObservationTerminalRecord | null {
    const lookup = this.resolve(observationId, projectId)
    return lookup.kind === 'terminal' ? lookup.terminal : null
  }

  /**
   * Resolve immutable observation truth independently of process memory.
   * A terminal pair wins only when both records are structurally valid and own
   * the requested project/observation identity. A valid start without a terminal
   * is interrupted after restart; it is never reconstructed as actively running.
   */
  resolve(observationId: string, expectedProjectId?: string): ObservationLookup {
    if (!OBSERVATION_ID.test(observationId)) return { kind: 'not_found' }
    if (expectedProjectId !== undefined) {
      assertValidAppName(expectedProjectId)
      return this.resolveInProject(expectedProjectId, observationId)
    }

    const matches = this.projects.list()
      .map(project => project.appName)
      .filter((projectId, index, all) => all.indexOf(projectId) === index)
      .map(projectId => this.resolveInProject(projectId, observationId))
      .filter(result => result.kind !== 'not_found')

    if (matches.length === 0) return { kind: 'not_found' }
    if (matches.length > 1) return { kind: 'malformed' }
    return matches[0]
  }

  latest(projectId: string): ObservationTerminalRecord | null {
    assertValidAppName(projectId)
    const root = path.join(this.workspaces.resolve(projectId).forgeDir, 'observations')
    if (!fs.existsSync(root)) return null
    const records = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.resolve(entry.name, projectId))
      .filter((result): result is Extract<ObservationLookup, { kind: 'terminal' }> => result.kind === 'terminal')
      .map(result => result.terminal)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    return records[0] ?? null
  }

  /**
   * Read a bounded, immutable project history. Unlike latest(), collection
   * reads fail closed when any persisted observation directory is malformed,
   * belongs to another project, duplicates an identity, or has invalid time or
   * evidence references. Ordering is newest persisted completion/start time
   * first, with ascending observation ID as the stable tie-breaker.
   */
  history(
    projectId: string,
    options: ObservationHistoryOptions = {},
  ): ObservationHistoryLookup {
    assertValidAppName(projectId)
    const limit = options.limit ?? DEFAULT_OBSERVATION_HISTORY_LIMIT
    const cursor = options.cursor ?? null
    const startedFrom = options.startedFrom ?? null
    const startedThrough = options.startedThrough ?? null
    const requestedObservationId = options.requestedObservationId ?? null
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBSERVATION_HISTORY_LIMIT) {
      return { kind: 'invalid_cursor' }
    }
    if ((startedFrom !== null && !isExactIsoTimestamp(startedFrom))
      || (startedThrough !== null && !isExactIsoTimestamp(startedThrough))
      || (startedFrom !== null && startedThrough !== null && startedFrom > startedThrough)) {
      return { kind: 'invalid_filter' }
    }
    if (requestedObservationId !== null && !OBSERVATION_ID.test(requestedObservationId)) {
      return { kind: 'invalid_filter' }
    }
    const decodedCursor = cursor === null ? null : decodeObservationHistoryCursor(cursor)
    if (cursor !== null && (!decodedCursor
      || decodedCursor.projectId !== projectId
      || decodedCursor.startedFrom !== startedFrom
      || decodedCursor.startedThrough !== startedThrough
      || decodedCursor.ordering !== OBSERVATION_HISTORY_ORDER)) {
      return { kind: 'invalid_cursor' }
    }

    const root = path.join(this.workspaces.resolve(projectId).forgeDir, 'observations')
    if (!fs.existsSync(root)) {
      return cursor === null
        ? {
            kind: 'ok',
            observations: [],
            nextCursor: null,
            previousCursor: null,
            hasPrevious: false,
            filteredTotal: 0,
            projectTotal: 0,
            requestedObservation: requestedObservationId === null
              ? null
              : { observationId: requestedObservationId, status: 'not_found' },
          }
        : { kind: 'invalid_cursor' }
    }

    let directories: string[]
    try {
      directories = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {
      return { kind: 'malformed' }
    }

    const observations: Array<Omit<ObservationHistoryItem, 'position'>> = []
    const identities = new Set<string>()
    for (const observationId of directories) {
      if (!OBSERVATION_ID.test(observationId) || identities.has(observationId)) {
        return { kind: 'malformed' }
      }
      const resolved = this.resolveInProject(projectId, observationId)
      if (resolved.kind === 'ownership_mismatch') return { kind: 'ownership_mismatch' }
      if (resolved.kind === 'malformed' || resolved.kind === 'not_found') return { kind: 'malformed' }
      if (!isHistorySafeStart(resolved.start)) return { kind: 'malformed' }
      if (resolved.kind === 'terminal' && !isHistorySafeTerminal(resolved.terminal)) {
        return { kind: 'malformed' }
      }

      identities.add(observationId)
      observations.push({
        observationId,
        orderingTimestamp: resolved.kind === 'terminal'
          ? resolved.terminal.completedAt
          : resolved.start.startedAt,
        state: resolved.kind === 'terminal' ? resolved.terminal.terminalState : 'interrupted',
        start: resolved.start,
        terminal: resolved.kind === 'terminal' ? resolved.terminal : null,
      })
    }

    observations.sort((left, right) => {
      const byTimestamp = right.orderingTimestamp.localeCompare(left.orderingTimestamp)
      return byTimestamp !== 0 ? byTimestamp : left.observationId.localeCompare(right.observationId)
    })

    const positioned: ObservationHistoryItem[] = observations.map((item, index) => ({
      ...item,
      position: index === 0 ? 'latest' : 'historical',
    }))
    const filtered = positioned.filter(item => (
      (startedFrom === null || item.start.startedAt >= startedFrom)
      && (startedThrough === null || item.start.startedAt <= startedThrough)
    ))
    const startIndex = decodedCursor === null
      ? 0
      : filtered.findIndex(item => item.observationId === decodedCursor.afterObservationId) + 1
    if (decodedCursor !== null && startIndex === 0) return { kind: 'invalid_cursor' }

    const page = filtered.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + page.length < filtered.length
    const previousStartIndex = Math.max(0, startIndex - limit)
    const previousCursor = startIndex === 0 || previousStartIndex === 0
      ? null
      : encodeObservationHistoryCursor({
          version: 1,
          projectId,
          startedFrom,
          startedThrough,
          ordering: OBSERVATION_HISTORY_ORDER,
          afterObservationId: filtered[previousStartIndex - 1].observationId,
        })
    const requested = requestedObservationId === null
      ? null
      : (() => {
          const inProject = positioned.some(item => item.observationId === requestedObservationId)
          const inFilter = filtered.some(item => item.observationId === requestedObservationId)
          const onPage = page.some(item => item.observationId === requestedObservationId)
          return {
            observationId: requestedObservationId,
            status: !inProject
              ? 'not_found' as const
              : !inFilter
                ? 'outside_filter' as const
                : onPage
                  ? 'on_page' as const
                  : 'outside_page' as const,
          }
        })()
    return {
      kind: 'ok',
      observations: page,
      nextCursor: hasMore && page.length > 0
        ? encodeObservationHistoryCursor({
            version: 1,
            projectId,
            startedFrom,
            startedThrough,
            ordering: OBSERVATION_HISTORY_ORDER,
            afterObservationId: page[page.length - 1].observationId,
          })
        : null,
      previousCursor,
      hasPrevious: startIndex > 0,
      filteredTotal: filtered.length,
      projectTotal: positioned.length,
      requestedObservation: requested,
    }
  }

  private resolveInProject(projectId: string, observationId: string): ObservationLookup {
    const dir = this.runDir(this.workspaces.resolve(projectId), observationId)
    if (!fs.existsSync(dir)) return { kind: 'not_found' }

    const started = readJson(path.join(dir, 'started.json'))
    const terminal = readJson(path.join(dir, 'terminal.json'))
    if (started.kind === 'malformed' || terminal.kind === 'malformed') return { kind: 'malformed' }
    if (started.kind !== 'value') return terminal.kind === 'missing' ? { kind: 'not_found' } : { kind: 'malformed' }
    if (!isStartRecord(started.value, projectId, observationId)) return { kind: 'ownership_mismatch' }
    if (!hasOnlyKeys(started.value as unknown as Record<string, unknown>, START_KEYS)) return { kind: 'malformed' }
    if (terminal.kind === 'missing') return { kind: 'interrupted', start: started.value }
    if (!isStartRecord(terminal.value, projectId, observationId)) return { kind: 'ownership_mismatch' }
    if (!isTerminalRecord(terminal.value, projectId, observationId)) return { kind: 'malformed' }
    if (!sameStartRecord(started.value, terminal.value)) return { kind: 'malformed' }
    return { kind: 'terminal', start: started.value, terminal: terminal.value }
  }

  private runDir(workspace: ResolvedWorkspace, observationId: string): string {
    return path.join(workspace.forgeDir, 'observations', observationId)
  }
}

export const observationStore = new ObservationStore()
