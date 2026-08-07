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
 * ADR-014 — ExecutionContext execution lock + DB close-on-switch (TD-UI-020).
 * shouldCloseDb is the pure close decision; SerialQueue is the serialization
 * primitive. Both unit-tested here without touching the engine.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SerialQueue } from '../forge-ui/server/context/SerialQueue'
import { shouldCloseDb } from '../forge-ui/server/context/ExecutionContext'

// ── close decision (pure) ─────────────────────────────────────────────────────

test('L1 shouldCloseDb: first run (last=null) → false (nothing open to close)', () => {
  assert.equal(shouldCloseDb(null, '/h/saucedemo/.forge/forge.db'), false)
})

test('L2 shouldCloseDb: same path (same-app re-crawl) → false (no close)', () => {
  const p = '/h/saucedemo/.forge/forge.db'
  assert.equal(shouldCloseDb(p, p), false)
})

test('L3 shouldCloseDb: target app changed → true (close before opening the new DB)', () => {
  assert.equal(
    shouldCloseDb('/h/saucedemo/.forge/forge.db', '/h/orangehrm/.forge/forge.db'),
    true,
  )
})

// ── serialization (SerialQueue) ───────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

test('L4 SerialQueue runs overlapping submits sequentially (no overlap)', async () => {
  const q = new SerialQueue()
  const order: string[] = []
  const task = (id: string) => async () => { order.push(`${id}:start`); await delay(15); order.push(`${id}:end`) }
  const pA = q.run(task('A'))
  const pB = q.run(task('B'))   // enqueued while A is still running
  await Promise.all([pA, pB])
  assert.deepEqual(order, ['A:start', 'A:end', 'B:start', 'B:end'])
})

test('L5 SerialQueue: a rejecting task does not block the next', async () => {
  const q = new SerialQueue()
  const order: string[] = []
  const pA = q.run(async () => { order.push('A'); throw new Error('boom') })
  const pB = q.run(async () => { order.push('B') })
  await assert.rejects(pA, /boom/)
  await pB
  assert.deepEqual(order, ['A', 'B'])
})
