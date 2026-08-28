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

import { DatabaseAuthorityMode } from '../DatabaseAuthority'
import { getDatabaseProvenance, getProductDb } from '../db'
import type { ManualPromotionTransactionFaultInjector } from '../repositories/TestSetRepository'
import { parseCanonicalTestSet } from '../../test-design/TestDefinitionContract'

export class ManualPromotionCertificationFault extends Error {
  constructor() {
    super('Certification-injected failure after Test Set revision insertion and before manual promotion provenance insertion.')
    this.name = 'ManualPromotionCertificationFault'
  }
}

export interface ManualTestCertificationInventory {
  projectId: string
  counts: {
    manualTestSources: number
    definitions: number
    testSetRevisions: number
    manualTestPromotions: number
  }
  manualTestSources: Array<{
    sourceId: string
    projectId: string
    schemaVersion: string
    sourceKind: string
    payloadJson: string
    contentHash: string
    admittedAt: string
  }>
  definitions: Array<{
    projectId: string
    testSetRowId: number
    testSetId: string
    testSetRevision: number
    definitionOrdinal: number
    definitionId: string
    definitionSchemaVersion: 1 | 2 | 3
  }>
  testSetRevisions: Array<{
    rowId: number
    projectId: string
    testSetId: string
    revision: number
    generationId: string
    schemaVersion: number
    generatedAt: string
    outcome: string
    definitionCount: number
    contentHash: string
  }>
  manualTestPromotions: Array<{
    proposalId: string
    projectId: string
    proposalSchemaVersion: string
    sourceId: string
    sourceContentHash: string
    proposalPayloadJson: string
    proposalContentHash: string
    testSetRowId: number
    testSetId: string
    testSetRevision: number
    testSetContentHash: string
    definitionId: string
    promotedAt: string
  }>
}

/**
 * In-process authority for disposable certification databases only. It exposes
 * read-only persisted inventories and a one-shot transaction fault capability;
 * it is not wired into the production ExecutionContext singleton or any HTTP route.
 * The M3 integration harness may pair it with the explicit certification-only
 * ExecutionContext factory, which supplies the same guarded database authority.
 */
export class ManualTestCertificationPersistenceAdapter implements ManualPromotionTransactionFaultInjector {
  private faultArmed = false

  constructor() { this.assertDisposableCertification() }

  armPromotionFaultOnce(): void {
    this.assertDisposableCertification()
    this.faultArmed = true
  }

  disarmPromotionFault(): void {
    this.assertDisposableCertification()
    this.faultArmed = false
  }

  async afterTestSetRevisionInsertBeforePromotion(): Promise<void> {
    this.assertDisposableCertification()
    if (!this.faultArmed) return
    this.faultArmed = false
    throw new ManualPromotionCertificationFault()
  }

  async snapshot(projectId: string): Promise<ManualTestCertificationInventory> {
    this.assertDisposableCertification()
    const db = getProductDb()
    const [sourceRows, testSetRows, promotionRows] = await Promise.all([
      db.selectFrom('manual_test_sources').selectAll().where('project_id', '=', projectId)
        .orderBy('source_id').execute(),
      db.selectFrom('test_set_revisions').selectAll().where('project_id', '=', projectId)
        .orderBy('revision').orderBy('id').execute(),
      db.selectFrom('manual_test_promotions').selectAll().where('project_id', '=', projectId)
        .orderBy('proposal_id').execute(),
    ])
    const definitions: ManualTestCertificationInventory['definitions'] = []
    const testSetRevisions = testSetRows.map(row => {
      const parsed = parseCanonicalTestSet(row.payload_json)
      if (parsed.fingerprint !== row.content_hash
        || parsed.value.projectId !== row.project_id
        || parsed.value.testSetId !== row.test_set_id
        || parsed.value.revision !== row.revision
        || parsed.value.generationId !== row.generation_id
        || parsed.value.schemaVersion !== Number(row.schema_version)
        || parsed.value.definitions.length !== row.definition_count) {
        throw new Error('Persisted Test Set revision inventory failed integrity validation.')
      }
      parsed.value.definitions.forEach((definition, index) => definitions.push({
        projectId: row.project_id,
        testSetRowId: Number(row.id),
        testSetId: row.test_set_id,
        testSetRevision: row.revision,
        definitionOrdinal: index + 1,
        definitionId: definition.id,
        definitionSchemaVersion: parsed.value.schemaVersion,
      }))
      return {
        rowId: Number(row.id), projectId: row.project_id,
        testSetId: row.test_set_id, revision: row.revision,
        generationId: row.generation_id, schemaVersion: Number(row.schema_version),
        generatedAt: row.generated_at, outcome: row.outcome,
        definitionCount: row.definition_count, contentHash: row.content_hash,
      }
    })
    return {
      projectId,
      counts: {
        manualTestSources: sourceRows.length,
        definitions: definitions.length,
        testSetRevisions: testSetRows.length,
        manualTestPromotions: promotionRows.length,
      },
      manualTestSources: sourceRows.map(row => ({
        sourceId: row.source_id, projectId: row.project_id,
        schemaVersion: row.schema_version, sourceKind: row.source_kind,
        payloadJson: row.payload_json, contentHash: row.content_hash, admittedAt: row.admitted_at,
      })),
      definitions,
      testSetRevisions,
      manualTestPromotions: promotionRows.map(row => ({
        proposalId: row.proposal_id, projectId: row.project_id,
        proposalSchemaVersion: row.proposal_schema_version,
        sourceId: row.source_id, sourceContentHash: row.source_content_hash,
        proposalPayloadJson: row.proposal_payload_json, proposalContentHash: row.proposal_content_hash,
        testSetRowId: row.test_set_row_id, testSetId: row.test_set_id,
        testSetRevision: row.test_set_revision, testSetContentHash: row.test_set_content_hash,
        definitionId: row.definition_id, promotedAt: row.promoted_at,
      })),
    }
  }

  private assertDisposableCertification(): void {
    const provenance = getDatabaseProvenance()
    if (provenance.authorityMode !== DatabaseAuthorityMode.DISPOSABLE_CERTIFICATION
      || provenance.dialect !== 'sqlite' || !provenance.productSchemaEligible) {
      throw new Error('Manual Test certification persistence authority requires a disposable governed SQLite database.')
    }
  }
}
