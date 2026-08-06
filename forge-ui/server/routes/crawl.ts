/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { Router } from 'express'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { ok, fail } from '../http'
import { jobRunner, ObservationStatusReadError } from '../jobs/JobRunner'
import { workspaceResolver } from '../context/WorkspaceResolver'
import { isValidAppName } from '../context/appName'
import { projectRegistry } from '../registry/ProjectRegistry'
import { executionContext } from '../context/ExecutionContext'
import { credentialStore, CredentialStore } from '../context/credentials/CredentialStore'
import {
  DEFAULT_OBSERVATION_HISTORY_LIMIT,
  MAX_OBSERVATION_HISTORY_LIMIT,
  observationStore,
  type AuthenticationOutcome,
  type AuthenticationAttemptRecord,
  type AuthenticationStageRecord,
  type ObservationStartRecord,
  type ObservationTerminalRecord,
  type ObservationTerminalState,
} from '../registry/ObservationStore'
import { projectObservationHistoryItem } from '../registry/ObservationHistoryPresenter'
import { checkReachability } from './validate'

/**
 * TD-UI-002 Crawl tab (ADR-012, Phase 1 — polling).
 *  POST /api/v1/crawl               → 202 { jobId } (fires async, returns at once)
 *  GET  /api/v1/crawl/:jobId/status → Mission Timeline (live log lines) + strategy
 *                                     + structured pages (post-completion, from
 *                                     the SQLite App Model). Client polls every 1s.
 */
const router = Router()

/** Engine crawl mode → user-friendly label (ADR-012). Raw term kept for tooltip. */
const STRATEGY_LABELS: Record<string, string> = {
  bfs:    'Link Following',
  spa:    'Click Discovery',
  hybrid: 'Hybrid Exploration',
  auto:   'Auto-detected',
}

export interface DiscoveredPage {
  id:               string
  url:              string          // app.baseUrl + urlPattern (audit ruling)
  urlPattern:       string
  module:           string          // page.module?.name ?? 'Unknown'
  moduleConfidence: string | null
  moduleReason:     string | null   // ADR-020 §6: the evidence behind the confidence grade
  elements:         number          // page.elements?.length ?? 0
  roles:            string[]        // page.accessibleByRoles ?? []
  // depth: omitted — not present in the SQLite App Model (audit)
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

/** Resolve the app's start URL (CrawlRunner requires it): registry, then config. */
function resolveUrl(appName: string): string | undefined {
  const fromRegistry = projectRegistry.find(appName)?.url
  if (fromRegistry) return fromRegistry
  const ws = workspaceResolver.resolve(appName)
  return readJson(path.join(ws.forgeDir, 'config.json'))?.url
}

/** Pure map: a SQLite-backed App Model → table rows (audit ruling; no depth). */
export function mapModelPages(model: any): DiscoveredPage[] {
  if (!Array.isArray(model?.pages)) return []
  const baseUrl: string = model.app?.baseUrl ?? ''
  return model.pages.map((p: any): DiscoveredPage => ({
    id:               p.id ?? '',
    url:              baseUrl + (p.urlPattern ?? ''),
    urlPattern:       p.urlPattern ?? '',
    module:           p.module?.name ?? 'Unknown',
    moduleConfidence: p.module?.confidence ?? null,
    moduleReason:     p.module?.reason ?? null,
    elements:         Array.isArray(p.elements) ? p.elements.length : 0,
    roles:            Array.isArray(p.accessibleByRoles) ? p.accessibleByRoles : [],
  }))
}

/** Preserve API route subjects when the App Model is endpoint-backed. */
export function mapModelSubjects(model: any): DiscoveredPage[] {
  const pages = mapModelPages(model)
  const baseUrl: string = model?.app?.baseUrl ?? ''
  const endpoints = Array.isArray(model?.endpoints)
    ? model.endpoints.map((endpoint: any): DiscoveredPage => ({
        id: endpoint.id ?? '',
        url: `${baseUrl}${endpoint.path ?? endpoint.urlPattern ?? ''}`,
        urlPattern: endpoint.path ?? endpoint.urlPattern ?? '',
        module: endpoint.module?.name ?? 'Unknown',
        moduleConfidence: endpoint.module?.confidence ?? null,
        moduleReason: endpoint.module?.reason ?? null,
        elements: 0,
        roles: [],
      }))
    : []
  return [...pages, ...endpoints]
}

/** A crawl diagnostic from the SQLite App Model (TD-UI-064). Structural mirror of the engine's
 *  CrawlDiagnostic (src/core/onboarding/types.ts) — redeclared, never imported (forge-ui →
 *  src is one-directional). `reason` is left open (string) so an unknown/future reason
 *  passes through and degrades honestly rather than being dropped. */
export interface CrawlDiagnostic {
  scope:   'start-page' | 'role' | 'page'
  target:  string
  reason:  string
  detail:  string
  remedy?: { tier: number; action: string }
  loginSurfaceObservation?: {
    check:        'login-surface-observation'
    observations: { signal: string; observation: string; mechanism: string; observationBoundary: string }[]
    note:         string
  }
}

/** Pure map: a SQLite-backed App Model → crawl diagnostics (TD-UI-064). Field selection only,
 *  NO business logic — reads .app.crawlMetadata.crawlDiagnostics and passes the engine's
 *  structured observation payload through VERBATIM (the UI renders it, never authors it).
 *  null crawlMetadata (unsupported-platform) or null crawlDiagnostics (clean crawl) → []. */
export function mapModelDiagnostics(model: any): CrawlDiagnostic[] {
  const diags = model?.app?.crawlMetadata?.crawlDiagnostics
  return Array.isArray(diags) ? diags : []
}

/** Parse the engine crawl mode from a '… | Mode: <mode> | …' log line. */
export function parseStrategy(lines: string[]): { raw: string | null; label: string | null } {
  let raw: string | null = null
  for (const l of lines) {
    // Matches BOTH '[StrategyDetector] Mode: bfs | …' and
    // '[FORGE Crawler] Role: … | Mode: bfs | …' (Issue #3). Constrained to the
    // real modes so a stray 'Mode:' line can't set a bogus strategy.
    const m = l.match(/Mode:\s*(bfs|spa|hybrid)\b/)
    if (m) raw = m[1]   // last match wins (multi-role, last-wins ruling)
  }
  return { raw, label: raw ? (STRATEGY_LABELS[raw] ?? raw) : null }
}

const DISCOVERED = /\[FORGE Crawler\] Discovered:/

/** Count the per-page '[FORGE Crawler] Discovered:' lines (live page counter). */
export function countDiscovered(lines: string[]): number {
  return lines.filter(l => DISCOVERED.test(l)).length
}

type CrawlProjectContext = {
  projectId: string
  projectName: string
  targetUrl: string
  observationBoundary: string
  authenticationExpectation: string
  credentialAvailability: ObservationStartRecord['credentialAvailability']
  credentialReferenceState: 'recorded' | 'default-derived' | 'not-required'
  credentialResolver: 'backend-environment'
  credentialRestoration: string | null
  crawlStrategy: string
  declaredScope: string
  canEstablish: string[]
  cannotEstablish: string[]
  blockers: string[]
}

export type ObservationHistoryQuery =
  | {
      ok: true
      limit: number
      cursor: string | null
      startedFrom: string | null
      startedThrough: string | null
      requestedObservationId: string | null
    }
  | {
      ok: false
      message: string
      code:
        | 'INVALID_OBSERVATION_HISTORY_LIMIT'
        | 'INVALID_OBSERVATION_HISTORY_CURSOR'
        | 'INVALID_OBSERVATION_HISTORY_DATE'
        | 'INVALID_OBSERVATION_HISTORY_RANGE'
        | 'INVALID_OBSERVATION_ID'
    }

const HISTORY_CURSOR = /^[A-Za-z0-9_-]{1,1024}$/
const HISTORY_OBSERVATION_ID = /^[A-Za-z0-9-]+$/

function isExactIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

export function parseObservationHistoryQuery(query: Record<string, unknown>): ObservationHistoryQuery {
  const rawLimit = query.limit
  const rawCursor = query.cursor
  const rawStartedFrom = query.startedFrom
  const rawStartedThrough = query.startedThrough
  const rawObservation = query.observation
  if (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^[1-9][0-9]*$/.test(rawLimit))) {
    return {
      ok: false,
      message: `limit must be an integer from 1 through ${MAX_OBSERVATION_HISTORY_LIMIT}.`,
      code: 'INVALID_OBSERVATION_HISTORY_LIMIT',
    }
  }
  const limit = rawLimit === undefined ? DEFAULT_OBSERVATION_HISTORY_LIMIT : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBSERVATION_HISTORY_LIMIT) {
    return {
      ok: false,
      message: `limit must be an integer from 1 through ${MAX_OBSERVATION_HISTORY_LIMIT}.`,
      code: 'INVALID_OBSERVATION_HISTORY_LIMIT',
    }
  }
  if (rawCursor !== undefined && (typeof rawCursor !== 'string' || !HISTORY_CURSOR.test(rawCursor))) {
    return {
      ok: false,
      message: 'cursor must be a previously returned cursor for this project and filter.',
      code: 'INVALID_OBSERVATION_HISTORY_CURSOR',
    }
  }
  for (const [name, value] of [
    ['startedFrom', rawStartedFrom],
    ['startedThrough', rawStartedThrough],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || !isExactIsoTimestamp(value))) {
      return {
        ok: false,
        message: `${name} must be an exact ISO-8601 timestamp.`,
        code: 'INVALID_OBSERVATION_HISTORY_DATE',
      }
    }
  }
  if (typeof rawStartedFrom === 'string'
    && typeof rawStartedThrough === 'string'
    && rawStartedFrom > rawStartedThrough) {
    return {
      ok: false,
      message: 'startedFrom must not be later than startedThrough.',
      code: 'INVALID_OBSERVATION_HISTORY_RANGE',
    }
  }
  if (rawObservation !== undefined
    && (typeof rawObservation !== 'string' || !HISTORY_OBSERVATION_ID.test(rawObservation))) {
    return {
      ok: false,
      message: 'observation must be a valid observation identifier.',
      code: 'INVALID_OBSERVATION_ID',
    }
  }
  return {
    ok: true,
    limit,
    cursor: typeof rawCursor === 'string' ? rawCursor : null,
    startedFrom: typeof rawStartedFrom === 'string' ? rawStartedFrom : null,
    startedThrough: typeof rawStartedThrough === 'string' ? rawStartedThrough : null,
    requestedObservationId: typeof rawObservation === 'string' ? rawObservation : null,
  }
}

const observationStarts = new Map<string, ObservationStartRecord>()
const observationFinalizations = new Map<string, Promise<void>>()
const observationFinalizationErrors = new Map<string, string>()
// Covers the asynchronous reachability/pre-persistence window before JobRunner
// can publish its active-job index. Without this reservation, concurrent starts
// can both pass getActiveJob() and create separate observations for one project.
const observationStartReservations = new Set<string>()

function projectContext(appName: string): CrawlProjectContext | null {
  const url = resolveUrl(appName)
  if (!url) return null
  const ws = workspaceResolver.resolve(appName)
  const config = readJson(path.join(ws.forgeDir, 'config.json')) ?? {}
  const authenticationExpectation = typeof config.authType === 'string' ? config.authType : 'unknown'
  const recordedReference = credentialStore.read(appName)
  const reference = recordedReference ?? CredentialStore.defaultReference(appName)
  const referencePairAvailable = !!process.env[reference.usernameEnv] && !!process.env[reference.passwordEnv]
  const credentialAvailability: ObservationStartRecord['credentialAvailability'] =
    authenticationExpectation === 'none'
      ? 'not_required'
      : referencePairAvailable
        ? 'available'
        : authenticationExpectation === 'unknown'
          ? 'unknown'
          : 'missing'
  const blockers = credentialAvailability === 'missing'
    ? ['Authentication is expected and a credential reference exists, but its environment-variable pair cannot currently be resolved by the backend. Configure both variables named in the local project credential sidecar for the backend service account, then restart the backend and verify this state before retrying.']
    : credentialAvailability === 'available' && authenticationExpectation !== 'none' && !config.credentials?.envKey
      ? ['Credentials are available, but authenticated bootstrap has not established an engine credential slot. Enable Force re-crawl for the next observation.']
      : []
  return {
    projectId: appName,
    projectName: appName,
    targetUrl: url,
    observationBoundary: `Target ${url}; only subjects reached by this run and observation context can be claimed.`,
    authenticationExpectation,
    credentialAvailability,
    credentialReferenceState: authenticationExpectation === 'none'
      ? 'not-required'
      : recordedReference
        ? 'recorded'
        : 'default-derived',
    credentialResolver: 'backend-environment',
    credentialRestoration: credentialAvailability === 'missing'
      ? 'Configure both environment variables named by the local project credential sidecar in the backend service environment, restart the backend, and confirm Credentials available before starting an observation.'
      : null,
    crawlStrategy: typeof config.crawlStrategy === 'string' && config.crawlStrategy
      ? config.crawlStrategy
      : 'auto',
    declaredScope: 'Reachable pages and routes from the persisted target within the configured access context and crawl budget.',
    canEstablish: [
      'Which pages or routes were directly reached during this run.',
      'Authentication outcome only when the engine records an explicit outcome.',
      'Run-scoped diagnostics, blockers, and provenance.',
    ],
    cannotEstablish: [
      'Complete application coverage.',
      'Health of unobserved application areas.',
      'Authentication success from credential presence or a login form alone.',
    ],
    blockers,
  }
}

export function authenticationOutcome(
  model: any,
  start: ObservationStartRecord,
  diagnostics: CrawlDiagnostic[],
): { outcome: AuthenticationOutcome; reason: string } {
  if (start.authenticationExpectation === 'none') {
    return { outcome: 'not_required', reason: 'The persisted project configuration does not require authentication.' }
  }
  const outcomes = Array.isArray(model?.roles)
    ? model.roles.map((role: any) => role?.authOutcome).filter((value: unknown) => typeof value === 'string')
    : []
  if (outcomes.includes('failed') || diagnostics.some(item => item.reason === 'auth-failed')) {
    return { outcome: 'failed', reason: 'The crawl producer recorded an authentication failure.' }
  }
  if (outcomes.includes('succeeded')) {
    return { outcome: 'succeeded', reason: 'The crawl producer recorded an explicit successful authentication outcome.' }
  }
  if (start.credentialAvailability === 'missing') {
    return { outcome: 'not_evaluated', reason: 'Authentication was not evaluated because required credentials were unavailable.' }
  }
  return { outcome: 'not_evaluated', reason: 'No explicit authentication outcome was present in the crawl result.' }
}

const AUTH_STAGE_NAMES = new Set<AuthenticationStageRecord['stage']>([
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

/** Strictly select the safe authentication trace from the validated model. */
export function authenticationAttempts(model: any): AuthenticationAttemptRecord[] {
  if (!Array.isArray(model?.roles)) return []
  return model.roles.flatMap((role: any): AuthenticationAttemptRecord[] => {
    if (typeof role?.id !== 'string' || !Array.isArray(role?.authenticationStages)) return []
    const stages = role.authenticationStages.flatMap((stage: any): AuthenticationStageRecord[] => {
      if (
        !stage || typeof stage !== 'object'
        || !AUTH_STAGE_NAMES.has(stage.stage)
        || !['succeeded', 'failed', 'indeterminate', 'not_evaluated', 'not_required'].includes(stage.outcome)
        || !['configured', 'semantic-fallback', 'not_applicable'].includes(stage.selectorStrategyCategory)
      ) return []
      const urlClassification = stage.urlClassification
        && ['same-origin', 'different-origin', 'indeterminate'].includes(stage.urlClassification.origin)
        && ['same-path', 'different-path', 'indeterminate'].includes(stage.urlClassification.path)
          ? {
              origin: stage.urlClassification.origin,
              path: stage.urlClassification.path,
            } as NonNullable<AuthenticationStageRecord['urlClassification']>
          : undefined
      return [{
        stage: stage.stage,
        outcome: stage.outcome,
        selectorStrategyCategory: stage.selectorStrategyCategory,
        ...(Number.isSafeInteger(stage.matchCount) && stage.matchCount >= 0 ? { matchCount: stage.matchCount } : {}),
        ...(typeof stage.controlVisible === 'boolean' ? { controlVisible: stage.controlVisible } : {}),
        ...(typeof stage.usernameEntryCompleted === 'boolean' ? { usernameEntryCompleted: stage.usernameEntryCompleted } : {}),
        ...(typeof stage.passwordEntryCompleted === 'boolean' ? { passwordEntryCompleted: stage.passwordEntryCompleted } : {}),
        ...(typeof stage.submissionAttempted === 'boolean' ? { submissionAttempted: stage.submissionAttempted } : {}),
        ...(typeof stage.loginSurfaceRetained === 'boolean' ? { loginSurfaceRetained: stage.loginSurfaceRetained } : {}),
        ...(urlClassification ? { urlClassification } : {}),
        ...(typeof stage.safeErrorType === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(stage.safeErrorType)
          ? { safeErrorType: stage.safeErrorType }
          : {}),
      }]
    })
    return [{
      roleId: role.id,
      outcome: role.authOutcome === 'succeeded' || role.authOutcome === 'failed' ? role.authOutcome : 'unknown',
      stages,
    }]
  })
}

export function authenticationFailureRecommendation(
  attempts: AuthenticationAttemptRecord[],
): { action: string; because: string } {
  const retained = attempts.some(attempt => attempt.stages.some(stage =>
    stage.stage === 'post-submit-login-surface-evaluation'
      && stage.outcome === 'failed'
      && stage.loginSurfaceRetained === true,
  ))
  if (retained) {
    return {
      action: 'Review target-side authentication acceptance evidence before another observation',
      because: 'Credential references resolved, form controls were discovered, values were entered, and submission was attempted, but the login surface remained. This does not establish that credentials were incorrect.',
    }
  }
  return {
    action: 'Review the deepest failed authentication stage before another observation',
    because: 'Credential resolution and target acceptance are independent; use the recorded stage outcome without assuming credential correctness.',
  }
}

export function classifyTerminalState(
  pages: DiscoveredPage[],
  diagnostics: CrawlDiagnostic[],
  failed: boolean,
  error: string | undefined,
  recoveryFailure?: EngineRecoveryFailure,
): { state: ObservationTerminalState; reason: string } {
  if (failed) {
    if (recoveryFailure) {
      const phases = recoveryFailure.phases
      if (phases.modelGeneration === 'failed') {
        return {
          state: 'failed',
          reason: `Crawl execution completed and authentication was ${phases.authentication}, but replacement model generation did not validate. Guarded persistence was not attempted.`,
        }
      }
      if (phases.guardedPersistence === 'failed') {
        return {
          state: 'failed',
          reason: `Crawl execution completed, authentication was ${phases.authentication}, and the replacement model validated; guarded persistence then failed at stage '${recoveryFailure.persistenceDiagnostic.stage}'. The transaction preserved the original active row and activated no replacement.`,
        }
      }
      return {
        state: 'failed',
        reason: `Crawl execution completed, authentication was ${phases.authentication}, replacement validation completed, and guarded persistence succeeded; compatibility projection then failed. SQLite remains authoritative.`,
      }
    }
    if (isModelCompatibilityError(error)) {
      return {
        state: 'blocked',
        reason: 'The existing Application Model is incompatible with the current schema. It was preserved, and FORGE could not use it to begin this observation.',
      }
    }
    const blocked = /credential|authentication|required|unreachable|cannot reach/i.test(error ?? '')
    return blocked
      ? { state: 'blocked', reason: error ?? 'The observation was blocked before completion.' }
      : { state: 'failed', reason: error ?? 'The crawl engine failed.' }
  }
  const accessLimited = diagnostics.some(item =>
    item.reason === 'auth-required' || item.reason === 'auth-failed' || item.reason === 'page-load-failed',
  )
  if (accessLimited && pages.length === 0) {
    return { state: 'blocked', reason: 'Access or page-load diagnostics prevented any observed page evidence.' }
  }
  if (diagnostics.length > 0) {
    return { state: 'partially_completed', reason: 'The run produced evidence with explicit diagnostics or access limitations.' }
  }
  if (pages.length === 0) {
    return { state: 'unknown', reason: 'The engine completed without page evidence, so a successful observation cannot be asserted.' }
  }
  return {
    state: 'completed',
    reason: 'The crawl engine completed and persisted page evidence. This does not establish complete application coverage.',
  }
}

export function isModelCompatibilityError(error: string | null | undefined): boolean {
  return /schema-invalid model_json|malformed model_json|failed schema validation/i.test(error ?? '')
}

type EngineRecoveryResult = NonNullable<ObservationTerminalRecord['modelRecovery']>

type EngineRecoveryFailure = NonNullable<ObservationTerminalRecord['modelRecoveryFailure']> & {
  kind: 'guarded-app-model-recovery-failed'
  capturedAt: string
  observedSubjects: Array<{ id: string; kind: 'page' | 'route'; value: string }>
  crawlDiagnostics: CrawlDiagnostic[]
  roleAuthOutcomes: Array<{
    roleId: string
    outcome: 'succeeded' | 'failed' | 'unknown'
  }>
}

function readEngineRecoveryResult(result: unknown): EngineRecoveryResult | undefined {
  if (!result || typeof result !== 'object') return undefined
  const recovery = (result as { appModelRecovery?: unknown }).appModelRecovery
  if (!recovery || typeof recovery !== 'object') return undefined
  const value = recovery as Record<string, unknown>
  if (
    !Number.isSafeInteger(value.sourceRowId)
    || typeof value.sourceVersion !== 'string'
    || typeof value.sourceFingerprint !== 'string'
    || typeof value.detectedAt !== 'string'
    || !Array.isArray(value.validationErrors)
    || !value.validationErrors.every(item => typeof item === 'string')
    || value.decision !== 'force-guarded-recovery'
    || !Number.isSafeInteger(value.replacementRowId)
    || typeof value.replacementVersion !== 'string'
  ) return undefined
  return value as unknown as EngineRecoveryResult
}

export function readEngineRecoveryFailure(result: unknown): EngineRecoveryFailure | undefined {
  if (!result || typeof result !== 'object') return undefined
  const value = result as Record<string, any>
  if (
    value.kind !== 'guarded-app-model-recovery-failed'
    || !Number.isSafeInteger(value.sourceRowId)
    || typeof value.sourceVersion !== 'string'
    || typeof value.sourceFingerprint !== 'string'
    || typeof value.detectedAt !== 'string'
    || typeof value.capturedAt !== 'string'
    || !Array.isArray(value.observedSubjects)
    || !Array.isArray(value.crawlDiagnostics)
    || !Array.isArray(value.roleAuthOutcomes)
    || !value.phases || typeof value.phases !== 'object'
    || !value.persistenceDiagnostic || typeof value.persistenceDiagnostic !== 'object'
    || typeof value.persistenceDiagnostic.stage !== 'string'
    || !Array.isArray(value.persistenceDiagnostic.causeChain)
  ) return undefined
  const safeCauseSummary = (summary: unknown): string => {
    if (summary === "Canonical JSON cannot contain a value of type 'undefined'.") return summary
    if (typeof summary === 'string' && /^(UNIQUE|NOT NULL|FOREIGN KEY|CHECK) constraint failed(?:: [A-Za-z0-9_., ()-]+)?$/i.test(summary)) return summary
    if (summary === 'SQLite rejected the operation; arbitrary driver detail was withheld.') return summary
    if (summary === 'SQLite could not serialize the operation because the database was busy or locked.') return summary
    return 'Cause detail was withheld.'
  }
  const structuralCategories = new Set([
    'omitted-optional-object-property',
    'undefined-required-property',
    'undefined-array-entry',
    'unsupported-runtime-value',
    'schema-validation',
  ])
  const structuralValueTypes = new Set([
    'undefined', 'function', 'symbol', 'bigint', 'non-finite-number',
    'unsupported-object', 'circular-reference', 'accessor-property',
    'non-enumerable-property', 'symbol-key', 'schema-invalid',
  ])
  const safeStructuralIssues = Array.isArray(value.persistenceDiagnostic.structuralIssues)
    ? value.persistenceDiagnostic.structuralIssues
      .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
      .slice(0, 128)
      .map((item: Record<string, unknown>) => ({
        path: typeof item.path === 'string' && /^\/(?:[^\r\n]*)$/.test(item.path)
          ? item.path
          : '/',
        category: typeof item.category === 'string' && structuralCategories.has(item.category)
          ? item.category
          : 'schema-validation',
        valueType: typeof item.valueType === 'string' && structuralValueTypes.has(item.valueType)
          ? item.valueType
          : 'schema-invalid',
      }))
    : []
  return {
    kind: value.kind,
    sourceRowId: value.sourceRowId,
    sourceVersion: value.sourceVersion,
    sourceFingerprint: value.sourceFingerprint,
    detectedAt: value.detectedAt,
    capturedAt: value.capturedAt,
    observedSubjects: value.observedSubjects.map((item: Record<string, unknown>) => ({
      id: typeof item.id === 'string' ? item.id : '',
      kind: item.kind === 'route' ? 'route' as const : 'page' as const,
      value: typeof item.value === 'string' ? item.value : '',
    })),
    crawlDiagnostics: value.crawlDiagnostics.map((item: Record<string, unknown>) => ({
      scope: item.scope === 'start-page' || item.scope === 'role' ? item.scope : 'page',
      target: typeof item.target === 'string' ? item.target : '',
      reason: typeof item.reason === 'string' ? item.reason : 'navigation-error',
      detail: typeof item.detail === 'string' ? item.detail : 'No detail was recorded.',
    })),
    roleAuthOutcomes: value.roleAuthOutcomes.map((item: Record<string, unknown>) => ({
      roleId: typeof item.roleId === 'string' ? item.roleId : '',
      outcome: item.outcome === 'succeeded' || item.outcome === 'failed'
        ? item.outcome
        : 'unknown',
    })),
    phases: {
      crawlExecution: 'completed',
      authentication: value.phases.authentication === 'succeeded' || value.phases.authentication === 'failed'
        ? value.phases.authentication
        : 'unknown',
      modelGeneration: value.phases.modelGeneration === 'validated' ? 'validated' : 'failed',
      guardedPersistence: value.phases.guardedPersistence === 'succeeded' || value.phases.guardedPersistence === 'failed'
        ? value.phases.guardedPersistence
        : 'not_attempted',
      compatibilityProjection: value.phases.compatibilityProjection === 'failed'
        ? 'failed'
        : 'not_attempted',
    },
    persistenceDiagnostic: {
      stage: /^[a-z][a-z-]+$/.test(value.persistenceDiagnostic.stage)
        ? value.persistenceDiagnostic.stage
        : 'service-boundary',
      causeChain: value.persistenceDiagnostic.causeChain.slice(0, 8).map((item: Record<string, unknown>) => ({
        name: typeof item.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(item.name)
          ? item.name
          : 'Error',
        code: typeof item.code === 'string' && /^SQLITE_[A-Z0-9_]+$/.test(item.code)
          ? item.code
          : null,
        summary: safeCauseSummary(item.summary),
      })),
      ...(safeStructuralIssues.length > 0 ? { structuralIssues: safeStructuralIssues } : {}),
    },
  }
}

function recoveryAuthenticationOutcome(
  failure: EngineRecoveryFailure,
  start: ObservationStartRecord,
): { outcome: AuthenticationOutcome; reason: string } {
  if (start.authenticationExpectation === 'none') {
    return { outcome: 'not_required', reason: 'The persisted project configuration does not require authentication.' }
  }
  if (failure.phases.authentication === 'succeeded') {
    return { outcome: 'succeeded', reason: 'The recovery crawl recorded an explicit successful authentication outcome before persistence failed.' }
  }
  if (failure.phases.authentication === 'failed') {
    return { outcome: 'failed', reason: 'The recovery crawl recorded an authentication failure before the later terminal outcome.' }
  }
  return { outcome: 'not_evaluated', reason: 'The recovery crawl did not record a conclusive authentication outcome.' }
}

export function formatRecoveryPersistenceDiagnostic(failure: EngineRecoveryFailure): string {
  const causes = failure.persistenceDiagnostic.causeChain
    .map(item => `${item.name}${item.code ? ` (${item.code})` : ''}: ${item.summary}`)
    .join(' <- ')
  const structures = failure.persistenceDiagnostic.structuralIssues
    ?.map(item => `${item.path} (${item.category}, ${item.valueType})`)
    .join('; ')
  return `Guarded persistence stage '${failure.persistenceDiagnostic.stage}'` +
    `${causes ? `: ${causes}` : '.'}` +
    `${structures ? ` Non-canonical structures: ${structures}.` : ''}`
}

export function recoveryFailureRecommendation(): { action: string; because: string } {
  return {
    action: 'Review the guarded persistence diagnostic before another recovery attempt',
    because: 'Authentication and crawl evidence may exist even though replacement activation failed. Correct or explain the recorded persistence stage before initiating another Force re-crawl.',
  }
}

async function finalizeObservation(observationId: string): Promise<void> {
  const start = observationStarts.get(observationId)
  const view = jobRunner.getStatus(observationId)
  if (!start || !view) throw new Error('Observation finalization context is unavailable.')
  const recoveryFailure = readEngineRecoveryFailure(view.failure)

  let model: any = null
  let malformed = false
  let modelError: string | null = null
  if (view.status === 'completed') {
    try {
      model = await executionContext.readAppModel(view.appName)
      malformed = !model?.app || (!Array.isArray(model?.pages) && !Array.isArray(model?.endpoints))
      if (malformed) modelError = 'The crawl engine produced a malformed App Model result.'
    } catch (err) {
      modelError = `The persisted App Model could not be read: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const pages = recoveryFailure
    ? recoveryFailure.observedSubjects.map(subject => ({
        id: subject.id,
        url: subject.value,
        urlPattern: subject.value,
        module: 'Unknown',
        moduleConfidence: null,
        moduleReason: null,
        elements: 0,
        roles: [],
      }))
    : malformed || modelError ? [] : mapModelSubjects(model)
  const diagnostics = recoveryFailure
    ? recoveryFailure.crawlDiagnostics
    : malformed || modelError ? [] : mapModelDiagnostics(model)
  const auth = recoveryFailure
    ? recoveryAuthenticationOutcome(recoveryFailure, start)
    : authenticationOutcome(model, start, diagnostics)
  const authAttempts = recoveryFailure ? [] : authenticationAttempts(model)
  const modelCompatibilityFailure = !recoveryFailure && (isModelCompatibilityError(view.error)
    || isModelCompatibilityError(modelError)
  )
  const modelRecovery = readEngineRecoveryResult(view.result)
  const modelRecoveryFailure = recoveryFailure
    ? {
        sourceRowId: recoveryFailure.sourceRowId,
        sourceVersion: recoveryFailure.sourceVersion,
        sourceFingerprint: recoveryFailure.sourceFingerprint,
        detectedAt: recoveryFailure.detectedAt,
        phases: recoveryFailure.phases,
        persistenceDiagnostic: recoveryFailure.persistenceDiagnostic,
      }
    : undefined
  const classified = modelError
    ? modelCompatibilityFailure
      ? {
          state: 'blocked' as const,
          reason: 'The resulting Application Model did not pass current-schema validation. No replacement model or observation evidence was activated.',
        }
      : { state: 'failed' as const, reason: modelError }
    : classifyTerminalState(
        pages,
        diagnostics,
        view.status === 'failed',
        view.error,
        recoveryFailure,
      )
  const completedAt = view.completedAt ?? new Date().toISOString()
  const capturedAt = recoveryFailure?.capturedAt
    ?? model?.app?.crawlMetadata?.crawledAt
    ?? completedAt
  const evidence = pages.map((page, index) => ({
    id: `${observationId}-page-${index + 1}`,
    subject: page.urlPattern || page.url,
    summary: `Page or route observed at ${page.urlPattern || page.url}.`,
    capturedAt,
    provenance: { kind: 'crawl-run' as const, reference: observationId },
    integrity: 'unknown' as const,
  }))
  const observedSubjects = recoveryFailure
    ? recoveryFailure.observedSubjects.map((subject, index) => ({
        ...subject,
        evidenceId: evidence[index].id,
      }))
    : pages.map((page, index) => ({
        id: page.id || `${observationId}-subject-${index + 1}`,
        kind: 'page' as const,
        value: page.urlPattern || page.url,
        evidenceId: evidence[index].id,
      }))
  const unknowns = [
    {
      id: `${observationId}-coverage-unknown`,
      subject: 'Unobserved application scope',
      reason: 'The crawl frontier and complete application coverage were not measured.',
    },
    ...diagnostics
      .filter(item => item.reason === 'login-surface-observation')
      .map((item, index) => ({
        id: `${observationId}-login-surface-unknown-${index + 1}`,
        subject: item.target,
        reason: item.detail,
      })),
    ...(auth.outcome === 'failed' ? [{
      id: `${observationId}-authentication-acceptance-unknown`,
      subject: 'Authentication acceptance',
      reason: authAttempts.some(attempt => attempt.stages.some(stage => stage.loginSurfaceRetained === true))
        ? 'Credential references resolved and submission was attempted, but the login surface remained. The available evidence does not establish whether credentials, target policy, or an external condition caused retention.'
        : 'Authentication failed, but the available stage evidence does not uniquely establish the external cause.',
    }] : []),
  ]
  const blockers = diagnostics
    .filter(item => item.reason !== 'login-surface-observation')
    .map((item, index) => ({
      id: `${observationId}-blocker-${index + 1}`,
      kind: item.reason,
      subject: item.target,
      reason: item.detail,
    }))
  if (start.credentialAvailability === 'missing' && !blockers.some(item => item.kind === 'credentials-missing')) {
    blockers.push({
      id: `${observationId}-credentials-missing`,
      kind: 'credentials-missing',
      subject: start.projectName,
      reason: 'Authentication was expected, but the stored credential references could not be resolved.',
    })
  }
  if (modelCompatibilityFailure && !blockers.some(item => item.kind === 'model-compatibility')) {
    blockers.push({
      id: `${observationId}-model-compatibility`,
      kind: 'model-compatibility',
      subject: start.projectName,
      reason: 'The existing Application Model was preserved because it is incompatible with the current schema. Authentication was not evaluated and no evidence was activated.',
    })
  }
  if (recoveryFailure && !blockers.some(item => item.kind === 'guarded-model-persistence')) {
    blockers.push({
      id: `${observationId}-guarded-model-persistence`,
      kind: 'guarded-model-persistence',
      subject: start.projectName,
      reason: formatRecoveryPersistenceDiagnostic(recoveryFailure),
    })
  }
  const errors = [
    ...(view.error ? [view.error] : []),
    ...(modelError ? [modelError] : []),
    ...(recoveryFailure ? [formatRecoveryPersistenceDiagnostic(recoveryFailure)] : []),
  ]
  const recommendation = recoveryFailure
    ? recoveryFailureRecommendation()
    : modelCompatibilityFailure
    ? { action: 'Retry with Force re-crawl', because: 'Force re-crawl invokes guarded recovery: it preserves the invalid model, starts from no prior model, validates the replacement, and activates it only after a guarded commit.' }
    : auth.outcome === 'failed'
    ? authenticationFailureRecommendation(authAttempts)
    : classified.state === 'completed'
    ? { action: 'Review the bounded observation evidence', because: 'The run completed, but application coverage remains explicitly unknown.' }
    : classified.state === 'partially_completed'
      ? { action: 'Resolve the listed limitations and run another observation', because: 'The current run produced partial evidence with diagnostics.' }
      : classified.state === 'blocked'
        ? { action: 'Resolve the access or credential blocker and retry', because: classified.reason }
        : { action: 'Inspect the engine or persistence error before retrying', because: classified.reason }

  observationStore.complete({
    ...start,
    completedAt,
    terminalState: classified.state,
    stateReason: classified.reason,
    authentication: {
      expectation: start.authenticationExpectation,
      credentialAvailability: start.credentialAvailability,
      outcome: auth.outcome,
      reason: auth.reason,
      ...(authAttempts.length > 0 ? { attempts: authAttempts } : {}),
    },
    observedSubjects,
    unobservedScope: [
      'Application areas not reached from the declared target and context remain unobserved.',
      'Complete crawl frontier coverage was not measured.',
      ...diagnostics
        .filter(item => item.reason !== 'login-surface-observation')
        .map(item => `${item.target} remained limited: ${item.detail}`),
    ],
    unknowns,
    blockers,
    evidence,
    errors,
    recommendation,
    modelRecovery,
    modelRecoveryFailure,
  })
}

// POST /api/v1/crawl — start a crawl; 202 immediately (ADR-012 async job).
router.get('/projects/:appName/context', (req, res) => {
  const { appName } = req.params
  if (!isValidAppName(appName))
    return res.status(400).json(fail('Invalid project name.', 'INVALID_APP_NAME'))
  const context = projectContext(appName)
  if (!context)
    return res.status(404).json(fail(`Project '${appName}' was not found. Select or onboard a project first.`, 'NOT_FOUND'))
  res.json(ok(context))
})

router.get('/projects/:appName/latest', (req, res) => {
  const { appName } = req.params
  if (!isValidAppName(appName))
    return res.status(400).json(fail('Invalid project name.', 'INVALID_APP_NAME'))
  if (!projectContext(appName))
    return res.status(404).json(fail(`Project '${appName}' was not found.`, 'NOT_FOUND'))
  const observation = observationStore.latest(appName)
  if (!observation)
    return res.status(404).json(fail('No completed observation is available for this project.', 'OBSERVATION_NOT_FOUND'))
  res.json(ok({ observation }))
})

router.get('/projects/:appName/observations', (req, res) => {
  const { appName } = req.params
  if (!isValidAppName(appName)) {
    return res.status(400).json(fail('Invalid project name.', 'INVALID_APP_NAME'))
  }
  const context = projectContext(appName)
  if (!context) {
    return res.status(404).json(fail(`Project '${appName}' was not found.`, 'NOT_FOUND'))
  }
  const query = parseObservationHistoryQuery(req.query as Record<string, unknown>)
  if (!query.ok) return res.status(400).json(fail(query.message, query.code))

  const history = observationStore.history(appName, query)
  if (history.kind === 'invalid_cursor') {
    return res.status(400).json(fail(
      'cursor is not valid for this project, ordering, and date-filter set.',
      'INVALID_OBSERVATION_HISTORY_CURSOR',
    ))
  }
  if (history.kind === 'invalid_filter') {
    return res.status(400).json(fail(
      'The observation date filter is invalid.',
      'INVALID_OBSERVATION_HISTORY_RANGE',
    ))
  }
  if (history.kind === 'ownership_mismatch' || history.kind === 'malformed') {
    return res.status(500).json(fail(
      'Persisted observation history failed validation and cannot be presented safely.',
      'OBSERVATION_HISTORY_INVALID',
    ))
  }

  res.json(ok({
    project: { id: context.projectId, name: context.projectName },
    observations: history.observations.map(projectObservationHistoryItem),
    page: {
      limit: query.limit,
      nextCursor: history.nextCursor,
      previousCursor: history.previousCursor,
      hasPrevious: history.hasPrevious,
      filteredTotal: history.filteredTotal,
      projectTotal: history.projectTotal,
    },
    filter: {
      startedFrom: query.startedFrom,
      startedThrough: query.startedThrough,
    },
    requestedObservation: history.requestedObservation,
  }))
})

router.post('/', async (req, res) => {
  const { appName, force, aiBudget } = req.body ?? {}
  if (!appName || typeof appName !== 'string')
    return res.status(400).json(fail('appName is required', 'MISSING_APP_NAME'))
  if (!isValidAppName(appName))   // TD-UI-051 — reject traversal before resolveUrl→resolve
    return res.status(400).json(fail('appName must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens).', 'INVALID_APP_NAME'))

  const context = projectContext(appName)
  if (!context)
    return res.status(404).json(fail(`Project '${appName}' not found — onboard it first`, 'NOT_FOUND'))

  const active = jobRunner.getActiveJob(appName)
  if (active || observationStartReservations.has(appName))
    return res.status(409).json(fail(
      active
        ? `Observation '${active.jobId}' is already ${active.status} for '${appName}'.`
        : `An observation start is already being prepared for '${appName}'.`,
      'OBSERVATION_ALREADY_ACTIVE',
    ))

  observationStartReservations.add(appName)
  try {
    if (!await checkReachability(context.targetUrl)) {
      return res.status(422).json(fail(
        `Target '${context.targetUrl}' is unreachable. Verify the URL and network access before retrying.`,
        'TARGET_UNREACHABLE',
      ))
    }

    const observationId = randomUUID()
    const startedAt = new Date().toISOString()
    const startRecord: ObservationStartRecord = {
      schemaVersion: 1,
      observationId,
      projectId: appName,
      projectName: appName,
      observationContext: {
        id: observationId,
        label: 'Crawl observation',
        target: context.targetUrl,
        declaredScope: context.declaredScope,
        strategy: context.crawlStrategy,
      },
      sourceKind: 'crawl-engine',
      startedAt,
      credentialAvailability: context.credentialAvailability,
      authenticationExpectation: context.authenticationExpectation,
    }
    try {
      observationStore.begin(startRecord)
    } catch (err) {
      return res.status(500).json(fail(
        err instanceof Error ? err.message : 'Observation start persistence failed.',
        'OBSERVATION_PERSISTENCE_FAILED',
      ))
    }
    observationStarts.set(observationId, startRecord)
    // Fire WITHOUT await — 202 returns immediately; the client polls /:jobId/status.
    // Credentials are NOT read here (ADR-013): ExecutionContext's credential
    // provider resolves + injects them from the sidecar reference + env pair.
    const finalization = jobRunner.submit({
      jobId: observationId,
      type: 'crawl',
      appName,
      startedAt,
      options: { url: context.targetUrl, appName, force: !!force, aiBudget },
    }).then(async () => {
      await finalizeObservation(observationId)
    }).catch(err => {
      observationFinalizationErrors.set(
        observationId,
        err instanceof Error ? err.message : String(err),
      )
    })
    observationFinalizations.set(observationId, finalization)

    res.status(202).json(ok({
      jobId: observationId,
      observationId,
      state: 'queued',
      startedAt,
    }))
  } finally {
    observationStartReservations.delete(appName)
  }
})

// GET /api/v1/crawl/:jobId/status — Mission Timeline (live) + pages (post-crawl).
router.get('/:jobId/status', async (req, res) => {
  const expectedProjectId = typeof req.query.project === 'string' ? req.query.project : undefined
  if (req.query.project !== undefined && (!expectedProjectId || !isValidAppName(expectedProjectId))) {
    return res.status(400).json(fail('project must be a valid project name.', 'INVALID_APP_NAME'))
  }
  let view
  try {
    view = jobRunner.getStatus(req.params.jobId, expectedProjectId)
  } catch (error) {
    if (error instanceof ObservationStatusReadError) {
      return res.status(500).json(fail(error.message, 'OBSERVATION_RECORD_INVALID'))
    }
    throw error
  }
  if (!view) return res.status(404).json(fail('Job not found', 'NOT_FOUND'))

  const finalization = observationFinalizations.get(view.jobId)
  if ((view.status === 'completed' || view.status === 'failed') && finalization) {
    await finalization
  }
  const finalizationError = observationFinalizationErrors.get(view.jobId)
  if (finalizationError) {
    return res.status(500).json(fail(finalizationError, 'OBSERVATION_PERSISTENCE_FAILED'))
  }
  const observation = view.type === 'crawl'
    ? observationStore.get(view.appName, view.jobId)
    : null

  const { raw, label } = parseStrategy(view.lines)
  let model: unknown | null = null
  if (view.status === 'completed' && !observation) {
    try {
      model = await executionContext.readAppModel(view.appName)
    } catch (err) {
      return res.status(500).json(
        fail(`SQLite App Model read failed: ${String(err)}`, 'APP_MODEL_READ_FAILED'),
      )
    }
  }
  const pages = observation
    ? observation.observedSubjects.map(subject => ({
        id: subject.id,
        url: subject.value,
        urlPattern: subject.value,
        module: 'Unknown',
        moduleConfidence: null,
        moduleReason: null,
        elements: 0,
        roles: [],
      }))
    : mapModelPages(model)
  const crawlDiagnostics = mapModelDiagnostics(model)
  const pagesFound = observation ? observation.observedSubjects.length : countDiscovered(view.lines)

  res.json(ok({
    jobId:       view.jobId,
    observationId: view.jobId,
    status:      observation?.terminalState ?? view.status,
    complete:    view.type === 'crawl' ? observation !== null || view.complete : view.complete,
    lines:       view.lines,       // Mission Timeline
    strategy:    label,            // user-friendly (ADR-012); null until Mode line appears
    strategyRaw: raw,              // engine term, for the hover tooltip
    pagesFound,                    // live count while running; pages.length when complete
    pages,                         // [] until complete, then from the SQLite App Model
    crawlDiagnostics,              // [] until complete; [] also = clean crawl (TD-UI-064)
    error:       view.error ?? null,
    startedAt:   view.startedAt,
    completedAt: view.completedAt ?? null,
    observation,
  }))
})

export default router
