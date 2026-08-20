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

export type CanonicalExecutionLifecycle =
  | 'running'
  | 'cancellation_requested'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

export type CanonicalExecutionOutcome = 'passed' | 'failed' | 'could_not_verify'

export interface CanonicalExecutionStartRequest {
  executionIntentKey: string
  definitionIds: string[]
  revision?: number
}

export interface CanonicalExecutionStartAccepted {
  executionId: string
  state: 'accepted'
  startedAt: string
  executionPlanHash: string
  replayed: boolean
}

export interface CanonicalExecutionStatus {
  executionId: string
  projectId: string
  state: CanonicalExecutionLifecycle
  outcome: CanonicalExecutionOutcome | null
  terminal: boolean
  startedAt: string
  completedAt: string | null
  lastHeartbeatAt: string | null
  processInstanceId: string
  safeCode: string | null
  safeMessage: string
  executionPlanHash: string
}

export interface CanonicalExecutionCancellationAccepted {
  executionId: string
  state: 'cancellation_requested'
  requestedAt: string
  alreadyRequested: boolean
}

export class CanonicalExecutionContractError extends Error {
  constructor() {
    super('Canonical execution payload is malformed.')
    this.name = 'CanonicalExecutionContractError'
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SAFE_CODE = /^[a-z][a-z0-9_]{0,99}$/
const SHA256 = /^[a-f0-9]{64}$/
const LIFECYCLES = new Set<CanonicalExecutionLifecycle>([
  'running', 'cancellation_requested', 'completed', 'cancelled', 'interrupted', 'unknown',
])
const OUTCOMES = new Set<CanonicalExecutionOutcome>(['passed', 'failed', 'could_not_verify'])
const TERMINAL = new Set<CanonicalExecutionLifecycle>(['completed', 'cancelled', 'interrupted'])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanonicalExecutionContractError()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new CanonicalExecutionContractError()
  }
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new CanonicalExecutionContractError()
  return value
}

function iso(value: unknown): string {
  if (typeof value !== 'string') throw new CanonicalExecutionContractError()
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new CanonicalExecutionContractError()
  return value
}

function nullableIso(value: unknown): string | null {
  return value === null ? null : iso(value)
}

export function decodeCanonicalExecutionStartAccepted(value: unknown): CanonicalExecutionStartAccepted {
  const input = record(value)
  exactKeys(input, ['executionId', 'state', 'startedAt', 'executionPlanHash', 'replayed'])
  if (input.state !== 'accepted' || typeof input.replayed !== 'boolean'
    || typeof input.executionPlanHash !== 'string' || !SHA256.test(input.executionPlanHash)) {
    throw new CanonicalExecutionContractError()
  }
  return {
    executionId: id(input.executionId),
    state: 'accepted',
    startedAt: iso(input.startedAt),
    executionPlanHash: input.executionPlanHash,
    replayed: input.replayed,
  }
}

export function decodeCanonicalExecutionStatus(value: unknown): CanonicalExecutionStatus {
  const input = record(value)
  exactKeys(input, [
    'executionId', 'projectId', 'state', 'outcome', 'terminal', 'startedAt', 'completedAt',
    'lastHeartbeatAt', 'processInstanceId', 'safeCode', 'safeMessage', 'executionPlanHash',
  ])
  if (typeof input.state !== 'string' || !LIFECYCLES.has(input.state as CanonicalExecutionLifecycle)
    || typeof input.terminal !== 'boolean'
    || input.outcome !== null && (typeof input.outcome !== 'string' || !OUTCOMES.has(input.outcome as CanonicalExecutionOutcome))
    || input.safeCode !== null && (typeof input.safeCode !== 'string' || !SAFE_CODE.test(input.safeCode))
    || typeof input.safeMessage !== 'string' || input.safeMessage.length < 1 || input.safeMessage.length > 1000
    || typeof input.executionPlanHash !== 'string' || !SHA256.test(input.executionPlanHash)) {
    throw new CanonicalExecutionContractError()
  }
  const state = input.state as CanonicalExecutionLifecycle
  const terminal = TERMINAL.has(state)
  if (input.terminal !== terminal || terminal !== (input.outcome !== null) || terminal !== (input.completedAt !== null)) {
    throw new CanonicalExecutionContractError()
  }
  const startedAt = iso(input.startedAt)
  const completedAt = nullableIso(input.completedAt)
  const lastHeartbeatAt = nullableIso(input.lastHeartbeatAt)
  if (completedAt && Date.parse(completedAt) < Date.parse(startedAt)
    || lastHeartbeatAt && Date.parse(lastHeartbeatAt) < Date.parse(startedAt)) {
    throw new CanonicalExecutionContractError()
  }
  return {
    executionId: id(input.executionId),
    projectId: id(input.projectId),
    state,
    outcome: input.outcome as CanonicalExecutionOutcome | null,
    terminal,
    startedAt,
    completedAt,
    lastHeartbeatAt,
    processInstanceId: id(input.processInstanceId),
    safeCode: input.safeCode as string | null,
    safeMessage: input.safeMessage,
    executionPlanHash: input.executionPlanHash,
  }
}

export function decodeCanonicalExecutionCancellationAccepted(value: unknown): CanonicalExecutionCancellationAccepted {
  const input = record(value)
  exactKeys(input, ['executionId', 'state', 'requestedAt', 'alreadyRequested'])
  if (input.state !== 'cancellation_requested' || typeof input.alreadyRequested !== 'boolean') {
    throw new CanonicalExecutionContractError()
  }
  return {
    executionId: id(input.executionId),
    state: 'cancellation_requested',
    requestedAt: iso(input.requestedAt),
    alreadyRequested: input.alreadyRequested,
  }
}
