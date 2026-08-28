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
  M3_MANUAL_REFUSAL_CODES,
  buildManualAnalyzeRequest,
  buildManualPromotionRequest,
  decodeManualAnalysisResultV1,
  decodeManualAutomationProposalV1,
  decodeManualPromotionResultV1,
  decodeManualResultsProvenanceV1,
  decodeManualTestAnalyzeResponseDto,
  decodeManualTestSourceV1,
  type M3ManualDraft,
  type M3ManualTestAdapter,
} from '../forge-ui/src/api/m3ManualTestContract'
import { ApiError } from '../forge-ui/src/api/client'
import { M3ManualAnalyzeInputError, M3ManualPromotionError, m3ManualTestAdapter } from '../forge-ui/src/api/m3ManualTestAdapter'
import { decodeTestInventoryResponse, validateCanonicalV3DefinitionPresentation } from '../forge-ui/src/api/testInventoryContract'
import { M3ManualResultsProvenance, M3ManualTestWorkspace, M3ProposalReview, M3RefusalReview, m3AnalyzeErrorMessage, m3PromotionErrorMessage, m3SaveTransportErrorMessage } from '../forge-ui/src/components/tests/M3ManualTestWorkspace'
import { verifyM3AnalysisReceipt } from '../forge-ui/src/hooks/useM3ManualTest'
import { EvidenceBackedTestInventory } from '../forge-ui/src/pages/TestCasesPage'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
const repositoryRoot = path.resolve(process.cwd())
const fixtureRoot = path.join(repositoryRoot, 'fixtures', 'm3-contract')
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'))
const source = decodeManualTestSourceV1(fixture('positive-manual-source.json'))
const proposal = decodeManualAutomationProposalV1(fixture('positive-automation-proposal.json'))
const saveResult = decodeManualPromotionResultV1(fixture('positive-save-result.json'))
const sourceDraft: M3ManualDraft = { title: source.title, objective: source.objective ?? '', steps: source.steps.map(step => step.text), expectedOutcome: source.expectedOutcome }
const proposalEnvelope = () => ({
  schemaVersion: 'forge-manual-analysis-result/v1',
  outcome: { kind: 'proposal', proposal: fixture('positive-automation-proposal.json') },
})
const proposalAnalysis = () => decodeManualAnalysisResultV1(proposalEnvelope())
const supportedReceipt = () => decodeManualTestAnalyzeResponseDto({ source, analysis: proposalEnvelope() })

function render(node: React.ReactNode): string { return renderToStaticMarkup(React.createElement(MemoryRouter, null, node)) }
function nodeText(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : nodeText(child)).join(' ') }
function workspace(adapter: M3ManualTestAdapter): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null,
    React.createElement(M3ManualTestWorkspace, { projectId: source.projectId, adapter })))
}
async function fillDraft(renderer: ReactTestRenderer, draft = sourceDraft): Promise<void> {
  const add = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Add step'))
  assert.ok(add)
  await act(async () => { add.props.onClick() })
  await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: draft.title } }) })
  for (const [index, value] of [draft.objective, draft.steps[0], draft.steps[1], draft.expectedOutcome].entries()) {
    const areas = renderer.root.findAllByType('textarea')
    assert.equal(areas.length, 4)
    await act(async () => { areas[index].props.onChange({ target: { value } }) })
  }
}
async function submitAnalyze(renderer: ReactTestRenderer): Promise<void> {
  const form = renderer.root.findByType('form')
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 10)) })
}

test('UI decoder consumes the physical spine and preserves every frozen identity distinction', () => {
  assert.equal(source.schemaVersion, 'forge-manual-test-source/v1')
  assert.equal(proposal.schemaVersion, 'forge-manual-automation-proposal/v1')
  assert.equal(proposal.normalizedIntent.schemaVersion, 'forge-normalized-test-intent/v1')
  assert.equal(saveResult.schemaVersion, 'forge-manual-promotion-result/v1')
  assert.deepEqual(source.steps.map(step => step.ordinal), [1, 2])
  assert.deepEqual(proposal.canonicalActions.map(action => action.ordinal), [0, 1])
  assert.equal(typeof proposal.appArea, 'object')
  assert.equal(proposal.normalizedIntent.source, 'manual')
  assert.equal(proposal.sourceAuthority.sourceId, source.sourceId)
  assert.equal(proposal.sourceAuthority.sourceContentHash, source.contentHash)
  assert.equal(saveResult.proposalAuthority.proposalId, proposal.proposalId)
  assert.equal(saveResult.proposalAuthority.proposalContentHash, proposal.proposalContentHash)
  assert.match(source.contentHash, /^[a-f0-9]{64}$/)
  const codes = ['unsupported-fill.json', 'ambiguous-control.json', 'insufficient-outcome.json', 'app-area-unknown.json']
    .map(name => decodeManualAnalysisResultV1(fixture(name)))
    .map(result => result.outcome.kind === 'refusal' ? result.outcome.refusal.code : 'proposal')
  assert.deepEqual(new Set(codes), new Set(M3_MANUAL_REFUSAL_CODES))
})

test('decoder rejects malformed manual ordinals, missing outcome, and proposal/source identity mismatch', () => {
  const malformed = structuredClone(fixture('positive-manual-source.json')) as any
  malformed.steps[1].ordinal = 3
  assert.throws(() => decodeManualTestSourceV1(malformed))
  const missing = structuredClone(fixture('positive-manual-source.json')) as any
  delete missing.expectedOutcome
  assert.throws(() => decodeManualTestSourceV1(missing))
  assert.throws(() => verifyM3AnalysisReceipt(source.projectId, {
    source: { ...source, sourceId: 'manual-source-other' },
    analysis: proposalAnalysis(),
  }))
})

test('Analyze decoder requires the exact frozen analysis envelope and never synthesizes authority', () => {
  const exactProposalEnvelope = proposalEnvelope()
  assert.deepEqual(decodeManualAnalysisResultV1(exactProposalEnvelope), exactProposalEnvelope)

  const refusalFiles = ['unsupported-fill.json', 'ambiguous-control.json', 'insufficient-outcome.json', 'app-area-unknown.json']
  for (const name of refusalFiles) {
    const exactRefusalEnvelope = fixture(name)
    assert.deepEqual(decodeManualAnalysisResultV1(exactRefusalEnvelope), exactRefusalEnvelope, name)
  }

  const firstRefusalEnvelope = fixture('unsupported-fill.json') as any
  const bareRefusal = firstRefusalEnvelope.outcome.refusal
  const envelopeHostiles: readonly [string, unknown][] = [
    ['bare proposal', fixture('positive-automation-proposal.json')],
    ['bare refusal', bareRefusal],
    ['missing analysis schemaVersion', { outcome: exactProposalEnvelope.outcome }],
    ['wrong analysis schemaVersion', { ...exactProposalEnvelope, schemaVersion: 'forge-manual-analysis-result/v0' }],
    ['missing analysis outcome', { schemaVersion: 'forge-manual-analysis-result/v1' }],
    ['unknown outcome variant', { schemaVersion: 'forge-manual-analysis-result/v1', outcome: { kind: 'legacy' } }],
  ]
  for (const [name, analysis] of envelopeHostiles) {
    assert.throws(() => decodeManualTestAnalyzeResponseDto({ source, analysis }), name)
  }
  assert.equal(envelopeHostiles.length, 6)
})

test('Analyze request is the exact frozen ManualTestSourceInputV1 body', () => {
  const body = buildManualAnalyzeRequest(sourceDraft)
  assert.deepEqual(body, {
    schemaVersion: 'forge-manual-test-source-input/v1', sourceKind: 'manual', title: source.title,
    objective: source.objective, steps: source.steps.map(step => ({ ordinal: step.ordinal, text: step.text })),
    expectedOutcome: source.expectedOutcome,
  })
  assert.deepEqual(Object.keys(body).sort(), ['expectedOutcome', 'objective', 'schemaVersion', 'sourceKind', 'steps', 'title'])
})

test('malformed Analyze response is rejected, never repaired from the submitted draft', () => {
  const malformed: any = { source: structuredClone(source), analysis: proposalEnvelope() }
  malformed.source.steps[0].ordinal = 0
  assert.throws(() => decodeManualTestAnalyzeResponseDto(malformed))
  const mismatched: any = { source: structuredClone(source), analysis: proposalEnvelope() }
  mismatched.source.contentHash = 'f'.repeat(64)
  assert.throws(() => decodeManualTestAnalyzeResponseDto(mismatched))
})

test('proposal decoder rejects every malformed canonical binding and grounding basis pairing', () => {
  const hostileCases: readonly [string, number, unknown][] = [
    ['action 0 with observed flow step', 0, { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: ['obs-cart-route'] }],
    ['action 0 with governed route and non-null index', 0, { kind: 'governed_route', flowStepIndex: 0, evidenceIds: ['obs-cart-route'] }],
    ['action 1 with governed route', 1, { kind: 'governed_route', flowStepIndex: null, evidenceIds: ['obs-checkout-control'] }],
    ['action 1 with observed flow step and null index', 1, { kind: 'observed_flow_step', flowStepIndex: null, evidenceIds: ['obs-checkout-control'] }],
    ['action 1 with negative observed index', 1, { kind: 'observed_flow_step', flowStepIndex: -1, evidenceIds: ['obs-checkout-control'] }],
    ['action 1 with fractional observed index', 1, { kind: 'observed_flow_step', flowStepIndex: 0.5, evidenceIds: ['obs-checkout-control'] }],
    ['oracle with governed route', 2, { kind: 'governed_route', flowStepIndex: null, evidenceIds: ['obs-checkout-subject'] }],
    ['oracle with observed flow step', 2, { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: ['obs-checkout-subject'] }],
    ['oracle with governed subject and non-null index', 2, { kind: 'governed_subject', flowStepIndex: 0, evidenceIds: ['obs-checkout-subject'] }],
  ]
  for (const [name, groundingIndex, basis] of hostileCases) {
    const malformed = structuredClone(fixture('positive-automation-proposal.json')) as any
    malformed.sourceGrounding[groundingIndex].basis = basis
    assert.throws(() => decodeManualAutomationProposalV1(malformed), name)
  }
  assert.equal(hostileCases.length, 9)
  assert.doesNotThrow(() => decodeManualAutomationProposalV1(fixture('positive-automation-proposal.json')))
})

test('refusal decoders preserve frozen null bindings without weakening the four-code vocabulary', () => {
  const expectedNullBindings: Readonly<Record<string, number>> = {
    'unsupported-fill.json': 1,
    'ambiguous-control.json': 1,
    'insufficient-outcome.json': 1,
    'app-area-unknown.json': 0,
  }
  for (const [name, expectedCount] of Object.entries(expectedNullBindings)) {
    const result = decodeManualAnalysisResultV1(fixture(name))
    assert.equal(result.outcome.kind, 'refusal')
    if (result.outcome.kind !== 'refusal') throw new Error('Expected refusal')
    assert.equal(result.outcome.refusal.sourceGrounding.filter(item => item.canonicalBinding === null).length, expectedCount)
  }

  const refusalGroundingHostiles: readonly [string, (envelope: any) => void][] = [
    ['non-grounded refusal fragment with a canonical binding', envelope => {
      envelope.outcome.refusal.sourceGrounding[1].canonicalBinding = { kind: 'action', ordinal: 1 }
    }],
    ['refusal action 0 with observed flow-step basis', envelope => {
      envelope.outcome.refusal.sourceGrounding[0].basis = { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: ['obs-checkout-route'] }
    }],
    ['refusal source ordinal gap', envelope => {
      envelope.outcome.refusal.sourceGrounding[2].sourceRef.ordinal = 4
    }],
  ]
  for (const [name, mutate] of refusalGroundingHostiles) {
    const malformed = structuredClone(fixture('unsupported-fill.json')) as any
    mutate(malformed)
    assert.throws(() => decodeManualAnalysisResultV1(malformed), name)
  }
  assert.equal(refusalGroundingHostiles.length, 3)
})

test('promotion request contains only frozen source and reviewed-proposal authorities', () => {
  const body = buildManualPromotionRequest(proposal)
  assert.deepEqual(Object.keys(body).sort(), ['reviewedProposalAuthority', 'schemaVersion', 'sourceAuthority'])
  assert.equal(body.schemaVersion, 'forge-manual-promotion-request/v1')
  assert.deepEqual(Object.keys(body.sourceAuthority).sort(), ['sourceContentHash', 'sourceId'])
  assert.deepEqual(Object.keys(body.reviewedProposalAuthority).sort(), ['proposalContentHash', 'proposalId'])
  const serialized = JSON.stringify(body)
  for (const forbidden of ['"actions"', '"selector"', '"appArea"', '"oracle"', '"authenticationExpectation"', '"grounding"', '"definition"']) assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'))
})

test('supported proposal is read-only, shows human labels, and distinguishes navigation from App Model flow grounding', () => {
  const html = render(React.createElement(M3ProposalReview, { proposal, source: sourceDraft }))
  for (const expected of ['Manual source fragment', 'Interpretation', 'Canonical binding', 'Evidence basis', 'Step 1', 'Step 2', 'Final oracle', 'Auth expectation', 'Navigation grounding — governed route; not an App Model flow step']) assert.match(html, new RegExp(expected))
  assert.doesNotMatch(html, /<input|<textarea|contenteditable/)
})

test('all four refusals preserve unsupported source and expose no Save, Run, or partial-automation claim', () => {
  const drafts: Record<string, M3ManualDraft> = {
    'unsupported-fill.json': { ...sourceDraft, steps: ['Open checkout.', 'Fill first name.', 'Click Continue.'] },
    'ambiguous-control.json': sourceDraft,
    'insufficient-outcome.json': sourceDraft,
    'app-area-unknown.json': sourceDraft,
  }
  for (const [name, draft] of Object.entries(drafts)) {
    const result = decodeManualAnalysisResultV1(fixture(name))
    assert.equal(result.outcome.kind, 'refusal')
    if (result.outcome.kind !== 'refusal') throw new Error('Expected refusal')
    const html = render(React.createElement(M3RefusalReview, { refusal: result.outcome.refusal, source: draft }))
    draft.steps.forEach(step => assert.match(html, new RegExp(step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))
    assert.match(html, /Exact affected source fragment/)
    assert.match(html, /No Save\. No Run\. No partial-automation claim\./)
    assert.doesNotMatch(html, /<button|href="\/run|Accept and Save/)
  }
})

test('editing source after Analyze invalidates proposal and disables Save until re-Analyze', async () => {
  const adapter: M3ManualTestAdapter = {
    mode: 'backend',
    analyze: async () => supportedReceipt(),
    promote: async () => saveResult,
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    assert.ok(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')))
    const input = renderer.root.findByType('input')
    await act(async () => { input.props.onChange({ target: { value: `${source.title} edited` } }) })
    assert.match(nodeText(renderer.root), /Source changed after Analyze\. Re-Analyze and review again/)
    assert.equal(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')), false)
  } finally { renderer?.unmount() }
})

test('Analyze replaces review state with the backend-admitted immutable source, never draft-made authority', async () => {
  const admitted = { ...source, title: 'Backend-admitted checkout source' }
  const adapter: M3ManualTestAdapter = {
    mode: 'backend',
    analyze: async () => ({ source: admitted, analysis: proposalAnalysis() }),
    promote: async () => saveResult,
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    assert.match(nodeText(renderer.root), /Backend-admitted checkout source/)
    assert.equal(renderer.root.findByType('input').props.value, admitted.title)
    assert.match(nodeText(renderer.root), new RegExp(proposal.sourceAuthority.sourceId))
  } finally { renderer?.unmount() }
})

test('successful promotion sends the exact minimal body and exposes backend authority plus explicit Suite handoff', async () => {
  let sent: unknown = null
  const previousWindow = (globalThis as { window?: unknown }).window
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } } })
  const adapter: M3ManualTestAdapter = {
    mode: 'backend',
    analyze: async () => supportedReceipt(),
    promote: async (_projectId, request) => { sent = request; return saveResult },
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer)
    assert.equal(renderer.root.findAllByType('a').some(anchor => String(anchor.props.href).startsWith('/run?')), false)
    await submitAnalyze(renderer)
    const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
    assert.ok(save)
    await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.deepEqual(sent, buildManualPromotionRequest(proposal))
    const text = nodeText(renderer.root)
    for (const expected of [saveResult.sourceAuthority.sourceId, saveResult.sourceAuthority.sourceContentHash, saveResult.proposalAuthority.proposalId, saveResult.proposalAuthority.proposalContentHash, saveResult.definitionAuthority.definitionId, saveResult.definitionAuthority.testSetId, String(saveResult.definitionAuthority.testSetRevision), saveResult.definitionAuthority.testSetContentHash]) assert.match(text, new RegExp(expected))
    assert.match(text, /schema\s+3/)
    const hrefs = renderer.root.findAllByType('a').map(anchor => anchor.props.href)
    assert.ok(hrefs.some(href => String(href).startsWith('/run?')))
    assert.ok(hrefs.includes(`/run?project=${encodeURIComponent(source.projectId)}&definition=${encodeURIComponent(saveResult.definitionAuthority.definitionId)}&revision=${saveResult.definitionAuthority.testSetRevision}`))
    assert.ok(hrefs.includes('#saved-suites-workspace'))
    assert.match(text, /normal canonical v3 preflight\/Start route/)
    assert.match(text, /separate explicit M2 workflow/)
    assert.equal(JSON.parse([...values.values()][0]).definitionId, saveResult.definitionAuthority.definitionId)
  } finally {
    renderer?.unmount()
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})

test('source mismatch and identity conflict preserve the exact reviewed backend authority without local mutation', async () => {
  for (const code of ['SOURCE_PROPOSAL_MISMATCH', 'MANUAL_PROMOTION_IDENTITY_CONFLICT'] as const) {
    const adapter: M3ManualTestAdapter = {
      mode: 'backend', analyze: async () => supportedReceipt(),
      promote: async () => { throw new M3ManualPromotionError(code) },
    }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(workspace(adapter)) })
      await fillDraft(renderer); await submitAnalyze(renderer)
      const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
      assert.ok(save)
      await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 10)) })
      const text = nodeText(renderer.root)
      assert.match(text, new RegExp(proposal.proposalId))
      assert.match(text, new RegExp(proposal.proposalContentHash))
      assert.ok(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')))
      assert.doesNotMatch(text, /Manual source promoted/)
    } finally { renderer?.unmount() }
  }
})

test('not-executable Save returns to review/reanalysis and cannot be retried as partial success', async () => {
  const adapter: M3ManualTestAdapter = {
    mode: 'backend', analyze: async () => supportedReceipt(),
    promote: async () => { throw new M3ManualPromotionError('MANUAL_PROPOSAL_NOT_EXECUTABLE') },
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
    assert.ok(save)
    await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 10)) })
    const text = nodeText(renderer.root)
    assert.match(text, /not executable.*Review the preserved proposal.*Analyze again/i)
    assert.match(text, new RegExp(proposal.proposalId))
    assert.equal(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')), false)
    assert.doesNotMatch(text, /Manual source promoted|partial success/i)
  } finally { renderer?.unmount() }
})

test('exact replay Save response remains one canonical UI authority', async () => {
  let calls = 0
  const adapter: M3ManualTestAdapter = {
    mode: 'backend', analyze: async () => supportedReceipt(),
    promote: async () => { calls += 1; return saveResult },
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
    assert.ok(save)
    await act(async () => {
      save.props.onClick()
      save.props.onClick()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    assert.equal(calls, 2)
    assert.equal(renderer.root.findAllByType('h3').filter(node => nodeText(node).includes('Manual source promoted')).length, 1)
    assert.equal(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')), false)
  } finally { renderer?.unmount() }
})

test('stale reviewed proposal is never auto-accepted and requires Analyze plus review again', async () => {
  const adapter: M3ManualTestAdapter = {
    mode: 'backend',
    analyze: async () => supportedReceipt(),
    promote: async () => { throw new M3ManualPromotionError('STALE_REVIEWED_PROPOSAL') },
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
    assert.ok(save)
    await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.match(nodeText(renderer.root), /reviewed proposal is stale.*Analyze again and review/i)
    assert.equal(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')), false)
  } finally { renderer?.unmount() }
})

test('all frozen promotion failures have distinct truthful public handling', () => {
  const messages = [
    m3PromotionErrorMessage('SOURCE_PROPOSAL_MISMATCH'),
    m3PromotionErrorMessage('MANUAL_PROMOTION_IDENTITY_CONFLICT'),
    m3PromotionErrorMessage('STALE_REVIEWED_PROPOSAL'),
    m3PromotionErrorMessage('MANUAL_PROPOSAL_NOT_EXECUTABLE'),
  ]
  assert.equal(new Set(messages).size, 4)
  assert.match(messages[0], /does not belong to this source.*Nothing was saved/i)
  assert.match(messages[1], /identity.*Nothing was saved/i)
  assert.match(messages[2], /Analyze again.*did not auto-accept/i)
  assert.match(messages[3], /not executable.*cannot be promoted/i)
})

test('production adapter uses the exact frozen Analyze/Save endpoints, DTOs, and decoders', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ path: string; body: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    calls.push({ path, body: JSON.parse(String(init?.body)) })
    const data = path.endsWith('/analyze') ? supportedReceipt() : saveResult
    return new Response(JSON.stringify({ data }), { status: path.endsWith('/analyze') ? 200 : 201, headers: { 'content-type': 'application/json' } })
  }
  try {
    assert.equal(m3ManualTestAdapter.mode, 'backend')
    assert.deepEqual(await m3ManualTestAdapter.analyze(source.projectId, sourceDraft), supportedReceipt())
    assert.deepEqual(await m3ManualTestAdapter.promote(source.projectId, buildManualPromotionRequest(proposal)), saveResult)
    assert.deepEqual(calls, [
      { path: `/api/v1/projects/${source.projectId}/manual-tests/analyze`, body: buildManualAnalyzeRequest(sourceDraft) },
      { path: `/api/v1/projects/${source.projectId}/manual-tests/save`, body: buildManualPromotionRequest(proposal) },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('Analyze MANUAL_SOURCE_INVALID is distinct from semantic refusal and 404/500 transport failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid', code: 'MANUAL_SOURCE_INVALID' }), { status: 400 })
    await assert.rejects(() => m3ManualTestAdapter.analyze(source.projectId, sourceDraft), M3ManualAnalyzeInputError)
    assert.match(m3AnalyzeErrorMessage(new M3ManualAnalyzeInputError()), /input error, not a semantic automation refusal/i)
    assert.match(m3AnalyzeErrorMessage(new ApiError('missing', 404, 'NOT_FOUND')), /project was not found/i)
    assert.match(m3AnalyzeErrorMessage(new ApiError('internal', 500, 'INTERNAL_ERROR')), /failed internally.*No semantic refusal/i)
  } finally { globalThis.fetch = originalFetch }
})

test('workspace renders MANUAL_SOURCE_INVALID as input failure with no refusal, Save, or Run authority', async () => {
  const adapter: M3ManualTestAdapter = {
    mode: 'backend',
    analyze: async () => { throw new M3ManualAnalyzeInputError() },
    promote: async () => saveResult,
  }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(workspace(adapter)) })
    await fillDraft(renderer); await submitAnalyze(renderer)
    const text = nodeText(renderer.root)
    assert.match(text, /input error, not a semantic automation refusal/i)
    assert.doesNotMatch(text, /Automation refused|Accept and Save|Manual source promoted/)
    assert.equal(renderer.root.findAllByType('a').some(anchor => String(anchor.props.href).startsWith('/run?')), false)
  } finally { renderer?.unmount() }
})

test('workspace treats Analyze 404/500 as transport failures and never semantic refusals', async () => {
  for (const error of [new ApiError('missing', 404, 'NOT_FOUND'), new ApiError('internal', 500, 'INTERNAL_ERROR')]) {
    const adapter: M3ManualTestAdapter = {
      mode: 'backend',
      analyze: async () => { throw error },
      promote: async () => saveResult,
    }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(workspace(adapter)) })
      await fillDraft(renderer); await submitAnalyze(renderer)
      const text = nodeText(renderer.root)
      assert.match(text, error.status === 404 ? /project was not found/i : /failed internally/i)
      assert.doesNotMatch(text, /Automation refused|Accept and Save|Manual source promoted/)
      assert.equal(renderer.root.findAllByType('a').some(anchor => String(anchor.props.href).startsWith('/run?')), false)
    } finally { renderer?.unmount() }
  }
})

test('Save classifies only the four frozen status/code pairs as governed promotion failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [code, status] of [
      ['SOURCE_PROPOSAL_MISMATCH', 409],
      ['MANUAL_PROMOTION_IDENTITY_CONFLICT', 409],
      ['STALE_REVIEWED_PROPOSAL', 409],
      ['MANUAL_PROPOSAL_NOT_EXECUTABLE', 422],
    ] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: code, code }), { status })
      await assert.rejects(
        () => m3ManualTestAdapter.promote(source.projectId, buildManualPromotionRequest(proposal)),
        (error: unknown) => error instanceof M3ManualPromotionError && error.code === code,
      )
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'internal', code: 'STALE_REVIEWED_PROPOSAL' }), { status: 500 })
    await assert.rejects(() => m3ManualTestAdapter.promote(source.projectId, buildManualPromotionRequest(proposal)), ApiError)
    assert.match(m3SaveTransportErrorMessage(new ApiError('missing', 404, 'NOT_FOUND')), /project was not found.*Nothing was saved/i)
    assert.match(m3SaveTransportErrorMessage(new ApiError('internal', 500, 'INTERNAL_ERROR')), /failed internally.*local review authority was not changed/i)
  } finally { globalThis.fetch = originalFetch }
})

test('workspace preserves reviewed authority on Save 404/500 without refusal or success claims', async () => {
  for (const error of [new ApiError('missing', 404, 'NOT_FOUND'), new ApiError('internal', 500, 'INTERNAL_ERROR')]) {
    const adapter: M3ManualTestAdapter = {
      mode: 'backend', analyze: async () => supportedReceipt(),
      promote: async () => { throw error },
    }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(workspace(adapter)) })
      await fillDraft(renderer); await submitAnalyze(renderer)
      const save = renderer.root.findAllByType('button').find(button => nodeText(button).includes('Accept and Save'))
      assert.ok(save)
      await act(async () => { save.props.onClick(); await new Promise(resolve => setTimeout(resolve, 10)) })
      const text = nodeText(renderer.root)
      assert.match(text, error.status === 404 ? /project was not found.*Nothing was saved/i : /failed internally.*local review authority was not changed/i)
      assert.match(text, new RegExp(proposal.proposalId))
      assert.ok(renderer.root.findAllByType('button').some(button => nodeText(button).includes('Accept and Save')))
      assert.doesNotMatch(text, /Automation refused|Manual source promoted/)
    } finally { renderer?.unmount() }
  }
})

function v3Definition(sourceKind: 'discovered' | 'manual') {
  const hash = 'a'.repeat(64)
  return {
    schemaVersion: 3, authorityClass: 'canonical_v3', definitionId: 'definition-v3-cart', title: 'Checkout', intent: 'Verify checkout.', category: 'observed_flow', subjects: ['subject-cart', 'subject-checkout'], generationMethod: 'deterministic',
    validation: { state: 'valid', explanation: 'Validated.' }, intrinsicCompatibility: { state: 'compatible', reason: null, explanation: 'Compatible.' }, confidenceLimitations: [], materialUnknowns: [], unobservedScope: [], preventedStrongerDefinition: 'Bounded.',
    provenance: { label: 'SEALED CANONICAL SUPPORT', modelRowId: 1, modelVersion: 'v1', supportSealHash: hash, supportingObservationCount: 2, supportingGapCount: 0, subjectSupportCount: 2, supportingObservationIds: ['obs-cart', 'obs-checkout'], supportingGapIds: [], intentId: 'intent-cart', intentContentHash: hash },
    appArea: 'checkout', routeEvidence: { state: 'available_flow', normalizationPolicy: { id: 'route-policy', version: '1' }, supportingObservationCount: 2, supportingObservationIds: ['obs-cart', 'obs-checkout'], routes: [{ subjectId: 'subject-cart', normalizedPath: '/cart', supportingObservationIds: ['obs-cart'] }, { subjectId: 'subject-checkout', normalizedPath: '/checkout', supportingObservationIds: ['obs-checkout'] }] },
    authenticationExpectation: { state: 'required', mechanism: 'form-login', basis: [{ kind: 'declared_configuration', policyId: 'auth-policy', policyVersion: '1' }] },
    actions: [{ stepId: 'step-nav', ordinal: 0, kind: 'navigate_to_observed_route', subjectId: 'subject-cart', normalizedPath: '/cart' }, { stepId: 'step-click', ordinal: 1, kind: 'click_observed_data_test', subjectId: 'subject-cart', elementId: 'element-checkout', dataTestValue: 'checkout', targetSubjectId: 'subject-checkout' }], oracle: { kind: 'subject_observable', subjectId: 'subject-checkout', explanation: 'Checkout is observable.' },
    normalizedIntent: { intentId: 'intent-cart', source: sourceKind, sourceFlowId: 'flow-cart', selectedFlowStepIndexes: [0], excludedFlowStepIndexes: [], limitations: [] }, executionPolicy: 'canonical_v3_preflight_required',
  }
}

test('inventory accepts v3 manual origin without weakening discovered validation', () => {
  assert.doesNotThrow(() => validateCanonicalV3DefinitionPresentation(v3Definition('manual')))
  assert.doesNotThrow(() => validateCanonicalV3DefinitionPresentation(v3Definition('discovered')))
  const invalid = v3Definition('discovered') as any; invalid.normalizedIntent.source = 'natural-language'
  assert.throws(() => validateCanonicalV3DefinitionPresentation(invalid))
  assert.equal(typeof decodeTestInventoryResponse, 'function')
  const definition = v3Definition('manual') as any
  const html = render(React.createElement(EvidenceBackedTestInventory, {
    testSet: { schemaVersion: 3, definitions: [definition] } as any,
    project: 'project-storefront', selected: definition.definitionId, onToggle() {},
  }))
  assert.match(html, /Origin: promoted manual source/)
  assert.match(html, />manual</)
})

test('Results provenance seam renders only immutable transported authority', () => {
  const provenance = decodeManualResultsProvenanceV1({ origin: 'promoted_manual_source', sourceAuthority: saveResult.sourceAuthority, proposalAuthority: saveResult.proposalAuthority, definitionAuthority: saveResult.definitionAuthority })
  const html = render(React.createElement(M3ManualResultsProvenance, { provenance }))
  for (const expected of ['Origin: promoted manual source', provenance.sourceAuthority.sourceId, provenance.sourceAuthority.sourceContentHash, provenance.proposalAuthority.proposalId, provenance.proposalAuthority.proposalContentHash, provenance.definitionAuthority.definitionId]) assert.match(html, new RegExp(expected))
  assert.doesNotMatch(html, /current source|current proposal/i)
})

test('workspace source includes keyboard, focus, and responsive controls without editable proposal fields', () => {
  const sourceText = fs.readFileSync(path.join(repositoryRoot, 'forge-ui', 'src', 'components', 'tests', 'M3ManualTestWorkspace.tsx'), 'utf8')
  for (const expected of ['type="button"', 'aria-label={`Move Step', 'focus-visible:ring-2', 'sm:grid-cols-', 'overflow-x-auto', 'stepRefs.current[focusStep]?.focus()']) assert.ok(sourceText.includes(expected), expected)
})
