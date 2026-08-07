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

import type {
  AuthenticationAttempt,
  ObservationHistoryTerminalState,
  SafeCategorizedExplanation,
  SafeObservationCategory,
} from '../../api/types'

export interface ObservationEvidenceReadModel {
  id: string
  subjectPath: string | null
  summary: string
  capturedAt: string
  provenance: { kind: 'crawl-run'; reference: string }
  integrity: 'valid' | 'failed' | 'unknown'
}

export interface ObservationRecordReadModel {
  id: string
  contextId: string
  contextLabel: string
  declaredScope: string
  strategy: string
  position: 'latest' | 'historical'
  terminalState: ObservationHistoryTerminalState
  startedAt: string
  completedAt: string | null
  why: string
  source: 'crawl-engine'
  freshness: {
    state: 'not_evaluated'
    reason: string
  }
  authentication: {
    expectation: string
    credentialAvailability: 'available' | 'missing' | 'not_required' | 'unknown'
    outcome: 'succeeded' | 'failed' | 'not_evaluated' | 'not_required' | null
    explanation: string | null
    attempts: AuthenticationAttempt[]
  }
  observedSubjects: Array<{
    id: string
    kind: 'page' | 'route'
    routePath: string | null
    evidenceId: string
  }>
  unobservedScope: SafeCategorizedExplanation[]
  evidence: ObservationEvidenceReadModel[]
  limitations: SafeCategorizedExplanation[]
  unknowns: SafeCategorizedExplanation[]
  blockers: SafeCategorizedExplanation[]
  safeRecommendation: {
    category: SafeObservationCategory
    action: string
    because: string
    destination: { kind: 'crawl'; href: string } | null
  } | null
  modelRecovery: {
    sourceRowId: number
    sourceVersion: string
    sourceFingerprint: string
    detectedAt: string
    replacementRowId: number
    replacementVersion: string
  } | null
  modelRecoveryFailure: {
    sourceRowId: number
    sourceVersion: string
    sourceFingerprint: string
    detectedAt: string
    safeStage: string | null
    phases: Record<string, string>
  } | null
}

export interface ApplicationObservationsReadModel {
  project: { id: string; displayName: string }
  observations: ObservationRecordReadModel[]
  page: {
    previousCursor: string | null
    nextCursor: string | null
    hasPrevious: boolean
    filteredTotal: number
    projectTotal: number
  }
  filter: {
    startedFrom: string | null
    startedThrough: string | null
  }
  requestedObservation: {
    observationId: string
    status: 'on_page' | 'outside_page' | 'outside_filter' | 'not_found'
  } | null
}
