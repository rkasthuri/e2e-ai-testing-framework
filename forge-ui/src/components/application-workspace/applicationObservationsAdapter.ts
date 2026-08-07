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

import type { ObservationHistoryResponse } from '../../api/types'
import type {
  ApplicationObservationsReadModel,
  ObservationRecordReadModel,
} from './observationsTypes'

const FRESHNESS_REASON = 'No approved freshness threshold exists for persisted observations.'

function mapObservation(
  observation: ObservationHistoryResponse['observations'][number],
): ObservationRecordReadModel {
  return {
    id: observation.observationId,
    contextId: observation.observationContext.id,
    contextLabel: observation.observationContext.label,
    declaredScope: observation.observationContext.declaredScope,
    strategy: observation.observationContext.strategy,
    position: observation.position,
    terminalState: observation.terminalState,
    startedAt: observation.startedAt,
    completedAt: observation.completedAt,
    why: observation.stateExplanation,
    source: observation.sourceKind,
    freshness: { state: 'not_evaluated', reason: FRESHNESS_REASON },
    authentication: observation.authentication,
    observedSubjects: observation.observedSubjects,
    unobservedScope: observation.unobservedScope,
    evidence: observation.evidence,
    limitations: observation.limitations,
    unknowns: observation.unknowns,
    blockers: observation.blockers,
    safeRecommendation: observation.recommendation
      ? {
          category: observation.recommendation.category,
          action: observation.recommendation.action,
          because: observation.recommendation.because,
          destination: null,
        }
      : null,
    modelRecovery: observation.modelRecovery
      ? {
          sourceRowId: observation.modelRecovery.sourceRowId,
          sourceVersion: observation.modelRecovery.sourceVersion,
          sourceFingerprint: observation.modelRecovery.sourceFingerprint,
          detectedAt: observation.modelRecovery.detectedAt,
          replacementRowId: observation.modelRecovery.replacementRowId,
          replacementVersion: observation.modelRecovery.replacementVersion,
        }
      : null,
    modelRecoveryFailure: observation.modelRecoveryFailure
      ? {
          ...observation.modelRecoveryFailure,
          phases: observation.modelRecoveryFailure.phases,
        }
      : null,
  }
}

export function buildApplicationObservationsReadModel(
  response: ObservationHistoryResponse,
): ApplicationObservationsReadModel {
  return {
    project: {
      id: response.project.id,
      displayName: response.project.name,
    },
    observations: response.observations.map(mapObservation),
    page: response.page,
    filter: response.filter,
    requestedObservation: response.requestedObservation,
  }
}
