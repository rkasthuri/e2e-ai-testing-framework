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
 * TD-013 Commit 5 — AgentPlanner proof test.
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`,
 * the scripts/*.test.ts glob). Pure in-memory: a MockEnvironment implements
 * ExecutionEnvironment with controllable observe/act/verify — NO browser, NO HTTP.
 *
 * Proves the planner's honesty-critical behaviors: goal status transitions, the
 * evidence chain + tiers, supervised/autonomous decision emission, and — the
 * distinction Nova/Aiden flagged as critical — BLOCKED (upstream) vs UNREACHABLE
 * (attempts exhausted with prerequisites met).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentPlanner, GoalDefinition } from '../src/core/agent/AgentPlanner'
import {
  AgentMemory, ExecutionEnvironment, EvidenceRecord, Goal,
  ObservationResult, ActionResult, ObservationTarget, AgentAction, CrawlSession, AgentMode,
} from '../src/core/agent/types'

const FUTURE = '2099-01-01T00:00:00.000Z'   // fresh evidence (expiresAt in the future)
const PAST   = '2000-01-01T00:00:00.000Z'   // stale evidence (expiresAt in the past)

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
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
  }
}

/** Controllable ExecutionEnvironment — no browser, no HTTP. */
class MockEnvironment implements ExecutionEnvironment {
  readonly type = 'web-ui' as const
  verifyByGoal = new Map<string, { achieved: boolean; evidence: EvidenceRecord }>()
  actByType = new Map<string, ActionResult>()
  observeByLocator = new Map<string, ObservationResult>()
  verifyCalls: string[] = []
  actCalls: string[] = []

  async observe(target: ObservationTarget): Promise<ObservationResult> {
    return this.observeByLocator.get(target.locator) ?? { observed: false, confidence: 'unknown', timestamp: 't' }
  }
  async act(action: AgentAction): Promise<ActionResult> {
    this.actCalls.push(action.type)
    return this.actByType.get(action.type) ?? { success: true, evidence: mkEvidence('', { source: 'mock-act' }) }
  }
  async verify(goal: Goal): Promise<{ achieved: boolean; evidence: EvidenceRecord }> {
    this.verifyCalls.push(goal.id)
    return this.verifyByGoal.get(goal.id) ?? { achieved: false, evidence: mkEvidence(goal.id, { signal: 'mock-fail' }) }
  }
}

function emptyMemory(): AgentMemory {
  return { appId: 'test-app', goals: [], evidence: [], discoveredCapabilities: [], lastUpdated: 't', crawlRunCount: 0 }
}
function def(id: string, prerequisites: string[] = []): GoalDefinition {
  return { id, description: id, type: 'state', prerequisites, successCriteria: [], actions: [] }
}
function achievedGoal(id: string, opts: { fresh: boolean }): Goal {
  return {
    id, type: 'state', origin: 'user', description: id, successCriteria: [], prerequisites: [],
    status: 'achieved', createdAt: 't', resolvedAt: 't',
    evidenceChain: [mkEvidence(id, { expiresAt: opts.fresh ? FUTURE : PAST })],
  }
}
function session(goals: Goal[], memory: AgentMemory, mode: AgentMode = 'autonomous'): CrawlSession {
  return { id: 'sess-1', appId: 'test-app', mode, startedAt: 't', goals, limitations: [], memory, environment: 'web-ui' }
}
function last(g: Goal): EvidenceRecord { return g.evidenceChain[g.evidenceChain.length - 1] }

async function captureConsole(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { await fn() } finally { console.log = orig }
  return logs
}

// ── PART 1 — Goal status transitions ──────────────────────────────────────────

test('P1.1 no prerequisites + successful verify -> ACHIEVED', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g1')])
  env.verifyByGoal.set('g1', { achieved: true, evidence: mkEvidence('g1') })
  const r = await planner.executeGoal(g)
  assert.equal(r.status, 'achieved')
  assert.ok(r.resolvedAt, 'resolvedAt is set on achievement')
})

test('P1.2 unmet prerequisite -> BLOCKED', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  memory.goals.push({ id: 'prereq', type: 'state', origin: 'user', description: 'p', successCriteria: [], prerequisites: [], status: 'pending', evidenceChain: [], createdAt: 't' })
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g2', ['prereq'])])
  env.verifyByGoal.set('g2', { achieved: true, evidence: mkEvidence('g2') })   // would succeed if reached
  const r = await planner.executeGoal(g)
  assert.equal(r.status, 'blocked')
  assert.equal(env.verifyCalls.length, 0, 'verify must NOT run when a prerequisite is unmet')
})

test('P1.3 verify fails MAX_REPLAN_ATTEMPTS times -> UNREACHABLE', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g3')])   // no prereqs -> not blocked upstream
  env.verifyByGoal.set('g3', { achieved: false, evidence: mkEvidence('g3', { signal: 'always fails' }) })

  const blocked = await planner.executeGoal(g)
  assert.equal(blocked.status, 'blocked', 'VACUITY: a single failure is BLOCKED, not UNREACHABLE')

  env.verifyCalls.length = 0
  const r = await planner.replan(blocked, session([g], memory))
  assert.equal(r.status, 'unreachable')
  assert.equal(env.verifyCalls.length, 3, 'VACUITY: replan retried MAX_REPLAN_ATTEMPTS(3) times before concluding')
})

test('P1.4 stale prerequisite (expired evidence) -> BLOCKED (fabrication protection)', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  memory.goals.push(achievedGoal('prereq', { fresh: false }))   // ACHIEVED but evidence expired
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g4', ['prereq'])])
  env.verifyByGoal.set('g4', { achieved: true, evidence: mkEvidence('g4') })
  const r = await planner.executeGoal(g)
  assert.equal(r.status, 'blocked', 'stale prerequisite is not trusted -> BLOCKED')
  assert.equal(env.verifyCalls.length, 0, 'VACUITY: if stale evidence were trusted, verify would run and the goal would proceed')

  // Contrast: a FRESH prerequisite lets the same goal proceed to ACHIEVED.
  memory.goals[0] = achievedGoal('prereq', { fresh: true })
  const r2 = await planner.executeGoal(g)
  assert.equal(r2.status, 'achieved', 'fresh prerequisite -> proceeds and achieves')
})

test('P1.5 already-achieved goal with fresh evidence -> not re-verified', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const g = achievedGoal('g5', { fresh: true })
  const r = await planner.executeGoal(g)
  assert.equal(r, g, 'returns the same achieved goal unchanged')
  assert.equal(env.verifyCalls.length, 0, 'fresh achieved goal is not re-verified')
})

// ── PART 2 — Evidence chain ───────────────────────────────────────────────────

test('P2.1 successful goal -> evidence observationType=direct_observation', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g21')])
  env.verifyByGoal.set('g21', { achieved: true, evidence: mkEvidence('g21') })
  const r = await planner.executeGoal(g)
  assert.equal(last(r).observationType, 'direct_observation')
})

test('P2.2 failed goal -> evidence observationType=inference (not direct_observation)', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g22')])
  env.verifyByGoal.set('g22', { achieved: false, evidence: mkEvidence('g22') })
  const r = await planner.executeGoal(g)
  assert.equal(last(r).observationType, 'inference')
  assert.notEqual(last(r).observationType, 'direct_observation')
})

test('P2.3 evidence chain connected to prerequisite evidence', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  const prereq = achievedGoal('prereq', { fresh: true })
  prereq.evidenceChain = [mkEvidence('prereq', { id: 'PREREQ-EV', expiresAt: FUTURE })]
  memory.goals.push(prereq)
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g23', ['prereq'])])
  env.verifyByGoal.set('g23', { achieved: true, evidence: mkEvidence('g23') })
  const r = await planner.executeGoal(g)
  assert.ok(
    last(r).preconditionEvidenceIds.includes('PREREQ-EV'),
    'the goal evidence references its prerequisite evidence id — the chain is connected')
})

// ── PART 3 — Mode behavior ────────────────────────────────────────────────────

test('P3.1 supervised mode emits interactive DecisionEvents', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'supervised')
  const [g] = planner.loadGoalDefinitions([def('s1')])
  env.verifyByGoal.set('s1', { achieved: true, evidence: mkEvidence('s1') })
  const logs = await captureConsole(async () => { await planner.executeGoal(g) })
  assert.ok(logs.some(l => l.includes('[AgentPlanner:decision]')), 'supervised emits interactive [decision] lines')
  assert.ok(planner.getDecisionLog().length > 0, 'decisions recorded in the decision log')
})

test('P3.2 autonomous mode logs decisions but not interactively', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('a1')])
  env.verifyByGoal.set('a1', { achieved: true, evidence: mkEvidence('a1') })
  const logs = await captureConsole(async () => { await planner.executeGoal(g) })
  assert.ok(logs.some(l => l.includes('[AgentPlanner:log]')), 'autonomous logs [log] lines')
  assert.ok(!logs.some(l => l.includes('[AgentPlanner:decision]')), 'autonomous does NOT emit interactive [decision] lines')
  assert.ok(planner.getDecisionLog().length > 0, 'the same decisions are still recorded')
})

// ── PART 4 — UNREACHABLE vs BLOCKED (the critical honesty check) ───────────────

test('P4.1 unmet prerequisites -> BLOCKED, never UNREACHABLE (blocked upstream)', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  memory.goals.push({ id: 'prereq', type: 'state', origin: 'user', description: 'p', successCriteria: [], prerequisites: [], status: 'pending', evidenceChain: [], createdAt: 't' })
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g41', ['prereq'])])
  env.verifyByGoal.set('g41', { achieved: false, evidence: mkEvidence('g41') })   // same failure as P4.2
  const blocked = await planner.executeGoal(g)
  const r = await planner.replan(blocked, session([g], memory))
  assert.equal(r.status, 'blocked', 'unmet prerequisites -> BLOCKED even after replan')
  assert.notEqual(r.status, 'unreachable', 'never UNREACHABLE when blocked upstream')
})

test('P4.2 met prerequisites + persistent verify failure -> UNREACHABLE', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  memory.goals.push(achievedGoal('prereq', { fresh: true }))   // prerequisite IS achieved + fresh
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('g42', ['prereq'])])
  env.verifyByGoal.set('g42', { achieved: false, evidence: mkEvidence('g42') })   // SAME failure as P4.1
  const blocked = await planner.executeGoal(g)
  const r = await planner.replan(blocked, session([g], memory))
  assert.equal(r.status, 'unreachable',
    'met prerequisites + persistent failure -> UNREACHABLE (the P4.1-vs-P4.2 distinction)')
})

// ── PART 5 — Session integration ──────────────────────────────────────────────

test('P5.1 runSession executes goals in dependency order + accumulates evidence', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const goals = planner.loadGoalDefinitions([def('auth'), def('cart', ['auth'])])
  env.verifyByGoal.set('auth', { achieved: true, evidence: mkEvidence('auth') })
  env.verifyByGoal.set('cart', { achieved: true, evidence: mkEvidence('cart') })
  const done = await planner.runSession(session(goals, memory))
  assert.equal(done.goals.length, 2)
  assert.equal(done.goals[0].status, 'achieved')
  assert.equal(done.goals[1].status, 'achieved')
  assert.ok(done.memory.evidence.length >= 2, 'memory accumulated evidence from both goals')
})

// ── PART 8 — TD-013 Phase 3 (Block 1): inferred→observed provenance promotion ──
// A synthesized goal EARNS 'observed' ONLY by verified achievement; the planner is the
// sole producer of 'observed'. 'user' provenance is immutable; unproven stays 'synthesized'.

/** A synthesized GoalDefinition (origin='synthesized'), else identical to def(). */
function synthDef(id: string, prerequisites: string[] = []): GoalDefinition {
  return { ...def(id, prerequisites), origin: 'synthesized' }
}

test('T1 synthesized goal verified achieved -> origin promoted to observed', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([synthDef('s1')])
  assert.equal(g.origin, 'synthesized', 'starts synthesized (a hypothesis)')
  env.verifyByGoal.set('s1', { achieved: true, evidence: mkEvidence('s1') })
  const r = await planner.executeGoal(g)
  assert.equal(r.status, 'achieved')
  assert.equal(r.origin, 'observed', 'verified achievement EARNS observed provenance')
})

test('T2 synthesized goal BLOCKED/UNREACHABLE -> origin STAYS synthesized', async () => {
  const env = new MockEnvironment()
  const memory = emptyMemory()
  const planner = new AgentPlanner(memory, env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([synthDef('s2')])
  env.verifyByGoal.set('s2', { achieved: false, evidence: mkEvidence('s2', { signal: 'always fails' }) })
  const blocked = await planner.executeGoal(g)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.origin, 'synthesized', 'unproven stays synthesized — not promoted on block')
  const unreachable = await planner.replan(blocked, session([g], memory))
  assert.equal(unreachable.status, 'unreachable')
  assert.equal(unreachable.origin, 'synthesized', 'unreachable stays synthesized — never promoted')
})

test('T3 user goal verified achieved -> origin STAYS user (never promoted)', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([def('u1')])   // def() defaults origin='user'
  assert.equal(g.origin, 'user', 'starts user (hand-authored)')
  env.verifyByGoal.set('u1', { achieved: true, evidence: mkEvidence('u1') })
  const r = await planner.executeGoal(g)
  assert.equal(r.status, 'achieved')
  assert.equal(r.origin, 'user', 'hand-authored provenance is immutable — never promoted')
})

test('T4 NEGATIVE: observed is set IFF verify().achieved — no weaker path promotes', async () => {
  const env = new MockEnvironment()
  const planner = new AgentPlanner(emptyMemory(), env, 'autonomous')
  const [g] = planner.loadGoalDefinitions([synthDef('s3')])
  // verify() is the SOLE source of `achieved`, and its type always carries an evidence
  // record ({achieved, evidence}) — so "achieved without evidence" is unconstructible.
  // Here verify().achieved === false: the goal must NOT promote.
  env.verifyByGoal.set('s3', { achieved: false, evidence: mkEvidence('s3') })
  const r = await planner.executeGoal(g)
  assert.notEqual(r.status, 'achieved')
  assert.equal(r.origin, 'synthesized', 'no achieved gate -> no observed; promotion is gated ONLY by verification.achieved')
})
