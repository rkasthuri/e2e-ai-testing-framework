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
 * Agentic P4 (Baseline #1: "the agentic stack has the honesty TYPES but no PRODUCERS").
 *   P4-A  limitations — BUILD the environment-error producer, keep 3 types RESERVED.
 *   P4-B  CapabilityRegistry / discoveredCapabilities — QUARANTINE (no empty claim persisted).
 *   P4-C  action-evidence persistence + the scoped evidence-integrity invariant (item 8c).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { AgentPlanner, GoalDefinition, findDanglingEvidenceIds } from '../src/core/agent/AgentPlanner'
import {
  AgentMemory, EvidenceRecord, AgentLimitation, ExecutionEnvironment, Goal,
  ActionResult, ObservationResult, ObservationTarget, AgentAction, CrawlSession, AgentMode,
} from '../src/core/agent/types'

let evCounter = 0
function mkEvidence(goalId: string, opts: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id:              opts.id ?? `mock-ev-${++evCounter}`,
    observationType: opts.observationType ?? 'direct_observation',
    signal:          opts.signal ?? 'mock signal',
    confidence:      opts.confidence ?? 'high',
    source:          opts.source ?? 'mock',
    timestamp:       opts.timestamp ?? '2026-01-01T00:00:00.000Z',
    goalId,
    preconditionEvidenceIds: opts.preconditionEvidenceIds ?? [],
  }
}

class MockEnvironment implements ExecutionEnvironment {
  readonly type = 'web-ui' as const
  verifyByGoal = new Map<string, { achieved: boolean; evidence: EvidenceRecord }>()
  actByType = new Map<string, ActionResult>()
  async observe(_t: ObservationTarget): Promise<ObservationResult> { return { observed: false, confidence: 'unknown', timestamp: 't' } }
  async act(action: AgentAction): Promise<ActionResult> {
    return this.actByType.get(action.type) ?? { success: true, evidence: mkEvidence('', { source: 'mock-act' }) }
  }
  async verify(goal: Goal): Promise<{ achieved: boolean; evidence: EvidenceRecord }> {
    return this.verifyByGoal.get(goal.id) ?? { achieved: false, evidence: mkEvidence(goal.id, { signal: 'mock-fail' }) }
  }
}

// P4-B: emptyMemory does NOT carry discoveredCapabilities (optional, never written).
function emptyMemory(): AgentMemory {
  return { appId: 'test-app', goals: [], evidence: [], lastUpdated: 't', crawlRunCount: 0 }
}
function def(id: string, actions: AgentAction[] = [], prerequisites: string[] = []): GoalDefinition {
  return { id, description: id, type: 'state', prerequisites, successCriteria: [], actions }
}
function session(goals: Goal[], memory: AgentMemory, mode: AgentMode = 'autonomous'): CrawlSession {
  return { id: 'sess-1', appId: 'test-app', mode, startedAt: 't', goals, limitations: [], memory, environment: 'web-ui' }
}
const CLICK: AgentAction = { type: 'click', target: 'btn', grounding: 'inferred' }

// ── P4-A: limitations — environment-error producer + reserved types ────────────

test('A1 action fails → session.limitations has ONE environment-error with error text + goalId (the fixed lie)', async () => {
  const env = new MockEnvironment()
  env.actByType.set('click', { success: false, evidence: mkEvidence('g1', { source: 'act' }), error: 'net::ERR_CONNECTION_REFUSED' })
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  await planner.executeGoal(g)                       // one execution — no replan (that is runSession's job)
  const lims = (planner as any).limitations as AgentLimitation[]
  assert.equal(lims.length, 1)
  assert.equal(lims[0].type, 'environment-error')
  assert.equal(lims[0].goalId, 'g1')
  assert.match(lims[0].description, /ERR_CONNECTION_REFUSED/)
})

test('A2 agent run with no failures → limitations [] (honest empty — nothing to report)', async () => {
  const env = new MockEnvironment()                  // act default = success
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const done = await planner.runSession(session([g], mem))
  assert.deepEqual(done.limitations, [])
})

test('A3 only environment-error is ever emitted — the 3 reserved types never are', async () => {
  const env = new MockEnvironment()
  env.actByType.set('click', { success: false, evidence: mkEvidence('g1'), error: 'boom' })
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  await planner.executeGoal(g)
  const lims = (planner as any).limitations as AgentLimitation[]
  assert.ok(lims.length >= 1)
  assert.ok(lims.every(l => l.type === 'environment-error'), 'only environment-error has a producer')
  for (const reserved of ['unknown-auth-pattern', 'permission-denied', 'rate-limited']) {
    assert.ok(!lims.some(l => l.type === reserved), `${reserved} is RESERVED — must never be emitted`)
  }
})

test('A4 action fails DURING runSession → done.limitations surfaces the environment-error (producer → return → the live reader)', async () => {
  // The consumer (CrawlRunner → agent-session.json) reads the RETURNED session's
  // limitations, NOT the planner instance field. This proves the produced limitation
  // survives runSession's `[...session.limitations, ...this.limitations]`. verify is
  // set to achieve so the goal does NOT replan — isolating exactly one action-failure.
  const env = new MockEnvironment()
  env.actByType.set('click', { success: false, evidence: mkEvidence('g1'), error: 'net::ERR_FAILED' })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  const done = await planner.runSession(session([g], mem))
  assert.equal(done.limitations.length, 1, 'the produced limitation must reach the returned session')
  assert.equal(done.limitations[0].type, 'environment-error')
  assert.equal(done.limitations[0].goalId, 'g1')
  assert.match(done.limitations[0].description, /ERR_FAILED/)
})

// ── P4-B: quarantine — no empty discoveredCapabilities claim, registries not built ─

test('B1 persisted AgentMemory carries NO discoveredCapabilities claim (removed from production defaultMemory)', async () => {
  // behavioral: a run's memory has no discoveredCapabilities key
  const env = new MockEnvironment()
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const done = await planner.runSession(session([g], mem))
  assert.ok(!('discoveredCapabilities' in done.memory), 'no discoveredCapabilities key in persisted memory')
  // source: production defaultMemory does not WRITE the field
  const runnerSrc = fs.readFileSync(path.join(__dirname, '../src/core/agent/AgentRunner.ts'), 'utf-8')
  assert.doesNotMatch(runnerSrc, /discoveredCapabilities\s*:/, 'AgentRunner must not write discoveredCapabilities')
})

test('B2 CapabilityRegistry types are not instantiated in any agent runtime path', () => {
  for (const f of ['AgentRunner.ts', 'AgentPlanner.ts', 'WebUIEnvironment.ts', 'ApiEnvironment.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../src/core/agent/' + f), 'utf-8')
    assert.doesNotMatch(src, /CapabilityRegistry/, `${f} must not reference CapabilityRegistry (quarantined)`)
  }
})

// ── P4-C: action-evidence persistence + scoped integrity invariant ─────────────

test('C1 action-evidence record IS in memory.evidence after a goal executes (was dropped)', async () => {
  const env = new MockEnvironment()
  env.actByType.set('click', { success: true, evidence: mkEvidence('g1', { id: 'act-ev-1', source: 'act' }) })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  const done = await planner.runSession(session([g], mem))
  assert.ok(done.memory.evidence.some(e => e.id === 'act-ev-1'), 'action-evidence must be persisted')
})

test('C2 INVARIANT: a fresh run leaves ZERO dangling preconditionEvidenceIds (whole-memory detector)', async () => {
  const env = new MockEnvironment()
  env.actByType.set('click', { success: true, evidence: mkEvidence('g1', { id: 'act-ev-2' }) })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  const done = await planner.runSession(session([g], mem))
  assert.deepEqual(findDanglingEvidenceIds(done.memory), [], 'fresh run → zero dangling anywhere')
})

test('C3 dedup: a repeated action-evidence id is not duplicated in memory.evidence', async () => {
  const env = new MockEnvironment()
  env.actByType.set('click', { success: true, evidence: mkEvidence('g1', { id: 'dup-ev' }) })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK, CLICK])])   // two clicks → same evidence id
  const done = await planner.runSession(session([g], mem))
  assert.equal(done.memory.evidence.filter(e => e.id === 'dup-ev').length, 1, 'duplicate id deduped')
})

test('C4 a THIS-SESSION record with a dangling precondition → throw fires (guard works on new data)', async () => {
  const env = new MockEnvironment()
  // action-evidence produced THIS session cites a non-existent record → dangling
  env.actByType.set('click', { success: true, evidence: mkEvidence('g1', { id: 'act-bad', preconditionEvidenceIds: ['ghost-id'] }) })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const mem = emptyMemory()
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  await assert.rejects(
    planner.runSession(session([g], mem)),
    /Evidence integrity violation.*ghost-id.*structural defect/s,
  )
})

test('C5 a LEGACY dangling record + a clean this-session run → NO throw (scoping), but detector STILL reports it', async () => {
  const mem = emptyMemory()
  // pre-existing legacy record (present at session START) with a dangling precondition
  mem.evidence.push(mkEvidence('old-goal', { id: 'legacy-rec', preconditionEvidenceIds: ['legacy-ghost'] }))
  const env = new MockEnvironment()                  // clean run — no new dangling
  env.actByType.set('click', { success: true, evidence: mkEvidence('g1', { id: 'act-clean' }) })
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const planner = new AgentPlanner(mem, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1', [CLICK])])
  const done = await planner.runSession(session([g], mem))   // must NOT throw — legacy grandfathered (item 8c)
  // the detector is TOTAL — it still surfaces the legacy dangle for audit
  assert.ok(findDanglingEvidenceIds(done.memory).includes('legacy-ghost'), 'detector reports the legacy dangle')
})
