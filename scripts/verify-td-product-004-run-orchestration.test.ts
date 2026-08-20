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
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError } from '../forge-ui/src/api/client'
import { RunIntentController, disposeRunIntentAuthorities, issueLifecycleQueryTransportAuthority, resolveFreshLifecycleAuthority, runIntentStorageKey, type RunIntentStorage } from '../forge-ui/src/pages/runIntentState'
import { CanonicalExecutionStartAmbiguousError, canonicalExecutionStatusQueryKey, fetchCanonicalExecutionStatus } from '../forge-ui/src/api/executionClient'
import { executionPreflightQueryKey } from '../forge-ui/src/hooks/useApi'
import { isPrepareAnotherRunEligible, RunPage } from '../forge-ui/src/pages/RunPage'

const NOW = '2026-08-18T15:00:00.000Z'
const HASH = 'a'.repeat(64)

class MemoryStorage implements RunIntentStorage {
  private values = new Map<string, string>()
  writes = 0
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.writes += 1; this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

class FailingRetirementStorage extends MemoryStorage {
  failSetAfter = Number.POSITIVE_INFINITY
  failRemove = false
  removes = 0
  override setItem(key: string, value: string) { if (this.writes >= this.failSetAfter) throw new Error('tombstone write failed'); super.setItem(key, value) }
  override removeItem(key: string) { this.removes += 1; if (this.failRemove) throw new Error('cleanup failed'); super.removeItem(key) }
}

function accepted(id: string, replayed = false) {
  return { executionId: id, state: 'accepted' as const, startedAt: NOW, executionPlanHash: HASH, replayed }
}

function terminalStatus(projectId: string, executionId: string, state: 'completed' | 'running' = 'completed') {
  const terminal = state === 'completed'
  return { executionId, projectId, state, outcome: terminal ? 'passed' : null, terminal, startedAt: NOW, completedAt: terminal ? NOW : null, lastHeartbeatAt: NOW, processInstanceId: 'process-1', safeCode: null, safeMessage: 'canonical status', executionPlanHash: HASH }
}

function response(data: unknown, status = 202) {
  return new Response(JSON.stringify({ data, timestamp: NOW }), { status, headers: { 'Content-Type': 'application/json' } })
}

function readyPreflight(project: string, ids: readonly string[], revision: number) {
  return {
    project: { id: project, name: project },
    testSetRevision: { revision, testSetId: 'test-set-1', schemaVersion: 2, contentHash: HASH },
    definitions: ids.map(definitionId => ({ definitionId, schemaVersion: 2, state: 'eligible', semanticPlanHash: HASH, modelRowId: 1, modelVersion: '1', supportSealHash: HASH, routeEvidence: { normalizedPath: `/${definitionId.toLowerCase()}`, normalizationPolicy: { id: 'forge.canonical-route-normalization', version: '1' } }, authenticationExpectation: { state: 'not_required', mechanism: null }, intrinsicCompatibility: 'compatible' })),
    aggregate: { state: 'ready', explanation: 'ready' },
    liveEligibility: { state: 'eligible', runner: 'available', credentials: 'not_required' },
    boundaries: { generationAuthority: 'established', executionEligibility: 'eligible', persisted: false },
  }
}

function makeController(project = 'project-a', storage: RunIntentStorage = new MemoryStorage()) {
  const queryClient = new QueryClient()
  return { controller: new RunIntentController(storage, project, queryClient), queryClient }
}

function prepare(controller: RunIntentController, queryClient: QueryClient, key = 'K1', ids = ['A', 'B'], revision = 4) {
  assert.equal(controller.prepare({ executionIntentKey: key, definitionIds: ids, revision }), true)
  queryClient.setQueryData(executionPreflightQueryKey(projectOf(controller), ids, revision), readyPreflight(projectOf(controller), ids, revision), { updatedAt: Date.now() })
}

function seedPreflight(queryClient: QueryClient, project: string, ids: readonly string[], revision: number, value = readyPreflight(project, ids, revision), updatedAt = Date.now()) {
  queryClient.setQueryData(executionPreflightQueryKey(project, ids, revision), value, { updatedAt })
}

function currentPreflightQuery(queryClient: QueryClient, project = 'project-a', ids = ['A', 'B'], revision = 4) {
  return queryClient.getQueryCache().find({ queryKey: executionPreflightQueryKey(project, ids, revision) })
}

async function assertNoStartRequest(controller: RunIntentController, action: () => void) {
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => {
    await assert.rejects(() => controller.start())
  })
  assert.equal(sends, 0)
  action()
}

function projectOf(controller: RunIntentController): string { return controller.authorityProject() }

function renderedText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('')
}

async function withFetch(handler: typeof fetch, action: () => Promise<unknown>) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  try { return await action() } finally { globalThis.fetch = original }
}

test('valid controller-owned Start sends the exact private intent once and persists acceptance', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  const bodies: unknown[] = []
  await withFetch((async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return response(accepted('execution-a')) }) as typeof fetch, async () => {
    const result = await controller.start()
    assert.equal(result.executionId, 'execution-a')
  })
  assert.deepEqual(bodies, [{ executionIntentKey: 'K1', definitionIds: ['A', 'B'], revision: 4 }])
  assert.equal(controller.snapshot().phase, 'accepted')
})

test('Start has no semantic/request/token parameters', () => {
  const source = fs.readFileSync(path.join(__dirname, '../forge-ui/src/pages/runIntentState.ts'), 'utf8')
  assert.match(source, /start\(\): Promise/)
  assert.doesNotMatch(source, /start\([^)]*attemptAuthority/)
  assert.doesNotMatch(source, /startCanonicalExecution/)
})

test('rapid duplicate Start calls are single-flight at the UI gate boundary', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  let sends = 0; let release!: () => void; const wait = new Promise<void>(r => { release = r })
  const action = () => controller.start()
  const original = globalThis.fetch
  globalThis.fetch = (async (_input, init) => { sends += 1; await wait; return response(accepted('execution-a')) }) as typeof fetch
  try { const first = action(); const second = action(); assert.equal(first, second); release(); await first } finally { globalThis.fetch = original }
  assert.equal(sends, 1)
})

test('accepted state rejects a second Start without HTTP', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  let sends = 0; await withFetch((async () => { sends += 1; return response(accepted('execution-a')) }) as typeof fetch, () => controller.start())
  await assert.rejects(() => controller.start()); assert.equal(sends, 1); assert.equal(controller.snapshot().phase, 'accepted')
})

for (const [label, code, status] of [
  ['400 refusal', 'INVALID_EXECUTION_REQUEST', 400],
  ['409 refusal', 'EXECUTION_INTENT_CONFLICT', 409],
  ['structured 503 refusal', 'EXECUTION_UNAVAILABLE', 503],
] as const) {
  test(`validated ${label} retires the exact intent`, async () => {
    const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
    await withFetch((async () => new Response(JSON.stringify({ error: 'refused', code, timestamp: NOW }), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
    assert.equal(controller.snapshot().phase, 'none')
    assert.equal(storage.getItem(runIntentStorageKey('project-a')), null)
  })
}

test('ambiguous network failure preserves K1 and exact selection for retry', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  await withFetch((async () => { throw new Error('offline') }) as typeof fetch, async () => { await assert.rejects(() => controller.start(), CanonicalExecutionStartAmbiguousError) })
  const state = controller.snapshot(); assert.equal(state.phase, 'ambiguous')
  assert.equal(state.phase === 'ambiguous' && state.intent.executionIntentKey, 'K1')
  assert.deepEqual(state.phase === 'ambiguous' ? state.intent.definitionIds : [], ['A', 'B'])
})

test('ambiguous retry sends the same K1 semantics', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  const bodies: unknown[] = []; let call = 0
  await withFetch((async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); call += 1; if (call === 1) throw new Error('offline'); return response(accepted('execution-a', true)) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()); await controller.start() })
  assert.deepEqual(bodies, [{ executionIntentKey: 'K1', definitionIds: ['A', 'B'], revision: 4 }, { executionIntentKey: 'K1', definitionIds: ['A', 'B'], revision: 4 }])
})

test('prepare input and snapshots are detached from controller authority', () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); const ids = ['A', 'B']; prepare(controller, queryClient, 'K1', ids); ids[0] = 'MUTATED'
  const snapshot = controller.snapshot(); assert.equal(snapshot.phase, 'prepared'); if (snapshot.phase === 'prepared') { assert.deepEqual(snapshot.intent.definitionIds, ['A', 'B']); assert.throws(() => (snapshot.intent.definitionIds as string[]).push('X')) }
})

test('disposed controller cannot Start', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient); disposeRunIntentAuthorities(controller); let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('bad')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) }); assert.equal(sends, 0)
})

test('public production surface has no transferable authority module or token transport', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../forge-ui/src/pages/startAttemptAuthority.ts')), false)
  const execution = fs.readFileSync(path.join(__dirname, '../forge-ui/src/api/executionClient.ts'), 'utf8')
  assert.doesNotMatch(execution, /startCanonicalExecution\s*\(/)
  assert.doesNotMatch(execution, /StartAttemptAuthority|attemptAuthority/)
})

test('semantic fields cannot be injected into controller.start', () => {
  const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  assert.equal((controller.start as unknown as (...args: unknown[]) => unknown).length, 0)
})

test('unknown project context remains private to the controller', () => {
  const { controller, queryClient } = makeController(); prepare(controller, queryClient)
  assert.equal(controller.authorityProject(), 'project-a')
})

test('stored unresolved intent survives reconstruction', async () => {
  const storage = new MemoryStorage(); const firstBundle = makeController('project-a', storage); const first = firstBundle.controller; prepare(first, firstBundle.queryClient)
  await withFetch((async () => { throw new Error('offline') }) as typeof fetch, async () => { await assert.rejects(() => first.start()) })
  const second = new RunIntentController(storage, 'project-a', new QueryClient()); const state = second.snapshot(); assert.equal(state.phase, 'ambiguous'); if (state.phase === 'ambiguous') assert.equal(state.intent.executionIntentKey, 'K1')
})

test('successful Start body cannot be substituted by visible state', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController(); prepare(controller, queryClient, 'K1', ['A', 'B'], 4); const body: any[] = []
  await withFetch((async (_input, init) => { body.push(JSON.parse(String(init?.body))); return response(accepted('execution-a')) }) as typeof fetch, () => controller.start())
  assert.deepEqual(body[0], { executionIntentKey: 'K1', definitionIds: ['A', 'B'], revision: 4 })
})

test('no legacy execution endpoint fallback exists', () => {
  const source = fs.readFileSync(path.join(__dirname, '../forge-ui/src/pages/runIntentState.ts'), 'utf8'); assert.doesNotMatch(source, /legacy|fallback/i)
})

test('direct start with no exact preflight query sends zero HTTP', async () => {
  const { controller } = makeController(); prepare(controller, new QueryClient())
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
  assert.equal(sends, 0)
})

test('current preflight error blocks retained ready cache before HTTP', async () => {
  const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  const query = currentPreflightQuery(queryClient)
  query?.setState({ ...(query.state as any), status: 'error', error: new Error('revalidation failed'), fetchStatus: 'idle' } as any)
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
  assert.equal(sends, 0)
})

for (const [label, state] of [
  ['fetching', { status: 'success', error: null, fetchStatus: 'fetching' }],
  ['paused', { status: 'success', error: null, fetchStatus: 'paused' }],
] as const) {
  test(`current preflight ${label} blocks Start before HTTP`, async () => {
    const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
    const query = currentPreflightQuery(queryClient)
    query?.setState({ ...(query.state as any), ...state } as any)
    let sends = 0
    await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
    assert.equal(sends, 0)
  })
}

for (const [label, dataUpdatedAt] of [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['zero', 0],
  ['negative finite', -1],
] as const) {
  test(`${label} preflight freshness blocks Start before HTTP`, async () => {
    const { controller, queryClient } = makeController(); prepare(controller, queryClient)
    const query = currentPreflightQuery(queryClient)!
    query.setState({ ...(query.state as any), dataUpdatedAt } as any)
    let sends = 0
    await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
    assert.equal(sends, 0)
  })
}

for (const [label, dataUpdatedAt] of [['minimal', 1], ['extremely large', Number.MAX_VALUE]] as const) {
  test(`${label} finite positive preflight freshness permits exact Start`, async () => {
    const { controller, queryClient } = makeController(); prepare(controller, queryClient)
    const query = currentPreflightQuery(queryClient)!
    query.setState({ ...(query.state as any), dataUpdatedAt } as any)
    const bodies: unknown[] = []
    await withFetch((async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return response(accepted('execution-finite')) }) as typeof fetch, () => controller.start())
    assert.deepEqual(bodies, [{ executionIntentKey: 'K1', definitionIds: ['A', 'B'], revision: 4 }])
  })
}

for (const [label, mutate] of [
  ['wrong project', (value: any) => ({ ...value, project: { ...value.project, id: 'project-b' } })],
  ['wrong revision', (value: any) => ({ ...value, testSetRevision: { ...value.testSetRevision, revision: 5 } })],
  ['reordered definitions', (value: any) => ({ ...value, definitions: [...value.definitions].reverse() })],
  ['missing definition', (value: any) => ({ ...value, definitions: value.definitions.slice(0, 1) })],
  ['extra definition', (value: any) => ({ ...value, definitions: [...value.definitions, { ...value.definitions[0], definitionId: 'C' }] })],
  ['duplicate definition', (value: any) => ({ ...value, definitions: [value.definitions[0], value.definitions[0]] })],
  ['unsafe route', (value: any) => ({ ...value, definitions: value.definitions.map((d: any) => ({ ...d, routeEvidence: { ...d.routeEvidence, normalizedPath: '/../unsafe' } })) })],
  ['contradictory authentication', (value: any) => ({ ...value, definitions: value.definitions.map((d: any) => ({ ...d, authenticationExpectation: { state: 'not_required', mechanism: 'form-login' } })) })],
] as const) {
  test(`current preflight ${label} blocks Start before HTTP`, async () => {
    const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4, mutate(readyPreflight('project-a', ['A', 'B'], 4)))
    let sends = 0
    await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
    assert.equal(sends, 0)
  })
}

test('malformed current preflight payload blocks Start before HTTP', async () => {
  const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4, { malformed: true })
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
  assert.equal(sends, 0)
})

test('storage-blocked controller cannot Start or create a fresh key', async () => {
  const storage: RunIntentStorage = { getItem: () => { throw new Error('unavailable') }, setItem: () => { throw new Error('unavailable') }, removeItem: () => { throw new Error('unavailable') } }
  const { controller } = makeController('project-a', storage)
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
  assert.equal(sends, 0); assert.equal(controller.snapshot().phase, 'storage_blocked')
})

test('accepted controller cannot Start again after canonical acceptance', async () => {
  const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  let sends = 0
  await withFetch((async () => { sends += 1; return response(accepted('unexpected')) }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
  assert.equal(sends, 0)
})

for (const [label, makeResponse] of [
  ['malformed 400', () => new Response('not-json', { status: 400 })],
  ['malformed 409', () => new Response(JSON.stringify({ error: 'conflict' }), { status: 409 })],
  ['arbitrary 503', () => new Response(JSON.stringify({ message: 'temporarily unavailable' }), { status: 503 })],
  ['malformed success', () => new Response(JSON.stringify({ data: { executionId: 7 } }), { status: 202 })],
] as const) {
  test(`${label} preserves ambiguous K1 and sends no second request`, async () => {
    const { controller, queryClient } = makeController(); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
    let sends = 0
    await withFetch((async () => { sends += 1; return makeResponse() }) as typeof fetch, async () => { await assert.rejects(() => controller.start()) })
    assert.equal(sends, 1)
    const state = controller.snapshot(); assert.equal(state.phase, 'ambiguous')
    if (state.phase === 'ambiguous') { assert.equal(state.intent.executionIntentKey, 'K1'); assert.deepEqual(state.intent.definitionIds, ['A', 'B']); assert.equal(state.intent.revision, 4) }
  })
}

test('fresh exact terminal lifecycle permits legitimate retirement and K2', async () => {
  const storage = new MemoryStorage(); const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')
  assert.ok(queryAuthority)
  await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, async () => {
    const status = await fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority!)
    queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  })
  const lifecycle = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')
  assert.ok(lifecycle)
  assert.equal(controller.retireAcceptedIntent(lifecycle).safe, true)
  assert.equal(controller.snapshot().phase, 'none')
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A', 'B'], revision: 4 }), true)
  assert.equal(controller.snapshot().phase, 'prepared')
  assert.notEqual('K1', 'K2')
  assert.equal(controller.snapshot().phase, 'prepared')
})

test('unrelated project or execution lifecycle cannot retire accepted intent', async () => {
  const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  await withFetch((async () => response(terminalStatus('project-b', 'execution-b'))) as typeof fetch, async () => {
    const status = await fetchCanonicalExecutionStatus('project-b', 'execution-b')
    queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-b', 'execution-b'), status, { updatedAt: Date.now() })
  })
  assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-b', 'execution-b'), null)
  assert.equal(controller.snapshot().phase, 'accepted')
  assert.equal(controller.retireAcceptedIntent(null).safe, false)
})

for (const [label, mutate] of [
  ['current error', (query: any) => query.setState({ ...(query.state as any), status: 'error', error: new Error('refresh failed'), fetchStatus: 'idle' })],
  ['current fetching', (query: any) => query.setState({ ...(query.state as any), status: 'success', error: null, fetchStatus: 'fetching' })],
] as const) {
  test(`cached terminal lifecycle with ${label} cannot authorize retirement`, async () => {
    const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
    await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
    const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
    const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
    queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
    const query = queryClient.getQueryCache().find({ queryKey: canonicalExecutionStatusQueryKey('project-a', 'execution-a') })
    mutate(query)
    assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a'), null)
    assert.equal(controller.snapshot().phase, 'accepted')
  })
}

test('nonterminal lifecycle cannot authorize retirement', async () => {
  const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a', 'running'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a'), null)
  assert.equal(controller.snapshot().phase, 'accepted')
})

test('tombstone persistence failure keeps accepted K1 fail-closed', async () => {
  const storage = new FailingRetirementStorage(); const queryClient = new QueryClient(); const controller = new RunIntentController(storage, 'project-a', queryClient); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  storage.failSetAfter = storage.writes
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  const lifecycle = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')!
  assert.equal(controller.retireAcceptedIntent(lifecycle).safe, false)
  assert.equal(controller.snapshot().phase, 'storage_blocked')
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A', 'B'], revision: 4 }), false)
  const durable = JSON.parse(storage.getItem(runIntentStorageKey('project-a'))!)
  assert.equal(durable.phase, 'accepted')
  assert.equal(durable.executionIntentKey, 'K1')
  assert.equal(storage.removes, 0)
})

test('cleanup failure preserves durable retired truth without silent reset', async () => {
  const storage = new FailingRetirementStorage(); const queryClient = new QueryClient(); const controller = new RunIntentController(storage, 'project-a', queryClient); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  storage.failRemove = true
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  const lifecycle = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')!
  const result = controller.retireAcceptedIntent(lifecycle)
  assert.equal(result.safe, true)
  assert.equal(result.cleanupIncomplete, true)
  assert.equal(controller.snapshot().phase, 'retired')
  const persisted = JSON.parse(storage.getItem(runIntentStorageKey('project-a'))!)
  assert.equal(persisted.phase, 'retired')
  assert.equal(persisted.executionIntentKey, 'K1')
  const reconstructed = new RunIntentController(storage, 'project-a', new QueryClient())
  assert.equal(reconstructed.snapshot().phase, 'retired')
})

test('wrong lifecycle project alone cannot retire accepted K1/A', async () => {
  const storage = new MemoryStorage(); const queryClient = new QueryClient(); const controller = new RunIntentController(storage, 'project-1', queryClient); prepare(controller, queryClient); seedPreflight(queryClient, 'project-1', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const before = storage.getItem(runIntentStorageKey('project-1'))
  const status = await withFetch((async () => response(terminalStatus('project-2', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-2', 'execution-a'))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-2', 'execution-a'), status, { updatedAt: Date.now() })
  assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-2', 'execution-a'), null)
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), false)
  assert.equal(storage.getItem(runIntentStorageKey('project-1')), before)
})

test('wrong lifecycle Execution alone cannot retire accepted K1/A', async () => {
  const storage = new MemoryStorage(); const queryClient = new QueryClient(); const controller = new RunIntentController(storage, 'project-1', queryClient); prepare(controller, queryClient); seedPreflight(queryClient, 'project-1', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const before = storage.getItem(runIntentStorageKey('project-1'))
  const status = await withFetch((async () => response(terminalStatus('project-1', 'execution-b'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-1', 'execution-b'))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-1', 'execution-b'), status, { updatedAt: Date.now() })
  assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-1', 'execution-b'), null)
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), false)
  assert.equal(storage.getItem(runIntentStorageKey('project-1')), before)
})

test('two project controllers sharing storage cannot mutate each other authority', async () => {
  const storage = new MemoryStorage(); const q1 = new QueryClient(); const q2 = new QueryClient()
  const p1 = new RunIntentController(storage, 'project-1', q1); const p2 = new RunIntentController(storage, 'project-2', q2)
  prepare(p1, q1, 'K1', ['A'], 4); prepare(p2, q2, 'K2', ['B'], 5)
  const p1Durable = storage.getItem(runIntentStorageKey('project-1'))
  seedPreflight(q2, 'project-2', ['B'], 5)
  await withFetch((async () => response(accepted('execution-b'))) as typeof fetch, () => p2.start())
  assert.equal(storage.getItem(runIntentStorageKey('project-1')), p1Durable)
  const restoredP1 = new RunIntentController(storage, 'project-1', new QueryClient())
  const state = restoredP1.snapshot(); assert.equal(state.phase, 'ambiguous')
  if (state.phase === 'ambiguous') { assert.equal(state.intent.executionIntentKey, 'K1'); assert.deepEqual(state.intent.definitionIds, ['A']); assert.equal(state.intent.revision, 4) }
  assert.equal(p2.snapshot().phase, 'accepted')
})

test('RunPage presentation Execution B cannot authorize retirement of accepted K1/A', async () => {
  const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  const authority = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')!
  assert.equal(isPrepareAnotherRunEligible(controller, 'project-a', 'execution-b', authority), false)
  assert.equal(controller.snapshot().phase, 'accepted')
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), false)
})

test('mounted RunPage query-string Execution B remains presentation-only for accepted K1/A', async () => {
  const storage = new MemoryStorage()
  storage.setItem(runIntentStorageKey('P1'), JSON.stringify({
    version: 1,
    phase: 'accepted',
    executionIntentKey: 'K1',
    definitionIds: ['A'],
    revision: 4,
    acceptance: accepted('A'),
  }))
  const before = storage.getItem(runIntentStorageKey('P1'))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  queryClient.setQueryData(['evidence-backed-tests', 'P1', null, null], { current: null }, { updatedAt: Date.now() })

  const originalFetch = globalThis.fetch
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
  const requestedUrls: string[] = []
  let mutationRequests = 0
  let renderer: ReactTestRenderer | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      sessionStorage: storage,
      addEventListener() {},
      removeEventListener() {},
    },
  })
  Object.defineProperty(globalThis, 'React', { configurable: true, writable: true, value: React })
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    requestedUrls.push(url)
    if ((init?.method ?? 'GET') !== 'GET') mutationRequests += 1
    if (url === '/api/v1/projects/P1/execution/B/status') {
      return response(terminalStatus('P1', 'B'), 200)
    }
    return new Response(JSON.stringify({ error: 'not available', code: 'NOT_FOUND', timestamp: NOW }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    await act(async () => {
      renderer = create(React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          MemoryRouter,
          {
            initialEntries: ['/run?project=P1&execution=B'],
            future: { v7_startTransition: true, v7_relativeSplatPath: true },
          },
          React.createElement(RunPage),
        ),
      ))
      await new Promise(resolve => setTimeout(resolve, 20))
    })

    const mounted = renderer as unknown as ReactTestRenderer
    const pageText = renderedText(mounted.root)
    assert.match(pageText, /Viewed Execution B is display-only context\. This intent remains bound to Execution A\./)
    assert.match(pageText, /Accepted Execution authority: A/)
    assert.equal(requestedUrls.filter(url => url === '/api/v1/projects/P1/execution/B/status').length, 1)

    const returnLink = mounted.root.findAllByType('a').find(link => link.props.href === '/run?project=P1&execution=A')
    assert.ok(returnLink, 'mounted router path must offer the truthful link back to accepted Execution A')
    const prepareAnother = mounted.root.findAllByType('button').find(button => renderedText(button).includes('Prepare another Run'))
    assert.ok(prepareAnother, 'terminal presentation Execution B should render the retirement control')
    assert.equal(prepareAnother.props.disabled, true)

    await act(async () => { prepareAnother.props.onClick(); await Promise.resolve() })
    assert.equal(mutationRequests, 0)
    assert.equal(storage.getItem(runIntentStorageKey('P1')), before)
    const durable = JSON.parse(storage.getItem(runIntentStorageKey('P1'))!)
    assert.equal(durable.phase, 'accepted')
    assert.equal(durable.executionIntentKey, 'K1')
    assert.equal(durable.acceptance.executionId, 'A')
  } finally {
    if (renderer) await act(async () => { renderer!.unmount() })
    queryClient.clear()
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete (globalThis as typeof globalThis & { window?: unknown }).window
    if (originalReact) Object.defineProperty(globalThis, 'React', originalReact)
    else delete (globalThis as typeof globalThis & { React?: unknown }).React
  }
})

test('lifecycle authority recovers only after fresh exact terminal revalidation', async () => {
  const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const first = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), first, { updatedAt: 1 })
  const query = queryClient.getQueryCache().find({ queryKey: canonicalExecutionStatusQueryKey('project-a', 'execution-a') })!
  query.setState({ ...(query.state as any), status: 'error', error: new Error('refresh failed'), fetchStatus: 'idle' } as any)
  assert.equal(resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a'), null)
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), false)
  const fresh = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), fresh, { updatedAt: 2 })
  const recovered = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')
  assert.ok(recovered)
  assert.equal(controller.retireAcceptedIntent(recovered).safe, true)
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), true)
})

test('K2 is explicitly rejected before retirement and accepted only after exact terminal A', async () => {
  const { controller, queryClient } = makeController('project-a'); prepare(controller, queryClient); seedPreflight(queryClient, 'project-a', ['A', 'B'], 4)
  await withFetch((async () => response(accepted('execution-a'))) as typeof fetch, () => controller.start())
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), false)
  const queryAuthority = issueLifecycleQueryTransportAuthority(controller, 'project-a', 'execution-a')!
  const status = await withFetch((async () => response(terminalStatus('project-a', 'execution-a'))) as typeof fetch, () => fetchCanonicalExecutionStatus('project-a', 'execution-a', queryAuthority))
  queryClient.setQueryData(canonicalExecutionStatusQueryKey('project-a', 'execution-a'), status, { updatedAt: Date.now() })
  const authority = resolveFreshLifecycleAuthority(controller, queryClient, 'project-a', 'execution-a')!
  assert.equal(controller.retireAcceptedIntent(authority).safe, true)
  assert.equal(controller.prepare({ executionIntentKey: 'K2', definitionIds: ['A'], revision: 4 }), true)
  const state = controller.snapshot(); assert.equal(state.phase, 'prepared'); if (state.phase === 'prepared') assert.equal(state.intent.executionIntentKey, 'K2')
})
