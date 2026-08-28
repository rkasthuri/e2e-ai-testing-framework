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

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type {
  ManualAnalysisResultV1,
  ManualAutomationProposalV1,
  ManualPromotionResultV1,
  ManualTestSourceV1,
  SharedM3Contracts,
} from './driver';
import { cloneValue } from './driver';

export const SHARED_CONTRACT_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'm3-contract');
export const CERTIFICATION_FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'm3-certification');

export const SHARED_FIXTURE_FILES = Object.freeze([
  'positive-manual-source.json',
  'positive-automation-proposal.json',
  'positive-save-result.json',
  'unsupported-fill.json',
  'ambiguous-control.json',
  'insufficient-outcome.json',
  'app-area-unknown.json',
] as const);

export const REFUSAL_FIXTURE_FILES = Object.freeze([
  'unsupported-fill.json',
  'ambiguous-control.json',
  'insufficient-outcome.json',
  'app-area-unknown.json',
] as const);
export type RefusalFixtureFile = typeof REFUSAL_FIXTURE_FILES[number];

export function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadSharedContracts(): SharedM3Contracts {
  const refusals: Record<string, ManualAnalysisResultV1> = {};
  for (const file of REFUSAL_FIXTURE_FILES) {
    refusals[file] = loadJson<ManualAnalysisResultV1>(path.join(SHARED_CONTRACT_ROOT, file));
  }
  return {
    positiveSource: loadJson<ManualTestSourceV1>(path.join(SHARED_CONTRACT_ROOT, SHARED_FIXTURE_FILES[0])),
    positiveProposal: loadJson<ManualAutomationProposalV1>(path.join(SHARED_CONTRACT_ROOT, SHARED_FIXTURE_FILES[1])),
    positiveSaveResult: loadJson<ManualPromotionResultV1>(path.join(SHARED_CONTRACT_ROOT, SHARED_FIXTURE_FILES[2])),
    refusals,
  };
}

export function loadSharedRefusal(file: RefusalFixtureFile): ManualAnalysisResultV1 {
  return loadJson<ManualAnalysisResultV1>(path.join(SHARED_CONTRACT_ROOT, file));
}

export function sourceWithSharedRefusalAuthority(
  contracts: SharedM3Contracts,
  file: RefusalFixtureFile,
): ManualTestSourceV1 {
  const result = loadSharedRefusal(file);
  if (!result || result.outcome.kind !== 'refusal') throw new Error(`Not a refusal fixture: ${file}`);
  const source = cloneValue(contracts.positiveSource);
  const refusal = result.outcome.refusal;
  source.sourceId = refusal.sourceAuthority.sourceId;
  source.projectId = refusal.projectId;
  source.contentHash = refusal.sourceAuthority.sourceContentHash;
  const sourceStepCount = refusal.sourceGrounding.filter(item => {
    const sourceRef = item.sourceRef as Record<string, unknown>;
    return sourceRef.kind === 'step';
  }).length;
  const sharedSteps = cloneValue(contracts.positiveSource.steps);
  while (source.steps.length < sourceStepCount) source.steps.push(cloneValue(sharedSteps.at(-1)!));
  source.steps = source.steps.slice(0, sourceStepCount).map((step, index) => ({ ...step, ordinal: index + 1 }));
  return source;
}
