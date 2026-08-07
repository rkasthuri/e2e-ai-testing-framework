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
 * TD-UI-043 — the triage evidence-gate's own integrity. An app-bug verdict must
 * substantiate itself from the record: the gate-required evidence is now persisted
 * (was discarded on write). The gate (TD-063) still fires. The model that ANSWERED
 * and the real token cost are recorded (not CONFIG.model, not 0). node:test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parseResponse, withUsage, toTriageRow } from '../src/pipeline/ai-triage'
import { TRIAGE_CATEGORIES } from '../src/core/triage/taxonomy'
import { initDb, getDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { AiTriageRepository } from '../src/core/storage/repositories/AiTriageRepository'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-ui-043-'))
const test0 = { file: 'tests/checkout.spec.ts', testTitle: 'completes checkout', browserName: 'chromium' } as any
const appBugWithEvidence = JSON.stringify({
  verdict: TRIAGE_CATEGORIES.APP_BUG, evidence: 'HTTP 500 at /checkout step 3',
  reasoning: 'server error on submit', confidence: 'High', suggestedAction: 'fix the endpoint',
})

test('T1 app-bug WITH evidence → evidence carried through parseResponse and into the row verbatim', () => {
  const r = parseResponse(appBugWithEvidence, test0)
  assert.equal(r.verdict, TRIAGE_CATEGORIES.APP_BUG)
  assert.equal(r.evidence, 'HTTP 500 at /checkout step 3')
  const row = toTriageRow('run-1', r)
  assert.equal(row.evidence, 'HTTP 500 at /checkout step 3')   // persisted verbatim
})

test('T2 app-bug with EMPTY evidence → gate downgrades to insufficient-evidence (TD-063 still fires)', () => {
  const r = parseResponse(JSON.stringify({ verdict: TRIAGE_CATEGORIES.APP_BUG, evidence: '', reasoning: 'looks buggy' }), test0)
  assert.equal(r.verdict, TRIAGE_CATEGORIES.INSUFFICIENT_EVIDENCE)
  assert.notEqual(r.verdict, TRIAGE_CATEGORIES.APP_BUG)
})

test('T3 a persisted app-bug row can PROVE itself — read it back, the evidence is there', async () => {
  initDb(path.join(dir, 'forge.db'))
  await runMigrations()   // includes 014 (evidence column)
  const repo = new AiTriageRepository()
  const r = withUsage(parseResponse(appBugWithEvidence, test0), { model: 'claude-sonnet-4-5', inputTokens: 100, outputTokens: 330 })
  await repo.insert(toTriageRow('run-proof', r))

  const rows = await repo.findByRun('run-proof')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].failure_category, TRIAGE_CATEGORIES.APP_BUG)
  assert.equal(rows[0].evidence, 'HTTP 500 at /checkout step 3')   // the record substantiates its own verdict
})

test('T3b non-app-bug with no evidence → row.evidence is NULL (none required), not "" ', async () => {
  const repo = new AiTriageRepository()
  const r = parseResponse(JSON.stringify({ verdict: TRIAGE_CATEGORIES.TEST_DEFECT, evidence: '', reasoning: 'stale selector' }), test0)
  const row = toTriageRow('run-null', r)
  assert.equal(row.evidence, null, 'NULL honestly means "none required", never ""')
  await repo.insert(row)
  const rows = await repo.findByRun('run-null')
  assert.equal(rows[0].evidence, null)
})

test('T4 triage_model records the model that ANSWERED, not CONFIG.model', () => {
  // A local/fallback model answered instead of the configured claude-sonnet-4-5.
  const r = withUsage(parseResponse(appBugWithEvidence, test0), { model: 'ollama-local', inputTokens: 10, outputTokens: 20 })
  assert.equal(r.triageModel, 'ollama-local')
  assert.notEqual(r.triageModel, 'claude-sonnet-4-5')          // NOT the configured model
  assert.equal(toTriageRow('run-1', r).triage_model, 'ollama-local')
})

test('T5 tokens_used is the real count (input+output), not 0', () => {
  const r = withUsage(parseResponse(appBugWithEvidence, test0), { model: 'claude-sonnet-4-5', inputTokens: 100, outputTokens: 330 })
  assert.equal(r.tokensUsed, 430)
  assert.equal(toTriageRow('run-1', r).tokens_used, 430)
  closeDb()
})
