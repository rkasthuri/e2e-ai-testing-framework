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
 * TD-013 — Agentic crawl: the core type contract (Phase 1).
 *
 * This file is the locked architecture (Nova 9.9/10) that the entire agentic
 * system builds on. Every name, field, and comment is intentional. Pure types —
 * no imports, no runtime, no I/O.
 *
 * Shape: a 4-level Goal model with 4 goal states; an Evidence chain with trust
 * tiers + staleness; cross-session AgentMemory; a two-tier capability registry
 * (global agent knowledge vs per-app usage); a swappable ExecutionEnvironment;
 * agent-level limitations (kept SEPARATE from goal states); and a CrawlSession
 * that ties it together.
 */

// ── PART 1 — Goal Model (4 levels, 4 states, no more) ─────────────────────────

export type GoalType = 'business' | 'capability' | 'state' | 'action'

export type GoalStatus =
  'pending' | 'achieved' | 'blocked' | 'unreachable'
// EXACTLY 4 states. Do not add more. AGENT-LIMITED is on the agent, not here.

export interface SuccessCriterion {
  description:    string
  verifier:       string   // how to check: 'dom-assertion' | 'api-response' | etc.
  locator?:       string   // DOM selector or URL pattern to check
  expectedValue?: unknown  // the value expected at that locator (text, count, etc.)
}

/**
 * How this goal came to exist.
 * Nova Q1: origin is metadata on Goal, NOT an EvidenceRecord.
 * Evidence only begins after first action executes.
 */
export type GoalOrigin = 'observed' | 'synthesized' | 'user'

export interface Goal {
  id:              string
  type:            GoalType
  origin:          GoalOrigin
  description:     string
  successCriteria: SuccessCriterion[]
  prerequisites:   string[]    // goal ids that must be ACHIEVED first
  status:          GoalStatus
  evidenceChain:   EvidenceRecord[]  // the full chain proving this goal's status
  parentGoalId?:   string      // links to the higher-level goal
  createdAt:       string      // ISO
  resolvedAt?:     string      // ISO — when status became achieved/blocked/unreachable
}

// ── PART 2 — Evidence Model (chain + tiers + staleness) ───────────────────────

export type EvidenceObservationType =
  'direct_observation'    // agent performed action AND verified result
  | 'indirect_observation' // observed as side-effect of another action
  | 'inference'           // reasoned from other observations
  | 'assumption'          // no direct basis — lowest trust

export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface EvidenceRecord {
  id:              string
  observationType: EvidenceObservationType
  signal:          string       // what FORGE actually saw (DOM state, API response etc.)
  confidence:      EvidenceConfidence
  source:          string       // which action produced this observation
  timestamp:       string       // ISO
  expiresAt?:      string       // ISO — when this evidence should be re-verified
  goalId:          string       // which goal this evidence supports
  // The chain: each record references the prior action that enabled it
  preconditionEvidenceIds: string[]  // evidence that had to be true before this observation
}

// Evidence tier order (highest to lowest trust):
// direct_observation > indirect_observation > inference > assumption
export const EVIDENCE_TIER_ORDER: EvidenceObservationType[] = [
  'direct_observation',
  'indirect_observation',
  'inference',
  'assumption',
]

// ── PART 3 — AgentMemory (cross-session, persisted in app model) ──────────────

export interface AgentMemory {
  appId:          string     // which app this memory belongs to
  goals:          Goal[]     // all goals ever attempted for this app
  evidence:       EvidenceRecord[]  // all observations ever made
  // @unimplemented (P4-B quarantine) — TD-013 contract; NO discovery producer exists
  // yet (see follow-up TD). Optional + never written, so agent-memory.json does not
  // carry an empty [] that claims a discovery which never happened.
  discoveredCapabilities?: string[] // capability ids found in this app
  lastUpdated:    string     // ISO
  crawlRunCount:  number     // how many crawl runs have contributed to this memory
}

// ── PART 4 — Capability Registry (TWO-TIER — global vs app-level) ─────────────

// Global: what the AGENT knows how to handle (grows across all apps).
// @unimplemented (P4-B quarantine) — TD-013 contract; NO producer until agentic-crawl
// builds capability discovery + a consumer TOGETHER (Nova). Never instantiated in any
// runtime path today (grep-confirmed). Kept as the contract, not amputated.
export interface GlobalCapabilityRegistry {
  knownPatterns:   string[]   // e.g. 'form-login', 'cookie-session', 'REST-CRUD'
  unknownPatterns: string[]   // encountered but not handleable: 'OAuth', 'MFA', 'CAPTCHA'
  lastUpdated:     string
}

// App-level: what THIS APP uses (discovered during crawl).
// @unimplemented (P4-B quarantine) — same as GlobalCapabilityRegistry: contract only,
// no producer/consumer, never instantiated.
export interface AppCapabilityRegistry {
  appId:           string
  usesPatterns:    string[]   // subset of GlobalCapabilityRegistry.knownPatterns
  requiresHuman:   string[]   // patterns app uses that agent can't handle
  lastUpdated:     string
}

// ── PART 5 — ExecutionEnvironment (swappable interface) ───────────────────────

// 'web-ui' | 'api' — OPERATIONAL (WebUIEnvironment / ApiEnvironment).
// 'mobile' | 'iot' — RESERVED, no producer yet (TD-100 roadmap); do NOT emit
// until an execution environment exists (same convention as the RESERVED
// AgentLimitationType values above).
export type EnvironmentType = 'web-ui' | 'api' | 'mobile' | 'iot'

export interface ObservationTarget {
  type:    'dom-element' | 'api-response' | 'page-url' | 'network-request'
  locator: string        // CSS selector, API endpoint, URL pattern, etc.
}

export interface ObservationResult {
  observed:   boolean
  value?:     unknown    // the actual observed value
  confidence: EvidenceConfidence
  timestamp:  string
}

export interface AgentAction {
  type:       'click' | 'fill' | 'navigate' | 'api-call' | 'wait' | 'verify'
  /** TD-013 Phase 3 (Block 2a): the evidence basis for this action, reusing the
   *  FC-002 grounding vocabulary already on FlowStep. `readonly` — derivation reads
   *  it, never writes it; immutability is enforced at the type level.
   *
   *  grounding: 'observed' = FORGE itself crawled this exact transition (StateEdge-backed).
   *  'inferred' = NOT directly grounded in FORGE observation (user-authored, synthesized,
   *  or AI-generated) — NOT a quality judgment. Immutable: records evidence at WRITE time;
   *  execution never flips it (that's verification, a separate dimension — see Block-1 origin promotion). */
  readonly grounding: 'observed' | 'inferred'
  target:     string
  payload?:   unknown    // fill value, API body, etc.
  assertionContext?: {   // for post-action verification (TD-065 pattern)
    assertionType: string
    expectedValue?: unknown
  }
}

export interface ActionResult {
  success:    boolean
  evidence:   EvidenceRecord
  nextState?: string     // observable state after action
  error?:     string
}

export interface ExecutionEnvironment {
  type:    EnvironmentType
  observe(target: ObservationTarget): Promise<ObservationResult>
  act(action: AgentAction):           Promise<ActionResult>
  verify(goal: Goal):                 Promise<{ achieved: boolean; evidence: EvidenceRecord }>
}

// ── PART 6 — Agent-level states (SEPARATE from goal states) ───────────────────

export type AgentLimitationType =
  // OPERATIONAL — has a producer (AgentPlanner emits on action failure).
  | 'environment-error'    // browser/network failure
  // RESERVED — no producer yet; detection is a follow-up TD (403 -> permission-denied,
  // 429 -> rate-limited, auth-wall -> unknown-auth-pattern). Do NOT emit until detection exists.
  | 'unknown-auth-pattern' // OAuth, SSO, MFA, CAPTCHA
  | 'permission-denied'    // agent lacks access
  | 'rate-limited'         // app is throttling

export interface AgentLimitation {
  type:        AgentLimitationType
  description: string
  goalId:      string     // which goal triggered this limitation
  timestamp:   string
}

// ── PART 7 — CrawlSession (ties everything together) ──────────────────────────

export type AgentMode = 'supervised' | 'autonomous'

export interface CrawlSession {
  id:          string        // generateRunId() format
  appId:       string
  mode:        AgentMode     // --supervised (default) | --autonomous
  startedAt:   string
  completedAt?: string
  goals:       Goal[]        // all goals in this session
  limitations: AgentLimitation[]
  memory:      AgentMemory   // cross-session knowledge at session start
  environment: EnvironmentType
}
