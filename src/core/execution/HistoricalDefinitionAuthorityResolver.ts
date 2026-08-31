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
import { getDb } from '../storage/db'
import type { Database } from '../storage/types'
import {
  parseCanonicalTestSet,
  type CanonicalTestDefinitionV2,
  type CanonicalTestDefinitionV3,
  type CanonicalTestSetV2,
  type CanonicalTestSetV3,
} from '../test-design/TestDefinitionContract'
import { routeEvidenceIdentity } from './ExecutionProjectionService'
import type { DiagnosticEvidenceAuthorityV1 } from './DiagnosticEvidenceContract'

export interface HistoricalAuthorityBinding {
  projectId: string
  executionId: string
  runId: string
  itemOrdinal: number
  resultId: string | null
  definitionId: string
  executablePlanHash: string
}

export class HistoricalDefinitionAuthorityError extends Error {
  constructor(message = 'Exact historical accepted Definition authority could not be resolved.') {
    super(message)
    this.name = 'HistoricalDefinitionAuthorityError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const HASH = /^[a-f0-9]{64}$/

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function authenticationIdentity(definition: CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3): string | null {
  return definition.authenticationExpectation ? digest({
    schemaVersion: 'forge-authentication-expectation/v1',
    state: definition.authenticationExpectation.state,
    mechanism: definition.authenticationExpectation.mechanism,
    bases: definition.authenticationExpectation.bases,
  }) : null
}

function selectionHash(hashes: string[], schemaVersion: 1 | 2): string {
  if (hashes.length === 1) return hashes[0]
  return digest(schemaVersion === 1
    ? { schemaVersion: 1, planFingerprints: hashes }
    : { schemaVersion: 2, routeEvidenceIdentityHashes: hashes })
}

export class HistoricalDefinitionAuthorityResolver {
  constructor(private readonly dbProvider: () => Kysely<Database> = getDb) {}

  async resolve(
    binding: HistoricalAuthorityBinding,
    transaction?: Transaction<Database>,
  ): Promise<DiagnosticEvidenceAuthorityV1> {
    if (!ID.test(binding.projectId) || !ID.test(binding.executionId) || !ID.test(binding.runId)
      || !ID.test(binding.definitionId) || !HASH.test(binding.executablePlanHash)
      || binding.resultId !== null && !ID.test(binding.resultId)
      || !Number.isSafeInteger(binding.itemOrdinal) || binding.itemOrdinal < 1) {
      throw new HistoricalDefinitionAuthorityError('Historical authority binding is malformed.')
    }
    const db = transaction ?? this.dbProvider()
    const execution = await db.selectFrom('executions').selectAll()
      .where('project_id', '=', binding.projectId).where('execution_id', '=', binding.executionId).executeTakeFirst()
    if (!execution) throw new HistoricalDefinitionAuthorityError()
    const [items, itemAuthorities, runs, results] = await Promise.all([
      db.selectFrom('execution_items').selectAll().where('execution_id', '=', binding.executionId)
        .orderBy('item_ordinal').execute(),
      db.selectFrom('execution_item_authorities').selectAll().where('execution_id','=',binding.executionId)
        .orderBy('item_ordinal').execute(),
      db.selectFrom('runs').selectAll().where('execution_id', '=', binding.executionId)
        .where('origin', '=', 'product').execute(),
      db.selectFrom('test_results').selectAll().where('run_id', '=', binding.runId)
        .where('execution_item_ordinal', '=', binding.itemOrdinal).execute(),
    ])
    if (items.length < 1 || itemAuthorities.length !== items.length
      || items.some((item, index) => Number(item.item_ordinal) !== index + 1)
      || itemAuthorities.some((authority, index) => Number(authority.item_ordinal) !== index + 1
        || authority.definition_id !== items[index].definition_id)
      || selectionHash(items.map(item => item.executable_plan_hash), 1) !== execution.manifest_hash) {
      throw new HistoricalDefinitionAuthorityError('Execution manifest authority is invalid.')
    }
    const selectedIndex = binding.itemOrdinal - 1
    const item = items[selectedIndex]
    const itemAuthority = itemAuthorities[selectedIndex]
    if(!item||!itemAuthority||Number(itemAuthority.definition_schema_version)!==3)throw new HistoricalDefinitionAuthorityError()
    const rootAuthority = [execution.test_set_id, execution.test_set_revision, execution.definition_schema_version,
      execution.model_row_id, execution.model_version, execution.source_observation_id, execution.support_seal_hash,
      execution.route_evidence_identity_hash, execution.authentication_expectation_identity_hash]
    if(execution.test_set_authority_scope==='per_item'&&rootAuthority.some(value => value !== null))
      throw new HistoricalDefinitionAuthorityError('Per-item Execution authority is contaminated by root authority.')
    if(execution.test_set_authority_scope!=='single'&&execution.test_set_authority_scope!=='per_item')
      throw new HistoricalDefinitionAuthorityError('Execution authority scope is invalid.')

    const resolved: Array<{
      authority: typeof itemAuthority
      testSetRow: any
      testSet: CanonicalTestSetV2 | CanonicalTestSetV3
      definition: CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
      routeHash: string
      authHash: string
    }> = []
    for (const authority of itemAuthorities) {
      const testSetRow=await db.selectFrom('test_set_revisions').selectAll()
        .where('id','=',Number(authority.test_set_row_id)).executeTakeFirst()
      if (!testSetRow || testSetRow.project_id!==binding.projectId || testSetRow.test_set_id!==authority.test_set_id
        || Number(testSetRow.revision)!==Number(authority.test_set_revision)
        || testSetRow.content_hash!==authority.test_set_content_hash
        || Number(testSetRow.schema_version)!==Number(authority.definition_schema_version)) {
        throw new HistoricalDefinitionAuthorityError()
      }
      const parsed = parseCanonicalTestSet(testSetRow.payload_json)
      if (parsed.fingerprint !== testSetRow.content_hash || parsed.value.schemaVersion !== Number(authority.definition_schema_version)
        || parsed.value.schemaVersion !== 2 && parsed.value.schemaVersion !== 3
        || parsed.value.projectId !== binding.projectId || parsed.value.testSetId !== authority.test_set_id
        || parsed.value.revision !== Number(authority.test_set_revision)
        || parsed.value.definitions.length !== Number(testSetRow.definition_count)
        || parsed.value.canonicalSupport.modelRowId !== Number(testSetRow.model_row_id)
        || parsed.value.canonicalSupport.modelVersion !== testSetRow.model_version
        || parsed.value.canonicalSupport.supportSealHash !== testSetRow.support_seal_hash) {
        throw new HistoricalDefinitionAuthorityError()
      }
      const definitions = parsed.value.definitions.filter(candidate => candidate.id === authority.definition_id)
      if (definitions.length !== 1) throw new HistoricalDefinitionAuthorityError()
      const definition = definitions[0] as CanonicalTestDefinitionV2 | CanonicalTestDefinitionV3
      const routeHash = routeEvidenceIdentity(definition)
      const authHash = authenticationIdentity(definition)
      if (!routeHash || !authHash || !HASH.test(routeHash) || !HASH.test(authHash)) {
        throw new HistoricalDefinitionAuthorityError()
      }
      resolved.push({ authority, testSetRow, testSet: parsed.value, definition, routeHash, authHash })
    }
    if (execution.test_set_authority_scope === 'single') {
      const first = resolved[0]
      const singleRootInvalid = resolved.some(value => value.authority.test_set_id !== execution.test_set_id
          || Number(value.authority.test_set_revision) !== Number(execution.test_set_revision)
          || Number(value.authority.definition_schema_version) !== Number(execution.definition_schema_version)
          || value.testSetRow.content_hash !== value.authority.test_set_content_hash
          || Number(value.testSetRow.model_row_id) !== Number(execution.model_row_id)
          || value.testSetRow.model_version !== execution.model_version
          || value.testSetRow.support_seal_hash !== execution.support_seal_hash)
        || execution.source_observation_id !== null
        || selectionHash(resolved.map(value => value.routeHash), 2) !== execution.route_evidence_identity_hash
        || first.authHash !== execution.authentication_expectation_identity_hash
      if (singleRootInvalid) {
        throw new HistoricalDefinitionAuthorityError('Single Execution root and exact item authority disagree.')
      }
    }
    const selected = resolved[selectedIndex]
    const testSetRow=selected.testSetRow
    if (!item || item.definition_id !== binding.definitionId || item.executable_plan_hash !== binding.executablePlanHash
      || runs.length !== 1 || runs[0].run_id !== binding.runId || runs[0].app_name !== binding.projectId
      || itemAuthority.definition_id!==binding.definitionId || !testSetRow
      || testSetRow.project_id!==binding.projectId || testSetRow.test_set_id!==itemAuthority.test_set_id
      || Number(testSetRow.revision)!==Number(itemAuthority.test_set_revision)
      || testSetRow.content_hash!==itemAuthority.test_set_content_hash
      || Number(testSetRow.schema_version)!==Number(itemAuthority.definition_schema_version)
      || results.length > 1) throw new HistoricalDefinitionAuthorityError()
    const result = results[0] ?? null
    if (binding.resultId === null ? result !== null : !result || result.result_id !== binding.resultId
      || result && (result.definition_id !== binding.definitionId || result.executable_plan_hash !== binding.executablePlanHash)) {
      throw new HistoricalDefinitionAuthorityError('Result authority does not match the exact Execution item.')
    }
    if (binding.resultId === null) {
      const terminal = await db.selectFrom('execution_events').select('id')
        .where('project_id', '=', binding.projectId).where('execution_id', '=', binding.executionId)
        .where('event_type', '=', 'terminal').executeTakeFirst()
      if (!terminal) throw new HistoricalDefinitionAuthorityError('A null Result identity is allowed only after a persisted terminal missing-Result transition.')
    }

    if (selected.testSet.schemaVersion !== 3 || selected.definition.id !== binding.definitionId) {
      throw new HistoricalDefinitionAuthorityError()
    }
    const definition = selected.definition as CanonicalTestDefinitionV3
    const routeHash = selected.routeHash
    const authHash = selected.authHash

    const suiteValues = [execution.suite_id, execution.suite_revision, execution.suite_content_hash]
    const suiteAuthority = suiteValues.every(value => value === null)
      ? null
      : suiteValues.some(value => value === null)
        ? (() => { throw new HistoricalDefinitionAuthorityError('Accepted Suite authority is partial.') })()
        : {
            suiteId: execution.suite_id!,
            suiteRevision: Number(execution.suite_revision),
            suiteContentHash: execution.suite_content_hash!,
          }
    if (suiteAuthority && (!ID.test(suiteAuthority.suiteId) || !Number.isSafeInteger(suiteAuthority.suiteRevision)
      || suiteAuthority.suiteRevision < 1 || !HASH.test(suiteAuthority.suiteContentHash))) throw new HistoricalDefinitionAuthorityError()
    const acceptedBase = {
      definitionSchemaVersion: 3 as const,
      testSetId: itemAuthority.test_set_id,
      testSetRevision: Number(itemAuthority.test_set_revision),
      testSetContentHash: testSetRow.content_hash,
      definitionId: definition.id,
      definitionContentHash: digest(definition),
      supportSealHash: selected.testSet.canonicalSupport.supportSealHash,
      routeEvidenceIdentityHash: routeHash,
      authenticationExpectationIdentityHash: authHash,
    }
    return {
      ...binding,
      acceptedDefinitionAuthority: { ...acceptedBase, snapshotHash: digest(acceptedBase) },
      suiteAuthority,
    }
  }
}
