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
 * UI-side extension of the TD-UI-062C read model for the Application Overview.
 *
 * This is a structural boundary type. It does not derive lifecycle,
 * confidence, freshness, or recommendation meaning in the UI.
 */
import type { TruthBoardReadModel } from '../truth-board/types'

export type OverviewEvidenceState = 'current' | 'stale' | 'blocked' | 'missing' | 'integrity-failed' | 'unknown'
export type OverviewEvidenceFreshness = 'current' | 'stale' | 'expired' | 'unknown'

export interface OverviewEvidence {
  id: string
  state: OverviewEvidenceState
  freshness: OverviewEvidenceFreshness
  summary: string
  provenance: string
  capturedAt: string | null
  confidence: 'unknown' | 'low' | 'medium' | 'high'
  confidenceReason: string
  detail?: string
}

export interface OverviewConfidenceDimension {
  key: string
  label: string
  state: 'unknown' | 'low' | 'medium' | 'high'
  explanation: string
}

export interface ApplicationModelSummary {
  state: string
  currency: 'current' | 'stale' | 'unknown'
  summary: string
}

export interface OverviewRecommendation {
  id: string
  action: string
  because: string
  safe: boolean
  evidenceIds: string[]
  destination: {
    kind: 'internal-route'
    href: string
  } | null
}

export interface ApplicationOverviewReadModel extends TruthBoardReadModel {
  applicationUrl: string
  confidenceDimensions: OverviewConfidenceDimension[]
  observationContext: {
    id: string | null
    label: string
    boundary: string
  }
  currentUnderstanding: {
    latestObservationSummary: string
    applicationModel: ApplicationModelSummary
    limitations: string[]
  }
  evidence: OverviewEvidence[]
  recommendations: OverviewRecommendation[]
}
