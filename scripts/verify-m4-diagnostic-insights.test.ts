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

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import {
  DiagnosticInsightsIntegrityError,
  DiagnosticInsightsService,
  InvalidDiagnosticInsightsProjectIdError,
  UnsupportedDiagnosticEvidenceSchemaVersionError,
} from '../src/core/execution/DiagnosticInsightsService'
import {
  DIAGNOSTIC_CLASSIFIER_VERSION,
  UnsupportedDiagnosticClassifierVersionError,
} from '../src/core/execution/DiagnosticClassificationContract'
import { DiagnosticEvidenceUnreadableError } from '../src/core/execution/DiagnosticClassificationService'
import {
  canonicalDiagnosticJson,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  parseDiagnosticEvidenceV1,
  type DiagnosticEvidenceV1,
} from '../src/core/execution/DiagnosticEvidenceContract'
import type { DiagnosticEvidenceIdentity } from '../src/core/storage/repositories/DiagnosticEvidenceRepository'
import type { DiagnosticEvidenceRow } from '../src/core/storage/types'

type JsonObject = Record<string, any>
const ROOT = path.resolve(__dirname, '..', 'fixtures', 'm4-contract')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')) as JsonObject

function clone<T>(value: T): T { return structuredClone(value) }

function applyOperations(value: JsonObject, operations: JsonObject[]): JsonObject {
  const result = clone(value)
  for (const operation of operations) {
    const segments = String(operation.path).slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    const key = segments.pop()
    assert.ok(key)
    let parent = result
    for (const segment of segments) parent = parent[segment] as JsonObject
    if (operation.op === 'remove') delete parent[key]
    else parent[key] = clone(operation.value)
  }
  return result
}

function fixture(relativePath: string): JsonObject {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8')) as JsonObject
}

function materialize(relativePath: string, ordinal: number): DiagnosticEvidenceV1 {
  const caseFile = fixture(relativePath)
  const base = clone(manifest.evidenceBases[caseFile.base]) as JsonObject
  const authority = clone(manifest.authorityTemplates[base.authorityTemplate]) as JsonObject
  delete base.authorityTemplate
  authority.executionId = `execution-insights-${ordinal}`
  authority.runId = `run-insights-${ordinal}`
  authority.itemOrdinal = ordinal
  if (authority.resultId !== null) authority.resultId = `result-insights-${ordinal}`
  return parseDiagnosticEvidenceV1(applyOperations({
    schemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
    authority,
    ...base,
  }, caseFile.operations))
}

function evidenceHash(evidence: DiagnosticEvidenceV1): string {
  return createHash('sha256').update(canonicalDiagnosticJson(evidence)).digest('hex')
}

function rowFor(evidence: DiagnosticEvidenceV1, id: number): DiagnosticEvidenceRow {
  return {
    id,
    evidence_schema_version: evidence.schemaVersion,
    evidence_hash: evidenceHash(evidence),
    project_id: evidence.authority.projectId,
    execution_id: evidence.authority.executionId,
    run_id: evidence.authority.runId,
    item_ordinal: evidence.authority.itemOrdinal,
    result_id: evidence.authority.resultId,
    definition_id: evidence.authority.definitionId,
    executable_plan_hash: evidence.authority.executablePlanHash,
    accepted_definition_authority_json: canonicalDiagnosticJson(evidence.authority.acceptedDefinitionAuthority),
    suite_authority_json: evidence.authority.suiteAuthority === null ? null : canonicalDiagnosticJson(evidence.authority.suiteAuthority),
    evidence_json: canonicalDiagnosticJson(evidence),
  }
}

function sameIdentity(row: DiagnosticEvidenceRow, identity: DiagnosticEvidenceIdentity): boolean {
  return row.project_id === identity.projectId
    && row.execution_id === identity.executionId
    && row.run_id === identity.runId
    && Number(row.item_ordinal) === identity.itemOrdinal
    && row.evidence_schema_version === identity.evidenceSchemaVersion
}

class MemoryEvidenceRepository {
  listReads = 0
  exactReads = 0

  constructor(readonly rows: DiagnosticEvidenceRow[]) {}

  async readProjectPartition(): Promise<DiagnosticEvidenceRow[]> {
    this.listReads += 1
    return this.rows
  }

  async readExact(identity: DiagnosticEvidenceIdentity): Promise<DiagnosticEvidenceRow | null> {
    this.exactReads += 1
    return this.rows.find(row => sameIdentity(row, identity)) ?? null
  }
}

const request = {
  projectId: 'project-m4-contract',
  evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
}

describe('M4 version-partitioned Diagnostic Insights read model', () => {
  test('exactly aggregates all six frozen failure modes and keeps both refusals separate', async () => {
    const rows = (manifest.cases as string[]).map((relativePath, index) => rowFor(materialize(relativePath, index + 1), index + 1))
    const result = await new DiagnosticInsightsService(new MemoryEvidenceRepository(rows)).read(request)
    assert.deepEqual(result, {
      projectId: request.projectId,
      evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
      totalDiagnostics: 8,
      classifiedFailureCount: 6,
      refusalCount: 2,
      countsByFailureMode: {
        executor_failure: 1,
        authentication_not_established: 1,
        navigation_not_completed: 1,
        target_not_observed: 1,
        action_not_completed: 1,
        oracle_mismatch: 1,
      },
      insufficientEvidenceCount: 1,
      integrityInvalidCount: 1,
    })
    assert.equal(result.classifiedFailureCount + result.refusalCount, result.totalDiagnostics)
    assert.equal(result.insufficientEvidenceCount + result.integrityInvalidCount, result.refusalCount)
    assert.doesNotMatch(JSON.stringify(result), /root.cause|selector.drift|flaky|confidence|healing/i)
  })

  test('unknown versions fail before repository access and no default partition exists', async () => {
    const repository = new MemoryEvidenceRepository([])
    await assert.rejects(new DiagnosticInsightsService(repository).read({
      ...request,
      classifierVersion: 'forge.m4.diagnostic-classifier/v2',
    }), UnsupportedDiagnosticClassifierVersionError)
    await assert.rejects(new DiagnosticInsightsService(repository).read({
      ...request,
      evidenceSchemaVersion: 'forge.m4.diagnostic-evidence/v2',
    }), UnsupportedDiagnosticEvidenceSchemaVersionError)
    assert.equal(repository.listReads, 0)
  })

  test('invalid project identities fail explicitly before any repository read', async () => {
    const repository = new MemoryEvidenceRepository([])
    const invalidProjectIds = [
      '',
      '   ',
      undefined,
      ' project-m4-contract',
      'project/m4/contract',
      'p'.repeat(256),
    ]
    for (const projectId of invalidProjectIds) {
      await assert.rejects(new DiagnosticInsightsService(repository).read({
        ...request,
        projectId,
      } as any), InvalidDiagnosticInsightsProjectIdError)
    }
    assert.equal(repository.listReads, 0)
    assert.equal(repository.exactReads, 0)
  })

  test('a well-formed unknown project may truthfully return an explicitly labelled empty partition', async () => {
    const repository = new MemoryEvidenceRepository([])
    const projectId = 'unknown-project.with:valid_id'
    const result = await new DiagnosticInsightsService(repository).read({ ...request, projectId })
    assert.deepEqual(result, {
      projectId,
      evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
      totalDiagnostics: 0,
      classifiedFailureCount: 0,
      refusalCount: 0,
      countsByFailureMode: {
        executor_failure: 0,
        authentication_not_established: 0,
        navigation_not_completed: 0,
        target_not_observed: 0,
        action_not_completed: 0,
        oracle_mismatch: 0,
      },
      insufficientEvidenceCount: 0,
      integrityInvalidCount: 0,
    })
    assert.equal(repository.listReads, 1)
    assert.equal(repository.exactReads, 0)
  })

  test('cross-project or mixed-version rows fail closed instead of disappearing or merging', async () => {
    const row = rowFor(materialize('cases/oracle-mismatch.json', 1), 1)
    await assert.rejects(new DiagnosticInsightsService(new MemoryEvidenceRepository([
      { ...row, project_id: 'project-substituted' },
    ])).read(request), DiagnosticInsightsIntegrityError)
    await assert.rejects(new DiagnosticInsightsService(new MemoryEvidenceRepository([
      { ...row, evidence_schema_version: 'forge.m4.diagnostic-evidence/v2' },
    ])).read(request), DiagnosticInsightsIntegrityError)
  })

  test('exact duplicate identity counts once while a conflicting duplicate fails closed', async () => {
    const row = rowFor(materialize('cases/oracle-mismatch.json', 1), 1)
    const exactDuplicateRepository = new MemoryEvidenceRepository([row, { ...row, id: 2 }])
    const result = await new DiagnosticInsightsService(exactDuplicateRepository).read(request)
    assert.equal(result.totalDiagnostics, 1)
    assert.equal(result.countsByFailureMode.oracle_mismatch, 1)
    assert.equal(exactDuplicateRepository.exactReads, 1)
    await assert.rejects(new DiagnosticInsightsService(new MemoryEvidenceRepository([
      row,
      { ...row, id: 2, evidence_hash: '0'.repeat(64) },
    ])).read(request), DiagnosticInsightsIntegrityError)
    await assert.rejects(new DiagnosticInsightsService(new MemoryEvidenceRepository([
      row,
      { ...row, id: 2, evidence_json: `${row.evidence_json} ` },
    ])).read(request), DiagnosticInsightsIntegrityError)
  })

  test('tamper is integrity-invalid, unreadable evidence aborts the whole partition, and legacy fields are inert', async () => {
    const row = rowFor(materialize('cases/oracle-mismatch.json', 1), 1)
    const tampered = { ...row, evidence_hash: '0'.repeat(64), legacy_triage_json: '{"failureMode":"selector_drift"}' } as DiagnosticEvidenceRow
    const tamperedResult = await new DiagnosticInsightsService(new MemoryEvidenceRepository([tampered])).read(request)
    assert.equal(tamperedResult.integrityInvalidCount, 1)
    assert.equal(tamperedResult.classifiedFailureCount, 0)
    await assert.rejects(new DiagnosticInsightsService(new MemoryEvidenceRepository([
      { ...row, evidence_json: '{' },
    ])).read(request), DiagnosticEvidenceUnreadableError)
  })

  test('classifier substitution and unsupported causal categories cannot enter the read model', async () => {
    const row = rowFor(materialize('cases/oracle-mismatch.json', 1), 1)
    const repository = new MemoryEvidenceRepository([row])
    const injectedClassifier = {
      classify: async () => ({
        identity: {
          projectId: row.project_id,
          executionId: row.execution_id,
          runId: row.run_id,
          itemOrdinal: Number(row.item_ordinal),
          evidenceSchemaVersion: row.evidence_schema_version,
        },
        evidenceHash: row.evidence_hash,
        evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
        classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
        outcome: {
          schemaVersion: 'forge.m4.diagnostic-outcome/v1',
          evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
          classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
          evidenceHash: row.evidence_hash,
          kind: 'classified_failure',
          failureMode: 'selector_drift',
          explanationCode: 'invented_root_cause',
          explanationParameters: {},
        },
        displayString: 'invented',
      } as any),
    }
    await assert.rejects(new DiagnosticInsightsService(repository, injectedClassifier).read(request), DiagnosticInsightsIntegrityError)
  })
})
