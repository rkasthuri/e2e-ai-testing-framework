/**
 * UI-side extension for TD-UI-063B.
 *
 * Observation ordering, state, freshness, and evidence meaning are supplied
 * by the read-model adapter. The UI only presents the declared values.
 */
import type { ApplicationOverviewReadModel, OverviewEvidenceState } from './types'

export type ObservationState = 'current' | 'stale' | 'failed' | 'blocked' | 'incomplete' | 'unknown'

export interface ObservationRecord {
  id: string
  contextId: string | null
  contextLabel: string
  state: ObservationState
  isCurrent: boolean
  startedAt: string | null
  completedAt: string | null
  why: string
  preventedStrongerState: string | null
  source: string
  observedSubject: string
  observedScope: string
  unobservedScope: string[]
  evidenceIds: string[]
  evidenceStates: OverviewEvidenceState[]
  evidenceSummary: string
  limitations: string[]
  unknowns: string[]
  blockers: string[]
  safeRecommendation: { action: string; because: string; evidenceIds: string[] } | null
}

export interface ApplicationObservationsReadModel extends ApplicationOverviewReadModel {
  observations: ObservationRecord[]
}
