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
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import {
  buildSuiteExecutionStartBody,
  decodeCanonicalSuiteCandidateSet,
  decodeCanonicalSuiteHeads,
  decodeCanonicalSuiteRevision,
  decodeCanonicalSuiteSelectionAuthority,
  parseSuitePresentationIntent,
  SuiteContractError,
  validateSuiteDraft,
  type SuiteDefinitionAuthority,
} from '../forge-ui/src/api/suiteContract'
import { suiteTransport, SuiteTransportUnavailableError } from '../forge-ui/src/api/suiteAdapter'
import { SavedSuitesWorkspace } from '../forge-ui/src/components/tests/SavedSuitesWorkspace'
import { SuiteResultsProvenance } from '../forge-ui/src/components/tests/SuiteResultsProvenance'
import { resolveSuiteRunDependencyState } from '../forge-ui/src/pages/RunPage'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const SUITE_ID = 'suite-123e4567-e89b-12d3-a456-426614174000'
const SUITE_ID_B = 'suite-123e4567-e89b-12d3-a456-426614174001'
const CREATED_AT = '2026-08-25T12:00:00.000Z'
const authority = (definitionId: string, schema: 2 | 3 = 2): SuiteDefinitionAuthority => ({
  definitionId,
  definitionSchemaVersion: schema,
  testSetId: 'test-set-1',
  testSetRevision: 7,
  testSetContentHash: HASH_A,
})

function revision(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    suiteId: SUITE_ID,
    projectId: 'project-1',
    revision: 1,
    name: 'Checkout Sanity',
    purpose: 'sanity',
    members: [
      { ordinal: 1, definitionAuthority: authority('definition-a') },
      { ordinal: 2, definitionAuthority: authority('definition-b') },
    ],
    createdAt: CREATED_AT,
    provenance: {
      source: 'product_api',
      changeKind: 'created',
      priorRevision: null,
      changeIntentKey: 'change-1',
      changeIntentFingerprint: HASH_B,
    },
    contentHash: HASH_A,
    ...overrides,
  }
}

function readyWorkspace(
  head: ReturnType<typeof decodeCanonicalSuiteRevision>,
  props: Partial<React.ComponentProps<typeof SavedSuitesWorkspace>> = {},
) {
  const candidates = decodeCanonicalSuiteCandidateSet({
    projectId: head.projectId,
    testSetAuthority: {
      definitionSchemaVersion: head.members[0].definitionAuthority.definitionSchemaVersion,
      testSetId: head.members[0].definitionAuthority.testSetId,
      testSetRevision: head.members[0].definitionAuthority.testSetRevision,
      testSetContentHash: head.members[0].definitionAuthority.testSetContentHash,
    },
    definitions: head.members.map(member => ({ title: member.definitionAuthority.definitionId, definitionAuthority: member.definitionAuthority })),
  }, head.projectId)
  return React.createElement(MemoryRouter, null, React.createElement(SavedSuitesWorkspace, {
    projectId: head.projectId,
    state: { kind: 'ready', heads: [head], candidates },
    readRevision: async () => head,
    ...props,
  }))
}

function textOf(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join(' ')
}

function button(renderer: ReactTestRenderer, label: RegExp): ReactTestInstance {
  const match = renderer.root.findAllByType('button').find(item => label.test(textOf(item)))
  assert.ok(match, `Expected button matching ${label}.`)
  return match
}

async function openAndEdit(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => { button(renderer, /^Checkout Sanity/).props.onClick(); await Promise.resolve() })
  await act(async () => { button(renderer, /Edit as new revision/).props.onClick(); await Promise.resolve() })
}

test('canonical Suite decoder preserves exact immutable order and authority', () => {
  const decoded = decodeCanonicalSuiteRevision(revision(), 'project-1')
  assert.equal(decoded.name, 'Checkout Sanity')
  assert.deepEqual(decoded.members.map(item => item.definitionAuthority.definitionId), ['definition-a', 'definition-b'])
  assert.equal(decoded.members[0].definitionAuthority.testSetContentHash, HASH_A)
  assert.ok(Object.isFrozen(decoded))
})

test('Suite identity uses only canonical lowercase suite-prefixed UUID grammar across decoders', () => {
  const canonical = decodeCanonicalSuiteRevision(revision(), 'project-1')
  assert.equal(canonical.suiteId, SUITE_ID)
  assert.equal(decodeCanonicalSuiteHeads({ suites: [revision()] }, 'project-1')[0].suiteId, SUITE_ID)
  assert.equal(decodeCanonicalSuiteSelectionAuthority({ kind: 'suite_revision', suiteId: SUITE_ID, suiteRevision: 1, suiteContentHash: HASH_A, name: 'Checkout Sanity', purpose: 'sanity' }).suiteId, SUITE_ID)
  assert.deepEqual(parseSuitePresentationIntent(new URLSearchParams(`suiteId=${SUITE_ID}&suiteRevision=1`)), { suiteId: SUITE_ID, suiteRevision: 1 })
  assert.equal(buildSuiteExecutionStartBody('execution-identity', { suiteId: SUITE_ID, suiteRevision: 1 }).selection.suiteId, SUITE_ID)

  const invalid: readonly unknown[] = [
    'suite-1',
    'abc',
    '123e4567-e89b-12d3-a456-426614174000',
    'suite-123E4567-e89b-12d3-a456-426614174000',
    'suite-123e4567-e89b-12d3-a456-42661417400',
    ` ${SUITE_ID}`,
    `${SUITE_ID} `,
    null,
    42,
  ]
  for (const suiteId of invalid) {
    assert.throws(() => decodeCanonicalSuiteRevision(revision({ suiteId }), 'project-1'), SuiteContractError)
    assert.throws(() => decodeCanonicalSuiteHeads({ suites: [revision({ suiteId })] }, 'project-1'), SuiteContractError)
    assert.throws(() => decodeCanonicalSuiteSelectionAuthority({ kind: 'suite_revision', suiteId, suiteRevision: 1, suiteContentHash: HASH_A, name: 'Checkout Sanity', purpose: 'sanity' }), SuiteContractError)
    assert.throws(() => parseSuitePresentationIntent(new URLSearchParams(`suiteId=${String(suiteId)}&suiteRevision=1`)), SuiteContractError)
    assert.throws(() => buildSuiteExecutionStartBody('execution-identity', { suiteId: suiteId as string, suiteRevision: 1 }), SuiteContractError)
  }
})

test('createdAt accepts only exact millisecond UTC ISO output and rejects alternate parseable forms', () => {
  const emitted = new Date(CREATED_AT).toISOString()
  assert.equal(emitted, CREATED_AT)
  assert.equal(decodeCanonicalSuiteRevision(revision({ createdAt: emitted })).createdAt, CREATED_AT)

  const invalid: readonly unknown[] = [
    '2026-08-25',
    '2026-08-25T12:00:00.000',
    '2026-08-25T12:00:00.000+00:00',
    '2026-08-25T13:00:00.000+01:00',
    '8/25/2026 12:00:00 PM',
    '2026-08-25T12:00:00.00Z',
    '2026-08-25T12:00:00.0000Z',
    '2026-02-30T12:00:00.000Z',
    ` ${CREATED_AT}`,
    `${CREATED_AT} `,
    null,
    42,
  ]
  for (const createdAt of invalid) assert.throws(() => decodeCanonicalSuiteRevision(revision({ createdAt })), SuiteContractError)
})

test('current v3 one-member Suite is accepted without upgrading or weakening its schema', () => {
  const decoded = decodeCanonicalSuiteRevision(revision({ members: [{ ordinal: 1, definitionAuthority: authority('definition-v3', 3) }] }))
  assert.equal(decoded.members.length, 1)
  assert.equal(decoded.members[0].definitionAuthority.definitionSchemaVersion, 3)
})

for (const [label, mutate] of [
  ['ordinal gap', (value: any) => { value.members[1].ordinal = 3 }],
  ['duplicate member', (value: any) => { value.members[1].definitionAuthority.definitionId = 'definition-a' }],
  ['mixed Test Set IDs', (value: any) => { value.members[1].definitionAuthority.testSetId = 'test-set-2' }],
  ['mixed Test Set revisions', (value: any) => { value.members[1].definitionAuthority.testSetRevision = 8 }],
  ['mixed hashes', (value: any) => { value.members[1].definitionAuthority.testSetContentHash = HASH_B }],
  ['mixed schemas', (value: any) => { value.members[1].definitionAuthority.definitionSchemaVersion = 3 }],
  ['v1 member', (value: any) => { value.members[0].definitionAuthority.definitionSchemaVersion = 1 }],
  ['cross-project payload', (value: any) => { value.projectId = 'project-2' }],
  ['unknown authority field', (value: any) => { value.members[0].definitionAuthority.membership = [] }],
] as const) {
  test(`malformed Suite payload refuses ${label}`, () => {
    const value = structuredClone(revision()); mutate(value)
    assert.throws(() => decodeCanonicalSuiteRevision(value, 'project-1'), SuiteContractError)
  })
}

test('draft validation refuses empty, duplicate, over-50, and cross-Test-Set selection', () => {
  assert.match(validateSuiteDraft('Checkout Sanity', [])!, /at least one/)
  assert.match(validateSuiteDraft('Checkout Sanity', [authority('a'), authority('a')])!, /only once/)
  assert.match(validateSuiteDraft('Checkout Sanity', Array.from({ length: 51 }, (_, index) => authority(`d-${index}`)))!, /at most 50/)
  assert.match(validateSuiteDraft('Checkout Sanity', [authority('a'), { ...authority('b'), testSetContentHash: HASH_B }])!, /one exact Test Set/)
})

test('candidate decoder refuses cross-Test-Set injection and duplicate candidate identity', () => {
  const value = {
    projectId: 'project-1',
    testSetAuthority: { definitionSchemaVersion: 2, testSetId: 'test-set-1', testSetRevision: 7, testSetContentHash: HASH_A },
    definitions: [{ title: 'A', definitionAuthority: authority('a') }],
  }
  assert.equal(decodeCanonicalSuiteCandidateSet(value, 'project-1').definitions.length, 1)
  assert.throws(() => decodeCanonicalSuiteCandidateSet({ ...value, definitions: [{ title: 'A', definitionAuthority: { ...authority('a'), testSetId: 'other' } }] }, 'project-1'), SuiteContractError)
  assert.throws(() => decodeCanonicalSuiteCandidateSet({ ...value, definitions: [...value.definitions, ...value.definitions] }, 'project-1'), SuiteContractError)
})

test('Suite Run handoff is presentation intent only and malformed/changed sessions fail closed', () => {
  assert.equal(parseSuitePresentationIntent(new URLSearchParams()), null)
  assert.deepEqual(parseSuitePresentationIntent(new URLSearchParams(`suiteId=${SUITE_ID}&suiteRevision=4`)), { suiteId: SUITE_ID, suiteRevision: 4 })
  assert.equal(resolveSuiteRunDependencyState(new URLSearchParams(`suiteId=${SUITE_ID}&suiteRevision=4`)).kind, 'core_transport_unavailable')
  assert.equal(resolveSuiteRunDependencyState(new URLSearchParams(`suiteId=${SUITE_ID}`)).kind, 'malformed')
  assert.throws(() => parseSuitePresentationIntent(new URLSearchParams(`suiteId=${SUITE_ID_B}&suiteRevision=0`)), SuiteContractError)
})

test('Suite Start body contains only intent key and Suite selection authority', () => {
  const body = buildSuiteExecutionStartBody('execution-1', { suiteId: SUITE_ID, suiteRevision: 4 })
  assert.deepEqual(body, { executionIntentKey: 'execution-1', selection: { kind: 'suite_revision', suiteId: SUITE_ID, suiteRevision: 4 } })
  const serialized = JSON.stringify(body)
  for (const forbidden of ['members', 'definitionIds', 'testSetId', 'suiteContentHash', 'name', 'purpose']) assert.doesNotMatch(serialized, new RegExp(forbidden))
})

test('Results Suite provenance decoder and presenter retain accepted historical name/revision', () => {
  const accepted = decodeCanonicalSuiteSelectionAuthority({ kind: 'suite_revision', suiteId: SUITE_ID, suiteRevision: 1, suiteContentHash: HASH_A, name: 'Checkout Sanity', purpose: 'sanity' })
  const html = renderToStaticMarkup(React.createElement(SuiteResultsProvenance, { authority: accepted }))
  assert.match(html, /Checkout Sanity/)
  assert.match(html, /Immutable accepted Suite provenance/)
  assert.match(html, />1</)
  assert.match(html, /never the current Suite head/i)
  assert.doesNotMatch(html, /Renamed head/)
  assert.throws(() => decodeCanonicalSuiteSelectionAuthority({ ...accepted, currentName: 'Renamed head' }), SuiteContractError)
})

test('production adapter fails explicitly without guessing endpoint paths', async () => {
  await assert.rejects(() => suiteTransport.listHeads('project-1'), SuiteTransportUnavailableError)
  await assert.rejects(() => suiteTransport.refreshCurrentHead('project-1', SUITE_ID), SuiteTransportUnavailableError)
})

test('opened Suite remains readable while Run is disabled without exact backend eligibility', async () => {
  const head = decodeCanonicalSuiteRevision(revision(), 'project-1')
  let renderer: ReactTestRenderer | undefined
  await act(async () => { renderer = create(readyWorkspace(head)) })
  try {
    await act(async () => { button(renderer!, /^Checkout Sanity/).props.onClick(); await Promise.resolve() })
    assert.match(textOf(renderer!.root), /Immutable Suite revision/)
    assert.match(textOf(renderer!.root), /Execution eligibility requires authoritative backend verification/)
    assert.equal(button(renderer!, /Run unavailable/).props.disabled, true)
    assert.equal(renderer!.root.findAllByType('a').some(link => String(link.props.href).startsWith('/run?')), false)
  } finally {
    if (renderer) await act(async () => { renderer!.unmount() })
  }
})

test('cached head cannot satisfy reload; authoritative mock refresh opens its newly returned head', async () => {
  const stale = decodeCanonicalSuiteRevision(revision(), 'project-1')
  const current = decodeCanonicalSuiteRevision(revision({
    revision: 2,
    name: 'Current Checkout Sanity',
    provenance: {
      source: 'product_api',
      changeKind: 'revised',
      priorRevision: 1,
      changeIntentKey: 'change-2',
      changeIntentFingerprint: HASH_B,
    },
  }), 'project-1')
  let refreshCalls = 0
  let renderer: ReactTestRenderer | undefined
  await act(async () => { renderer = create(readyWorkspace(stale, {
    save: async () => { throw Object.assign(new Error('stale'), { code: 'stale_suite_revision' }) },
    refreshCurrentHead: async () => { refreshCalls += 1; return current },
  })) })
  try {
    await openAndEdit(renderer!)
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
    assert.match(textOf(renderer!.root), /Suite changed since this draft was opened/)
    await act(async () => { button(renderer!, /Reload current revision/).props.onClick(); await Promise.resolve() })
    assert.equal(refreshCalls, 1)
    assert.match(textOf(renderer!.root), /Current Checkout Sanity/)
    assert.match(textOf(renderer!.root), /revision 2/)
    assert.match(textOf(renderer!.root), /Loaded authoritative current Suite revision 2/)
    assert.doesNotMatch(textOf(renderer!.root), /New revision from 1/)
  } finally {
    if (renderer) await act(async () => { renderer!.unmount() })
  }
})

test('failed current-head refresh preserves the stale draft and previously opened revision', async () => {
  const stale = decodeCanonicalSuiteRevision(revision(), 'project-1')
  let renderer: ReactTestRenderer | undefined
  await act(async () => { renderer = create(readyWorkspace(stale, {
    save: async () => { throw Object.assign(new Error('stale'), { code: 'stale_suite_revision' }) },
    refreshCurrentHead: async () => { throw new SuiteTransportUnavailableError() },
  })) })
  try {
    await openAndEdit(renderer!)
    const name = renderer!.root.findAllByType('input').find(input => input.props.maxLength === 120)
    assert.ok(name)
    await act(async () => { name.props.onChange({ target: { value: 'Stale edited draft' } }); await Promise.resolve() })
    await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
    await act(async () => { button(renderer!, /Reload current revision/).props.onClick(); await Promise.resolve() })
    assert.match(textOf(renderer!.root), /current Suite head could not be refreshed/)
    assert.equal(renderer!.root.findAllByType('input').find(input => input.props.maxLength === 120)?.props.value, 'Stale edited draft')
    assert.match(textOf(renderer!.root), /New revision from 1/)
    await act(async () => { button(renderer!, /^Cancel$/).props.onClick(); await Promise.resolve() })
    assert.match(textOf(renderer!.root), /Immutable Suite revision/)
    assert.match(textOf(renderer!.root), /revision\s+1/)
  } finally {
    if (renderer) await act(async () => { renderer!.unmount() })
  }
})

test('Saved Suites production surface truthfully exposes the Core dependency', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(SavedSuitesWorkspace, { projectId: 'project-1', state: { kind: 'transport_unavailable' } }),
  ))
  assert.match(html, /Saved Suites/)
  assert.match(html, /No endpoint, membership, or current-head state was guessed/)
})

test('RunPage Suite branch cannot fall through to direct-definition workspace', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'forge-ui/src/pages/RunPage.tsx'), 'utf8')
  assert.match(source, /!suiteHandoffRequested && <RunWorkspace/)
  assert.match(source, /No Definition IDs, membership, Test Set authority, Suite hash, name, or purpose were inferred or submitted/)
})
