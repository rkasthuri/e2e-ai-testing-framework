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
import { runMigrations } from '../storage/migrate'
import { assertProductDatabaseAuthority } from '../storage/db'
import {
  DuplicateExecutionError,
  ExecutionRepository,
  StaleExecutionAuthorityError,
  type ExecutionTerminalOutcome,
  type CancellationRequestWrite,
} from '../storage/repositories/ExecutionRepository'
import { TestSetRepository, type TestInventoryRead } from '../storage/repositories/TestSetRepository'
import {
  PlaywrightPlanExecutor,
  readPlaywrightRunnerReadiness,
  type PlaywrightPlanExecutionResult,
  type PlaywrightRunnerReadiness,
} from './PlaywrightPlanExecutor'
import {
  credentialExecutionScope,
  type CredentialExecutionScope,
} from '../security/CredentialExecutionScope'
import { projectExecutablePlan, type CurrentProjectionAuthority, type CurrentV2ProjectionAuthority, type ProjectionResult } from './ExecutionProjectionService'
import { TestDefinitionAuthorityProjectionService } from '../test-design/TestDefinitionAuthorityProjectionService'
import { CanonicalRouteEvidenceProjection } from '../test-design/CanonicalRouteEvidenceProjection'
import { AuthenticationExpectationProjectionService } from '../test-design/AuthenticationExpectationProjection'
import type { CredentialReference } from '../security/CredentialExecutionScope'
import type { MaterializedExecutablePlan } from './ExecutablePlanContract'
import {
  ExecutionRunCoordinator,
  type ProductResultObservation,
  type ProductRunAdmission,
} from './ExecutionRunCoordinator'
import {
  ExecutionRecoveryCoordinator,
  type ExecutionRecoveryDecision,
} from './ExecutionRecoveryCoordinator'
import type { DurableExecutionRead } from './PersistedEvidenceAggregator'
import {
  GovernedExecutionCancellationToken,
  type ExecutionCancellationToken,
} from './ExecutionCancellationToken'

const PROCESS_INSTANCE_ID = `process-${crypto.randomUUID()}`
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

export type ExecutionStartRejectionCode =
  | 'empty_selection'
  | 'invalid_request'
  | 'stale_definition'
  | 'incompatible_definition'
  | 'legacy_provenance_unsupported'
  | 'support_seal_mismatch'
  | 'route_unknown'
  | 'route_conflicted'
  | 'authentication_unknown'
  | 'authentication_conflicted'
  | 'credentials_unavailable'
  | 'runner_unavailable'
  | 'conflicting_evidence'
  | 'preflight_source_invalid'
  | 'execution_already_active'
  | 'execution_persistence_unavailable'

export interface GovernedExecutionStartRequest {
  projectId: string
  definitionIds: string[]
  revision: number
  workspaceRoot: string
  credentialReference: CredentialReference
  runtime: { baseUrl: string; loginUrl?: string; navigationTimeoutMs?: number }
}

export type ExecutionPreflightResult =
  | { kind: 'ready'; plans: MaterializedExecutablePlan[]; current: Extract<TestInventoryRead['current'], object>; authority: CurrentV2ProjectionAuthority | CurrentProjectionAuthority }
  | { kind: 'rejected'; code: ExecutionStartRejectionCode; safeMessage: string }

export type ExecutionStartResult =
  | {
      kind: 'accepted'
      executionId: string
      startedAt: string
      executionPlanHash: string
      completion: Promise<void>
    }
  | { kind: 'rejected'; code: ExecutionStartRejectionCode; safeMessage: string }

export type ExecutionCancellationResult =
  | { kind: 'accepted'; state: 'cancellation_requested'; requestedAt: string; alreadyRequested: boolean }
  | { kind: 'rejected'; code: 'invalid_request' | 'execution_not_found' | 'execution_already_terminal' | 'execution_persistence_unavailable'; safeMessage: string }

interface DefinitionReader {
  readInventory(projectId: string, options?: { limit?: number; cursor?: string | null; definitionId?: string | null }): Promise<TestInventoryRead | { kind: 'invalid_cursor' }>
}

interface LifecycleRepository {
  beginExecution(input: Parameters<ExecutionRepository['beginExecution']>[0]): Promise<void>
  heartbeat(projectId: string, executionId: string, processInstanceId: string, occurredAt: string): Promise<void>
  completeExecution(projectId: string, executionId: string, processInstanceId: string, completedAt: string): Promise<void>
  failExecution(
    projectId: string,
    executionId: string,
    processInstanceId: string,
    completedAt: string,
    outcome: Exclude<ExecutionTerminalOutcome, 'completed' | 'interrupted'>,
    safeCode: string,
  ): Promise<void>
  requestCancellation(input: Parameters<ExecutionRepository['requestCancellation']>[0]): Promise<CancellationRequestWrite>
}

interface RecoveryCoordinator {
  reconcile(input: Parameters<ExecutionRecoveryCoordinator['reconcile']>[0]): Promise<ExecutionRecoveryDecision>
  reconcileProject(input: Parameters<ExecutionRecoveryCoordinator['reconcileProject']>[0]): Promise<ExecutionRecoveryDecision | null>
}

interface PlanExecutor {
  execute(
    plan: MaterializedExecutablePlan['value'],
    runtime: GovernedExecutionStartRequest['runtime'] & { credentialReference?: CredentialReference },
    cancellation?: ExecutionCancellationToken,
  ): Promise<PlaywrightPlanExecutionResult>
}

interface RunCoordinator {
  admitRun(input: ProductRunAdmission): ReturnType<ExecutionRunCoordinator['admitRun']>
  recordResult(input: ProductResultObservation): ReturnType<ExecutionRunCoordinator['recordResult']>
  terminalize(input: Parameters<ExecutionRunCoordinator['terminalize']>[0]): ReturnType<ExecutionRunCoordinator['terminalize']>
  terminalizeCancellation(input: Parameters<ExecutionRunCoordinator['terminalizeCancellation']>[0]): ReturnType<ExecutionRunCoordinator['terminalizeCancellation']>
}

interface Dependencies {
  repository?: LifecycleRepository
  definitions?: DefinitionReader
  credentials?: CredentialExecutionScope
  executor?: PlanExecutor
  coordinator?: RunCoordinator
  recovery?: RecoveryCoordinator
  runnerReadiness?: () => PlaywrightRunnerReadiness
  migrate?: () => Promise<void>
  project?: typeof projectExecutablePlan
  authorityProjection?: TestDefinitionAuthorityProjectionService
  routeProjection?: CanonicalRouteEvidenceProjection
  authenticationProjection?: AuthenticationExpectationProjectionService
  /** Explicit non-Product compatibility harness. Production defaults to refuse. */
  v1ExecutionPolicy?: 'refuse' | 'historical_compatibility'
  now?: () => string
  mintExecutionId?: () => string
  mintCancellationTokenId?: () => string
  processInstanceId?: string
}

function reject(code: ExecutionStartRejectionCode, safeMessage: string): ExecutionStartResult {
  return { kind: 'rejected', code, safeMessage }
}

function projectionRejection(result: Extract<ProjectionResult, { kind: 'failed' }>): ExecutionStartResult {
  const precise = new Set<ExecutionStartRejectionCode>([
    'stale_definition', 'conflicting_evidence', 'legacy_provenance_unsupported', 'support_seal_mismatch',
    'route_unknown', 'route_conflicted', 'authentication_unknown', 'authentication_conflicted',
  ])
  const code: ExecutionStartRejectionCode = precise.has(result.failure.code as ExecutionStartRejectionCode)
    ? result.failure.code as ExecutionStartRejectionCode
    : result.failure.code === 'projection_failure' ? 'preflight_source_invalid' : 'incompatible_definition'
  return reject(code, result.failure.explanation)
}

function selectionHash(plans: MaterializedExecutablePlan[]): string {
  if (plans.length === 1) return plans[0].fingerprint
  const semanticSelection = JSON.stringify({
    schemaVersion: 1,
    planFingerprints: plans.map(plan => plan.fingerprint),
  })
  return crypto.createHash('sha256').update(semanticSelection).digest('hex')
}

function routeSelectionIdentity(plans: MaterializedExecutablePlan[]): string {
  const identities = plans.map(plan => plan.value.schemaVersion === 2
    ? plan.value.provenance.routeEvidenceIdentityHash : '')
  return identities.length === 1 ? identities[0] : crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 2,
    routeEvidenceIdentityHashes: identities,
  })).digest('hex')
}

/**
 * Sole Product execution owner. It re-reads current definitions, projects the
 * executable plans, checks runner/credentials, commits atomic acceptance, and
 * invokes PlaywrightPlanExecutor. Routes and UI controllers never invoke the
 * runner or write lifecycle tables.
 */
export class ExecutionService {
  private readonly repository: LifecycleRepository
  private readonly definitions: DefinitionReader
  private readonly credentials: CredentialExecutionScope
  private readonly executor: PlanExecutor
  private readonly coordinator: RunCoordinator
  private readonly recovery: RecoveryCoordinator
  private readonly runnerReadiness: () => PlaywrightRunnerReadiness
  private readonly migrate: () => Promise<void>
  private readonly project: typeof projectExecutablePlan
  private readonly authorityProjection: TestDefinitionAuthorityProjectionService
  private readonly routeProjection: CanonicalRouteEvidenceProjection
  private readonly authenticationProjection: AuthenticationExpectationProjectionService
  private readonly v1ExecutionPolicy: 'refuse' | 'historical_compatibility'
  private readonly now: () => string
  private readonly mintExecutionId: () => string
  private readonly mintCancellationTokenId: () => string
  private readonly processInstanceId: string
  private readonly activeExecutions = new Set<string>()
  private readonly cancellationTokens = new Map<string, { projectId: string; token: GovernedExecutionCancellationToken }>()

  constructor(dependencies: Dependencies = {}) {
    this.repository = dependencies.repository ?? new ExecutionRepository()
    this.definitions = dependencies.definitions ?? new TestSetRepository()
    this.credentials = dependencies.credentials ?? credentialExecutionScope
    this.executor = dependencies.executor ?? new PlaywrightPlanExecutor(this.credentials)
    this.coordinator = dependencies.coordinator ?? new ExecutionRunCoordinator()
    this.recovery = dependencies.recovery ?? new ExecutionRecoveryCoordinator()
    this.runnerReadiness = dependencies.runnerReadiness ?? readPlaywrightRunnerReadiness
    this.migrate = dependencies.migrate ?? runMigrations
    this.project = dependencies.project ?? projectExecutablePlan
    this.authorityProjection = dependencies.authorityProjection ?? new TestDefinitionAuthorityProjectionService()
    this.routeProjection = dependencies.routeProjection ?? new CanonicalRouteEvidenceProjection()
    this.authenticationProjection = dependencies.authenticationProjection ?? new AuthenticationExpectationProjectionService()
    this.v1ExecutionPolicy = dependencies.v1ExecutionPolicy ?? 'refuse'
    this.now = dependencies.now ?? (() => new Date().toISOString())
    this.mintExecutionId = dependencies.mintExecutionId ?? (() => `execution-${crypto.randomUUID()}`)
    this.mintCancellationTokenId = dependencies.mintCancellationTokenId ?? (() => `cancellation-${crypto.randomUUID()}`)
    this.processInstanceId = dependencies.processInstanceId ?? PROCESS_INSTANCE_ID
  }

  async start(request: GovernedExecutionStartRequest): Promise<ExecutionStartResult> {
    if (!Array.isArray(request.definitionIds) || request.definitionIds.length === 0) {
      return reject('empty_selection', 'At least one current-revision definition must be selected.')
    }
    if (!SAFE_ID.test(request.projectId) || request.definitionIds.length > 50
      || request.definitionIds.some(id => !SAFE_ID.test(id))
      || new Set(request.definitionIds).size !== request.definitionIds.length
      || !Number.isSafeInteger(request.revision) || request.revision < 1
      || this.v1ExecutionPolicy !== 'historical_compatibility'
        && (typeof request.workspaceRoot !== 'string' || request.workspaceRoot.length < 1)) {
      return reject('invalid_request', 'The governed execution request is malformed.')
    }
    if (this.activeExecutions.has(request.projectId)) {
      return reject('execution_already_active', 'A Product UI execution is already active for this project.')
    }

    try {
      assertProductDatabaseAuthority()
      await this.migrate()
    } catch {
      return reject('execution_persistence_unavailable', 'The workspace execution schema could not be established safely.')
    }

    const preflight = await this.preflight(request)
    if (preflight.kind === 'rejected') return preflight
    const { plans, current, authority: currentAuthority } = preflight

    const executionId = this.mintExecutionId()
    let cancellation: GovernedExecutionCancellationToken
    try {
      cancellation = new GovernedExecutionCancellationToken(executionId, this.mintCancellationTokenId())
    } catch {
      return reject('invalid_request', 'The governed execution identity could not be established safely.')
    }
    const startedAt = this.now()
    const executionPlanHash = selectionHash(plans)
    const v2 = current.testSet.schemaVersion === 2
    const v2Authority = v2 ? currentAuthority as CurrentV2ProjectionAuthority : null
    const v1Authority = v2 ? null : currentAuthority as CurrentProjectionAuthority
    try {
      const existing = await this.recovery.reconcileProject({
        projectId: request.projectId,
        currentProcessInstanceId: this.processInstanceId,
        locallyActive: this.activeExecutions.has(request.projectId),
        now: startedAt,
      })
      if (existing?.action === 'untouched_active') throw new DuplicateExecutionError()
      await this.repository.beginExecution({
        executionId,
        projectId: request.projectId,
        processInstanceId: this.processInstanceId,
        startedAt,
        executionPlanHash,
        expectedTestSetId: current.testSet.testSetId,
        expectedRevision: current.testSet.revision,
        expectedTestSetContentHash: v2 ? current.contentHash : undefined,
        definitionSchemaVersion: v2 ? 2 : 1,
        expectedModelRowId: v2 ? v2Authority!.sealedAuthority.modelRowId : v1Authority!.model!.rowId,
        expectedModelVersion: v2 ? v2Authority!.sealedAuthority.modelVersion : v1Authority!.model!.version,
        sourceObservationId: v2 ? null : v1Authority!.sourceObservation!.id,
        supportSealHash: v2 ? v2Authority!.sealedAuthority.supportSealHash : null,
        routeEvidenceIdentityHash: v2 ? routeSelectionIdentity(plans) : null,
        authenticationExpectationIdentityHash: v2 && plans[0].value.schemaVersion === 2 ? plans[0].value.provenance.authenticationExpectationIdentityHash : null,
        manifestItems: plans.map((plan, index) => ({
          itemOrdinal: index + 1,
          definitionId: plan.value.definitionId,
          executablePlanHash: plan.fingerprint,
        })),
      })
    } catch (cause) {
      if (cause instanceof DuplicateExecutionError) {
        return reject('execution_already_active', 'A Product UI execution is already active for this project.')
      }
      if (cause instanceof StaleExecutionAuthorityError) return reject(cause.code, cause.message)
      return reject('execution_persistence_unavailable', 'Atomic execution acceptance did not commit.')
    }

    this.activeExecutions.add(request.projectId)
    this.cancellationTokens.set(executionId, { projectId: request.projectId, token: cancellation })
    const completion = this.runAccepted(request, executionId, plans, cancellation)
    return { kind: 'accepted', executionId, startedAt, executionPlanHash, completion }
  }

  async preflight(request: GovernedExecutionStartRequest): Promise<ExecutionPreflightResult> {
    let inventory: TestInventoryRead | { kind: 'invalid_cursor' }
    try { inventory = await this.definitions.readInventory(request.projectId, { limit: 1 }) }
    catch { return { kind: 'rejected', code: 'preflight_source_invalid', safeMessage: 'The current test-definition authority could not be re-read safely.' } }
    if ('kind' in inventory || !inventory.current) return { kind: 'rejected', code: 'stale_definition', safeMessage: 'No current Test Set revision is available for execution.' }
    const current = inventory.current
    if (current.testSet.revision !== request.revision) return { kind: 'rejected', code: 'stale_definition', safeMessage: 'The requested Test Set revision is no longer current.' }
    if (current.testSet.schemaVersion === 1) {
      if (this.v1ExecutionPolicy !== 'historical_compatibility') return { kind: 'rejected', code: 'legacy_provenance_unsupported', safeMessage: 'Historical v1 definitions remain readable but are not eligible for new Product execution.' }
      const readiness = this.runnerReadiness()
      if (!readiness.available) return { kind: 'rejected', code: 'runner_unavailable', safeMessage: readiness.safeMessage }
      const legacyAuthority = (request as GovernedExecutionStartRequest & { projectionAuthority?: CurrentProjectionAuthority }).projectionAuthority
      if (!legacyAuthority) return { kind: 'rejected', code: 'legacy_provenance_unsupported', safeMessage: 'Exact historical v1 compatibility authority was not supplied by the governed harness.' }
      const authority: CurrentProjectionAuthority = { ...legacyAuthority,
        currentRevision: { revision: current.testSet.revision, testSetId: current.testSet.testSetId } }
      const byId = new Map(current.testSet.definitions.map(definition => [definition.id, definition]))
      if (request.definitionIds.some(id => !byId.has(id))) return { kind: 'rejected', code: 'stale_definition', safeMessage: 'A selected legacy definition is not current.' }
      const plans: MaterializedExecutablePlan[] = []
      for (const definitionId of request.definitionIds) {
        const projection = this.project({ definition: byId.get(definitionId)!, definitionSchemaVersion: 1,
          definitionTestSetId: current.testSet.testSetId, definitionRevision: current.testSet.revision,
          testSetContentHash: current.contentHash }, authority, this.now())
        if (projection.kind === 'failed') return projectionRejection(projection) as Extract<ExecutionStartResult, { kind: 'rejected' }>
        if (projection.plan.value.schemaVersion !== 1) return { kind: 'rejected', code: 'legacy_provenance_unsupported', safeMessage: 'Legacy compatibility produced a mixed-schema plan.' }
        if (projection.plan.value.authenticationRequired
          && !this.credentials.isAvailable(projection.plan.value.authenticationSetup!.credentialReference)) {
          return { kind: 'rejected', code: 'credentials_unavailable', safeMessage: 'The governed credential reference does not currently resolve.' }
        }
        plans.push(projection.plan)
      }
      return { kind: 'ready', plans, current, authority }
    }
    const readiness = this.runnerReadiness()
    if (!readiness.available) return { kind: 'rejected', code: 'runner_unavailable', safeMessage: readiness.safeMessage }
    const authorityRead = await this.authorityProjection.read(request.projectId)
    if (authorityRead.kind !== 'ok') return { kind: 'rejected', code: authorityRead.code === 'support_seal_mismatch' ? 'support_seal_mismatch' : 'conflicting_evidence', safeMessage: authorityRead.safeMessage }
    const routeRead = await this.routeProjection.read(request.projectId, authorityRead.authority)
    if (routeRead.kind !== 'ok') return { kind: 'rejected', code: routeRead.code === 'route_conflicted' ? 'route_conflicted' : routeRead.code === 'route_unknown' ? 'route_unknown' : 'conflicting_evidence', safeMessage: routeRead.safeMessage }
    const authentication = this.authenticationProjection.read(request.projectId, request.workspaceRoot)
    if (authentication.state === 'unknown') return { kind: 'rejected', code: 'authentication_unknown', safeMessage: 'Authentication expectation is unknown; execution is refused.' }
    if (authentication.state === 'conflicted') return { kind: 'rejected', code: 'authentication_conflicted', safeMessage: 'Authentication expectation is conflicted; execution is refused.' }
    if (authentication.state === 'required' && !this.credentials.isAvailable(request.credentialReference)) {
      return { kind: 'rejected', code: 'credentials_unavailable', safeMessage: 'The governed runtime credential binding does not currently resolve.' }
    }
    const authority: CurrentV2ProjectionAuthority = {
      currentRevision: { revision: current.testSet.revision, testSetId: current.testSet.testSetId, contentHash: current.contentHash },
      sealedAuthority: authorityRead.authority,
      routeEvidence: routeRead.evidence,
      authenticationExpectation: authentication,
    }
    const byId = new Map(current.testSet.definitions.map(definition => [definition.id, definition]))
    if (request.definitionIds.some(id => !byId.has(id))) return { kind: 'rejected', code: 'stale_definition', safeMessage: 'A selected definition is not part of the current revision.' }
    const plans: MaterializedExecutablePlan[] = []
    for (const definitionId of request.definitionIds) {
      const projection = this.project({ definition: byId.get(definitionId)!, definitionSchemaVersion: 2,
        definitionTestSetId: current.testSet.testSetId, definitionRevision: current.testSet.revision,
        testSetContentHash: current.contentHash }, authority, this.now())
      if (projection.kind === 'failed') {
        const rejected = projectionRejection(projection) as Extract<ExecutionStartResult, { kind: 'rejected' }>
        return rejected
      }
      plans.push(projection.plan)
    }
    return { kind: 'ready', plans, current, authority }
  }

  async readStatus(projectId: string, executionId: string): Promise<DurableExecutionRead | null> {
    const decision = await this.recovery.reconcile({
      projectId,
      executionId,
      currentProcessInstanceId: this.processInstanceId,
      locallyActive: this.cancellationTokens.get(executionId)?.projectId === projectId,
      now: this.now(),
    })
    return decision.status
  }

  async cancel(projectId: string, executionId: string): Promise<ExecutionCancellationResult> {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(executionId)) {
      return { kind: 'rejected', code: 'invalid_request', safeMessage: 'The cancellation request is malformed.' }
    }
    try {
      assertProductDatabaseAuthority()
      await this.migrate()
      const written = await this.repository.requestCancellation({
        projectId,
        executionId,
        requestProcessInstanceId: this.processInstanceId,
        requestedAt: this.now(),
      })
      if (written.kind === 'not_found') {
        return { kind: 'rejected', code: 'execution_not_found', safeMessage: 'Execution not found.' }
      }
      if (written.kind === 'already_terminal') {
        return {
          kind: 'rejected',
          code: 'execution_already_terminal',
          safeMessage: `The execution is already terminal with lifecycle ${written.lifecycle}.`,
        }
      }
      const active = this.cancellationTokens.get(executionId)
      if (active?.projectId === projectId) active.token.request()
      else {
        // On-contact recovery can terminalize a missing/stale owner from the
        // durable request. A healthy foreign owner remains untouched.
        await this.recovery.reconcile({
          projectId,
          executionId,
          currentProcessInstanceId: this.processInstanceId,
          locallyActive: false,
          now: this.now(),
        }).catch(() => undefined)
      }
      return {
        kind: 'accepted',
        state: 'cancellation_requested',
        requestedAt: written.requestedAt,
        alreadyRequested: written.kind === 'already_requested',
      }
    } catch {
      return {
        kind: 'rejected',
        code: 'execution_persistence_unavailable',
        safeMessage: 'Cancellation intent could not be persisted safely.',
      }
    }
  }

  private async runAccepted(
    request: GovernedExecutionStartRequest,
    executionId: string,
    plans: MaterializedExecutablePlan[],
    cancellation: GovernedExecutionCancellationToken,
  ): Promise<void> {
    let runId: string | null = null
    try {
      if (cancellation.isCancellationRequested()) {
        await this.coordinator.terminalizeCancellation({
          executionId, projectId: request.projectId, processInstanceId: this.processInstanceId,
          runId: null, completedAt: this.now(),
        })
        return
      }
      const run = await this.coordinator.admitRun({
        executionId,
        projectId: request.projectId,
        processInstanceId: this.processInstanceId,
        expectedResultCount: plans.length,
        runnerAdapter: 'playwright-plan-executor/v1',
        environmentSnapshot: { environment: 'local', browser: 'chromium', headless: true },
        startedAt: this.now(),
      })
      runId = run.run_id
      for (const [index, plan] of plans.entries()) {
        if (cancellation.isCancellationRequested()) {
          await this.coordinator.terminalizeCancellation({
            executionId, projectId: request.projectId, processInstanceId: this.processInstanceId,
            runId, completedAt: this.now(),
          })
          return
        }
        await this.repository.heartbeat(request.projectId, executionId, this.processInstanceId, this.now())
        const resultStartedAt = this.now()
        let result: PlaywrightPlanExecutionResult
        try {
          result = await this.executor.execute(plan.value, {
            ...request.runtime,
            ...(plan.value.schemaVersion === 2 && plan.value.authenticationExpectation.state === 'required'
              ? { credentialReference: request.credentialReference }
              : {}),
          }, cancellation)
        } catch {
          // A thrown adapter error is not structured per-definition truth.
          // Preserve the admitted Run with no fabricated Result for recovery.
          return
        }
        if (result.status === 'cancelled') {
          await this.coordinator.terminalizeCancellation({
            executionId, projectId: request.projectId, processInstanceId: this.processInstanceId,
            runId, completedAt: this.now(),
          })
          return
        }
        const resultCompletedAt = this.now()
        await this.coordinator.recordResult({
          executionId,
          runId: run.run_id,
          itemOrdinal: index + 1,
          plan,
          observed: result,
          startedAt: resultStartedAt,
          completedAt: resultCompletedAt,
        })
        await this.repository.heartbeat(request.projectId, executionId, this.processInstanceId, this.now())
        if (cancellation.isCancellationRequested()) {
          await this.coordinator.terminalizeCancellation({
            executionId, projectId: request.projectId, processInstanceId: this.processInstanceId,
            runId, completedAt: this.now(),
          })
          return
        }
        if (result.status !== 'completed') break
      }
      await this.coordinator.terminalize({
        executionId,
        projectId: request.projectId,
        processInstanceId: this.processInstanceId,
        runId: run.run_id,
        completedAt: this.now(),
      })
    } catch {
      // Admission, Result, or terminal persistence failure cannot be converted
      // into evidence. The durable start/lock and any committed Result remain.
      if (cancellation.isCancellationRequested()) {
        await this.coordinator.terminalizeCancellation({
          executionId, projectId: request.projectId, processInstanceId: this.processInstanceId,
          runId, completedAt: this.now(),
        }).catch(() => undefined)
      }
    } finally {
      this.activeExecutions.delete(request.projectId)
      this.cancellationTokens.delete(executionId)
    }
  }
}

export const executionService = new ExecutionService()
