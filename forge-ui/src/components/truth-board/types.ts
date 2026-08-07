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
 * Structural UI mirror of TD-UI-062C.
 *
 * The UI renders this read model but does not import or reimplement the core
 * domain contract. The eventual adapter owns conversion into this shape.
 */
export type TruthBoardSectionKey =
  | 'project-status' | 'truth-confidence' | 'crawl' | 'app-model'
  | 'test-readiness' | 'execution' | 'results' | 'insights'

export type TruthConfidence = 'unknown' | 'low' | 'medium' | 'high'
export type UnknownSeverity = 'informational' | 'material' | 'critical'

export interface TruthBoardUnknown {
  id: string
  subject: string
  reason: string
  severity: UnknownSeverity
  evidenceIds: string[]
}

export interface TruthBoardBlocker {
  id: string
  kind: string
  subject: string
  reason: string
  evidenceIds: string[]
}

export interface TruthBoardRecommendation {
  id: string
  action: string
  reason: string
  priority: 'next' | 'important' | 'optional'
  evidenceIds: string[]
  unknownIds: string[]
  blockerIds: string[]
}

export interface TruthBoardSection {
  key: TruthBoardSectionKey
  label: string
  confidence: TruthConfidence
  meaning: string
  why: string
  impact: string
  evidenceIds: string[]
  unknowns: TruthBoardUnknown[]
  blockers: TruthBoardBlocker[]
  preventedHigherState: string | null
  recommendedNextStep: TruthBoardRecommendation | null
}

export interface TruthBoardProject {
  projectId: string
  displayName: string
  applicationKind: string
  observationBoundary: string
  lifecycleState: string
  stateRevision: number
}

export interface TruthBoardReadModel {
  project: TruthBoardProject
  asOf: string
  evidenceIds: string[]
  truthConfidence: TruthBoardSection & { level: TruthConfidence; dimensions: Record<string, string> }
  sections: TruthBoardSection[]
}
