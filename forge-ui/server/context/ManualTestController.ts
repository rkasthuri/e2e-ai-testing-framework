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

import { fail, ok } from '../http'
import {
  executionContext,
  governedManualPromotionFailure,
  parseProductManualTestAnalyzeResponse,
  type ExecutionContext,
  type ManualTestAnalyzeResponseDto,
} from './ExecutionContext'

export type { ManualTestAnalyzeResponseDto } from './ExecutionContext'

export interface ManualTestAnalyzeRequestDto {
  schemaVersion: 'forge-manual-test-source-input/v1'
  sourceKind: 'manual'
  title: string
  objective: string | null
  steps: Array<{ ordinal: number; text: string }>
  expectedOutcome: string
}

export interface ManualTestSaveRequestDto {
  schemaVersion: 'forge-manual-promotion-request/v1'
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  reviewedProposalAuthority: { proposalId: string; proposalContentHash: string }
}

export interface ManualTestSaveResponseDto {
  schemaVersion: 'forge-manual-promotion-result/v1'
  outcome: 'promoted'
  sourceAuthority: { sourceId: string; sourceContentHash: string }
  proposalAuthority: { proposalId: string; proposalContentHash: string }
  definitionAuthority: {
    definitionId: string
    definitionSchemaVersion: 3
    testSetId: string
    testSetRevision: number
    testSetContentHash: string
  }
}

export interface ManualTestHttpResult { status: number; body: unknown }

type Project = { appName: string }
type ManualTestEngine = Pick<ExecutionContext, 'analyzeProductManualTest' | 'saveProductManualTest'>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && [...value].length >= 1 && [...value].length <= maximum
}

export function parseManualTestAnalyzeRequestDto(value: unknown): ManualTestAnalyzeRequestDto | null {
  const body = record(value)
  if (!body || !exact(body, ['schemaVersion', 'sourceKind', 'title', 'objective', 'steps', 'expectedOutcome'])
    || body.schemaVersion !== 'forge-manual-test-source-input/v1'
    || body.sourceKind !== 'manual'
    || !boundedText(body.title, 500)
    || !(body.objective === null || boundedText(body.objective, 2000))
    || !boundedText(body.expectedOutcome, 2000)
    || !Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 50) return null

  const steps: Array<{ ordinal: number; text: string }> = []
  for (let index = 0; index < body.steps.length; index += 1) {
    const step = record(body.steps[index])
    if (!step || !exact(step, ['ordinal', 'text']) || step.ordinal !== index + 1 || !boundedText(step.text, 2000)) return null
    steps.push({ ordinal: step.ordinal as number, text: step.text })
  }
  return {
    schemaVersion: 'forge-manual-test-source-input/v1',
    sourceKind: 'manual',
    title: body.title,
    objective: body.objective as string | null,
    steps,
    expectedOutcome: body.expectedOutcome,
  }
}

export function parseManualTestSaveRequestDto(value: unknown): ManualTestSaveRequestDto | null {
  const body = record(value)
  if (!body || !exact(body, ['schemaVersion', 'sourceAuthority', 'reviewedProposalAuthority'])
    || body.schemaVersion !== 'forge-manual-promotion-request/v1') return null
  const source = record(body.sourceAuthority)
  const proposal = record(body.reviewedProposalAuthority)
  if (!source || !exact(source, ['sourceId', 'sourceContentHash'])
    || !proposal || !exact(proposal, ['proposalId', 'proposalContentHash'])
    || typeof source.sourceId !== 'string' || !SAFE_ID.test(source.sourceId)
    || typeof source.sourceContentHash !== 'string' || !SHA256.test(source.sourceContentHash)
    || typeof proposal.proposalId !== 'string' || !SAFE_ID.test(proposal.proposalId)
    || typeof proposal.proposalContentHash !== 'string' || !SHA256.test(proposal.proposalContentHash)) return null
  return {
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: { sourceId: source.sourceId, sourceContentHash: source.sourceContentHash },
    reviewedProposalAuthority: { proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash },
  }
}

function analyzeFailure(): ManualTestHttpResult {
  return { status: 500, body: fail('Manual test analysis failed internally.', 'INTERNAL_ERROR') }
}

async function saveFailure(cause: unknown): Promise<ManualTestHttpResult> {
  const failure = await governedManualPromotionFailure(cause)
  if (!failure) {
    return { status: 500, body: fail('Manual test promotion failed internally.', 'INTERNAL_ERROR') }
  }
  const code = failure.code
  if (code === 'SOURCE_PROPOSAL_MISMATCH') {
    return { status: 409, body: fail('The supplied source authority does not match the persisted manual source.', code) }
  }
  if (code === 'MANUAL_PROMOTION_IDENTITY_CONFLICT') {
    return { status: 409, body: fail('The supplied proposal identity is internally inconsistent.', code) }
  }
  if (code === 'STALE_REVIEWED_PROPOSAL') {
    return { status: 409, body: fail('Current canonical evidence no longer matches the reviewed proposal.', code) }
  }
  if (code === 'MANUAL_PROPOSAL_NOT_EXECUTABLE') {
    return { status: 422, body: fail('The reviewed proposal is not executable under current canonical evidence.', code) }
  }
  return { status: 500, body: fail('Manual test promotion failed internally.', 'INTERNAL_ERROR') }
}

async function exactProject(
  appName: string,
  resolveProject: (appName: string) => Promise<Project | undefined>,
): Promise<boolean> {
  const project = await resolveProject(appName)
  return project?.appName === appName
}

export async function analyzeManualTest(
  appName: string,
  body: unknown,
  resolveProject: (appName: string) => Promise<Project | undefined>,
  engine: ManualTestEngine = executionContext,
): Promise<ManualTestHttpResult> {
  if (!await exactProject(appName, resolveProject)) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const request = parseManualTestAnalyzeRequestDto(body)
  if (!request) return { status: 400, body: fail('The manual test source is malformed.', 'MANUAL_SOURCE_INVALID') }
  try {
    const response: ManualTestAnalyzeResponseDto = await parseProductManualTestAnalyzeResponse(
      await engine.analyzeProductManualTest(appName, request),
    )
    return { status: 200, body: ok(response) }
  } catch {
    return analyzeFailure()
  }
}

export async function saveManualTest(
  appName: string,
  body: unknown,
  resolveProject: (appName: string) => Promise<Project | undefined>,
  engine: ManualTestEngine = executionContext,
): Promise<ManualTestHttpResult> {
  if (!await exactProject(appName, resolveProject)) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const request = parseManualTestSaveRequestDto(body)
  if (!request) return { status: 400, body: fail('The manual promotion request is malformed.', 'INVALID_MANUAL_PROMOTION_REQUEST') }
  try {
    const response = await engine.saveProductManualTest(appName, request) as ManualTestSaveResponseDto
    return { status: 201, body: ok(response) }
  } catch (cause) {
    return await saveFailure(cause)
  }
}
