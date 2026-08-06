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

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { workspaceResolver } from './WorkspaceResolver'
import { credentialResolver } from './credentials/CredentialResolver'
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
        summary: typeof item.summary === 'string' ? item.summary : 'Cause detail was withheld.',
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
          value: typeof item.value === 'string' ? item.value : '',
        }))
      : [],
    crawlDiagnostics: Array.isArray(value.crawlDiagnostics)
      ? value.crawlDiagnostics
        .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item: Record<string, unknown>) => ({
          scope: typeof item.scope === 'string' ? item.scope : 'page',
          target: typeof item.target === 'string' ? item.target : '',
          reason: typeof item.reason === 'string' ? item.reason : 'unknown',
          detail: typeof item.detail === 'string' ? item.detail : 'No detail was recorded.',
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
}

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

  submit(job: Job): Promise<JobResult> {
    // Serialize the WHOLE run sequence (creds pre-flight → DB switch → engine)
    // so DB-touching runs never overlap (TD-UI-020).
    return this.queue.run(() => this.runGuarded(job))
  }

  /** TD-181: UI App Model reads cross the engine boundary through SQLite. */
  readAppModel(appName: string): Promise<unknown> {
    return this.queue.run(async () => {
      await this.switchDatabaseIfNeeded(appName)
      const mod: any = await import(ENGINE.appModels)
      return new mod.AppModelService().requireActive(appName)
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

  private async runGuarded(job: Job): Promise<JobResult> {
    const jobId = `job-${Date.now()}`
    // ADR-013 pre-flight (crawl only): resolve + inject credentials BEFORE the
    // engine runs. A CredentialError PROPAGATES to JobRunner (surfaced to the
    // Mission Timeline), rather than being swallowed into a failed JobResult.
    if (job.type === 'crawl') this.prepareCredentials(job)
    try {
      // ADR-014 — release the previous app's DB before the engine opens this one.
      await this.switchDatabaseIfNeeded(job.appName)
      const result = await this.runInProcess(job)
      return { jobId, status: 'completed', result }
    } catch (err) {
      // Operator-facing engine preconditions carry a stable code + brand that
      // survive this boundary (the typed class does not). Preserve the raw
      // operator message + code so JobRunner surfaces it to the Mission Timeline;
      // everything else keeps the existing String(err) behaviour.
      const code = operatorFacingCode(err)
      const failure = safeCrawlFailure(err)
      if (code) return { jobId, status: 'failed', error: (err as Error).message, errorCode: code, failure }
      return { jobId, status: 'failed', error: String(err), failure }
    }
  }

  /**
   * ADR-014 — close the engine's per-app DB singleton before it opens a
   * different app's DB (TD-UI-020). closeDb() is engine-exported; no src/ edit.
   */
  private async switchDatabaseIfNeeded(appName: string): Promise<void> {
    const targetDbPath = path.join(this.workspaces.resolve(appName).root, '.forge', 'forge.db')
    const dbMod: any = await import(ENGINE.db)
    if (shouldCloseDb(this.lastDbPath, targetDbPath)) {
      await dbMod.closeDb()
    }
    // Scope every DB-touching runtime operation. CrawlRunner remains the owner
    // that applies lazy migrations; reads/generate/verify do not apply them.
    dbMod.initDb(targetDbPath)
    this.lastDbPath = targetDbPath
  }

  /**
   * ADR-013 two-path credential injection. Onboard supplies form creds directly
   * (respected, skipped). Otherwise resolve from the env pointer pair (hard-fails
   * via CredentialError when auth is required but unresolved), then inject:
   *   Path A (bootstrap: force / fresh) → pass options.username/password so the
   *     engine's Bootstrap writes credentials.envKey and CrawlRunner:129 injects.
   *   Path B (existing config WITH envKey, no force) → set process.env[envKey]
   *     here and DON'T pass options, so CrawlRunner:129 stays inert (single
   *     materializer, no double-inject).
   *   Split (existing config, no force, creds resolved, but NO envKey slot) →
   *     refuse with CredentialSlotError. We do NOT silently auto-force a
   *     re-detect nor run unauthenticated; the operator establishes the slot via
   *     a Force re-crawl.
   */
  private prepareCredentials(job: Job): void {
    // Onboard passes form credentials directly — respect them (bootstrap/force
    // path already) and skip env resolution + hard-fail.
    if (job.options.username && job.options.password) return

    const material = credentialResolver.resolve(job.appName)   // throws CredentialError on hard-fail
    if (!material) return   // guest app (authType 'none') — nothing to inject

    const config = this.readEngineConfig(job.appName)          // read-only; null when fresh
    const plan = planCrawlCredentials(config, material, { force: job.options.force === true })

    if (plan.path === 'A') {
      // Path A — the engine's Bootstrap writes credentials.envKey and
      // CrawlRunner:129 injects. Supply the material as options.
      job.options.username = material.username
      job.options.password = material.password
    } else {
      // Path B — existing envKey: inject here; keep line-129 inert (no options).
      process.env[plan.envKey] = `${material.username}:${material.password}`
      delete job.options.username
      delete job.options.password
    }
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
