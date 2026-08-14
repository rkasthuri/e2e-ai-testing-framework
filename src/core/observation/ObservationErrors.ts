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

export class ObservationContractError extends Error {
  constructor(readonly code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ObservationContractError'
  }
}

export class ObservationReplayConflictError extends ObservationContractError {
  constructor(kind: 'run' | 'observation' | 'gap' | 'artifact', identity: string) {
    super(
      'OBSERVATION_REPLAY_CONFLICT',
      `Canonical ${kind} replay '${identity}' conflicts with the immutable persisted record.`,
    )
    this.name = 'ObservationReplayConflictError'
  }
}

export class ObservationAuthorityError extends ObservationContractError {
  constructor(message: string) {
    super('OBSERVATION_WORKSPACE_AUTHORITY_REQUIRED', message)
    this.name = 'ObservationAuthorityError'
  }
}
