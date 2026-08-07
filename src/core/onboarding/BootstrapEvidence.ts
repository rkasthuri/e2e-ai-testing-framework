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
 * TD-093 Phase 2 — Bootstrap Evidence Package.
 *
 * Produced by the Phase 2 Bootstrap agent run. Nova Q4: Bootstrap does NOT seed
 * the App Model directly — this package is the hand-off artifact; the first full
 * crawl decides what to promote via the normal promotion pipeline.
 *
 * Written to reports/bootstrap-evidence-<app>.json (gitignored, matching the
 * bootstrap-manifest convention). TD-097: output path is runtime-resolved from
 * this file's location — no hardcoded paths.
 */
import * as path from 'path'
import { EvidenceObservationType, GoalOrigin } from '../agent/types'

export interface BootstrapEvidenceRecord {
  field: string;              // e.g. 'authType', 'renderingModel', 'crawlStrategy'
  value: unknown;
  observationType: EvidenceObservationType;
  source: string;             // e.g. 'login-attempt-success', 'nav-link-text', 'url-pattern'
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  goalOrigin: GoalOrigin;     // which goal produced this evidence
  timestamp: string;          // ISO
}

export interface BootstrapEvidencePackage {
  schemaVersion: '1.0';
  appName: string;
  url: string;
  missionType: 'bootstrap';
  producedAt: string;         // ISO
  agentSupervised: true;      // literal true — Bootstrap is always supervised
  records: BootstrapEvidenceRecord[];
  synthesizedGoalCount: number;
  achievedGoalCount: number;
  blockedGoalCount: number;
  unreachableGoalCount: number;
  authAttempted: boolean;
  authOutcome: 'success' | 'failed' | 'not-attempted';
  notes: string[];            // human-readable observations for the manifest
}

/** reports/bootstrap-evidence-<app>.json — runtime-resolved from repo root (TD-097). */
export function bootstrapEvidencePath(appName: string): string {
  const repoRoot = path.resolve(__dirname, '../../..')   // onboarding -> core -> src -> repoRoot
  return path.join(repoRoot, 'reports', `bootstrap-evidence-${appName}.json`)
}
