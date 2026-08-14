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
import type { AppModelObservationSupportInput } from '../observation/ObservationTypes'
import { canonicalJson } from './JsonAppModelMigrationPlanner'

/** The one canonical byte identity used when App Model support is sealed or verified. */
export function canonicalAppModelSupportIdentity(support: AppModelObservationSupportInput): object {
  return {
    projectId: support.projectId,
    observationRunId: support.observationRunId,
    characterizationPolicyId: support.characterizationPolicyId,
    characterizationPolicyVersion: support.characterizationPolicyVersion,
    observations: support.observations
      .map(row => [row.observationId, row.claimKey, row.supportRole])
      .sort(),
    subjects: support.subjects
      .map(row => [row.canonicalSubjectId, row.observationId, row.claimKey, row.supportRole])
      .sort(),
    gaps: support.gaps
      .map(row => [row.gapId, row.claimKey, row.supportRole])
      .sort(),
  }
}

export function appModelSupportHash(support: AppModelObservationSupportInput): string {
  return crypto.createHash('sha256')
    .update(canonicalJson(canonicalAppModelSupportIdentity(support)))
    .digest('hex')
}
