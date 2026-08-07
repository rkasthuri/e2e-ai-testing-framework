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

/**
 * Behavioral proof for current-run CI triage evidence and fail-closed merge safety.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import {
  evaluateCiTriageEvidence,
  readCiTriageEvidence,
  writeCiDecisionOutputs,
} from '../src/pipeline/ai-triage';

const RUN_ID = '2026-07-29T12-00-00';
const REPO_ROOT = path.resolve(__dirname, '..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TRIAGE_CLI = path.join(REPO_ROOT, 'src', 'pipeline', 'ai-triage.ts');

function summary(overrides: Partial<Record<string, number>> = {}) {
  return {
    'app-bug': 0,
    'test-defect': 0,
    'infra-defect': 0,
    flaky: 0,
    'insufficient-evidence': 0,
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    runId: RUN_ID,
    inputHealth: 'healthy',
    inputHealthReason: null,
    runTimestamp: '2026-07-29T12:01:00.000Z',
    totalTests: 10,
    totalFailed: 0,
    summary: summary(),
    results: [],
    ...overrides,
  };
}

function inTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ci-evidence-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('A: valid current-run zero-failure evidence reports PASS with genuine positive claims', () => {
  const decision = evaluateCiTriageEvidence(report(), RUN_ID);
  assert.equal(decision.state, 'PASS');
  assert.equal(decision.counts?.failed, 0);
  assert.match(decision.statusMessage, /All tests passed/);
  assert.match(decision.mergeMessage, /Pipeline healthy.*safe to merge/);
});

test('valid current-run failure evidence reports FAIL without a positive merge claim', () => {
  const decision = evaluateCiTriageEvidence(report({
    totalFailed: 1,
    summary: summary({ 'test-defect': 1 }),
    results: [{}],
  }), RUN_ID);
  assert.equal(decision.state, 'FAIL');
  assert.equal(decision.counts?.failed, 1);
  assert.match(decision.statusMessage, /1 failure/);
  assert.doesNotMatch(decision.mergeMessage, /safe to merge/i);
});

test('B: missing report is BLOCKED and never fabricates zero counts', () => {
  inTempDir(dir => {
    const decision = readCiTriageEvidence(path.join(dir, 'missing.json'), RUN_ID);
    assert.equal(decision.state, 'BLOCKED');
    assert.equal(decision.counts, null);
    assert.match(decision.reason, /missing/);
  });
});

test('empty report is BLOCKED', () => {
  inTempDir(dir => {
    const file = path.join(dir, 'triage.json');
    fs.writeFileSync(file, '', 'utf-8');
    const decision = readCiTriageEvidence(file, RUN_ID);
    assert.equal(decision.state, 'BLOCKED');
    assert.match(decision.reason, /empty/);
  });
});

test('D: malformed JSON is BLOCKED', () => {
  inTempDir(dir => {
    const file = path.join(dir, 'triage.json');
    fs.writeFileSync(file, '{bad-json', 'utf-8');
    const decision = readCiTriageEvidence(file, RUN_ID);
    assert.equal(decision.state, 'BLOCKED');
    assert.match(decision.reason, /malformed JSON/);
  });
});

test('unreadable report is BLOCKED with the read failure reason', () => {
  inTempDir(dir => {
    const file = path.join(dir, 'triage.json');
    fs.writeFileSync(file, '{}', 'utf-8');
    const decision = readCiTriageEvidence(file, RUN_ID, () => {
      throw new Error('EACCES: permission denied');
    });
    assert.equal(decision.state, 'BLOCKED');
    assert.match(decision.reason, /unreadable.*EACCES/);
  });
});

test('missing run ID provenance is BLOCKED', () => {
  const candidate = report();
  delete (candidate as { runId?: string }).runId;
  const decision = evaluateCiTriageEvidence(candidate, RUN_ID);
  assert.equal(decision.state, 'BLOCKED');
  assert.match(decision.reason, /missing required CURRENT_RUN_ID provenance/);
});

test('C: prior-run ID is rejected as stale evidence', () => {
  const decision = evaluateCiTriageEvidence(report({ runId: 'prior-run' }), RUN_ID);
  assert.equal(decision.state, 'BLOCKED');
  assert.match(decision.reason, /stale.*prior-run/);
});

test('unhealthy input cannot emit All tests passed', () => {
  const decision = evaluateCiTriageEvidence(report({
    inputHealth: 'unknown',
    inputHealthReason: 'missing-provenance',
  }), RUN_ID);
  assert.equal(decision.state, 'BLOCKED');
  assert.doesNotMatch(decision.statusMessage, /All tests passed/);
});

test('BLOCKED cannot emit safe-to-merge or other positive merge claims', () => {
  const decision = evaluateCiTriageEvidence({}, RUN_ID);
  assert.equal(decision.state, 'BLOCKED');
  assert.doesNotMatch(decision.mergeMessage, /safe to merge/i);
  assert.doesNotMatch(decision.mergeMessage, /Pipeline healthy/i);
  assert.match(decision.mergeMessage, /cannot be established/);
});

test('PASS retains genuine positive reporting behavior', () => {
  const decision = evaluateCiTriageEvidence(report(), RUN_ID);
  assert.equal(decision.state, 'PASS');
  assert.match(`${decision.statusMessage} ${decision.mergeMessage}`, /All tests passed/);
  assert.match(`${decision.statusMessage} ${decision.mergeMessage}`, /safe to merge/);
});

test('BLOCKED GitHub outputs use unavailable, never numeric zero', () => {
  inTempDir(dir => {
    const output = path.join(dir, 'github-output.txt');
    writeCiDecisionOutputs(output, evaluateCiTriageEvidence({}, RUN_ID));
    const text = fs.readFileSync(output, 'utf-8');
    assert.match(text, /^decision=BLOCKED$/m);
    assert.match(text, /^failed=unavailable$/m);
    assert.doesNotMatch(text, /^failed=0$/m);
  });
});

test('existing honest application-failure warning remains intact', () => {
  const decision = evaluateCiTriageEvidence(report({
    totalFailed: 1,
    summary: summary({ 'app-bug': 1 }),
    results: [{}],
  }), RUN_ID);
  assert.equal(decision.state, 'FAIL');
  assert.match(decision.mergeMessage, /Application defect.*before merging/);
  assert.doesNotMatch(decision.mergeMessage, /safe to merge/i);
});

test('resource exhaustion evidence remains BLOCKED without fabricated execution claims', () => {
  const decision = evaluateCiTriageEvidence(report({
    inputHealth: 'invalid',
    inputHealthReason: 'worker creation exhaustion: spawn ENOMEM',
    totalTests: null,
    totalFailed: null,
    summary: null,
    results: null,
  }), RUN_ID);
  const claims = `${decision.statusMessage} ${decision.mergeMessage}`;

  assert.equal(decision.state, 'BLOCKED');
  assert.notEqual(decision.state, 'PASS');
  assert.notEqual(decision.state, 'FAIL');
  assert.equal(decision.counts, null);
  assert.match(decision.reason, /ENOMEM/);
  assert.doesNotMatch(claims, /All tests passed/i);
  assert.doesNotMatch(claims, /Pipeline healthy/i);
  assert.doesNotMatch(claims, /safe to merge/i);
});

function runDecisionCli(
  dir: string,
  evidence: unknown | string,
  expectedRunId = RUN_ID,
) {
  const reportPath = path.join(dir, 'triage-report.json');
  const outputPath = path.join(dir, 'github-output.txt');
  fs.writeFileSync(
    reportPath,
    typeof evidence === 'string' ? evidence : JSON.stringify(evidence),
    'utf-8',
  );
  const result = spawnSync(process.execPath, [
    TSX_CLI,
    TRIAGE_CLI,
    '--ci-decision',
    `--report=${reportPath}`,
    `--expected-run-id=${expectedRunId}`,
    `--github-output=${outputPath}`,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, CURRENT_RUN_ID: expectedRunId },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf-8') : '',
  };
}

test('actual CLI dispatch exits zero and emits PASS plus positive claims for current green evidence', () => {
  inTempDir(dir => {
    const result = runDecisionCli(dir, report());
    const emitted = `${result.stdout}\n${result.stderr}\n${result.output}`;

    assert.equal(result.status, 0, emitted);
    assert.match(result.stdout, /\[ci-reporting\] decision=PASS/);
    assert.match(result.output, /^decision=PASS$/m);
    assert.match(result.output, /^failed=0$/m);
    assert.match(emitted, /All tests passed/);
    assert.match(emitted, /Pipeline healthy.*safe to merge/);
  });
});

test('actual CLI dispatch exits non-zero for resource-blocked evidence and suppresses positive claims', () => {
  inTempDir(dir => {
    const result = runDecisionCli(dir, report({
      inputHealth: 'invalid',
      inputHealthReason: 'allocation failure: ENOMEM',
    }));
    const emitted = `${result.stdout}\n${result.stderr}\n${result.output}`;

    assert.equal(result.status, 1, emitted);
    assert.match(result.stdout, /\[ci-reporting\] decision=BLOCKED/);
    assert.match(result.output, /^decision=BLOCKED$/m);
    assert.match(result.output, /^failed=unavailable$/m);
    assert.doesNotMatch(result.output, /^failed=0$/m);
    assert.doesNotMatch(emitted, /All tests passed/i);
    assert.doesNotMatch(emitted, /Pipeline healthy/i);
    assert.doesNotMatch(emitted, /safe to merge/i);
    assert.doesNotMatch(emitted, /decision=FAIL/);
  });
});

test('actual CLI dispatch rejects malformed and stale evidence fail-closed', () => {
  for (const [label, evidence] of [
    ['malformed', '{not-json'],
    ['stale', report({ runId: 'prior-run' })],
  ] as const) {
    inTempDir(dir => {
      const result = runDecisionCli(dir, evidence);
      const emitted = `${result.stdout}\n${result.stderr}\n${result.output}`;

      assert.equal(result.status, 1, `${label}: ${emitted}`);
      assert.match(result.output, /^decision=BLOCKED$/m);
      assert.match(result.output, /^failed=unavailable$/m);
      assert.doesNotMatch(emitted, /All tests passed|Pipeline healthy|safe to merge/i);
      assert.doesNotMatch(emitted, /decision=PASS|decision=FAIL/);
    });
  }
});