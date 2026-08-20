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

import {
  CanonicalExecutionContractError,
  decodeCanonicalExecutionStartAccepted,
  decodeCanonicalExecutionStatus,
  type CanonicalExecutionStartAccepted,
  type CanonicalExecutionStatus,
} from '../api/executionContract'
import {
  canonicalExecutionStatusQueryKey,
  isTransportObservedCanonicalExecutionStatusFor,
  type CanonicalExecutionStartRefusalCode,
  type CanonicalExecutionStartRefusalError,
} from '../api/executionClient'
import { apiClient } from '../api/client'
import {
  classifyCanonicalExecutionStartFailure,
  isCanonicalExecutionStartRefusal,
} from '../api/executionClient'
import type { QueryClient } from '@tanstack/react-query'
import { decodeCanonicalExecutionPreflight } from '../api/executionPreflightContract'
import type { ExecutionPreflightResponse } from '../api/types'

const SAFE_INTENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
function startPreflightQueryKey(project: string, definitionIds: readonly string[], revision: number) {
  return ['execution-preflight', project, [...definitionIds], revision] as const
}

export type PersistedRunIntentPhase = 'prepared' | 'start_pending' | 'ambiguous' | 'accepted' | 'retired'

export interface RunIntentSelection {
  readonly executionIntentKey: string
  readonly definitionIds: readonly string[]
  readonly revision: number
}

export interface PersistedRunIntent extends RunIntentSelection {
  readonly version: 1
  readonly phase: PersistedRunIntentPhase
  readonly acceptance: Readonly<CanonicalExecutionStartAccepted> | null
}

export type RunIntentUsableState =
  | { readonly phase: 'none' }
  | { readonly phase: 'prepared' | 'start_pending' | 'ambiguous'; readonly intent: PersistedRunIntent }
  | { readonly phase: 'accepted'; readonly intent: PersistedRunIntent; readonly acceptance: Readonly<CanonicalExecutionStartAccepted> }
  | { readonly phase: 'retired'; readonly intent: PersistedRunIntent; readonly cleanupIncomplete: boolean }

export type BlockedRunIntentOrigin = RunIntentUsableState | { readonly phase: 'unread_unknown' }

export type RunIntentState = RunIntentUsableState | {
  readonly phase: 'storage_blocked'
  readonly origin: BlockedRunIntentOrigin
  readonly reason: 'unavailable' | 'malformed' | 'write_failed' | 'unexpected_empty' | 'integrity_mismatch'
  readonly safeMessage: string
}

export interface RunIntentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LifecycleQueryAuthoritySnapshot {
  data: CanonicalExecutionStatus | null | undefined
  isSuccess: boolean
  isError: boolean
  isFetching: boolean
  dataUpdatedAt: number
}

export interface FreshLifecycleAuthority {
  readonly lifecycle: Readonly<CanonicalExecutionStatus>
  readonly executionIntentKey: string
  readonly verifiedAt: number
}

export interface LifecycleQueryTransportAuthority {
  readonly project: string
  readonly executionId: string
  readonly executionIntentKey: string
}

export type PendingStartAttempt = PersistedRunIntent

export interface RunIntentRetirementResult {
  readonly safe: boolean
  readonly cleanupIncomplete: boolean
}

interface LifecycleAuthorityState {
  epoch: number
  fingerprint: string | null
  authority: FreshLifecycleAuthority | null
}

interface LifecycleAuthorityProvenance {
  readonly queryClient: QueryClient
  readonly data: CanonicalExecutionStatus
  readonly project: string
  readonly executionId: string
  readonly epoch: number
  readonly fingerprint: string
  readonly queryAuthority: LifecycleQueryTransportAuthority
}

const issuedLifecycleAuthorities = new WeakSet<FreshLifecycleAuthority>()
const lifecycleAuthorityOwners = new WeakMap<FreshLifecycleAuthority, RunIntentController>()
const lifecycleAuthorityProvenance = new WeakMap<FreshLifecycleAuthority, LifecycleAuthorityProvenance>()
const controllerLifecycleAuthorities = new WeakMap<RunIntentController, Map<string, LifecycleAuthorityState>>()
const issuedLifecycleQueryTransportAuthorities = new WeakSet<LifecycleQueryTransportAuthority>()
const lifecycleQueryTransportAuthorityOwners = new WeakMap<LifecycleQueryTransportAuthority, RunIntentController>()
const lifecycleQueryTransportAuthorityGenerations = new WeakMap<LifecycleQueryTransportAuthority, number>()
const controllerLifecycleQueryTransportAuthorities = new WeakMap<RunIntentController, Map<string, LifecycleQueryTransportAuthority>>()
const lifecycleQueryDataOwners = new WeakMap<CanonicalExecutionStatus, {
  readonly controller: RunIntentController
  readonly queryClient: QueryClient
  readonly executionIntentKey: string
  readonly epoch: number
  readonly controllerGeneration: number
}>()
const controllerAuthorityGenerations = new WeakMap<RunIntentController, number>()
const controllerAuthorityLeases = new WeakMap<RunIntentController, { count: number }>()
const disposedControllers = new WeakSet<RunIntentController>()

interface StartAttemptCapabilityState {
  readonly identity: object
  readonly project: string
  readonly executionIntentKey: string
  readonly definitionIds: readonly string[]
  readonly revision: number
}

const controllerStartAttempts = new WeakMap<RunIntentController, StartAttemptCapabilityState>()

export type StoredRunIntentRead =
  | { kind: 'missing' }
  | { kind: 'valid'; intent: PersistedRunIntent }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }

function immutableAcceptance(
  acceptance: Readonly<CanonicalExecutionStartAccepted>,
): Readonly<CanonicalExecutionStartAccepted> {
  return Object.freeze({
    executionId: acceptance.executionId,
    state: 'accepted' as const,
    startedAt: acceptance.startedAt,
    executionPlanHash: acceptance.executionPlanHash,
    replayed: acceptance.replayed,
  })
}

function immutableIntent(intent: PersistedRunIntent): PersistedRunIntent {
  return Object.freeze({
    version: 1 as const,
    phase: intent.phase,
    executionIntentKey: intent.executionIntentKey,
    definitionIds: Object.freeze([...intent.definitionIds]),
    revision: intent.revision,
    acceptance: intent.acceptance ? immutableAcceptance(intent.acceptance) : null,
  })
}

function immutableUsableState(state: RunIntentUsableState): RunIntentUsableState {
  if (state.phase === 'none') return Object.freeze({ phase: 'none' as const })
  const intent = immutableIntent(state.intent)
  if (state.phase === 'accepted') {
    const acceptance = immutableAcceptance(state.acceptance)
    return Object.freeze({ phase: 'accepted' as const, intent, acceptance })
  }
  if (state.phase === 'retired') {
    return Object.freeze({ phase: 'retired' as const, intent, cleanupIncomplete: state.cleanupIncomplete })
  }
  return Object.freeze({ phase: state.phase, intent })
}

function immutableBlockedOrigin(origin: BlockedRunIntentOrigin): BlockedRunIntentOrigin {
  return origin.phase === 'unread_unknown'
    ? Object.freeze({ phase: 'unread_unknown' as const })
    : immutableUsableState(origin)
}

function immutableRunIntentState(state: RunIntentState): RunIntentState {
  if (state.phase !== 'storage_blocked') return immutableUsableState(state)
  return Object.freeze({
    phase: 'storage_blocked' as const,
    origin: immutableBlockedOrigin(state.origin),
    reason: state.reason,
    safeMessage: state.safeMessage,
  })
}

function exactSelection(value: Record<string, unknown>): RunIntentSelection | null {
  if (typeof value.executionIntentKey !== 'string' || !SAFE_INTENT_KEY.test(value.executionIntentKey)
    || !Array.isArray(value.definitionIds) || value.definitionIds.length < 1 || value.definitionIds.length > 50
    || value.definitionIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(value.definitionIds).size !== value.definitionIds.length
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return null
  return {
    executionIntentKey: value.executionIntentKey,
    definitionIds: Object.freeze([...(value.definitionIds as string[])]),
    revision: Number(value.revision),
  }
}

export function parsePersistedRunIntent(value: string | null): PersistedRunIntent | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (Object.keys(record).length !== 6
      || Object.keys(record).some(key => !['version', 'phase', 'executionIntentKey', 'definitionIds', 'revision', 'acceptance'].includes(key))
      || record.version !== 1
      || !['prepared', 'start_pending', 'ambiguous', 'accepted', 'retired'].includes(String(record.phase))) return null
    const selection = exactSelection(record)
    if (!selection) return null
    const phase = record.phase as PersistedRunIntentPhase
    if (phase === 'accepted') {
      const acceptance = decodeCanonicalExecutionStartAccepted(record.acceptance)
      return immutableIntent({ version: 1, phase, ...selection, acceptance })
    }
    if (record.acceptance !== null) return null
    return immutableIntent({ version: 1, phase, ...selection, acceptance: null })
  } catch (cause) {
    if (cause instanceof CanonicalExecutionContractError || cause instanceof SyntaxError) return null
    return null
  }
}

export function runIntentStorageKey(project: string): string {
  return `forge.execution-start-intent.v1.${project}`
}

export function readStoredRunIntent(storage: RunIntentStorage, project: string): StoredRunIntentRead {
  let raw: string | null
  try { raw = storage.getItem(runIntentStorageKey(project)) } catch { return { kind: 'unavailable' } }
  if (raw === null) return { kind: 'missing' }
  const intent = parsePersistedRunIntent(raw)
  return intent ? { kind: 'valid', intent } : { kind: 'invalid' }
}

function fromPersisted(intent: PersistedRunIntent): RunIntentUsableState {
  if (intent.phase === 'accepted') return immutableUsableState({ phase: 'accepted', intent, acceptance: intent.acceptance! })
  if (intent.phase === 'retired') return immutableUsableState({ phase: 'retired', intent, cleanupIncomplete: true })
  // A reload or storage interruption cannot prove whether an active record's
  // Start request was sent. Retain its exact key and restore as ambiguous.
  return immutableUsableState({
    phase: 'ambiguous',
    intent: immutableIntent({ ...intent, phase: 'ambiguous', acceptance: null }),
  })
}

function sameSelection(left: PersistedRunIntent, right: PersistedRunIntent): boolean {
  return left.executionIntentKey === right.executionIntentKey
    && left.revision === right.revision
    && left.definitionIds.length === right.definitionIds.length
    && left.definitionIds.every((id, index) => id === right.definitionIds[index])
}

function sameAcceptance(
  left: Readonly<CanonicalExecutionStartAccepted>,
  right: Readonly<CanonicalExecutionStartAccepted>,
): boolean {
  return left.executionId === right.executionId
    && left.state === right.state
    && left.startedAt === right.startedAt
    && left.executionPlanHash === right.executionPlanHash
    && left.replayed === right.replayed
}

function blocked(
  origin: BlockedRunIntentOrigin,
  reason: Extract<RunIntentState, { phase: 'storage_blocked' }>['reason'],
  safeMessage: string,
): RunIntentState {
  return immutableRunIntentState({ phase: 'storage_blocked', origin, reason, safeMessage })
}

function originIntent(origin: BlockedRunIntentOrigin): PersistedRunIntent | null {
  return 'intent' in origin ? origin.intent : null
}

function lifecycleAuthorityKey(project: string, executionId: string, executionIntentKey: string): string {
  return `${project}\u0000${executionId}\u0000${executionIntentKey}`
}

function lifecycleAuthoritiesFor(controller: RunIntentController): Map<string, LifecycleAuthorityState> {
  const existing = controllerLifecycleAuthorities.get(controller)
  if (existing) return existing
  const created = new Map<string, LifecycleAuthorityState>()
  controllerLifecycleAuthorities.set(controller, created)
  return created
}

function controllerAuthorityGeneration(controller: RunIntentController): number {
  return controllerAuthorityGenerations.get(controller) ?? 0
}

function currentLifecycleQueryTransportAuthority(
  controller: RunIntentController,
  project: string,
  executionId: string,
): LifecycleQueryTransportAuthority | null {
  const state = controller.snapshot()
  if (state.phase !== 'accepted'
    || controller.authorityProject() !== project
    || state.acceptance.executionId !== executionId) return null
  const key = lifecycleAuthorityKey(project, executionId, state.intent.executionIntentKey)
  const authority = controllerLifecycleQueryTransportAuthorities.get(controller)?.get(key)
  return authority
    && issuedLifecycleQueryTransportAuthorities.has(authority)
    && lifecycleQueryTransportAuthorityOwners.get(authority) === controller
    && lifecycleQueryTransportAuthorityGenerations.get(authority) === controllerAuthorityGeneration(controller)
    ? authority
    : null
}

function lifecycleAuthorityFingerprint(status: CanonicalExecutionStatus): string {
  return JSON.stringify([
    status.projectId,
    status.executionId,
    status.state,
    status.terminal,
    status.outcome,
    status.startedAt,
    status.completedAt,
    status.processInstanceId,
    status.safeCode,
    status.executionPlanHash,
  ])
}

interface CurrentLifecycleQueryProof {
  readonly data: CanonicalExecutionStatus
  readonly lifecycle: Readonly<CanonicalExecutionStatus>
  readonly epoch: number
  readonly fingerprint: string
}

function readCurrentLifecycleQueryProof(
  queryClient: QueryClient,
  project: string,
  executionId: string,
  queryAuthority: LifecycleQueryTransportAuthority,
): CurrentLifecycleQueryProof | null {
  const query = queryClient.getQueryState<CanonicalExecutionStatus>(
    canonicalExecutionStatusQueryKey(project, executionId),
  )
  if (!query || query.status !== 'success' || query.error !== null
    || query.fetchStatus !== 'idle' || !query.data
    || !Number.isFinite(query.dataUpdatedAt) || query.dataUpdatedAt <= 0
    || !isTransportObservedCanonicalExecutionStatusFor(query.data, project, executionId, queryAuthority)) return null

  let decoded: CanonicalExecutionStatus
  try {
    decoded = decodeCanonicalExecutionStatus(query.data)
  } catch {
    return null
  }
  if (decoded.projectId !== project || decoded.executionId !== executionId) return null
  const lifecycle = Object.freeze({ ...decoded })
  return Object.freeze({
    data: query.data,
    lifecycle,
    epoch: query.dataUpdatedAt,
    fingerprint: lifecycleAuthorityFingerprint(decoded),
  })
}

function revokeLifecycleAuthorities(
  controller: RunIntentController,
  project: string,
  executionId: string,
): void {
  const authorities = controllerLifecycleAuthorities.get(controller)
  if (!authorities) return
  const prefix = `${project}\u0000${executionId}\u0000`
  for (const [key, current] of authorities) {
    if (key.startsWith(prefix)) authorities.set(key, { ...current, authority: null })
  }
}

function isCurrentLifecycleAuthority(
  controller: RunIntentController,
  authority: FreshLifecycleAuthority | null | undefined,
): authority is FreshLifecycleAuthority {
  const state = controller.snapshot()
  if (!authority || state.phase !== 'accepted') return false
  const project = controller.authorityProject()
  const executionId = state.acceptance.executionId
  const provenance = lifecycleAuthorityProvenance.get(authority)
  if (!provenance) return false
  const currentQuery = readCurrentLifecycleQueryProof(
    provenance.queryClient,
    project,
    executionId,
    provenance.queryAuthority,
  )
  return issuedLifecycleAuthorities.has(authority)
    && lifecycleAuthorityOwners.get(authority) === controller
    && controllerLifecycleAuthorities.get(controller)?.get(
      lifecycleAuthorityKey(project, executionId, state.intent.executionIntentKey),
    )?.authority === authority
    && authority.executionIntentKey === state.intent.executionIntentKey
    && authority.lifecycle.projectId === project
    && authority.lifecycle.executionId === executionId
    && authority.lifecycle.terminal
    && provenance.project === project
    && provenance.executionId === executionId
    && currentQuery?.data === provenance.data
    && currentQuery.epoch === provenance.epoch
    && currentQuery.fingerprint === provenance.fingerprint
}

function consumeLifecycleAuthority(
  controller: RunIntentController,
  authority: FreshLifecycleAuthority,
): void {
  const state = controller.snapshot()
  if (state.phase !== 'accepted') return
  const authorities = controllerLifecycleAuthorities.get(controller)
  const key = lifecycleAuthorityKey(
    controller.authorityProject(),
    state.acceptance.executionId,
    state.intent.executionIntentKey,
  )
  const current = authorities?.get(key)
  if (current?.authority === authority) authorities?.set(key, { ...current, authority: null })
}

function beginStartAttempt(
  controller: RunIntentController,
  project: string,
  intent: PersistedRunIntent,
): object {
  const identity = Object.freeze({})
  controllerStartAttempts.set(controller, {
    identity,
    project,
    executionIntentKey: intent.executionIntentKey,
    definitionIds: Object.freeze([...intent.definitionIds]),
    revision: intent.revision,
  })
  return identity
}

function invalidateStartAttemptAuthorities(controller: RunIntentController): void {
  const attempt = controllerStartAttempts.get(controller)
  controllerStartAttempts.delete(controller)
}

export class RunIntentController {
  private state: RunIntentState
  private authorizedRetirementIntentKey: string | null = null
  private startInFlight: Promise<CanonicalExecutionStartAccepted> | null = null

  constructor(
    private readonly storage: RunIntentStorage,
    private readonly project: string,
    private readonly queryClient?: QueryClient,
  ) {
    const stored = readStoredRunIntent(storage, project)
    this.state = stored.kind === 'missing'
      ? immutableRunIntentState({ phase: 'none' })
      : stored.kind === 'valid'
        ? fromPersisted(stored.intent)
        : blocked(
            { phase: 'unread_unknown' },
            stored.kind === 'invalid' ? 'malformed' : 'unavailable',
            stored.kind === 'invalid'
              ? 'Stored execution intent state is malformed. Run intent recovery must establish safe authority before another Start.'
              : 'Run intent recovery is blocked because prior execution intent authority cannot be read safely.',
          )
  }

  /** Detached immutable observation; callers never receive controller-owned state references. */
  snapshot(): RunIntentState { return immutableRunIntentState(this.state) }

  /** Project authority is immutable for the lifetime of this controller. */
  authorityProject(): string { return this.project }

  #persist(intent: PersistedRunIntent): boolean {
    try {
      this.storage.setItem(runIntentStorageKey(this.project), JSON.stringify(intent))
      return true
    } catch {
      return false
    }
  }

  #blockWrite(origin: BlockedRunIntentOrigin): void {
    invalidateStartAttemptAuthorities(this)
    this.state = blocked(
      origin,
      'write_failed',
      'Run intent recovery is blocked because prior execution intent authority could not be persisted safely.',
    )
  }

  prepare(selection: RunIntentSelection): boolean {
    if (this.state.phase !== 'none' && this.state.phase !== 'retired') return false
    invalidateStartAttemptAuthorities(this)
    const origin = this.state
    const intent = immutableIntent({
      version: 1,
      phase: 'prepared',
      executionIntentKey: selection.executionIntentKey,
      definitionIds: [...selection.definitionIds],
      revision: selection.revision,
      acceptance: null,
    })
    if (!this.#persist(intent)) {
      this.#blockWrite(origin)
      return false
    }
    this.state = immutableRunIntentState({ phase: 'prepared', intent })
    return true
  }

  beginStart(): PendingStartAttempt | null {
    if (this.state.phase !== 'prepared' && this.state.phase !== 'ambiguous') return null
    const origin = this.state
    const intent = immutableIntent({ ...this.state.intent, phase: 'start_pending', acceptance: null })
    if (!this.#persist(intent)) {
      this.#blockWrite(origin)
      return null
    }
    this.state = immutableRunIntentState({ phase: 'start_pending', intent })
    beginStartAttempt(this, this.project, intent)
    const definitionIds = [...intent.definitionIds]
    Object.freeze(definitionIds)
    return Object.freeze({ ...intent, definitionIds })
  }

  /**
   * Self-authenticating Start boundary.  No request, project, intent key, or
   * transferable authority is accepted from callers; the controller's private
   * pending intent is the sole semantic source for the wire request and the
   * resulting state transition.
   */
  start(): Promise<CanonicalExecutionStartAccepted> {
    if (disposedControllers.has(this)) return Promise.reject(new Error('Run Start controller is disposed.'))
    if (this.startInFlight) return this.startInFlight
    const operation = this.#startInternal()
    const wrapped = operation.finally(() => { if (this.startInFlight === wrapped) this.startInFlight = null })
    this.startInFlight = wrapped
    return wrapped
  }

  async #startInternal(): Promise<CanonicalExecutionStartAccepted> {
    if (this.state.phase === 'prepared' || this.state.phase === 'ambiguous') {
      if (!this.beginStart()) throw new Error('Run Start is not currently authorized.')
    }
    if (this.state.phase !== 'start_pending') {
      throw new Error('Run Start is not currently authorized.')
    }
    const attempt = controllerStartAttempts.get(this)
    if (!attempt) throw new Error('Run Start is not currently authorized.')
    const current = this.state
    const project = this.project
    const executionIntentKey = current.intent.executionIntentKey
    const definitionIds = Object.freeze([...current.intent.definitionIds])
    const revision = current.intent.revision
    if (attempt.project !== project
      || attempt.executionIntentKey !== executionIntentKey
      || attempt.revision !== revision
      || attempt.definitionIds.length !== definitionIds.length
      || attempt.definitionIds.some((id, index) => id !== definitionIds[index])) {
      throw new Error('Run Start authority is stale.')
    }
    const request = Object.freeze({ executionIntentKey, definitionIds, revision })
    const query = this.queryClient?.getQueryState<ExecutionPreflightResponse>(
      startPreflightQueryKey(project, definitionIds, revision),
    )
    if (!query || query.status !== 'success' || query.error !== null || query.fetchStatus !== 'idle'
      || !query.data || !Number.isFinite(query.dataUpdatedAt) || query.dataUpdatedAt <= 0) {
      this.markAmbiguous()
      throw new Error('Current canonical preflight authority is unavailable.')
    }
    try {
      const preflight = decodeCanonicalExecutionPreflight(query.data, {
        projectId: project,
        definitionIds,
        revision,
      })
      if (preflight.aggregate.state !== 'ready') throw new Error('Current canonical preflight is not ready.')
    } catch {
      this.markAmbiguous()
      throw new Error('Current canonical preflight authority is unavailable.')
    }
    try {
      const value = await apiClient.post<unknown>(
        `/api/v1/projects/${encodeURIComponent(project)}/execution/start`,
        request,
      )
      const accepted = immutableAcceptance(decodeCanonicalExecutionStartAccepted(value))
      if (this.state.phase !== 'start_pending' || controllerStartAttempts.get(this) !== attempt) {
        throw new Error('Run Start authority is stale.')
      }
      if (!this.#persist(immutableIntent({ ...current.intent, phase: 'accepted', acceptance: accepted }))) {
        this.#blockWrite({ phase: 'start_pending', intent: current.intent })
        throw new Error('Run Start acceptance could not be persisted safely.')
      }
      this.state = immutableRunIntentState({
        phase: 'accepted',
        intent: immutableIntent({ ...current.intent, phase: 'accepted', acceptance: accepted }),
        acceptance: accepted,
      })
      invalidateStartAttemptAuthorities(this)
      return accepted
    } catch (error) {
      const failure = classifyCanonicalExecutionStartFailure(error)
      if (isCanonicalExecutionStartRefusal(failure)) {
        // The refusal is handled inside the same kernel that created and sent
        // the immutable request; no transferable refusal capability is needed.
        if (this.state.phase === 'start_pending' && controllerStartAttempts.get(this) === attempt) {
          this.#retireCurrentIntent()
        }
      } else if (!(failure instanceof Error && failure.message === 'Run Start authority is stale.')) {
        this.markAmbiguous()
      }
      throw failure
    }
  }

  markAmbiguous(): void {
    if (this.state.phase !== 'start_pending') return
    invalidateStartAttemptAuthorities(this)
    const intent = immutableIntent({ ...this.state.intent, phase: 'ambiguous', acceptance: null })
    const origin = immutableUsableState({
      phase: 'ambiguous',
      intent,
    })
    if (!this.#persist(intent)) {
      this.#blockWrite(origin)
      return
    }
    this.state = origin
  }

  #retireCurrentIntent(): RunIntentRetirementResult {
    if (!('intent' in this.state)) return { safe: false, cleanupIncomplete: false }
    invalidateStartAttemptAuthorities(this)
    const origin = this.state
    const tombstone = immutableIntent({ ...origin.intent, phase: 'retired', acceptance: null })
    this.authorizedRetirementIntentKey = origin.intent.executionIntentKey
    if (!this.#persist(tombstone)) {
      this.#blockWrite(origin)
      return { safe: false, cleanupIncomplete: false }
    }
    try {
      this.storage.removeItem(runIntentStorageKey(this.project))
      this.state = immutableRunIntentState({ phase: 'none' })
      this.authorizedRetirementIntentKey = null
      return { safe: true, cleanupIncomplete: false }
    } catch {
      this.state = immutableRunIntentState({ phase: 'retired', intent: tombstone, cleanupIncomplete: true })
      this.authorizedRetirementIntentKey = null
      return { safe: true, cleanupIncomplete: true }
    }
  }

  /** A prepared intent that was never sent may be abandoned without lifecycle authority. */
  abandonPreparedIntent(): RunIntentRetirementResult {
    if (this.state.phase !== 'prepared') return { safe: false, cleanupIncomplete: false }
    return this.#retireCurrentIntent()
  }

  /** Read-only presentation check; mutation still revalidates and consumes the capability itself. */
  canRetireAcceptedIntent(authority: FreshLifecycleAuthority | null | undefined): boolean {
    return isCurrentLifecycleAuthority(this, authority)
  }

  /** Accepted intent retirement is authorized and consumed at this mutation boundary. */
  retireAcceptedIntent(
    authority: FreshLifecycleAuthority | null | undefined,
  ): RunIntentRetirementResult {
    if (!isCurrentLifecycleAuthority(this, authority)) return { safe: false, cleanupIncomplete: false }
    consumeLifecycleAuthority(this, authority)
    const result = this.#retireCurrentIntent()
    if (result.safe) clearRunIntentAuthorities(this)
    return result
  }

  /**
   * Non-destructive recovery. It never clears or replaces a key. It reads the
   * durable slot, validates it, and reconciles it with stronger local truth.
   */
  reconcileBlockedIntentStorage(): boolean {
    if (this.state.phase !== 'storage_blocked') return true
    invalidateStartAttemptAuthorities(this)
    const blockedState = this.state
    const durable = readStoredRunIntent(this.storage, this.project)
    if (durable.kind === 'unavailable') {
      this.state = blocked(blockedState.origin, 'unavailable', 'Run intent recovery remains blocked because prior execution intent authority is unreadable.')
      return false
    }
    if (durable.kind === 'invalid') {
      this.state = blocked(blockedState.origin, 'malformed', 'Run intent recovery remains blocked because the durable intent record is malformed.')
      return false
    }
    if (durable.kind === 'missing') {
      if (blockedState.origin.phase === 'none' || blockedState.origin.phase === 'retired' || blockedState.origin.phase === 'unread_unknown') {
        this.state = immutableRunIntentState({ phase: 'none' })
        this.authorizedRetirementIntentKey = null
        return true
      }
      this.state = blocked(blockedState.origin, 'unexpected_empty', 'Run intent recovery remains blocked because unresolved in-memory authority has no durable record.')
      return false
    }

    const durableIntent = durable.intent
    const localIntent = originIntent(blockedState.origin)
    if (localIntent && !sameSelection(localIntent, durableIntent)) {
      this.state = blocked(blockedState.origin, 'integrity_mismatch', 'Run intent recovery remains blocked because durable and in-memory intent authority disagree.')
      return false
    }

    if (blockedState.origin.phase === 'retired') {
      if (durableIntent.phase !== 'retired') {
        this.state = blocked(blockedState.origin, 'integrity_mismatch', 'Run intent recovery remains blocked because durable retirement could not be established.')
        return false
      }
      this.state = immutableRunIntentState({ phase: 'retired', intent: durableIntent, cleanupIncomplete: true })
      this.authorizedRetirementIntentKey = null
      return true
    }

    if (durableIntent.phase === 'retired') {
      const retirementWasAuthorized = !!localIntent
        && this.authorizedRetirementIntentKey === durableIntent.executionIntentKey
        && sameSelection(localIntent, durableIntent)
      if (blockedState.origin.phase === 'none'
        || blockedState.origin.phase === 'unread_unknown'
        || retirementWasAuthorized) {
        this.state = immutableRunIntentState({ phase: 'retired', intent: durableIntent, cleanupIncomplete: true })
        this.authorizedRetirementIntentKey = null
        return true
      }
      this.state = blocked(blockedState.origin, 'integrity_mismatch', 'Run intent recovery remains blocked because durable retirement lacks matching mutation authority.')
      return false
    }

    if (blockedState.origin.phase === 'accepted') {
      if (durableIntent.phase === 'accepted') {
        if (!sameAcceptance(blockedState.origin.acceptance, durableIntent.acceptance!)) {
          this.state = blocked(blockedState.origin, 'integrity_mismatch', 'Run intent recovery remains blocked because canonical acceptance identities disagree.')
          return false
        }
        this.state = immutableRunIntentState({ phase: 'accepted', intent: durableIntent, acceptance: durableIntent.acceptance! })
        this.authorizedRetirementIntentKey = null
        return true
      }
      // Preserve stronger in-memory canonical acceptance by durably writing the
      // same key/selection with its backend-minted identity.
      if (!this.#persist(blockedState.origin.intent)) {
        this.#blockWrite(blockedState.origin)
        return false
      }
      this.state = immutableRunIntentState(blockedState.origin)
      this.authorizedRetirementIntentKey = null
      return true
    }

    if (durableIntent.phase === 'accepted') {
      this.state = immutableRunIntentState({ phase: 'accepted', intent: durableIntent, acceptance: durableIntent.acceptance! })
      this.authorizedRetirementIntentKey = null
      return true
    }

    this.state = fromPersisted(durableIntent)
    this.authorizedRetirementIntentKey = null
    return true
  }
}

/** Stable controller-generation capability supplied only to the canonical status query transport. */
export function issueLifecycleQueryTransportAuthority(
  controller: RunIntentController,
  project: string,
  executionId: string,
): LifecycleQueryTransportAuthority | null {
  const state = controller.snapshot()
  if (state.phase !== 'accepted'
    || controller.authorityProject() !== project
    || state.acceptance.executionId !== executionId) return null
  const key = lifecycleAuthorityKey(project, executionId, state.intent.executionIntentKey)
  const existing = currentLifecycleQueryTransportAuthority(controller, project, executionId)
  if (existing) return existing
  const authority = Object.freeze({
    project,
    executionId,
    executionIntentKey: state.intent.executionIntentKey,
  })
  issuedLifecycleQueryTransportAuthorities.add(authority)
  lifecycleQueryTransportAuthorityOwners.set(authority, controller)
  lifecycleQueryTransportAuthorityGenerations.set(authority, controllerAuthorityGeneration(controller))
  const authorities = controllerLifecycleQueryTransportAuthorities.get(controller) ?? new Map()
  authorities.set(key, authority)
  controllerLifecycleQueryTransportAuthorities.set(controller, authorities)
  return authority
}

function clearRunIntentAuthorities(controller: RunIntentController): void {
  controllerLifecycleAuthorities.delete(controller)
  controllerLifecycleQueryTransportAuthorities.delete(controller)
  const attempt = controllerStartAttempts.get(controller)
  controllerStartAttempts.delete(controller)
}

export function disposeRunIntentAuthorities(controller: RunIntentController): void {
  disposedControllers.add(controller)
  controllerAuthorityGenerations.set(controller, controllerAuthorityGeneration(controller) + 1)
  clearRunIntentAuthorities(controller)
}

/** React effect lease: development replay does not masquerade as a real controller disposal. */
export function retainRunIntentAuthorities(controller: RunIntentController): () => void {
  const lease = controllerAuthorityLeases.get(controller) ?? { count: 0 }
  lease.count += 1
  controllerAuthorityLeases.set(controller, lease)
  let released = false
  return () => {
    if (released) return
    released = true
    lease.count -= 1
    if (lease.count !== 0) return
    queueMicrotask(() => {
      if (controllerAuthorityLeases.get(controller) !== lease || lease.count !== 0) return
      controllerAuthorityLeases.delete(controller)
      disposeRunIntentAuthorities(controller)
    })
  }
}

export function revokeLifecycleAuthority(
  controller: RunIntentController,
  authority: FreshLifecycleAuthority,
): void {
  const state = controller.snapshot()
  if (state.phase !== 'accepted') return
  const authorities = controllerLifecycleAuthorities.get(controller)
  const key = lifecycleAuthorityKey(
    controller.authorityProject(),
    state.acceptance.executionId,
    authority.executionIntentKey,
  )
  const current = authorities?.get(key)
  if (current?.authority === authority) authorities?.set(key, { ...current, authority: null })
}

/**
 * Reads the exact current QueryClient entry and turns only a transport-observed,
 * runtime-decoded status into controller-owned action authority. Cached data is
 * display-only while replacement truth is uncertain.
 */
export function resolveFreshLifecycleAuthority(
  controller: RunIntentController,
  queryClient: QueryClient,
  project: string,
  executionId: string,
): FreshLifecycleAuthority | null {
  const intentState = controller.snapshot()
  if (controller.authorityProject() !== project
    || intentState.phase !== 'accepted'
    || intentState.acceptance.executionId !== executionId) {
    revokeLifecycleAuthorities(controller, project, executionId)
    return null
  }
  const executionIntentKey = intentState.intent.executionIntentKey
  const authorities = lifecycleAuthoritiesFor(controller)
  const key = lifecycleAuthorityKey(project, executionId, executionIntentKey)
  const current = authorities.get(key)
  const queryAuthority = currentLifecycleQueryTransportAuthority(controller, project, executionId)
  const proof = queryAuthority
    ? readCurrentLifecycleQueryProof(queryClient, project, executionId, queryAuthority)
    : null
  if (!proof || !queryAuthority) {
    revokeLifecycleAuthorities(controller, project, executionId)
    return null
  }
  const proofOwner = lifecycleQueryDataOwners.get(proof.data)
  const controllerGeneration = controllerAuthorityGeneration(controller)
  if (proofOwner && (proofOwner.controller !== controller
    || proofOwner.queryClient !== queryClient
    || proofOwner.executionIntentKey !== executionIntentKey
    || proofOwner.epoch !== proof.epoch
    || proofOwner.controllerGeneration !== controllerGeneration)) {
    revokeLifecycleAuthorities(controller, project, executionId)
    return null
  }
  if (!proofOwner) {
    lifecycleQueryDataOwners.set(proof.data, Object.freeze({
      controller,
      queryClient,
      executionIntentKey,
      epoch: proof.epoch,
      controllerGeneration,
    }))
  }

  const candidateEpoch = proof.epoch
  const fingerprint = proof.fingerprint
  if (current && candidateEpoch < current.epoch) {
    authorities.set(key, { epoch: current.epoch, fingerprint: null, authority: null })
    return null
  }
  if (current && candidateEpoch === current.epoch && current.fingerprint === fingerprint
    && (!current.authority
      || lifecycleAuthorityProvenance.get(current.authority)?.queryClient === queryClient)) {
    if (current.authority) {
      lifecycleAuthorityProvenance.set(current.authority, Object.freeze({
        queryClient,
        data: proof.data,
        project,
        executionId,
        epoch: candidateEpoch,
        fingerprint,
        queryAuthority,
      }))
    }
    return current.authority
  }

  authorities.set(key, { epoch: candidateEpoch, fingerprint, authority: null })
  if (!proof.lifecycle.terminal) return null

  const lifecycle = Object.freeze({ ...proof.lifecycle })
  const authority = Object.freeze({ lifecycle, executionIntentKey, verifiedAt: candidateEpoch })
  issuedLifecycleAuthorities.add(authority)
  lifecycleAuthorityOwners.set(authority, controller)
  lifecycleAuthorityProvenance.set(authority, Object.freeze({
    queryClient,
    data: proof.data,
    project,
    executionId,
    epoch: candidateEpoch,
    fingerprint,
    queryAuthority,
  }))
  authorities.set(key, { epoch: candidateEpoch, fingerprint, authority })
  return authority
}
