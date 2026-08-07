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
import * as path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  presentApplicationReadiness,
  type ApplicationReadinessInput,
} from '../forge-ui/server/registry/ApplicationReadinessPresenter'
import { readApplicationReadiness } from '../forge-ui/server/context/ApplicationReadinessController'
import { ApplicationReadiness } from '../forge-ui/src/components/application-workspace/ApplicationReadiness'

const observationId = 'd8006951-5d5c-4715-8b57-7deeacb9aea9'
const subjectIds = ['inventory-html', 'inventory-item-html', 'cart-html', 'checkout-step-one-html']
const evidenceIds = subjectIds.map((_, index) => `evidence-${index + 1}`)

function fixture(): ApplicationReadinessInput {
  return {
    project: { id: 'saucedemo', name: 'saucedemo' },
    observation: {
      id: observationId,
      projectId: 'saucedemo',
      startedAt: '2026-08-01T14:00:00.000Z',
      completedAt: '2026-08-01T14:05:00.000Z',
      outcome: 'completed',
      authentication: { expectation: 'required', credentialAvailability: 'available', outcome: 'succeeded' },
      subjectIds,
      evidence: evidenceIds.map((id, index) => ({ id, integrity: 'valid' as const, capturedAt: `2026-08-01T14:0${index + 1}:00.000Z` })),
      blockerCount: 0,
      unknownCount: 1,
      limitationCount: 2,
    },
    model: {
      rowId: 7,
      version: '1.0.6',
      lifecycle: 'active',
      createdAt: '2026-08-01T14:06:00.000Z',
      sourceObservationId: observationId,
      validation: 'valid',
      integrity: 'verified',
      projection: 'current',
      subjects: subjectIds.map((id, index) => ({ id, basis: 'direct_observation' as const, evidenceId: evidenceIds[index], derivedMethod: 'ai' as const })),
    },
    modelTotal: 7,
    activeModelCount: 1,
    evidence: {
      projectTotal: 10,
      currentSupportTotal: 4,
      historicalSupportTotal: 6,
      filteredTotal: 4,
      currentRecords: subjectIds.map((canonicalSubjectId, index) => ({
        id: evidenceIds[index],
        canonicalSubjectId,
        support: 'current' as const,
        integrity: 'verified' as const,
        freshness: 'not_evaluated' as const,
        access: 'available' as const,
        conflict: 'not_evaluated' as const,
        sourceObservationId: observationId,
        sourceModelRows: [7],
      })),
    },
  }
}

function present(input: ApplicationReadinessInput = fixture()) {
  const result = presentApplicationReadiness(input)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') throw new Error('Fixture should be presentable')
  return result.value
}

test('readiness is deterministic and evaluates four decisions independently', () => {
  const first = present()
  const second = present()
  assert.deepEqual(first, second)
  assert.deepEqual(first.decisions.map(item => [item.id, item.state]), [
    ['observe_application', 'supported_with_constraints'],
    ['design_evidence_backed_tests', 'supported_with_constraints'],
    ['execute_existing_tests', 'unknown'],
    ['interpret_results', 'unknown'],
  ])
  assert.equal(first.authoritySnapshot.latestObservation?.id, observationId)
  assert.deepEqual(first.authoritySnapshot.activeModel?.subjectIds, subjectIds)
  assert.deepEqual(first.authoritySnapshot.evidence, { total: 10, currentSupport: 4, historicalSupport: 6, inspectedCurrentSupport: 4, href: '/application/evidence?project=saucedemo' })
})

test('missing authorities fail closed instead of inferring readiness from project identity or counts', () => {
  const input = fixture()
  input.observation = null
  input.model = null
  input.modelTotal = 0
  input.activeModelCount = 0
  input.evidence = { projectTotal: 0, currentSupportTotal: 0, historicalSupportTotal: 0, filteredTotal: 0, currentRecords: [] }
  const value = present(input)
  assert.equal(value.decisions[0].state, 'unknown')
  assert.equal(value.decisions[1].state, 'unknown')
  assert.match(value.decisions[0].preventedStrongerState, /persisted observation/i)
  assert.match(value.decisions[1].preventedStrongerState, /valid active model/i)
})

test('failed authentication blocks observation readiness without declaring credentials incorrect', () => {
  const input = fixture()
  input.observation!.authentication.outcome = 'failed'
  input.observation!.outcome = 'blocked'
  const decision = present(input).decisions[0]
  assert.equal(decision.state, 'blocked')
  assert.match(decision.explanation, /authentication|credential-prerequisite/i)
  assert.doesNotMatch(JSON.stringify(decision), /incorrect credential|bad password/i)
})

test('partial observation remains bounded and never becomes unconditional support', () => {
  const input = fixture()
  input.observation!.outcome = 'partially_completed'
  const decision = present(input).decisions[0]
  assert.equal(decision.state, 'supported_with_constraints')
  assert.ok(decision.limitations.some(item => /partially completed/i.test(item)))
})

test('missing and invalid active models remain unknown or blocked', () => {
  const missing = fixture()
  missing.model = null
  missing.activeModelCount = 0
  assert.equal(present(missing).decisions[1].state, 'unknown')
  const invalid = fixture()
  invalid.model!.validation = 'invalid'
  assert.equal(present(invalid).decisions[1].state, 'blocked')
})

test('historical evidence is not promoted to current support and unknown freshness never establishes currency', () => {
  const input = fixture()
  input.evidence.currentSupportTotal = 0
  input.evidence.historicalSupportTotal = 10
  input.evidence.filteredTotal = 0
  input.evidence.currentRecords = []
  const value = present(input)
  assert.equal(value.decisions[1].state, 'unknown')
  assert.equal(value.authoritySnapshot.boundaries.freshness, 'not_evaluated')
  assert.ok(value.decisions.every(item => item.state !== 'supported'))
})

test('matching evidence identity alone cannot bypass exact subject, model-row, and observation provenance', () => {
  for (const mutate of [
    (input: ApplicationReadinessInput) => { input.evidence.currentRecords[0].canonicalSubjectId = 'different-subject' },
    (input: ApplicationReadinessInput) => { input.evidence.currentRecords[0].sourceModelRows = [6] },
    (input: ApplicationReadinessInput) => { input.evidence.currentRecords[0].sourceObservationId = 'different-observation' },
  ]) {
    const input = fixture()
    mutate(input)
    const decision = present(input).decisions[1]
    assert.equal(decision.state, 'unknown')
    assert.match(decision.unknowns.join(' '), /linkage/i)
  }
})

test('integrity failures and evidence conflicts prevent stronger test-design readiness', () => {
  const failed = fixture()
  failed.evidence.currentRecords[0].integrity = 'failed'
  assert.equal(present(failed).decisions[1].state, 'blocked')
  const conflicting = fixture()
  conflicting.evidence.currentRecords[0].conflict = 'conflicting'
  const value = present(conflicting)
  assert.equal(value.decisions[1].state, 'blocked')
  assert.equal(value.authoritySnapshot.boundaries.conflict, 'conflicting')
  assert.match(value.decisions[1].blockers.join(' '), /conflict/i)
})

test('every state carries rationale, constraint evidence, and a bounded next-action disposition', () => {
  for (const decision of present().decisions) {
    assert.ok(decision.explanation.length > 20)
    assert.ok(decision.preventedStrongerState.length > 20)
    assert.ok(decision.blockers.length + decision.unknowns.length + decision.limitations.length > 0)
    if (decision.safeNextAction) assert.match(decision.safeNextAction.href, /[?&]project=saucedemo(?:&|$)/)
  }
})

test('serialized projection omits scores, credentials, raw models, and internal diagnostics', () => {
  const serialized = JSON.stringify(present())
  for (const forbidden of [
    /SAUCEDEMO_USERNAME/i, /SAUCEDEMO_PASSWORD/i, /password\s*=/i, /sqlite/i,
    /select\s+.+\s+from/i, /AppModelPersistenceError/i, /schema-validation/i,
    /raw model/i, /stack trace/i, /health score/i, /\b\d{1,3}%\b/,
    /production ready/i, /fully covered/i, /\bcompleteness\b/i,
  ]) assert.doesNotMatch(serialized, forbidden)
})

test('readiness UI renders responsive cards, semantic disclosures, exact links, and no mutation controls', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(ApplicationReadiness, { readModel: present() })))
  assert.match(html, /data-testid="application-readiness"/)
  assert.equal((html.match(/<article/g) ?? []).length, 4)
  assert.ok((html.match(/<details/g) ?? []).length >= 16)
  assert.match(html, /href="\/application\/observations\?project=saucedemo&amp;observation=/)
  assert.match(html, /href="\/application\/model\?project=saucedemo&amp;model=7"/)
  assert.match(html, /Authentication: succeeded · Credential availability: available/)
  assert.match(html, /Validation: valid · Integrity: verified · Projection: current/)
  assert.match(html, /focus-visible:ring-2/)
  assert.doesNotMatch(html, />\s*(Start|Retry|Force re-crawl|Repair|Delete|Execute)\s*</i)
})

test('route and workspace sources keep readiness typed, server-owned, and available at compact widths', () => {
  const root = path.resolve(process.cwd())
  const route = fs.readFileSync(path.join(root, 'forge-ui/server/routes/projects.ts'), 'utf8')
  const workspace = fs.readFileSync(path.join(root, 'forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx'), 'utf8')
  const component = fs.readFileSync(path.join(root, 'forge-ui/src/components/application-workspace/ApplicationReadiness.tsx'), 'utf8')
  assert.match(route, /router\.get\('\/:appName\/readiness'/)
  assert.match(route, /readApplicationReadiness/)
  assert.match(workspace, /slug: 'readiness'/)
  assert.match(component, /sm:grid-cols-2/)
  assert.match(component, /xl:grid-cols-4/)
  assert.doesNotMatch(component, /overflow-x-auto|min-w-\[/)
})

test('controller returns bounded unknown-project and dependency failures without nested cause text', async () => {
  const missing = await readApplicationReadiness('missing', async () => undefined)
  assert.equal(missing.status, 404)
  const unavailable = await readApplicationReadiness('saucedemo', async () => ({ appName: 'saucedemo' }), {
    observations: { history: () => { throw new Error('SECRET_ENV sqlite /private/workspace') } },
  })
  assert.equal(unavailable.status, 503)
  const serialized = JSON.stringify(unavailable.body)
  assert.doesNotMatch(serialized, /SECRET_ENV|sqlite|workspace/i)
  assert.match(serialized, /READINESS_UNAVAILABLE/)
})

test('ownership mismatches and duplicate authority identities fail closed', () => {
  const foreign = fixture()
  foreign.observation!.projectId = 'foreign-project'
  assert.equal(presentApplicationReadiness(foreign).kind, 'ownership_mismatch')
  const duplicate = fixture()
  duplicate.evidence.currentRecords[1].id = duplicate.evidence.currentRecords[0].id
  assert.equal(presentApplicationReadiness(duplicate).kind, 'malformed')
})
