/**
 * UI-side extension for TD-UI-063C.
 *
 * The adapter supplies model state, currency, provenance, and subjects. The
 * presentation layer does not infer completeness or merge contexts.
 */
import type { ApplicationOverviewReadModel } from './types'

export type ApplicationModelState = 'current' | 'stale' | 'unavailable' | 'blocked' | 'incomplete' | 'integrity-limited'
export type ModelSubjectBasis = 'direct-observation' | 'derived-interpretation'

export interface ApplicationModelSubject {
  id: string
  kind: string
  label: string
  basis: ModelSubjectBasis
  observationIds: string[]
  evidenceIds: string[]
  observationContextIds: string[]
  summary: string
  interpretation: string | null
}

export interface ApplicationModelRecommendation {
  action: string
  because: string
  evidenceIds: string[]
}

export interface ApplicationModelReadModel extends ApplicationOverviewReadModel {
  applicationModel: {
    state: ApplicationModelState
    revision: string | null
    generatedAt: string | null
    evaluatedAt: string | null
    why: string
    preventedStrongerState: string | null
    impact: string
    currencyEvidenceIds: string[]
    sourceObservationIds: string[]
  }
  modelSubjects: ApplicationModelSubject[]
  modelUnobservedScope: string[]
  modelLimitations: string[]
  modelUnknowns: string[]
  modelBlockers: string[]
  modelRecommendation: ApplicationModelRecommendation | null
}
