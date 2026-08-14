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

import {
  TestSetRepository,
  type TestInventoryRead,
  type TestSetHistoryItem,
} from '../storage/repositories/TestSetRepository'
import type {
  CanonicalRunnerCompatibility,
  CanonicalTestDefinitionV1,
  CanonicalTestDefinitionV2,
  CanonicalTestSetV1,
  CanonicalTestSetV2,
  TestGenerationOutcome,
} from './TestDefinitionContract'

export type PresentedIntrinsicCompatibility =
  | { state: 'compatible'; reason: null; explanation: string }
  | { state: 'blocked'; reason: string | null; explanation: string }
  | { state: 'not_evaluated'; reason: null; explanation: string }

interface PresentedDefinitionBase {
  definitionId: string
  title: string
  intent: string
  category: 'navigation'
  subjects: readonly string[]
  generationMethod: 'deterministic' | 'heuristic' | 'ai_assisted' | 'manual'
  validation: { state: 'valid'; explanation: string }
  intrinsicCompatibility: PresentedIntrinsicCompatibility
  confidenceLimitations: readonly string[]
  materialUnknowns: readonly string[]
  unobservedScope: readonly string[]
  preventedStrongerDefinition: string
}

export interface LegacyTestDefinitionPresentation extends PresentedDefinitionBase {
  schemaVersion: 1
  authorityClass: 'legacy_v1'
  provenance: {
    label: 'LEGACY PROVENANCE'
    sourceObservationId: string
    modelRowId: number
    modelVersion: string
    supportingEvidenceCount: number
  }
  routeEvidence: {
    state: 'legacy_compatibility'
    normalizedPath: null
    explanation: string
  }
  authenticationExpectation: {
    state: 'legacy_compatibility'
    mechanism: null
    explanation: string
  }
  executionPolicy: 'legacy_provenance_unsupported'
}

export interface CanonicalV2TestDefinitionPresentation extends PresentedDefinitionBase {
  schemaVersion: 2
  authorityClass: 'canonical_v2'
  provenance: {
    label: 'SEALED CANONICAL SUPPORT'
    modelRowId: number
    modelVersion: string
    supportSealHash: string
    supportingObservationCount: number
    supportingGapCount: number
    subjectSupportCount: number
    supportingObservationIds: readonly string[]
    supportingGapIds: readonly string[]
  }
  routeEvidence:
    | { state: 'available'; normalizedPath: string; normalizationPolicy: { id: string; version: string }; supportingObservationCount: number; supportingObservationIds: readonly string[] }
    | { state: 'unknown' | 'conflicted'; normalizedPath: null; normalizationPolicy: null; supportingObservationCount: 0; supportingObservationIds: readonly [] }
  authenticationExpectation: {
    state: 'required' | 'not_required' | 'unknown' | 'conflicted'
    mechanism: string | null
    basis: ReadonlyArray<{ kind: 'declared_configuration'; policyId: string; policyVersion: string }>
  }
  action: null | { kind: 'navigate_to_observed_route'; subjectId: string; normalizedPath: string }
  oracle: null | { kind: 'subject_observable'; subjectId: string; explanation: string }
  executionPolicy: 'canonical_v2_preflight_required'
}

export type TestDefinitionPresentation = LegacyTestDefinitionPresentation | CanonicalV2TestDefinitionPresentation

interface PresentedTestSetBase {
  testSetId: string
  revision: number
  projectId: string
  generationId: string
  generatedAt: string
  outcome: TestGenerationOutcome
  definitions: readonly TestDefinitionPresentation[]
  limitations: readonly string[]
  materialUnknowns: readonly string[]
  unobservedScope: readonly string[]
  preventedStrongerSet: string
  coverage: 'unknown'
  freshness: 'not_evaluated'
}

export interface LegacyTestSetPresentation extends PresentedTestSetBase {
  schemaVersion: 1
  authorityClass: 'legacy_v1'
  definitions: readonly LegacyTestDefinitionPresentation[]
  provenance: {
    label: 'LEGACY PROVENANCE'
    sourceObservationId: string
    modelRowId: number
    modelVersion: string
    supportingEvidenceCount: number
  }
}

export interface CanonicalV2TestSetPresentation extends PresentedTestSetBase {
  schemaVersion: 2
  authorityClass: 'canonical_v2'
  definitions: readonly CanonicalV2TestDefinitionPresentation[]
  provenance: {
    label: 'SEALED CANONICAL SUPPORT'
    modelRowId: number
    modelVersion: string
    observationRunId: string
    supportSealHash: string
    characterizationPolicy: { id: string; version: string }
    supportingObservationCount: number
    supportingGapCount: number
    subjectSupportCount: number
  }
}

export type TestSetPresentation = LegacyTestSetPresentation | CanonicalV2TestSetPresentation

export type TestSetHistoryPresentation = Omit<TestSetHistoryItem, 'sourceObservationId' | 'observationRunId' | 'supportSealHash'> & (
  | { schemaVersion: 1; authorityClass: 'legacy_v1'; provenance: { label: 'LEGACY PROVENANCE'; sourceObservationId: string } }
  | { schemaVersion: 2; authorityClass: 'canonical_v2'; provenance: { label: 'SEALED CANONICAL SUPPORT'; observationRunId: string; supportSealHash: string } }
)

export interface TestInventoryPresentation {
  current: null | {
    rowId: number
    contentHash: string
    testSet: TestSetPresentation
    startedAt: string
    completedAt: string | null
    temporalIntegrity: 'verified' | 'failed'
    temporalCode: 'GENERATION_TIMESTAMP_INCONSISTENT' | null
    temporalExplanation: string
  }
  history: TestSetHistoryPresentation[]
  total: number
  nextCursor: string | null
  requestedDefinition: { definition: TestDefinitionPresentation; revision: number; rowId: number } | null
}

function compatibility(value: CanonicalRunnerCompatibility | undefined): PresentedIntrinsicCompatibility {
  if (!value) return { state: 'not_evaluated', reason: null, explanation: 'Intrinsic compatibility was not evaluated for this persisted definition foundation.' }
  return value.state === 'compatible'
    ? { state: 'compatible', reason: null, explanation: value.explanation }
    : { state: 'blocked', reason: value.reason ?? null, explanation: value.explanation }
}

function presentV1Definition(value: CanonicalTestDefinitionV1): LegacyTestDefinitionPresentation {
  return {
    schemaVersion: 1,
    authorityClass: 'legacy_v1',
    definitionId: value.id,
    title: value.title,
    intent: value.intent,
    category: value.category,
    subjects: [...value.canonicalSubjects],
    generationMethod: value.generationMethod,
    validation: { ...value.validation },
    intrinsicCompatibility: compatibility(value.runnerCompatibility),
    provenance: {
      label: 'LEGACY PROVENANCE',
      sourceObservationId: value.provenance.sourceObservationId,
      modelRowId: value.provenance.modelRowId,
      modelVersion: value.provenance.modelVersion,
      supportingEvidenceCount: value.provenance.supportingEvidenceIds.length,
    },
    routeEvidence: {
      state: 'legacy_compatibility',
      normalizedPath: null,
      explanation: 'Historical v1 route data is compatibility evidence and is not presented as governed canonical route authority.',
    },
    authenticationExpectation: {
      state: 'legacy_compatibility',
      mechanism: null,
      explanation: 'Historical v1 authentication data is not presented as canonical AuthenticationExpectation.',
    },
    executionPolicy: 'legacy_provenance_unsupported',
    confidenceLimitations: [...value.confidenceLimitations],
    materialUnknowns: [...value.materialUnknowns],
    unobservedScope: [...value.unobservedScope],
    preventedStrongerDefinition: value.preventedStrongerDefinition,
  }
}

function presentV2Definition(value: CanonicalTestDefinitionV2): CanonicalV2TestDefinitionPresentation {
  const observationIds = Array.from(new Set(value.provenance.subjectSupport.flatMap(item => item.supportingObservationIds))).sort()
  const gapIds = Array.from(new Set(value.provenance.subjectSupport.flatMap(item => item.supportingGapIds))).sort()
  const missingRouteState = value.runnerCompatibility?.state === 'blocked' && value.runnerCompatibility.reason === 'route_conflicted'
    ? 'conflicted' as const : 'unknown' as const
  return {
    schemaVersion: 2,
    authorityClass: 'canonical_v2',
    definitionId: value.id,
    title: value.title,
    intent: value.intent,
    category: 'navigation',
    subjects: [...value.canonicalSubjects],
    generationMethod: value.generationMethod,
    validation: { ...value.validation },
    intrinsicCompatibility: compatibility(value.runnerCompatibility),
    provenance: {
      label: 'SEALED CANONICAL SUPPORT',
      modelRowId: value.provenance.modelRowId,
      modelVersion: value.provenance.modelVersion,
      supportSealHash: value.provenance.supportSealHash,
      supportingObservationCount: observationIds.length,
      supportingGapCount: gapIds.length,
      subjectSupportCount: value.provenance.subjectSupport.length,
      supportingObservationIds: observationIds,
      supportingGapIds: gapIds,
    },
    routeEvidence: value.routeEvidence
      ? {
          state: 'available',
          normalizedPath: value.routeEvidence.normalizedPath,
          normalizationPolicy: { ...value.routeEvidence.normalizationPolicy },
          supportingObservationCount: value.routeEvidence.supportingObservationIds.length,
          supportingObservationIds: [...value.routeEvidence.supportingObservationIds],
        }
      : { state: missingRouteState, normalizedPath: null, normalizationPolicy: null, supportingObservationCount: 0, supportingObservationIds: [] },
    authenticationExpectation: value.authenticationExpectation
      ? {
          state: value.authenticationExpectation.state,
          mechanism: value.authenticationExpectation.mechanism,
          basis: value.authenticationExpectation.bases.map(item => ({ kind: item.kind, policyId: item.policyId, policyVersion: item.policyVersion })),
        }
      : { state: 'unknown', mechanism: null, basis: [] },
    action: value.action ? { kind: value.action.kind, subjectId: value.action.subjectId, normalizedPath: value.action.routePath } : null,
    oracle: value.oracle ? { kind: value.oracle.kind, subjectId: value.oracle.subjectId, explanation: value.oracle.explanation } : null,
    executionPolicy: 'canonical_v2_preflight_required',
    confidenceLimitations: [...value.confidenceLimitations],
    materialUnknowns: [...value.materialUnknowns],
    unobservedScope: [...value.unobservedScope],
    preventedStrongerDefinition: value.preventedStrongerDefinition,
  }
}

function presentTestSet(value: CanonicalTestSetV1 | CanonicalTestSetV2): TestSetPresentation {
  const common = {
    testSetId: value.testSetId,
    revision: value.revision,
    projectId: value.projectId,
    generationId: value.generationId,
    generatedAt: value.generatedAt,
    outcome: value.outcome,
    limitations: [...value.limitations],
    materialUnknowns: [...value.materialUnknowns],
    unobservedScope: [...value.unobservedScope],
    preventedStrongerSet: value.preventedStrongerSet,
    coverage: value.coverage,
    freshness: value.freshness,
  }
  if (value.schemaVersion === 1) return {
    ...common,
    schemaVersion: 1,
    authorityClass: 'legacy_v1',
    definitions: value.definitions.map(presentV1Definition),
    provenance: {
      label: 'LEGACY PROVENANCE',
      sourceObservationId: value.sourceObservationId,
      modelRowId: value.modelRowId,
      modelVersion: value.modelVersion,
      supportingEvidenceCount: value.supportingEvidenceIds.length,
    },
  }
  const subjectSupportCount = value.definitions.reduce((count, item) => count + item.provenance.subjectSupport.length, 0)
  return {
    ...common,
    schemaVersion: 2,
    authorityClass: 'canonical_v2',
    definitions: value.definitions.map(presentV2Definition),
    provenance: {
      label: 'SEALED CANONICAL SUPPORT',
      modelRowId: value.canonicalSupport.modelRowId,
      modelVersion: value.canonicalSupport.modelVersion,
      observationRunId: value.canonicalSupport.observationRunId,
      supportSealHash: value.canonicalSupport.supportSealHash,
      characterizationPolicy: { ...value.canonicalSupport.characterizationPolicy },
      supportingObservationCount: value.canonicalSupport.supportingObservationIds.length,
      supportingGapCount: value.canonicalSupport.supportingGapIds.length,
      subjectSupportCount,
    },
  }
}

function presentHistory(value: TestSetHistoryItem): TestSetHistoryPresentation {
  const common = {
    rowId: value.rowId,
    testSetId: value.testSetId,
    revision: value.revision,
    generationId: value.generationId,
    generatedAt: value.generatedAt,
    outcome: value.outcome,
    modelRowId: value.modelRowId,
    modelVersion: value.modelVersion,
    definitionCount: value.definitionCount,
    contentHash: value.contentHash,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    temporalIntegrity: value.temporalIntegrity,
    temporalCode: value.temporalCode,
    temporalExplanation: value.temporalExplanation,
  }
  if (value.schemaVersion === 1) return {
    ...common,
    schemaVersion: 1,
    authorityClass: 'legacy_v1',
    provenance: { label: 'LEGACY PROVENANCE', sourceObservationId: value.sourceObservationId! },
  }
  return {
    ...common,
    schemaVersion: 2,
    authorityClass: 'canonical_v2',
    provenance: { label: 'SEALED CANONICAL SUPPORT', observationRunId: value.observationRunId!, supportSealHash: value.supportSealHash! },
  }
}

/** Read-only presentation owner. Persistence remains exclusively repository-owned. */
export class TestCasePresentationService {
  constructor(private readonly repository = new TestSetRepository()) {}

  async read(projectId: string, options: { limit?: number; cursor?: string | null; definitionId?: string | null } = {}): Promise<TestInventoryPresentation | { kind: 'invalid_cursor' }> {
    const inventory = await this.repository.readInventory(projectId, options)
    if ('kind' in inventory) return inventory
    return this.present(inventory)
  }

  present(inventory: TestInventoryRead): TestInventoryPresentation {
    return {
      current: inventory.current ? { ...inventory.current, testSet: presentTestSet(inventory.current.testSet) } : null,
      history: inventory.history.map(presentHistory),
      total: inventory.total,
      nextCursor: inventory.nextCursor,
      requestedDefinition: inventory.requestedDefinition
        ? {
            revision: inventory.requestedDefinition.revision,
            rowId: inventory.requestedDefinition.rowId,
            definition: 'category' in inventory.requestedDefinition.definition
              ? presentV1Definition(inventory.requestedDefinition.definition as CanonicalTestDefinitionV1)
              : presentV2Definition(inventory.requestedDefinition.definition as CanonicalTestDefinitionV2),
          }
        : null,
    }
  }
}

export const testCasePresentationService = new TestCasePresentationService()
