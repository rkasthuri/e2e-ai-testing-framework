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

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

/** Read-only runner view. The executor can observe intent but cannot mint it. */
export interface ExecutionCancellationToken {
  readonly executionId: string
  readonly tokenId: string
  isCancellationRequested(): boolean
}

/**
 * ExecutionService-owned, one-way controller. Identity never changes and the
 * requested flag can only move false -> true. It is process state, not durable
 * truth; the cancellation_requested event is the restart authority.
 */
export class GovernedExecutionCancellationToken implements ExecutionCancellationToken {
  private requested = false

  constructor(
    readonly executionId: string,
    readonly tokenId: string,
  ) {
    if (!SAFE_ID.test(executionId) || !SAFE_ID.test(tokenId)) {
      throw new Error('Execution cancellation token identity is malformed.')
    }
  }

  request(): void { this.requested = true }

  isCancellationRequested(): boolean { return this.requested }
}
