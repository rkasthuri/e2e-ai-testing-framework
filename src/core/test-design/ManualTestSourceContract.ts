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

import * as crypto from 'crypto'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/

export interface ManualStepV1 {
  ordinal: number
  text: string
}

export interface ManualTestSourceInputV1 {
  schemaVersion: 'forge-manual-test-source-input/v1'
  sourceKind: 'manual'
  title: string
  objective: string | null
  steps: ManualStepV1[]
  expectedOutcome: string
}

export interface ManualTestSourceV1 {
  schemaVersion: 'forge-manual-test-source/v1'
  sourceId: string
  projectId: string
  sourceKind: 'manual'
  title: string
  objective: string | null
  steps: ManualStepV1[]
  expectedOutcome: string
  contentHash: string
}

export interface MaterializedManualTestSourceV1 {
  value: ManualTestSourceV1
  json: string
  contentHash: string
}

export class ManualTestSourceContractError extends Error {
  constructor(readonly code: 'MANUAL_SOURCE_INVALID' | 'MANUAL_SOURCE_INTEGRITY_INVALID' = 'MANUAL_SOURCE_INVALID') {
    super(code === 'MANUAL_SOURCE_INVALID'
      ? 'The manual test source is malformed.'
      : 'The persisted manual test source failed integrity validation.')
    this.name = 'ManualTestSourceContractError'
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ManualTestSourceContractError()
  }
}

function assertText(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || [...value].length < 1 || [...value].length > maximum) {
    throw new ManualTestSourceContractError()
  }
}

function validateSteps(value: unknown): asserts value is ManualStepV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new ManualTestSourceContractError()
  value.forEach((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new ManualTestSourceContractError()
    exactKeys(step as Record<string, unknown>, ['ordinal', 'text'])
    if ((step as ManualStepV1).ordinal !== index + 1) throw new ManualTestSourceContractError()
    assertText((step as ManualStepV1).text, 2000)
  })
}

export function parseManualTestSourceInputV1(value: unknown): ManualTestSourceInputV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualTestSourceContractError()
  const input = value as unknown as ManualTestSourceInputV1
  exactKeys(value as Record<string, unknown>, [
    'schemaVersion', 'sourceKind', 'title', 'objective', 'steps', 'expectedOutcome',
  ])
  if (input.schemaVersion !== 'forge-manual-test-source-input/v1' || input.sourceKind !== 'manual') {
    throw new ManualTestSourceContractError()
  }
  assertText(input.title, 500)
  if (input.objective !== null) assertText(input.objective, 2000)
  validateSteps(input.steps)
  assertText(input.expectedOutcome, 2000)
  return {
    schemaVersion: input.schemaVersion,
    sourceKind: input.sourceKind,
    title: input.title,
    objective: input.objective,
    steps: input.steps.map(step => ({ ordinal: step.ordinal, text: step.text })),
    expectedOutcome: input.expectedOutcome,
  }
}

export function manualSourceSemanticMaterial(
  projectId: string,
  source: Pick<ManualTestSourceInputV1, 'sourceKind' | 'title' | 'objective' | 'steps' | 'expectedOutcome'>,
) {
  if (!SAFE_ID.test(projectId)) throw new ManualTestSourceContractError()
  return {
    schemaVersion: 'forge-manual-test-source/v1' as const,
    projectId,
    sourceKind: source.sourceKind,
    title: source.title,
    objective: source.objective,
    steps: source.steps.map(step => ({ ordinal: step.ordinal, text: step.text })),
    expectedOutcome: source.expectedOutcome,
  }
}

export function manualSourceContentHash(
  projectId: string,
  source: Pick<ManualTestSourceInputV1, 'sourceKind' | 'title' | 'objective' | 'steps' | 'expectedOutcome'>,
): string {
  const material = manualSourceSemanticMaterial(projectId, source)
  return crypto.createHash('sha256').update(JSON.stringify(material), 'utf8').digest('hex')
}

export function materializeManualTestSourceV1(
  projectId: string,
  sourceId: string,
  input: ManualTestSourceInputV1,
): MaterializedManualTestSourceV1 {
  const parsed = parseManualTestSourceInputV1(input)
  if (!SAFE_ID.test(sourceId)) throw new ManualTestSourceContractError()
  const contentHash = manualSourceContentHash(projectId, parsed)
  const material = manualSourceSemanticMaterial(projectId, parsed)
  const value: ManualTestSourceV1 = {
    schemaVersion: material.schemaVersion,
    sourceId,
    projectId: material.projectId,
    sourceKind: material.sourceKind,
    title: material.title,
    objective: material.objective,
    steps: material.steps,
    expectedOutcome: material.expectedOutcome,
    contentHash,
  }
  return { value, json: JSON.stringify(value), contentHash }
}

export function parseManualTestSourceV1(value: unknown, verifyHash = true): ManualTestSourceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManualTestSourceContractError()
  const source = value as unknown as ManualTestSourceV1
  exactKeys(value as Record<string, unknown>, [
    'schemaVersion', 'sourceId', 'projectId', 'sourceKind', 'title', 'objective',
    'steps', 'expectedOutcome', 'contentHash',
  ])
  if (source.schemaVersion !== 'forge-manual-test-source/v1' || source.sourceKind !== 'manual'
    || !SAFE_ID.test(source.sourceId) || !SAFE_ID.test(source.projectId) || !SHA256.test(source.contentHash)) {
    throw new ManualTestSourceContractError()
  }
  assertText(source.title, 500)
  if (source.objective !== null) assertText(source.objective, 2000)
  validateSteps(source.steps)
  assertText(source.expectedOutcome, 2000)
  if (verifyHash && manualSourceContentHash(source.projectId, source) !== source.contentHash) {
    throw new ManualTestSourceContractError('MANUAL_SOURCE_INTEGRITY_INVALID')
  }
  return {
    schemaVersion: source.schemaVersion,
    sourceId: source.sourceId,
    projectId: source.projectId,
    sourceKind: source.sourceKind,
    title: source.title,
    objective: source.objective,
    steps: source.steps.map(step => ({ ordinal: step.ordinal, text: step.text })),
    expectedOutcome: source.expectedOutcome,
    contentHash: source.contentHash,
  }
}

export function manualSourceAsInput(source: ManualTestSourceV1): ManualTestSourceInputV1 {
  return {
    schemaVersion: 'forge-manual-test-source-input/v1',
    sourceKind: 'manual',
    title: source.title,
    objective: source.objective,
    steps: source.steps.map(step => ({ ...step })),
    expectedOutcome: source.expectedOutcome,
  }
}
