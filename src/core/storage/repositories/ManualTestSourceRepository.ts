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
import { getProductDb } from '../db'
import {
  manualSourceContentHash,
  materializeManualTestSourceV1,
  parseManualTestSourceV1,
  type ManualTestSourceInputV1,
  type ManualTestSourceV1,
} from '../../test-design/ManualTestSourceContract'

export class ManualTestSourcePersistenceError extends Error {
  constructor(readonly code:
    | 'MANUAL_SOURCE_NOT_FOUND'
    | 'MANUAL_SOURCE_IDENTITY_CONFLICT'
    | 'MANUAL_SOURCE_INTEGRITY_INVALID') {
    super(code === 'MANUAL_SOURCE_NOT_FOUND'
      ? 'The admitted manual source was not found.'
      : code === 'MANUAL_SOURCE_IDENTITY_CONFLICT'
        ? 'Manual source identity conflicts with persisted authority.'
        : 'Persisted manual source authority failed integrity validation.')
    this.name = 'ManualTestSourcePersistenceError'
  }
}

function defaultSourceId(): string {
  return `manual-source-${crypto.randomUUID()}`
}

export class ManualTestSourceRepository {
  constructor(private readonly mintSourceId = defaultSourceId) {}

  async admit(
    projectId: string,
    input: ManualTestSourceInputV1,
    admittedAt: string,
  ): Promise<ManualTestSourceV1> {
    const db = getProductDb()
    const contentHash = manualSourceContentHash(projectId, input)
    return db.transaction().execute(async trx => {
      const existing = await trx.selectFrom('manual_test_sources').selectAll()
        .where('project_id', '=', projectId).where('content_hash', '=', contentHash).executeTakeFirst()
      if (existing) return this.parseRow(existing)
      const materialized = materializeManualTestSourceV1(projectId, this.mintSourceId(), input)
      try {
        await trx.insertInto('manual_test_sources').values({
          source_id: materialized.value.sourceId,
          project_id: projectId,
          schema_version: materialized.value.schemaVersion,
          source_kind: materialized.value.sourceKind,
          payload_json: materialized.json,
          content_hash: materialized.contentHash,
          admitted_at: admittedAt,
        }).execute()
      } catch (cause) {
        const replay = await trx.selectFrom('manual_test_sources').selectAll()
          .where('project_id', '=', projectId).where('content_hash', '=', contentHash).executeTakeFirst()
        if (replay) return this.parseRow(replay)
        throw cause
      }
      return materialized.value
    })
  }

  async read(projectId: string, sourceId: string): Promise<ManualTestSourceV1 | null> {
    const row = await getProductDb().selectFrom('manual_test_sources').selectAll()
      .where('project_id', '=', projectId).where('source_id', '=', sourceId).executeTakeFirst()
    return row ? this.parseRow(row) : null
  }

  private parseRow(row: {
    source_id: string; project_id: string; schema_version: string; source_kind: string
    payload_json: string; content_hash: string
  }): ManualTestSourceV1 {
    let value: unknown
    try { value = JSON.parse(row.payload_json) } catch { throw new ManualTestSourcePersistenceError('MANUAL_SOURCE_INTEGRITY_INVALID') }
    let source: ManualTestSourceV1
    try { source = parseManualTestSourceV1(value, true) } catch { throw new ManualTestSourcePersistenceError('MANUAL_SOURCE_INTEGRITY_INVALID') }
    if (source.sourceId !== row.source_id || source.projectId !== row.project_id
      || source.schemaVersion !== row.schema_version || source.sourceKind !== row.source_kind
      || source.contentHash !== row.content_hash || JSON.stringify(source) !== row.payload_json) {
      throw new ManualTestSourcePersistenceError('MANUAL_SOURCE_INTEGRITY_INVALID')
    }
    return source
  }
}
