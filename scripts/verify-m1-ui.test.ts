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
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import {
  createM1MockTestIntentAdapter,
  M1IntentSaveError,
  M1IntentValidationError,
} from '../forge-ui/src/api/m1TestIntentAdapter'
import {
  decodeCanonicalDefinitionSaveResultV3,
  isRefusedNormalizedTestIntentV1,
  isSupportedNormalizedTestIntentV1,
  M1_REFUSAL_CODES,
  type M1TestIntentAdapter,
} from '../forge-ui/src/api/m1TestIntentContract'
import { m1MockGeneration } from '../forge-ui/src/api/m1TestIntentMockFixtures'
import { decodeCanonicalExecutionPreflight } from '../forge-ui/src/api/executionPreflightContract'
import { decodeTestInventoryResponse, TestInventoryPayloadError } from '../forge-ui/src/api/testInventoryContract'
import type { CanonicalV3TestDefinitionPresentation, CanonicalV3TestSetPresentation, TestSetPresentation } from '../forge-ui/src/api/types'
import { M1IntentReview, M1RefusalState, M1TestDesignWorkspace } from '../forge-ui/src/components/tests/M1TestDesignWorkspace'
import { EvidenceBackedTestInventory } from '../forge-ui/src/pages/TestCasesPage'
import { resolveCurrentStartAuthority, resolveFreshPreflightAuthority, resolveM1RunHandoffState, resolveV3RunPreflightBinding, type V3RunAuthorityExpectation } from '../forge-ui/src/pages/RunPage'
import { RunIntentController, type RunIntentStorage } from '../forge-ui/src/pages/runIntentState'
import { M1DraftSession } from '../forge-ui/src/utils/M1DraftSession'

const HASH = 'a'.repeat(64)
const NOW = '2026-08-24T12:00:00.000Z'
;(globalThis as typeof globalThis & { React: typeof React }).React = React

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(MemoryRouter, null, node))
}

function rendererText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : rendererText(child)).join(' ')
}

function workspace(projectId: string, adapter: M1TestIntentAdapter): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null,
    React.createElement(M1TestDesignWorkspace, { projectId, adapter })))
}

function v3Definition(): CanonicalV3TestDefinitionPresentation {
  return {
    schemaVersion: 3,
    authorityClass: 'canonical_v3',
    definitionId: 'definition-v3-cart',
    title: 'Continue from Cart to checkout',
    intent: 'Verify the observed Cart checkout flow.',
    category: 'observed_flow',
    subjects: ['subject-cart', 'subject-checkout-step-one'],
    generationMethod: 'deterministic',
    validation: { state: 'valid', explanation: 'Validated from observed flow evidence.' },
    intrinsicCompatibility: { state: 'compatible', reason: null, explanation: 'Frozen M1 semantics are supported.' },
    confidenceLimitations: ['Only the observed flow segment is represented.'],
    materialUnknowns: ['Later checkout behavior is unobserved.'],
    unobservedScope: ['Payment submission'],
    preventedStrongerDefinition: 'Unobserved flow steps were excluded.',
    provenance: {
      label: 'SEALED CANONICAL SUPPORT', modelRowId: 7, modelVersion: '1.0.0', supportSealHash: HASH,
      supportingObservationCount: 2, supportingGapCount: 0, subjectSupportCount: 2,
      supportingObservationIds: ['observation-source', 'observation-target'], supportingGapIds: [],
      intentId: 'intent-project-a-cart', intentContentHash: HASH,
    },
    appArea: 'Cart',
    routeEvidence: {
      state: 'available_flow', normalizationPolicy: { id: 'forge.canonical-route-normalization', version: '1' },
      supportingObservationCount: 2, supportingObservationIds: ['observation-source', 'observation-target'],
      routes: [
        { subjectId: 'subject-cart', normalizedPath: '/cart.html', supportingObservationIds: ['observation-source'] },
        { subjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html', supportingObservationIds: ['observation-target'] },
      ],
    },
    authenticationExpectation: { state: 'required', mechanism: 'form-login', basis: [{ kind: 'declared_configuration', policyId: 'auth-policy', policyVersion: '1' }] },
    actions: [
      { stepId: 'step-navigate', ordinal: 0, kind: 'navigate_to_observed_route', subjectId: 'subject-cart', normalizedPath: '/cart.html' },
      { stepId: 'step-click', ordinal: 1, kind: 'click_observed_data_test', subjectId: 'subject-cart', elementId: 'element-checkout', dataTestValue: 'checkout', targetSubjectId: 'subject-checkout-step-one' },
    ],
    oracle: { kind: 'subject_observable', subjectId: 'subject-checkout-step-one', explanation: 'Observed /checkout-step-one.html subject becomes observable' },
    normalizedIntent: { intentId: 'intent-project-a-cart', source: 'discovered', sourceFlowId: 'flow-cart', selectedFlowStepIndexes: [1], excludedFlowStepIndexes: [2], limitations: ['Payment was excluded.'] },
    executionPolicy: 'canonical_v3_preflight_required',
  }
}

function v3TestSet(): TestSetPresentation {
  return {
    schemaVersion: 3, authorityClass: 'canonical_v3', testSetId: 'test-set-v3-project-a', revision: 3,
    projectId: 'project-a', generationId: 'generation-v3', generatedAt: NOW, outcome: 'completed', definitions: [v3Definition()],
    provenance: {
      label: 'SEALED CANONICAL SUPPORT', modelRowId: 7, modelVersion: '1.0.0', observationRunId: 'observation-run-1',
      supportSealHash: HASH, characterizationPolicy: { id: 'flow-policy', version: '1' },
      supportingObservationCount: 2, supportingGapCount: 0, subjectSupportCount: 2,
    },
    limitations: ['Bounded M1 flow.'], materialUnknowns: [], unobservedScope: ['Payment'], preventedStrongerSet: 'Unobserved scope remains.',
    coverage: 'unknown', freshness: 'not_evaluated',
  }
}

function inventory() {
  const testSet = v3TestSet()
  return {
    project: { id: 'project-a', name: 'Project A' },
    designReadiness: { state: 'supported_with_constraints', explanation: 'Observed support is available.', blockers: [], unknowns: [] },
    canGenerate: true,
    current: { rowId: 3, contentHash: HASH, testSet, startedAt: NOW, completedAt: NOW, temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'Verified.' },
    history: [
      { rowId: 2, testSetId: 'test-set-v2', revision: 2, generationId: 'generation-v2', generatedAt: NOW, outcome: 'completed', modelRowId: 6, modelVersion: '1', definitionCount: 1, contentHash: HASH, startedAt: NOW, completedAt: NOW, temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'Verified.', schemaVersion: 2, authorityClass: 'canonical_v2', provenance: { label: 'SEALED CANONICAL SUPPORT', observationRunId: 'run-v2', supportSealHash: HASH } },
      { rowId: 3, testSetId: 'test-set-v3-project-a', revision: 3, generationId: 'generation-v3', generatedAt: NOW, outcome: 'completed', modelRowId: 7, modelVersion: '1.0.0', definitionCount: 1, contentHash: HASH, startedAt: NOW, completedAt: NOW, temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'Verified.', schemaVersion: 3, authorityClass: 'canonical_v3', provenance: { label: 'SEALED CANONICAL SUPPORT', observationRunId: 'observation-run-1', supportSealHash: HASH } },
    ],
    total: 2, nextCursor: null,
    requestedDefinition: { definition: v3Definition(), schemaVersion: 3, revision: 3, rowId: 3 },
    boundaries: { execution: 'not_performed', coverage: 'unknown', freshness: 'not_evaluated', explanation: 'Run preflight is separate.' },
  }
}

function v3Preflight() {
  return {
    project: { id: 'project-a', name: 'Project A' },
    testSetRevision: { revision: 3, testSetId: 'test-set-v3-project-a', schemaVersion: 3, contentHash: HASH },
    definitionResults: [{
      definitionId: 'definition-v3-cart', schemaVersion: 3, state: 'eligible', semanticPlanHash: HASH, appArea: 'Cart',
      modelRowId: 7, modelVersion: '1.0.0', supportSealHash: HASH, intentId: 'intent-project-a-cart', intentContentHash: HASH,
      routes: [{ subjectId: 'subject-cart', normalizedPath: '/cart.html' }, { subjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html' }],
      actions: ['navigate_to_observed_route', 'click_observed_data_test'],
      oracle: { kind: 'subject_observable', subjectId: 'subject-checkout-step-one', routePath: '/checkout-step-one.html' },
      authenticationExpectation: { state: 'required', mechanism: 'form-login' }, intrinsicCompatibility: 'compatible',
    }],
    aggregate: { state: 'ready', explanation: 'The exact v3 definition is eligible.' },
    liveEligibility: { state: 'eligible', runner: 'available', credentials: 'available' },
    boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
  }
}

function v3Expectation(): V3RunAuthorityExpectation {
  return {
    current: { contentHash: HASH, testSet: v3TestSet() as CanonicalV3TestSetPresentation },
    handoff: { testSetId: 'test-set-v3-project-a', definitionId: 'definition-v3-cart', revision: 3 },
  }
}

function v2SubstitutionWithV3Id() {
  return {
    project: { id: 'project-a', name: 'Project A' },
    testSetRevision: { revision: 3, testSetId: 'test-set-v2-substitute', schemaVersion: 2, contentHash: HASH },
    definitionResults: [{ definitionId: 'definition-v3-cart', schemaVersion: 2, state: 'eligible', semanticPlanHash: HASH, modelRowId: 7, modelVersion: '1.0.0', supportSealHash: HASH, routeEvidence: { normalizedPath: '/cart.html', normalizationPolicy: { id: 'forge.canonical-route-normalization', version: '1' } }, authenticationExpectation: { state: 'required', mechanism: 'form-login' }, intrinsicCompatibility: 'compatible' }],
    aggregate: { state: 'ready', explanation: 'Substituted v2 result.' }, liveEligibility: { state: 'eligible', runner: 'available', credentials: 'available' }, boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
  }
}

test('Cart generation is exact, review-ready, and never presented as canonical generation success', () => {
  const intent = m1MockGeneration('project-a', 'Cart')
  assert.equal(isSupportedNormalizedTestIntentV1(intent), true)
  if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Expected supported fixture')
  const html = render(React.createElement(M1IntentReview, { intent }))
  for (const expected of ['App area: Cart', 'Navigate to /cart.html', 'Click the observed checkout element', 'Observed /checkout-step-one.html subject becomes observable', 'Generated from discovered evidence', 'Authentication is established for role shopper using form-login', 'session-scoped and non-authoritative']) assert.match(html, new RegExp(expected))
  assert.doesNotMatch(html, /canonical v3 test saved/i)
})

test('intent decoder rejects hidden fields, unsupported semantics, and non-canonical evidence ordering', () => {
  const intent = m1MockGeneration('project-a', 'Cart')
  assert.equal(isSupportedNormalizedTestIntentV1({ ...structuredClone(intent), hiddenAction: 'fill' }), false)
  const unsupported = structuredClone(intent) as any
  unsupported.steps[1].kind = 'fill'
  assert.equal(isSupportedNormalizedTestIntentV1(unsupported), false)
  const reordered = structuredClone(intent) as any
  reordered.appArea.evidenceIds.reverse()
  assert.equal(isSupportedNormalizedTestIntentV1(reordered), false)
})

test('all four public refusal codes render distinct truthful states with no Save or Run control', () => {
  const areas: Record<(typeof M1_REFUSAL_CODES)[number], string> = { insufficient_evidence: 'Reports', ambiguous_evidence: 'Administration', unsupported_semantics: 'Advanced-search', app_area_unknown: 'unknown' }
  const headings = new Set<string>()
  for (const code of M1_REFUSAL_CODES) {
    const intent = m1MockGeneration('project-a', areas[code])
    assert.equal(isRefusedNormalizedTestIntentV1(intent), true)
    if (!isRefusedNormalizedTestIntentV1(intent)) throw new Error('Expected refusal fixture')
    assert.equal(intent.disposition.code, code)
    const html = render(React.createElement(M1RefusalState, { refusal: intent }))
    const heading = html.match(/<h3[^>]*>(.*?)<\/h3>/)?.[1]
    assert.ok(heading); headings.add(heading)
    assert.match(html, /No review draft or canonical Test Definition was created/)
    assert.doesNotMatch(html, /<button|Continue to Run|Accept and save/)
  }
  assert.equal(headings.size, 4)
})

test('mock promotion is exact and idempotent; changed content and save failure fail closed', async () => {
  const adapter = createM1MockTestIntentAdapter()
  const intent = await adapter.generate('project-a', 'Cart')
  assert.equal(isSupportedNormalizedTestIntentV1(intent), true)
  if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Expected supported fixture')
  const first = decodeCanonicalDefinitionSaveResultV3(await adapter.save('project-a', intent))
  const second = decodeCanonicalDefinitionSaveResultV3(await adapter.save('project-a', intent))
  assert.deepEqual(second, first)
  await assert.rejects(() => adapter.save('project-a', { ...intent, title: 'Changed after review' }), M1IntentValidationError)
  const billing = await adapter.generate('project-a', 'Billing')
  if (!isSupportedNormalizedTestIntentV1(billing)) throw new Error('Expected Billing fixture')
  await assert.rejects(() => adapter.save('project-a', billing), M1IntentSaveError)
  assert.throws(() => decodeCanonicalDefinitionSaveResultV3({ schemaVersion: 3, testSetId: 'set', definitionId: 'definition', revision: 0 }))
})

test('session reload restores only an exact supported draft and rejects malformed state', () => {
  const values = new Map<string, string>()
  const sessionStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage } })
  try {
    const intent = m1MockGeneration('project-a', 'Cart')
    if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Expected supported fixture')
    assert.equal(M1DraftSession.save(intent), true)
    assert.equal(M1DraftSession.load('project-a').state, 'available')
    values.set('forge:m1-review-draft:project-a', JSON.stringify({ ...intent, appArea: null }))
    assert.equal(M1DraftSession.load('project-a').state, 'invalid')
    assert.equal(M1DraftSession.load('project-b').state, 'missing')
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
})

test('workspace exposes truthful loading and empty states', async () => {
  let release!: (areas: readonly []) => void
  const adapter: M1TestIntentAdapter = {
    mode: 'backend',
    listDiscoveredAreas: () => new Promise(resolve => { release = resolve }),
    generate: async () => { throw new Error('not reachable') },
    save: async () => { throw new Error('not reachable') },
  }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(workspace('m1-empty', adapter)) })
  assert.match(rendererText(renderer.root), /Loading discovered application areas/)
  await act(async () => { release([]); await new Promise(resolve => setTimeout(resolve, 25)) })
  assert.match(rendererText(renderer.root), /No discovered application areas/)
  renderer.unmount()
})

test('workspace completes select, Generate, review, Accept/Save, and Run-link presentation flow', async () => {
  const values = new Map<string, string>()
  const sessionStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage } })
  const intent = m1MockGeneration('project-a', 'Cart')
  if (!isSupportedNormalizedTestIntentV1(intent)) throw new Error('Expected supported fixture')
  const adapter: M1TestIntentAdapter = {
    mode: 'backend',
    listDiscoveredAreas: async () => [{ appArea: 'Cart', sourceSubjectId: 'subject-cart', observedRoute: '/cart.html', evidenceSummary: 'Observed flow.', confidence: 'high', availability: 'available', refusal: null }],
    generate: async () => intent,
    save: async () => ({ schemaVersion: 3, testSetId: 'test-set-v3-project-a', definitionId: 'definition-v3-cart', revision: 3 }),
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace('project-a', adapter)); await new Promise(resolve => setTimeout(resolve, 25)) })
    const radio = renderer.root.findByType('input')
    await act(async () => { radio.props.onChange(); await Promise.resolve() })
    const generate = renderer.root.findAllByType('button').find(button => rendererText(button).includes('Generate test for Cart'))
    assert.ok(generate)
    await act(async () => { generate.props.onClick(); await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.match(rendererText(renderer.root), /Review-ready .* Ephemeral intent/)
    assert.match(rendererText(renderer.root), /Navigate to \/cart.html/)
    const save = renderer.root.findAllByType('button').find(button => rendererText(button).includes('Accept and save canonical v3 test'))
    assert.ok(save)
    await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 25)) })
    assert.match(rendererText(renderer.root), /Canonical v3 test saved/)
    assert.equal(renderer.root.findByType('a').props.href, '/run?project=project-a&definition=definition-v3-cart&revision=3')
  } finally {
    renderer?.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('v3 inventory decodes by explicit schema and coexists with v2 history without coercion', () => {
  const decoded = decodeTestInventoryResponse(inventory())
  assert.equal(decoded.current?.testSet.schemaVersion, 3)
  assert.deepEqual(decoded.history.map(item => item.schemaVersion), [2, 3])
  const html = render(React.createElement(EvidenceBackedTestInventory, { testSet: decoded.current?.testSet, project: 'project-a', selected: 'definition-v3-cart', onToggle: () => undefined }))
  assert.match(html, /Canonical v3 observed flow/)
  assert.match(html, /App area/)
  assert.match(html, /Cart/)
  assert.match(html, /Navigate to \/cart.html/)
  assert.doesNotMatch(html, /Sealed canonical v2 support/)
})

for (const [label, mutate] of [
  ['missing app area', (value: any) => { value.current.testSet.definitions[0].appArea = ''; return value }],
  ['v3 category through v2 path', (value: any) => { value.current.testSet.definitions[0].schemaVersion = 2; return value }],
  ['unsupported action', (value: any) => { value.current.testSet.definitions[0].actions[1].kind = 'fill'; return value }],
  ['mismatched requested schema', (value: any) => { value.requestedDefinition.schemaVersion = 2; return value }],
] as const) {
  test(`malformed v3 inventory fails closed: ${label}`, () => {
    assert.throws(() => decodeTestInventoryResponse(mutate(structuredClone(inventory()))), TestInventoryPayloadError)
  })
}

test('exact v3 preflight is required and yields fresh Start authority only for the selected definition', () => {
  const expected = { projectId: 'project-a', definitionIds: ['definition-v3-cart'], revision: 3 }
  const decoded = decodeCanonicalExecutionPreflight(v3Preflight(), expected)
  assert.equal(decoded.definitionResults[0].schemaVersion, 3)
  const fresh = resolveFreshPreflightAuthority('project-a', ['definition-v3-cart'], 3, { data: decoded, isSuccess: true, isError: false, isFetching: false, dataUpdatedAt: 1 })
  assert.ok(fresh)
  assert.deepEqual(fresh?.definitionResults.map(item => item.definitionId), ['definition-v3-cart'])
  assert.equal(resolveFreshPreflightAuthority('project-a', ['missing'], 3, { data: decoded, isSuccess: true, isError: false, isFetching: false, dataUpdatedAt: 1 }), null)
  const binding = resolveV3RunPreflightBinding('project-a', { definitionIds: ['definition-v3-cart'], revision: 3 }, v3Expectation(), decoded)
  assert.equal(binding?.testSetId, 'test-set-v3-project-a')
  assert.deepEqual(binding?.definitionResults.map(item => item.definitionId), ['definition-v3-cart'])
})

test('reviewer attack fails closed at Start: v3 authority plus same-ID v2 preflight', () => {
  const substituted = decodeCanonicalExecutionPreflight(v2SubstitutionWithV3Id(), { projectId: 'project-a', definitionIds: ['definition-v3-cart'], revision: 3 })
  assert.equal(resolveV3RunPreflightBinding('project-a', { definitionIds: ['definition-v3-cart'], revision: 3 }, v3Expectation(), substituted), null)
  const storage: RunIntentStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  const controller = new RunIntentController(storage, 'project-a', new QueryClient())
  const authority = resolveCurrentStartAuthority(controller, 'project-a', null, { definitionIds: ['definition-v3-cart'], revision: 3 }, {
    data: substituted, isSuccess: true, isError: false, isFetching: false, dataUpdatedAt: 1,
  }, { schemaVersion: 3, authority: v3Expectation() })
  assert.equal(authority, null)
})

for (const [label, mutate] of [
  ['matching ID absent', (value: any) => { value.definitionResults = []; return value }],
  ['duplicate matching results', (value: any) => { value.definitionResults.push(structuredClone(value.definitionResults[0])); return value }],
  ['stale revision', (value: any) => { value.testSetRevision.revision = 2; return value }],
  ['different Test Set identity', (value: any) => { value.testSetRevision.testSetId = 'different-test-set'; return value }],
  ['different Test Set content', (value: any) => { value.testSetRevision.contentHash = 'b'.repeat(64); return value }],
  ['aggregate ready but result blocked', (value: any) => { value.definitionResults[0].state = 'blocked'; return value }],
  ['preflight result for different definition', (value: any) => { value.definitionResults[0].definitionId = 'definition-v3-other'; return value }],
  ['malformed v3 result', (value: any) => { delete value.definitionResults[0].appArea; return value }],
  ['mismatched app area authority', (value: any) => { value.definitionResults[0].appArea = 'Checkout'; return value }],
  ['mismatched support seal authority', (value: any) => { value.definitionResults[0].supportSealHash = 'b'.repeat(64); return value }],
] as const) {
  test(`v3 Start binding fails closed: ${label}`, () => {
    const preflight = mutate(structuredClone(v3Preflight()))
    assert.equal(resolveV3RunPreflightBinding('project-a', { definitionIds: ['definition-v3-cart'], revision: 3 }, v3Expectation(), preflight), null)
  })
}

test('v3 Start binding rejects stale handoff identity and v2 current inventory', () => {
  const preflight = decodeCanonicalExecutionPreflight(v3Preflight(), { projectId: 'project-a', definitionIds: ['definition-v3-cart'], revision: 3 })
  const stale = v3Expectation(); stale.handoff.testSetId = 'stale-test-set'
  assert.equal(resolveV3RunPreflightBinding('project-a', { definitionIds: ['definition-v3-cart'], revision: 3 }, stale, preflight), null)
  const stored = { projectId: 'project-a', testSetId: 'test-set-v3-project-a', definitionId: 'definition-v3-cart', revision: 3, createdAt: NOW }
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, { testSetId: 'test-set-v2', revision: 3, schemaVersion: 2, definitions: [{ definitionId: 'definition-v3-cart', schemaVersion: 2 }] }, true).state, 'blocked')
})

for (const [label, mutate] of [
  ['malformed action order', (value: any) => { value.definitionResults[0].actions.reverse(); return value }],
  ['missing app area', (value: any) => { delete value.definitionResults[0].appArea; return value }],
  ['wrong oracle subject', (value: any) => { value.definitionResults[0].oracle.subjectId = 'subject-cart'; return value }],
  ['presentation body injected', (value: any) => { value.definitionResults[0].definition = v3Definition(); return value }],
] as const) {
  test(`malformed v3 preflight fails closed: ${label}`, () => {
    assert.throws(() => decodeCanonicalExecutionPreflight(mutate(structuredClone(v3Preflight())), { projectId: 'project-a', definitionIds: ['definition-v3-cart'], revision: 3 }))
  })
}

test('blocked v3 preflight carries no definition result and cannot become Start authority', () => {
  const blocked = { ...v3Preflight(), testSetRevision: { revision: 3 }, definitionResults: [], aggregate: { state: 'stale_definition', explanation: 'Current canonical inventory no longer contains the exact revision.' }, liveEligibility: { state: 'blocked', runner: 'unknown', credentials: 'unknown' }, boundaries: { generationAuthority: 'not_established', executionEligibility: 'blocked', persisted: false } }
  const decoded = decodeCanonicalExecutionPreflight(blocked, { projectId: 'project-a', definitionIds: ['definition-v3-cart'], revision: 3 })
  assert.equal(decoded.definitionResults.length, 0)
  const fresh = resolveFreshPreflightAuthority('project-a', ['definition-v3-cart'], 3, { data: decoded, isSuccess: true, isError: false, isFetching: false, dataUpdatedAt: 1 })
  assert.equal(fresh?.aggregate.state, 'stale_definition')
  assert.equal(fresh?.boundaries.executionEligibility, 'blocked')
})

test('v2 preflight decoding remains unchanged', () => {
  const value = {
    project: { id: 'project-a', name: 'Project A' },
    testSetRevision: { revision: 2, testSetId: 'test-set-v2', schemaVersion: 2, contentHash: HASH },
    definitionResults: [{ definitionId: 'definition-v2', schemaVersion: 2, state: 'eligible', semanticPlanHash: HASH, modelRowId: 6, modelVersion: '1', supportSealHash: HASH, routeEvidence: { normalizedPath: '/inventory.html', normalizationPolicy: { id: 'forge.canonical-route-normalization', version: '1' } }, authenticationExpectation: { state: 'not_required', mechanism: null }, intrinsicCompatibility: 'compatible' }],
    aggregate: { state: 'ready', explanation: 'Ready.' }, liveEligibility: { state: 'eligible', runner: 'available', credentials: 'not_required' }, boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
  }
  const decoded = decodeCanonicalExecutionPreflight(value, { projectId: 'project-a', definitionIds: ['definition-v2'], revision: 2 })
  assert.equal(decoded.definitionResults[0].schemaVersion, 2)
})

test('session handoff cannot bypass current v3 inventory and revision checks', () => {
  const stored = { projectId: 'project-a', testSetId: 'test-set-v3-project-a', definitionId: 'definition-v3-cart', revision: 3, createdAt: NOW }
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, null, false).state, 'pending')
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, { testSetId: 'test-set-v3-project-a', revision: 3, schemaVersion: 2, definitions: [{ definitionId: 'definition-v3-cart', schemaVersion: 2 }] }, true).state, 'blocked')
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, { testSetId: 'test-set-v3-project-a', revision: 3, schemaVersion: 3, definitions: [] }, true).state, 'blocked')
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '4', stored, { testSetId: 'test-set-v3-project-a', revision: 4, schemaVersion: 3, definitions: [{ definitionId: 'definition-v3-cart', schemaVersion: 3 }] }, true).state, 'invalid')
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, { testSetId: 'different-test-set', revision: 3, schemaVersion: 3, definitions: [{ definitionId: 'definition-v3-cart', schemaVersion: 3 }] }, true).state, 'blocked')
  assert.equal(resolveM1RunHandoffState('project-a', 'definition-v3-cart', '3', stored, { testSetId: 'test-set-v3-project-a', revision: 3, schemaVersion: 3, definitions: [{ definitionId: 'definition-v3-cart', schemaVersion: 3 }] }, true).state, 'ready')
})

test('source keeps the M1 adapter centralized, the layout responsive, and Start free of semantic bodies', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '../forge-ui/src/components/tests/M1TestDesignWorkspace.tsx'), 'utf8')
  const run = fs.readFileSync(path.join(__dirname, '../forge-ui/src/pages/RunPage.tsx'), 'utf8')
  const start = fs.readFileSync(path.join(__dirname, '../forge-ui/src/pages/runIntentState.ts'), 'utf8')
  assert.match(workspace, /m1TestIntentAdapter/)
  assert.match(workspace, /type="radio"/)
  assert.match(workspace, /focus-visible:ring-2/)
  assert.match(workspace, /md:grid-cols-2/)
  assert.match(run, /definitionResults/)
  assert.match(run, /canonical\.schemaVersion === 2 \|\| ready/)
  assert.match(run, /canonical\.schemaVersion === 3 && !ready/)
  assert.match(run, /Start is not exposed because the selected v3 Definition is not bound/)
  assert.doesNotMatch(start, /appArea|dataTestValue|subject_observable|navigate_to_observed_route|click_observed_data_test/)
})
