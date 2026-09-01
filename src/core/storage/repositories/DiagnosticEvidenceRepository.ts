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

import * as crypto from 'crypto'
import type { Kysely, Transaction } from 'kysely'
import { getDb } from '../db'
import type { Database, DiagnosticEvidenceRow } from '../types'
import {
  canonicalDiagnosticJson,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  parseDiagnosticEvidenceFactsV1,
  parseDiagnosticEvidenceV1,
  type DiagnosticEvidenceFactsV1,
} from '../../execution/DiagnosticEvidenceContract'
import {
  HistoricalDefinitionAuthorityResolver,
  type HistoricalAuthorityBinding,
} from '../../execution/HistoricalDefinitionAuthorityResolver'

export interface DiagnosticEvidenceWrite {
  binding: HistoricalAuthorityBinding
  facts: DiagnosticEvidenceFactsV1
}

export interface DiagnosticEvidenceWriteResult {
  row: DiagnosticEvidenceRow
  evidenceHash: string
  replayed: boolean
}

export interface DiagnosticEvidenceIdentity {
  projectId: string
  executionId: string
  runId: string
  itemOrdinal: number
  evidenceSchemaVersion: string
}

export class DiagnosticEvidencePersistenceError extends Error {
  constructor(message = 'Diagnostic evidence did not commit.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DiagnosticEvidencePersistenceError'
  }
}

export class DiagnosticEvidenceConflictError extends DiagnosticEvidencePersistenceError {
  constructor() {
    super('The same diagnostic authority identity already carries a different evidence hash.')
    this.name = 'DiagnosticEvidenceConflictError'
  }
}

export class DiagnosticEvidenceRepository {
  constructor(
    private readonly dbProvider: () => Kysely<Database> = getDb,
    private readonly resolver = new HistoricalDefinitionAuthorityResolver(dbProvider),
  ) {}

  async append(write: DiagnosticEvidenceWrite, transaction?: Transaction<Database>): Promise<DiagnosticEvidenceWriteResult> {
    const operation = async (trx: Transaction<Database>): Promise<DiagnosticEvidenceWriteResult> => {
      const facts = parseDiagnosticEvidenceFactsV1(write.facts)
      const authority = await this.resolver.resolve(write.binding, trx)
      const evidence = parseDiagnosticEvidenceV1({
        schemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
        authority,
        ...facts,
      })
      const evidenceJson = canonicalDiagnosticJson(evidence)
      const evidenceHash = crypto.createHash('sha256').update(evidenceJson).digest('hex')
      const existing = await trx.selectFrom('diagnostic_evidence').selectAll()
        .where('project_id', '=', authority.projectId).where('execution_id', '=', authority.executionId)
        .where('run_id', '=', authority.runId).where('item_ordinal', '=', authority.itemOrdinal)
        .where('evidence_schema_version', '=', DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION).executeTakeFirst()
      if (existing) {
        if (existing.evidence_hash !== evidenceHash || existing.evidence_json !== evidenceJson) {
          throw new DiagnosticEvidenceConflictError()
        }
        return { row: existing, evidenceHash, replayed: true }
      }
      const row = await trx.insertInto('diagnostic_evidence').values({
        evidence_schema_version: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
        evidence_hash: evidenceHash,
        project_id: authority.projectId,
        execution_id: authority.executionId,
        run_id: authority.runId,
        item_ordinal: authority.itemOrdinal,
        result_id: authority.resultId,
        definition_id: authority.definitionId,
        executable_plan_hash: authority.executablePlanHash,
        accepted_definition_authority_json: canonicalDiagnosticJson(authority.acceptedDefinitionAuthority),
        suite_authority_json: authority.suiteAuthority === null ? null : canonicalDiagnosticJson(authority.suiteAuthority),
        evidence_json: evidenceJson,
      }).returningAll().executeTakeFirstOrThrow()
      return { row, evidenceHash, replayed: false }
    }
    try {
      return transaction ? await operation(transaction) : await this.dbProvider().transaction().execute(operation)
    } catch (cause) {
      if (cause instanceof DiagnosticEvidencePersistenceError) throw cause
      throw new DiagnosticEvidencePersistenceError(undefined, { cause })
    }
  }

  async read(projectId: string, executionId: string, transaction?: Transaction<Database>): Promise<DiagnosticEvidenceRow[]> {
    const db = transaction ?? this.dbProvider()
    return db.selectFrom('diagnostic_evidence').selectAll()
      .where('project_id', '=', projectId).where('execution_id', '=', executionId)
      .orderBy('run_id').orderBy('item_ordinal').execute()
  }

  async readExact(identity: DiagnosticEvidenceIdentity, transaction?: Transaction<Database>): Promise<DiagnosticEvidenceRow | null> {
    const db = transaction ?? this.dbProvider()
    return await db.selectFrom('diagnostic_evidence').selectAll()
      .where('project_id', '=', identity.projectId)
      .where('execution_id', '=', identity.executionId)
      .where('run_id', '=', identity.runId)
      .where('item_ordinal', '=', identity.itemOrdinal)
      .where('evidence_schema_version', '=', identity.evidenceSchemaVersion)
      .executeTakeFirst() ?? null
  }
}
