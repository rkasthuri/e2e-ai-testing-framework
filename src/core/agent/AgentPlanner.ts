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
 * TD-013 Commit 2 — AgentPlanner (Phase 1).
 *
 * A PURE planner: no browser, no HTTP, no file I/O. It operates entirely on the
 * types in ./types and drives the injected ExecutionEnvironment (dependency
 * injection) so it is fully unit-testable with a fake environment.
 *
 * Phase 1 scope: goals are HAND-AUTHORED (GoalDefinition config), not
 * auto-discovered (that's Phase 2). Decomposition is a topological sort over the
 * prerequisite DAG; replanning is a bounded, evidence-gated retry; UNREACHABLE is
 * only ever concluded from evidence, never from a single failure.
 */
import {
  Goal, GoalType, GoalStatus, GoalOrigin, SuccessCriterion,
  EvidenceRecord, AgentMemory, ExecutionEnvironment,
  AgentAction, AgentMode, CrawlSession, AgentLimitation,
} from './types'
import { Mission, Missions } from './Mission'

const MAX_REPLAN_ATTEMPTS = 3

/**
 * PURE + TOTAL evidence-integrity detector (P4-C invariant, Nova). Returns every
 * preconditionEvidenceId — across ALL records in memory — that resolves to no record
 * in memory.evidence (a citation to non-existent evidence). Whole-memory: it reports
 * legacy/pre-invariant dangles too, for audit. No I/O, no throw. The runSession guard
 * SCOPES this result to records produced this session (item 8c); the C-suite calls it
 * directly to assert a fresh run's memory is fully clean.
 */
export function findDanglingEvidenceIds(memory: AgentMemory): string[] {
  const present = new Set(memory.evidence.map(e => e.id))
  const dangling = new Set<string>()
  for (const rec of memory.evidence)
    for (const pid of rec.preconditionEvidenceIds)
      if (!present.has(pid)) dangling.add(pid)
  return [...dangling]
}

// ── PART 2 — GoalDefinition (hand-authored config for Phase 1) ─────────────────

export interface GoalDefinition {
  id:          string
  description: string
  type:        GoalType
  origin?:     GoalOrigin      // defaults to 'user' (hand-authored); synthesized defs carry 'synthesized'
  successCriteria: SuccessCriterion[]
  prerequisites:   string[]    // goal ids
  actions:     AgentAction[]   // the action sequence to attempt
}
// Phase 1: goals are defined in a config, not auto-discovered
// Phase 2: the agent infers GoalDefinitions from the crawl model

// ── PART 3 — Decision event (foundation for TD-101, emitted not persisted yet) ─

export interface DecisionEvent {
  timestamp:     string
  goalId:        string
  decision:      string      // human-readable: "attempting alternative action sequence 2/3"
  reasoning:     string      // why this decision was made
  mode:          AgentMode
}
// In supervised mode: DecisionEvents are emitted to console (visible to user)
// In autonomous mode: DecisionEvents are logged only (not interactive)
// TD-101: DecisionLog will eventually persist these; for now emit/log only

// ── PART 1 — AgentPlanner ─────────────────────────────────────────────────────

export class AgentPlanner {
  // Bridge between Goal (contract — carries status/evidence, NO actions) and its
  // action plan (GoalDefinition — carries actions). Populated by loadGoalDefinitions.
  private goalDefinitions = new Map<string, GoalDefinition>()
  // Live index of goals by id, so prerequisite lookups see the latest status.
  private goalIndex = new Map<string, Goal>()
  // In-memory decision trail (TD-101 foundation — persistence is later).
  private decisionLog: DecisionEvent[] = []
  // P4-A: agent-level limitations observed this run (env-error producer below).
  // Same accumulation pattern as decisionLog; surfaced via runSession's return.
  private limitations: AgentLimitation[] = []
  private evidenceCounter = 0

  // Mission policy for this planner run (TD-093 Phase 2). Partially consumed:
  // authAttemptsPermitted gates the auth goal (GoalSynthesizer) and type gates
  // the bootstrap supervised hard-lock (AgentRunner:54). depthBudget stays
  // deferred (TD-105 — no spawn loop to bound); optimizeFor is RESERVED with
  // no consumer (see Mission.ts, 2026-07-18 audit).
  private mission: Mission

  constructor(
    private memory: AgentMemory,
    private environment: ExecutionEnvironment,
    private mode: AgentMode,   // 'supervised' | 'autonomous'
    mission?: Mission,
  ) {
    this.mission = mission ?? Missions.crawl()
  }

  /**
   * Ingest the hand-authored GoalDefinition config: caches each definition (for
   * its action plan) and returns the corresponding pending Goals. NOTE: added
   * beyond the spec's method list — required because the locked `Goal` type has no
   * `actions` field, so the planner needs the definitions to execute a goal.
   */
  loadGoalDefinitions(defs: GoalDefinition[]): Goal[] {
    const goals: Goal[] = []
    for (const def of defs) {
      this.goalDefinitions.set(def.id, def)
      const goal: Goal = {
        id:              def.id,
        type:            def.type,
        origin:          def.origin ?? 'user',   // hand-authored unless the def says otherwise
        description:     def.description,
        successCriteria: def.successCriteria,
        prerequisites:   def.prerequisites,
        status:          'pending',
        evidenceChain:   [],
        createdAt:       new Date().toISOString(),
      }
      this.goalIndex.set(goal.id, goal)
      goals.push(goal)
    }
    return goals
  }

  /**
   * GOAL DECOMPOSITION — return the goal hierarchy reachable from `businessGoal`
   * in dependency order (prerequisites first, business goal last). Phase 1: no
   * auto-discovery — the goals must already be loaded (loadGoalDefinitions) or
   * present in memory. Surfaces cycles and missing prerequisites as errors.
   */
  async decomposeGoal(businessGoal: Goal): Promise<Goal[]> {
    const ordered: Goal[] = []
    const done = new Set<string>()
    const visiting = new Set<string>()

    const resolve = (goal: Goal): void => {
      if (done.has(goal.id)) return
      if (visiting.has(goal.id)) {
        throw new Error(`[AgentPlanner] Cyclic prerequisite detected at goal '${goal.id}'`)
      }
      visiting.add(goal.id)
      for (const prereqId of goal.prerequisites) {
        const prereq = this.lookupGoal(prereqId)
        if (!prereq) {
          throw new Error(
            `[AgentPlanner] Prerequisite '${prereqId}' of goal '${goal.id}' not found ` +
            `— hand-authored GoalDefinition config is incomplete.`,
          )
        }
        resolve(prereq)
      }
      visiting.delete(goal.id)
      done.add(goal.id)
      ordered.push(goal)
    }

    resolve(businessGoal)
    return ordered
  }

  /**
   * GOAL EXECUTION — attempt to achieve a single goal; return it with updated
   * status + evidenceChain. Never mutates the input goal (returns a new object).
   */
  async executeGoal(goal: Goal): Promise<Goal> {
    // 1. Prerequisites — a prerequisite is "met" only if it is ACHIEVED *and* still
    //    has fresh evidence. An achieved-but-stale prerequisite (its evidence has
    //    expired) is NOT trusted — the goal is BLOCKED so the prerequisite gets
    //    re-verified rather than depended on blindly (freshness, not just status).
    const unmet = goal.prerequisites.find(pid => {
      const prereq = this.lookupGoal(pid)
      if (prereq?.status !== 'achieved') return true                 // not achieved -> unmet
      return !prereq.evidenceChain.some(e => this.isEvidenceFresh(e)) // achieved but stale -> unmet
    })
    if (unmet) {
      const prereq = this.lookupGoal(unmet)
      const reason = prereq?.status === 'achieved'
        ? `prerequisite '${unmet}' is achieved but its evidence is stale; needs re-verification`
        : `prerequisite '${unmet}' is not yet achieved`
      this.emitDecision(goal.id, `blocked on prerequisite '${unmet}'`, reason)
      return { ...goal, status: 'blocked' }
    }

    // 2. Already achieved with still-fresh evidence -> no re-execution.
    if (goal.status === 'achieved' && goal.evidenceChain.some(e => this.isEvidenceFresh(e))) {
      return goal
    }

    // 3. Execute the action plan. (4. observe is subsumed by verify() in Phase 1 —
    //    SuccessCriterion carries no ObservationTarget locator for a standalone
    //    observe() call, so the ExecutionEnvironment.verify() does the observing.)
    const actions = this.goalDefinitions.get(goal.id)?.actions ?? []
    // Connect the evidence chain: this goal's observation is preconditioned on its
    // own prior evidence + each prerequisite's evidence (they had to be true first) +
    // the evidence produced by the actions below.
    const prereqEvidenceIds = goal.prerequisites.flatMap(
      pid => this.lookupGoal(pid)?.evidenceChain.map(e => e.id) ?? [])
    const preconditionEvidenceIds = [...goal.evidenceChain.map(e => e.id), ...prereqEvidenceIds]
    // P4-C: collect the action-evidence RECORDS (not just their ids) so they are
    // persisted into memory.evidence via the runSession dedup — the preconditionEvidenceIds
    // below cite them, and a citation to an unpersisted record is a dangling ref.
    const actionEvidences: EvidenceRecord[] = []
    for (const action of actions) {
      const actionResult = await this.environment.act(action)
      actionEvidences.push(actionResult.evidence)
      preconditionEvidenceIds.push(actionResult.evidence.id)
      if (!actionResult.success) {
        // P4-A: the environment error is KNOWN here — record it as an agent-level
        // limitation (it was previously dropped at this break). Only 'environment-error'
        // has a producer; the other 3 AgentLimitationType values stay RESERVED until
        // their detection producers exist (403/429/auth-wall — follow-up TD).
        this.limitations.push({
          type:          'environment-error',
          description:   `Environment error during action on goal '${goal.id}': ${actionResult.error ?? 'unknown'}. `
                       + `Remedy: review the agent-session logs and check local environment/network stability.`,
          goalId:        goal.id,
          timestamp:     new Date().toISOString(),
        })
        break   // stop the sequence at the first failed action
      }
    }

    // 5. Verify success against the goal's criteria (authoritative observation).
    const verification = await this.environment.verify(goal)

    // 6. Build the goal-level EvidenceRecord: direct_observation if verified, else
    //    inference. Carries the full precondition chain (prior chain + action evidence).
    const evidence: EvidenceRecord = {
      id:              this.newEvidenceId(goal.id),
      observationType: verification.achieved ? 'direct_observation' : 'inference',
      signal:          verification.evidence.signal,
      confidence:      verification.evidence.confidence,
      source:          `AgentPlanner.executeGoal:${goal.id}`,
      timestamp:       new Date().toISOString(),
      expiresAt:       verification.evidence.expiresAt,
      goalId:          goal.id,
      preconditionEvidenceIds,
    }

    // 7. Update status (ACHIEVED | BLOCKED; UNREACHABLE is only concluded by replan).
    const status: GoalStatus = verification.achieved ? 'achieved' : 'blocked'

    // 7b. TD-013 Phase 3 (Block 1) — inferred→observed promotion. A SYNTHESIZED goal
    // (a hypothesis, zero evidence at synthesis) EARNS 'observed' provenance the moment
    // the planner marks it achieved — under the SAME `verification.achieved` gate that
    // sets 'achieved', never a weaker one. The planner (the belief-holder) is the SOLE
    // producer of 'observed'; it is written here and nowhere else, never on synthesis or
    // inference. 'user' provenance is immutable (hand-authored, never promoted); a
    // blocked/unreachable goal keeps 'synthesized' — unproven stays labeled unproven.
    const origin: GoalOrigin =
      status === 'achieved' && goal.origin === 'synthesized' ? 'observed' : goal.origin
    const originPromoted = origin !== goal.origin

    // 8. Supervised mode: emit a decision before any replan happens.
    this.emitDecision(goal.id,
      status === 'achieved' ? 'goal achieved' : 'goal blocked — candidate for replan',
      status === 'achieved'
        ? 'ExecutionEnvironment.verify() confirmed the success criteria' +
          (originPromoted ? ' — origin promoted synthesized→observed (earned by verified evidence)' : '')
        : 'verify() did not confirm the success criteria')

    return {
      ...goal,
      status,
      origin,
      // P4-C: action-evidence records join the chain so they reach memory.evidence
      // (via the runSession dedup) — every preconditionEvidenceId citing them resolves.
      evidenceChain: [...goal.evidenceChain, ...actionEvidences, evidence],
      resolvedAt: status === 'achieved' ? new Date().toISOString() : goal.resolvedAt,
    }
  }

  /**
   * REPLAN — a BLOCKED goal gets up to MAX_REPLAN_ATTEMPTS re-attempts. Phase 1
   * re-runs the SAME action sequence (alternative-sequence generation is Phase 2);
   * each attempt emits a DecisionEvent. If attempts are exhausted with no progress
   * (evidence-gated) -> UNREACHABLE, else stays BLOCKED.
   */
  async replan(blockedGoal: Goal, _session: CrawlSession): Promise<Goal> {
    let current = blockedGoal
    for (let attempt = 1; attempt <= MAX_REPLAN_ATTEMPTS; attempt++) {
      this.emitDecision(current.id,
        `attempting alternative action sequence ${attempt}/${MAX_REPLAN_ATTEMPTS}`,
        'previous attempt did not achieve the goal; re-attempting the action plan ' +
        '(Phase 1: same sequence — alternative generation is Phase 2)')

      current = await this.executeGoal({ ...current, status: 'pending' })
      if (current.status === 'achieved') {
        this.emitDecision(current.id, `goal achieved on replan attempt ${attempt}`,
          'a replan attempt satisfied the success criteria')
        return current
      }
      if (this.isUnreachable(current, attempt)) {
        this.emitDecision(current.id, 'goal marked UNREACHABLE',
          `${attempt} attempts exhausted, no new evidence, all prerequisites achieved`)
        return { ...current, status: 'unreachable', resolvedAt: new Date().toISOString() }
      }
    }
    // Attempts exhausted — conclude UNREACHABLE only if evidence-gated, else BLOCKED.
    return this.isUnreachable(current, MAX_REPLAN_ATTEMPTS)
      ? { ...current, status: 'unreachable', resolvedAt: new Date().toISOString() }
      : { ...current, status: 'blocked' }
  }

  /**
   * UNREACHABLE check — evidence-based, never from a single failure. True ONLY when
   * (a) attempts are exhausted, (b) no new direct evidence in the last N steps, and
   * (c) all prerequisites are ACHIEVED (so it isn't merely blocked upstream).
   */
  private isUnreachable(goal: Goal, attemptCount: number): boolean {
    // (a) never conclude unreachable before attempts are exhausted (never on a single failure)
    if (attemptCount < MAX_REPLAN_ATTEMPTS) return false
    // (c) prerequisites must all be ACHIEVED — otherwise it's blocked UPSTREAM, not
    //     unreachable. (Resolved from the live goalIndex, not session.goals, which is
    //     not updated in-place during runSession — see the Commit-2 note.)
    const prerequisitesMet = goal.prerequisites.every(
      prereqId => this.lookupGoal(prereqId)?.status === 'achieved')
    if (!prerequisitesMet) return false                                       // blocked upstream, not unreachable
    return true
    // Phase 1: SIMPLIFIED. Condition (b) — "no new evidence observed in the last N
    // steps" — is DEFERRED to Phase 2, which introduces a per-goal step counter.
    // For now: attempts exhausted (a) + all prerequisites achieved (c) -> unreachable.
  }

  /**
   * EVIDENCE FRESHNESS — false once expiresAt has passed, triggering re-verification
   * before depending on a stale ACHIEVED goal. No expiresAt -> always fresh.
   */
  private isEvidenceFresh(evidence: EvidenceRecord): boolean {
    if (!evidence.expiresAt) return true
    return new Date(evidence.expiresAt).getTime() > Date.now()
  }

  /**
   * SESSION RUN — orchestrate a full session. Iterates session.goals in dependency
   * order (produce them with decomposeGoal first), executes each, replans BLOCKED
   * ones, threads the latest status into the index, and accumulates new evidence
   * into session.memory. Returns the completed session.
   */
  async runSession(session: CrawlSession): Promise<CrawlSession> {
    for (const g of session.goals) this.goalIndex.set(g.id, g)
    // P4-C (item 8c scoping): records already in memory at session START are
    // pre-invariant legacy — captured here so the integrity throw below validates
    // ONLY what THIS session produces.
    const preexistingEvidenceIds = new Set(session.memory.evidence.map(e => e.id))

    const resolvedGoals: Goal[] = []
    for (const goal of session.goals) {
      let result = await this.executeGoal(this.goalIndex.get(goal.id) ?? goal)
      if (result.status === 'blocked') {
        result = await this.replan(result, session)
      }
      this.goalIndex.set(result.id, result)   // downstream prereq checks see the new status
      resolvedGoals.push(result)
      // Accumulate any evidence not already recorded.
      for (const e of result.evidenceChain) {
        if (!session.memory.evidence.some(x => x.id === e.id)) session.memory.evidence.push(e)
      }
    }

    // P4-C invariant (Nova): every EvidenceId FORGE produces must resolve to a record.
    // SCOPED (item 8c): a going-forward invariant does NOT retroactively crash on
    // pre-invariant data — that would be applying the law retroactively (the
    // fabrication-category error), mirroring the Crawl legacy-'human'-rows precedent.
    // findDanglingEvidenceIds is PURE + whole-memory (reports legacy dangles too, for
    // audit); the throw fires only for records produced THIS session. After P4-C,
    // action-evidence IS persisted, so a this-session ref never dangles — if one does,
    // that is the real bug and the throw MUST fire (never soften it — item 8c).
    const dangling = new Set(findDanglingEvidenceIds(session.memory))
    const thisSessionDangling = [...new Set(
      session.memory.evidence
        .filter(e => !preexistingEvidenceIds.has(e.id))                          // records produced THIS session
        .flatMap(e => e.preconditionEvidenceIds.filter(id => dangling.has(id)))  // …with an unresolved citation
    )]
    if (thisSessionDangling.length > 0) {
      throw new Error(
        `Evidence integrity violation: preconditionEvidenceId(s) ${thisSessionDangling.join(', ')} resolve to no ` +
        `persisted record — a citation to non-existent evidence produced this session. ` +
        `This is a structural defect, not a run failure.`,
      )
    }

    return {
      ...session,
      goals: resolvedGoals,
      limitations: [...session.limitations, ...this.limitations],   // P4-A: agent-level limitations observed this run
      completedAt: new Date().toISOString(),
      memory: {
        ...session.memory,
        goals: this.mergeGoals(session.memory.goals, resolvedGoals),
        lastUpdated: new Date().toISOString(),
      },
    }
  }

  /** The decision trail so far (foundation for TD-101 DecisionLog + tests). */
  getDecisionLog(): DecisionEvent[] {
    return this.decisionLog
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private lookupGoal(id: string): Goal | undefined {
    return this.goalIndex.get(id) ?? this.memory.goals.find(g => g.id === id)
  }

  private newEvidenceId(goalId: string): string {
    return `ev-${goalId}-${++this.evidenceCounter}`
  }

  private mergeGoals(existing: Goal[], updated: Goal[]): Goal[] {
    const byId = new Map(existing.map(g => [g.id, g]))
    for (const g of updated) byId.set(g.id, g)
    return [...byId.values()]
  }

  private emitDecision(goalId: string, decision: string, reasoning: string): void {
    const event: DecisionEvent = {
      timestamp: new Date().toISOString(), goalId, decision, reasoning, mode: this.mode,
    }
    this.decisionLog.push(event)
    if (this.mode === 'supervised') {
      // Interactive: surfaced to the user.
      console.log(`[AgentPlanner:decision] ${goalId} — ${decision} (${reasoning})`)
    } else {
      // Autonomous: logged only, not interactive.
      console.log(`[AgentPlanner:log] ${goalId} — ${decision}`)
    }
  }
}
