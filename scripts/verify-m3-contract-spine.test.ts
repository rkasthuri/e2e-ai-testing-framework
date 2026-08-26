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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import Ajv from 'ajv';

const CONTRACT_ROOT = path.resolve(__dirname, '..', 'fixtures', 'm3-contract');
const SCHEMA_PATH = path.join(CONTRACT_ROOT, 'contract.schema.json');
const MANIFEST_PATH = path.join(CONTRACT_ROOT, 'fixture-manifest.json');
const REFUSAL_FILES = Object.freeze([
  'unsupported-fill.json',
  'ambiguous-control.json',
  'insufficient-outcome.json',
  'app-area-unknown.json',
] as const);
const FIXTURE_FILES = Object.freeze([
  'positive-manual-source.json',
  'positive-automation-proposal.json',
  'positive-save-result.json',
  ...REFUSAL_FILES,
] as const);
const REFUSAL_CODES = Object.freeze([
  'insufficient_evidence',
  'ambiguous_evidence',
  'unsupported_semantics',
  'app_area_unknown',
] as const);

type JsonObject = Record<string, unknown>;

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function fixture(fileName: string): JsonObject {
  return object(loadJson(path.join(CONTRACT_ROOT, fileName)), fileName);
}

function object(value: unknown, label: string): JsonObject {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value;
}

function sourceGrounding(value: JsonObject): JsonObject[] {
  return array(value.sourceGrounding, 'sourceGrounding').map((item, index) =>
    object(item, `sourceGrounding[${index}]`));
}

function refusal(fileName: string): JsonObject {
  const result = fixture(fileName);
  const outcome = object(result.outcome, `${fileName} outcome`);
  assert.equal(outcome.kind, 'refusal');
  return object(outcome.refusal, `${fileName} refusal`);
}

function assertGroundingCoverage(grounding: JsonObject[], sourceStepCount: number): void {
  assert.equal(grounding.length, sourceStepCount + 1);
  for (let index = 0; index < sourceStepCount; index += 1) {
    assert.deepEqual(grounding[index]?.sourceRef, {
      kind: 'step',
      ordinal: index + 1,
    });
  }
  assert.deepEqual(grounding[sourceStepCount]?.sourceRef, {
    kind: 'expected_outcome',
  });
}

function collectSchemaVersions(value: unknown, versions = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaVersions(item, versions);
    return versions;
  }
  if (typeof value !== 'object' || value === null) return versions;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'schemaVersion' && typeof child === 'string') versions.add(child);
    collectSchemaVersions(child, versions);
  }
  return versions;
}

function findNamedFiles(root: string, names: ReadonlySet<string>): string[] {
  const matches: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findNamedFiles(entryPath, names));
    } else if (names.has(entry.name)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

describe('M3 frozen shared Contract Spine', () => {
  test('the manifest names exactly seven fixtures and every fixture validates against Draft-07', () => {
    const manifest = object(loadJson(MANIFEST_PATH), 'fixture manifest');
    assert.equal(manifest.schema, 'contract.schema.json');
    const entries = array(manifest.fixtures, 'fixture manifest entries').map((entry, index) =>
      object(entry, `fixture manifest entry ${index}`));
    assert.deepEqual(entries.map(entry => entry.file), [...FIXTURE_FILES]);

    const schema = object(loadJson(SCHEMA_PATH), 'contract schema');
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
    for (const fileName of FIXTURE_FILES) {
      const value = fixture(fileName);
      assert.equal(
        validate(value),
        true,
        `${fileName}: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
  });

  test('manual source strings and contiguous one-based ordinals remain exact', () => {
    const source = fixture('positive-manual-source.json');
    assert.deepEqual(source, {
      schemaVersion: 'forge-manual-test-source/v1',
      sourceId: 'manual-source-checkout-cart-01',
      projectId: 'project-storefront',
      sourceKind: 'manual',
      title: 'Checkout from cart',
      objective: 'Proceed from cart to checkout.',
      steps: [
        { ordinal: 1, text: 'Open the cart page.' },
        { ordinal: 2, text: 'Click the Checkout button.' },
      ],
      expectedOutcome: 'Checkout information page is displayed.',
      contentHash: 'a'.repeat(64),
    });
    const steps = array(source.steps, 'manual source steps').map((step, index) =>
      object(step, `manual source step ${index}`));
    assert.deepEqual(steps.map(step => step.ordinal), [1, 2]);
    assert.ok(steps.every((step, index) => step.ordinal === index + 1));
  });

  test('positive proposal preserves source, app-area, action, oracle, and authentication authority', () => {
    const source = fixture('positive-manual-source.json');
    const proposal = fixture('positive-automation-proposal.json');
    const intent = object(proposal.normalizedIntent, 'normalizedIntent');
    const sourceAuthority = object(proposal.sourceAuthority, 'proposal sourceAuthority');
    assert.deepEqual(sourceAuthority, {
      sourceId: source.sourceId,
      sourceContentHash: source.contentHash,
    });
    assert.equal(proposal.projectId, source.projectId);
    assert.equal(intent.projectId, source.projectId);
    assert.equal(intent.source, 'manual');
    assert.deepEqual(proposal.appArea, intent.appArea);
    assert.equal(typeof proposal.appArea, 'object');
    assert.deepEqual(proposal.canonicalActions, intent.steps);

    const actions = array(proposal.canonicalActions, 'canonicalActions').map((action, index) =>
      object(action, `canonicalActions[${index}]`));
    assert.deepEqual(actions.map(action => action.ordinal), [0, 1]);
    assert.deepEqual(actions.map(action => action.kind), [
      'navigate_to_observed_route',
      'click_observed_data_test',
    ]);

    const expectedOutcome = object(
      array(intent.expectedOutcomes, 'normalized expectedOutcomes')[0],
      'normalized expected outcome',
    );
    const oracle = object(proposal.oracle, 'proposal oracle');
    assert.deepEqual(
      {
        kind: oracle.kind,
        subjectId: oracle.subjectId,
        routePath: oracle.routePath,
      },
      {
        kind: expectedOutcome.kind,
        subjectId: expectedOutcome.subjectId,
        routePath: expectedOutcome.routePath,
      },
    );
    const authority = object(proposal.authority, 'proposal authority');
    const authentication = object(proposal.authenticationExpectation, 'authenticationExpectation');
    assert.equal(authentication.identityHash, authority.authenticationExpectationIdentityHash);
    assert.equal(proposal.disposition && object(proposal.disposition, 'disposition').state, 'supported');
  });

  test('source grounding covers every source ref and preserves route, flow-step, and subject distinctions', () => {
    const source = fixture('positive-manual-source.json');
    const proposal = fixture('positive-automation-proposal.json');
    const positiveGrounding = sourceGrounding(proposal);
    assertGroundingCoverage(positiveGrounding, array(source.steps, 'source steps').length);
    assert.ok(positiveGrounding.every(item => item.status === 'grounded'));

    const normalized = object(proposal.normalizedIntent, 'normalizedIntent');
    const normalizedGrounding = object(normalized.grounding, 'normalized grounding');
    const observedFlowIndexes = new Set(
      array(normalizedGrounding.selectedFlowStepIndexes, 'selected flow step indexes'),
    );
    for (const item of positiveGrounding) {
      const binding = item.canonicalBinding === null
        ? null
        : object(item.canonicalBinding, 'canonical binding');
      const basis = object(item.basis, 'grounding basis');
      if (binding?.kind === 'action' && binding.ordinal === 0) {
        assert.equal(basis.kind, 'governed_route');
        assert.equal(basis.flowStepIndex, null);
      }
      if (binding?.kind === 'action' && binding.ordinal === 1) {
        assert.equal(basis.kind, 'observed_flow_step');
        assert.equal(observedFlowIndexes.has(basis.flowStepIndex), true);
      }
      if (binding?.kind === 'oracle') {
        assert.equal(basis.kind, 'governed_subject');
        assert.equal(basis.flowStepIndex, null);
      }
    }

    const negativeStepCounts: Readonly<Record<string, number>> = {
      'unsupported-fill.json': 3,
      'ambiguous-control.json': 2,
      'insufficient-outcome.json': 2,
      'app-area-unknown.json': 2,
    };
    for (const fileName of REFUSAL_FILES) {
      assertGroundingCoverage(
        sourceGrounding(refusal(fileName)),
        negativeStepCounts[fileName],
      );
    }
  });

  test('the four refusal fixtures freeze only the four public codes and contain no proposal or Definition authority', () => {
    const expectedByFile: Readonly<Record<string, string>> = {
      'unsupported-fill.json': 'unsupported_semantics',
      'ambiguous-control.json': 'ambiguous_evidence',
      'insufficient-outcome.json': 'insufficient_evidence',
      'app-area-unknown.json': 'app_area_unknown',
    };
    const forbiddenKeys = new Set([
      'proposal',
      'proposalId',
      'proposalAuthority',
      'proposalContentHash',
      'definitionAuthority',
      'definitionId',
      'definitionSchemaVersion',
      'testSetId',
      'testSetRevision',
      'testSetContentHash',
      'normalizedIntent',
      'canonicalActions',
    ]);
    const observedCodes: string[] = [];
    for (const fileName of REFUSAL_FILES) {
      const value = fixture(fileName);
      const refused = refusal(fileName);
      assert.equal(refused.code, expectedByFile[fileName]);
      observedCodes.push(String(refused.code));
      const serialized = JSON.stringify(value);
      for (const key of forbiddenKeys) {
        assert.equal(serialized.includes(`\"${key}\"`), false, `${fileName} contains ${key}`);
      }
    }
    assert.deepEqual([...observedCodes].sort(), [...REFUSAL_CODES].sort());

    const unsupported = sourceGrounding(refusal('unsupported-fill.json'));
    assert.equal(unsupported[1]?.status, 'unsupported_semantics');
    assert.equal(unsupported[1]?.canonicalBinding, null);
    const ambiguous = sourceGrounding(refusal('ambiguous-control.json'));
    assert.equal(ambiguous[1]?.status, 'ambiguous_evidence');
    assert.equal(ambiguous[1]?.canonicalBinding, null);
    const insufficient = sourceGrounding(refusal('insufficient-outcome.json'));
    assert.equal(insufficient[2]?.status, 'insufficient_evidence');
    assert.equal(insufficient[2]?.canonicalBinding, null);
    assert.ok(sourceGrounding(refusal('app-area-unknown.json')).every(item => item.status === 'grounded'));
  });

  test('save authority and all frozen schema discriminators remain exact', () => {
    const source = fixture('positive-manual-source.json');
    const proposal = fixture('positive-automation-proposal.json');
    const save = fixture('positive-save-result.json');
    assert.deepEqual(save.sourceAuthority, {
      sourceId: source.sourceId,
      sourceContentHash: source.contentHash,
    });
    assert.deepEqual(save.proposalAuthority, {
      proposalId: proposal.proposalId,
      proposalContentHash: proposal.proposalContentHash,
    });
    assert.deepEqual(save.definitionAuthority, {
      definitionId: 'test-v3-flow-manual-checkout-cart',
      definitionSchemaVersion: 3,
      testSetId: 'test-set-v3-project-storefront',
      testSetRevision: 8,
      testSetContentHash: '8'.repeat(64),
    });

    const versions = new Set<string>();
    for (const fileName of FIXTURE_FILES) {
      collectSchemaVersions(fixture(fileName), versions);
    }
    for (const required of [
      'forge-manual-test-source/v1',
      'forge-normalized-test-intent/v1',
      'forge-manual-automation-proposal/v1',
      'forge-manual-automation-refusal/v1',
      'forge-manual-analysis-result/v1',
      'forge-manual-promotion-result/v1',
    ]) {
      assert.equal(versions.has(required), true, required);
    }

    const schema = object(loadJson(SCHEMA_PATH), 'contract schema');
    const definitions = object(schema.definitions, 'schema definitions');
    const refusalSchema = object(definitions.ManualAutomationRefusalV1, 'refusal schema');
    const refusalProperties = object(refusalSchema.properties, 'refusal schema properties');
    const codeSchema = object(refusalProperties.code, 'refusal code schema');
    assert.deepEqual(array(codeSchema.enum, 'refusal code enum').sort(), [...REFUSAL_CODES].sort());
  });

  test('hashes and IDs are opaque literals and no Core or UI stream carries a fixture copy', () => {
    const source = fixture('positive-manual-source.json');
    const proposal = fixture('positive-automation-proposal.json');
    const save = fixture('positive-save-result.json');
    const authority = object(proposal.authority, 'proposal authority');
    const definition = object(save.definitionAuthority, 'definition authority');
    assert.deepEqual(
      [
        source.contentHash,
        proposal.normalizedIntentContentHash,
        proposal.proposalContentHash,
        authority.supportSealHash,
        authority.routeEvidenceIdentityHash,
        authority.authenticationExpectationIdentityHash,
        definition.testSetContentHash,
      ],
      [
        'a'.repeat(64),
        '9'.repeat(64),
        'b'.repeat(64),
        'c'.repeat(64),
        'd'.repeat(64),
        'e'.repeat(64),
        '8'.repeat(64),
      ],
    );
    assert.equal(proposal.proposalId, 'manual-proposal-checkout-cart-01');

    const fixtureNames = new Set<string>(FIXTURE_FILES);
    const copies = [
      path.resolve(__dirname, '..', 'src'),
      path.resolve(__dirname, '..', 'forge-ui'),
    ].flatMap(root => findNamedFiles(root, fixtureNames));
    assert.deepEqual(copies, []);
  });
});
