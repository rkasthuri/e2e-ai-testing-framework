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

import { createHash } from 'node:crypto';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DefinitionSchemaVersion = 2 | 3;
export type ResultOutcome = 'passed' | 'failed' | 'could_not_verify';

export interface TestSetAuthority {
  testSetId: string;
  testSetRevision: number;
  definitionSchemaVersion: DefinitionSchemaVersion;
  testSetContentHash: string;
}

export interface DefinitionAuthority extends TestSetAuthority {
  definitionId: string;
}

export interface SuiteMember {
  ordinal: number;
  definitionAuthority: DefinitionAuthority;
}

export interface SavedSuite {
  schemaVersion: 1;
  suiteId: string;
  projectId: string;
  revision: number;
  name: string;
  purpose: 'sanity';
  members: SuiteMember[];
  createdAt: string;
  provenance: JsonValue;
  contentHash: string;
}

export interface CandidateDefinition {
  projectId: string;
  executable: boolean;
  definitionAuthority: DefinitionAuthority;
}

export interface CanonicalTestSetFixture {
  projectId: string;
  testSetId: string;
  testSetRevision: number;
  definitionSchemaVersion: DefinitionSchemaVersion;
  testSetContentHash: string;
  definitions: Array<{
    definitionId: string;
    executable: boolean;
    executionOutcome: ResultOutcome;
  }>;
}

export interface SuiteSelection {
  kind: 'suite_revision';
  suiteId: string;
  suiteRevision: number;
}

export interface SuitePreflight {
  kind: 'accepted' | 'refused';
  selection: SuiteSelection;
  suiteContentHash: string | null;
  refusalCode: 'stale_suite_authority' | 'suite_integrity_invalid' | null;
  wholeSuiteEligible: boolean;
}

export type SuiteReadResult =
  | { kind: 'available'; suite: SavedSuite }
  | { kind: 'refused'; refusalCode: 'suite_integrity_invalid' }
  | { kind: 'not_found'; refusalCode: null };

export type SuiteIntegrityFault =
  | 'corrupted_content_hash'
  | 'invalid_persisted_authority'
  | 'missing_suite_authority_field'
  | 'ordinal_member_inconsistency'
  | 'wrong_suite_identity_content_pairing';

export type MutationResult =
  | { kind: 'accepted'; suite: SavedSuite; replayed: boolean }
  | { kind: 'refused'; refusalCode: string | null };

export type StartResult =
  | { kind: 'accepted'; executionId: string; replayed: boolean }
  | { kind: 'refused'; refusalCode: string | null };

export interface AcceptedSuiteSnapshot {
  suiteId: string;
  suiteRevision: number;
  suiteContentHash: string;
  name: string;
  purpose: 'sanity';
  provenance: JsonValue;
}

export interface ExecutionObservation {
  executionId: string;
  projectId: string;
  state: 'completed';
  selection: SuiteSelection;
  suite: AcceptedSuiteSnapshot;
  testSetAuthority: TestSetAuthority;
  manifest: DefinitionAuthority[];
}

export type ResultItem =
  | { definitionId: string; state: 'result_observed'; outcome: ResultOutcome }
  | { definitionId: string; state: 'no_result_observed'; reasonCode: 'expected_result_missing' };

export interface ResultsObservation {
  executionId: string;
  headlineOutcome: ResultOutcome;
  suite: AcceptedSuiteSnapshot | null;
  testSetAuthority: TestSetAuthority;
  items: ResultItem[];
  legacyTestResultsSuite?: string;
}

export type BrokenAdapterFault =
  | 'accept_client_membership'
  | 'accept_partial_eligibility'
  | 'change_hash_on_repeated_read'
  | 'conflate_suite_integrity_with_stale'
  | 'confuse_legacy_suite_field'
  | 'current_head_hash_in_results'
  | 'current_head_name_in_results'
  | 'drop_execution_suite_hash'
  | 'drop_results_suite_hash'
  | 'drop_suite_provenance'
  | 'float_to_newest_definitions'
  | 'ignore_stale_test_set'
  | 'ignore_suite_revision'
  | 'invalid_suite_hash_shape'
  | 'mutate_suite_content_same_authority'
  | 'reorder_members'
  | 'reuse_hash_across_semantic_revision'
  | 'results_from_current_head'
  | 'substitute_preflight_suite_hash'
  | 'substitute_execution_suite_hash'
  | 'substitute_results_suite_hash'
  | 'suite_identity_content_mismatch'
  | 'synthesize_product_result';

export type M2HostileCase =
  | 'authority_changes_after_preflight'
  | 'client_injects_members_at_start'
  | 'corrupt_suite_hash'
  | 'cross_project_definition'
  | 'duplicate_member'
  | 'duplicate_normalized_name'
  | 'empty_suite'
  | 'legacy_suite_masquerade'
  | 'malformed_authority_claim'
  | 'missing_definition'
  | 'missing_suite_authority_field'
  | 'mixed_hashes'
  | 'mixed_revisions'
  | 'mixed_schemas'
  | 'mixed_test_set_ids'
  | 'more_than_50_members'
  | 'ordinal_zero'
  | 'ordinal_gap'
  | 'duplicate_ordinal'
  | 'partial_member_preflight'
  | 'persisted_ordinal_member_inconsistency'
  | 'historical_revision_unchanged'
  | 'rename_new_revision'
  | 'reorder_new_revision_hash'
  | 'results_from_current_head'
  | 'same_change_key_different_content'
  | 'same_change_key_exact_retry'
  | 'same_start_key_changed_selection'
  | 'same_start_key_exact_retry'
  | 'stale_expected_revision'
  | 'suite_identity_content_mismatch'
  | 'invalid_persisted_authority'
  | 'v1_member';

export interface M2CertificationCase {
  schemaVersion: 'forge-m2-certification-case/v1';
  caseId: string;
  title: string;
  scenario: 'golden_v2' | 'positive_v3' | 'stale_authority' | 'hostile_matrix' | 'fail_fast_results' | 'ui_contract';
  projectId: string;
  testSets: CanonicalTestSetFixture[];
  suite: {
    name: string;
    purpose: 'sanity';
    orderedDefinitionIds: string[];
    expectedOrdinals: number[];
  };
  hostileCases: M2HostileCase[];
  uiRequirements: string[];
  tags: string[];
}

export interface M2CertificationDriver {
  readonly name: string;
  readonly authorityClass: 'reference' | 'product';
  persistCanonicalTestSet(testSet: CanonicalTestSetFixture): Promise<void>;
  injectSuiteIntegrityFault(projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void>;
  listCandidates(projectId: string): Promise<CandidateDefinition[]>;
  listSuites(projectId: string): Promise<SavedSuite[]>;
  createSuite(request: unknown): Promise<MutationResult>;
  readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult>;
  reviseSuite(request: unknown): Promise<MutationResult>;
  preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight>;
  startSuiteExecution(projectId: string, request: unknown): Promise<StartResult>;
  readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null>;
  readResults(projectId: string, executionId: string): Promise<ResultsObservation | null>;
}

const HASH = /^[a-f0-9]{64}$/;

/** Reference replay mechanics only. This is not Product contentHash semantics. */
function referenceOnlyRequestFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Mints an opaque, validly-shaped reference token without hashing Suite content. */
function referenceOnlyOpaqueSha256(label: string): string {
  return createHash('sha256').update(`reference-only:${label}`).digest('hex');
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function authorityFrom(testSet: CanonicalTestSetFixture, definitionId: string): DefinitionAuthority {
  return {
    definitionId,
    testSetId: testSet.testSetId,
    testSetRevision: testSet.testSetRevision,
    definitionSchemaVersion: testSet.definitionSchemaVersion,
    testSetContentHash: testSet.testSetContentHash,
  };
}

function sameAuthority(left: TestSetAuthority, right: TestSetAuthority): boolean {
  return left.testSetId === right.testSetId
    && left.testSetRevision === right.testSetRevision
    && left.definitionSchemaVersion === right.definitionSchemaVersion
    && left.testSetContentHash === right.testSetContentHash;
}

function authorityOf(testSet: CanonicalTestSetFixture): TestSetAuthority {
  return {
    testSetId: testSet.testSetId,
    testSetRevision: testSet.testSetRevision,
    definitionSchemaVersion: testSet.definitionSchemaVersion,
    testSetContentHash: testSet.testSetContentHash,
  };
}

function parseMembers(value: unknown): SuiteMember[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const members: SuiteMember[] = [];
  for (const item of value) {
    const member = objectValue(item);
    const authority = objectValue(member?.definitionAuthority);
    if (!member || !authority || !exactKeys(member, ['ordinal', 'definitionAuthority'])
      || !exactKeys(authority, ['definitionId', 'testSetId', 'testSetRevision', 'definitionSchemaVersion', 'testSetContentHash'])
      || !Number.isSafeInteger(member.ordinal) || Number(member.ordinal) < 1
      || typeof authority.definitionId !== 'string' || authority.definitionId.length === 0
      || typeof authority.testSetId !== 'string' || authority.testSetId.length === 0
      || !Number.isSafeInteger(authority.testSetRevision) || Number(authority.testSetRevision) < 1
      || ![2, 3].includes(Number(authority.definitionSchemaVersion))
      || typeof authority.testSetContentHash !== 'string' || !HASH.test(authority.testSetContentHash)) return null;
    members.push(cloneValue(item as SuiteMember));
  }
  return members;
}

interface ParsedMutation {
  projectId: string;
  name: string;
  purpose: 'sanity';
  members: SuiteMember[];
  changeIntentKey: string;
  suiteId?: string;
  expectedRevision?: number;
}

function parseMutation(value: unknown, revision: boolean): ParsedMutation | null {
  const request = objectValue(value);
  const keys = revision
    ? ['projectId', 'suiteId', 'expectedRevision', 'name', 'purpose', 'members', 'changeIntentKey']
    : ['projectId', 'name', 'purpose', 'members', 'changeIntentKey'];
  if (!request || !exactKeys(request, keys)
    || typeof request.projectId !== 'string' || request.projectId.length === 0
    || typeof request.name !== 'string' || request.name.trim().length === 0
    || request.purpose !== 'sanity'
    || typeof request.changeIntentKey !== 'string' || request.changeIntentKey.length === 0) return null;
  const members = parseMembers(request.members);
  if (!members) return null;
  if (revision && (typeof request.suiteId !== 'string' || request.suiteId.length === 0
    || !Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision) < 1)) return null;
  return {
    projectId: request.projectId,
    name: request.name.trim().replace(/\s+/g, ' '),
    purpose: 'sanity',
    members,
    changeIntentKey: request.changeIntentKey,
    ...(revision ? { suiteId: request.suiteId as string, expectedRevision: Number(request.expectedRevision) } : {}),
  };
}

function parseSelection(value: unknown): SuiteSelection | null {
  const selection = objectValue(value);
  if (!selection || !exactKeys(selection, ['kind', 'suiteId', 'suiteRevision'])
    || selection.kind !== 'suite_revision'
    || typeof selection.suiteId !== 'string' || selection.suiteId.length === 0
    || !Number.isSafeInteger(selection.suiteRevision) || Number(selection.suiteRevision) < 1) return null;
  return cloneValue(selection as unknown as SuiteSelection);
}

interface StoredExecution {
  observation: ExecutionObservation;
  results: ResultsObservation;
}

export class ReferenceM2Driver implements M2CertificationDriver {
  public readonly name: string;
  public readonly authorityClass = 'reference' as const;
  private readonly faults: Set<BrokenAdapterFault>;
  private readonly testSets = new Map<string, CanonicalTestSetFixture>();
  private readonly suites = new Map<string, SavedSuite[]>();
  private readonly suiteIntegrityFaults = new Map<string, SuiteIntegrityFault>();
  private readonly mutationIntents = new Map<string, { fingerprint: string; result: MutationResult }>();
  private readonly executionIntents = new Map<string, { fingerprint: string; result: StartResult }>();
  private readonly executions = new Map<string, StoredExecution>();
  private readonly suiteReadCounts = new Map<string, number>();
  private suiteSequence = 0;
  private executionSequence = 0;
  private clockSequence = 0;

  public constructor(options: {
    faults?: BrokenAdapterFault[];
    name?: string;
  } = {}) {
    this.faults = new Set(options.faults ?? []);
    this.name = options.name ?? (this.faults.size === 0 ? 'm2-reference-driver' : 'deliberately-broken-m2-adapter');
  }

  public async persistCanonicalTestSet(testSet: CanonicalTestSetFixture): Promise<void> {
    this.testSets.set(testSet.projectId, cloneValue(testSet));
  }

  public async injectSuiteIntegrityFault(
    projectId: string,
    suiteId: string,
    suiteRevision: number,
    fault: SuiteIntegrityFault,
  ): Promise<void> {
    this.suiteIntegrityFaults.set(`${projectId}:${suiteId}:${suiteRevision}`, fault);
  }

  public async listCandidates(projectId: string): Promise<CandidateDefinition[]> {
    const testSet = this.testSets.get(projectId);
    return testSet ? testSet.definitions.map(definition => ({
      projectId,
      executable: definition.executable,
      definitionAuthority: authorityFrom(testSet, definition.definitionId),
    })) : [];
  }

  public async listSuites(projectId: string): Promise<SavedSuite[]> {
    return [...this.suites.values()]
      .map(revisions => revisions.at(-1)!)
      .filter(suite => suite.projectId === projectId)
      .map(cloneValue);
  }

  public async createSuite(request: unknown): Promise<MutationResult> {
    const parsed = parseMutation(request, false);
    if (!parsed) return { kind: 'refused', refusalCode: null };
    const fingerprint = referenceOnlyRequestFingerprint(parsed);
    const intentId = `${parsed.projectId}:${parsed.changeIntentKey}`;
    const replay = this.mutationIntents.get(intentId);
    if (replay) return replay.fingerprint === fingerprint
      ? { ...cloneValue(replay.result), ...(replay.result.kind === 'accepted' ? { replayed: true } : {}) } as MutationResult
      : { kind: 'refused', refusalCode: null };
    if (!this.validMembers(parsed.projectId, parsed.members)
      || [...this.suites.values()].some(revisions => revisions[0]!.projectId === parsed.projectId
        && normalizedName(revisions.at(-1)!.name) === normalizedName(parsed.name))) {
      return { kind: 'refused', refusalCode: null };
    }
    this.suiteSequence += 1;
    const suiteId = `suite-${parsed.projectId}-${this.suiteSequence}`;
    const suite = this.buildSuite(suiteId, 1, parsed);
    this.suites.set(suiteId, [suite]);
    const result: MutationResult = { kind: 'accepted', suite: cloneValue(suite), replayed: false };
    this.mutationIntents.set(intentId, { fingerprint, result: cloneValue(result) });
    return result;
  }

  public async readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult> {
    const revisions = this.suites.get(suiteId);
    if (!revisions) return { kind: 'not_found', refusalCode: null };
    const requested = this.faults.has('ignore_suite_revision') ? revisions.at(-1) : revisions.find(value => value.revision === suiteRevision);
    if (requested?.projectId !== projectId) return { kind: 'not_found', refusalCode: null };
    const integrityKey = `${projectId}:${suiteId}:${suiteRevision}`;
    if (this.suiteIntegrityFaults.has(integrityKey) && !this.faults.has('suite_identity_content_mismatch')) {
      return { kind: 'refused', refusalCode: 'suite_integrity_invalid' };
    }
    const observed = cloneValue(requested);
    const readKey = `${projectId}:${suiteId}:${suiteRevision}`;
    const readCount = (this.suiteReadCounts.get(readKey) ?? 0) + 1;
    this.suiteReadCounts.set(readKey, readCount);
    if (this.faults.has('mutate_suite_content_same_authority')) observed.name = `${observed.name} mutated`;
    if (this.faults.has('suite_identity_content_mismatch')) observed.name = 'Mismatched Suite B content';
    if (this.faults.has('change_hash_on_repeated_read')) {
      observed.contentHash = readCount % 2 === 1 ? '9'.repeat(64) : '8'.repeat(64);
    }
    return { kind: 'available', suite: observed };
  }

  public async reviseSuite(request: unknown): Promise<MutationResult> {
    const parsed = parseMutation(request, true);
    if (!parsed) return { kind: 'refused', refusalCode: null };
    const revisions = this.suites.get(parsed.suiteId!);
    const head = revisions?.at(-1);
    const fingerprint = referenceOnlyRequestFingerprint(parsed);
    const intentId = `${parsed.projectId}:${parsed.changeIntentKey}`;
    const replay = this.mutationIntents.get(intentId);
    if (replay) return replay.fingerprint === fingerprint
      ? { ...cloneValue(replay.result), ...(replay.result.kind === 'accepted' ? { replayed: true } : {}) } as MutationResult
      : { kind: 'refused', refusalCode: null };
    if (!head || head.projectId !== parsed.projectId || head.revision !== parsed.expectedRevision
      || !this.validMembers(parsed.projectId, parsed.members)
      || [...this.suites.entries()].some(([id, values]) => id !== parsed.suiteId
        && values[0]!.projectId === parsed.projectId
        && normalizedName(values.at(-1)!.name) === normalizedName(parsed.name))) {
      return { kind: 'refused', refusalCode: null };
    }
    const suite = this.buildSuite(head.suiteId, head.revision + 1, parsed);
    revisions!.push(suite);
    const result: MutationResult = { kind: 'accepted', suite: cloneValue(suite), replayed: false };
    this.mutationIntents.set(intentId, { fingerprint, result: cloneValue(result) });
    return result;
  }

  public async preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight> {
    const read = await this.readSuite(projectId, selection.suiteId, selection.suiteRevision);
    if (read.kind === 'refused') {
      return {
        kind: 'refused',
        selection,
        suiteContentHash: null,
        refusalCode: this.faults.has('conflate_suite_integrity_with_stale') ? 'stale_suite_authority' : 'suite_integrity_invalid',
        wholeSuiteEligible: false,
      };
    }
    if (read.kind === 'not_found') return { kind: 'refused', selection, suiteContentHash: null, refusalCode: null, wholeSuiteEligible: false };
    const suite = read.suite;
    const suiteContentHash = this.faults.has('substitute_preflight_suite_hash') ? '6'.repeat(64) : suite.contentHash;
    const current = this.testSets.get(projectId);
    const suiteAuthority = suite.members[0]?.definitionAuthority;
    if (!suiteAuthority) {
      return { kind: 'refused', selection, suiteContentHash: null, refusalCode: 'suite_integrity_invalid', wholeSuiteEligible: false };
    }
    if (!current) return { kind: 'refused', selection, suiteContentHash, refusalCode: null, wholeSuiteEligible: false };
    if (!this.faults.has('ignore_stale_test_set')
      && !this.faults.has('float_to_newest_definitions')
      && !sameAuthority(suiteAuthority, authorityOf(current))) {
      return { kind: 'refused', selection, suiteContentHash, refusalCode: 'stale_suite_authority', wholeSuiteEligible: false };
    }
    const eligibility = suite.members.map(member => current.definitions.find(
      definition => definition.definitionId === member.definitionAuthority.definitionId,
    )?.executable === true);
    const wholeSuiteEligible = this.faults.has('accept_partial_eligibility')
      ? eligibility.some(Boolean)
      : eligibility.every(Boolean);
    return {
      kind: wholeSuiteEligible ? 'accepted' : 'refused',
      selection,
      suiteContentHash,
      refusalCode: null,
      wholeSuiteEligible,
    };
  }

  public async startSuiteExecution(projectId: string, request: unknown): Promise<StartResult> {
    const value = objectValue(request);
    const hasClientMembers = Boolean(value && Object.hasOwn(value, 'members'));
    const expectedKeys = hasClientMembers && this.faults.has('accept_client_membership')
      ? ['executionIntentKey', 'selection', 'members']
      : ['executionIntentKey', 'selection'];
    if (!value || !exactKeys(value, expectedKeys)
      || typeof value.executionIntentKey !== 'string' || value.executionIntentKey.length === 0) {
      return { kind: 'refused', refusalCode: null };
    }
    const selection = parseSelection(value.selection);
    if (!selection) return { kind: 'refused', refusalCode: null };
    const fingerprint = referenceOnlyRequestFingerprint({ projectId, selection });
    const intentId = `${projectId}:${value.executionIntentKey}`;
    const replay = this.executionIntents.get(intentId);
    if (replay) return replay.fingerprint === fingerprint
      ? { ...cloneValue(replay.result), ...(replay.result.kind === 'accepted' ? { replayed: true } : {}) } as StartResult
      : { kind: 'refused', refusalCode: null };
    const preflight = await this.preflightSuite(projectId, selection);
    if (preflight.kind !== 'accepted') {
      const result: StartResult = this.faults.has('ignore_stale_test_set') && preflight.refusalCode === 'stale_suite_authority'
        ? await this.acceptExecution(projectId, selection)
        : { kind: 'refused', refusalCode: preflight.refusalCode };
      this.executionIntents.set(intentId, { fingerprint, result: cloneValue(result) });
      if (this.faults.has('synthesize_product_result') && result.kind === 'refused') {
        const executionId = this.synthesizeResult(projectId, selection);
        return executionId ? { kind: 'accepted', executionId, replayed: false } : result;
      }
      return result;
    }
    const result = await this.acceptExecution(projectId, selection);
    this.executionIntents.set(intentId, { fingerprint, result: cloneValue(result) });
    return result;
  }

  public async readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null> {
    const stored = this.executions.get(executionId);
    if (stored?.observation.projectId !== projectId) return null;
    const observation = cloneValue(stored.observation);
    if (this.faults.has('substitute_execution_suite_hash')) observation.suite.suiteContentHash = '7'.repeat(64);
    if (this.faults.has('drop_execution_suite_hash')) observation.suite.suiteContentHash = '';
    return observation;
  }

  public async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    const stored = this.executions.get(executionId);
    if (!stored || stored.observation.projectId !== projectId) return null;
    const results = cloneValue(stored.results);
    if (this.faults.has('drop_suite_provenance') && results.suite) results.suite.provenance = null;
    if (this.faults.has('drop_results_suite_hash') && results.suite) results.suite.suiteContentHash = '';
    if (this.faults.has('substitute_results_suite_hash') && results.suite) results.suite.suiteContentHash = '5'.repeat(64);
    if ((this.faults.has('current_head_name_in_results') || this.faults.has('results_from_current_head')) && results.suite) {
      const head = this.suites.get(results.suite.suiteId)?.at(-1);
      if (head) {
        results.suite.name = head.name;
        if (this.faults.has('results_from_current_head')) {
          results.suite.suiteRevision = head.revision;
          results.suite.suiteContentHash = head.contentHash;
          results.suite.provenance = cloneValue(head.provenance);
        }
      }
    }
    if (this.faults.has('current_head_hash_in_results') && results.suite) {
      const head = this.suites.get(results.suite.suiteId)?.at(-1);
      if (head) results.suite.suiteContentHash = head.contentHash;
    }
    if (this.faults.has('confuse_legacy_suite_field')) {
      results.legacyTestResultsSuite = 'Checkout Sanity';
      results.suite = null;
    }
    return results;
  }

  private validMembers(projectId: string, members: SuiteMember[]): boolean {
    const current = this.testSets.get(projectId);
    if (!current || members.some((member, index) => member.ordinal !== index + 1)
      || new Set(members.map(member => member.definitionAuthority.definitionId)).size !== members.length) return false;
    const expectedAuthority = authorityOf(current);
    return members.every(member => sameAuthority(member.definitionAuthority, expectedAuthority)
      && current.definitions.some(definition => definition.definitionId === member.definitionAuthority.definitionId));
  }

  private buildSuite(suiteId: string, revision: number, parsed: ParsedMutation): SavedSuite {
    let members = cloneValue(parsed.members);
    if (this.faults.has('reorder_members')) {
      members = [...members].reverse().map((member, index) => ({ ...member, ordinal: index + 1 }));
    }
    const base: Omit<SavedSuite, 'contentHash'> = {
      schemaVersion: 1,
      suiteId,
      projectId: parsed.projectId,
      revision,
      name: parsed.name,
      purpose: 'sanity',
      members,
      createdAt: `2026-08-25T18:${String(this.clockSequence++).padStart(2, '0')}:00.000Z`,
      provenance: referenceOnlyOpaqueSha256(`provenance:${suiteId}:${revision}:${parsed.changeIntentKey}`),
    };
    let contentHash = referenceOnlyOpaqueSha256(`suite-authority:${suiteId}:${revision}`);
    if (this.faults.has('reuse_hash_across_semantic_revision') && revision > 1) {
      contentHash = referenceOnlyOpaqueSha256(`suite-authority:${suiteId}:1`);
    }
    if (this.faults.has('invalid_suite_hash_shape')) contentHash = 'NOT-A-SHA256';
    return { ...base, contentHash };
  }

  private async acceptExecution(projectId: string, selection: SuiteSelection): Promise<StartResult> {
    const revisions = this.suites.get(selection.suiteId);
    const suite = this.faults.has('ignore_suite_revision')
      ? revisions?.at(-1)
      : revisions?.find(value => value.revision === selection.suiteRevision);
    const current = this.testSets.get(projectId);
    if (!suite || !current) return { kind: 'refused', refusalCode: null };
    this.executionSequence += 1;
    const executionId = `execution-${projectId}-${this.executionSequence}`;
    let manifest = suite.members.map(member => cloneValue(member.definitionAuthority));
    const firstAuthority = manifest[0]!;
    let testSetAuthority: TestSetAuthority = {
      testSetId: firstAuthority.testSetId,
      testSetRevision: firstAuthority.testSetRevision,
      definitionSchemaVersion: firstAuthority.definitionSchemaVersion,
      testSetContentHash: firstAuthority.testSetContentHash,
    };
    if (this.faults.has('float_to_newest_definitions')) {
      manifest = suite.members.map(member => authorityFrom(current, member.definitionAuthority.definitionId));
      testSetAuthority = authorityOf(current);
    }
    let snapshot: AcceptedSuiteSnapshot = {
      suiteId: suite.suiteId,
      suiteRevision: suite.revision,
      suiteContentHash: suite.contentHash,
      name: suite.name,
      purpose: suite.purpose,
      provenance: cloneValue(suite.provenance),
    };
    if (this.faults.has('suite_identity_content_mismatch')) {
      const other = [...this.suites.values()].map(values => values.at(-1)!).find(value => value.suiteId !== suite.suiteId);
      if (other) snapshot = { ...snapshot, name: other.name, suiteContentHash: other.contentHash, provenance: cloneValue(other.provenance) };
    }
    const items: ResultItem[] = [];
    let failed = false;
    for (const authority of manifest) {
      const definition = current.definitions.find(value => value.definitionId === authority.definitionId);
      if (failed || !definition) {
        items.push({ definitionId: authority.definitionId, state: 'no_result_observed', reasonCode: 'expected_result_missing' });
      } else {
        items.push({ definitionId: authority.definitionId, state: 'result_observed', outcome: definition.executionOutcome });
        failed = definition.executionOutcome === 'failed';
      }
    }
    const observedOutcomes = items.flatMap(item => item.state === 'result_observed' ? [item.outcome] : []);
    const headlineOutcome: ResultOutcome = observedOutcomes.includes('failed')
      ? 'failed'
      : items.some(item => item.state === 'no_result_observed') || observedOutcomes.includes('could_not_verify')
        ? 'could_not_verify'
        : 'passed';
    const observation: ExecutionObservation = {
      executionId,
      projectId,
      state: 'completed',
      selection: cloneValue(selection),
      suite: snapshot,
      testSetAuthority,
      manifest,
    };
    this.executions.set(executionId, {
      observation,
      results: { executionId, headlineOutcome, suite: cloneValue(snapshot), testSetAuthority, items },
    });
    return { kind: 'accepted', executionId, replayed: false };
  }

  private synthesizeResult(projectId: string, selection: SuiteSelection): string | null {
    const suite = this.suites.get(selection.suiteId)?.find(value => value.revision === selection.suiteRevision);
    const current = this.testSets.get(projectId);
    if (!suite || !current) return null;
    this.executionSequence += 1;
    const executionId = `synthetic-execution-${this.executionSequence}`;
    const snapshot: AcceptedSuiteSnapshot = {
      suiteId: suite.suiteId,
      suiteRevision: suite.revision,
      suiteContentHash: suite.contentHash,
      name: suite.name,
      purpose: suite.purpose,
      provenance: cloneValue(suite.provenance),
    };
    this.executions.set(executionId, {
      observation: {
        executionId,
        projectId,
        state: 'completed',
        selection,
        suite: snapshot,
        testSetAuthority: authorityOf(current),
        manifest: suite.members.map(member => member.definitionAuthority),
      },
      results: {
        executionId,
        headlineOutcome: 'passed',
        suite: snapshot,
        testSetAuthority: authorityOf(current),
        items: suite.members.map(member => ({ definitionId: member.definitionAuthority.definitionId, state: 'result_observed', outcome: 'passed' })),
      },
    });
    return executionId;
  }
}

export class DeliberatelyBrokenM2Adapter implements M2CertificationDriver {
  public readonly name = 'deliberately-broken-m2-product-adapter';
  public readonly authorityClass = 'product' as const;
  private readonly reference: ReferenceM2Driver;

  public constructor(fault: BrokenAdapterFault) {
    this.reference = new ReferenceM2Driver({ faults: [fault], name: `${this.name}:${fault}` });
  }

  public persistCanonicalTestSet(value: CanonicalTestSetFixture): Promise<void> { return this.reference.persistCanonicalTestSet(value); }
  public injectSuiteIntegrityFault(projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void> { return this.reference.injectSuiteIntegrityFault(projectId, suiteId, suiteRevision, fault); }
  public listCandidates(projectId: string): Promise<CandidateDefinition[]> { return this.reference.listCandidates(projectId); }
  public listSuites(projectId: string): Promise<SavedSuite[]> { return this.reference.listSuites(projectId); }
  public createSuite(request: unknown): Promise<MutationResult> { return this.reference.createSuite(request); }
  public readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult> { return this.reference.readSuite(projectId, suiteId, suiteRevision); }
  public reviseSuite(request: unknown): Promise<MutationResult> { return this.reference.reviseSuite(request); }
  public preflightSuite(projectId: string, value: SuiteSelection): Promise<SuitePreflight> { return this.reference.preflightSuite(projectId, value); }
  public startSuiteExecution(projectId: string, request: unknown): Promise<StartResult> { return this.reference.startSuiteExecution(projectId, request); }
  public readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null> { return this.reference.readExecution(projectId, executionId); }
  public readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> { return this.reference.readResults(projectId, executionId); }
}
