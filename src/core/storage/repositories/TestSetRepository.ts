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

import { getDb } from '../db'
import {
  generateEvidenceBackedTestSet,
  parseCanonicalTestSet,
  type CanonicalTestDefinition,
  type CanonicalTestSet,
  type TestDesignAuthorityInput,
  type TestGenerationOutcome,
} from '../../test-design/TestDefinitionContract'

export const DEFAULT_TEST_SET_HISTORY_LIMIT = 25
export const MAX_TEST_SET_HISTORY_LIMIT = 50

export class DuplicateTestGenerationError extends Error {
  constructor() { super('A test-design generation is already active for this project.'); this.name = 'DuplicateTestGenerationError' }
}

export class MalformedTestSetError extends Error {
  constructor() { super('Persisted test-set history could not be validated safely.'); this.name = 'MalformedTestSetError' }
}

export interface TestSetHistoryItem {
  rowId: number
  testSetId: string
  revision: number
  generationId: string
  generatedAt: string
  outcome: TestGenerationOutcome
  sourceObservationId: string
  modelRowId: number
  modelVersion: string
  definitionCount: number
  contentHash: string
  startedAt: string
  completedAt: string | null
  temporalIntegrity: 'verified' | 'failed'
  temporalCode: 'GENERATION_TIMESTAMP_INCONSISTENT' | null
  temporalExplanation: string
}

export interface TestInventoryRead {
  current: { rowId: number; contentHash: string; testSet: CanonicalTestSet; startedAt: string; completedAt: string | null; temporalIntegrity: 'verified' | 'failed'; temporalCode: 'GENERATION_TIMESTAMP_INCONSISTENT' | null; temporalExplanation: string } | null
  history: TestSetHistoryItem[]
  total: number
  nextCursor: string | null
  requestedDefinition: { definition: CanonicalTestDefinition; revision: number; rowId: number } | null
}

type TemporalRead = Pick<TestSetHistoryItem, 'startedAt' | 'completedAt' | 'temporalIntegrity' | 'temporalCode' | 'temporalExplanation'>

const TEMPORAL_FAILURE_CODE = 'GENERATION_TIMESTAMP_INCONSISTENT' as const
const TEMPORAL_FAILURE_EXPLANATION = 'The immutable record was preserved, but its completion timestamp precedes its start timestamp and must not be treated as temporally reliable.'
const TEMPORAL_VERIFIED_EXPLANATION = 'The persisted generation lifecycle timestamps are ordered.'

export interface TestGenerationStatusRead {
  generationId: string
  projectId: string
  state: 'running' | TestGenerationOutcome
  complete: boolean
  startedAt: string
  completedAt: string | null
  safeCode: string | null
  explanation: string
  testSetRowId: number | null
  temporalIntegrity: 'verified' | 'failed'
}

function isMissingSchema(cause: unknown): boolean {
  return cause instanceof Error && /no such table: test_(?:set_revisions|generation_events|generation_locks)/i.test(cause.message)
}

function historyCursor(projectId: string, limit: number, revision: number): string {
  return Buffer.from(JSON.stringify({ v: 1, projectId, limit, order: 'revision-desc-v1', after: revision }), 'utf8').toString('base64url')
}

function parseHistoryCursor(cursor: string | null, projectId: string, limit: number): number | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    return value.v === 1 && value.projectId === projectId && value.limit === limit
      && value.order === 'revision-desc-v1' && Number.isSafeInteger(value.after) && Number(value.after) > 0
      ? Number(value.after) : Number.NaN
  } catch { return Number.NaN }
}

/**
 * Immutable definition truth and mutable duplicate-prevention coordination are
 * intentionally separate. Only this repository may assemble their transaction.
 */
export class TestSetRepository {
  async readInventory(projectId: string, options: { limit?: number; cursor?: string | null; definitionId?: string | null } = {}): Promise<TestInventoryRead | { kind: 'invalid_cursor' }> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_TEST_SET_HISTORY_LIMIT, 1), MAX_TEST_SET_HISTORY_LIMIT)
    const after = parseHistoryCursor(options.cursor ?? null, projectId, limit)
    if (Number.isNaN(after)) return { kind: 'invalid_cursor' }
    const db = getDb()
    try {
      const totalRow = await db.selectFrom('test_set_revisions').select(({ fn }) => fn.countAll<number>().as('count')).where('project_id', '=', projectId).executeTakeFirstOrThrow()
      let query = db.selectFrom('test_set_revisions').selectAll().where('project_id', '=', projectId)
      if (after !== null) query = query.where('revision', '<', after)
      const rows = await query.orderBy('revision', 'desc').limit(limit + 1).execute()
      const pageRows = rows.slice(0, limit)
      const parseRow = (row: typeof pageRows[number]) => {
        const parsed = parseCanonicalTestSet(row.payload_json)
        if (parsed.fingerprint !== row.content_hash || parsed.value.projectId !== projectId
          || parsed.value.revision !== row.revision || parsed.value.generationId !== row.generation_id
          || parsed.value.definitions.length !== row.definition_count) throw new MalformedTestSetError()
        return parsed.value
      }
      const temporalFor = async (generationId: string): Promise<TemporalRead> => {
        const events = await db.selectFrom('test_generation_events').selectAll().where('project_id', '=', projectId).where('generation_id', '=', generationId).orderBy('id').execute()
        const started = events.find(event => event.event_type === 'started')
        const terminal = events.find(event => event.event_type === 'terminal')
        if (!started || !terminal || Number.isNaN(Date.parse(started.occurred_at)) || Number.isNaN(Date.parse(terminal.occurred_at))) throw new MalformedTestSetError()
        const verified = Date.parse(terminal.occurred_at) >= Date.parse(started.occurred_at)
        return {
          startedAt: started.occurred_at,
          completedAt: terminal.occurred_at,
          temporalIntegrity: verified ? 'verified' : 'failed',
          temporalCode: verified ? null : TEMPORAL_FAILURE_CODE,
          temporalExplanation: verified ? TEMPORAL_VERIFIED_EXPLANATION : TEMPORAL_FAILURE_EXPLANATION,
        }
      }
      const parsedPage = await Promise.all(pageRows.map(async row => ({ row, value: parseRow(row), temporal: await temporalFor(row.generation_id) })))
      const newestRow = await db.selectFrom('test_set_revisions').selectAll().where('project_id', '=', projectId).orderBy('revision', 'desc').limit(1).executeTakeFirst()
      const current = newestRow ? { rowId: Number(newestRow.id), contentHash: newestRow.content_hash, testSet: parseRow(newestRow as typeof pageRows[number]), ...(await temporalFor(newestRow.generation_id)) } : null
      let requestedDefinition: TestInventoryRead['requestedDefinition'] = null
      if (options.definitionId) {
        const allRows = await db.selectFrom('test_set_revisions').selectAll().where('project_id', '=', projectId).orderBy('revision', 'desc').execute()
        for (const row of allRows) {
          const value = parseRow(row as typeof pageRows[number])
          const definition = value.definitions.find(item => item.id === options.definitionId)
          if (definition) { requestedDefinition = { definition, revision: value.revision, rowId: Number(row.id) }; break }
        }
      }
      return {
        current,
        history: parsedPage.map(({ row, value, temporal }) => ({
          rowId: Number(row.id), testSetId: value.testSetId, revision: value.revision,
          generationId: value.generationId, generatedAt: value.generatedAt, outcome: value.outcome,
          sourceObservationId: value.sourceObservationId, modelRowId: value.modelRowId,
          modelVersion: value.modelVersion, definitionCount: value.definitions.length,
          contentHash: row.content_hash,
          ...temporal,
        })),
        total: Number(totalRow.count),
        nextCursor: rows.length > limit ? historyCursor(projectId, limit, pageRows[pageRows.length - 1].revision) : null,
        requestedDefinition,
      }
    } catch (cause) {
      if (isMissingSchema(cause)) return { current: null, history: [], total: 0, nextCursor: null, requestedDefinition: null }
      if (cause instanceof MalformedTestSetError) throw cause
      throw new MalformedTestSetError()
    }
  }

  async beginGeneration(projectId: string, generationId: string, processInstanceId: string, startedAt: string): Promise<void> {
    const db = getDb()
    await db.transaction().execute(async trx => {
      const lock = await trx.selectFrom('test_generation_locks').selectAll().where('project_id', '=', projectId).executeTakeFirst()
      if (lock?.process_instance_id === processInstanceId) throw new DuplicateTestGenerationError()
      if (lock) await trx.deleteFrom('test_generation_locks').where('project_id', '=', projectId).execute()
      await trx.insertInto('test_generation_locks').values({ project_id: projectId, generation_id: generationId, process_instance_id: processInstanceId, acquired_at: startedAt }).execute()
      await trx.insertInto('test_generation_events').values({
        generation_id: generationId, project_id: projectId, event_type: 'started', outcome: null,
        occurred_at: startedAt, process_instance_id: processInstanceId, test_set_row_id: null,
        safe_code: null, safe_message: 'Evidence-backed test design started.',
      }).execute()
    })
  }

  async commitGeneration(input: TestDesignAuthorityInput, generationId: string, processInstanceId: string): Promise<{ rowId: number; testSet: CanonicalTestSet; contentHash: string }> {
    const db = getDb()
    return db.transaction().execute(async trx => {
      const lock = await trx.selectFrom('test_generation_locks').selectAll().where('project_id', '=', input.projectId).executeTakeFirst()
      if (!lock || lock.generation_id !== generationId || lock.process_instance_id !== processInstanceId) throw new DuplicateTestGenerationError()
      const latest = await trx.selectFrom('test_set_revisions').select('revision').where('project_id', '=', input.projectId).orderBy('revision', 'desc').limit(1).executeTakeFirst()
      const materialized = generateEvidenceBackedTestSet(input, generationId, (latest?.revision ?? 0) + 1)
      const inserted = await trx.insertInto('test_set_revisions').values({
        test_set_id: materialized.value.testSetId, revision: materialized.value.revision,
        project_id: input.projectId, generation_id: generationId,
        source_observation_id: materialized.value.sourceObservationId,
        model_row_id: materialized.value.modelRowId, model_version: materialized.value.modelVersion,
        generated_at: materialized.value.generatedAt, outcome: materialized.value.outcome,
        definition_count: materialized.value.definitions.length, payload_json: materialized.json,
        content_hash: materialized.fingerprint,
      }).returning('id').executeTakeFirstOrThrow()
      const rowId = Number(inserted.id)
      await trx.insertInto('test_generation_events').values({
        generation_id: generationId, project_id: input.projectId, event_type: 'terminal',
        outcome: materialized.value.outcome, occurred_at: input.generatedAt,
        process_instance_id: processInstanceId, test_set_row_id: rowId, safe_code: null,
        safe_message: 'Evidence-backed test definitions were persisted; runner compatibility remains independently constrained.',
      }).execute()
      await trx.deleteFrom('test_generation_locks').where('project_id', '=', input.projectId).where('generation_id', '=', generationId).execute()
      return { rowId, testSet: materialized.value, contentHash: materialized.fingerprint }
    })
  }

  async failGeneration(projectId: string, generationId: string, processInstanceId: string, completedAt: string, code: string, message: string): Promise<void> {
    const db = getDb()
    await db.transaction().execute(async trx => {
      const existing = await trx.selectFrom('test_generation_events').select('id').where('generation_id', '=', generationId).where('event_type', '=', 'terminal').executeTakeFirst()
      if (!existing) await trx.insertInto('test_generation_events').values({
        generation_id: generationId, project_id: projectId, event_type: 'terminal', outcome: 'failed',
        occurred_at: completedAt, process_instance_id: processInstanceId, test_set_row_id: null,
        safe_code: code, safe_message: message,
      }).execute()
      await trx.deleteFrom('test_generation_locks').where('project_id', '=', projectId).where('generation_id', '=', generationId).execute()
    })
  }

  async readGenerationStatus(projectId: string, generationId: string, processInstanceId: string): Promise<TestGenerationStatusRead | null> {
    const db = getDb()
    try {
      const events = await db.selectFrom('test_generation_events').selectAll().where('project_id', '=', projectId).where('generation_id', '=', generationId).orderBy('id').execute()
      const started = events.find(event => event.event_type === 'started')
      if (!started) return null
      const terminal = events.find(event => event.event_type === 'terminal')
      if (terminal) {
        const temporalIntegrity = !Number.isNaN(Date.parse(started.occurred_at))
          && !Number.isNaN(Date.parse(terminal.occurred_at))
          && Date.parse(terminal.occurred_at) >= Date.parse(started.occurred_at)
          ? 'verified' as const : 'failed' as const
        return {
        generationId, projectId, state: terminal.outcome as TestGenerationOutcome, complete: true,
        startedAt: started.occurred_at, completedAt: terminal.occurred_at,
        safeCode: temporalIntegrity === 'failed' ? 'GENERATION_TIMESTAMP_INCONSISTENT' : terminal.safe_code,
        explanation: temporalIntegrity === 'failed'
          ? 'A terminal generation record exists, but its persisted lifecycle timestamps are inconsistent.'
          : terminal.safe_message,
        testSetRowId: terminal.test_set_row_id,
        temporalIntegrity,
        }
      }
      const lock = await db.selectFrom('test_generation_locks').selectAll().where('project_id', '=', projectId).where('generation_id', '=', generationId).executeTakeFirst()
      const live = lock?.process_instance_id === processInstanceId
      return {
        generationId, projectId, state: live ? 'running' : 'interrupted', complete: !live,
        startedAt: started.occurred_at, completedAt: null, safeCode: live ? null : 'GENERATION_INTERRUPTED',
        explanation: live ? 'Evidence-backed test design is running.' : 'The generation began in an earlier server process and no terminal record was persisted.',
        testSetRowId: null,
        temporalIntegrity: 'verified',
      }
    } catch (cause) {
      if (isMissingSchema(cause)) return null
      throw new MalformedTestSetError()
    }
  }
}
