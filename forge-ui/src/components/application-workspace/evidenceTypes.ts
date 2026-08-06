/**
 * UI-side extension for TD-UI-063D.
 *
 * The evidence adapter supplies validated, display-safe summaries. Raw
 * credential material and domain validation rules never cross this boundary.
 */
import type { ApplicationOverviewReadModel } from './types'

export type EvidenceFreshnessState = 'current' | 'stale' | 'expired' | 'unavailable' | 'superseded'
export type EvidenceIntegrityState = 'verified' | 'failed' | 'unknown' | 'limited'
export type EvidenceSupportState = 'supports-current' | 'historical-only' | 'cannot-support-current' | 'unknown'

export interface EvidenceLedgerRecord {
  id: string
  projectId: string
  sourceKind: string
  sourceReference: string | null
  subject: string
  observationSummary: string
  observationContextId: string | null
  observationContextLabel: string
  capturedAt: string | null
  observedAt: string | null
  freshness: EvidenceFreshnessState
  freshnessExplanation: string
  integrity: EvidenceIntegrityState
  integrityExplanation: string
  support: EvidenceSupportState
  claimReferences: string[]
  truthCardReferences: string[]
  modelReferences: string[]
  conflictingGroupId: string | null
  accessLimitation: string | null
  credentialMaterialOmitted: boolean
}

export interface EvidenceConflictGroup {
  id: string
  subject: string
  unresolvedExplanation: string
  evidenceIds: string[]
  sourceReferences: string[]
  observationContextIds: string[]
}

export interface ApplicationEvidenceReadModel extends ApplicationOverviewReadModel {
  evidenceLedger: EvidenceLedgerRecord[]
  evidenceConflicts: EvidenceConflictGroup[]
}
