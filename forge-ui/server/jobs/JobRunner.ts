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

import { executionContext } from '../context/ExecutionContext'
import { logBuffer } from '../registry/LogBuffer'
import { workspaceResolver } from '../context/WorkspaceResolver'
import { CredentialErrorBase } from '../context/credentials/CredentialTypes'

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
}

export interface JobStatus {
  jobId: string
  type: Job['type']
  appName: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  error?: string
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

export class JobRunner {
  private jobs = new Map<string, JobStatus>()
  // TD-UI-022 — appName → jobId index for the currently active job per app, so a
  // remounted CrawlPage can rediscover an in-flight crawl (resume).
  private currentExecution = new Map<string, string>()

  /**
   * Run a job to completion. The route fires this WITHOUT awaiting, so POST can
   * return 202 immediately; the client then polls getStatus(jobId).
   */
  async submit(job: Job): Promise<string> {
    const status: JobStatus = {
      jobId: job.jobId,
      type: job.type,
      appName: job.appName,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    this.jobs.set(job.jobId, status)
    this.currentExecution.set(job.appName, job.jobId)
    logBuffer.create(job.jobId)

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
      // Engine call ALWAYS via ExecutionContext (never CrawlRunner directly).
      const result = await executionContext.submit({
        type: job.type,
        appName: job.appName,
        options,
      })
      if (result.status === 'failed') {
        // Carry the operator-facing code (if any) onto the thrown error so the
        // catch can surface the message to the Mission Timeline. The engine's
        // typed OperatorFacingError was stringified at the ExecutionContext
        // boundary; the code is what survives (Block 4b).
        const e = new Error(result.error ?? `${job.type} failed`) as Error & { errorCode?: string }
        if (result.errorCode) e.errorCode = result.errorCode
        throw e
      }
      status.status = 'completed'
    } catch (err) {
      status.status = 'failed'
      status.error = err instanceof Error ? err.message : String(err)
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

  /** Lifecycle + live log lines for the client poll. null for an unknown jobId. */
  getStatus(jobId: string): JobStatusView | null {
    const status = this.jobs.get(jobId)
    if (!status) return null
    const { lines, complete } = logBuffer.get(jobId)
    return { ...status, lines, complete }
  }

  /** TD-UI-022 — the currently active job for an app, or null (resume lookup). */
  getActiveJob(appName: string): JobStatus | null {
    const jobId = this.currentExecution.get(appName)
    if (!jobId) return null
    return this.jobs.get(jobId) ?? null
  }
}

export const jobRunner = new JobRunner()
