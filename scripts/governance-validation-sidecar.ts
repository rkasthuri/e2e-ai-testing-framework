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

/** Fixed-path production facade for governed validation authority. */
import path from 'node:path'
import {
  openGovernanceSidecarAtPathInternal,
  readGovernedCurrentAtPathInternal,
} from './governance-validation-sidecar-internal'
import type {
  GovernanceValidationSidecarHandle,
  GovernedAuthorityRead,
} from './governance-validation-sidecar-internal'

export {
  canonicalGovernedReportEvidence,
  decodeGovernedReportBytes,
  GOVERNANCE_SIDECAR_LIMITS,
} from './governance-validation-sidecar-internal'
export type {
  AcceptedGovernedInvocation,
  GovernanceValidationSidecarHandle,
  GovernedAcceptanceResult,
  GovernedAuthorityRead,
  GovernedCompletionEvidence,
  GovernedCompletionResult,
  GovernedInfrastructureStatus,
  GovernedInvocationExpectation,
  GovernedInvocationState,
  GovernedRecoveryResult,
  HistoricalGovernedEvidence,
} from './governance-validation-sidecar-internal'

export function productionGovernanceSidecarPath(): string {
  return path.join(path.resolve(__dirname, '..'), '.forge', 'governance.db')
}

export function openProductionGovernanceSidecar(): GovernanceValidationSidecarHandle {
  return openGovernanceSidecarAtPathInternal(productionGovernanceSidecarPath())
}

export function readGovernedCurrent(targetId: string): GovernedAuthorityRead {
  return readGovernedCurrentAtPathInternal(productionGovernanceSidecarPath(), targetId)
}
