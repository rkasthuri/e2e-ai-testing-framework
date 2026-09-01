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
import Ajv from 'ajv'
import {
  classifyDiagnosticEvidence,
  DIAGNOSTIC_CLASSIFIER_VERSION,
  UnsupportedDiagnosticClassifierVersionError,
  type DiagnosticOutcome,
} from '../src/core/execution/DiagnosticClassificationContract'
import {
  DiagnosticClassificationService,
  DiagnosticEvidenceNotFoundError,
  DiagnosticEvidenceUnreadableError,
} from '../src/core/execution/DiagnosticClassificationService'
import {
  canonicalDiagnosticJson,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
  parseDiagnosticEvidenceV1,
  type DiagnosticEvidenceV1,
} from '../src/core/execution/DiagnosticEvidenceContract'
import {
  presentDiagnosticOutcome,
  UnsupportedDiagnosticExplanationError,
} from '../src/core/execution/DiagnosticOutcomePresenter'
import type { DiagnosticEvidenceRow } from '../src/core/storage/types'

type JsonObject = Record<string, any>
const ROOT = path.resolve(__dirname, '..', 'fixtures', 'm4-contract')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')) as JsonObject
const outcomeSchema = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'diagnostic-outcome.schema.json'), 'utf8'))
const validateOutcome = new Ajv({ allErrors: true, strict: false }).compile(outcomeSchema)

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

function materialize(caseFile: JsonObject): DiagnosticEvidenceV1 {
  const base = clone(manifest.evidenceBases[caseFile.base]) as JsonObject
  const authority = clone(manifest.authorityTemplates[base.authorityTemplate])
  delete base.authorityTemplate
  return parseDiagnosticEvidenceV1(applyOperations({
    schemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION,
    authority,
    ...base,
  }, caseFile.operations))
}

function evidenceHash(evidence: DiagnosticEvidenceV1): string {
  return createHash('sha256').update(canonicalDiagnosticJson(evidence)).digest('hex')
}

function rowFor(evidence: DiagnosticEvidenceV1): DiagnosticEvidenceRow {
  return {
    id: 1,
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

function code(outcome: DiagnosticOutcome): string {
  return outcome.kind === 'classified_failure' ? outcome.failureMode : outcome.refusalCode
}

describe('M4 deterministic diagnostic classifier', () => {
  test('positive matrix follows every frozen fixture with exact version and explanation mapping', () => {
    for (const relativePath of manifest.cases as string[]) {
      const caseFile = fixture(relativePath)
      const evidence = materialize(caseFile)
      const outcome = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION)
      assert.equal(outcome.kind, caseFile.expected.kind, caseFile.caseId)
      assert.equal(code(outcome), caseFile.expected.code, caseFile.caseId)
      assert.equal(outcome.classifierVersion, manifest.classifierVersion)
      assert.equal(outcome.evidenceSchemaVersion, evidence.schemaVersion)
      assert.equal(outcome.evidenceHash, evidenceHash(evidence))
      assert.equal(validateOutcome(outcome), true, `${caseFile.caseId}: ${JSON.stringify(validateOutcome.errors)}`)
    }
  })

  test('all five schema-valid phase hostiles refuse as deterministic contradictions', () => {
    const names = [
      'executor-failed-with-later-action.json',
      'auth-not-established-with-navigation-completed.json',
      'navigation-failed-with-action-performed.json',
      'target-not-observed-with-action-attempted.json',
      'action-not-completed-with-oracle-performed.json',
    ]
    for (const name of names) {
      const evidence = materialize(fixture(`hostile/${name}`))
      const outcome = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION)
      assert.equal(outcome.kind, 'refusal', name)
      if (outcome.kind !== 'refusal') continue
      assert.equal(outcome.refusalCode, 'integrity_invalid', name)
      assert.deepEqual(outcome.integrityFindings, ['diagnostic_evidence_contradiction'], name)
    }
  })

  test('coherent incomplete evidence is insufficient and oracle mismatch makes no causal claim', () => {
    const incomplete = materialize(fixture('cases/insufficient-evidence.json'))
    const refusal = classifyDiagnosticEvidence(incomplete, evidenceHash(incomplete), DIAGNOSTIC_CLASSIFIER_VERSION)
    assert.equal(code(refusal), 'insufficient_evidence')
    const oracle = materialize(fixture('cases/oracle-mismatch.json'))
    const mismatch = classifyDiagnosticEvidence(oracle, evidenceHash(oracle), DIAGNOSTIC_CLASSIFIER_VERSION)
    assert.equal(code(mismatch), 'oracle_mismatch')
    assert.doesNotMatch(JSON.stringify(mismatch), /app[-_ ]defect|test[-_ ]defect|selector[-_ ]drift|root[-_ ]cause/i)
  })

  test('integrity precedence is first, findings are unique and sorted, and recomputation is exact', () => {
    const evidence = materialize(fixture('cases/executor-failure.json'))
    const left = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION, [
      'diagnostic_historical_authority_substitution',
      'diagnostic_authority_binding_invalid',
      'diagnostic_authority_binding_invalid',
    ])
    const right = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION, [
      'diagnostic_authority_binding_invalid',
      'diagnostic_historical_authority_substitution',
    ])
    assert.deepEqual(left, right)
    assert.equal(code(left), 'integrity_invalid')
  })

  test('unknown classifier version fails closed without silently defaulting', () => {
    const evidence = materialize(fixture('cases/oracle-mismatch.json'))
    assert.throws(() => classifyDiagnosticEvidence(evidence, evidenceHash(evidence), 'forge.m4.diagnostic-classifier/v2'),
      UnsupportedDiagnosticClassifierVersionError)
  })
})

describe('M4 bounded presenter', () => {
  test('all frozen outcomes render reproducibly from outcome fields only', () => {
    for (const relativePath of manifest.cases as string[]) {
      const evidence = materialize(fixture(relativePath))
      const outcome = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION)
      assert.equal(presentDiagnosticOutcome(outcome), presentDiagnosticOutcome(structuredClone(outcome)))
      assert.doesNotMatch(presentDiagnosticOutcome(outcome), /root cause|app defect|test defect|selector drift|stack/i)
    }
  })

  test('unknown explanation code fails closed', () => {
    const evidence = materialize(fixture('cases/oracle-mismatch.json'))
    const outcome = classifyDiagnosticEvidence(evidence, evidenceHash(evidence), DIAGNOSTIC_CLASSIFIER_VERSION)
    assert.throws(() => presentDiagnosticOutcome({ ...outcome, explanationCode: 'unknown' } as any),
      UnsupportedDiagnosticExplanationError)
  })
})

describe('M4 exact diagnostic evidence read model', () => {
  test('reads the full five-part identity, pins hash/version, and is restart-stable', async () => {
    const evidence = materialize(fixture('cases/oracle-mismatch.json'))
    const row = rowFor(evidence)
    const rowWithIgnoredLegacyTriage = {
      ...row,
      legacy_triage_json: JSON.stringify({ failureMode: 'selector_drift' }),
    }
    const identities: unknown[] = []
    const reader = { readExact: async (identity: unknown) => { identities.push(clone(identity)); return rowWithIgnoredLegacyTriage } }
    const request = {
      projectId: row.project_id,
      executionId: row.execution_id,
      runId: row.run_id,
      itemOrdinal: row.item_ordinal,
      evidenceSchemaVersion: row.evidence_schema_version,
      evidenceHash: row.evidence_hash,
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
    }
    const beforeRestart = await new DiagnosticClassificationService(reader).classify(request)
    const afterRestart = await new DiagnosticClassificationService(reader).classify(request)
    assert.deepEqual(beforeRestart, afterRestart)
    assert.deepEqual(identities, [beforeRestart.identity, beforeRestart.identity])
    assert.equal(beforeRestart.outcome.kind, 'classified_failure')
    if (beforeRestart.outcome.kind === 'classified_failure') {
      assert.equal(beforeRestart.outcome.failureMode, 'oracle_mismatch')
    }
    assert.doesNotMatch(JSON.stringify(beforeRestart), /selector_drift/)
    assert.equal(beforeRestart.evidenceHash, row.evidence_hash)
  })

  test('cross-project or incorrect exact identity is rejected before classification', async () => {
    let reads = 0
    const reader = { readExact: async () => { reads += 1; return null } }
    await assert.rejects(new DiagnosticClassificationService(reader).classify({
      projectId: 'wrong-project', executionId: 'execution-product-owned', runId: 'run-product-owned', itemOrdinal: 1,
      evidenceSchemaVersion: DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION, evidenceHash: '0'.repeat(64),
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
    }), DiagnosticEvidenceNotFoundError)
    assert.equal(reads, 1)
  })

  test('tampered hash and duplicated authority become frozen integrity findings', async () => {
    const evidence = materialize(fixture('cases/oracle-mismatch.json'))
    const row = rowFor(evidence)
    const replacement = clone(manifest.currentHeadDefinitionAuthority)
    row.evidence_json = canonicalDiagnosticJson({
      ...evidence,
      authority: { ...evidence.authority, acceptedDefinitionAuthority: replacement },
    })
    const result = await new DiagnosticClassificationService({ readExact: async () => row }).classify({
      projectId: row.project_id, executionId: row.execution_id, runId: row.run_id, itemOrdinal: row.item_ordinal,
      evidenceSchemaVersion: row.evidence_schema_version, evidenceHash: row.evidence_hash,
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
    })
    assert.equal(result.outcome.kind, 'refusal')
    if (result.outcome.kind !== 'refusal' || result.outcome.refusalCode !== 'integrity_invalid') return
    assert.deepEqual(result.outcome.integrityFindings, [
      'diagnostic_authority_binding_invalid',
      'diagnostic_historical_authority_substitution',
    ])
  })

  test('malformed persisted evidence hard-refuses and unknown classifier version performs no read', async () => {
    const evidence = materialize(fixture('cases/oracle-mismatch.json'))
    const row = rowFor(evidence)
    row.evidence_json = '{'
    await assert.rejects(new DiagnosticClassificationService({ readExact: async () => row }).classify({
      projectId: row.project_id, executionId: row.execution_id, runId: row.run_id, itemOrdinal: row.item_ordinal,
      evidenceSchemaVersion: row.evidence_schema_version, evidenceHash: row.evidence_hash,
      classifierVersion: DIAGNOSTIC_CLASSIFIER_VERSION,
    }), DiagnosticEvidenceUnreadableError)
    let reads = 0
    await assert.rejects(new DiagnosticClassificationService({ readExact: async () => { reads += 1; return row } }).classify({
      projectId: row.project_id, executionId: row.execution_id, runId: row.run_id, itemOrdinal: row.item_ordinal,
      evidenceSchemaVersion: row.evidence_schema_version, evidenceHash: row.evidence_hash,
      classifierVersion: 'unsupported',
    }), UnsupportedDiagnosticClassifierVersionError)
    assert.equal(reads, 0)
  })
})
