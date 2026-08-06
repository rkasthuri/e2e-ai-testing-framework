import type { TruthBoardReadModel, TruthBoardSection, TruthConfidence } from './types'

export interface TruthCardModel {
  key: TruthBoardSection['key']
  title: string
  state: TruthConfidence
  observation: string
  why: string
  impact: string
  recommendation: TruthBoardSection['recommendedNextStep']
  evidenceIds: string[]
  unknowns: TruthBoardSection['unknowns']
  blockers: TruthBoardSection['blockers']
  preventedHigherState: string | null
}

/**
 * Presentation mapping only: every decision-oriented field is copied from
 * the read model. No health score, KPI, inference, or state derivation occurs.
 */
export function mapTruthBoardToCards(readModel: TruthBoardReadModel): TruthCardModel[] {
  return readModel.sections.map(section => ({
    key: section.key,
    title: section.label,
    state: section.confidence,
    observation: section.meaning,
    why: section.why,
    impact: section.impact,
    recommendation: section.recommendedNextStep,
    evidenceIds: [...section.evidenceIds],
    unknowns: [...section.unknowns],
    blockers: [...section.blockers],
    preventedHigherState: section.preventedHigherState,
  }))
}
