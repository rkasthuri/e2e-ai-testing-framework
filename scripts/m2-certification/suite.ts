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

import {
  cloneValue,
  type CandidateDefinition,
  type DefinitionAuthority,
  type M2CertificationCase,
  type M2CertificationDriver,
  type SavedSuite,
  type SuiteIntegrityFault,
  type SuiteMember,
  type SuiteSelection,
} from './driver';

const SHA_256_HEX = /^[a-f0-9]{64}$/;

export interface M2CertificationFinding {
  code: string;
  message: string;
}

export interface M2CertificationReport {
  caseId: string;
  driverName: string;
  driverAuthorityClass: M2CertificationDriver['authorityClass'];
  passed: boolean;
  findings: M2CertificationFinding[];
  observations: Record<string, unknown>;
}

export interface M2CertificationOptions {
  requireProductAuthority?: boolean;
}

const UI_REQUIREMENTS = [
  'saved_suite_list',
  'create_reopen',
  'name_purpose_revision_hash_visible',
  'exact_ordered_members_visible',
  'stale_suite_readable',
  'stale_suite_cannot_run',
  'stale_edit_conflict',
  'whole_suite_eligibility_truth',
  'start_omits_membership',
  'results_show_accepted_immutable_revision',
] as const;

function finding(findings: M2CertificationFinding[], condition: boolean, code: string, message: string): void {
  if (!condition) findings.push({ code, message });
}

function same(left: unknown, right: unknown): boolean {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function suiteWithoutObservedHash(suite: SavedSuite): Omit<SavedSuite, 'contentHash'> {
  const { contentHash: _contentHash, ...content } = suite;
  return content;
}

function members(candidates: CandidateDefinition[], orderedDefinitionIds: string[]): SuiteMember[] {
  return orderedDefinitionIds.map((definitionId, ordinal) => {
    const candidate = candidates.find(value => value.definitionAuthority.definitionId === definitionId);
    if (!candidate) throw new Error(`Fixture definition is not a current candidate: ${definitionId}`);
    return { ordinal, definitionAuthority: cloneValue(candidate.definitionAuthority) };
  });
}

function selection(suite: SavedSuite): SuiteSelection {
  return { kind: 'suite_revision', suiteId: suite.suiteId, suiteRevision: suite.revision };
}

function mutationRequest(
  projectId: string,
  name: string,
  suiteMembers: SuiteMember[],
  changeIntentKey: string,
): Record<string, unknown> {
  return { projectId, name, purpose: 'sanity', members: suiteMembers, changeIntentKey };
}

function malformedMutationRequest(
  projectId: string,
  name: string,
  suiteMembers: unknown[],
  changeIntentKey: string,
): Record<string, unknown> {
  return { projectId, name, purpose: 'sanity', members: suiteMembers, changeIntentKey };
}

async function seed(driver: M2CertificationDriver, fixture: M2CertificationCase, index = 0): Promise<CandidateDefinition[]> {
  const testSet = fixture.testSets[index];
  if (!testSet) throw new Error(`Fixture ${fixture.caseId} has no Test Set at index ${index}`);
  await driver.persistCanonicalTestSet(testSet);
  return driver.listCandidates(testSet.projectId);
}

async function create(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  key = `${fixture.caseId}-create`,
): Promise<SavedSuite> {
  const candidates = await seed(driver, fixture);
  const result = await driver.createSuite(mutationRequest(
    fixture.projectId,
    fixture.suite.name,
    members(candidates, fixture.suite.orderedDefinitionIds),
    key,
  ));
  if (result.kind !== 'accepted') throw new Error(`Reference setup refused Suite creation for ${fixture.caseId}`);
  return result.suite;
}

function checkSuite(
  suite: SavedSuite,
  fixture: M2CertificationCase,
  expectedAuthorities: DefinitionAuthority[],
  findings: M2CertificationFinding[],
): void {
  finding(findings, suite.schemaVersion === 1, 'SUITE_SCHEMA_DRIFT', 'Suite schemaVersion must remain 1.');
  finding(findings, suite.projectId === fixture.projectId && suite.suiteId.length > 0, 'SUITE_IDENTITY_DRIFT', 'Suite and project identity must be exact.');
  finding(findings, suite.revision === 1, 'SUITE_REVISION_DRIFT', 'Initial Suite revision must be 1.');
  finding(findings, suite.name === fixture.suite.name && suite.purpose === 'sanity', 'SUITE_PURPOSE_DRIFT', 'Suite name and sanity purpose must be exact.');
  finding(findings, SHA_256_HEX.test(suite.contentHash), 'MALFORMED_SUITE_HASH_ACCEPTED', 'Observed Suite contentHash must use the frozen Sha256Hex shape.');
  finding(findings, same(suite.members.map(member => member.ordinal), expectedAuthorities.map((_value, ordinal) => ordinal)), 'SUITE_ORDINAL_DRIFT', 'Suite ordinals must be contiguous from zero.');
  finding(findings, same(suite.members.map(member => member.definitionAuthority), expectedAuthorities), 'SUITE_MEMBERSHIP_DRIFT', 'Suite must retain exact ordered Definition and Test Set authority.');
  finding(findings, suite.provenance !== null && suite.provenance !== undefined, 'SUITE_PROVENANCE_DROPPED', 'Opaque Suite provenance must be retained.');
}

async function checkPositive(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  findings: M2CertificationFinding[],
  observations: Record<string, unknown>,
): Promise<void> {
  const candidates = await seed(driver, fixture);
  const expectedAuthorities = members(candidates, fixture.suite.orderedDefinitionIds).map(value => value.definitionAuthority);
  const created = await driver.createSuite(mutationRequest(
    fixture.projectId,
    fixture.suite.name,
    members(candidates, fixture.suite.orderedDefinitionIds),
    `${fixture.caseId}-create`,
  ));
  finding(findings, created.kind === 'accepted', 'SUITE_CREATE_REFUSED', 'Valid current Suite must be created.');
  if (created.kind !== 'accepted') return;
  const saved = created.suite;
  checkSuite(saved, fixture, expectedAuthorities, findings);
  const reopened = await driver.readSuite(fixture.projectId, saved.suiteId, 1);
  finding(findings, reopened.kind === 'available', 'VALID_SUITE_INTEGRITY_REFUSED', 'A valid immutable Suite revision must resolve as integrity-valid authority.');
  if (reopened.kind === 'available') {
    finding(findings, same(suiteWithoutObservedHash(reopened.suite), suiteWithoutObservedHash(saved)), 'IMMUTABLE_SUITE_CONTENT_MUTATED', 'Reopen must return the same immutable Suite semantics without deriving its hash.');
    finding(findings, reopened.suite.contentHash === saved.contentHash, 'SUITE_HASH_CHANGED_ON_REOPEN', 'The same immutable Suite revision must return the same observed opaque hash.');
  }
  const preflight = await driver.preflightSuite(fixture.projectId, selection(saved));
  finding(findings, preflight.kind === 'accepted' && preflight.wholeSuiteEligible, 'WHOLE_SUITE_PREFLIGHT_REFUSED', 'Every member must be eligible before Suite preflight accepts.');
  finding(findings, preflight.suiteContentHash === saved.contentHash, 'PREFLIGHT_SUITE_HASH_DRIFT', 'Preflight must preserve the exact observed opaque Suite hash.');
  const startRequest = {
    executionIntentKey: `${fixture.caseId}-start`,
    selection: selection(saved),
  };
  finding(findings, same(Object.keys(startRequest).sort(), ['executionIntentKey', 'selection']), 'START_MEMBERSHIP_EMITTED', 'Client Start must contain only intent identity and Suite selection.');
  const started = await driver.startSuiteExecution(fixture.projectId, startRequest);
  finding(findings, started.kind === 'accepted', 'SUITE_START_REFUSED', 'Eligible current Suite must produce an accepted Execution.');
  if (started.kind !== 'accepted') return;
  const execution = await driver.readExecution(fixture.projectId, started.executionId);
  const results = await driver.readResults(fixture.projectId, started.executionId);
  finding(findings, execution !== null, 'ACCEPTED_EXECUTION_MISSING', 'Accepted Start must expose durable Execution.');
  finding(findings, results !== null, 'ACCEPTED_RESULTS_MISSING', 'Completed Execution must expose Results.');
  if (execution && results) {
    const snapshot = {
      suiteId: saved.suiteId,
      suiteRevision: saved.revision,
      suiteContentHash: saved.contentHash,
      name: saved.name,
      purpose: saved.purpose,
      provenance: saved.provenance,
    };
    finding(findings, same(execution.selection, selection(saved)), 'EXECUTION_SELECTION_DRIFT', 'Execution selection must retain exact Suite identity/revision.');
    finding(findings, same(execution.suite, snapshot), 'EXECUTION_SUITE_PROVENANCE_DRIFT', 'Execution must bind the accepted immutable Suite snapshot.');
    finding(findings, execution.suite.suiteContentHash === saved.contentHash, 'EXECUTION_SUITE_HASH_DRIFT', 'Execution must preserve the exact accepted opaque Suite hash.');
    finding(findings, same(execution.manifest, expectedAuthorities), 'EXECUTION_MANIFEST_DRIFT', 'Execution manifest must retain exact ordered A/B authority.');
    finding(findings, same(execution.testSetAuthority, expectedAuthorities[0] && {
      testSetId: expectedAuthorities[0].testSetId,
      testSetRevision: expectedAuthorities[0].testSetRevision,
      definitionSchemaVersion: expectedAuthorities[0].definitionSchemaVersion,
      testSetContentHash: expectedAuthorities[0].testSetContentHash,
    }), 'EXECUTION_TEST_SET_AUTHORITY_DRIFT', 'Execution must expose one exact Test Set authority.');
    finding(findings, same(results.suite, snapshot), 'RESULTS_SUITE_PROVENANCE_DRIFT', 'Results must expose the accepted immutable Suite revision provenance.');
    finding(findings, results.suite?.suiteContentHash === saved.contentHash, 'RESULTS_SUITE_HASH_DRIFT', 'Results must preserve the exact accepted opaque Suite hash.');
    finding(findings, results.headlineOutcome === 'passed' && results.items.every(item => item.state === 'result_observed' && item.outcome === 'passed'), 'GOLDEN_EXECUTION_NOT_SUCCESSFUL', 'Golden Suite must execute successfully with observed passing Results.');
    finding(findings, results.suite !== null, 'LEGACY_SUITE_MASQUERADE', 'Legacy test_results.suite cannot replace canonical Suite provenance.');
  }
  observations.savedSuite = saved;
  observations.reopenedSuite = reopened.kind === 'available' ? reopened.suite : reopened;
  observations.preflight = preflight;
  observations.startRequest = startRequest;
  observations.execution = execution;
  observations.results = results;
}

async function checkStale(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  findings: M2CertificationFinding[],
  observations: Record<string, unknown>,
): Promise<void> {
  const saved = await create(driver, fixture);
  const frozenBytes = JSON.stringify(saved);
  await driver.persistCanonicalTestSet(fixture.testSets[1]!);
  const reopened = await driver.readSuite(fixture.projectId, saved.suiteId, 1);
  finding(findings, reopened.kind === 'available' && JSON.stringify(reopened.suite) === frozenBytes, 'STALE_SUITE_MUTATED', 'New Test Set authority must not mutate historical Suite revision bytes or semantics.');
  const preflight = await driver.preflightSuite(fixture.projectId, selection(saved));
  finding(findings, reopened.kind === 'available' && preflight.kind === 'refused' && preflight.refusalCode === 'stale_suite_authority' && !preflight.wholeSuiteEligible, 'STALE_SUITE_PREFLIGHT_ACCEPTED', 'Only an intact, integrity-valid Suite with differing current Test Set authority may refuse stale_suite_authority.');
  finding(findings, preflight.suiteContentHash === saved.contentHash, 'STALE_PREFLIGHT_SUITE_HASH_DRIFT', 'Stale preflight must retain the intact Suite revision\'s observed opaque hash.');
  finding(findings, preflight.refusalCode !== 'suite_integrity_invalid', 'VALID_STALE_SUITE_MARKED_INTEGRITY_INVALID', 'A valid stale Suite must not be classified as integrity-invalid.');
  const started = await driver.startSuiteExecution(fixture.projectId, {
    executionIntentKey: `${fixture.caseId}-stale-start`,
    selection: selection(saved),
  });
  finding(findings, started.kind === 'refused' && started.refusalCode === 'stale_suite_authority', 'STALE_SUITE_START_ACCEPTED', 'Stale Suite must not accept an Execution.');
  if (started.kind === 'accepted') {
    const execution = await driver.readExecution(fixture.projectId, started.executionId);
    finding(findings, execution === null, 'CURRENT_DEFINITION_SUBSTITUTION', 'Identical Definition IDs in a newer Test Set must not be substituted into stale Suite execution.');
    const results = await driver.readResults(fixture.projectId, started.executionId);
    finding(findings, results === null, 'SYNTHESIZED_PRODUCT_RESULT', 'A refused stale Suite must not acquire synthetic Product Results.');
  }
  observations.savedSuite = saved;
  observations.reopenedStaleSuite = reopened.kind === 'available' ? reopened.suite : reopened;
  observations.stalePreflight = preflight;
  observations.staleStart = started;
}

async function expectRefused(
  driver: M2CertificationDriver,
  request: unknown,
  findings: M2CertificationFinding[],
  code: string,
): Promise<void> {
  const result = await driver.createSuite(request);
  finding(findings, result.kind === 'refused', code, `Hostile create case ${code} must refuse.`);
}

async function checkHostiles(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  findings: M2CertificationFinding[],
): Promise<void> {
  const candidates = await seed(driver, fixture);
  const baseMembers = members(candidates, fixture.suite.orderedDefinitionIds);
  const baseRequest = mutationRequest(fixture.projectId, fixture.suite.name, baseMembers, 'hostile-base');
  const hashB = 'b'.repeat(64);
  for (const hostile of fixture.hostileCases) {
    if (hostile === 'mixed_test_set_ids') {
      const changed = cloneValue(baseMembers); changed[1]!.definitionAuthority.testSetId = 'other-set';
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Mixed IDs', changed, hostile), findings, 'MIXED_TEST_SET_IDS_ACCEPTED');
    } else if (hostile === 'mixed_revisions') {
      const changed = cloneValue(baseMembers); changed[1]!.definitionAuthority.testSetRevision += 1;
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Mixed revisions', changed, hostile), findings, 'MIXED_REVISIONS_ACCEPTED');
    } else if (hostile === 'mixed_hashes') {
      const changed = cloneValue(baseMembers); changed[1]!.definitionAuthority.testSetContentHash = hashB;
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Mixed hashes', changed, hostile), findings, 'MIXED_HASHES_ACCEPTED');
    } else if (hostile === 'mixed_schemas') {
      const changed = cloneValue(baseMembers); changed[1]!.definitionAuthority.definitionSchemaVersion = 3;
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Mixed schemas', changed, hostile), findings, 'MIXED_SCHEMAS_ACCEPTED');
    } else if (hostile === 'v1_member') {
      const changed = cloneValue(baseMembers).map((member, index) => index === 0
        ? { ...member, definitionAuthority: { ...member.definitionAuthority, definitionSchemaVersion: 1 } }
        : member);
      await expectRefused(driver, malformedMutationRequest(fixture.projectId, 'V1 member', changed, hostile), findings, 'V1_MEMBER_ACCEPTED');
    } else if (hostile === 'missing_definition') {
      const changed = cloneValue(baseMembers); changed[0]!.definitionAuthority.definitionId = 'missing-definition';
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Missing definition', changed, hostile), findings, 'MISSING_DEFINITION_ACCEPTED');
    } else if (hostile === 'cross_project_definition') {
      const otherSet = cloneValue(fixture.testSets[0]!); otherSet.projectId = `${fixture.projectId}-other`; otherSet.testSetId = 'other-project-set';
      await driver.persistCanonicalTestSet(otherSet);
      const other = await driver.listCandidates(otherSet.projectId);
      const changed = cloneValue(baseMembers); changed[0]!.definitionAuthority = cloneValue(other[0]!.definitionAuthority);
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Cross project', changed, hostile), findings, 'CROSS_PROJECT_DEFINITION_ACCEPTED');
    } else if (hostile === 'malformed_authority_claim') {
      const changed = cloneValue(baseMembers).map((member, index) => {
        if (index !== 0) return member;
        const { testSetContentHash: _omitted, ...definitionAuthority } = member.definitionAuthority;
        return { ...member, definitionAuthority };
      });
      await expectRefused(driver, malformedMutationRequest(fixture.projectId, 'Malformed authority', changed, hostile), findings, 'MALFORMED_AUTHORITY_ACCEPTED');
    } else if (hostile === 'ordinal_gap') {
      const changed = cloneValue(baseMembers); changed[1]!.ordinal = 2;
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Ordinal gap', changed, hostile), findings, 'ORDINAL_GAP_ACCEPTED');
    } else if (hostile === 'duplicate_member') {
      const changed = cloneValue(baseMembers); changed[1]!.definitionAuthority = cloneValue(changed[0]!.definitionAuthority);
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Duplicate member', changed, hostile), findings, 'DUPLICATE_MEMBER_ACCEPTED');
    } else if (hostile === 'empty_suite') {
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Empty', [], hostile), findings, 'EMPTY_SUITE_ACCEPTED');
    } else if (hostile === 'more_than_50_members') {
      const changed = Array.from({ length: 51 }, (_value, ordinal) => ({ ...cloneValue(baseMembers[0]!), ordinal }));
      await expectRefused(driver, mutationRequest(fixture.projectId, 'Too many', changed, hostile), findings, 'OVERSIZE_SUITE_ACCEPTED');
    }
  }
  const created = await driver.createSuite(baseRequest);
  finding(findings, created.kind === 'accepted', 'HOSTILE_BASE_CREATE_REFUSED', 'Hostile matrix setup Suite must be valid.');
  if (created.kind !== 'accepted') return;
  const suite = created.suite;
  const integrityHostiles: Partial<Record<M2CertificationCase['hostileCases'][number], SuiteIntegrityFault>> = {
    corrupt_suite_hash: 'corrupted_content_hash',
    invalid_persisted_authority: 'invalid_persisted_authority',
    missing_suite_authority_field: 'missing_suite_authority_field',
    persisted_ordinal_member_inconsistency: 'ordinal_member_inconsistency',
    suite_identity_content_mismatch: 'wrong_suite_identity_content_pairing',
  };
  for (const [hostileIndex, hostile] of fixture.hostileCases.entries()) {
    const integrityFault = integrityHostiles[hostile];
    if (!integrityFault) continue;
    const integrityCreate = await driver.createSuite(mutationRequest(
      fixture.projectId,
      `Integrity Hostile ${hostileIndex}`,
      baseMembers,
      `integrity-hostile-${hostileIndex}`,
    ));
    finding(findings, integrityCreate.kind === 'accepted', 'INTEGRITY_HOSTILE_SETUP_REFUSED', `Integrity hostile ${hostile} requires a valid pre-corruption Suite.`);
    if (integrityCreate.kind !== 'accepted') continue;
    await driver.injectSuiteIntegrityFault(
      fixture.projectId,
      integrityCreate.suite.suiteId,
      integrityCreate.suite.revision,
      integrityFault,
    );
    const hostileSelection = selection(integrityCreate.suite);
    const read = await driver.readSuite(fixture.projectId, hostileSelection.suiteId, hostileSelection.suiteRevision);
    const preflight = await driver.preflightSuite(fixture.projectId, hostileSelection);
    const started = await driver.startSuiteExecution(fixture.projectId, {
      executionIntentKey: `integrity-hostile-start-${hostileIndex}`,
      selection: hostileSelection,
    });
    finding(findings, read.kind === 'refused' && read.refusalCode === 'suite_integrity_invalid', 'INTEGRITY_HOSTILE_NOT_OBSERVED', `Driver read boundary must expose ${hostile} as suite_integrity_invalid.`);
    finding(findings, preflight.kind === 'refused' && preflight.refusalCode === 'suite_integrity_invalid', 'INTEGRITY_PREFLIGHT_NOT_REFUSED', `Preflight must refuse ${hostile} as suite_integrity_invalid.`);
    finding(findings, preflight.refusalCode !== 'stale_suite_authority', 'INTEGRITY_REFUSAL_CONFLATED_WITH_STALE', `${hostile} must never become stale_suite_authority.`);
    finding(findings, started.kind === 'refused' && started.refusalCode === 'suite_integrity_invalid', 'INTEGRITY_START_NOT_REFUSED', `Start must refuse ${hostile} as suite_integrity_invalid.`);
  }
  for (const hostile of fixture.hostileCases) {
    if (integrityHostiles[hostile]) continue;
    if (hostile === 'duplicate_normalized_name') {
      const duplicate = await driver.createSuite(mutationRequest(fixture.projectId, `  ${fixture.suite.name.toUpperCase()}  `, baseMembers, hostile));
      finding(findings, duplicate.kind === 'refused', 'DUPLICATE_NORMALIZED_NAME_ACCEPTED', 'Normalized duplicate Suite names must refuse.');
    } else if (hostile === 'stale_expected_revision') {
      const revised = await driver.reviseSuite({ ...mutationRequest(fixture.projectId, 'Stale edit', baseMembers, hostile), suiteId: suite.suiteId, expectedRevision: 2 });
      finding(findings, revised.kind === 'refused', 'STALE_EXPECTED_REVISION_ACCEPTED', 'Stale expectedRevision must refuse.');
    } else if (hostile === 'same_change_key_exact_retry') {
      const current = (await driver.listSuites(fixture.projectId)).find(value => value.suiteId === suite.suiteId)!;
      const request = { ...mutationRequest(fixture.projectId, 'Retry exact', baseMembers, 'retry-exact'), suiteId: suite.suiteId, expectedRevision: current.revision };
      const first = await driver.reviseSuite(request); const retry = await driver.reviseSuite(request);
      finding(findings, first.kind === 'accepted' && retry.kind === 'accepted' && retry.replayed && same(first.suite, retry.suite), 'CHANGE_INTENT_EXACT_RETRY_DRIFT', 'Exact changeIntentKey retry must return the same revision.');
    } else if (hostile === 'same_change_key_different_content') {
      const current = (await driver.listSuites(fixture.projectId)).find(value => value.suiteId === suite.suiteId)!;
      const firstRequest = { ...mutationRequest(fixture.projectId, 'Conflict one', baseMembers, 'retry-conflict'), suiteId: suite.suiteId, expectedRevision: current.revision };
      const first = await driver.reviseSuite(firstRequest);
      const second = await driver.reviseSuite({ ...firstRequest, name: 'Conflict two' });
      finding(findings, first.kind === 'accepted' && second.kind === 'refused', 'CHANGE_INTENT_CONTENT_CONFLICT_ACCEPTED', 'Same changeIntentKey with different content must refuse.');
    } else if (hostile === 'reorder_new_revision_hash' || hostile === 'rename_new_revision' || hostile === 'historical_revision_unchanged') {
      const head = (await driver.listSuites(fixture.projectId)).find(value => value.suiteId === suite.suiteId)!;
      const old = await driver.readSuite(fixture.projectId, suite.suiteId, head.revision);
      const changedMembers = hostile === 'reorder_new_revision_hash'
        ? [...head.members].reverse().map((member, ordinal) => ({ ...member, ordinal }))
        : head.members;
      const changedName = hostile === 'rename_new_revision' ? `${head.name} renamed` : head.name;
      const result = await driver.reviseSuite({ ...mutationRequest(fixture.projectId, changedName, changedMembers, `${hostile}-${head.revision}`), suiteId: suite.suiteId, expectedRevision: head.revision });
      finding(findings, result.kind === 'accepted' && result.suite.revision === head.revision + 1, 'SUITE_REVISION_NOT_APPENDED', 'Reorder/rename must append a new Suite revision.');
      if (result.kind === 'accepted') {
        if (hostile === 'reorder_new_revision_hash') finding(findings, result.suite.contentHash !== head.contentHash, 'REORDER_HASH_UNCHANGED', 'Reorder must produce a different observed Suite contentHash.');
        if (hostile === 'rename_new_revision') {
          finding(findings, result.suite.name !== head.name, 'RENAME_NOT_PERSISTED', 'Rename must create a new named revision.');
          finding(findings, result.suite.contentHash !== head.contentHash, 'RENAME_HASH_UNCHANGED', 'Rename must produce a different observed Suite contentHash.');
        }
        const historical = await driver.readSuite(fixture.projectId, suite.suiteId, head.revision);
        finding(findings, old.kind === 'available' && historical.kind === 'available' && same(historical.suite, old.suite), 'HISTORICAL_REVISION_MUTATED', 'Historical Suite revision must remain unchanged.');
      }
    }
  }
  const runnableHead = (await driver.listSuites(fixture.projectId)).find(value => value.suiteId === suite.suiteId)!;
  for (const hostile of fixture.hostileCases) {
    if (hostile === 'same_start_key_exact_retry') {
      const request = { executionIntentKey: 'start-exact', selection: selection(runnableHead) };
      const first = await driver.startSuiteExecution(fixture.projectId, request); const retry = await driver.startSuiteExecution(fixture.projectId, request);
      finding(findings, first.kind === 'accepted' && retry.kind === 'accepted' && retry.replayed && first.executionId === retry.executionId, 'START_EXACT_RETRY_DRIFT', 'Exact Start K1 retry must return one Execution identity.');
    } else if (hostile === 'same_start_key_changed_selection') {
      const oldSelection = selection(suite);
      const first = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'start-conflict', selection: oldSelection });
      const second = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'start-conflict', selection: selection(runnableHead) });
      finding(findings, first.kind === 'accepted' && second.kind === 'refused', 'START_CHANGED_SELECTION_ACCEPTED', 'Same Start K1 with changed Suite/revision must refuse.');
    } else if (hostile === 'client_injects_members_at_start') {
      const injected = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'start-injected', selection: selection(runnableHead), members: runnableHead.members });
      finding(findings, injected.kind === 'refused', 'CLIENT_MEMBERSHIP_ACCEPTED', 'Start must reject client membership injection.');
    } else if (hostile === 'authority_changes_after_preflight') {
      const before = await driver.preflightSuite(fixture.projectId, selection(runnableHead));
      const newer = cloneValue(fixture.testSets[1]!); await driver.persistCanonicalTestSet(newer);
      const started = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'post-preflight-change', selection: selection(runnableHead) });
      finding(findings, before.kind === 'accepted' && started.kind === 'refused' && started.refusalCode === 'stale_suite_authority', 'POST_PREFLIGHT_AUTHORITY_CHANGE_ACCEPTED', 'Start must recheck authority after preflight.');
      await driver.persistCanonicalTestSet(fixture.testSets[0]!);
    } else if (hostile === 'suite_identity_content_mismatch') {
      const second = await driver.createSuite(mutationRequest(fixture.projectId, 'Suite B', baseMembers, 'suite-b'));
      const started = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'suite-a', selection: selection(runnableHead) });
      if (second.kind === 'accepted' && started.kind === 'accepted') {
        const execution = await driver.readExecution(fixture.projectId, started.executionId);
        finding(findings, execution?.suite.name === runnableHead.name && execution.suite.suiteContentHash === runnableHead.contentHash, 'SUITE_IDENTITY_CONTENT_MISMATCH', 'Suite A identity must never bind Suite B content.');
      }
    } else if (hostile === 'results_from_current_head') {
      const started = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'old-results', selection: selection(runnableHead) });
      if (started.kind === 'accepted') {
        const revised = await driver.reviseSuite({ ...mutationRequest(fixture.projectId, `${runnableHead.name} newest`, runnableHead.members, 'new-head-after-start'), suiteId: runnableHead.suiteId, expectedRevision: runnableHead.revision });
        const results = await driver.readResults(fixture.projectId, started.executionId);
        finding(findings, revised.kind === 'accepted'
          && results?.suite?.suiteRevision === runnableHead.revision
          && results.suite.name === runnableHead.name
          && results.suite.suiteContentHash === runnableHead.contentHash,
        'RESULTS_FLOATED_TO_CURRENT_HEAD', 'Results must preserve the accepted revision and its observed hash, never values from current head.');
      }
    } else if (hostile === 'legacy_suite_masquerade') {
      const started = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'legacy-check', selection: selection(runnableHead) });
      if (started.kind === 'accepted') {
        const results = await driver.readResults(fixture.projectId, started.executionId);
        finding(findings, results?.suite !== null && results?.suite !== undefined, 'LEGACY_SUITE_MASQUERADE', 'Legacy test_results.suite cannot masquerade as canonical Suite authority.');
      }
    } else if (hostile === 'partial_member_preflight') {
      const partialSet = cloneValue(fixture.testSets[0]!); partialSet.definitions[1]!.executable = false;
      await driver.persistCanonicalTestSet(partialSet);
      const preflight = await driver.preflightSuite(fixture.projectId, selection(runnableHead));
      finding(findings, preflight.kind === 'refused' && !preflight.wholeSuiteEligible, 'PARTIAL_MEMBER_PREFLIGHT_ACCEPTED', 'Whole-Suite eligibility must refuse when any member is ineligible.');
      await driver.persistCanonicalTestSet(fixture.testSets[0]!);
    }
  }
}

async function checkFailFast(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  findings: M2CertificationFinding[],
): Promise<void> {
  const suite = await create(driver, fixture);
  const started = await driver.startSuiteExecution(fixture.projectId, { executionIntentKey: 'fail-fast', selection: selection(suite) });
  finding(findings, started.kind === 'accepted', 'FAIL_FAST_START_REFUSED', 'Fail-fast fixture must accept before execution evidence is evaluated.');
  if (started.kind !== 'accepted') return;
  const results = await driver.readResults(fixture.projectId, started.executionId);
  finding(findings, results?.headlineOutcome === 'failed', 'FAIL_FAST_HEADLINE_UNTRUTHFUL', 'Observed failure must dominate missing later Results.');
  finding(findings, results?.items[1]?.state === 'result_observed' && results.items[1].outcome === 'failed', 'FAIL_FAST_FAILURE_MISSING', 'Fail-fast Results must preserve the observed failure.');
  finding(findings, results?.items[2]?.state === 'no_result_observed' && results.items[2].reasonCode === 'expected_result_missing', 'FAIL_FAST_MISSING_LATER_INVENTED', 'Unexecuted later member must remain explicitly missing.');
}

async function checkUi(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  findings: M2CertificationFinding[],
): Promise<void> {
  finding(findings, same([...fixture.uiRequirements].sort(), [...UI_REQUIREMENTS].sort()), 'UI_CONTRACT_INCOMPLETE', 'UI fixture must freeze all ten semantic requirements.');
  const suite = await create(driver, fixture);
  const listed = await driver.listSuites(fixture.projectId);
  const reopened = await driver.readSuite(fixture.projectId, suite.suiteId, suite.revision);
  finding(findings, listed.some(value => value.suiteId === suite.suiteId && value.name === suite.name && value.purpose === 'sanity' && value.revision === 1 && value.contentHash === suite.contentHash), 'UI_SAVED_SUITE_LIST_DRIFT', 'Saved Suite list must expose name, purpose, revision, and hash.');
  finding(findings, reopened.kind === 'available' && same(reopened.suite.members, suite.members), 'UI_ORDERED_MEMBERS_DRIFT', 'Create/reopen must expose exact ordered members.');
  const staleEdit = await driver.reviseSuite({ ...mutationRequest(fixture.projectId, suite.name, suite.members, 'ui-stale-edit'), suiteId: suite.suiteId, expectedRevision: 2 });
  finding(findings, staleEdit.kind === 'refused', 'UI_STALE_EDIT_ACCEPTED', 'UI stale edit conflict must remain observable.');
  const partialSet = cloneValue(fixture.testSets[0]!); partialSet.definitions[1]!.executable = false;
  await driver.persistCanonicalTestSet(partialSet);
  const partial = await driver.preflightSuite(fixture.projectId, selection(suite));
  finding(findings, partial.kind === 'refused', 'UI_PARTIAL_ELIGIBILITY_ACCEPTED', 'UI Run truth must use whole-Suite eligibility.');
  await driver.persistCanonicalTestSet(fixture.testSets[1]!);
  const staleRead = await driver.readSuite(fixture.projectId, suite.suiteId, 1);
  const stale = await driver.preflightSuite(fixture.projectId, selection(suite));
  finding(findings, staleRead.kind === 'available' && stale.kind === 'refused' && stale.refusalCode === 'stale_suite_authority', 'UI_STALE_READ_RUN_DRIFT', 'Stale Suite must remain integrity-valid, readable, and non-runnable.');
}

export async function certifyM2Case(
  driver: M2CertificationDriver,
  fixture: M2CertificationCase,
  options: M2CertificationOptions = {},
): Promise<M2CertificationReport> {
  const findings: M2CertificationFinding[] = [];
  const observations: Record<string, unknown> = {};
  if ((options.requireProductAuthority ?? true) && driver.authorityClass !== 'product') {
    findings.push({ code: 'REFERENCE_DRIVER_CANNOT_CERTIFY_PRODUCT', message: 'Reference mechanics are categorically ineligible for a Product PASS.' });
  }
  if (fixture.scenario === 'golden_v2' || fixture.scenario === 'positive_v3') await checkPositive(driver, fixture, findings, observations);
  else if (fixture.scenario === 'stale_authority') await checkStale(driver, fixture, findings, observations);
  else if (fixture.scenario === 'hostile_matrix') await checkHostiles(driver, fixture, findings);
  else if (fixture.scenario === 'fail_fast_results') await checkFailFast(driver, fixture, findings);
  else await checkUi(driver, fixture, findings);
  return {
    caseId: fixture.caseId,
    driverName: driver.name,
    driverAuthorityClass: driver.authorityClass,
    passed: findings.length === 0,
    findings,
    observations,
  };
}

export function assertM2CertificationPassed(report: M2CertificationReport): void {
  assert.equal(report.passed, true, report.findings.map(value => `${value.code}: ${value.message}`).join('\n'));
}

export { UI_REQUIREMENTS };
