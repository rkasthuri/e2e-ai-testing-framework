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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { initDb, closeDb, getDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { TestSetRepository, DuplicateTestGenerationError } from '../src/core/storage/repositories/TestSetRepository'
import { TestSetService } from '../src/core/storage/TestSetService'
import {
  generateEvidenceBackedTestSet,
  materializeCanonicalTestSet,
  TestDefinitionContractError,
  type TestDesignAuthorityInput,
} from '../src/core/test-design/TestDefinitionContract'
import { EvidenceBackedTestInventory } from '../forge-ui/src/pages/TestCasesPage'
import { TestCasePresentationService } from '../src/core/test-design/TestCasePresentationService'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const subjects = ['inventory-html', 'inventory-item-html', 'cart-html', 'checkout-step-one-html']
const routes = ['/inventory.html', '/inventory-item.html', '/cart.html', '/checkout-step-one.html']
const evidenceIds = subjects.map((_, index) => `${observationId}-page-${index + 1}`)

function fixture(): TestDesignAuthorityInput {
  return {
    projectId: 'saucedemo',
    sourceObservation: {
      id: observationId, outcome: 'completed', authenticationOutcome: 'succeeded',
      authenticationExpectation: 'form-login', credentialReference: { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' },
      subjectIds: [...subjects],
    },
    model: {
      rowId: 7, version: '1.0.6', sourceObservationId: observationId, validation: 'valid', integrity: 'not_evaluated',
      subjects: subjects.map((id, index) => ({ id, routePath: routes[index], evidenceId: evidenceIds[index] })),
    },
    evidence: subjects.map((canonicalSubjectId, index) => ({
      id: evidenceIds[index], canonicalSubjectId, routePath: routes[index], sourceObservationId: observationId,
      sourceModelRows: [7], support: 'current', integrity: 'not_evaluated', freshness: 'not_evaluated',
      access: 'available', conflict: 'not_evaluated',
    })),
    generatedAt: '2026-08-07T12:00:00.000Z',
  }
}

test('deterministic generation creates stable identities and exact four-way provenance', () => {
  const first = generateEvidenceBackedTestSet(fixture(), 'generation-one', 1)
  const second = generateEvidenceBackedTestSet(fixture(), 'generation-two', 2)
  assert.equal(first.value.definitions.length, 4)
  assert.deepEqual(first.value.definitions.map(item => item.id), second.value.definitions.map(item => item.id))
  assert.deepEqual(first.value.definitions.map(item => item.canonicalSubjects[0]), [...subjects].sort())
  for (const definition of first.value.definitions) {
    assert.equal(definition.provenance.sourceObservationId, observationId)
    assert.equal(definition.provenance.modelRowId, 7)
    assert.equal(definition.provenance.modelVersion, '1.0.6')
    assert.equal(definition.provenance.supportingEvidenceIds.length, 1)
    // TD-UI-069C-C-R: the fixture supplies complete, real-shaped auth
    // evidence (form-login + a recorded credential reference), so the
    // shared compatibility evaluator now truthfully reports 'compatible' —
    // no longer the structurally-forced 'blocked' of pre-069C-C-R.
    assert.equal(definition.runnerCompatibility.state, 'compatible')
    assert.ok(!('reason' in definition.runnerCompatibility))
  }
  assert.equal(first.value.outcome, 'partially_completed')
  assert.equal(first.value.coverage, 'unknown')
  assert.equal(first.value.freshness, 'not_evaluated')
})

test('missing, historical, or mismatched current support fails closed', () => {
  const missing = fixture(); missing.evidence = []
  assert.throws(() => generateEvidenceBackedTestSet(missing, 'missing-evidence', 1), TestDefinitionContractError)
  const historical = fixture(); (historical.evidence[0] as any).support = 'historical'
  assert.throws(() => generateEvidenceBackedTestSet(historical, 'historical-evidence', 1), TestDefinitionContractError)
  const mismatch = fixture(); mismatch.evidence[0].sourceObservationId = 'foreign-observation'
  assert.throws(() => generateEvidenceBackedTestSet(mismatch, 'mismatched-evidence', 1), TestDefinitionContractError)
})

test('unsupported selector, action, and oracle changes are rejected before persistence', () => {
  const materialized = generateEvidenceBackedTestSet(fixture(), 'unsupported-definition', 1)
  const action = structuredClone(materialized.value) as any; action.definitions[0].steps[0].kind = 'click_selector'; action.definitions[0].steps[0].selector = '#invented'
  assert.throws(() => materializeCanonicalTestSet(action), TestDefinitionContractError)
  const oracle = structuredClone(materialized.value) as any; oracle.definitions[0].oracle.kind = 'text_equals'; oracle.definitions[0].oracle.expected = 'invented'
  assert.throws(() => materializeCanonicalTestSet(oracle), TestDefinitionContractError)
})

test('canonical payload excludes credential VALUES, raw content, execution, pass, and completeness claims', () => {
  const payload = generateEvidenceBackedTestSet(fixture(), 'safe-payload', 1).json
  // TD-UI-069C-C: env-var-NAME references (SAUCEDEMO_USERNAME/PASSWORD) are now
  // deliberately carried as authenticationSetup.credentialReference — that is
  // the whole point of a non-secret reference. What must still never appear is
  // an actual credential VALUE — SauceDemo's real, well-known demo login pair.
  for (const forbidden of ['standard_user', 'secret_sauce', 'password=', 'cookie', 'rawHtml', 'model_json', 'passed', 'fully covered', 'complete application']) {
    assert.doesNotMatch(payload, new RegExp(forbidden, 'i'))
  }
  assert.match(payload, /Definitions were not executed/)
  // The reference itself is expected to be present — proves the field is wired,
  // not merely absent-and-untested.
  assert.match(payload, /SAUCEDEMO_USERNAME/)
  assert.match(payload, /SAUCEDEMO_PASSWORD/)
})

test('SQLite revision commit is atomic, immutable, and restart-readable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-'))
  const dbPath = path.join(root, 'forge.db')
  initDb(dbPath)
  try {
    await runMigrations()
    const repository = new TestSetRepository()
    const service = new TestSetService(repository, () => '2026-08-07T12:00:00.000Z')
    const committed = await service.generate(fixture(), 'persisted-generation-one')
    assert.equal(committed.testSet.revision, 1)
    let inventory = await repository.readInventory('saucedemo')
    assert.ok(!('kind' in inventory))
    if ('kind' in inventory) throw new Error('unexpected cursor result')
    assert.equal(inventory.total, 1)
    assert.equal(inventory.current?.testSet.definitions.length, 4)
    assert.equal(inventory.current?.contentHash, committed.contentHash)
    const status = await repository.readGenerationStatus('saucedemo', 'persisted-generation-one', 'new-process')
    assert.equal(status?.state, 'partially_completed')
    assert.equal(status?.complete, true)
    assert.ok(Date.parse(status!.completedAt!) >= Date.parse(status!.startedAt), 'terminal time must not precede started time')

    const invalid = fixture(); invalid.evidence[0].sourceObservationId = 'foreign-observation'
    await assert.rejects(() => service.generate(invalid, 'failed-generation'), TestDefinitionContractError)
    inventory = await repository.readInventory('saucedemo')
    assert.ok(!('kind' in inventory))
    if ('kind' in inventory) throw new Error('unexpected cursor result')
    assert.equal(inventory.total, 1, 'failed generation must not insert a partial revision')
    assert.equal((await repository.readGenerationStatus('saucedemo', 'failed-generation', 'new-process'))?.state, 'failed')

    await repository.beginGeneration('saucedemo', 'interrupted-generation', 'old-process', '2026-08-07T13:00:00.000Z')
    const interrupted = await repository.readGenerationStatus('saucedemo', 'interrupted-generation', 'new-process')
    assert.equal(interrupted?.state, 'interrupted')
    assert.equal(interrupted?.complete, true)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the service owns one lifecycle timestamp even when controller input predates persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-clock-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const serviceTime = '2026-08-07T14:00:00.000Z'
    const input = fixture()
    input.generatedAt = '2026-08-07T13:59:00.000Z'
    const service = new TestSetService(new TestSetRepository(), () => serviceTime)
    const committed = await service.generate(input, 'clock-owned-generation')
    const status = await service.readGenerationStatus('saucedemo', 'clock-owned-generation')
    assert.equal(committed.testSet.generatedAt, serviceTime)
    assert.equal(status?.startedAt, serviceTime)
    assert.equal(status?.completedAt, serviceTime)
  } finally { await closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('duplicate active generation is rejected without a second started event', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-duplicate-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const repository = new TestSetRepository()
    await repository.beginGeneration('saucedemo', 'first-active', 'same-process', '2026-08-07T12:00:00.000Z')
    await assert.rejects(() => repository.beginGeneration('saucedemo', 'second-active', 'same-process', '2026-08-07T12:00:01.000Z'), DuplicateTestGenerationError)
    assert.equal(await repository.readGenerationStatus('saucedemo', 'second-active', 'same-process'), null)
  } finally { await closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('persisted reversed lifecycle timestamps remain immutable but fail temporal integrity safely', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-temporal-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const repository = new TestSetRepository()
    await repository.beginGeneration('saucedemo', 'temporal-generation', 'old-process', '2026-08-07T15:00:01.000Z')
    await getDb().insertInto('test_generation_events').values({
      generation_id: 'temporal-generation', project_id: 'saucedemo', event_type: 'terminal', outcome: 'partially_completed',
      occurred_at: '2026-08-07T15:00:00.000Z', process_instance_id: 'old-process', test_set_row_id: null,
      safe_code: null, safe_message: 'Earlier terminal event fixture.',
    }).execute()
    const status = await repository.readGenerationStatus('saucedemo', 'temporal-generation', 'new-process')
    assert.equal(status?.state, 'partially_completed')
    assert.equal(status?.temporalIntegrity, 'failed')
    assert.equal(status?.safeCode, 'GENERATION_TIMESTAMP_INCONSISTENT')
    assert.doesNotMatch(status?.explanation ?? '', /fixture|sqlite|database/i)
  } finally { await closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('cursor is bounded to project, page size, and deterministic revision ordering', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-cursor-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const service = new TestSetService(new TestSetRepository(), () => '2026-08-07T12:00:00.000Z')
    await service.generate(fixture(), 'page-generation-one')
    await service.generate({ ...fixture(), generatedAt: '2026-08-07T12:01:00.000Z' }, 'page-generation-two')
    const first = await service.readInventory('saucedemo', { limit: 1 })
    assert.ok(!('kind' in first)); if ('kind' in first) throw new Error('unexpected cursor result')
    assert.equal(first.history[0].revision, 2)
    assert.ok(first.nextCursor)
    const second = await service.readInventory('saucedemo', { limit: 1, cursor: first.nextCursor })
    assert.ok(!('kind' in second)); if ('kind' in second) throw new Error('unexpected cursor result')
    assert.equal(second.history[0].revision, 1)
    assert.deepEqual(await service.readInventory('other-project', { limit: 1, cursor: first.nextCursor }), { kind: 'invalid_cursor' })
    assert.deepEqual(await service.readInventory('saucedemo', { limit: 2, cursor: first.nextCursor }), { kind: 'invalid_cursor' })
  } finally { await closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('inventory carries safe temporal integrity for current and historical revisions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-ui-068a-temporal-read-'))
  initDb(path.join(root, 'forge.db'))
  try {
    await runMigrations()
    const repository = new TestSetRepository()
    const service = new TestSetService(repository, () => '2026-08-07T16:00:00.000Z')
    await service.generate(fixture(), 'historical-generation')
    await getDb().updateTable('test_generation_events').set({ occurred_at: '2026-08-07T15:59:00.000Z' }).where('generation_id', '=', 'historical-generation').where('event_type', '=', 'terminal').execute()
    await service.generate(fixture(), 'current-generation')
    const inventory = await service.readInventory('saucedemo')
    assert.ok(!('kind' in inventory)); if ('kind' in inventory) throw new Error('unexpected inventory result')
    assert.equal(inventory.current?.temporalIntegrity, 'verified')
    assert.equal(inventory.history[0].temporalIntegrity, 'verified')
    assert.equal(inventory.history[1].temporalIntegrity, 'failed')
    assert.equal(inventory.history[1].temporalCode, 'GENERATION_TIMESTAMP_INCONSISTENT')
    assert.match(inventory.history[1].temporalExplanation, /completion timestamp precedes its start timestamp/)
    assert.equal(inventory.history[1].startedAt, '2026-08-07T16:00:00.000Z')
    assert.equal(inventory.history[1].completedAt, '2026-08-07T15:59:00.000Z')
    assert.doesNotMatch(JSON.stringify(inventory), /sqlite|database|stack trace|raw payload/i)
  } finally { await closeDb(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('inventory uses responsive rows, one inline detail, native controls, and project-preserving links', () => {
  const set = generateEvidenceBackedTestSet(fixture(), 'render-generation', 1).value
  const temporal = { startedAt: set.generatedAt, completedAt: set.generatedAt, temporalIntegrity: 'verified' as const, temporalCode: null, temporalExplanation: 'Verified.' }
  const presented = new TestCasePresentationService().present({
    current: { rowId: 1, contentHash: 'a'.repeat(64), testSet: set, ...temporal },
    history: [], total: 1, nextCursor: null, requestedDefinition: null,
  }).current!.testSet
  const selected = presented.definitions[0].definitionId
  const html = renderToStaticMarkup(React.createElement(
    MemoryRouter,
    null,
    React.createElement(EvidenceBackedTestInventory, { testSet: presented, project: 'saucedemo', selected, onToggle: () => {} }),
  ))
  assert.match(html, /<table/)
  assert.equal((html.match(/aria-labelledby="test-detail-/g) ?? []).length, 1, 'only one responsive representation and detail may exist in the DOM')
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /aria-controls="test-detail-/)
  assert.match(html, /application\/observations\?project=saucedemo/)
  assert.match(html, /application\/model\?project=saucedemo/)
  assert.match(html, /LEGACY PROVENANCE/)
  assert.doesNotMatch(html, /Proceed to Run|Force re-crawl|passed|coverage percentage/i)
  const malformed = renderToStaticMarkup(React.createElement(EvidenceBackedTestInventory, { testSet: undefined, project: 'saucedemo', selected: null, onToggle: () => {} }))
  assert.match(malformed, /Test definitions unavailable/)
  assert.doesNotMatch(malformed, /Cannot read properties|Runner blocked/)
  const pageSource = fs.readFileSync(path.resolve('forge-ui/src/pages/TestCasesPage.tsx'), 'utf8')
  assert.match(pageSource, /ISO: \{value\}/)
  assert.match(pageSource, /Canonical Test Cases/)
  assert.match(pageSource, /SEALED CANONICAL SUPPORT/)
})

test('implementation preserves the canonical FORGE header and transport boundary', () => {
  const files = [
    'src/core/test-design/TestDefinitionContract.ts', 'src/core/storage/TestSetService.ts',
    'src/core/storage/repositories/TestSetRepository.ts', 'src/core/storage/migrations/019_test_set_revisions.ts',
    'forge-ui/server/context/TestInventoryController.ts', 'forge-ui/src/pages/TestCasesPage.tsx',
  ]
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(file), 'utf8')
    assert.match(source.slice(0, 500), /FORGE — Autonomous Quality Engineering/)
    assert.match(source.slice(0, 500), /AnvilQ Technologies LLC/)
    assert.match(source.slice(0, 500), /Raj Kasthuri/)
  }
  const ui = fs.readFileSync(path.resolve('forge-ui/src/pages/TestCasesPage.tsx'), 'utf8')
  assert.doesNotMatch(ui, /src\/core|better-sqlite3|TestSetRepository/)
  assert.match(ui, /matchMedia\('\(min-width: 1280px\)'\)/)
  assert.match(ui, /Temporal integrity/)
  assert.match(fs.readFileSync(path.resolve('src/core/storage/repositories/TestSetRepository.ts'), 'utf8'), /GENERATION_TIMESTAMP_INCONSISTENT/)
})
