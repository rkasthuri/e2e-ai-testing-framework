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
import { executionContext } from './ExecutionContext'
import { readApplicationReadiness } from './ApplicationReadinessController'
import * as crypto from 'crypto'
import type { TestInventoryResponse } from '../../src/api/types'

export interface TestInventoryHttpResult { status: number; body: unknown }
type Project = { appName: string }

type InventoryProjection = Pick<TestInventoryResponse, 'current' | 'history' | 'total' | 'nextCursor' | 'requestedDefinition'>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function data(result: { status: number; body: unknown }): Record<string, unknown> | null {
  return result.status === 200 ? record(record(result.body)?.data) : null
}

function inventoryProjection(value: unknown): InventoryProjection | { kind: 'invalid_cursor' } | null {
  const candidate = record(value)
  if (!candidate) return null
  if (candidate.kind === 'invalid_cursor') return { kind: 'invalid_cursor' }
  if (!('current' in candidate) || !Array.isArray(candidate.history)
    || typeof candidate.total !== 'number'
    || !(candidate.nextCursor === null || typeof candidate.nextCursor === 'string')
    || !('requestedDefinition' in candidate)) return null
  return candidate as unknown as InventoryProjection
}

function validLimit(value: unknown): number | null {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return null
  const limit = Number(value)
  return limit >= 1 && limit <= 50 ? limit : null
}

function safeFailure(cause: unknown): TestInventoryHttpResult {
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'DuplicateTestGenerationError') return { status: 409, body: fail('A test-design generation is already active for this project.', 'DUPLICATE_TEST_GENERATION') }
  if (name === 'TestDefinitionContractError') {
    const code = (cause as { code?: unknown }).code
    return code === 'STALE_AUTHORITY'
      ? { status: 409, body: fail('Canonical Test Definition authority changed before persistence.', 'STALE_AUTHORITY') }
      : { status: 422, body: fail('The proposed definitions did not satisfy the evidence-backed test contract.', 'TEST_DEFINITION_INVALID') }
  }
  if (name === 'MalformedTestSetError') return { status: 422, body: fail('Persisted test-set history could not be validated safely.', 'TEST_SET_HISTORY_INVALID') }
  return { status: 503, body: fail('The test-definition authority is temporarily unavailable.', 'TEST_DEFINITION_UNAVAILABLE') }
}

export async function readTestInventory(appName: string, query: Record<string, unknown>, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const limit = validLimit(query.limit)
  if (limit === null || (query.cursor !== undefined && typeof query.cursor !== 'string')
    || (query.test !== undefined && (typeof query.test !== 'string' || query.test.length > 255))) {
    return { status: 400, body: fail('Invalid test inventory pagination or identity.', 'INVALID_TEST_QUERY') }
  }
  try {
    const [inventory, readinessResult, admission] = await Promise.all([
      executionContext.readTestInventory(appName, { limit, cursor: (query.cursor as string | undefined) ?? null, definitionId: (query.test as string | undefined) ?? null }),
      readApplicationReadiness(appName, async () => project),
      executionContext.readCanonicalTestDefinitionAdmission(appName),
    ])
    const projectedInventory = inventoryProjection(inventory)
    if (projectedInventory && 'kind' in projectedInventory) return { status: 400, body: fail('Invalid or mismatched test inventory cursor.', 'INVALID_TEST_CURSOR') }
    if (!projectedInventory) return { status: 422, body: fail('Canonical test presentation could not be validated safely.', 'TEST_PRESENTATION_INVALID') }
    const readiness = data(readinessResult)
    if (!readiness || !Array.isArray(readiness.decisions)) return { status: 422, body: fail('Test-design readiness could not be validated safely.', 'TEST_DESIGN_SOURCE_INVALID') }
    const decision = readiness.decisions.find(item => record(item)?.id === 'design_evidence_backed_tests')
    return { status: 200, body: ok({
      project: { id: appName, name: project.appName },
      designReadiness: decision,
      canGenerate: record(admission)?.kind === 'ok',
      generationAdmission: admission,
      ...projectedInventory,
      boundaries: {
        execution: 'not_performed', coverage: 'unknown', freshness: 'not_evaluated',
        explanation: 'The read-only B5 projection discriminates sealed canonical v2 authority from quarantined legacy v1 provenance. Live execution eligibility remains a separate preflight truth.',
      },
    }) }
  } catch (cause) { return safeFailure(cause) }
}

export async function generateTestInventory(appName: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  try {
    const generationId = crypto.randomUUID()
    const generated = record(await executionContext.generateCanonicalTestSet(appName, generationId))
    const testSet = record(generated?.testSet)
    if (!testSet || !Array.isArray(testSet.definitions)) throw new Error('Canonical generation returned an invalid transport shape.')
    return { status: 202, body: ok({
      generationId,
      schemaVersion: testSet.schemaVersion,
      testSetId: testSet.testSetId,
      revision: testSet.revision,
      outcome: testSet.outcome,
      definitionCount: testSet.definitions.length,
    }) }
  } catch (cause) { return safeFailure(cause) }
}

export async function readTestDefinition(appName: string, definitionId: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(definitionId)) return { status: 404, body: fail('Test definition not found', 'NOT_FOUND') }
  try {
    const inventory = inventoryProjection(await executionContext.readTestInventory(appName, { limit: 1, cursor: null, definitionId }))
    if (!inventory || 'kind' in inventory) return { status: 422, body: fail('Canonical test presentation could not be validated safely.', 'TEST_PRESENTATION_INVALID') }
    return inventory.requestedDefinition
      ? { status: 200, body: ok({ project: { id: appName, name: project.appName }, ...inventory.requestedDefinition }) }
      : { status: 404, body: fail('Test definition not found', 'NOT_FOUND') }
  } catch (cause) { return safeFailure(cause) }
}

export async function readTestGenerationStatus(appName: string, generationId: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(generationId)) return { status: 404, body: fail('Generation not found', 'NOT_FOUND') }
  try {
    const status = await executionContext.readTestGenerationStatus(appName, generationId)
    return status ? { status: 200, body: ok(status) } : { status: 404, body: fail('Generation not found', 'NOT_FOUND') }
  } catch (cause) { return safeFailure(cause) }
}
