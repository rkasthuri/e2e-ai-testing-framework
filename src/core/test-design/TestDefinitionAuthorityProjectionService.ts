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

import { getDb } from '../storage/db'
import { AppModelRepository } from '../storage/repositories/AppModelRepository'
import { appModelSupportHash } from '../storage/AppModelSupportIdentity'
import type { AppModelObservationSupportInput } from '../observation/ObservationTypes'

export type TestDefinitionAuthorityRefusalCode =
  | 'missing_active_model'
  | 'invalid_model'
  | 'missing_support_seal'
  | 'support_seal_mismatch'
  | 'missing_observation'
  | 'missing_gap'
  | 'duplicate_support'
  | 'subject_support_missing'
  | 'subject_support_conflict'
  | 'characterization_policy_mismatch'
  | 'legacy_provenance_unsupported'

export interface CanonicalSubjectAuthority {
  canonicalSubjectId: string
  supportingObservationIds: string[]
  /** No subject-to-Gap relation is persisted in the current sealed authority. */
  supportingGapIds: string[]
}

export interface CanonicalTestDefinitionAuthority {
  schemaVersion: 'forge-test-definition-authority/v2'
  authorityClass: 'canonical_v2'
  projectId: string
  modelRowId: number
  modelVersion: string
  observationRunId: string
  supportSealHash: string
  characterizationPolicy: { id: string; version: string }
  supportingObservationIds: string[]
  supportingGapIds: string[]
  subjectSupport: CanonicalSubjectAuthority[]
}

export type TestDefinitionAuthorityProjectionResult =
  | { kind: 'ok'; authority: CanonicalTestDefinitionAuthority }
  | {
      kind: 'refused'
      authorityClass: 'canonical_v2' | 'legacy_v1'
      code: TestDefinitionAuthorityRefusalCode
      safeMessage: string
    }

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

const REFUSAL_MESSAGES: Readonly<Record<TestDefinitionAuthorityRefusalCode, string>> = Object.freeze({
  missing_active_model: 'No active App Model is available for canonical Test Definition authority.',
  invalid_model: 'The active App Model is not a valid, integrity-verified canonical authority.',
  missing_support_seal: 'The active App Model has no canonical support seal.',
  support_seal_mismatch: 'The persisted App Model support does not match its immutable support seal.',
  missing_observation: 'Sealed App Model support references an unavailable canonical Observation.',
  missing_gap: 'Sealed App Model support references an unavailable canonical ObservationGap.',
  duplicate_support: 'Sealed App Model support contains a duplicate semantic member.',
  subject_support_missing: 'A current App Model subject has no exact sealed subject support.',
  subject_support_conflict: 'App Model subject support conflicts with canonical Observation membership.',
  characterization_policy_mismatch: 'App Model support does not share one sealed characterization policy identity.',
  legacy_provenance_unsupported: 'Legacy singular or operation provenance cannot satisfy canonical v2 authority.',
})

function refused(
  code: TestDefinitionAuthorityRefusalCode,
  authorityClass: 'canonical_v2' | 'legacy_v1' = 'canonical_v2',
): TestDefinitionAuthorityProjectionResult {
  return { kind: 'refused', authorityClass, code, safeMessage: REFUSAL_MESSAGES[code] }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function hasDuplicateSemanticRows(rows: Array<Record<string, unknown>>, fields: string[]): boolean {
  const identities = rows.map(row => fields.map(field => String(row[field])).join('\u0000'))
  return new Set(identities).size !== identities.length
}

/**
 * Read-only owner for v2 Test Definition authority admission.
 *
 * It reads only Product App Model/Observation tables, verifies the persisted
 * seal using the same canonical identity used at commit, and returns no route,
 * authentication, credential, runner, raw Observation, or artifact payload.
 */
export class TestDefinitionAuthorityProjectionService {
  constructor(private readonly appModels = new AppModelRepository()) {}

  async read(projectId: string): Promise<TestDefinitionAuthorityProjectionResult> {
    if (!SAFE_ID.test(projectId)) return refused('missing_active_model')

    const history = await this.appModels.readHistory(projectId, { limit: 1 })
    if (history.kind !== 'ok' || history.activeCount === 0 || !history.activeModel) {
      return refused('missing_active_model')
    }
    if (history.activeCount !== 1
      || history.activeModel.validation !== 'valid'
      || history.activeModel.integrity !== 'verified') {
      return refused('invalid_model')
    }
    const model = history.activeModel
    const db = getDb()
    const seal = await db.selectFrom('app_model_support_seals').selectAll()
      .where('model_row_id', '=', model.rowId).executeTakeFirst()
    if (!seal) {
      return model.sourceObservationRunId === null
        && model.supportObservationIds.length === 0
        && model.supportGapIds.length === 0
        ? refused('legacy_provenance_unsupported', 'legacy_v1')
        : refused('missing_support_seal')
    }
    if (seal.project_id !== projectId) return refused('support_seal_mismatch')

    const [observations, subjects, gaps] = await Promise.all([
      db.selectFrom('app_model_observation_support').selectAll()
        .where('model_row_id', '=', model.rowId).execute(),
      db.selectFrom('app_model_subject_support').selectAll()
        .where('model_row_id', '=', model.rowId).execute(),
      db.selectFrom('app_model_gap_support').selectAll()
        .where('model_row_id', '=', model.rowId).execute(),
    ])
    if (hasDuplicateSemanticRows(observations, ['observation_id', 'claim_key', 'support_role'])
      || hasDuplicateSemanticRows(subjects, ['canonical_subject_id', 'observation_id', 'claim_key', 'support_role'])
      || hasDuplicateSemanticRows(gaps, ['gap_id', 'claim_key', 'support_role'])
      || new Set(observations.map(row => row.observation_id)).size !== observations.length
      || new Set(subjects.map(row => `${row.canonical_subject_id}\u0000${row.observation_id}`)).size !== subjects.length
      || new Set(gaps.map(row => row.gap_id)).size !== gaps.length) {
      return refused('duplicate_support')
    }

    const allSupportRows = [...observations, ...subjects, ...gaps]
    if (allSupportRows.some(row => row.project_id !== projectId)) return refused('support_seal_mismatch')
    const policyMatches = allSupportRows.every(row =>
      row.characterization_policy_id === seal.characterization_policy_id
      && row.characterization_policy_version === seal.characterization_policy_version)
    if (!policyMatches) return refused('characterization_policy_mismatch')

    if (observations.some(row => row.support_role !== 'basis' && row.support_role !== 'bounds')
      || subjects.some(row => row.support_role !== 'basis')
      || gaps.some(row => row.support_role !== 'bounds')) return refused('support_seal_mismatch')

    const observationIds = uniqueSorted(observations.map(row => row.observation_id))
    const gapIds = uniqueSorted(gaps.map(row => row.gap_id))
    if (observationIds.length === 0 && gapIds.length === 0) return refused('support_seal_mismatch')

    const canonicalObservations = observationIds.length === 0 ? [] : await db.selectFrom('observations')
      .select(['observation_id', 'project_id', 'observation_run_id', 'subject_id'])
      .where('observation_id', 'in', observationIds).execute()
    const observationById = new Map(canonicalObservations.map(row => [row.observation_id, row]))
    if (observationIds.some(id => {
      const row = observationById.get(id)
      return !row || row.project_id !== projectId || row.observation_run_id !== seal.observation_run_id
    })) return refused('missing_observation')

    const canonicalGaps = gapIds.length === 0 ? [] : await db.selectFrom('observation_gaps')
      .select(['gap_id', 'project_id', 'observation_run_id'])
      .where('gap_id', 'in', gapIds).execute()
    const gapById = new Map(canonicalGaps.map(row => [row.gap_id, row]))
    if (gapIds.some(id => {
      const row = gapById.get(id)
      return !row || row.project_id !== projectId || row.observation_run_id !== seal.observation_run_id
    })) return refused('missing_gap')

    const modelObservationIds = new Set(observationIds)
    if (subjects.some(row => {
      const observation = observationById.get(row.observation_id)
      return !modelObservationIds.has(row.observation_id)
        || !observation
        || observation.subject_id !== row.canonical_subject_id
    })) return refused('subject_support_conflict')

    const modelSubjectIds = uniqueSorted(model.subjects.map(subject => subject.id))
    const persistedSubjectIds = uniqueSorted(subjects.map(row => row.canonical_subject_id))
    if (modelSubjectIds.length !== persistedSubjectIds.length
      || modelSubjectIds.some((id, index) => id !== persistedSubjectIds[index])) {
      return refused('subject_support_missing')
    }

    const support: AppModelObservationSupportInput = {
      projectId,
      observationRunId: seal.observation_run_id,
      observations: observations.map(row => ({
        observationId: row.observation_id,
        claimKey: row.claim_key,
        supportRole: row.support_role as 'basis' | 'bounds',
      })),
      subjects: subjects.map(row => ({
        canonicalSubjectId: row.canonical_subject_id,
        observationId: row.observation_id,
        claimKey: row.claim_key,
        supportRole: 'basis',
      })),
      gaps: gaps.map(row => ({
        gapId: row.gap_id,
        claimKey: row.claim_key,
        supportRole: 'bounds',
      })),
      characterizationPolicyId: seal.characterization_policy_id,
      characterizationPolicyVersion: seal.characterization_policy_version,
      linkedAt: seal.sealed_at,
    }
    if (appModelSupportHash(support) !== seal.support_hash) return refused('support_seal_mismatch')
    const activeRows = await db.selectFrom('app_models').select(['id', 'version'])
      .where('app_name', '=', projectId).where('status', '=', 'active')
      .orderBy('id', 'desc').limit(2).execute()
    if (activeRows.length === 0) return refused('missing_active_model')
    if (activeRows.length !== 1 || Number(activeRows[0].id) !== model.rowId
      || activeRows[0].version !== model.version) return refused('invalid_model')

    return {
      kind: 'ok',
      authority: {
        schemaVersion: 'forge-test-definition-authority/v2',
        authorityClass: 'canonical_v2',
        projectId,
        modelRowId: model.rowId,
        modelVersion: model.version,
        observationRunId: seal.observation_run_id,
        supportSealHash: seal.support_hash,
        characterizationPolicy: {
          id: seal.characterization_policy_id,
          version: seal.characterization_policy_version,
        },
        supportingObservationIds: observationIds,
        supportingGapIds: gapIds,
        subjectSupport: modelSubjectIds.map(canonicalSubjectId => ({
          canonicalSubjectId,
          supportingObservationIds: uniqueSorted(subjects
            .filter(row => row.canonical_subject_id === canonicalSubjectId)
            .map(row => row.observation_id)),
          supportingGapIds: [],
        })),
      },
    }
  }
}

export const testDefinitionAuthorityProjectionService = new TestDefinitionAuthorityProjectionService()
