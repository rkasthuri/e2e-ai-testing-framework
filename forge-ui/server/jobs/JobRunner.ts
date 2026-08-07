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

import { executionContext } from '../context/ExecutionContext'
import { logBuffer } from '../registry/LogBuffer'
import { workspaceResolver } from '../context/WorkspaceResolver'
import { CredentialErrorBase } from '../context/credentials/CredentialTypes'
import { observationStore, type ObservationStore } from '../registry/ObservationStore'

/**
 * JobRunner — owns the lifecycle of a long-running engine operation (ADR-012).
 *
 * PHASE 1 (this file): synchronous. submit() runs the job in-process (blocking
 * the Express event loop — acceptable for a single-user local tool) and captures
 * the engine's console.log/warn into LogBuffer for the "Mission Timeline" (the
 * same proven mechanism Onboard ships in TD-UI-011). The engine call goes
 * through ExecutionContext — never CrawlRunner directly — preserving the
 * one-way forge-ui → engine boundary. Structured pages are NOT sourced here:
 * the crawl route reads them from SQLite after completion.
 *
 * PHASE 2: move execution to worker_threads and source progress from the
 * EngineEventPublisher (src/core/events) instead of parsed logs. The Job /
 * JobStatus contract below is what both phases share, so the UI + routes are
 * untouched by that swap.
 */
export interface Job {
  jobId: string
  type: 'crawl' | 'generate' | 'verify'
  appName: string
  options: Record<string, unknown>
  startedAt?: string
}

export interface JobStatus {
  jobId: string
  type: Job['type']
  appName: string
  status: 'queued' | 'starting' | 'running' | 'completed' | 'partially_completed' | 'blocked' | 'failed' | 'unknown'
  startedAt: string
  completedAt?: string
  error?: string
  errorCode?: string
  /** Internal engine result used by observation finalization; routes expose only
   * explicitly mapped, non-secret fields. */
  result?: unknown
  /** Strictly selected engine failure progress; never contains the raw candidate. */
  failure?: unknown
}

/** JobStatus enriched with the live Mission-Timeline log lines (from LogBuffer). */
export interface JobStatusView extends JobStatus {
  lines: string[]
  complete: boolean
}

/** True when a failure carries an operator-facing errorCode — preserved from the
 *  engine's OperatorFacingError across the ExecutionContext boundary (Block 4b).
 *  Structural check: forge-ui never imports the engine error class. */
function hasOperatorFacingCode(err: unknown): boolean {
  return !!err && typeof err === 'object' && typeof (err as { errorCode?: unknown }).errorCode === 'string'
}

export class ObservationStatusReadError extends Error {
  constructor() {
    super('Persisted observation status is malformed and cannot be trusted.')
    this.name = 'ObservationStatusReadError'
  }
}

export class JobRunner {
  private jobs = new Map<string, JobStatus>()
  // TD-UI-022 — appName → jobId index for the currently active job per app, so a
  // remounted CrawlPage can rediscover an in-flight crawl (resume).
  private currentExecution = new Map<string, string>()

  constructor(
    private readonly observations: Pick<ObservationStore, 'resolve'> = observationStore,
  ) {}

  /**
   * Run a job to completion. The route fires this WITHOUT awaiting, so POST can
   * return 202 immediately; the client then polls getStatus(jobId).
   */
  async submit(job: Job): Promise<string> {
    const status: JobStatus = {
      jobId: job.jobId,
      type: job.type,
      appName: job.appName,
      status: 'queued',
      startedAt: job.startedAt ?? new Date().toISOString(),
    }
    this.jobs.set(job.jobId, status)
    this.currentExecution.set(job.appName, job.jobId)
    logBuffer.create(job.jobId)

    // Yield once so the accepted/queued state is observable before engine setup.
    await Promise.resolve()
    status.status = 'starting'

    // Phase 1 Mission Timeline: hijack console → LogBuffer (same as Onboard's
    // projects.ts). Global per-process hijack; safe here because the synchronous
    // crawl blocks the event loop, so no other request interleaves during it.
    const origLog = console.log
    const origWarn = console.warn
    console.log = (...a: unknown[]) => { logBuffer.append(job.jobId, a.join(' ')); origLog(...a) }
    console.warn = (...a: unknown[]) => { logBuffer.append(job.jobId, `⚠️ ${a.join(' ')}`); origWarn(...a) }

    try {
      // Issue #1 — resolve the per-app workspace so the engine reads/writes the
      // right ~/.forge-projects/<appName>/.forge. CrawlRunner needs a REAL
      // Workspace object (loadConfig/…), which WorkspaceResolver returns.
      const options = job.type === 'crawl'
        ? {
            ...job.options,
            operationId: job.options.operationId ?? job.jobId,
            workspace: workspaceResolver.provision(job.appName),
          }
        : job.type === 'verify'
          ? { ...job.options, operationId: job.options.operationId ?? job.jobId }
          : job.options
      status.status = 'running'
      // Engine call ALWAYS via ExecutionContext (never CrawlRunner directly).
      const result = await executionContext.submit({
        type: job.type,
        appName: job.appName,
        options,
      })
      if (result.status === 'failed') {
        status.failure = result.failure
        // Carry the operator-facing code (if any) onto the thrown error so the
        // catch can surface the message to the Mission Timeline. The engine's
        // typed OperatorFacingError was stringified at the ExecutionContext
        // boundary; the code is what survives (Block 4b).
        const e = new Error(result.error ?? `${job.type} failed`) as Error & { errorCode?: string }
        if (result.errorCode) e.errorCode = result.errorCode
        throw e
      }
      status.result = result.result
      status.status = 'completed'
    } catch (err) {
      status.status = 'failed'
      status.error = err instanceof Error ? err.message : String(err)
      if (hasOperatorFacingCode(err)) status.errorCode = (err as Error & { errorCode: string }).errorCode
      // Surface operator-facing precondition failures to the Mission Timeline
      // (not just job status). TWO rails, both intact:
      //  (a) CredentialErrorBase — pre-flight credential refusals, thrown BEFORE
      //      the engine runs so they reach here as a live instance (unchanged).
      //  (b) An engine failure carrying an operator-facing errorCode
      //      (OperatorFacingError.code), preserved across the ExecutionContext
      //      boundary because the typed class itself does not survive (Block 4b).
      if (err instanceof CredentialErrorBase) {
        logBuffer.append(job.jobId, `⛔ ${err.message}`)
      } else if (hasOperatorFacingCode(err)) {
        logBuffer.append(job.jobId, `⛔ ${(err as Error).message}`)
      }
    } finally {
      status.completedAt = new Date().toISOString()
      this.currentExecution.delete(job.appName)
      console.log = origLog
      console.warn = origWarn
      logBuffer.markComplete(job.jobId)
    }
    return job.jobId
  }

  /**
   * Lifecycle + live log lines for the client poll. Live process state wins.
   * After restart, crawl observations fall back to their immutable records;
   * mutable Application Model state is never used to reconstruct job status.
   */
  getStatus(jobId: string, expectedProjectId?: string): JobStatusView | null {
    const status = this.jobs.get(jobId)
    if (status) {
      if (expectedProjectId && status.appName !== expectedProjectId) return null
      const { lines, complete } = logBuffer.get(jobId)
      return { ...status, lines, complete }
    }

    const persisted = this.observations.resolve(jobId, expectedProjectId)
    if (persisted.kind === 'not_found' || persisted.kind === 'ownership_mismatch') return null
    if (persisted.kind === 'malformed') throw new ObservationStatusReadError()
    if (persisted.kind === 'interrupted') {
      return {
        jobId,
        type: 'crawl',
        appName: persisted.start.projectId,
        status: 'unknown',
        startedAt: persisted.start.startedAt,
        error: 'The backend restarted before an immutable terminal observation was persisted. This observation is interrupted and is not active.',
        lines: [],
        complete: true,
      }
    }
    return {
      jobId,
      type: 'crawl',
      appName: persisted.terminal.projectId,
      status: persisted.terminal.terminalState,
      startedAt: persisted.terminal.startedAt,
      completedAt: persisted.terminal.completedAt,
      error: persisted.terminal.errors[0],
      lines: [],
      complete: true,
    }
  }

  /** TD-UI-022 — the currently active job for an app, or null (resume lookup). */
  getActiveJob(appName: string): JobStatus | null {
    const jobId = this.currentExecution.get(appName)
    if (!jobId) return null
    return this.jobs.get(jobId) ?? null
  }
}

export const jobRunner = new JobRunner()
