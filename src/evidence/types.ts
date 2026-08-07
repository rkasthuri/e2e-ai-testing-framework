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
 * Evidence layer — stable base type.
 * Per ARCHITECTURE_TARGET_EVIDENCE_LAYER.md §2: every claim FORGE makes is an
 * EvidenceObject whose `confidence` is reconstructable from a named `derivation`
 * — never a literal. Three independent axes: confidence (truth-likelihood),
 * validity (lifecycle), freshness (recency).
 *
 * TYPE ONLY — no emitters, no wiring, no DB, no imports from src/core/.
 */

import * as crypto from 'crypto';

// ── Branded id ──────────────────────────────────────────────────────────────
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };

// ── String-literal unions ───────────────────────────────────────────────────
export type ClaimType         = 'observation' | 'inference' | 'verdict' | 'metric' | 'recommendation';
export type Validity          = 'draft' | 'unproven' | 'validated' | 'superseded' | 'invalidated';
export type VerificationDepth = 'existence' | 'interacted' | 'state-validated' | 'behavior-validated';

// ── Supporting interfaces ───────────────────────────────────────────────────
export interface EvidenceSource        { stage: string; signal: string; detail?: string; }
export interface ConfidenceDerivation  { inputs: string[]; rule: string; }   // named inputs — never a literal
export interface Freshness             { capturedAt: string; stale: boolean; } // capturedAt = ISO 8601
export interface EvidenceRelationships { supports: EvidenceId[]; contradicts: EvidenceId[]; supersedes: EvidenceId[]; }
export interface EvidenceSubject       { kind: 'element' | 'test' | 'run' | 'endpoint' | 'page'; ref: string; }

// ── Core object ─────────────────────────────────────────────────────────────
export interface EvidenceObject {
  id: EvidenceId;
  claim: string;
  claimType: ClaimType;
  subject: EvidenceSubject;
  source: EvidenceSource;
  method: string;                          // how the claim was established
  verificationDepth?: VerificationDepth;   // present only for verification claims
  confidence: number;                      // 0..1 — truth-likelihood axis
  derivation: ConfidenceDerivation;        // REQUIRED — reconstructs `confidence`
  validity: Validity;                      // lifecycle axis
  freshness: Freshness;                    // recency axis
  relationships: EvidenceRelationships;
}

// ── Construction helper (no emitters) ───────────────────────────────────────
/**
 * Build an EvidenceObject with the machine-managed fields filled in:
 * fresh `id`, `freshness` stamped now, `validity` defaulting to 'unproven',
 * and empty `relationships`. Caller supplies the claim and its derivation.
 *
 * §2 invariant: a stated `confidence` must carry a `derivation` — literal /
 * unexplained confidence is forbidden, so this throws if one is given without
 * the other.
 */
export function createEvidence(
  input: Omit<EvidenceObject, 'id' | 'freshness' | 'validity' | 'relationships'> &
    Partial<Pick<EvidenceObject, 'validity' | 'relationships'>>,
): EvidenceObject {
  if (input.confidence !== undefined && input.confidence !== null && input.derivation === undefined) {
    throw new Error(
      'createEvidence: `confidence` requires a `derivation` (named inputs + rule); ' +
      'literal/unexplained confidence is forbidden (evidence layer §2).',
    );
  }

  if (typeof input.confidence === 'number' && (input.confidence < 0 || input.confidence > 1)) {
    throw new Error('createEvidence: `confidence` must be in [0,1] (evidence layer §2).');
  }

  if (input.derivation && input.derivation.inputs.length === 0) {
    throw new Error(
      'createEvidence: `derivation.inputs` must name at least one input; ' +
      'an empty derivation is a literal in disguise (evidence layer §2, TD-066).',
    );
  }

  return {
    ...input,
    id: crypto.randomUUID() as EvidenceId,
    validity: input.validity ?? 'unproven',
    freshness: { capturedAt: new Date().toISOString(), stale: false },
    relationships: input.relationships ?? { supports: [], contradicts: [], supersedes: [] },
  };
}
