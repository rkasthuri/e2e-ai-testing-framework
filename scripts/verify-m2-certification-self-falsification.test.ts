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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  type BrokenAdapterFault,
  type CandidateDefinition,
  type CanonicalTestSetFixture,
  DeliberatelyBrokenM2Adapter,
  type ExecutionObservation,
  type M2CertificationDriver,
  type MutationResult,
  ReferenceM2Driver,
  type ResultsObservation,
  type SavedSuite,
  type StartResult,
  type SuitePreflight,
  type SuiteIntegrityFault,
  type SuiteReadResult,
  type SuiteSelection,
} from './m2-certification/driver';
import { loadM2CertificationCase } from './m2-certification/fixture-loader';
import { certifyM2Case } from './m2-certification/suite';

function withSuiteHash(result: MutationResult, hash: string): MutationResult {
  return result.kind === 'accepted'
    ? { ...result, suite: { ...result.suite, contentHash: hash } }
    : result;
}

class ArbitraryOpaqueHashProductAdapter implements M2CertificationDriver {
  public readonly name = 'arbitrary-opaque-hash-product-adapter';
  public readonly authorityClass = 'product' as const;
  private readonly reference = new ReferenceM2Driver();

  public constructor(
    private readonly hashForRevision: (revision: number) => string,
    private readonly resultsHashOverride?: string,
  ) {}

  public persistCanonicalTestSet(value: CanonicalTestSetFixture): Promise<void> { return this.reference.persistCanonicalTestSet(value); }
  public injectSuiteIntegrityFault(projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void> { return this.reference.injectSuiteIntegrityFault(projectId, suiteId, suiteRevision, fault); }
  public listCandidates(projectId: string): Promise<CandidateDefinition[]> { return this.reference.listCandidates(projectId); }
  public async listSuites(projectId: string): Promise<SavedSuite[]> {
    return (await this.reference.listSuites(projectId)).map(value => ({ ...value, contentHash: this.hashForRevision(value.revision) }));
  }
  public async createSuite(request: unknown): Promise<MutationResult> {
    const result = await this.reference.createSuite(request);
    return result.kind === 'accepted' ? withSuiteHash(result, this.hashForRevision(result.suite.revision)) : result;
  }
  public async readSuite(projectId: string, suiteId: string, revision: number): Promise<SuiteReadResult> {
    const read = await this.reference.readSuite(projectId, suiteId, revision);
    return read.kind === 'available'
      ? { kind: 'available', suite: { ...read.suite, contentHash: this.hashForRevision(read.suite.revision) } }
      : read;
  }
  public async reviseSuite(request: unknown): Promise<MutationResult> {
    const result = await this.reference.reviseSuite(request);
    return result.kind === 'accepted' ? withSuiteHash(result, this.hashForRevision(result.suite.revision)) : result;
  }
  public async preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight> {
    const preflight = await this.reference.preflightSuite(projectId, selection);
    return preflight.suiteContentHash === null
      ? preflight
      : { ...preflight, suiteContentHash: this.hashForRevision(selection.suiteRevision) };
  }
  public startSuiteExecution(projectId: string, request: unknown): Promise<StartResult> { return this.reference.startSuiteExecution(projectId, request); }
  public async readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null> {
    const execution = await this.reference.readExecution(projectId, executionId);
    return execution ? { ...execution, suite: { ...execution.suite, suiteContentHash: this.hashForRevision(execution.suite.suiteRevision) } } : null;
  }
  public async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const results = await this.reference.readResults(projectId, executionId);
    return results ? {
      ...results,
      suite: results.suite ? {
        ...results.suite,
        suiteContentHash: this.resultsHashOverride ?? this.hashForRevision(results.suite.suiteRevision),
      } : null,
    } : null;
  }
}

function arbitraryOpaqueProductHash(revision: number): string {
  const tokens = ['a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2'];
  const token = tokens[revision - 1];
  if (!token) throw new Error(`No arbitrary opaque Product hash for revision ${revision}`);
  return token.repeat(64);
}

async function expectBroken(
  fault: BrokenAdapterFault,
  fixtureName: string,
  expectedCodes: string[],
): Promise<void> {
  const report = await certifyM2Case(
    new DeliberatelyBrokenM2Adapter(fault),
    loadM2CertificationCase(fixtureName),
  );
  assert.equal(report.passed, false, `${fault} unexpectedly passed`);
  assert.ok(
    expectedCodes.some(code => report.findings.some(value => value.code === code)),
    `${fault}: expected one of ${expectedCodes.join(', ')}; observed ${report.findings.map(value => value.code).join(', ')}`,
  );
}

describe('M2 certification self-falsification', () => {
  test('reference mechanics cannot synthesize Product PASS', async () => {
    const report = await certifyM2Case(new ReferenceM2Driver(), loadM2CertificationCase('golden-v2.json'));
    assert.ok(report.findings.some(value => value.code === 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT'));
  });

  test('arbitrary valid Product Sha256Hex passes as opaque authority', async () => {
    const arbitraryProductHash = '0123456789abcdef'.repeat(4);
    const fixture = loadM2CertificationCase('golden-v2.json');
    const referenceReport = await certifyM2Case(new ReferenceM2Driver(), fixture, { requireProductAuthority: false });
    assert.notEqual((referenceReport.observations.savedSuite as SavedSuite).contentHash, arbitraryProductHash);
    const report = await certifyM2Case(
      new ArbitraryOpaqueHashProductAdapter(() => arbitraryProductHash),
      fixture,
    );
    assert.equal(report.passed, true, report.findings.map(value => value.code).join(', '));
    assert.deepEqual([
      (report.observations.savedSuite as SavedSuite).contentHash,
      (report.observations.reopenedSuite as SavedSuite).contentHash,
      (report.observations.preflight as SuitePreflight).suiteContentHash,
      (report.observations.execution as ExecutionObservation).suite.suiteContentHash,
      (report.observations.results as ResultsObservation).suite?.suiteContentHash,
    ], Array.from({ length: 5 }, () => arbitraryProductHash));
  });

  test('arbitrary opaque Product hashes may change across semantic revisions without reference serialization', async () => {
    const report = await certifyM2Case(
      new ArbitraryOpaqueHashProductAdapter(arbitraryOpaqueProductHash),
      loadM2CertificationCase('hostile-matrix.json'),
    );
    assert.equal(report.passed, true, report.findings.map(value => value.code).join(', '));
  });

  test('one mutated opaque Results boundary fails an otherwise consistent Product trace', async () => {
    const report = await certifyM2Case(
      new ArbitraryOpaqueHashProductAdapter(() => 'a'.repeat(64), 'c'.repeat(64)),
      loadM2CertificationCase('golden-v2.json'),
    );
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(value => value.code === 'RESULTS_SUITE_HASH_DRIFT'));
  });

  test('same immutable revision changing its observed hash is detected', async () => {
    await expectBroken('change_hash_on_repeated_read', 'golden-v2.json', ['SUITE_HASH_CHANGED_ON_REOPEN']);
  });

  test('integrity corruption is never permitted to masquerade as stale authority', async () => {
    await expectBroken('conflate_suite_integrity_with_stale', 'hostile-matrix.json', ['INTEGRITY_REFUSAL_CONFLATED_WITH_STALE']);
  });

  test('public Suite integrity vocabulary has no competing alias', () => {
    const driverSource = readFileSync(path.join(process.cwd(), 'scripts/m2-certification/driver.ts'), 'utf8');
    const suiteSource = readFileSync(path.join(process.cwd(), 'scripts/m2-certification/suite.ts'), 'utf8');
    assert.equal(driverSource.includes("'integrity_invalid'"), false);
    assert.equal(suiteSource.includes("'integrity_invalid'"), false);
  });

  test('Suite content mutation under unchanged immutable authority is detected', async () => {
    await expectBroken('mutate_suite_content_same_authority', 'golden-v2.json', ['IMMUTABLE_SUITE_CONTENT_MUTATED']);
  });

  test('Execution substitution or loss of accepted Suite hash is detected', async () => {
    await expectBroken('substitute_execution_suite_hash', 'golden-v2.json', ['EXECUTION_SUITE_HASH_DRIFT']);
    await expectBroken('drop_execution_suite_hash', 'golden-v2.json', ['EXECUTION_SUITE_HASH_DRIFT']);
  });

  test('Preflight substitution of observed Suite hash is detected', async () => {
    await expectBroken('substitute_preflight_suite_hash', 'golden-v2.json', ['PREFLIGHT_SUITE_HASH_DRIFT']);
  });

  test('Results substitution or loss of accepted Suite hash is detected', async () => {
    await expectBroken('drop_results_suite_hash', 'golden-v2.json', ['RESULTS_SUITE_HASH_DRIFT']);
    await expectBroken('substitute_results_suite_hash', 'golden-v2.json', ['RESULTS_SUITE_HASH_DRIFT']);
  });

  test('semantic revision reusing the prior observed hash is detected', async () => {
    await expectBroken('reuse_hash_across_semantic_revision', 'hostile-matrix.json', ['REORDER_HASH_UNCHANGED', 'RENAME_HASH_UNCHANGED']);
  });

  test('current Suite head hash substituted into historical Results is detected', async () => {
    await expectBroken('current_head_hash_in_results', 'hostile-matrix.json', ['RESULTS_FLOATED_TO_CURRENT_HEAD']);
  });

  test('invalid Product Suite hash shape is detected', async () => {
    await expectBroken('invalid_suite_hash_shape', 'golden-v2.json', ['MALFORMED_SUITE_HASH_ACCEPTED']);
  });

  test('certification contains no Product Suite hash derivation oracle', () => {
    const driverSource = readFileSync(path.join(process.cwd(), 'scripts/m2-certification/driver.ts'), 'utf8');
    const suiteSource = readFileSync(path.join(process.cwd(), 'scripts/m2-certification/suite.ts'), 'utf8');
    assert.equal(driverSource.includes('certificationSuiteHash'), false);
    assert.equal(driverSource.includes('function canonical('), false);
    assert.equal(driverSource.includes('function hashSuite('), false);
    assert.equal(driverSource.includes('expectedHash'), false);
    assert.equal(driverSource.includes('recompute'), false);
    assert.equal(driverSource.includes('export function referenceOnly'), false);
    assert.equal((driverSource.match(/createHash\(/g) ?? []).length, 2);
    assert.equal((driverSource.match(/JSON\.stringify\(value\)/g) ?? []).length, 2);
    assert.equal(suiteSource.includes('createHash('), false);
    assert.equal(suiteSource.includes('referenceOnlyRequestFingerprint'), false);
    assert.equal(suiteSource.includes('referenceOnlyOpaqueSha256'), false);
    assert.equal(suiteSource.includes('integrityValid'), false);
  });

  test('floating to newest Definitions is detected', async () => {
    await expectBroken('float_to_newest_definitions', 'stale-authority.json', ['STALE_SUITE_START_ACCEPTED', 'CURRENT_DEFINITION_SUBSTITUTION']);
  });

  test('ignoring requested Suite revision is detected', async () => {
    await expectBroken('ignore_suite_revision', 'hostile-matrix.json', ['HISTORICAL_REVISION_MUTATED', 'RESULTS_FLOATED_TO_CURRENT_HEAD']);
  });

  test('reordering members is detected', async () => {
    await expectBroken('reorder_members', 'golden-v2.json', ['SUITE_MEMBERSHIP_DRIFT']);
  });

  test('dropping Suite provenance is detected', async () => {
    await expectBroken('drop_suite_provenance', 'golden-v2.json', ['RESULTS_SUITE_PROVENANCE_DRIFT']);
  });

  test('using current Suite head name in old Results is detected', async () => {
    await expectBroken('current_head_name_in_results', 'hostile-matrix.json', ['RESULTS_FLOATED_TO_CURRENT_HEAD']);
  });

  test('accepting client membership at Start is detected', async () => {
    await expectBroken('accept_client_membership', 'hostile-matrix.json', ['CLIENT_MEMBERSHIP_ACCEPTED']);
  });

  test('ignoring stale Test Set authority is detected', async () => {
    await expectBroken('ignore_stale_test_set', 'stale-authority.json', ['STALE_SUITE_PREFLIGHT_ACCEPTED', 'STALE_SUITE_START_ACCEPTED']);
  });

  test('accepting partial eligibility is detected', async () => {
    await expectBroken('accept_partial_eligibility', 'hostile-matrix.json', ['PARTIAL_MEMBER_PREFLIGHT_ACCEPTED']);
  });

  test('synthesizing a Product Result is detected', async () => {
    await expectBroken('synthesize_product_result', 'stale-authority.json', ['STALE_SUITE_START_ACCEPTED', 'SYNTHESIZED_PRODUCT_RESULT']);
  });

  test('confusing legacy test_results.suite with canonical Suite is detected', async () => {
    await expectBroken('confuse_legacy_suite_field', 'hostile-matrix.json', ['LEGACY_SUITE_MASQUERADE']);
  });

  test('pairing Suite A identity with Suite B content is detected', async () => {
    await expectBroken('suite_identity_content_mismatch', 'hostile-matrix.json', ['INTEGRITY_HOSTILE_NOT_OBSERVED', 'IMMUTABLE_SUITE_CONTENT_MUTATED']);
  });

  test('resolving old Results from current Suite head is detected', async () => {
    await expectBroken('results_from_current_head', 'hostile-matrix.json', ['RESULTS_FLOATED_TO_CURRENT_HEAD']);
  });
});
