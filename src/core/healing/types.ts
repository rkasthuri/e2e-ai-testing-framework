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

import { HealConfidence, CorrectnessSignal } from '../storage/types';

export type SelectorStrategyName = 'data-test' | 'id' | 'role' | 'text' | 'css';

// TD-065 — the assertion a caller intended to make against the healed target, so
// a heal can be re-verified against the REAL assertion instead of mere
// resolvability. Threaded into SmartLocator.resolve() by callers (generator /
// forge-expect layer in later commits); absent = resolvability-only (unverified).
export type AssertionType =
  | 'toBeVisible' | 'toBeAttached' | 'toHaveText' | 'toHaveURL'
  | 'not.toHaveCount' | 'click' | 'fill' | 'goto' | 'unknown';

export interface AssertionContext {
  assertionType: AssertionType;
  expectedValue?: string;   // for toHaveText, fill value, goto URL, etc.
}

export interface SelectorStrategy {
  name: SelectorStrategyName;
  selector: string;
  /** For role-type strategies only — the accessible name to match alongside the bare ARIA role token in `selector`. See TD-029. */
  accessibleName?: string;
}

export interface SmartLocatorDef {
  key: string;
  description: string;
  strategies: SelectorStrategy[];
}

export interface HealEvent {
  key: string;
  timestamp: string;
  originalStrategy: SelectorStrategyName;
  healedStrategy: SelectorStrategyName;
  healedSelector: string;
  source: 'strategy-chain' | 'vision';
  confidence?: number;
  /** TD-065 — how the heal's correctness was established, and the derived
   *  correctness-based confidence tier. Undefined for pre-TD-065 heals. */
  correctnessSignal?: CorrectnessSignal;
  healConfidence?:    HealConfidence;
}

export interface HealStoreEntry {
  healedSelector: string;
  strategy: SelectorStrategyName;
  firstHealed: string;
  lastUsed: string;
  consecutiveSuccesses: number;
  source: 'strategy-chain' | 'vision';
  /** TD-066 — real heal confidence when one exists (vision heals carry the
   *  VisionHealer's returned confidence); undefined for strategy-chain heals,
   *  which have NO correctness signal (see TD-065). Was previously dropped here,
   *  which is why the DB write hardcoded a fabricated 1.0. */
  confidence?: number;
  /** TD-065 — carried forward so save() can persist them (same as confidence). */
  correctnessSignal?: CorrectnessSignal;
  healConfidence?:    HealConfidence;
}

export interface HealStore {
  [key: string]: HealStoreEntry;
}

export interface HealReport {
  runId: string;
  timestamp: string;
  healsAttempted: number;
  healsSucceeded: number;
  healsFailed: number;
  visionCallsUsed: number;
  visionBudget: number;
  events: HealEvent[];
  pomUpdateCandidates: string[];
}
