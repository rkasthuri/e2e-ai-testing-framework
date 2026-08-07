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

/**
 * LogBuffer — in-memory, single-process log capture per jobId (TD-UI-011).
 * The POST /projects handler hijacks console.log/warn while a bootstrap+crawl
 * runs, appending lines here; the client polls GET /:jobId/logs. This is an
 * interim solution until full SSE ships (TD-UI-002).
 */
export class LogBuffer {
  private buffers = new Map<string, string[]>()
  private done = new Set<string>()

  create(jobId: string): void {
    this.buffers.set(jobId, [])
    this.done.delete(jobId)
  }

  append(jobId: string, line: string): void {
    this.buffers.get(jobId)?.push(line)
  }

  markComplete(jobId: string): void {
    this.done.add(jobId)
  }

  get(jobId: string): { lines: string[]; complete: boolean } {
    return {
      lines: this.buffers.get(jobId) ?? [],
      complete: this.done.has(jobId),
    }
  }

  clear(jobId: string): void {
    this.buffers.delete(jobId)
    this.done.delete(jobId)
  }
}

export const logBuffer = new LogBuffer()
