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
import * as crypto from 'crypto'
import { workspaceResolver } from './WorkspaceResolver'
import { credentialResolver } from './credentials/CredentialResolver'
import { credentialStore, CredentialStore } from './credentials/CredentialStore'
import { CredentialErrorBase } from './credentials/CredentialTypes'
import { planCrawlCredentials, type EngineConfigView } from './credentials/CredentialPlanner'
import { SerialQueue } from './SerialQueue'

/**
 * ExecutionContext — Phase 1: runs in-process. Phase 2: submits to a cloud job
 * queue. Nova-approved: wraps ALL engine calls. Routes must NEVER call
 * CrawlRunner/GeneratorRunner/VerificationRunner directly — always go through
 * ExecutionContext, so Phase 2 can swap in-process for a queue with no route
 * changes.
 *
 * Engine imports are DYNAMIC and via a variable path so forge-ui's tsc does not
 * pull the engine (a separate tsconfig/compilation) into the UI build — the
 * one-directional boundary holds (forge-ui → src, never the reverse). Resolved
 * at runtime under tsx.
 */
export interface Job {
  type: 'crawl' | 'generate' | 'run' | 'verify'
  appName: string
  options: Record<string, unknown>
}

export interface JobResult {
  jobId: string
  status: 'completed' | 'failed'
  result?: unknown
  error?: string
  /**
   * Stable, machine-readable discriminator for an operator-facing engine
   * precondition failure (engine OperatorFacingError.code, e.g. 'MODEL_NOT_FOUND').
   * Present only when the caught error carried one; lets JobRunner surface the
   * message to the Mission Timeline without importing the engine error class.
   */
  errorCode?: string
  /** Strictly selected, non-secret engine progress for truthful crawl failure finalization. */
  failure?: unknown
}

/**
 * Duck-typed detector for an engine OperatorFacingError's stable code. Checked
 * STRUCTURALLY (brand + string code) so forge-ui never statically imports the
 * engine error class (engine imports here are dynamic by design), and so it never
 * false-positives on Node's own coded errors (ENOENT, …), which lack the brand.
 */
function operatorFacingCode(err: unknown): string | undefined {
  if (
    err && typeof err === 'object' &&
    (err as { operatorFacing?: unknown }).operatorFacing === true &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code
  }
  return undefined
}

const SAFE_OPERATOR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  MODEL_NOT_FOUND: 'No current App Model is available. Run a crawl before continuing.',
  MODEL_EMPTY: 'The current App Model contains no supported subjects for this operation.',
})

function governedRuntimeError(err: unknown): { code: string; message: string } {
  if (err instanceof CredentialErrorBase) {
    return { code: 'CREDENTIALS_REQUIRED', message: err.message }
  }
  const operatorCode = operatorFacingCode(err)
  if (operatorCode && SAFE_OPERATOR_MESSAGES[operatorCode]) {
    return { code: operatorCode, message: SAFE_OPERATOR_MESSAGES[operatorCode] }
  }
  return {
    code: 'ENGINE_OPERATION_FAILED',
    message: 'The engine operation failed without safe diagnostic detail.',
  }
}

function safeObservedLocation(value: unknown): string {
  if (typeof value !== 'string') return '[location-withheld]'
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    if (value.startsWith('/')) return value.split(/[?#]/, 1)[0]
    return '[location-withheld]'
  }
}

/**
 * Mirror only the explicitly safe recovery fields across the dynamic engine
 * boundary. The raw candidate, invalid model payload, connection information,
 * and credential-bearing options are never copied.
 */
function safeCrawlFailure(err: unknown): unknown | undefined {
  if (!err || typeof err !== 'object') return undefined
  const source = (err as { safeCrawlFailure?: unknown }).safeCrawlFailure
  if (!source || typeof source !== 'object') return undefined
  const value = source as Record<string, any>
  if (
    value.kind !== 'guarded-app-model-recovery-failed'
    || !Number.isSafeInteger(value.sourceRowId)
    || typeof value.sourceVersion !== 'string'
    || typeof value.sourceFingerprint !== 'string'
    || typeof value.detectedAt !== 'string'
    || typeof value.capturedAt !== 'string'
    || !value.phases || typeof value.phases !== 'object'
    || !value.persistenceDiagnostic || typeof value.persistenceDiagnostic !== 'object'
  ) return undefined

  const causes = Array.isArray(value.persistenceDiagnostic.causeChain)
    ? value.persistenceDiagnostic.causeChain
      .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
      .slice(0, 8)
      .map((item: Record<string, unknown>) => ({
        name: typeof item.name === 'string' ? item.name : 'Error',
        code: typeof item.code === 'string' ? item.code : null,
        summary: 'Cause detail was withheld at the credential boundary.',
      }))
    : []
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
  const structuralIssues = Array.isArray(value.persistenceDiagnostic.structuralIssues)
    ? value.persistenceDiagnostic.structuralIssues
      .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
      .slice(0, 128)
      .map((item: Record<string, unknown>) => ({
        path: typeof item.path === 'string' && item.path.startsWith('/') ? item.path : '/',
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
    observedSubjects: Array.isArray(value.observedSubjects)
      ? value.observedSubjects
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item: Record<string, unknown>) => ({
          id: typeof item.id === 'string' ? item.id : '',
          kind: item.kind === 'route' ? 'route' : 'page',
          value: safeObservedLocation(item.value),
        }))
      : [],
    crawlDiagnostics: Array.isArray(value.crawlDiagnostics)
      ? value.crawlDiagnostics
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item: Record<string, unknown>) => ({
          scope: typeof item.scope === 'string' ? item.scope : 'page',
          target: safeObservedLocation(item.target),
          reason: typeof item.reason === 'string' ? item.reason : 'unknown',
          detail: 'Diagnostic detail was withheld at the credential boundary.',
        }))
      : [],
    roleAuthOutcomes: Array.isArray(value.roleAuthOutcomes)
      ? value.roleAuthOutcomes
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item: Record<string, unknown>) => ({
          roleId: typeof item.roleId === 'string' ? item.roleId : '',
          outcome: item.outcome === 'succeeded' || item.outcome === 'failed'
            ? item.outcome
            : 'unknown',
        }))
      : [],
    phases: {
      crawlExecution: 'completed',
      authentication: value.phases.authentication === 'succeeded' || value.phases.authentication === 'failed'
        ? value.phases.authentication
        : 'unknown',
      modelGeneration: value.phases.modelGeneration === 'validated' ? 'validated' : 'failed',
      guardedPersistence: value.phases.guardedPersistence === 'succeeded'
        || value.phases.guardedPersistence === 'failed'
        ? value.phases.guardedPersistence
        : 'not_attempted',
      compatibilityProjection: value.phases.compatibilityProjection === 'failed'
        ? 'failed'
        : 'not_attempted',
    },
    persistenceDiagnostic: {
      stage: typeof value.persistenceDiagnostic.stage === 'string'
        ? value.persistenceDiagnostic.stage
        : 'service-boundary',
      causeChain: causes,
      ...(structuralIssues.length > 0 ? { structuralIssues } : {}),
    },
  }
}

const ENGINE = {
  crawlRunner:  '../../../src/core/runner/CrawlRunner',
  generator:    '../../../src/core/onboarding/GeneratorRunner',
  verifier:     '../../../src/core/onboarding/VerificationRunner',
  db:           '../../../src/core/storage/db',
  appModels:    '../../../src/core/storage/AppModelService',
  canonical:    '../../../src/core/storage/JsonAppModelMigrationPlanner',
  testSets:     '../../../src/core/storage/TestSetService',
  testCasePresentation: '../../../src/core/test-design/TestCasePresentationService',
  compatibility: '../../../src/core/execution/DefinitionCompatibilityEvaluator',
  planExecutor: '../../../src/core/execution/PlaywrightPlanExecutor',
  executionService: '../../../src/core/execution/ExecutionService',
  executionResultProjection: '../../../src/core/execution/ExecutionResultProjectionService',
  observations: '../../../src/core/observation/ObservationService',
  observationProjection: '../../../src/core/observation/ObservationReadProjectionService',
  testDefinitionAuthority: '../../../src/core/test-design/TestDefinitionAuthorityProjectionService',
  canonicalTestDefinitionGeneration: '../../../src/core/test-design/CanonicalTestDefinitionGenerationService',
}

/** Structural mirror of DefinitionCompatibilityEvaluator's CompatibilityIntrinsicInput/Result — forge-ui never statically imports src/. */
export interface DefinitionCompatibilityInput {
  steps: Array<{ kind: string; subjectId: string }>
  oracle: { kind: string; subjectId: string }
  authenticationRequired: boolean | undefined
  authenticationSetup?: { mechanism: string }
}
export type DefinitionCompatibilityResult =
  | { state: 'compatible'; explanation: string }
  | { state: 'blocked'; reason: string; explanation: string }

/** ADR-014 — close the open project DB only when switching to a different one. */
export function shouldCloseDb(lastDbPath: string | null, targetDbPath: string): boolean {
  return lastDbPath !== null && lastDbPath !== targetDbPath
}

export class ExecutionContext {
  constructor(private readonly workspaces = workspaceResolver) {}

  // ADR-014 — one active execution engine per instance: every submit runs under
  // this serial queue, and the project DB is closed-on-switch between apps.
  private readonly queue = new SerialQueue()
  private lastDbPath: string | null = null
  private activeProductExecution: { appName: string; executionId: string; completion: Promise<void> } | null = null

  submit(job: Job): Promise<JobResult> {
    // Serialize the WHOLE run sequence (creds pre-flight → DB switch → engine)
    // so DB-touching runs never overlap (TD-UI-020).
    return this.queue.run(() => this.runGuarded(job))
  }

  /**
   * TD-UI-069C-C-R — the ONE bridge to DefinitionCompatibilityEvaluator, the
   * single shared owner of definition-compatibility truth (also called
   * directly, in-process, by TestDefinitionContract's generator and
   * ExecutionProjectionService — this method exists so forge-ui reaches the
   * exact same pure function rather than re-deciding compatibility from a
   * possibly-stale stored field). Pure and DB-free — not routed through the
   * serial queue, unlike every other method here, because there is no shared
   * state to serialize against.
   */
  async evaluateDefinitionCompatibility(inputs: DefinitionCompatibilityInput[]): Promise<DefinitionCompatibilityResult[]> {
    const mod: any = await import(ENGINE.compatibility)
    return inputs.map(input => mod.evaluateIntrinsicCompatibility(input))
  }

  /** Read-only adapter/install evidence; does not launch Playwright. */
  async readExecutionRunnerReadiness(): Promise<{ available: boolean; safeCode: string; safeMessage: string }> {
    try {
      const mod: any = await import(ENGINE.planExecutor)
      return mod.readPlaywrightRunnerReadiness()
    } catch {
      return {
        available: false,
        safeCode: 'runner_unavailable',
        safeMessage: 'The governed Playwright adapter could not be loaded.',
      }
    }
  }

  /**
   * ADR-024 bridge. The engine ExecutionService owns preflight recheck,
   * durable acceptance, runner invocation, and terminal persistence. This
   * method only scopes the workspace DB and preserves the one-way boundary.
   */
  startProductExecution(appName: string, input: Record<string, unknown>): Promise<any> {
    return this.queue.run(async () => {
      if (this.activeProductExecution && this.activeProductExecution.appName !== appName) {
        return {
          kind: 'rejected',
          code: 'execution_already_active',
          safeMessage: 'A Product UI execution is already active in this process; multi-project execution is not supported in this lifecycle slice.',
        }
      }
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.executionService)
      const result = await mod.executionService.start({
        ...input,
        projectId: appName,
        workspaceRoot: this.workspaces.resolve(appName).root,
        credentialReference: credentialStore.read(appName) ?? CredentialStore.defaultReference(appName),
      })
      if (result.kind === 'accepted' && !result.replayed) {
        const completion = result.completion as Promise<void>
        this.activeProductExecution = { appName, executionId: result.executionId, completion }
        void completion.finally(() => {
          if (this.activeProductExecution?.executionId === result.executionId) this.activeProductExecution = null
        })
        return {
          kind: result.kind,
          executionId: result.executionId,
          startedAt: result.startedAt,
          executionPlanHash: result.executionPlanHash,
          replayed: false,
        }
      }
      return result
    })
  }

  /** B4: core-owned live v2 eligibility; no identity, lock, or persistence. */
  readProductExecutionPreflight(appName: string, input: Record<string, unknown>): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.executionService)
      return mod.executionService.preflight({
        ...input,
        projectId: appName,
        workspaceRoot: this.workspaces.resolve(appName).root,
        credentialReference: credentialStore.read(appName) ?? CredentialStore.defaultReference(appName),
      })
    })
  }

  readProductExecutionStatus(appName: string, executionId: string): Promise<unknown> {
    return this.queue.run(async () => {
      if (this.activeProductExecution && this.activeProductExecution.appName !== appName) {
        throw new Error('Product execution status for another workspace is unavailable while an execution owns the database boundary.')
      }
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.executionService)
      return mod.executionService.readStatus(appName, executionId)
    })
  }

  /** Read-only Product Results view. It does not invoke lifecycle recovery. */
  readProductExecutionResults(appName: string, executionId: string): Promise<unknown> {
    return this.queue.run(async () => {
      if (this.activeProductExecution && this.activeProductExecution.appName !== appName) {
        throw new Error('Product execution Results for another workspace are unavailable while an execution owns the database boundary.')
      }
      await this.switchDatabaseIfNeeded(appName)
      const mod = await import(ENGINE.executionResultProjection) as {
        executionResultProjectionService: { read(projectId: string, id: string): Promise<unknown> }
      }
      return mod.executionResultProjectionService.read(appName, executionId)
    })
  }

  /** Bounded workspace-authoritative Product execution summaries only. */
  listProductExecutionResults(appName: string, limit: number): Promise<unknown> {
    return this.queue.run(async () => {
      if (this.activeProductExecution && this.activeProductExecution.appName !== appName) {
        throw new Error('Product execution Results for another workspace are unavailable while an execution owns the database boundary.')
      }
      await this.switchDatabaseIfNeeded(appName)
      const mod = await import(ENGINE.executionResultProjection) as {
        executionResultProjectionService: { list(projectId: string, requestedLimit: number): Promise<unknown> }
      }
      return mod.executionResultProjectionService.list(appName, limit)
    })
  }

  /** ADR-024 bridge: ExecutionService alone persists and signals cancellation. */
  cancelProductExecution(appName: string, executionId: string): Promise<unknown> {
    return this.queue.run(async () => {
      if (this.activeProductExecution && this.activeProductExecution.appName !== appName) {
        throw new Error('Product execution cancellation for another workspace is unavailable while an execution owns the database boundary.')
      }
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.executionService)
      return mod.executionService.cancel(appName, executionId)
    })
  }

  /** TD-181: UI App Model reads cross the engine boundary through SQLite. */
  readAppModel(appName: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.appModels)
      return new mod.AppModelService().requireActive(appName)
    })
  }

  /** Restart-only reconciliation/read for a crawl job absent from JobRunner memory. */
  recoverCrawlObservation(appName: string, operationId: string): Promise<unknown | null> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.observationProjection)
      return new mod.ObservationReadProjectionService().readOperation(appName, operationId)
    })
  }

  /** B2: sole canonical read projection; no recovery or persistence occurs. */
  readObservationProjection(
    appName: string,
    options: { runId?: string | null; limit?: number } = {},
  ): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.observationProjection)
      return new mod.ObservationReadProjectionService().readProject(appName, options)
    })
  }

  /** B2: canonical history presentation derived inside the core projection. */
  readObservationHistoryView(appName: string, options: Record<string, unknown>): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.observationProjection)
      return new mod.ObservationReadProjectionService().readHistoryView(appName, options)
    })
  }

  /** B2: latest adopted crawl projection in the stable UI contract. */
  readLatestObservationView(appName: string): Promise<unknown | null> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.observationProjection)
      return new mod.ObservationReadProjectionService().readLatestView(appName)
    })
  }

  /** B2: read-only application evidence inventory over canonical Observation projection. */
  readApplicationEvidenceInventory(appName: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.observationProjection)
      return new mod.ApplicationEvidenceInventoryProjection().read(appName, options)
    })
  }

  /** TD-ARCH-004-B2: read-only, sealed v2 Test Definition authority admission. */
  readTestDefinitionAuthority(appName: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.testDefinitionAuthority)
      return new mod.TestDefinitionAuthorityProjectionService().read(appName)
    })
  }

  /** B3: core composes sealed authority, route evidence, and auth expectation. */
  readCanonicalTestDefinitionAdmission(appName: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.canonicalTestDefinitionGeneration)
      return new mod.CanonicalTestDefinitionGenerationService()
        .readAdmission(appName, this.workspaces.resolve(appName).root)
    })
  }

  /** B3: caller supplies only project identity and generation intent. */
  generateCanonicalTestSet(appName: string, generationId: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.canonicalTestDefinitionGeneration)
      return new mod.CanonicalTestDefinitionGenerationService()
        .generate(appName, this.workspaces.resolve(appName).root, generationId)
    })
  }

  /**
   * TD-UI-065A bounded App Model history read. SQLite remains authoritative;
   * compatibility JSON is read only to classify its projection relationship.
   */
  readAppModelHistory(
    appName: string,
    options: { limit: number; cursor: string | null; requestedRowId: number | null },
  ): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const appModels: any = await import(ENGINE.appModels)
      const history = await new appModels.AppModelService().readHistory(appName, options)
      if (history.kind !== 'ok') return history

      const active = history.activeModel
      let projectionState: 'current' | 'unavailable' | 'invalid' | 'mismatched' | 'not_evaluated'
        = 'not_evaluated'
      if (history.activeCount === 1 && active?.validation === 'valid') {
        const projectionPath = path.join(
          this.workspaces.resolve(appName).root,
          'models',
          appName,
          'app-model.json',
        )
        if (!fs.existsSync(projectionPath)) {
          projectionState = 'unavailable'
        } else {
          try {
            const projected = JSON.parse(fs.readFileSync(projectionPath, 'utf8'))
            const canonical: any = await import(ENGINE.canonical)
            const canonicalJson = canonical.canonicalJson
              ?? canonical.default?.canonicalJson
            const projectedHash = crypto.createHash('sha256')
              .update(canonicalJson(projected))
              .digest('hex')
            projectionState = projectedHash === active.modelFingerprint
              ? 'current'
              : 'mismatched'
          } catch {
            projectionState = 'invalid'
          }
        }
      }
      return { ...history, projectionState }
    })
  }

  readTestInventory(appName: string, options: { limit: number; cursor: string | null; definitionId: string | null }): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.testCasePresentation)
      return mod.testCasePresentationService.read(appName, options)
    })
  }

  generateTestSet(appName: string, input: Record<string, unknown>, generationId: string): Promise<any> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.testSets)
      return mod.testSetService.generate(input, generationId)
    })
  }

  readTestGenerationStatus(appName: string, generationId: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.testSets)
      return mod.testSetService.readGenerationStatus(appName, generationId)
    })
  }

  private async runGuarded(job: Job): Promise<JobResult> {
    const jobId = `job-${Date.now()}`
    // ADR-013 pre-flight (crawl only): resolve + inject credentials BEFORE the
    // engine runs. A CredentialError PROPAGATES to JobRunner (surfaced to the
    // Mission Timeline), rather than being swallowed into a failed JobResult.
    try {
      if (job.type === 'crawl') this.prepareCredentials(job)
      // ADR-014 — release the previous app's DB before the engine opens this one.
      await this.switchDatabaseIfNeeded(job.appName)
      const result = await this.runInProcess(job)
      return { jobId, status: 'completed', result }
    } catch (err) {
      // Only allowlisted code/message pairs and structurally sanitized recovery
      // fields cross the dynamic engine boundary. Raw exception text is dropped.
      const safe = governedRuntimeError(err)
      const failure = safeCrawlFailure(err)
      return { jobId, status: 'failed', error: safe.message, errorCode: safe.code, failure }
    } finally {
      delete job.options.username
      delete job.options.password
      delete job.options.credentialReference
    }
  }

  /**
   * ADR-014 — close the engine's per-app DB singleton before it opens a
   * different app's DB (TD-UI-020). closeDb() is engine-exported; no src/ edit.
   */
  private async switchDatabaseIfNeeded(appName: string): Promise<void> {
    const workspaceRoot = this.workspaces.resolve(appName).root
    const targetDbPath = path.join(workspaceRoot, '.forge', 'forge.db')
    if (this.activeProductExecution
      && this.activeProductExecution.appName !== appName
      && this.lastDbPath !== targetDbPath) {
      throw new Error('A Product UI execution currently owns the workspace database boundary.')
    }
    const dbMod: any = await import(ENGINE.db)
    if (shouldCloseDb(this.lastDbPath, targetDbPath)) {
      await dbMod.closeDb()
    }
    // Scope every DB-touching runtime operation. CrawlRunner remains the owner
    // that applies lazy migrations; reads/generate/verify do not apply them.
    dbMod.initProductWorkspaceDatabase(workspaceRoot, targetDbPath)
    this.lastDbPath = targetDbPath
  }

  /**
   * ADR-013 / TD-SEC-001 preflight. Direct form material stays on the operation
   * until CrawlRunner enters its canonical scope. Otherwise this resolves only
   * the governed reference, verifies the bootstrap-slot invariant, and passes
   * the reference to the engine. Neither path writes process.env.
   */
  private prepareCredentials(job: Job): void {
    // Onboard passes form credentials directly — respect them (bootstrap/force
    // path already) and skip env resolution + hard-fail.
    if (job.options.username && job.options.password) return

    const reference = credentialResolver.resolve(job.appName)   // throws CredentialError on hard-fail
    if (!reference) return   // guest app (authType 'none') — nothing to inject

    const config = this.readEngineConfig(job.appName)          // read-only; null when fresh
    planCrawlCredentials(config, reference, { force: job.options.force === true })
    job.options.credentialReference = reference
  }

  /** Read the engine-owned .forge/config.json (read-only) — never writes it. */
  private readEngineConfig(appName: string): EngineConfigView | null {
    try {
      const ws = this.workspaces.resolve(appName)
      return JSON.parse(fs.readFileSync(path.join(ws.forgeDir, 'config.json'), 'utf-8'))
    } catch {
      return null
    }
  }

  private async runInProcess(job: Job): Promise<unknown> {
    switch (job.type) {
      case 'crawl': {
        const mod: any = await import(ENGINE.crawlRunner)
        return new mod.CrawlRunner().run(job.options as any)
      }
      case 'generate': {
        const mod: any = await import(ENGINE.generator)
        // GeneratorRunner.generate(appName, workspace) → GenerationManifest on the
        // workspace path (TD-UI-003). provision() creates <root>/.forge/ and returns
        // a REAL engine Workspace (projection / test / manifest writers) —
        // NOT resolve(), which is a paths-only object of the wrong shape. The returned
        // manifest bubbles up as JobResult.result via runGuarded → JobRunner → API.
        return new mod.GeneratorRunner().generate(job.appName, this.workspaces.provision(job.appName))
      }
      case 'verify': {
        const mod: any = await import(ENGINE.verifier)
        return new mod.VerificationRunner(
          job.appName,
          undefined,
          this.workspaces.provision(job.appName),
          undefined,
          job.options.operationId,
        ).run()
      }
      case 'run':
        // Test execution runs via the Playwright CLI, not a runner class.
        // Wiring (spawn + SSE surfacing) lands in TD-UI-004.
        throw new Error("ExecutionContext: 'run' not yet wired — TD-UI-004")
      default:
        throw new Error(`Unknown job type: ${(job as Job).type}`)
    }
  }
}

export const executionContext = new ExecutionContext()
