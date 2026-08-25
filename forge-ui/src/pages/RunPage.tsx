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
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleStop,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldQuestion,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import {
  classifyCanonicalExecutionStartFailure,
  CanonicalExecutionPayloadError,
  CanonicalExecutionPreflightPayloadError,
  CanonicalExecutionStartAmbiguousError,
  isCanonicalExecutionStartRefusal,
} from '../api/executionClient'
import type {
  CanonicalExecutionStartAccepted,
  CanonicalExecutionStatus,
} from '../api/executionContract'
import { decodeCanonicalExecutionStatus } from '../api/executionContract'
import { decodeCanonicalExecutionPreflight } from '../api/executionPreflightContract'
import {
  CanonicalResultsIntegrityError,
  CanonicalResultsPayloadError,
} from '../api/resultsClient'
import type {
  CanonicalV2TestDefinitionPresentation,
  CanonicalV2TestSetPresentation,
  CanonicalV3TestDefinitionPresentation,
  CanonicalV3TestSetPresentation,
  ExecutionPreflightDefinitionResultV3,
  ExecutionPreflightResponse,
  ExecutionPreflightState,
} from '../api/types'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import {
  executionPreflightQueryKey,
  useCancelCanonicalExecution,
  useCanonicalExecutionResultDetail,
  useCanonicalExecutionStatus,
  useEvidenceBackedTests,
  useExecutionPreflight,
  useStartCanonicalExecution,
} from '../hooks/useApi'
import {
  issueLifecycleQueryTransportAuthority,
  retainRunIntentAuthorities,
  resolveFreshLifecycleAuthority,
  revokeLifecycleAuthority,
  RunIntentController,
  type FreshLifecycleAuthority,
  type LifecycleQueryAuthoritySnapshot,
  type RunIntentState,
  type RunIntentStorage,
} from './runIntentState'
import { M1RunHandoffSession } from '../utils/M1RunHandoffSession'

const STATE_LABEL: Record<ExecutionPreflightState, string> = {
  empty_selection: 'Empty selection',
  invalid_request: 'Invalid request',
  stale_definition: 'Stale definition',
  incompatible_definition: 'Intrinsically incompatible',
  legacy_provenance_unsupported: 'Legacy provenance unsupported',
  support_seal_mismatch: 'Support seal mismatch',
  route_unknown: 'Route unknown',
  route_conflicted: 'Route conflicted',
  authentication_unknown: 'Authentication expectation unknown',
  authentication_conflicted: 'Authentication expectation conflicted',
  credentials_unavailable: 'Credentials unavailable',
  runner_unavailable: 'Runner unavailable',
  conflicting_evidence: 'Conflicting evidence',
  preflight_source_invalid: 'Preflight source invalid',
  execution_already_active: 'Execution already active',
  execution_persistence_unavailable: 'Execution persistence unavailable',
  ready: 'Eligible',
}

function readable(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
}

function BoundedState({ title, explanation, alert = false }: { title: string; explanation: string; alert?: boolean }) {
  return <section className="rounded-lg border border-border bg-surface p-8 text-center" role={alert ? 'alert' : 'status'}><h2 className="text-lg font-semibold text-primary">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{explanation}</p></section>
}

export type M1RunHandoffState =
  | { state: 'absent' }
  | { state: 'invalid'; explanation: string }
  | { state: 'pending'; testSetId: string; definitionId: string; revision: number }
  | { state: 'blocked'; testSetId: string; definitionId: string; revision: number; explanation: string }
  | { state: 'ready'; testSetId: string; definitionId: string; revision: number }

export function resolveM1RunHandoffState(
  project: string,
  definitionParam: string | null,
  revisionParam: string | null,
  stored: ReturnType<typeof M1RunHandoffSession.load>,
  current: { testSetId: string; revision: number; schemaVersion: number; definitions: readonly { definitionId: string; schemaVersion: number }[] } | null,
  inventorySettled: boolean,
): M1RunHandoffState {
  if (definitionParam === null && revisionParam === null) return { state: 'absent' }
  if (!definitionParam || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(definitionParam)
    || !revisionParam || !/^[1-9]\d{0,9}$/.test(revisionParam)) {
    return { state: 'invalid', explanation: 'The requested saved-definition handoff is malformed. URL state is not execution authority.' }
  }
  const revision = Number(revisionParam)
  if (!stored || stored.projectId !== project || stored.definitionId !== definitionParam || stored.revision !== revision) {
    return { state: 'invalid', explanation: 'The requested saved-definition handoff does not match this session’s exact promotion response.' }
  }
  if (!inventorySettled) return { state: 'pending', testSetId: stored.testSetId, definitionId: definitionParam, revision }
  if (!current || current.testSetId !== stored.testSetId || current.revision !== revision || current.schemaVersion !== 3
    || !current.definitions.some(item => item.definitionId === definitionParam && item.schemaVersion === 3)) {
    return { state: 'blocked', testSetId: stored.testSetId, definitionId: definitionParam, revision, explanation: 'The promoted v3 definition is not present in the exact current canonical Test Set identity and revision. Run remains unavailable.' }
  }
  return { state: 'ready', testSetId: stored.testSetId, definitionId: definitionParam, revision }
}

function M1RunHandoffNotice({ handoff }: { handoff: Exclude<M1RunHandoffState, { state: 'absent' }> }) {
  if (handoff.state === 'pending') return <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 aria-hidden="true" className="animate-spin" size={18} /> Revalidating the saved v3 definition against current canonical inventory…</div>
  if (handoff.state === 'ready') return <section role="status" className="rounded-lg border border-brand/40 bg-surface p-4"><h2 className="font-semibold text-primary">Canonical v3 definition selected</h2><p className="mt-1 text-sm text-secondary">Current inventory contains the exact saved definition at revision {handoff.revision}. Authoritative v3 preflight now determines whether Start is exposed.</p></section>
  return <section role="alert" className="rounded-lg border border-flaky/50 bg-surface p-5"><div className="flex gap-3"><ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-flaky" size={20} /><div><h2 className="font-semibold text-primary">Saved v3 test is not runnable</h2><p className="mt-1 text-sm text-secondary">{handoff.explanation}</p><p className="mt-2 text-xs text-muted">No canonical preflight or Start action is exposed for this handoff.</p></div></div></section>
}

export function shouldPollExecution(status: CanonicalExecutionStatus | null | undefined): boolean {
  return !!status && !status.terminal
}

/** Runtime-decodes a fresh status for non-retirement actions without issuing retirement authority. */
export function resolveFreshLifecycleStatus(
  project: string,
  executionId: string,
  query: LifecycleQueryAuthoritySnapshot,
): Readonly<CanonicalExecutionStatus> | null {
  if (!query.isSuccess || query.isError || query.isFetching || !query.data
    || !Number.isFinite(query.dataUpdatedAt) || query.dataUpdatedAt <= 0) return null
  try {
    const decoded = decodeCanonicalExecutionStatus(query.data)
    if (decoded.projectId !== project || decoded.executionId !== executionId) return null
    return Object.freeze({ ...decoded })
  } catch {
    return null
  }
}

export function isAmbiguousStartFailure(error: unknown): boolean {
  return error instanceof CanonicalExecutionStartAmbiguousError
}

export function createExecutionIntentKey(): string {
  return `intent-${crypto.randomUUID()}`
}

export function createStartSubmissionGate() {
  let active = false
  return {
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
      if (active) return undefined
      active = true
      try { return await action() } finally { active = false }
    },
  }
}

export function focusFirstRunControl(...controls: Array<{ focus(): void } | null>): boolean {
  const target = controls.find((control): control is { focus(): void } => control !== null)
  if (!target) return false
  target.focus()
  return true
}

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()}</time>
}

function browserRunIntentStorage(): RunIntentStorage {
  return {
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: key => window.sessionStorage.removeItem(key),
  }
}

export function intentSelection(state: RunIntentState): { definitionIds: string[]; revision: number } | null {
  const intent = 'intent' in state
    ? state.intent
    : state.phase === 'storage_blocked' && 'intent' in state.origin
      ? state.origin.intent
      : null
  return intent ? { definitionIds: [...intent.definitionIds], revision: intent.revision } : null
}

export function intentAcceptedExecutionId(state: RunIntentState): string | null {
  if (state.phase === 'accepted') return state.acceptance.executionId
  if (state.phase === 'storage_blocked' && state.origin.phase === 'accepted') return state.origin.acceptance.executionId
  return null
}

export function isRunIntentSelectionLocked(state: RunIntentState): boolean {
  return state.phase === 'prepared'
    || state.phase === 'start_pending'
    || state.phase === 'ambiguous'
    || state.phase === 'accepted'
    || state.phase === 'storage_blocked'
}

export interface VisibleRunSelection {
  definitionIds: string[]
  revision: number
  source: 'active_intent' | 'current_test_set'
}

export function deriveVisibleRunSelection(
  state: RunIntentState,
  editableDefinitionIds: string[],
  currentRevision: number,
): VisibleRunSelection {
  const authority = intentSelection(state)
  if (authority && isRunIntentSelectionLocked(state)) {
    return {
      definitionIds: [...authority.definitionIds],
      revision: authority.revision,
      source: 'active_intent',
    }
  }
  return {
    definitionIds: [...editableDefinitionIds],
    revision: currentRevision,
    source: 'current_test_set',
  }
}

export function sameRunSelection(
  left: { readonly definitionIds: readonly string[]; readonly revision: number },
  right: { readonly definitionIds: readonly string[]; readonly revision: number },
): boolean {
  return left.revision === right.revision
    && left.definitionIds.length === right.definitionIds.length
    && left.definitionIds.every((id, index) => id === right.definitionIds[index])
}

export interface PreflightQueryAuthoritySnapshot {
  data: ExecutionPreflightResponse | null | undefined
  isSuccess: boolean
  isError: boolean
  isFetching: boolean
  dataUpdatedAt: number
}

/** Defense in depth after the client decoder: bind cached data to the visible request and query state. */
export function resolveFreshPreflightAuthority(
  project: string,
  definitionIds: readonly string[],
  revision: number,
  query: PreflightQueryAuthoritySnapshot,
): ExecutionPreflightResponse | null {
  if (!query.isSuccess || query.isError || query.isFetching || !query.data
    || !Number.isFinite(query.dataUpdatedAt) || query.dataUpdatedAt <= 0) return null
  let data: ExecutionPreflightResponse
  try {
    data = decodeCanonicalExecutionPreflight(query.data, { projectId: project, definitionIds, revision })
  } catch {
    return null
  }
  if (data.aggregate.state === 'ready') {
    const responseIds = data.definitionResults.map(definition => definition.definitionId)
    if (new Set(responseIds).size !== responseIds.length
      || responseIds.length !== definitionIds.length
      || responseIds.some((definitionId, index) => definitionId !== definitionIds[index])) return null
  }
  return data
}

export interface V3RunAuthorityExpectation {
  current: { contentHash: string; testSet: CanonicalV3TestSetPresentation }
  handoff: { testSetId: string; definitionId: string; revision: number } | null
}

export interface V3RunPreflightBinding {
  readonly testSetId: string
  readonly revision: number
  readonly definitionResults: readonly ExecutionPreflightDefinitionResultV3[]
}

export type RunInventoryAuthorityExpectation =
  | { schemaVersion: 2 }
  | { schemaVersion: 3; authority: V3RunAuthorityExpectation }

/**
 * Sole v3 Start-presentation gate. It binds the current inventory identity and
 * selected Definition authorities to the exact eligible Core preflight results.
 */
export function resolveV3RunPreflightBinding(
  project: string,
  selection: Pick<VisibleRunSelection, 'definitionIds' | 'revision'>,
  expectation: V3RunAuthorityExpectation,
  preflight: ExecutionPreflightResponse | null,
): V3RunPreflightBinding | null {
  const current = expectation.current.testSet
  if (!preflight || preflight.aggregate.state !== 'ready'
    || current.schemaVersion !== 3 || current.projectId !== project
    || current.revision !== selection.revision || selection.definitionIds.length < 1
    || new Set(selection.definitionIds).size !== selection.definitionIds.length) return null
  if (expectation.handoff && (expectation.handoff.testSetId !== current.testSetId
    || expectation.handoff.revision !== current.revision
    || selection.definitionIds.length !== 1
    || selection.definitionIds[0] !== expectation.handoff.definitionId)) return null

  const revision = preflight.testSetRevision
  if (!revision || revision.schemaVersion !== 3 || revision.testSetId !== current.testSetId
    || revision.revision !== current.revision || revision.contentHash !== expectation.current.contentHash
    || preflight.definitionResults.length !== selection.definitionIds.length) return null

  const bound: ExecutionPreflightDefinitionResultV3[] = []
  for (const definitionId of selection.definitionIds) {
    const inventoryMatches = current.definitions.filter(definition => definition.definitionId === definitionId)
    const resultMatches = preflight.definitionResults.filter(result => result.definitionId === definitionId)
    if (inventoryMatches.length !== 1 || resultMatches.length !== 1) return null
    const definition = inventoryMatches[0]
    const result = resultMatches[0]
    if (definition.schemaVersion !== 3 || result.schemaVersion !== 3 || result.state !== 'eligible'
      || definition.category !== 'observed_flow' || definition.executionPolicy !== 'canonical_v3_preflight_required'
      || definition.intrinsicCompatibility.state !== 'compatible'
      || result.appArea !== definition.appArea
      || result.modelRowId !== definition.provenance.modelRowId
      || result.modelVersion !== definition.provenance.modelVersion
      || result.supportSealHash !== definition.provenance.supportSealHash
      || result.intentId !== definition.provenance.intentId
      || result.intentContentHash !== definition.provenance.intentContentHash
      || result.modelRowId !== current.provenance.modelRowId
      || result.modelVersion !== current.provenance.modelVersion
      || result.supportSealHash !== current.provenance.supportSealHash
      || result.intentId !== definition.normalizedIntent.intentId
      || definition.routeEvidence.routes.length !== 2
      || definition.actions.length !== 2
      || definition.actions[0].kind !== 'navigate_to_observed_route'
      || definition.actions[1].kind !== 'click_observed_data_test'
      || result.actions[0] !== definition.actions[0].kind
      || result.actions[1] !== definition.actions[1].kind
      || result.routes[0].subjectId !== definition.routeEvidence.routes[0].subjectId
      || result.routes[0].normalizedPath !== definition.routeEvidence.routes[0].normalizedPath
      || result.routes[1].subjectId !== definition.routeEvidence.routes[1].subjectId
      || result.routes[1].normalizedPath !== definition.routeEvidence.routes[1].normalizedPath
      || result.oracle.kind !== definition.oracle.kind
      || result.oracle.subjectId !== definition.oracle.subjectId
      || result.oracle.routePath !== definition.routeEvidence.routes[1].normalizedPath
      || result.authenticationExpectation.state !== definition.authenticationExpectation.state
      || result.authenticationExpectation.mechanism !== definition.authenticationExpectation.mechanism) return null
    bound.push(result)
  }
  if (bound.length !== preflight.definitionResults.length) return null
  return Object.freeze({
    testSetId: current.testSetId,
    revision: current.revision,
    definitionResults: Object.freeze([...bound]),
  })
}

export interface CurrentStartAuthority {
  readonly project: string
  readonly definitionIds: readonly string[]
  readonly revision: number
  readonly verifiedAt: number
}

export type CanonicalStartActionResult =
  | { kind: 'accepted'; accepted: CanonicalExecutionStartAccepted }
  | { kind: 'blocked'; reason: 'active_execution' | 'intent_unavailable' | 'preflight_unavailable' }
  | { kind: 'failed'; error: unknown }

export interface CanonicalStartActionContext {
  controller: RunIntentController
  project: string
  queryClient: QueryClient
  readActiveExecutionId(): string | null
  readVisibleSelection(): Pick<VisibleRunSelection, 'definitionIds' | 'revision'>
  readInventoryAuthorityExpectation(): RunInventoryAuthorityExpectation
  createIntentKey(): string
  sendStart(): Promise<CanonicalExecutionStartAccepted>
  onIntentStateChange(state: RunIntentState): void
  onAccepted(accepted: CanonicalExecutionStartAccepted): void
}

/** Reads the exact ordered preflight cache entry from current QueryClient state. */
export function readCurrentPreflightQuery(
  queryClient: QueryClient,
  project: string,
  definitionIds: readonly string[],
  revision: number,
): PreflightQueryAuthoritySnapshot | null {
  const queryKey = executionPreflightQueryKey(project, definitionIds, revision)
  const state = queryClient.getQueryState<ExecutionPreflightResponse>(queryKey)
  if (!state) return null
  return {
    data: state.data,
    isSuccess: state.status === 'success',
    isError: state.status === 'error' || state.error !== null,
    // Both fetching and paused mean the current revalidation outcome is uncertain.
    isFetching: state.fetchStatus !== 'idle',
    dataUpdatedAt: state.dataUpdatedAt,
  }
}

/** Resolve Start authority from the exact state observed at the action boundary. */
export function resolveCurrentStartAuthority(
  controller: RunIntentController,
  project: string,
  activeExecutionId: string | null,
  visibleSelection: Pick<VisibleRunSelection, 'definitionIds' | 'revision'>,
  query: PreflightQueryAuthoritySnapshot,
  inventoryExpectation: RunInventoryAuthorityExpectation,
): CurrentStartAuthority | null {
  const state = controller.snapshot()
  if (controller.authorityProject() !== project
    || state.phase === 'start_pending'
    || state.phase === 'accepted'
    || state.phase === 'storage_blocked'
    || activeExecutionId && state.phase !== 'ambiguous') return null

  const displayed = {
    definitionIds: [...visibleSelection.definitionIds],
    revision: visibleSelection.revision,
  }
  if (displayed.definitionIds.length === 0) return null
  const authoritativeSelection = deriveVisibleRunSelection(
    state,
    displayed.definitionIds,
    displayed.revision,
  )
  if (!sameRunSelection(authoritativeSelection, displayed)) return null

  const preflight = resolveFreshPreflightAuthority(
    project,
    displayed.definitionIds,
    displayed.revision,
    query,
  )
  if (preflight?.aggregate.state !== 'ready') return null
  if (inventoryExpectation.schemaVersion === 3
    && !resolveV3RunPreflightBinding(project, displayed, inventoryExpectation.authority, preflight)) return null

  return Object.freeze({
    project,
    definitionIds: Object.freeze([...displayed.definitionIds]),
    revision: displayed.revision,
    verifiedAt: query.dataUpdatedAt,
  })
}

/** The real Start action core. It re-establishes authority before every send. */
export async function executeCanonicalStartAction(
  context: CanonicalStartActionContext,
): Promise<CanonicalStartActionResult> {
  const activeExecutionId = context.readActiveExecutionId()
  const selection = context.readVisibleSelection()
  const query = readCurrentPreflightQuery(
    context.queryClient,
    context.project,
    selection.definitionIds,
    selection.revision,
  )
  const authority = resolveCurrentStartAuthority(
    context.controller,
    context.project,
    activeExecutionId,
    selection,
    query ?? {
      data: undefined,
      isSuccess: false,
      isError: false,
      isFetching: false,
      dataUpdatedAt: 0,
    },
    context.readInventoryAuthorityExpectation(),
  )
  if (!authority) {
    const state = context.controller.snapshot()
    return {
      kind: 'blocked',
      reason: activeExecutionId && state.phase !== 'ambiguous'
        ? 'active_execution'
        : state.phase === 'storage_blocked' || state.phase === 'accepted' || state.phase === 'start_pending'
          ? 'intent_unavailable'
          : 'preflight_unavailable',
    }
  }

  let state = context.controller.snapshot()
  if (state.phase === 'none' || state.phase === 'retired') {
    context.controller.prepare({
      executionIntentKey: context.createIntentKey(),
      definitionIds: [...authority.definitionIds],
      revision: authority.revision,
    })
    state = context.controller.snapshot()
    context.onIntentStateChange(state)
  }

  const intentSelectionAuthority = intentSelection(state)
  if (!intentSelectionAuthority || !sameRunSelection(intentSelectionAuthority, authority)) {
    return { kind: 'blocked', reason: 'intent_unavailable' }
  }
  const intent = context.controller.beginStart()
  if (!intent) return { kind: 'blocked', reason: 'intent_unavailable' }
  context.onIntentStateChange(context.controller.snapshot())

  try {
    const accepted = await context.sendStart()
    if (context.controller.snapshot().phase === 'accepted') {
      const acceptedState = context.controller.snapshot()
      if (acceptedState.phase === 'accepted') {
        context.onIntentStateChange(acceptedState)
        context.onAccepted(acceptedState.acceptance)
        return { kind: 'accepted', accepted: acceptedState.acceptance }
      }
    }
    const acceptedState = context.controller.snapshot()
    context.onIntentStateChange(acceptedState)
    if (acceptedState.phase !== 'accepted') return { kind: 'blocked', reason: 'intent_unavailable' }
    context.onAccepted(acceptedState.acceptance)
    return { kind: 'accepted', accepted: acceptedState.acceptance }
  } catch (error) {
    const failure = classifyCanonicalExecutionStartFailure(error)
    if (!isCanonicalExecutionStartRefusal(failure) && context.controller.snapshot().phase === 'start_pending') {
      context.controller.markAmbiguous()
    }
    context.onIntentStateChange(context.controller.snapshot())
    return { kind: 'failed', error: failure }
  }
}

export function isPrepareAnotherRunEligible(
  controller: RunIntentController,
  project: string,
  displayedExecutionId: string,
  authority: FreshLifecycleAuthority | null | undefined,
): boolean {
  const state = controller.snapshot()
  if (!authority
    || controller.authorityProject() !== project
    || !controller.canRetireAcceptedIntent(authority)
    || !authority.lifecycle.terminal
    || authority.lifecycle.projectId !== project
    || authority.lifecycle.executionId !== displayedExecutionId) return false
  return state.phase === 'accepted'
    && state.acceptance.executionId === displayedExecutionId
    && state.intent.executionIntentKey === authority.executionIntentKey
}

function DefinitionRow({
  definition,
  selected,
  eligible,
  disabled,
  onToggle,
}: {
  definition: CanonicalV2TestDefinitionPresentation | CanonicalV3TestDefinitionPresentation
  selected: boolean
  eligible: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const compatibility = definition.intrinsicCompatibility.state === 'compatible' ? 'Compatible' : definition.intrinsicCompatibility.state === 'blocked' ? 'Blocked' : 'Not evaluated'
  return <article className="rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><input aria-label={`Select ${definition.title}`} type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} className="mt-1 h-4 w-4 accent-brand" /><div><p className="text-xs uppercase tracking-[0.16em] text-brand">Canonical v{definition.schemaVersion} Definition</p><h3 className="mt-1 font-semibold text-primary">{definition.title}</h3><p className="break-all font-mono text-xs text-muted">{definition.definitionId}</p></div></div><span className={`rounded-full border border-border px-3 py-1 text-sm font-semibold ${selected && eligible ? 'text-pass' : 'text-muted'}`}>{selected ? eligible ? 'Execution eligible' : 'Eligibility not established' : 'Not selected'}</span></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs uppercase text-muted">Intrinsic compatibility</dt><dd className="text-secondary">{compatibility}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Route evidence</dt><dd className="text-secondary">{definition.schemaVersion === 3 ? `${definition.routeEvidence.routes.length} governed flow routes` : definition.routeEvidence.state === 'available' ? <code>{definition.routeEvidence.normalizedPath}</code> : definition.routeEvidence.state}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Authentication expectation</dt><dd className="text-secondary">{definition.authenticationExpectation.state.replaceAll('_', ' ')}{definition.authenticationExpectation.mechanism ? ` — ${definition.authenticationExpectation.mechanism}` : ''}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-secondary">{definition.provenance.supportSealHash}</dd></div>
    </dl>
    {definition.schemaVersion === 3 && <p className="mt-3 text-sm text-secondary"><strong className="text-primary">App area:</strong> {definition.appArea} · navigate then observed data-test click · final subject-observable oracle.</p>}
    <p className="mt-3 text-xs text-muted">Compatibility is immutable Definition truth. Eligibility is a live preflight result. Credential availability and authentication execution outcome are not Definition fields.</p>
  </article>
}

function PreflightError({ error }: { error: unknown }) {
  if (error instanceof CanonicalExecutionPreflightPayloadError) return <BoundedState alert title="Canonical preflight response invalid" explanation="FORGE refused the preflight response because its runtime shape or request identity could not be established." />
  const apiError = error instanceof ApiError ? error : null
  if (apiError?.code === 'NOT_FOUND') return <BoundedState alert title="Application not found" explanation="The selected project does not exist. Select an onboarded application." />
  if (apiError?.status === 400) return <BoundedState alert title="Invalid preflight request" explanation="The execution preflight request could not be validated safely." />
  if (apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.code === 'PREFLIGHT_UNAVAILABLE' || apiError?.status === 0) return <BoundedState alert title="FORGE backend unavailable" explanation="Start the local FORGE control plane, then refresh this page." />
  return <BoundedState alert title="Execution preflight unavailable" explanation="Authoritative preflight inputs could not be loaded safely." />
}

export function ExecutionMonitoringError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const malformed = error instanceof CanonicalExecutionPayloadError
  const missing = error instanceof ApiError && error.status === 404
  return <section role="alert" className="rounded-lg border border-fail/50 bg-surface p-4">
    <h3 className="font-semibold text-primary">{malformed ? 'Canonical status response was invalid' : missing ? 'Execution not found' : 'Execution status unavailable'}</h3>
    <p className="mt-1 text-sm text-secondary">{malformed ? 'FORGE refused malformed lifecycle data and did not infer execution state.' : missing ? 'The canonical Execution identity is not present in this project.' : 'Current lifecycle could not be retrieved. This is a monitoring failure, not an execution outcome.'}</p>
    {!missing && <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"><RefreshCw size={15} /> Retry status</button>}
  </section>
}

function EvidenceSummary({ project, executionId, monitor, terminal }: { project: string; executionId: string; monitor: boolean; terminal: boolean }) {
  const detail = useCanonicalExecutionResultDetail(project, executionId, monitor && !terminal, terminal ? 'terminal' : 'live')
  if (detail.isLoading || (terminal && detail.isFetching && !detail.data)) return <div role="status" className="flex items-center gap-2 text-sm text-secondary"><Loader2 className="animate-spin" size={16} /> {terminal ? 'Refreshing final canonical Results; pre-terminal evidence is withheld…' : 'Loading current persisted evidence…'}</div>
  if (detail.error instanceof CanonicalResultsIntegrityError) return <section role="alert" className="rounded border border-fail/50 bg-elevated p-4"><div className="flex gap-3"><ShieldAlert className="shrink-0 text-fail" size={18} /><div><h3 className="font-semibold text-primary">Results integrity could not be established</h3><p className="mt-1 text-sm text-secondary">Current evidence is withheld. Run orchestration will not reconstruct or replace canonical Results truth.</p></div></div></section>
  if (detail.error instanceof CanonicalResultsPayloadError) return <section role="alert" className="rounded border border-fail/50 bg-elevated p-4"><p className="text-sm text-fail">Canonical Results payload was malformed; no evidence summary was inferred.</p>{terminal && <button type="button" onClick={() => { void detail.refetch() }} className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"><RefreshCw size={15} /> Retry canonical Results</button>}</section>
  if (detail.isError) return <section role="alert" className="rounded border border-border bg-elevated p-4"><p className="text-sm text-secondary">{terminal ? 'Final canonical Results are unavailable. Pre-terminal evidence is withheld; the terminal lifecycle remains authoritative.' : 'Current persisted evidence is temporarily unavailable. This does not change execution lifecycle.'}</p><button type="button" onClick={() => { void detail.refetch() }} className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"><RefreshCw size={15} /> Retry canonical Results</button></section>
  if (!detail.data) return null
  const observed = detail.data.items.filter(item => item.evidence.kind === 'observed_result').length
  const missing = detail.data.execution.expectedResultCount - observed
  return <section aria-labelledby="current-evidence-heading" className="rounded border border-border bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="current-evidence-heading" className="font-semibold text-primary">Current persisted evidence</h3><p className="mt-1 text-sm text-secondary">{observed} of {detail.data.execution.expectedResultCount} expected Results observed · {missing} missing</p></div><span className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-unknown">Evidence: {readable(detail.data.evidenceHeadlineOutcome)}</span></div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-muted">Evidence headline</dt><dd className="text-primary">{readable(detail.data.evidenceHeadlineOutcome)}</dd></div>
      <div><dt className="text-xs text-muted">Terminal outcome</dt><dd className="text-primary">{detail.data.execution.terminalOutcome ? readable(detail.data.execution.terminalOutcome) : 'Not persisted'}</dd></div>
      <div><dt className="text-xs text-muted">Run identity</dt><dd className="break-all font-mono text-primary">{detail.data.run?.runId ?? 'No Product Run persisted yet'}</dd></div>
    </dl>
    {!detail.data.execution.terminalOutcome && <p className="mt-3 text-xs text-secondary">Current evidence is not a terminal execution verdict. Missing evidence remains missing.</p>}
  </section>
}

export function ExecutionMonitor({
  project,
  executionId,
  acceptance,
  intentController,
  onNewIntent,
}: {
  project: string
  executionId: string
  acceptance: CanonicalExecutionStartAccepted | null
  intentController: RunIntentController
  onNewIntent: (authority: FreshLifecycleAuthority) => void
}) {
  const queryClient = useQueryClient()
  const statusQueryAuthority = issueLifecycleQueryTransportAuthority(intentController, project, executionId)
  const status = useCanonicalExecutionStatus(project, executionId, statusQueryAuthority)
  const cancel = useCancelCanonicalExecution(project, executionId)
  const [confirmCancellation, setConfirmCancellation] = useState(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const confirmCancelRef = useRef<HTMLButtonElement>(null)
  const executionStatusAnchorRef = useRef<HTMLDivElement>(null)
  const lifecycle = status.data
  const lifecycleQueryAuthority = {
    data: status.data,
    isSuccess: status.isSuccess,
    isError: status.isError,
    isFetching: status.isFetching,
    dataUpdatedAt: status.dataUpdatedAt,
  }
  const freshLifecycleStatus = resolveFreshLifecycleStatus(project, executionId, lifecycleQueryAuthority)
  const lifecycleAuthority = resolveFreshLifecycleAuthority(
    intentController,
    queryClient,
    project,
    executionId,
  )
  const polling = shouldPollExecution(lifecycle)
  const showCancel = lifecycle?.state === 'running' && !cancel.isSuccess
  const canCancel = freshLifecycleStatus?.state === 'running' && !cancel.isSuccess
  const canPrepareAnotherRun = isPrepareAnotherRunEligible(intentController, project, executionId, lifecycleAuthority)

  useEffect(() => {
    return () => {
      if (!lifecycleAuthority) return
      revokeLifecycleAuthority(intentController, lifecycleAuthority)
    }
  }, [intentController, project, executionId, lifecycleAuthority])

  useEffect(() => {
    if (confirmCancellation) focusFirstRunControl(confirmCancelRef.current, executionStatusAnchorRef.current)
  }, [confirmCancellation])

  useEffect(() => {
    if (!confirmCancellation || !lifecycle || lifecycle.state === 'running') return
    setConfirmCancellation(false)
    focusFirstRunControl(executionStatusAnchorRef.current)
  }, [confirmCancellation, lifecycle])

  useEffect(() => {
    if (cancel.isSuccess) focusFirstRunControl(executionStatusAnchorRef.current)
  }, [cancel.isSuccess])

  function dismissCancellation() {
    setConfirmCancellation(false)
    setTimeout(() => focusFirstRunControl(cancelButtonRef.current, executionStatusAnchorRef.current), 0)
  }

  async function requestCancellation() {
    if (!canCancel || cancel.isPending) return
    try {
      await cancel.mutateAsync()
      setConfirmCancellation(false)
    } catch {
      setConfirmCancellation(false)
      await status.refetch()
      setTimeout(() => focusFirstRunControl(cancelButtonRef.current, executionStatusAnchorRef.current), 0)
    }
  }

  return <section aria-labelledby="active-execution-heading" className="space-y-4 rounded-lg border border-brand/40 bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.18em] text-brand">Canonical execution</p><h2 id="active-execution-heading" className="mt-1 text-xl font-semibold text-primary">Execution lifecycle</h2><p className="mt-1 break-all font-mono text-sm text-secondary">Execution ID {executionId}</p></div>
      <span className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-run">{lifecycle ? readable(lifecycle.state) : 'Accepted · status pending'}</span>
    </div>
    {acceptance && <p role="status" className="text-sm text-secondary">{acceptance.replayed ? 'The backend replayed the original accepted Execution for this intent.' : 'The backend accepted this Execution and minted its identity.'}</p>}
    <div ref={executionStatusAnchorRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="rounded border border-border bg-elevated p-3 text-sm text-secondary">{status.isError ? 'Canonical execution status is temporarily unavailable. Last-known lifecycle is display-only and cannot authorize an action.' : status.isFetching && lifecycle ? `Revalidating canonical lifecycle. Last-known state: ${readable(lifecycle.state)}.` : lifecycle ? `Execution lifecycle: ${readable(lifecycle.state)}.` : 'Canonical execution accepted; lifecycle status is pending.'}</div>
    {status.isLoading && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={17} /> Reading durable lifecycle…</div>}
    {status.isError && <ExecutionMonitoringError error={status.error} onRetry={() => { void status.refetch() }} />}
    {lifecycle && <>
      <dl className="grid gap-3 rounded border border-border bg-elevated p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted">Lifecycle</dt><dd className="font-medium text-run">{readable(lifecycle.state)}</dd></div>
        <div><dt className="text-xs text-muted">Persisted terminal outcome</dt><dd className="text-primary">{lifecycle.outcome ? readable(lifecycle.outcome) : 'Not persisted'}</dd></div>
        <div><dt className="text-xs text-muted">Accepted</dt><dd className="text-secondary"><Time value={lifecycle.startedAt} /></dd></div>
        <div><dt className="text-xs text-muted">Terminal time</dt><dd className="text-secondary">{lifecycle.completedAt ? <Time value={lifecycle.completedAt} /> : 'Not persisted'}</dd></div>
      </dl>
      <div className="rounded border border-border bg-elevated p-4"><p className="text-sm font-medium text-primary">{lifecycle.safeMessage}</p>{lifecycle.safeCode && <p className="mt-1 text-xs text-muted">Canonical reason: <code>{lifecycle.safeCode}</code></p>}{lifecycle.state === 'interrupted' && <p className="mt-2 text-xs text-secondary">Interrupted is distinct from a failed Result, cancellation, and an API error. Persisted evidence remains authoritative.</p>}{lifecycle.state === 'cancellation_requested' && <p className="mt-2 text-xs text-secondary">Operator intent is persisted; the next canonical lifecycle read determines what actually happened.</p>}</div>
    </>}
    <EvidenceSummary project={project} executionId={executionId} monitor={polling || status.isLoading} terminal={lifecycle?.terminal ?? false} />
    <div className="flex flex-wrap items-center gap-3">
      {showCancel && !confirmCancellation && <button ref={cancelButtonRef} type="button" disabled={!canCancel} onClick={() => setConfirmCancellation(true)} className="inline-flex items-center gap-2 rounded-md border border-fail/50 px-4 py-2 text-sm font-medium text-fail outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50"><CircleStop size={16} /> Cancel execution</button>}
      {showCancel && confirmCancellation && <div role="group" aria-label="Confirm execution cancellation" className="flex flex-wrap items-center gap-2 rounded border border-fail/40 p-2"><span className="text-sm text-secondary">Request cancellation?</span><button ref={confirmCancelRef} type="button" disabled={!canCancel || cancel.isPending} onClick={() => { void requestCancellation() }} className="rounded bg-fail px-3 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">{cancel.isPending ? 'Requesting…' : 'Confirm cancel'}</button><button type="button" disabled={cancel.isPending} onClick={dismissCancellation} className="rounded border border-border px-3 py-1.5 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Keep running</button></div>}
      {cancel.isError && <p role="alert" className="text-sm text-fail">Cancellation could not be confirmed. Canonical status was refreshed; no lifecycle outcome was inferred.</p>}
      {cancel.isSuccess && lifecycle?.state === 'running' && <p role="status" className="text-sm text-secondary">Cancellation intent was accepted; canonical lifecycle reconciliation is pending.</p>}
      {lifecycle?.terminal && <><Link to={`/results?project=${encodeURIComponent(project)}&execution=${encodeURIComponent(executionId)}`} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand"><CheckCircle2 size={16} /> Open canonical Results</Link><button type="button" disabled={!canPrepareAnotherRun || !lifecycleAuthority} onClick={() => { if (lifecycleAuthority) onNewIntent(lifecycleAuthority) }} className="rounded-md border border-border px-4 py-2 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">Prepare another Run</button>{!canPrepareAnotherRun && <p className="text-xs text-secondary">Fresh terminal lifecycle for this intent's accepted Execution is required. A viewed, cached, mismatched, or unavailable status cannot authorize retirement.</p>}</>}
      {polling && <span role="status" className="inline-flex items-center gap-2 text-xs text-muted"><Loader2 className="animate-spin" size={14} /> Monitoring canonical lifecycle</span>}
    </div>
    <p className="text-xs text-muted">Recovery is automatic and evidence-only when canonical status is read. No Result is synthesized, and no user recovery action exists in the current Product authority.</p>
  </section>
}

function StartError({ error, retryable }: { error: unknown; retryable: boolean }) {
  const api = error instanceof ApiError ? error : null
  const conflict = api?.code === 'EXECUTION_INTENT_CONFLICT'
  return <section role="alert" className="rounded border border-fail/50 bg-elevated p-4"><h3 className="font-semibold text-primary">{retryable ? 'Execution acceptance response was not established' : conflict ? 'Execution intent conflicts with its accepted history' : 'Execution was not accepted'}</h3><p className="mt-1 text-sm text-secondary">{retryable ? 'The request may have been accepted. Retry uses the same durable intent key so it cannot create a second Execution.' : api?.message ?? 'The canonical Start API refused the request.'}</p></section>
}

function BlockedIntentRecovery({
  state,
  onRetry,
}: {
  state: Extract<RunIntentState, { phase: 'storage_blocked' }>
  onRetry: () => void
}) {
  return <section role="alert" className="rounded-lg border border-fail/50 bg-surface p-4"><h2 className="font-semibold text-primary">Run intent recovery is blocked</h2><p className="mt-1 text-sm text-secondary">{state.safeMessage}</p><p className="mt-1 text-xs text-muted">The prior intent will not be cleared or replaced. Retry only re-reads and reconciles durable intent authority.</p><button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-primary"><RefreshCw size={15} /> Retry intent storage recovery</button></section>
}

function RunIntentAuthoritySummary({ project, state, viewedExecutionId }: { project: string; state: RunIntentState; viewedExecutionId: string | null }) {
  const selection = intentSelection(state)
  if (!selection || !isRunIntentSelectionLocked(state)) return null
  const acceptedExecutionId = intentAcceptedExecutionId(state)
  return <section aria-labelledby="active-run-intent-authority" className="rounded-lg border border-brand/40 bg-surface p-4"><h2 id="active-run-intent-authority" className="font-semibold text-primary">Active Run intent authority</h2><p className="mt-1 text-sm text-secondary">Revision {selection.revision} and the ordered Definition identities below are immutable until this intent is safely retired.</p><ol className="mt-3 space-y-1 text-xs text-secondary">{selection.definitionIds.map((definitionId, index) => <li key={`${definitionId}-${index}`} className="break-all font-mono">{index + 1}. {definitionId}</li>)}</ol>{acceptedExecutionId && <p className="mt-3 break-all text-xs text-secondary">Accepted Execution authority: <code>{acceptedExecutionId}</code></p>}{viewedExecutionId && acceptedExecutionId && viewedExecutionId !== acceptedExecutionId && <div role="status" className="mt-2 text-xs text-flaky"><p>Viewed Execution {viewedExecutionId} is display-only context. This intent remains bound to Execution {acceptedExecutionId}.</p><Link className="mt-2 inline-block text-brand underline-offset-2 hover:underline" to={`/run?project=${encodeURIComponent(project)}&execution=${encodeURIComponent(acceptedExecutionId)}`}>Monitor the intent's accepted Execution</Link></div>}{viewedExecutionId && !acceptedExecutionId && <p role="status" className="mt-2 text-xs text-flaky">Viewed Execution {viewedExecutionId} is display-only context and cannot retire or replace this unresolved intent.</p>}</section>
}

function RunWorkspace({
  project,
  canonical,
  canonicalContentHash,
  v3Handoff,
  initialDefinitionIds,
  activeExecutionId,
  intentController,
  intentState,
  onIntentStateChange,
  onAccepted,
}: {
  project: string
  canonical: CanonicalV2TestSetPresentation | CanonicalV3TestSetPresentation
  canonicalContentHash: string
  v3Handoff?: { testSetId: string; definitionId: string; revision: number }
  initialDefinitionIds?: readonly string[]
  activeExecutionId: string | null
  intentController: RunIntentController
  intentState: RunIntentState
  onIntentStateChange: (state: RunIntentState) => void
  onAccepted: (accepted: CanonicalExecutionStartAccepted) => void
}) {
  const initialSelection = intentSelection(intentState)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialSelection?.definitionIds ?? [...(initialDefinitionIds ?? canonical.definitions.map(item => item.definitionId))])
  const [startAuthorityError, setStartAuthorityError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const start = useStartCanonicalExecution(intentController)
  // R17 replaces the old token transport; retained hook name is a safe
  // controller-bound mutation facade (useStartCanonicalExecution()).
  const submissionGate = useRef(createStartSubmissionGate())
  const retryable = intentState.phase === 'ambiguous'
  const selectionLocked = isRunIntentSelectionLocked(intentState)
  const visibleSelection = deriveVisibleRunSelection(intentState, selectedIds, canonical.revision)
  const hasUnacceptedIntent = intentState.phase === 'prepared' || intentState.phase === 'start_pending' || intentState.phase === 'ambiguous'
  const showStartWorkspace = !activeExecutionId || hasUnacceptedIntent
  const preflight = useExecutionPreflight(
    project,
    visibleSelection.definitionIds,
    visibleSelection.revision,
    visibleSelection.definitionIds.length > 0 && showStartWorkspace,
  )
  const preflightQueryAuthority: PreflightQueryAuthoritySnapshot = {
    data: preflight.data,
    isSuccess: preflight.isSuccess,
    isError: preflight.isError,
    isFetching: preflight.isFetching,
    dataUpdatedAt: preflight.dataUpdatedAt,
  }
  const freshPreflight = resolveFreshPreflightAuthority(
    project,
    visibleSelection.definitionIds,
    visibleSelection.revision,
    preflightQueryAuthority,
  )
  const v3Expectation: V3RunAuthorityExpectation | null = canonical.schemaVersion === 3
    ? { current: { contentHash: canonicalContentHash, testSet: canonical }, handoff: v3Handoff ?? null }
    : null
  const v3Binding = v3Expectation
    ? resolveV3RunPreflightBinding(project, visibleSelection, v3Expectation, freshPreflight)
    : null
  const inventoryExpectation: RunInventoryAuthorityExpectation = canonical.schemaVersion === 3
    ? { schemaVersion: 3, authority: v3Expectation! }
    : { schemaVersion: 2 }
  const ready = canonical.schemaVersion === 3
    ? v3Binding !== null
    : freshPreflight?.aggregate.state === 'ready'
  const exposeStart = canonical.schemaVersion === 2 || ready
  const retryAuthorityPending = retryable && preflight.isFetching

  useEffect(() => {
    const authority = intentSelection(intentState)
    if (!authority || !isRunIntentSelectionLocked(intentState)) return
    setSelectedIds(current => sameRunSelection(
      { definitionIds: current, revision: authority.revision },
      authority,
    ) ? current : [...authority.definitionIds])
  }, [intentState])

  function toggleDefinition(definitionId: string) {
    if (selectionLocked || activeExecutionId) return
    setSelectedIds(current => current.includes(definitionId) ? current.filter(id => id !== definitionId) : [...current, definitionId])
  }

  async function submitStart() {
    const result = await submissionGate.current.run(() => executeCanonicalStartAction({
      controller: intentController,
      project,
      queryClient,
      readActiveExecutionId: () => activeExecutionId,
      readVisibleSelection: () => ({
        definitionIds: [...visibleSelection.definitionIds],
        revision: visibleSelection.revision,
      }),
      readInventoryAuthorityExpectation: () => inventoryExpectation,
      createIntentKey: createExecutionIntentKey,
      sendStart: () => intentController.start(),
      onIntentStateChange,
      onAccepted,
    }))
    if (!result) return
    if (result.kind === 'blocked') {
      setStartAuthorityError(result.reason === 'preflight_unavailable'
        ? 'Start was refused because current canonical preflight authority is unavailable or no longer matches the displayed selection.'
        : result.reason === 'active_execution'
          ? 'Start was refused because another Execution is the current display context.'
          : 'Start was refused because the current Run intent cannot safely enter acceptance.')
      return
    }
    setStartAuthorityError(null)
  }

  return <>
    {visibleSelection.definitionIds.length === 0 && showStartWorkspace && <BoundedState alert title="No Definitions selected" explanation={`Select at least one canonical v${canonical.schemaVersion} Definition before execution preflight can establish eligibility.`} />}
    {visibleSelection.definitionIds.length > 0 && showStartWorkspace && preflight.isFetching && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> {visibleSelection.source === 'active_intent' ? 'Revalidating recovered Run intent selection and revision…' : 'Revalidating live execution eligibility…'}</div>}
    {visibleSelection.definitionIds.length > 0 && showStartWorkspace && preflight.isError && <PreflightError error={preflight.error} />}
    {showStartWorkspace && freshPreflight && <>
      <aside className="flex gap-3 rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><AlertTriangle className="shrink-0 text-flaky" size={18} /><p><strong className="text-primary">Preflight is not execution.</strong> It re-read immutable v{canonical.schemaVersion} Definition authority and live prerequisites; no Execution, Run, or Result was created.</p></aside>
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.18em] text-brand">Live execution eligibility</p><h2 className="mt-1 text-xl font-semibold text-primary">{ready ? 'Eligible' : 'Blocked'}</h2><p className="mt-1 text-sm text-secondary">{freshPreflight.aggregate.explanation}</p></div><span className={`rounded-full border border-border px-3 py-1 text-sm font-semibold ${ready ? 'text-pass' : 'text-flaky'}`}>{STATE_LABEL[freshPreflight.aggregate.state]}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Intrinsic generation authority</dt><dd className="mt-1 text-secondary">{freshPreflight.boundaries.generationAuthority.replaceAll('_', ' ')}</dd></div><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Runner availability</dt><dd className="mt-1 text-secondary">{freshPreflight.liveEligibility.runner}</dd></div><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Credential availability</dt><dd className="mt-1 text-secondary">{freshPreflight.liveEligibility.credentials.replaceAll('_', ' ')}</dd></div></dl>
        {intentState.phase !== 'storage_blocked' && exposeStart && <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!ready || retryAuthorityPending || start.isPending || intentState.phase === 'accepted'} onClick={() => { void submitStart() }} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">{start.isPending ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}{start.isPending ? 'Submitting canonical intent…' : retryable ? 'Retry acceptance with same intent' : 'Run selected Definitions'}</button>{!ready && <p className="text-xs text-muted">Start remains disabled until current canonical preflight is eligible.</p>}{retryable && <p className="text-xs text-secondary">This retry reuses the unresolved durable intent key and the exact displayed ordered selection at revision {visibleSelection.revision}; it cannot create a second Execution.</p>}</div>}
        {intentState.phase !== 'storage_blocked' && canonical.schemaVersion === 3 && !ready && <p className="mt-4 text-xs text-muted">Start is not exposed because the selected v3 Definition is not bound to one exact eligible v3 preflight result for the current Test Set authority.</p>}
        {start.isError && <div className="mt-4"><StartError error={start.error} retryable={retryable} /></div>}
        {startAuthorityError && <p role="alert" className="mt-4 text-sm text-flaky">{startAuthorityError}</p>}
        {intentState.phase === 'retired' && intentState.cleanupIncomplete && <p role="status" className="mt-4 text-sm text-secondary">The prior intent was safely retired with an unusable tombstone. A new intent will replace it only after durable storage succeeds.</p>}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="authority-snapshot"><div className="flex items-center gap-2"><ShieldQuestion size={18} className="text-brand" /><h2 id="authority-snapshot" className="text-lg font-semibold text-primary">Sealed authority snapshot</h2></div><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Test Set</dt><dd className="font-mono text-secondary">{canonical.testSetId} · revision {canonical.revision}</dd></div><div><dt className="text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-secondary">{canonical.provenance.supportSealHash}</dd></div><div><dt className="text-muted">Model</dt><dd className="text-secondary">{canonical.provenance.modelVersion} (row {canonical.provenance.modelRowId})</dd></div><div><dt className="text-muted">Canonical support</dt><dd className="text-secondary">{canonical.provenance.supportingObservationCount} Observations · {canonical.provenance.supportingGapCount} Gaps · {canonical.provenance.subjectSupportCount} subject-support entries</dd></div></dl></section>
    </>}
    {showStartWorkspace && retryable && !freshPreflight && <section className="rounded-lg border border-flaky/50 bg-surface p-4"><h2 className="font-semibold text-primary">Execution acceptance is unresolved</h2><p className="mt-1 text-sm text-secondary">The recovered ordered selection at revision {visibleSelection.revision} is being revalidated. Acceptance retry remains blocked until current canonical preflight authority is established; the same durable intent key is retained.</p><button type="button" disabled={preflight.isFetching} onClick={() => { void preflight.refetch() }} className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-primary disabled:opacity-50"><RefreshCw className={preflight.isFetching ? 'animate-spin' : ''} size={16} /> Retry preflight validation</button>{startAuthorityError && <p role="alert" className="mt-4 text-sm text-flaky">{startAuthorityError}</p>}</section>}
    {showStartWorkspace && <section aria-labelledby="preflight-definitions"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 id="preflight-definitions" className="text-xl font-semibold text-primary">Canonical v{canonical.schemaVersion} Definitions</h2><p className="text-sm text-secondary">{visibleSelection.definitionIds.length} selected for displayed revision {visibleSelection.revision}{visibleSelection.revision !== canonical.revision ? `; current inventory revision is ${canonical.revision}` : ''}</p></div><div className="flex gap-2"><button type="button" disabled={selectionLocked} onClick={() => setSelectedIds(canonical.definitions.map(item => item.definitionId))} className="rounded border border-border px-3 py-1.5 text-xs text-primary disabled:opacity-50">Select all</button><button type="button" disabled={selectionLocked} onClick={() => setSelectedIds([])} className="rounded border border-border px-3 py-1.5 text-xs text-primary disabled:opacity-50">Clear</button></div></div><div className="grid gap-4">{canonical.definitions.map(definition => <DefinitionRow key={definition.definitionId} definition={definition} selected={visibleSelection.definitionIds.includes(definition.definitionId)} eligible={canonical.schemaVersion === 3 ? v3Binding?.definitionResults.some(item => item.definitionId === definition.definitionId) ?? false : freshPreflight?.definitionResults.some(item => item.definitionId === definition.definitionId && item.state === 'eligible' && item.schemaVersion === definition.schemaVersion) ?? false} disabled={selectionLocked} onToggle={() => toggleDefinition(definition.definitionId)} />)}</div></section>}
  </>
}

function ProjectRunExperience({ project }: { project: string }) {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const controllerRef = useRef<RunIntentController | null>(null)
  if (!controllerRef.current) controllerRef.current = new RunIntentController(browserRunIntentStorage(), project, queryClient)
  const intentController = controllerRef.current
  const [intentState, setIntentState] = useState<RunIntentState>(() => intentController.snapshot())
  useEffect(() => retainRunIntentAuthorities(intentController), [intentController])
  const requestedExecutionId = params.get('execution')
  const restoredAcceptance = intentState.phase === 'accepted' ? intentState.acceptance : null
  const activeExecutionId = requestedExecutionId ?? restoredAcceptance?.executionId ?? null
  const displayedAcceptance = restoredAcceptance?.executionId === activeExecutionId ? restoredAcceptance : null
  const inventory = useEvidenceBackedTests(project, null, null)
  const currentRecord = inventory.data?.current ?? null
  const current = currentRecord?.testSet ?? null
  const canonical = current?.schemaVersion === 2 || current?.schemaVersion === 3 ? current : null
  const definitionParam = params.get('definition')
  const revisionParam = params.get('revision')
  const m1Handoff = resolveM1RunHandoffState(
    project,
    definitionParam,
    revisionParam,
    M1RunHandoffSession.load(project),
    current as { testSetId: string; revision: number; schemaVersion: number; definitions: readonly { definitionId: string; schemaVersion: number }[] } | null,
    inventory.isSuccess || inventory.isError,
  )
  const m1HandoffRequested = m1Handoff.state !== 'absent'
  const m1HandoffReady = m1Handoff.state === 'ready'
  const m1HandoffBlocked = m1HandoffRequested && !m1HandoffReady
  const activeIntentSelection = intentSelection(intentState)
  const intentOwnsSelection = !!activeIntentSelection && isRunIntentSelectionLocked(intentState)

  function setExecution(accepted: CanonicalExecutionStartAccepted) {
    const next = new URLSearchParams(params)
    next.set('execution', accepted.executionId)
    next.delete('definition')
    next.delete('revision')
    M1RunHandoffSession.clear(project)
    setParams(next)
  }

  function prepareNewIntent(authority: FreshLifecycleAuthority) {
    const retired = intentController.retireAcceptedIntent(authority).safe
    setIntentState(intentController.snapshot())
    if (!retired) return
    const next = new URLSearchParams(params)
    next.delete('execution')
    setParams(next)
  }

  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div><h1 className="text-2xl font-semibold text-primary">Run</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Start and observe canonical Product execution while lifecycle, current evidence, and persisted terminal outcome remain separate truths.</p></div>
    {intentState.phase === 'storage_blocked' && <BlockedIntentRecovery state={intentState} onRetry={() => { intentController.reconcileBlockedIntentStorage(); setIntentState(intentController.snapshot()) }} />}
    <RunIntentAuthoritySummary project={project} state={intentState} viewedExecutionId={activeExecutionId} />
    {m1HandoffRequested && <M1RunHandoffNotice handoff={m1Handoff} />}
    {!project && <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Run" subtitle="Select a project to evaluate and execute its current canonical v2 Test Set." basePath="/run" /></section>}
    {project && activeExecutionId && <ExecutionMonitor project={project} executionId={activeExecutionId} acceptance={displayedAcceptance} intentController={intentController} onNewIntent={prepareNewIntent} />}
    {project && inventory.isLoading && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading canonical Test Definitions…</div>}
    {project && inventory.isError && <PreflightError error={inventory.error} />}
    {project && inventory.isSuccess && !current && !activeExecutionId && !m1HandoffRequested && <BoundedState title="No current Test Set revision" explanation="No Test Definition revision has been persisted for this project." />}
    {project && current?.schemaVersion === 1 && !activeExecutionId && !m1HandoffRequested && <section className="rounded-lg border border-flaky/50 bg-surface p-6"><h2 className="font-semibold text-flaky">LEGACY PROVENANCE — execution unsupported</h2><p className="mt-2 text-sm text-secondary">The current revision is historical v1 compatibility evidence. It remains readable on Test Cases but cannot enter new Product execution.</p><Link className="mt-3 inline-block text-brand underline-offset-2 hover:underline" to={`/tests?project=${encodeURIComponent(project)}`}>Open legacy Test Case quarantine</Link></section>}
    {project && canonical && canonical.definitions.length === 0 && !activeExecutionId && !intentOwnsSelection && !m1HandoffRequested && <BoundedState title="No canonical definitions" explanation={`The current v${canonical.schemaVersion} revision contains no Definitions eligible for execution preflight.`} />}
    {project && canonical && currentRecord && (canonical.definitions.length > 0 || intentOwnsSelection) && !m1HandoffBlocked && <RunWorkspace key={`${project}-${canonical.testSetId}-${canonical.revision}-${m1HandoffReady ? m1Handoff.definitionId : 'default'}`} project={project} canonical={canonical} canonicalContentHash={currentRecord.contentHash} v3Handoff={m1HandoffReady ? { testSetId: m1Handoff.testSetId, definitionId: m1Handoff.definitionId, revision: m1Handoff.revision } : undefined} initialDefinitionIds={m1HandoffReady ? [m1Handoff.definitionId] : undefined} activeExecutionId={activeExecutionId} intentController={intentController} intentState={intentState} onIntentStateChange={setIntentState} onAccepted={setExecution} />}
    {project && activeExecutionId && !canonical && inventory.isSuccess && <aside className="flex gap-3 rounded-lg border border-border bg-elevated p-4 text-sm text-secondary"><Ban className="shrink-0 text-muted" size={18} /><p>The selected Execution remains monitorable, but no current canonical v2 or v3 Test Set is available for a new Run.</p></aside>}
  </div>
}

export function RunPage() {
  const [params] = useSearchParams()
  const project = params.get('project')
  if (!project) return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6"><div><h1 className="text-2xl font-semibold text-primary">Run</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Start and observe canonical Product execution while lifecycle, current evidence, and persisted terminal outcome remain separate truths.</p></div><section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Run" subtitle="Select a project to evaluate and execute its current canonical v2 Test Set." basePath="/run" /></section></div>
  return <ProjectRunExperience key={project} project={project} />
}
